"""
AquaGuard FastAPI server.

Wires together the video stream, pose detector, alert manager, and Gemini
analyzer, then exposes a REST API and a WebSocket endpoint for the React
frontend.

Concurrency model
-----------------
  uvicorn event loop
    ├── _broadcast_loop()        background Task — runs every 100 ms
    │     ├── video_stream.get_frame_data()     (non-blocking read)
    │     ├── alert_manager.get_active_alerts() (non-blocking read)
    │     ├── broadcast()                        sends JSON to all WS clients
    │     └── gemini.analyze_frame()             async, rate-limited
    ├── REST endpoints           standard async handlers
    └── /ws WebSocket handler    one Task per connected client

  The video capture runs on its own daemon thread (inside VideoStream).
  Detector callbacks post alert coroutines back to the event loop via
  loop.call_soon_threadsafe() captured inside the lifespan context.
"""

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.alerts import AlertManager
from backend.detector import SwimmerDetector
from backend.gemini import GeminiAnalyzer
from backend.models import SwimmerStatus, SwimmerSummary, WebSocketMessage
from backend.video import VideoStream

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

load_dotenv()

_raw_source = os.getenv("VIDEO_SOURCE", "0")
VIDEO_SOURCE: int | str = int(_raw_source) if _raw_source.isdigit() else _raw_source
HOST: str = os.getenv("HOST", "0.0.0.0")
PORT: int = int(os.getenv("PORT", "8000"))

VIDEOS_DIR = Path(os.getenv("VIDEOS_DIR", str(Path(__file__).parent.parent / "dr")))
_VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}


class VideoSelectBody(BaseModel):
    path: str

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)-24s  %(levelname)-8s  %(message)s",
)
logger = logging.getLogger("aquaguard.main")

# ---------------------------------------------------------------------------
# Global singletons
# ---------------------------------------------------------------------------

detector = SwimmerDetector(show_skeleton=True)
video_stream = VideoStream(source=VIDEO_SOURCE, detector=detector)
alert_manager = AlertManager()
gemini = GeminiAnalyzer()

connected_clients: set[WebSocket] = set()

_startup_time: float = 0.0
_gemini_last_run: float = 0.0
_GEMINI_INTERVAL: float = 2.0  # seconds between Gemini frame analyses
_video_ended_notified: bool = False  # prevents repeat broadcasts when file stops

# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncGenerator:
    """Start video capture and background broadcast on startup; clean up on shutdown."""
    global _startup_time

    _startup_time = time.time()

    # Capture the running event loop here so the daemon capture thread can
    # safely schedule alert coroutines via call_soon_threadsafe.
    loop = asyncio.get_running_loop()
    detector.on_alert = lambda alert: loop.call_soon_threadsafe(
        lambda: asyncio.ensure_future(alert_manager.process_alert(alert))
    )

    video_stream.start()
    logger.info("AquaGuard API ready — source=%s  host=%s  port=%d", VIDEO_SOURCE, HOST, PORT)

    broadcast_task = asyncio.create_task(_broadcast_loop())

    yield  # server runs here

    broadcast_task.cancel()
    try:
        await broadcast_task
    except asyncio.CancelledError:
        pass

    video_stream.stop()
    logger.info("AquaGuard shut down cleanly.")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="AquaGuard API",
    version="1.0.0",
    description="AI-powered swimmer distress detection system.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Background broadcast loop
# ---------------------------------------------------------------------------


async def _broadcast_loop() -> None:
    """
    Push frame updates to every connected WebSocket client at ~10 Hz.

    Also runs Gemini analysis every ``_GEMINI_INTERVAL`` seconds and
    merges the result into the broadcast payload when available.
    """
    global _gemini_last_run, _video_ended_notified
    gemini_result: dict = {}
    prev_distress_ids: set[int] = set()  # tracks distress swimmers across iterations

    while True:
        await asyncio.sleep(0.1)  # 10 Hz

        if not connected_clients:
            continue

        # Notify frontend once when a file source finishes playing
        if video_stream.ended and not _video_ended_notified:
            _video_ended_notified = True
            await broadcast(WebSocketMessage(type="video_ended", data={}))

        frame_data = video_stream.get_frame_data()
        active_alerts = [a.model_dump() for a in alert_manager.get_active_alerts()]

        # Detect newly escalated DISTRESS swimmers and ask Gemini to confirm
        current_distress = {a["swimmer_id"] for a in active_alerts if a["status"] == "distress"}
        new_distress = current_distress - prev_distress_ids
        prev_distress_ids = current_distress

        if new_distress and gemini.enabled:
            with video_stream.lock:
                confirm_frame = video_stream.latest_frame
            if confirm_frame is not None:
                for sid in new_distress:
                    alert = next((a for a in active_alerts if a["swimmer_id"] == sid), None)
                    if alert:
                        confirm = await gemini.analyze_distress(
                            confirm_frame, sid, alert["score"],
                            [alert.get("reason", "")]
                        )
                        if confirm:
                            await broadcast(WebSocketMessage(
                                type="distress_confirmed",
                                data={"swimmer_id": sid, "gemini": confirm},
                            ))

        # Run Gemini scene analysis every _GEMINI_INTERVAL seconds
        now = time.time()
        if now - _gemini_last_run >= _GEMINI_INTERVAL and gemini.enabled:
            with video_stream.lock:
                latest = video_stream.latest_frame

            if latest is not None:
                summaries = [
                    SwimmerSummary(
                        swimmer_id=s["swimmer_id"],
                        status=SwimmerStatus(s["status"]),
                        score=s["score"],
                        lane=s.get("lane"),
                        bbox=s.get("bbox"),
                    )
                    for s in frame_data.get("swimmers", [])
                ]
                result = await gemini.analyze_frame(latest, summaries)
                if result:
                    gemini_result = result
                _gemini_last_run = now

        payload = WebSocketMessage(
            type="frame_update",
            data={
                **frame_data,
                "active_alerts": active_alerts,
                "gemini": gemini_result,
            },
        )
        await broadcast(payload)


