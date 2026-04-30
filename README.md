# AquaGuard
> Real-time AI swimmer distress detection — ConHacks 2026

AquaGuard is a live safety system that monitors swimmers via camera, detects early signs of drowning using a multi-layer AI pipeline, and alerts lifeguards instantly through a live dashboard and voice announcements. It combines YOLOv8 pose estimation, ByteTrack multi-object tracking, Gemini Vision AI, and ElevenLabs voice synthesis into a single system designed for real pool environments.

---

## How It Works

```
Camera / Video File
       │
       ▼
YOLOv8-pose (per-frame inference)
       │
       ▼
ByteTrack multi-swimmer tracker ──► Spatial Re-ID (bbox overlap)
       │
       ▼
Distress Scoring Engine (0–100)
  ├── Wrist velocity
  ├── Arms raised above head
  ├── Head vs waterline (dynamic waterline detection)
  ├── Absolute stillness timer (10 s wall-clock)
  ├── Nose keypoint confidence loss (head under water)
  ├── Arm asymmetry
  └── Submersion timer (body disappears from frame)
       │
       ├──► WARNING  (score ≥ 40)  →  Dashboard alert
       │
       └──► DISTRESS (score ≥ 70)  →  Dashboard alert
                                    →  ElevenLabs voice announcement
                                    →  Gemini Vision confirmation
                                    →  Full-screen distress overlay
```

Every 2 seconds, Gemini Vision independently assesses the full scene and provides an `overall_risk` level, a recommended action for the lifeguard, and per-swimmer behavioral observations — all shown live in the right sidebar.

---

## Features

- **YOLOv8-pose + ByteTrack** — multi-swimmer pose estimation and tracking at 20–30 FPS on Apple Silicon (MPS)
- **Spatial re-identification** — if a swimmer briefly submerges and resurfaces, they keep the same ID
- **Dynamic waterline detection** — OpenCV HSV + Hough lines find the water surface each frame; head-position scoring adapts to it instead of using a hardcoded threshold
- **Frame fusion** — scores are computed on the median of the last 5 keypoint frames, eliminating single-frame noise spikes
- **Camera perspective flag** — `CAMERA_PERSPECTIVE = "above"` (normal CCTV) or `"below"` (underwater camera); flips the head-low scoring direction
- **Gemini Vision AI** — scene-level analysis every 2 s + per-event distress confirmation with natural-language observation and recommended action
- **Full-screen distress overlay** — fires when Gemini confirms a DISTRESS event; shows swimmer ID, urgency level, Gemini's observation, and recommended action with 12 s auto-dismiss
- **ElevenLabs voice alerts** — spoken announcement for every DISTRESS event via the multilingual v2 model (macOS `afplay` playback)
- **Live AI analysis panel** — Gemini's risk level, recommended action, and per-swimmer notes update in real time in the right sidebar
- **Video selector** — switch between any video file in `dr/` without restarting the backend
- **Play-once + Replay** — each video plays once and stops; a REPLAY button resets detection state cleanly
- **MJPEG stream + canvas overlay** — bounding boxes, score bars, status chips, and crosshairs rendered on a `<canvas>` over the raw stream
- **WebSocket state machine** — auto-reconnect, per-message-type dispatch, < 100 ms UI latency

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend runtime | Python 3.11 |
| API + WebSocket server | FastAPI + Uvicorn |
| Pose estimation | YOLOv8s-pose (Ultralytics) |
| Multi-object tracking | ByteTrack (built into Ultralytics) |
| Waterline detection | OpenCV HSV + Hough |
| Video capture | OpenCV VideoCapture (threaded) |
| AI scene analysis | Gemini 1.5 Flash (google-genai) |
| Voice alerts | ElevenLabs multilingual v2 |
| Frontend | React 18 + Vite |
| Styling | Inline CSS / CSS-in-JS |
| Containerization | Docker + Docker Compose |

---

## Project Structure

