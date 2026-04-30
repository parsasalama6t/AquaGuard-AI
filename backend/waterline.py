"""
Waterline detection for AquaGuard.

Finds the Y pixel coordinate of the water surface in each frame using a
combination of HSV color masking (pool-blue hues) and Hough horizontal-line
detection. Results are smoothed with an exponential moving average so a single
noisy frame doesn't shift the detected line.

Usage:
    detector = WaterlineDetector()
    y_norm = detector.update(frame)   # normalised 0-1, or None
"""

import cv2
import numpy as np
from typing import Optional


# HSV ranges that capture typical pool water colour (clear water, indoor/outdoor)
_WATER_RANGES = [
    (np.array([85,  30,  50]), np.array([135, 255, 255])),  # cyan-blue
    (np.array([75,  20,  40]), np.array([145, 255, 200])),  # broader fallback
]

# Minimum fraction of a row that must be "water-coloured" to count
_ROW_COVERAGE = 0.20

# EMA smoothing factor (higher = more responsive, lower = more stable)
_ALPHA = 0.15

# How far down from the top of frame to stop looking (waterline is never near
# the very bottom unless the camera is inside the water)
_SEARCH_STOP_FRAC = 0.85


class WaterlineDetector:
    """
    Stateful waterline estimator. Call `update(frame)` every frame.

    Returns a normalised Y coordinate (0 = top, 1 = bottom of frame) or None
    if no waterline can be confidently detected in the current frame.
    """

    def __init__(self) -> None:
        self._smoothed: Optional[float] = None

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def update(self, frame: np.ndarray) -> Optional[float]:
        """
        Process one frame and return the smoothed normalised waterline Y.

        Internally tries two strategies:
          1. HSV colour mask → find topmost row dominated by water colour
          2. Canny + Hough → find the strongest horizontal edge in the upper
             portion of the frame (fallback when pool colour is atypical)
        """
        raw = self._detect_color(frame)
        if raw is None:
            raw = self._detect_edge(frame)

        if raw is not None:
            h = frame.shape[0]
            norm = raw / h
            if self._smoothed is None:
                self._smoothed = norm
            else:
                self._smoothed = _ALPHA * norm + (1 - _ALPHA) * self._smoothed

        return self._smoothed

    @property
    def y_normalised(self) -> Optional[float]:
        return self._smoothed

    # ------------------------------------------------------------------
    # Private strategies
    # ------------------------------------------------------------------

    def _detect_color(self, frame: np.ndarray) -> Optional[int]:
        """Return pixel-row index of the topmost confident waterline via HSV."""
        hsv  = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        h, w = frame.shape[:2]
        stop  = int(h * _SEARCH_STOP_FRAC)

        mask = np.zeros((h, w), dtype=np.uint8)
        for lo, hi in _WATER_RANGES:
            mask |= cv2.inRange(hsv, lo, hi)

        # Smooth noise in the mask
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,
                                np.ones((5, 5), np.uint8))

        # Scan rows top-to-bottom; first row with ≥ _ROW_COVERAGE water pixels
        for y in range(0, stop):
            if mask[y].sum() / 255 >= w * _ROW_COVERAGE:
                return y

        return None

    def _detect_edge(self, frame: np.ndarray) -> Optional[int]:
        """Return pixel-row index via Canny + probabilistic Hough lines."""
        h, w = frame.shape[:2]
        gray  = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blur  = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blur, 50, 150)

        # Only search the upper 85% of the frame
        roi = edges[:int(h * _SEARCH_STOP_FRAC), :]

        lines = cv2.HoughLinesP(
            roi, rho=1, theta=np.pi / 180,
            threshold=80, minLineLength=w // 4, maxLineGap=30
        )
        if lines is None:
            return None

        # Keep only near-horizontal lines (angle < 10°)
        candidates = []
        for x1, y1, x2, y2 in lines[:, 0]:
            angle = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
            if angle < 10:
                candidates.append((y1 + y2) // 2)

        if not candidates:
            return None

        # Return the median Y of all horizontal lines found
        return int(np.median(candidates))
