"""
Core AI detection engine for AquaGuard.

Multi-person swimmer detection via YOLOv8-pose + ByteTrack.

Key behaviours:
  - Face-gate: a track must show a clear face (NOSE conf ≥ 0.40) before
    it is counted as a swimmer.  Eliminates false positives.
  - Extended track buffer (150 frames ≈ 12 s): the same swimmer ID
    survives brief submersion without spawning a new ID on resurface.
  - Spatial re-ID: if the buffer still expires, the reappearing body is
    matched by bounding-box overlap to the lost swimmer and reuses the
    original ID — so "1 swimmer bobbing" always shows as 1 swimmer.
  - Submersion alarm: if a confirmed swimmer is unseen for >3 s → WARNING,
    >7 s → DISTRESS (score 95).
"""

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np

from backend.models import Alert, SwimmerState, SwimmerStatus
from backend.waterline import WaterlineDetector

# ---------------------------------------------------------------------------
# Model & tracker
# ---------------------------------------------------------------------------

MODEL_NAME   = "yolov8s-pose.pt"
DETECT_CONF  = 0.38
DETECT_IOU   = 0.45
DEVICE       = "mps"   # Apple Silicon; falls back to cpu

# Custom tracker config — lives next to this file
_TRACKER_CFG = str(Path(__file__).parent / "bytetrack_pool.yaml")

# ---------------------------------------------------------------------------
# Face-gate
# ---------------------------------------------------------------------------

FACE_CONF_MIN          = 0.35
MAX_UNCONFIRMED_FRAMES = 25

# ---------------------------------------------------------------------------
# Spatial re-identification (fallback when tracker buffer expires)
# ---------------------------------------------------------------------------

REID_IOU_MIN = 0.20   # min bbox overlap to merge a new track into a lost swimmer

# ---------------------------------------------------------------------------
# Submersion alarm
# ---------------------------------------------------------------------------

MIN_TRACK_FRAMES = 25
SUBMERGE_WARN_S  = 3.0
SUBMERGE_ALERT_S = 7.0
SUBMERGE_CLEAR_S = 25.0

# ---------------------------------------------------------------------------
# Pose distress scoring
# ---------------------------------------------------------------------------

WRIST_DELTA_THRESH    = 0.035
STILLNESS_STD_THRESH  = 0.004
HEAD_LOW_THRESH       = 0.70
ARM_ASYM_THRESH       = 0.18
DISTRESS_WARN_THRESHOLD  = 40
DISTRESS_ALERT_THRESHOLD = 70

# Time-based stillness: absolute wall-clock timeout regardless of FPS
STILLNESS_TIMEOUT_S  = 10.0   # seconds of no motion → strong distress signal
STILLNESS_WARN_S     = 5.0    # seconds → early warning signal

# Head submersion: how long nose must be absent while body bbox is visible
HEAD_SUBMERGED_MIN_S = 2.0

# Camera perspective — affects direction of head-low check
# "above": normal poolside camera (head sinking = nose_y increases)
# "below": underwater camera looking up (head sinking = nose_y decreases)
CAMERA_PERSPECTIVE = "above"

# ---------------------------------------------------------------------------
# YOLOv8 COCO keypoint indices
# ---------------------------------------------------------------------------

NOSE                   = 0
L_SHOULDER, R_SHOULDER = 5,  6
L_ELBOW,    R_ELBOW    = 7,  8
L_WRIST,    R_WRIST    = 9,  10
L_HIP,      R_HIP      = 11, 12
L_KNEE,     R_KNEE     = 13, 14
L_ANKLE,    R_ANKLE    = 15, 16

_BGR = {
    SwimmerStatus.NORMAL:   (0, 200, 80),
    SwimmerStatus.WARNING:  (0, 140, 255),
    SwimmerStatus.DISTRESS: (0, 0, 220),
}
_KP_CONF_MIN = 0.30


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@dataclass
class _LostTrack:
    swimmer_id: int
    last_seen:  float
    last_bbox:  Optional[tuple]
    last_score: float
    warned:     bool = False
    alerted:    bool = False


