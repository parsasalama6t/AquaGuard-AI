"""
Extract labelled frames from dr*.mp4 videos for dataset creation.

Usage:
    python training/extract_frames.py --videos dr/ --out training/data/images/train --every 10

Every Nth frame is saved as a JPEG. After extraction, open the output folder
in CVAT (https://cvat.ai) to annotate keypoints, then export in YOLO-pose format.
"""

import argparse
import os
from pathlib import Path

import cv2


def extract(video_path: Path, out_dir: Path, every: int = 10) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video_path))
    stem = video_path.stem
    saved = 0
    frame_idx = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_idx % every == 0:
            name = f"{stem}_f{frame_idx:06d}.jpg"
            cv2.imwrite(str(out_dir / name), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            saved += 1
        frame_idx += 1

    cap.release()
    return saved


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--videos", default="dr", help="Directory containing dr*.mp4 files")
    p.add_argument("--out",    default="training/data/images/train")
    p.add_argument("--every",  type=int, default=10, help="Save every Nth frame")
    args = p.parse_args()

    videos_dir = Path(args.videos)
    out_dir    = Path(args.out)
    total = 0

    for mp4 in sorted(videos_dir.glob("*.mp4")):
        n = extract(mp4, out_dir, args.every)
        print(f"  {mp4.name}: {n} frames")
        total += n

    print(f"\nTotal frames extracted: {total}")
    print(f"Output: {out_dir.resolve()}")
    print("\nNext: open CVAT at https://cvat.ai, create a project with YOLO-pose")
    print("format, upload these images, annotate keypoints, then export labels.")


if __name__ == "__main__":
    main()
