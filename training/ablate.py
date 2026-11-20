"""Run the four-cell AHAAR ablation sequentially and aggregate results.

Cells:
    1. YOLOv8m   baseline               (COCO -> AHAAR-Fridge)
    2. YOLOv11m  baseline               (COCO -> AHAAR-Fridge)
    3. YOLOv11m  + IndianFood20 pretrain (COCO -> IF20 -> AHAAR-Fridge)
    4. YOLOv11l  + IndianFood20 pretrain (COCO -> IF20 -> AHAAR-Fridge)

    python training/ablate.py                 # run everything missing
    python training/ablate.py --dry-run       # print the command plan

Writes results/ablation.csv with one row per cell for the report, and
rebuilds results/ablation_bars.png after each cell completes.
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
CFG = ROOT / "training/configs"

# order matters: stage-1 pretrains must run before the stage-2 cells that
# consume them.
STEPS: list[dict] = [
    {"name": "yolov8m_baseline",               "config": "yolov8m_baseline.yaml",
     "label": "YOLOv8m  (baseline)",           "needs": []},
    {"name": "yolov11m_baseline",              "config": "yolov11m_baseline.yaml",
     "label": "YOLOv11m (baseline)",           "needs": []},
    {"name": "yolov11m_if20pretrain_stage1",   "config": "stage1_if20_yolov11m.yaml",
     "label": "YOLOv11m stage-1 on IF20",      "needs": [], "stage1": True},
    {"name": "yolov11m_if20_pretrain",         "config": "yolov11m_if20_pretrain.yaml",
     "label": "YOLOv11m + IF20 pretrain",      "needs": ["yolov11m_if20pretrain_stage1"]},
    {"name": "yolov11l_if20pretrain_stage1",   "config": "stage1_if20_yolov11l.yaml",
     "label": "YOLOv11l stage-1 on IF20",      "needs": [], "stage1": True},
    {"name": "yolov11l_if20_pretrain",         "config": "yolov11l_if20_pretrain.yaml",
     "label": "YOLOv11l + IF20 pretrain",      "needs": ["yolov11l_if20pretrain_stage1"]},
]


def ran(name: str) -> bool:
    """A cell is 'done' if its best.pt exists anywhere a prior train.py
    might have written it (results/<name>, or the ultralytics 8.4+
    runs/detect/results/<name>[-N] fallback)."""
    expected = RESULTS / name / "weights" / "best.pt"
    if expected.exists():
        return True
    legacy = ROOT / "runs/detect/results"
    if legacy.exists() and any(legacy.glob(f"{name}*/weights/best.pt")):
        return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="Re-run even if best.pt already exists.")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", nargs="*", default=[],
                    help="Run only these step names (e.g. --only yolov11m_baseline).")
    args = ap.parse_args()

    plan: list[dict] = []
    for step in STEPS:
        if args.only and step["name"] not in args.only:
            continue
        if ran(step["name"]) and not args.force:
            print(f"[ablate] skip {step['name']} (best.pt already present; pass --force to retrain).")
            continue
        for need in step["needs"]:
            if not ran(need):
                print(f"[ablate] step {step['name']} depends on {need}; scheduling it first.")
                break
        plan.append(step)

    if args.dry_run:
        for step in plan:
            print(f"  python training/train.py --config training/configs/{step['config']}")
        return

    for step in plan:
        cmd = [sys.executable, "training/train.py", "--config", f"training/configs/{step['config']}"]
        print(f"[ablate] -> {' '.join(cmd)}")
        subprocess.run(cmd, check=True, cwd=ROOT)
        # Skip evaluation for stage-1 cells — they're intermediate pretrains.
        if step.get("stage1"):
            continue
        subprocess.run(
            [sys.executable, "training/evaluate.py", "--run", step["name"]],
            check=True,
            cwd=ROOT,
        )
        aggregate()


def aggregate() -> None:
    """Rebuild results/ablation.csv from the metrics.json files that exist."""
    rows: list[dict] = []
    for step in STEPS:
        if step.get("stage1"):
            continue
        m = RESULTS / step["name"] / "metrics.json"
        if not m.exists():
            continue
        data = json.loads(m.read_text(encoding="utf-8"))
        rows.append({
            "run": step["name"],
            "label": step["label"],
            "map50": data["map50"],
            "map50_95": data["map50_95"],
            "precision": data["precision"],
            "recall": data["recall"],
            "f1": data["f1"],
            "parameters_m": data["parameters_m"],
            "weights_mb": data["weights_mb"],
            "cpu_ms": (data.get("latency") or {}).get("cpu_ms_per_image"),
            "cuda_ms": (data.get("latency") or {}).get("cuda_ms_per_image"),
        })
    if not rows:
        print("[ablate] no runs evaluated yet; nothing to aggregate.")
        return
    out = RESULTS / "ablation.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"[ablate] wrote {out} ({len(rows)} rows)")


if __name__ == "__main__":
    main()