```
AquaGuard_AI/
├── backend/
│   ├── main.py              # FastAPI app — endpoints, WebSocket, broadcast loop
│   ├── detector.py          # YOLOv8-pose + ByteTrack + distress scoring engine
│   ├── waterline.py         # Dynamic water surface detection (HSV + Hough)
│   ├── video.py             # Background capture thread, MJPEG stream, replay
│   ├── alerts.py            # Alert de-duplication, history, ElevenLabs voice
│   ├── gemini.py            # Gemini Vision integration — scene + distress analysis
│   ├── models.py            # Pydantic models + SwimmerState dataclass
│   ├── bytetrack_pool.yaml  # ByteTrack tracker config tuned for pool video
│   ├── requirements.txt     # Python dependencies
│   ├── .env                 # API keys (not committed)
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx                      # Root layout, audio beep, distress overlay
│   │   ├── hooks/
│   │   │   └── useWebSocket.js          # WebSocket hook — reconnect, all message types
│   │   └── components/
│   │       ├── StatBar.jsx              # Top bar — logo, alert counts, clock, source picker
│   │       ├── VideoFeed.jsx            # MJPEG stream + canvas bbox/score overlay + HUD
│   │       ├── SwimmerCard.jsx          # Per-swimmer status card with animated score bar
│   │       ├── AlertPanel.jsx           # Active alerts + resolve button + history
│   │       ├── GeminiPanel.jsx          # Live Gemini risk level + recommended action
│   │       ├── DistressOverlay.jsx      # Full-screen modal on Gemini distress confirmation
│   │       └── VideoSelector.jsx        # Modal to pick a video from dr/
├── dr/                      # Sample pool videos for testing (see below)
│   ├── dr21.mp4
│   ├── dr22.mp4
│   ├── dr23.mp4
│   ├── dr24.mp4
│   ├── dr25.mp4
│   ├── dr26.mp4
│   ├── dr27.mp4
│   ├── dr28.mp4
│   └── dr30.mp4
├── training/                # Custom model training pipeline
│   ├── dataset.yaml         # YOLOv8-pose dataset config
│   ├── extract_frames.py    # Pull frames from dr/ for annotation
│   └── train.py             # Fine-tuning script (Ultralytics)
├── yolov8s-pose.pt          # Base pose model (downloaded automatically)
├── docker-compose.yml
└── README.md
```

---

## Sample Videos — `dr/` folder

The `dr/` directory contains 9 real pool footage clips used for testing and demo purposes. These were the primary videos used to evaluate and tune the detection pipeline during development.

| File | Notes |
|---|---|
| `dr21.mp4` – `dr30.mp4` | Pool footage with varying swimmer counts, lighting, and camera angles |

Load any of them from the **SELECT SOURCE** button in the dashboard. The system plays each video once and shows a **REPLAY** button when it ends — clicking replay fully resets swimmer IDs, scores, and alert history so results are clean on each run.

---

## Distress Scoring

Each swimmer is scored 0–100 every frame, smoothed with an exponential moving average (α = 0.35 new / 0.65 previous) to suppress single-frame noise. Scores are computed on the **median keypoints of the last 5 frames** (frame fusion) to further reduce jitter.

| Signal | Max pts | Trigger |
|---|---|---|
| Wrist velocity | +25 | Rapid vertical wrist movement between frames |
| Arms above head | +20 each | Wrist y-position above nose keypoint |
| Head below waterline | +20–25 | Nose y crosses dynamic waterline (or static 70% threshold) |
| Head under water | +10–30 | Nose keypoint confidence drops while body bbox is still tracked |
| Motionless 5 s | +15 | No significant wrist movement for 5 seconds |
| Motionless 10 s | +40 | No significant movement for 10 seconds (wall-clock, FPS-independent) |
| Body vertical lock | +15 | Nose x-position directly above hip centroid |
| Arm asymmetry | +10 | Left and right wrists differ by > 18% vertically |
| Submersion 3–7 s | score=60 | Swimmer disappears from frame for 3–7 s |
| Submersion > 7 s | score=95 | Swimmer missing from frame for > 7 s → immediate DISTRESS |

**Status thresholds:**

| Score | Status | Response |
|---|---|---|
| 0 – 39 | NORMAL | No action |
| 40 – 69 | WARNING | Dashboard alert |
| 70 – 100 | DISTRESS | Dashboard alert + ElevenLabs voice + Gemini confirmation + full-screen overlay |

---

## Getting Started

