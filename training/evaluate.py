"""Evaluate a trained YOLO checkpoint and emit paper-ready metrics.

    python training/evaluate.py --run yolov11m_baseline

Writes:
    results/<run>/metrics.json   — mAP@50, mAP@50-95, overall P, R, F1,
                                   per-class rows, latency (CPU & CUDA),
                                   model size (MB) and parameter count.
    results/<run>/per_class.csv  — one row per class for easy citation.

Metrics follow the ultralytics `val()` convention; latency is measured
over 100 warm-up + 300 timed runs on a 640x640 zero tensor.
"""
from __future__ import annotations

import argparse
import csv
import json
import statistics
import sys
import time
from pathlib import Path

try:
    import numpy as np
    import torch
    from ultralytics import YOLO
    import yaml
except ImportError as e:  # pragma: no cover
    print(f"[evaluate.py] missing dependency: {e}", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"


def load_data_yaml(data_path: str) -> dict:
    with (ROOT / data_path).open(encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def measure_latency(model: YOLO, device: str, warm: int = 100, iters: int = 300) -> float:
    """Return median ms/image for a 640x640 random input on the given device."""
    arr = np.zeros((640, 640, 3), dtype=np.uint8)
    for _ in range(warm):
        model.predict(arr, verbose=False, device=device)
    times: list[float] = []
    for _ in range(iters):
        t0 = time.perf_counter()
        model.predict(arr, verbose=False, device=device)
        times.append((time.perf_counter() - t0) * 1000)
    return float(statistics.median(times))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True,
                    help="Run name, e.g. 'yolov11m_baseline' — matches the ultralytics project dir.")
    ap.add_argument("--weights", type=Path, default=None,
                    help="Optional explicit weights path. Defaults to results/<run>/weights/best.pt.")
    ap.add_argument("--data", type=Path, default=None,
                    help="YOLO data yaml the eval runs against. Defaults to whatever the model was trained on (read from the run's args.yaml).")
    ap.add_argument("--no-latency", action="store_true",
                    help="Skip latency measurement (useful on CI without GPU).")
    args = ap.parse_args()

    run_dir = RESULTS / args.run
    weights = args.weights or (run_dir / "weights/best.pt")
    # Resolve relative --weights (e.g. "runs/detect/results/...") so every
    # downstream path manipulation works, and so metrics.json lands next
    # to the actual weights file.
    if weights:
        weights = weights.resolve()
    if args.weights is not None:
        run_dir = weights.parent.parent
    if not weights.exists() and args.weights is None:
        # Weights can land in two off-path locations:
        #   1. ultralytics renames collisions as <name>2, <name>3, ...
        #   2. ultralytics 8.4+ prepends "runs/detect/" to a relative project
        # Hunt under both roots for the newest matching best.pt and fall back
        # to it, so users don't have to pass --weights manually.
        search_roots = [RESULTS, ROOT / "runs/detect/results"]
        candidates: list[Path] = []
        for root in search_roots:
            if root.exists():
                candidates.extend(root.glob(f"{args.run}*/weights/best.pt"))
        candidates.sort(key=lambda p: p.stat().st_mtime)
        if candidates:
            weights = candidates[-1]
            run_dir = weights.parent.parent
            print(f"[evaluate.py] note: expected best.pt at {RESULTS / args.run}/weights/best.pt")
            print(f"[evaluate.py] falling back to newest matching run: {weights}")
    if not weights.exists():
        raise SystemExit(f"[evaluate.py] weights not found: {weights}")

    # Auto-pick --data from the training args.yaml ultralytics writes next
    # to the weights, so eval always runs against the SAME dataset the
    # model was trained on. This avoids the 0.0-mAP gotcha where the
    # default fridge data config doesn't match an IF20-trained model.
    data_path: Path | None = args.data
    if data_path is None:
        args_yaml = run_dir / "args.yaml"
        if args_yaml.exists():
            with args_yaml.open(encoding="utf-8") as fh:
                targs = yaml.safe_load(fh) or {}
            d = targs.get("data")
            if d:
                dp = Path(d)
                data_path = dp if dp.is_absolute() else (ROOT / dp).resolve()
                print(f"[evaluate.py] data auto-detected from {args_yaml.name}: {data_path}")
        if data_path is None:
            data_path = ROOT / "datasets/ahaar-fridge.yaml"
            print(f"[evaluate.py] no training args.yaml found; falling back to {data_path}")
    if not data_path.exists():
        raise SystemExit(f"[evaluate.py] data yaml not found: {data_path}")

    model = YOLO(str(weights))
    val = model.val(data=str(data_path), split="val", verbose=False, plots=True)

    # Ultralytics stores per-class results on `val.box`.
    names = model.names if isinstance(model.names, dict) else {i: n for i, n in enumerate(model.names)}
    box = val.box  # object with maps_per_class attribute
    per_class = []
    for cls_id, cls_name in sorted(names.items()):
        try:
            idx = list(box.ap_class_index).index(cls_id)
        except ValueError:
            per_class.append({
                "class_id": int(cls_id), "name": cls_name,
                "precision": 0.0, "recall": 0.0, "map50": 0.0, "map50_95": 0.0, "support": 0,
            })
            continue
        per_class.append({
            "class_id": int(cls_id),
            "name": cls_name,
            "precision": round(float(box.p[idx]), 4),
            "recall":    round(float(box.r[idx]), 4),
            "map50":     round(float(box.ap50[idx]), 4),
            "map50_95":  round(float(box.ap[idx]), 4),
            "support":   int(box.nt_per_class[idx]) if hasattr(box, "nt_per_class") else 0,
        })

    params = sum(p.numel() for p in model.model.parameters())
    size_mb = weights.stat().st_size / (1024 * 1024)

    latency = {"cpu_ms_per_image": None, "cuda_ms_per_image": None}
    if not args.no_latency:
        latency["cpu_ms_per_image"] = round(measure_latency(model, "cpu"), 2)
        if torch.cuda.is_available():
            latency["cuda_ms_per_image"] = round(measure_latency(model, "cuda:0"), 2)

    # Record paths relative to ROOT when they're inside it; otherwise as-is.
    def _rel(p: Path) -> str:
        p = p.resolve()
        try:
            return str(p.relative_to(ROOT))
        except ValueError:
            return str(p)

    metrics = {
        "run": args.run,
        "weights": _rel(weights),
        "data": _rel(data_path),
        "map50": round(float(box.map50), 4),
        "map50_95": round(float(box.map), 4),
        "precision": round(float(box.mp), 4),
        "recall": round(float(box.mr), 4),
        "f1": round(2 * float(box.mp) * float(box.mr) / max(1e-9, float(box.mp) + float(box.mr)), 4),
        "per_class": per_class,
        "parameters_m": round(params / 1_000_000, 2),
        "weights_mb": round(size_mb, 2),
        "latency": latency,
    }

    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    with (run_dir / "per_class.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(per_class[0].keys()))
        w.writeheader()
        w.writerows(per_class)

    print(f"[evaluate.py] {args.run}: mAP50={metrics['map50']}  mAP50-95={metrics['map50_95']}"
          f"  P={metrics['precision']}  R={metrics['recall']}  F1={metrics['f1']}")
    print(f"[evaluate.py] wrote {run_dir / 'metrics.json'}")


if __name__ == "__main__":
    main()
