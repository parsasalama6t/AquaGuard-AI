"""
Fine-tune YOLOv8-pose on the AquaGuard swimming dataset.

Usage:
    python training/train.py [--epochs 50] [--base yolov8s-pose.pt] [--device mps]

The fine-tuned model is saved to training/runs/aquaguard-pose/weights/best.pt.
Copy it to the project root and set MODEL_NAME in backend/detector.py to use it.
"""

import argparse
from pathlib import Path


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--base",    default="yolov8s-pose.pt",
                   help="Starting checkpoint (downloads if not present)")
    p.add_argument("--epochs",  type=int, default=50)
    p.add_argument("--imgsz",   type=int, default=640)
    p.add_argument("--batch",   type=int, default=8)
    p.add_argument("--device",  default="mps",
                   help="mps (Apple Silicon), cuda, or cpu")
    p.add_argument("--workers", type=int, default=4)
    args = p.parse_args()

    dataset_yaml = Path(__file__).parent / "dataset.yaml"
    if not dataset_yaml.exists():
        raise FileNotFoundError(f"dataset.yaml not found at {dataset_yaml}")

    data_root = Path(__file__).parent / "data"
    if not (data_root / "images" / "train").exists():
        print("No training images found.")
        print("Run:  python training/extract_frames.py")
        print("Then annotate with CVAT and export YOLO-pose labels.")
        return

    from ultralytics import YOLO

    model = YOLO(args.base)
    results = model.train(
        data=str(dataset_yaml),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        workers=args.workers,
        project="training/runs",
        name="aquaguard-pose",
        exist_ok=True,
        # Augmentation tuned for pool/water environments
        hsv_h=0.015,    # slight hue shift (water colour variation)
        hsv_s=0.5,      # saturation (lighting changes)
        hsv_v=0.3,      # brightness (indoor/outdoor)
        fliplr=0.5,     # horizontal flip (symmetrical activity)
        mosaic=0.5,     # mosaic (handles partial occlusion)
        degrees=5.0,    # small rotation (camera tilt)
    )

    best = Path("training/runs/aquaguard-pose/weights/best.pt")
    if best.exists():
        print(f"\nTraining complete. Best model: {best.resolve()}")
        print("To use it:")
        print(f"  cp {best} aquaguard-pose.pt")
        print("  # Then in backend/detector.py set MODEL_NAME = 'aquaguard-pose.pt'")
    else:
        print("\nTraining finished but best.pt not found — check training/runs/")


if __name__ == "__main__":
    main()