async def broadcast(message: WebSocketMessage) -> None:
    """Send a JSON message to all connected WebSocket clients."""
    if not connected_clients:
        return

    json_str = message.model_dump_json()
    dead: set[WebSocket] = set()

    for ws in list(connected_clients):
        try:
            await ws.send_text(json_str)
        except Exception:
            dead.add(ws)

    connected_clients.difference_update(dead)

# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------


@app.get("/", tags=["system"])
async def root() -> dict:
    return {"status": "ok", "service": "AquaGuard API"}


@app.get("/health", tags=["system"])
async def health() -> dict:
    return {
        "status": "ok",
        "uptime": round(time.time() - _startup_time, 1),
        "video": video_stream.get_frame_data(),
        "alerts": alert_manager.get_stats(),
        "gemini": gemini.get_stats(),
    }


@app.get("/alerts", tags=["alerts"])
async def get_alert_history(limit: int = 50) -> list:
    return [a.model_dump() for a in alert_manager.get_alert_history(limit=limit)]


@app.get("/alerts/active", tags=["alerts"])
async def get_active_alerts() -> list:
    return [a.model_dump() for a in alert_manager.get_active_alerts()]


@app.post("/alerts/{swimmer_id}/resolve", tags=["alerts"])
async def resolve_alert(swimmer_id: int) -> dict:
    alert_manager.resolve_alert(swimmer_id)
    return {"resolved": True, "swimmer_id": swimmer_id}


@app.get("/swimmers", tags=["detection"])
async def get_swimmers() -> dict:
    return video_stream.get_frame_data()


@app.get("/videos", tags=["video"])
async def list_videos() -> list:
    """Return all video files in VIDEOS_DIR with metadata."""
    if not VIDEOS_DIR.exists():
        return []
    active_path = str(video_stream.source)
    result = []
    for f in sorted(VIDEOS_DIR.iterdir()):
        if f.is_file() and f.suffix.lower() in _VIDEO_EXTENSIONS:
            stat = f.stat()
            result.append({
                "name": f.name,
                "path": str(f),
                "size_mb": round(stat.st_size / 1_000_000, 1),
                "active": str(f) == active_path,
            })
    return result


@app.post("/videos/replay", tags=["video"])
async def replay_video() -> dict:
    """Restart the current file source from the beginning."""
    global _video_ended_notified
    if not isinstance(video_stream.source, str):
        raise HTTPException(status_code=400, detail="Replay is only available for file sources")
    _video_ended_notified = False
    detector.swimmers.clear()
    detector._tracks.clear()
    detector._lost.clear()
    alert_manager.clear_history()
    video_stream.replay()
    await broadcast(WebSocketMessage(
        type="source_changed",
        data={"name": video_stream.source, "path": str(video_stream.source)},
    ))
    return {"status": "ok", "source": str(video_stream.source)}


@app.post("/videos/select", tags=["video"])
async def select_video(body: VideoSelectBody) -> dict:
    """Switch the active video source to the requested file."""
    global video_stream

    path = Path(body.path).resolve()
    allowed = VIDEOS_DIR.resolve()

    if not str(path).startswith(str(allowed)):
        raise HTTPException(status_code=403, detail="Access denied")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if path.suffix.lower() not in _VIDEO_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file type")

    global _video_ended_notified
    old_stream = video_stream
    new_stream = VideoStream(source=str(path), detector=detector)
    video_stream = new_stream          # broadcast loop picks this up next tick
    _video_ended_notified = False
    new_stream.start()
    old_stream.stop()

    # Reset all per-session state so the new video starts clean
    detector.swimmers.clear()
    detector._tracks.clear()
    detector._lost.clear()
    alert_manager.clear_history()

    # Tell every connected frontend to wipe its state immediately
    await broadcast(WebSocketMessage(
        type="source_changed",
        data={"name": path.name, "path": str(path)},
    ))

    logger.info("Video source switched to: %s", path.name)
    return {"status": "ok", "name": path.name, "path": str(path)}


@app.get("/stream/jpeg", tags=["video"])
async def jpeg_stream() -> StreamingResponse:
    """MJPEG stream — usable as <img src="/stream/jpeg">."""
    return StreamingResponse(
        _mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


async def _mjpeg_generator() -> AsyncGenerator[bytes, None]:
    while True:
        frame_bytes = video_stream.get_jpeg_frame()
        if frame_bytes:
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n"
                + frame_bytes
                + b"\r\n"
            )
        await asyncio.sleep(0.033)  # ~30 fps


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    connected_clients.add(websocket)
    client = websocket.client
    logger.info("WebSocket connected: %s:%s  (total=%d)", client.host, client.port, len(connected_clients))

    await websocket.send_text(
        WebSocketMessage(
            type="connection",
            data={"status": "connected", "clients": len(connected_clients)},
        ).model_dump_json()
    )

    try:
        while True:
            text = await websocket.receive_text()
            if text.strip().lower() in ("ping", '{"type":"ping"}'):
                await websocket.send_text('{"type":"pong"}')
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("WebSocket error for %s:%s: %s", client.host, client.port, exc)
    finally:
        connected_clients.discard(websocket)
        logger.info(
            "WebSocket disconnected: %s:%s  (total=%d)",
            client.host,
            client.port,
            len(connected_clients),
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host=HOST,
        port=PORT,
        reload=False,
        log_level="info",
    )
