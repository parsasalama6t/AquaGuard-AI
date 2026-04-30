"""
Alert management for AquaGuard.

Receives Alert objects from the detector, de-duplicates them via per-swimmer
cooldowns, logs them, maintains a history for the dashboard, and optionally
fires ElevenLabs voice announcements for DISTRESS events.

Voice calls are dispatched as asyncio Tasks so they never delay frame
processing. Any ElevenLabs failure is caught and logged — it will never
propagate to the caller.
"""

import asyncio
import logging
import threading
import time
from typing import Optional

from dotenv import load_dotenv
import os

load_dotenv()

ELEVENLABS_API_KEY: Optional[str] = os.getenv("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID: str = os.getenv("ELEVENLABS_VOICE_ID", "Rachel")

from backend.models import Alert, SwimmerStatus

logger = logging.getLogger("aquaguard.alerts")


class AlertManager:
    """
    Central hub for alert de-duplication, logging, history, and voice output.

    Thread-safe: all state mutations are protected by self.lock so that the
    detector thread and the FastAPI request handlers can call methods
    concurrently without data races.
    """

    def __init__(self) -> None:
        self.alert_history: list[Alert] = []
        self.active_alerts: dict[int, Alert] = {}  # swimmer_id → latest alert
        self.cooldowns: dict[int, float] = {}       # swimmer_id → last alert time
        self.cooldown_seconds: float = 10.0

        self.voice_id: str = ELEVENLABS_VOICE_ID
        self.voice_enabled: bool = True
        self.elevenlabs_client = self._init_elevenlabs()

        self.lock = threading.Lock()

    # ------------------------------------------------------------------
    # Initialisation helpers
    # ------------------------------------------------------------------

    def _init_elevenlabs(self):
        """
        Attempt to initialise the ElevenLabs client.

        Returns the client on success, None on any failure (missing package,
        missing key, network error). Sets voice_enabled=False when returning
        None so the rest of the system can skip voice calls cheaply.
        """
        if not ELEVENLABS_API_KEY:
            logger.warning(
                "ELEVENLABS_API_KEY not set — voice alerts disabled."
            )
            self.voice_enabled = False
            return None

        try:
            from elevenlabs import ElevenLabs
            client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
            logger.info(
                "ElevenLabs client initialised (voice_id=%s).", self.voice_id
            )
            return client
        except Exception as exc:
            logger.warning("ElevenLabs init failed: %s — voice disabled.", exc)
            self.voice_enabled = False
            return None

    # ------------------------------------------------------------------
    # Core alert pipeline
    # ------------------------------------------------------------------

    async def process_alert(self, alert: Alert) -> None:
        """
        Ingest an alert from the detector.

        Steps:
          1. Check cooldown — silently skip if the same swimmer was alerted
             within cooldown_seconds.
          2. Record the alert in history and active_alerts.
          3. Log at the appropriate severity level.
          4. Fire a voice announcement for DISTRESS events (non-blocking).
        """
        swimmer_id = alert.swimmer_id
        now = time.time()

        with self.lock:
            last_time = self.cooldowns.get(swimmer_id, 0.0)
            if now - last_time < self.cooldown_seconds:
                return  # still within cooldown window

            self.cooldowns[swimmer_id] = now
            self.alert_history.append(alert)
            self.active_alerts[swimmer_id] = alert

        # Log outside the lock so logging I/O doesn't hold it
        if alert.status == SwimmerStatus.DISTRESS:
            logger.error(
                "DISTRESS — swimmer %d | score=%.1f | %s",
                swimmer_id,
                alert.score,
                alert.reason,
            )
            # Fire-and-forget: voice must not block the caller
            asyncio.ensure_future(self._speak_alert(alert))

        elif alert.status == SwimmerStatus.WARNING:
            logger.warning(
                "WARNING — swimmer %d | score=%.1f | %s",
                swimmer_id,
                alert.score,
                alert.reason,
            )

        else:
            logger.info(
                "NORMAL — swimmer %d status restored.", swimmer_id
            )

    async def _speak_alert(self, alert: Alert) -> None:
        """
        Generate and play a voice announcement via ElevenLabs.

        Runs as an asyncio Task. Any exception is caught and logged so that
        a broken audio pipeline can never bring down the detection system.
        """
        if not self.voice_enabled or self.elevenlabs_client is None:
            return

        lane_str = f"lane {alert.lane}" if alert.lane is not None else "the pool"

        if alert.status == SwimmerStatus.DISTRESS:
            message = (
                f"Attention! Swimmer {alert.swimmer_id} in {lane_str} "
                "may be drowning. Immediate assistance required."
            )
        else:
            message = (
                f"Warning. Swimmer {alert.swimmer_id} in {lane_str} "
                "showing signs of distress."
            )

        try:
            import subprocess, tempfile, sys
            loop = asyncio.get_event_loop()

            # Generate audio in a thread (blocking network call)
            audio = await loop.run_in_executor(
                None,
                lambda: b"".join(
                    self.elevenlabs_client.text_to_speech.convert(
                        voice_id=self.voice_id,
                        text=message,
                        model_id="eleven_multilingual_v2",
                    )
                ),
            )

            # Write to a temp file and play via afplay (macOS) or ffplay
            def _play():
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
                    f.write(audio)
                    path = f.name
                player = "afplay" if sys.platform == "darwin" else "ffplay"
                args = [player, path] if sys.platform == "darwin" else \
                       [player, "-nodisp", "-autoexit", path]
                subprocess.run(args, check=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            await loop.run_in_executor(None, _play)

        except Exception as exc:
            logger.warning("Voice alert failed (will not retry): %s", exc)

    # ------------------------------------------------------------------
    # Resolution
    # ------------------------------------------------------------------

    def resolve_alert(self, swimmer_id: int) -> None:
        """
        Mark a swimmer's alert as resolved and remove them from active_alerts.

        Called when the swimmer's status returns to NORMAL or they leave frame.
        """
        with self.lock:
            removed = self.active_alerts.pop(swimmer_id, None)

        if removed:
            logger.info(
                "Alert resolved for swimmer %d (was %s).",
                swimmer_id,
                removed.status.value,
            )

    # ------------------------------------------------------------------
    # Read accessors (safe to call from any thread)
    # ------------------------------------------------------------------

    def get_active_alerts(self) -> list[Alert]:
        """Return all currently active alerts, newest first."""
        with self.lock:
            alerts = list(self.active_alerts.values())
        return sorted(alerts, key=lambda a: a.timestamp, reverse=True)

    def get_alert_history(self, limit: int = 50) -> list[Alert]:
        """Return the most recent *limit* alerts from the full history, newest first."""
        with self.lock:
            history = list(self.alert_history)
        history.sort(key=lambda a: a.timestamp, reverse=True)
        return history[:limit]

    def get_stats(self) -> dict:
        """
        Return a summary dict for the dashboard stats panel.

        Counts are scoped to the last 24 hours so stale data doesn't skew
        the numbers after long-running sessions.
        """
        cutoff = time.time() - 86_400  # 24 hours ago

        with self.lock:
            history_snapshot = list(self.alert_history)
            active_count = len(self.active_alerts)

        recent = [a for a in history_snapshot if a.timestamp >= cutoff]

        return {
            "total_alerts_today": len(recent),
            "active_count": active_count,
            "distress_count": sum(
                1 for a in recent if a.status == SwimmerStatus.DISTRESS
            ),
            "warning_count": sum(
                1 for a in recent if a.status == SwimmerStatus.WARNING
            ),
            "voice_enabled": self.voice_enabled,
        }

    # ------------------------------------------------------------------
    # Maintenance
    # ------------------------------------------------------------------

    def clear_history(self) -> None:
        """Wipe alert history and active alerts (e.g. at the start of a new session)."""
        with self.lock:
            self.alert_history.clear()
            self.active_alerts.clear()
            self.cooldowns.clear()

        logger.info("Alert history cleared.")
