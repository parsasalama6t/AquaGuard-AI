"""
Video input handling for AquaGuard.

Supports live webcam streams and pre-recorded video files. Frames are read
in a daemon background thread so the main thread (FastAPI event loop) is
never blocked. Only the two most recent frames are buffered — older frames
are dropped to prevent processing lag.

Threading model
---------------
  Main thread  ──►  VideoStream.start()  ──►  _read_loop() [daemon thread]
                                                     │
                          self.lock guards:          ├─ latest_frame
                          latest_frame               ├─ latest_annotated
                          latest_annotated           ├─ latest_alerts
                          latest_alerts              └─ fps
                          fps

  get_jpeg_frame() and get_frame_data() acquire self.lock briefly so they
  always see a consistent snapshot without stalling the capture thread.
"""

import asyncio
import base64
import logging
import queue
import threading
import time
from typing import Callable, Optional, Union

import cv2
import numpy as np

from backend.detector import SwimmerDetector
from backend.models import WebSocketMessage

logger = logging.getLogger(__name__)


class VideoStream:
    """
    Continuous video capture with integrated distress detection.

    Reads frames on a daemon thread and optionally pipes each annotated
    frame to an async ``on_frame`` callback (e.g. a WebSocket broadcast).
    """

    def __init__(
        self,
        source: Union[int, str] = 0,
        detector: Optional[SwimmerDetector] = None,
    ) -> None:
        self.source = source
        self.detector = detector

        self.cap: Optional[cv2.VideoCapture] = None
        self.running: bool = False
        self.thread: Optional[threading.Thread] = None

        # Bounded queue — drop stale frames rather than accumulate lag
        self.frame_queue: queue.Queue = queue.Queue(maxsize=2)

        # Shared state — always access under self.lock
        self.latest_frame: Optional[np.ndarray] = None
        self.latest_annotated: Optional[np.ndarray] = None
        self.latest_alerts: list = []
        self.fps: float = 0.0

        self.frame_count: int = 0

        # Set externally to broadcast annotated frames over WebSocket
        self.on_frame: Optional[Callable] = None

        self.ended: bool = False  # True when a file source finishes playing

        self.lock = threading.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def open(self) -> bool:
        """
        Open the video source.

        Returns True on success, False if OpenCV cannot open the source
        (bad device index, missing file, unsupported codec, etc.).
        """
        self.cap = cv2.VideoCapture(self.source)
        if not self.cap.isOpened():
            logger.error("Failed to open video source: %s", self.source)
            return False

        native_fps = self.cap.get(cv2.CAP_PROP_FPS)
        width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        logger.info(
            "Opened source=%s  resolution=%dx%d  native_fps=%.1f",
            self.source,
            width,
            height,
            native_fps,
        )
        return True

    def start(self) -> None:
        """Open the source and launch the background capture thread."""
        if not self.open():
            logger.error("VideoStream.start() aborted — could not open source.")
            return

        self.running = True
        self.thread = threading.Thread(
            target=self._read_loop,
            name="aquaguard-capture",
            daemon=True,  # dies automatically when main process exits
        )
        self.thread.start()
        logger.info("Capture thread started (source=%s)", self.source)

    def stop(self) -> None:
        """Signal the capture thread to stop and release all resources."""
        self.running = False

        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=3.0)

        if self.cap:
            self.cap.release()
            self.cap = None

        cv2.destroyAllWindows()
        logger.info("VideoStream stopped (source=%s)", self.source)

    def replay(self) -> None:
        """Restart a file source from the beginning (no-op for webcams)."""
        if not isinstance(self.source, str):
            return

        # Wait for any still-running thread to exit
        if self.thread and self.thread.is_alive():
            self.running = False
            self.thread.join(timeout=3.0)

        self.ended = False
        self.frame_count = 0

        if self.cap and self.cap.isOpened():
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        else:
            if not self.open():
                logger.error("replay() failed — could not re-open source")
                return

        self.running = True
        self.thread = threading.Thread(
            target=self._read_loop,
            name="aquaguard-capture",
            daemon=True,
        )
        self.thread.start()
        logger.info("Replay started (source=%s)", self.source)

    # ------------------------------------------------------------------
    # Background capture loop
    # ------------------------------------------------------------------

    def _read_loop(self) -> None:
        """
        Capture frames continuously until self.running is False.

        Runs entirely on the daemon thread — never called directly.
        """
        fps_frame_counter = 0
        fps_timer = time.time()

        # Throttle to the native FPS of the source so video files play at
        # real speed instead of as-fast-as-possible.
        native_fps = self.cap.get(cv2.CAP_PROP_FPS) if self.cap else 30.0
        if native_fps <= 0 or native_fps > 120:
            native_fps = 30.0
        frame_interval = 1.0 / native_fps

        try:
            main_loop = asyncio.get_event_loop()
        except RuntimeError:
            main_loop = None

        while self.running:
            frame_start = time.perf_counter()

            if self.cap is None or not self.cap.isOpened():
                break

            ret, frame = self.cap.read()

            if not ret:
                if isinstance(self.source, str):
                    # File ended — stop and signal; frontend can replay on demand
                    logger.info("Video file ended: %s", self.source)
                    self.ended = True
                    self.running = False
                    break
                else:
                    # Webcam disconnected
                    logger.warning("Webcam read failed — stopping capture loop.")
                    break

            # ── Detection ────────────────────────────────────────────
            if self.detector is not None:
                annotated, alerts = self.detector.process_frame(frame)
                with self.lock:
                    self.latest_frame = frame
                    self.latest_annotated = annotated
                    self.latest_alerts = alerts
            else:
                with self.lock:
                    self.latest_frame = frame
                    self.latest_annotated = frame
                    self.latest_alerts = []

            # ── Frame queue (non-blocking drop) ──────────────────────
            try:
                self.frame_queue.put_nowait(frame)
            except queue.Full:
                pass  # consumer is too slow — silently discard

            # ── FPS counter (updated every 30 frames) ────────────────
            fps_frame_counter += 1
            if fps_frame_counter >= 30:
                elapsed = time.time() - fps_timer
                with self.lock:
                    self.fps = fps_frame_counter / elapsed if elapsed > 0 else 0.0
                fps_timer = time.time()
                fps_frame_counter = 0

            self.frame_count += 1

            # ── on_frame callback ─────────────────────────────────────
            if self.on_frame is not None:
                self._fire_on_frame(main_loop)

            # ── FPS throttle — sleep for the remaining frame budget ───
            elapsed = time.perf_counter() - frame_start
            sleep_time = frame_interval - elapsed
            if sleep_time > 0.001:
                time.sleep(sleep_time)

    def _fire_on_frame(self, main_loop: Optional[asyncio.AbstractEventLoop]) -> None:
        """
        Invoke self.on_frame safely regardless of whether it is a plain
        callable or an async coroutine function.
        """
        try:
            import asyncio as _asyncio
            if _asyncio.iscoroutinefunction(self.on_frame):
                if main_loop and main_loop.is_running():
                    _asyncio.run_coroutine_threadsafe(
                        self.on_frame(self.get_frame_data()), main_loop
                    )
                # If no running loop, skip rather than block
            else:
                self.on_frame(self.get_frame_data())
        except Exception:
            logger.exception("Error in on_frame callback")

    # ------------------------------------------------------------------
    # Frame accessors (main-thread safe)
    # ------------------------------------------------------------------

    def get_jpeg_frame(self) -> Optional[bytes]:
        """
        Encode the latest annotated frame as a JPEG byte string.

        Returns None if no frame has been captured yet.
        Quality is set to 80 — a good balance between size and fidelity
        for real-time streaming.
        """
        with self.lock:
            frame = (
                self.latest_annotated
                if self.latest_annotated is not None
                else self.latest_frame
            )

        if frame is None:
            return None

        ok, buf = cv2.imencode(
            ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80]
        )
        return buf.tobytes() if ok else None

    def get_frame_data(self) -> dict:
        """
        Return a JSON-serialisable snapshot of the current stream state.

        Safe to call from any thread.
        """
        with self.lock:
            fps = self.fps
            alerts = [a.model_dump() for a in self.latest_alerts]
            swimmers = (
                [
                    {
                        "swimmer_id": s.swimmer_id,
                        "status": s.status.value,
                        "score": round(s.distress_score, 1),
                        "lane": s.lane,
                        "bbox": s.bbox,
                    }
                    for s in self.detector.swimmers.values()
                    if s.face_confirmed   # only show validated swimmers
                ]
                if self.detector
                else []
            )

        import pathlib
        waterline = (
            round(self.detector._waterline.y_normalised, 4)
            if self.detector and self.detector._waterline.y_normalised is not None
            else None
        )
        return {
            "frame_count": self.frame_count,
            "fps": round(fps, 1),
            "swimmers": swimmers,
            "alerts": alerts,
            "source_type": "webcam" if isinstance(self.source, int) else "file",
            "source_name": pathlib.Path(self.source).name if isinstance(self.source, str) else "webcam",
            "is_running": self.running,
            "waterline": waterline,
        }

    # ------------------------------------------------------------------
    # Context manager support
    # ------------------------------------------------------------------

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *_):
        self.stop()


# ---------------------------------------------------------------------------
# Module-level helper
# ---------------------------------------------------------------------------


def encode_frame_base64(frame: np.ndarray) -> str:
    """
    Encode a BGR frame as a base64 JPEG string.

    Used when sending frames to the Gemini Vision API, which expects
    image data as a base64-encoded string rather than raw bytes.
    """
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        raise ValueError("cv2.imencode failed — frame may be empty or malformed")
    return base64.b64encode(buf.tobytes()).decode("utf-8")
