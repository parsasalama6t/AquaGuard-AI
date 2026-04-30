"""
Shared Pydantic and dataclass models for the AquaGuard AI swimmer distress detection system.

This module is the single source of truth for all data structures used across the backend.
It has no project-level imports and is safe to import with no side effects.
"""

import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class SwimmerStatus(str, Enum):
    """Severity classification for a detected swimmer's current state."""

    NORMAL = "normal"
    WARNING = "warning"
    DISTRESS = "distress"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class Alert(BaseModel):
    """
    Distress or warning alert emitted for a specific swimmer.

    Produced by the detection pipeline and forwarded to connected clients
    via WebSocket and optionally persisted to the alert log.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    swimmer_id: int
    status: SwimmerStatus
    score: float  # 0–100; higher values indicate greater distress likelihood
    reason: str
    timestamp: float = Field(default_factory=time.time)
    lane: Optional[int] = None


class SwimmerSummary(BaseModel):
    """
    Lightweight per-swimmer snapshot included in every FrameData payload.

    Carries only the information needed for the dashboard overlay;
    full detection state lives in SwimmerState.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    swimmer_id: int
    status: SwimmerStatus
    score: float
    lane: Optional[int] = None
    bbox: Optional[tuple] = None  # (x1, y1, x2, y2) in pixel coordinates


class FrameData(BaseModel):
    """
    Complete data payload produced for a single processed video frame.

    Broadcast to WebSocket clients after each inference pass so the
    frontend can redraw bounding boxes and status indicators.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    frame_id: int
    timestamp: float
    swimmers: list[SwimmerSummary]


class WebSocketMessage(BaseModel):
    """
    Envelope for all messages sent over the WebSocket connection.

    The `type` field drives client-side dispatch:
      - "frame_update"  → repaint the video overlay
      - "alert"         → show a distress notification
      - "connection"    → handshake / heartbeat
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    type: str
    data: dict
    timestamp: float = Field(default_factory=time.time)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class SwimmerState:
    """
    Mutable, per-swimmer tracking state maintained by the detection engine.

    Holds rolling history buffers used to compute motion metrics and the
    current distress score. One instance lives for each active swimmer ID
    and is updated on every frame the swimmer is visible.
    """

    swimmer_id: int
    status: SwimmerStatus = SwimmerStatus.NORMAL
    distress_score: float = 0.0
    stillness_frames: int = 0
    frames_tracked: int = 0          # total frames this track has been active
    face_confirmed: bool = False      # True once NOSE keypoint seen with conf ≥ 0.40
    lane: Optional[int] = None
    bbox: Optional[tuple] = None  # (x1, y1, x2, y2) in pixel coordinates

    # Keypoint Y-position histories (pixels, most-recent last)
    wrist_y_history: deque = field(default_factory=lambda: deque(maxlen=10))
    hip_y_history: deque = field(default_factory=lambda: deque(maxlen=10))
    nose_y_history: deque = field(default_factory=lambda: deque(maxlen=10))

    # Frame-level motion magnitude history (used for stillness detection)
    movement_history: deque = field(default_factory=lambda: deque(maxlen=60))

    last_seen: float = field(default_factory=time.time)

    # Time-based motion & submersion tracking
    last_motion_time: float = field(default_factory=time.time)
    nose_lost_time: Optional[float] = None   # set when nose keypoint drops while body visible

    # Frame fusion: rolling buffer of recent keypoint arrays for median scoring
    kp_buffer: deque = field(default_factory=lambda: deque(maxlen=5))
    kc_buffer: deque = field(default_factory=lambda: deque(maxlen=5))