> **Requirements:** Python 3.11+, Node.js 20+, free API keys from [Google AI Studio](https://aistudio.google.com/) and [ElevenLabs](https://elevenlabs.io/)

```bash
git clone https://github.com/parsasalama6t/AquaGuard-AI.git
cd AquaGuard-AI
```

**Create `backend/.env`** with your keys:

```env
GEMINI_API_KEY=your_gemini_key_here
ELEVENLABS_API_KEY=your_elevenlabs_key_here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
```

**Install:**

```bash
cd backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt && cd ..
cd frontend && npm install && cd ..
```

**Run (two terminals):**

```bash
# Terminal 1
source backend/venv/bin/activate
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

# Terminal 2
cd frontend && npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)** → click **SELECT SOURCE** → pick any video from `dr/` → press play.

> 9 sample pool videos (`dr21.mp4` – `dr30.mp4`) are already included — no downloads needed.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Full system status including swimmer count, FPS, Gemini state |
| `GET` | `/swimmers` | Current detected swimmers with scores and bounding boxes |
| `GET` | `/alerts` | Full alert history (last 50) |
| `GET` | `/alerts/active` | Currently unresolved alerts |
| `POST` | `/alerts/{id}/resolve` | Resolve an active alert |
| `GET` | `/videos` | List all video files in `dr/` |
| `POST` | `/videos/select` | Switch to a different video source |
| `POST` | `/videos/replay` | Replay current video (resets all detection state) |
| `GET` | `/stream/jpeg` | MJPEG video stream (annotated frames) |
| `WebSocket` | `/ws` | Real-time updates — `frame_update`, `alert`, `distress_confirmed`, `video_ended`, `source_changed` |

---

## WebSocket Message Types

| Type | Direction | Payload |
|---|---|---|
| `frame_update` | server → client | swimmers, fps, frame_count, alerts, gemini scene analysis, waterline |
| `alert` | server → client | swimmer_id, status, score, reason, timestamp |
| `distress_confirmed` | server → client | swimmer_id + Gemini urgency / observation / action |
| `video_ended` | server → client | fired once when a video file reaches its last frame |
| `source_changed` | server → client | fired when video source is switched or replayed |

---

## Training a Custom Model

The `training/` directory contains a ready-to-use pipeline for fine-tuning YOLOv8-pose on your own pool footage.

```bash
# Step 1 — extract frames from dr/ videos for annotation
python training/extract_frames.py --videos dr --out training/data/images/train --every 10

# Step 2 — annotate keypoints in CVAT (https://cvat.ai)
# Export as YOLO-pose format into training/data/labels/train/

# Step 3 — fine-tune
python training/train.py --epochs 50 --device mps

# Step 4 — swap in the new model
cp training/runs/aquaguard-pose/weights/best.pt aquaguard-pose.pt
# Set MODEL_NAME = "aquaguard-pose.pt" in backend/detector.py
```

A model trained on actual pool footage with labelled distress events will significantly outperform the generic YOLOv8s-pose base model, which was trained on COCO person images.

---

## Camera Perspective

AquaGuard supports both above-water and underwater cameras. Set `CAMERA_PERSPECTIVE` in `backend/detector.py`:

```python
CAMERA_PERSPECTIVE = "above"   # normal poolside / overhead CCTV (default)
CAMERA_PERSPECTIVE = "below"   # underwater camera looking up at the surface
```

Waterline detection runs automatically regardless of perspective and refines the head-position score dynamically using the actual water surface position in each frame.

---

## Docker Deployment

```bash
cp backend/.env.example backend/.env
# fill in API keys

docker-compose up --build
```

- Dashboard → [http://localhost:5173](http://localhost:5173)
- API docs → [http://localhost:8000/docs](http://localhost:8000/docs)

---

## Prize Track Integrations

### Gemini API
Two-tier integration: (1) scene-level analysis every 2 seconds — overall risk level, recommended action, and per-swimmer behavioral notes displayed in the live sidebar; (2) per-event distress confirmation — when the pose engine flags DISTRESS, a separate Gemini Vision call analyzes that specific swimmer and fires a `distress_confirmed` WebSocket message that triggers the full-screen overlay with Gemini's natural-language verdict.

### ElevenLabs
Every DISTRESS event generates a spoken alert using ElevenLabs multilingual v2. Audio is synthesized in a background thread and played via macOS `afplay` (or `ffplay` on Linux) so inference is never paused. A 10-second per-swimmer cooldown prevents alert fatigue while ensuring repeated distress is re-announced.

---

## Team

Built at **ConHacks 2026**.

Every second counts when someone is drowning. AquaGuard gives lifeguards an extra set of AI eyes that never blink.

---

## License

MIT