def _bbox_iou(a: tuple, b: tuple) -> float:
    """Intersection-over-union for two (x1,y1,x2,y2) boxes."""
    ix1 = max(a[0], b[0]); iy1 = max(a[1], b[1])
    ix2 = min(a[2], b[2]); iy2 = min(a[3], b[3])
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter + 1e-6)


_clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))

def _enhance(frame: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = _clahe.apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------

class SwimmerDetector:

    def __init__(self, show_skeleton: bool = True) -> None:
        self.show_skeleton = show_skeleton
        self._tracks:  dict[int, SwimmerState] = {}   # all YOLO tracks
        self.swimmers: dict[int, SwimmerState] = {}   # face-confirmed only
        self._lost:    dict[int, _LostTrack]   = {}   # confirmed + gone missing

        self.on_alert:    Optional[Callable[[Alert], None]] = None
        self.frame_count: int = 0
        self._waterline   = WaterlineDetector()

        import torch
        from ultralytics import YOLO

        device = DEVICE if torch.backends.mps.is_available() else "cpu"
        self._model  = YOLO(MODEL_NAME)
        self._device = device

        _d = np.zeros((320, 320, 3), dtype=np.uint8)
        self._model.predict(_d, verbose=False, imgsz=320, device=device)

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def process_frame(self, frame: np.ndarray) -> tuple[np.ndarray, list[Alert]]:
        self.frame_count += 1
        alerts: list[Alert] = []
        h, w = frame.shape[:2]

        # Update waterline every 5 frames (cheap, no need to run every frame)
        if self.frame_count % 5 == 0:
            self._waterline.update(frame)

        inp = _enhance(frame) if self.frame_count % 2 == 0 else frame

        results = self._model.track(
            inp,
            persist=True,
            conf=DETECT_CONF,
            iou=DETECT_IOU,
            classes=[0],
            verbose=False,
            imgsz=640,
            device=self._device,
            tracker=_TRACKER_CFG,
        )

        active_ids: set[int] = set()

        if results and results[0].keypoints is not None:
            res    = results[0]
            boxes  = res.boxes
            kpts   = res.keypoints.xy.cpu().numpy()
            kconfs = (
                res.keypoints.conf.cpu().numpy()
                if res.keypoints.conf is not None
                else np.ones((len(boxes), 17), dtype=np.float32)
            )
            track_ids = (
                boxes.id.cpu().numpy().astype(int)
                if boxes.id is not None
                else np.arange(len(boxes))
            )
            bboxes = boxes.xyxy.cpu().numpy()

            for sid, bbox, kp, kc in zip(
                track_ids, bboxes, kpts, kconfs
            ):
                sid  = int(sid)
                bbox_t = tuple(map(int, bbox))

                # ── Spatial re-ID ─────────────────────────────────────
                # If this is a brand-new track AND a lost swimmer's last
                # bbox overlaps significantly, redirect to that swimmer's ID.
                if sid not in self._tracks:
                    lost_match = self._find_lost_by_overlap(bbox_t)
                    if lost_match is not None:
                        # Reuse the old swimmer's state under the new YOLO id
                        old_state = self._tracks.get(lost_match) or self.swimmers.get(lost_match)
                        if old_state is not None:
                            old_state.swimmer_id = lost_match   # keep original id
                            self._tracks[sid]    = old_state
                            # Clean up the old key references
                            self._tracks.pop(lost_match, None)
                            self.swimmers.pop(lost_match, None)
                            self._lost.pop(lost_match, None)
                            self.swimmers[sid] = old_state

                active_ids.add(sid)

                # Clear from lost buffer if swimmer reappears with same ID
                if sid in self._lost:
                    del self._lost[sid]

                kp_norm = kp.copy().astype(np.float32)
                kp_norm[:, 0] /= w
                kp_norm[:, 1] /= h

                track = self._tracks.setdefault(sid, SwimmerState(swimmer_id=sid))
                track.last_seen       = time.time()
                track.frames_tracked += 1
                track.bbox            = bbox_t

                # ── Person gate ────────────────────────────────────────
                # Confirm via nose OR both shoulders — catches children
                # whose faces are frequently underwater or occluded.
                if not track.face_confirmed:
                    nose_ok = kc[NOSE] >= FACE_CONF_MIN
                    shoulders_ok = (
                        kc[L_SHOULDER] >= FACE_CONF_MIN and
                        kc[R_SHOULDER] >= FACE_CONF_MIN
                    )
                    if nose_ok or shoulders_ok:
                        track.face_confirmed = True
                        self.swimmers[sid]   = track

                if not track.face_confirmed:
                    if track.frames_tracked > MAX_UNCONFIRMED_FRAMES:
                        self._tracks.pop(sid, None)
                    continue

                self.swimmers[sid] = track

                alert = self._update_pose_state(track, kp_norm, kc)
                if alert:
                    alerts.append(alert)
                    if self.on_alert:
                        self.on_alert(alert)

        # ── Submersion tracking ────────────────────────────────────────
        now = time.time()

        for sid, state in list(self._tracks.items()):
            if sid in active_ids or not state.face_confirmed:
                continue
            if state.frames_tracked < MIN_TRACK_FRAMES:
                continue
            if sid not in self._lost:
                self._lost[sid] = _LostTrack(
                    swimmer_id=sid,
                    last_seen=state.last_seen,
                    last_bbox=state.bbox,
                    last_score=state.distress_score,
                )

        for sid, lost in list(self._lost.items()):
            submerged_s = now - lost.last_seen
            state       = self.swimmers.get(sid)

            if submerged_s > SUBMERGE_CLEAR_S:
                self._lost.pop(sid, None)
                self._tracks.pop(sid, None)
                self.swimmers.pop(sid, None)
                continue

            if submerged_s > SUBMERGE_ALERT_S and not lost.alerted:
                lost.alerted = True
                score  = 95.0
                reason = f"Swimmer submerged {submerged_s:.0f}s — POSSIBLE DROWNING"
                alert  = Alert(swimmer_id=sid, status=SwimmerStatus.DISTRESS,
                               score=score, reason=reason)
                alerts.append(alert)
                if self.on_alert:
                    self.on_alert(alert)
                if state:
                    state.distress_score = score
                    state.status         = SwimmerStatus.DISTRESS

            elif SUBMERGE_WARN_S < submerged_s <= SUBMERGE_ALERT_S and not lost.warned:
                lost.warned = True
                score  = 60.0
                reason = f"Swimmer submerged {submerged_s:.0f}s — monitor closely"
                alert  = Alert(swimmer_id=sid, status=SwimmerStatus.WARNING,
                               score=score, reason=reason)
                alerts.append(alert)
                if self.on_alert:
                    self.on_alert(alert)
                if state:
                    state.distress_score = score
                    state.status         = SwimmerStatus.WARNING

        # Prune self.swimmers: keep only active tracks + swimmers still in lost buffer
        for sid in list(self.swimmers):
            if sid not in active_ids and sid not in self._lost:
                del self.swimmers[sid]

        # Deduplicate: if two confirmed swimmers overlap heavily, drop the newer ID
        confirmed = [
            (sid, s) for sid, s in self.swimmers.items()
            if s.bbox is not None and s.face_confirmed
        ]
        confirmed.sort(key=lambda x: x[0])   # lowest ID = original, keep it
        to_drop: set[int] = set()
        for i, (sid_a, st_a) in enumerate(confirmed):
            if sid_a in to_drop:
                continue
            for sid_b, st_b in confirmed[i + 1:]:
                if sid_b in to_drop:
                    continue
                if _bbox_iou(st_a.bbox, st_b.bbox) > 0.30:
                    to_drop.add(sid_b)
        for sid in to_drop:
            self.swimmers.pop(sid, None)
            self._tracks.pop(sid, None)
            self._lost.pop(sid, None)

        return self._draw_overlays(frame.copy()), alerts

    # ------------------------------------------------------------------
    # Spatial re-ID helper
    # ------------------------------------------------------------------

    def _find_lost_by_overlap(self, bbox: tuple) -> Optional[int]:
        """Return the lost swimmer ID whose last bbox best overlaps this bbox."""
        best_iou = REID_IOU_MIN
        best_sid = None
        for sid, lost in self._lost.items():
            if lost.last_bbox is None:
                continue
            iou = _bbox_iou(bbox, lost.last_bbox)
            if iou > best_iou:
                best_iou = iou
                best_sid = sid
        return best_sid

    # ------------------------------------------------------------------
    # Pose scoring
    # ------------------------------------------------------------------

    def _update_pose_state(
        self, state: SwimmerState, kp: np.ndarray, kc: np.ndarray
    ) -> Optional[Alert]:
        def ky(idx: int, default: float = 0.5) -> float:
            return float(kp[idx, 1]) if kc[idx] >= _KP_CONF_MIN else default

        state.wrist_y_history.append((ky(L_WRIST) + ky(R_WRIST)) / 2.0)
        state.hip_y_history.append(  (ky(L_HIP)   + ky(R_HIP))   / 2.0)
        state.nose_y_history.append(ky(NOSE))

        motion = (
            abs(state.wrist_y_history[-1] - state.wrist_y_history[-2])
            if len(state.wrist_y_history) >= 2 else 0.0
        )
        state.movement_history.append(motion)

        # ── Update last_motion_time when meaningful body movement is detected ──
        recent = list(state.movement_history)[-20:]
        if len(recent) >= 2 and (motion > WRIST_DELTA_THRESH or np.std(recent) > STILLNESS_STD_THRESH * 2):
            state.last_motion_time = time.time()

        # ── Track nose confidence loss (head going under water) ──
        nose_visible = kc[NOSE] >= FACE_CONF_MIN
        if nose_visible:
            state.nose_lost_time = None          # nose is back, reset timer
        elif state.nose_lost_time is None and state.face_confirmed:
            state.nose_lost_time = time.time()   # nose just disappeared

        # ── Frame fusion: accumulate keypoint buffer, score on median ─────
        state.kp_buffer.append(kp.copy())
        state.kc_buffer.append(kc.copy())
        if len(state.kp_buffer) >= 3:
            fused_kp = np.median(np.stack(state.kp_buffer), axis=0)
            fused_kc = np.median(np.stack(state.kc_buffer), axis=0)
        else:
            fused_kp, fused_kc = kp, kc

        raw = self._compute_score(state, fused_kp, fused_kc)
        state.distress_score = float(np.clip(
            0.35 * raw + 0.65 * state.distress_score, 0.0, 100.0
        ))

        score = state.distress_score
        new_status = (
            SwimmerStatus.DISTRESS if score >= DISTRESS_ALERT_THRESHOLD else
            SwimmerStatus.WARNING  if score >= DISTRESS_WARN_THRESHOLD  else
            SwimmerStatus.NORMAL
        )

        alert: Optional[Alert] = None
        if new_status != state.status:
            alert = Alert(
                swimmer_id=state.swimmer_id,
                status=new_status,
                score=round(score, 1),
                reason=_reason_for(new_status, score, state),
                lane=state.lane,
            )
        state.status = new_status
        return alert

    def _compute_score(
        self, state: SwimmerState, kp: np.ndarray, kc: np.ndarray
    ) -> float:
        score = 0.0
        now = time.time()
        ok = lambda idx: kc[idx] >= _KP_CONF_MIN

        # Use detected waterline if available; fall back to static threshold
        waterline = self._waterline.y_normalised

        # ── Wrist vertical surge (thrashing signal) ───────────────────────── #
        if len(state.wrist_y_history) >= 2:
            if abs(state.wrist_y_history[-1] - state.wrist_y_history[-2]) > WRIST_DELTA_THRESH:
                score += 25.0

        # ── Arms raised above head (reaching signal) ──────────────────────── #
        if ok(NOSE):
            nose_y = kp[NOSE, 1]
            if ok(L_WRIST) and kp[L_WRIST, 1] < nose_y:
                score += 20.0
            if ok(R_WRIST) and kp[R_WRIST, 1] < nose_y:
                score += 20.0

        # ── Head position vs waterline (camera-perspective-aware) ────────── #
        if ok(NOSE):
            nose_y = kp[NOSE, 1]
            if CAMERA_PERSPECTIVE == "above":
                # Waterline gives a precise threshold; if unavailable, use static
                thresh = waterline if waterline is not None else HEAD_LOW_THRESH
                if nose_y > thresh:
                    # More points when below a confirmed waterline vs static guess
                    score += 25.0 if waterline is not None else 20.0
            else:
                thresh = (1.0 - waterline) if waterline is not None else (1.0 - HEAD_LOW_THRESH)
                if nose_y < thresh:
                    score += 25.0 if waterline is not None else 20.0

        # ── Body vertical alignment (horizontal lock = not swimming) ─────── #
        if ok(NOSE) and ok(L_HIP) and ok(R_HIP):
            hip_cx = (kp[L_HIP, 0] + kp[R_HIP, 0]) / 2.0
            if abs(kp[NOSE, 0] - hip_cx) < 0.06:
                score += 15.0

        # ── Absolute stillness timer (10 s — camera and FPS agnostic) ─────── #
        motionless_s = now - state.last_motion_time
        if motionless_s > STILLNESS_TIMEOUT_S:
            score += 40.0   # 10+ seconds of no movement — very strong signal
        elif motionless_s > STILLNESS_WARN_S:
            score += 15.0   # 5–10 s without motion — early warning

        # ── Head under water: nose keypoint absent while body is tracked ──── #
        if state.nose_lost_time is not None:
            submerged_s = now - state.nose_lost_time
            if submerged_s > HEAD_SUBMERGED_MIN_S:
                # Nose invisible for >2 s while body bbox still visible = head under
                score += min(30.0, 10.0 + submerged_s * 4.0)  # grows with time, cap 30

        # ── Arm asymmetry (limp / uncontrolled) ──────────────────────────── #
        if ok(L_WRIST) and ok(R_WRIST):
            if abs(kp[L_WRIST, 1] - kp[R_WRIST, 1]) > ARM_ASYM_THRESH:
                score += 10.0

        return score

    # ------------------------------------------------------------------
    # Drawing
    # ------------------------------------------------------------------

    def _draw_overlays(self, frame: np.ndarray) -> np.ndarray:
        now = time.time()
        for sid, state in self.swimmers.items():
            if not state.face_confirmed:
                continue
            color = _BGR[state.status]
            bbox  = state.bbox
            if bbox is None and sid in self._lost:
                bbox = self._lost[sid].last_bbox
            if bbox is None:
                continue

            x1, y1, x2, y2 = bbox
            thick = 3 if state.status == SwimmerStatus.DISTRESS else 2
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, thick)

            sub_tag = ""
            if sid in self._lost:
                sub_s   = now - self._lost[sid].last_seen
                sub_tag = f"  SUBMERGED {sub_s:.0f}s"

            label = f"S{sid} | {state.status.value.upper()}  {state.distress_score:.0f}{sub_tag}"
            font, fs, ft = cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2
            (lw, lh), base = cv2.getTextSize(label, font, fs, ft)
            ly = max(y1 - 8, lh + base)
            cv2.rectangle(frame, (x1, ly - lh - base), (x1 + lw + 6, ly + base), color, cv2.FILLED)
            cv2.putText(frame, label, (x1 + 3, ly), font, fs, (255, 255, 255), ft, cv2.LINE_AA)

            if state.status == SwimmerStatus.DISTRESS:
                overlay = frame.copy()
                cv2.rectangle(overlay, (x1, y1), (x2, y2), (0, 0, 255), 6)
                cv2.addWeighted(overlay, 0.38, frame, 0.62, 0, frame)

        return frame

    # ------------------------------------------------------------------

    def close(self) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def _reason_for(status: SwimmerStatus, score: float, state: Optional["SwimmerState"] = None) -> str:
    reasons = []
    now = time.time()
    if state:
        motionless_s = now - state.last_motion_time
        if motionless_s > STILLNESS_TIMEOUT_S:
            reasons.append(f"motionless {motionless_s:.0f}s")
        if state.nose_lost_time is not None:
            sub_s = now - state.nose_lost_time
            if sub_s > HEAD_SUBMERGED_MIN_S:
                reasons.append(f"head submerged {sub_s:.0f}s")
    suffix = f" — {', '.join(reasons)}" if reasons else ""
    if status == SwimmerStatus.DISTRESS:
        return f"Distress signals detected (score {score:.0f}/100){suffix}"
    if status == SwimmerStatus.WARNING:
        return f"Abnormal movement pattern (score {score:.0f}/100){suffix}"
    return "Swimmer appears normal"
