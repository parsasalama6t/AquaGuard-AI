"""
Gemini Vision API integration for AquaGuard.

Sends pool camera frames to Gemini 1.5 Flash for intelligent distress
analysis. Results complement the rule-based MediaPipe detector — Gemini
provides natural-language reasoning and a second opinion on flagged swimmers.

Rate-limiting is enforced internally: Gemini is called at most once every
``min_call_interval`` seconds so API quotas are never exhausted regardless
of the incoming frame rate.

All calls are async and wrapped in try/except — a Gemini failure is logged
and returns a safe fallback dict without propagating to the detection loop.
"""

import asyncio
import json
import logging
import os
import re
import time
from typing import Optional

import numpy as np
from dotenv import load_dotenv

from backend.models import Alert, SwimmerStatus, SwimmerSummary
from backend.video import encode_frame_base64

load_dotenv()

GEMINI_API_KEY: Optional[str] = os.getenv("GEMINI_API_KEY")
_MODEL_NAME = "gemini-1.5-flash"

logger = logging.getLogger("aquaguard.gemini")


class GeminiAnalyzer:
    """
    Async wrapper around the Gemini Vision API for pool-safety analysis.

    Two analysis modes are available:
      - ``analyze_frame``: general scene assessment for all tracked swimmers.
      - ``analyze_distress``: focused confirmation when MediaPipe flags a swimmer.

    Neither method ever raises — callers receive a safe fallback dict on any
    API or parsing error.
    """

    def __init__(self) -> None:
        self.model_name: str = _MODEL_NAME
        self.client = None
        self.enabled: bool = False
        self.call_count: int = 0
        self.last_call_time: float = 0.0
        self.min_call_interval: float = 2.0  # seconds between API calls
        self.lock = asyncio.Lock()
        self._init_client()

    # ------------------------------------------------------------------
    # Initialisation
    # ------------------------------------------------------------------

    def _init_client(self) -> None:
        """
        Configure the Gemini client from the environment.

        Sets ``enabled=False`` and logs a warning if the key is absent or
        the package cannot be imported, so the rest of the system degrades
        gracefully without Gemini.
        """
        if not GEMINI_API_KEY:
            logger.warning(
                "GEMINI_API_KEY not set — Gemini analysis disabled."
            )
            return

        try:
            from google import genai
            self.client = genai.Client(api_key=GEMINI_API_KEY)
            self.enabled = True
            logger.info(
                "Gemini client initialised (model=%s).", self.model_name
            )
        except Exception as exc:
            logger.warning(
                "Gemini client init failed: %s — analysis disabled.", exc
            )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def analyze_frame(
        self,
        frame: np.ndarray,
        swimmer_summaries: list[SwimmerSummary],
    ) -> dict:
        """
        Send a pool frame to Gemini for a general scene safety assessment.

        Returns a parsed dict on success, an empty dict if Gemini is
        disabled, or ``None`` if the call is within the rate-limit window.
        """
        if not self.enabled:
            return {}

        async with self.lock:
            if not self._within_rate_limit():
                return None  # caller should skip and use cached result

            base64_image = encode_frame_base64(frame)
            context = self._build_context(swimmer_summaries)
            result = await self._call_gemini(base64_image, context)
            self.last_call_time = time.time()
            self.call_count += 1

        return result

    async def analyze_distress(
        self,
        frame: np.ndarray,
        swimmer_id: int,
        score: float,
        reasons: list[str],
    ) -> dict:
        """
        Ask Gemini to confirm or deny a distress flag raised by MediaPipe.

        This is a focused, urgent query: the prompt tells Gemini exactly
        which swimmer was flagged and why, asking for a binary confirmation
        and a recommended action for the lifeguard.

        Returns a parsed dict, empty dict (disabled), or None (rate-limited).
        """
        if not self.enabled:
            return {}

        async with self.lock:
            if not self._within_rate_limit():
                return None

            base64_image = encode_frame_base64(frame)
            reasons_str = "; ".join(reasons) if reasons else "unspecified signals"
            prompt = (
                f"URGENT: Our motion detection system has flagged Swimmer {swimmer_id} "
                f"with a distress score of {score:.0f}/100.\n\n"
                f"Detected signals: {reasons_str}\n\n"
                "Please analyze this frame and confirm or deny if this swimmer "
                "needs immediate assistance.\n\n"
                "Respond in JSON:\n"
                "{\n"
                '  "confirm_distress": true | false,\n'
                '  "urgency": "immediate" | "monitor" | "false_alarm",\n'
                '  "observation": "what you see in the frame",\n'
                '  "action": "what lifeguard should do right now"\n'
                "}"
            )

            result = await self._send_to_gemini(base64_image, prompt)
            self.last_call_time = time.time()
            self.call_count += 1

        return result

    # ------------------------------------------------------------------
    # Internal: Gemini calls
    # ------------------------------------------------------------------

    async def _call_gemini(self, base64_image: str, context: str) -> dict:
        """
        Send a general scene-assessment prompt with the frame to Gemini.

        Builds the structured safety-analysis prompt, delegates to
        ``_send_to_gemini``, and returns the parsed response.
        """
        prompt = (
            "You are an AI safety assistant monitoring a swimming pool.\n\n"
            f"Current detection context:\n{context}\n\n"
            "Analyze this pool camera frame and assess swimmer safety.\n\n"
            "Respond in this exact JSON format:\n"
            "{\n"
            '  "overall_risk": "low" | "medium" | "high",\n'
            '  "swimmers": [\n'
            "    {\n"
            '      "position": "describe where in frame",\n'
            '      "behavior": "describe what you see",\n'
            '      "risk_level": "low" | "medium" | "high",\n'
            '      "reasoning": "why you assessed this risk level"\n'
            "    }\n"
            "  ],\n"
            '  "recommended_action": "describe what the lifeguard should do",\n'
            '  "confidence": 0.0\n'
            "}"
        )
        return await self._send_to_gemini(base64_image, prompt)

    async def _send_to_gemini(self, base64_image: str, prompt: str) -> dict:
        """
        Low-level helper: assemble the multimodal request and call the API.

        Handles JSON extraction (strips markdown fences), falls back to
        ``{"raw_response": ...}`` if the model returns plain text, and
        returns ``{"error": ..., "overall_risk": "unknown"}`` on any
        exception so callers always receive a dict.
        """
        try:
            from google import genai
            from google.genai import types as gtypes

            image_part = gtypes.Part.from_bytes(
                data=_b64_to_bytes(base64_image),
                mime_type="image/jpeg",
            )

            t0 = time.time()
            response = await self.client.aio.models.generate_content(
                model=self.model_name,
                contents=[image_part, prompt],
            )
            elapsed = time.time() - t0

            raw_text = response.text.strip()
            logger.info(
                "Gemini call #%d completed in %.2fs.", self.call_count + 1, elapsed
            )

            return _parse_json_response(raw_text)

        except Exception as exc:
            logger.warning("Gemini API call failed: %s", exc)
            return {"error": str(exc), "overall_risk": "unknown"}

    # ------------------------------------------------------------------
    # Internal: helpers
    # ------------------------------------------------------------------

    def _within_rate_limit(self) -> bool:
        """Return True if enough time has passed since the last API call."""
        return (time.time() - self.last_call_time) >= self.min_call_interval

    @staticmethod
    def _build_context(summaries: list[SwimmerSummary]) -> str:
        """Format swimmer summaries into a compact context string for the prompt."""
        if not summaries:
            return "No swimmers currently detected."

        lines = [f"Currently tracking {len(summaries)} swimmer(s):"]
        for s in summaries:
            lane_str = f" in lane {s.lane}" if s.lane is not None else ""
            lines.append(
                f"  - Swimmer {s.swimmer_id}{lane_str}: "
                f"status={s.status.value}, distress_score={s.score:.1f}/100"
            )
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    def get_stats(self) -> dict:
        """Return a summary dict suitable for the dashboard API endpoint."""
        return {
            "enabled": self.enabled,
            "total_calls": self.call_count,
            "last_call_time": self.last_call_time,
            "model_name": self.model_name,
        }


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


def _b64_to_bytes(b64: str) -> bytes:
    """Decode a base64 string to raw bytes."""
    import base64
    return base64.b64decode(b64)


def _parse_json_response(text: str) -> dict:
    """
    Extract and parse JSON from a Gemini response string.

    Strips markdown code fences (```json ... ```) before parsing.
    Falls back to ``{"raw_response": text}`` if the content is not
    valid JSON — this keeps callers from having to handle parse errors.
    """
    # Strip markdown code fences if present
    cleaned = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        logger.debug("Gemini response was not valid JSON; returning raw text.")
        return {"raw_response": text}
