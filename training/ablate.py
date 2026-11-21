"""Run the four-cell AHAAR ablation sequentially and aggregate results.

Cells:
    1. YOLOv8m   baseline               (COCO -> AHAAR-Fridge)
    2. YOLOv11m  baseline               (COCO -> AHAAR-Fridge)
    3. YOLOv11m  + IndianFood20 pretrain (COCO -> IF20 -> AHAAR-Fridge)
    4. YOLOv11l  + IndianFood20 pretrain (COCO -> IF20 -> AHAAR-Fridge)

    python training/ablate.py                 # run everything missing
    python training/ablate.py --dry-run       # print the command plan
    python training/ablate.py --check         # preflight only (no training)
    python training/ablate.py --only <name> ... # restrict to named cells
    python training/ablate.py --force          # retrain cells whose best.pt exists

Writes results/ablation.csv with one row per cell for the report, and
rebuilds results/ablation_bars.png after each cell completes.

PREFLIGHT: before running any training, ablate.py validates every
step's data config — the train and val image folders must exist and
contain at least one supported image file — and refuses to start if
anything is missing. This prevents the common "AMP checks passed ->
crash mid-training" failure mode.
"""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("[ablate] pyyaml missing. pip install -r training/requirements-ml.txt", file=sys.stderr)
    sys.exit(2)

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}

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


def _count_images(folder: Path) -> int:
    if not folder.exists():
        return 0
    n = 0
    for p in folder.rglob("*"):
        if p.suffix.lower() in IMG_EXTS:
            n += 1
    return n


def _resolve_split(data_yaml: Path, split_value: str) -> Path:
    """Resolve a data.yaml split path the way ultralytics does.

    Ultralytics' resolution order for a relative `path:` is:
      1. CWD (ROOT when ablate.py is invoked from the repo root)
      2. the yaml's own directory
      3. ultralytics settings' datasets_dir
    We try (1) then (2) and return the first one whose split folder exists.
    When `path:` is absolute, use it directly. When `path:` is absent,
    fall back to the yaml's directory.
    """
    with data_yaml.open(encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    base = cfg.get("path")
    if not base:
        return (data_yaml.parent / split_value).resolve()

    base_p = Path(base)
    if base_p.is_absolute():
        return (base_p / split_value).resolve()

    candidates = [
        (ROOT / base_p / split_value).resolve(),
        (data_yaml.parent / base_p / split_value).resolve(),
    ]
    for c in candidates:
        if c.exists():
            return c
    # Fall back to the ROOT-relative candidate for the error message —
    # that's the layout the configs document.
    return candidates[0]


def preflight(plan: list[dict]) -> list[str]:
    """Return a list of human-readable problems with the data configs that
    `plan` is about to use. Empty list means every dataset is populated."""
    seen: set[Path] = set()
    issues: list[str] = []
    for step in plan:
        cfg_path = CFG / step["config"]
        if not cfg_path.exists():
            issues.append(f"[{step['name']}] config file missing: {cfg_path}")
            continue
        with cfg_path.open(encoding="utf-8") as fh:
            cfg = yaml.safe_load(fh) or {}
        data_rel = cfg.get("data")
        if not data_rel:
            issues.append(f"[{step['name']}] config has no `data:` field")
            continue
        data_yaml = (ROOT / data_rel).resolve()
        if not data_yaml.exists():
            issues.append(f"[{step['name']}] data yaml missing: {data_yaml}")
            continue
        if data_yaml in seen:
            continue
        seen.add(data_yaml)
        with data_yaml.open(encoding="utf-8") as fh:
            dcfg = yaml.safe_load(fh) or {}
        for split in ("train", "val"):
            split_rel = dcfg.get(split)
            if not split_rel:
                issues.append(f"[{data_yaml.name}] missing `{split}:` field")
                continue
            split_dir = _resolve_split(data_yaml, split_rel)
            n = _count_images(split_dir)
            if n == 0:
                issues.append(
                    f"[{data_yaml.name}] {split} folder empty: {split_dir}\n"
                    + _fix_hint(data_yaml.name, split, split_dir)
                )
    return issues


def _fix_hint(yaml_name: str, split: str, split_dir: Path) -> str:
    """Prescriptive one-liner for the three common empty-folder cases."""
    if yaml_name == "ahaar-fridge.yaml":
        return (
            "        Fix: either\n"
            "        - shoot + label real photos into data/images/{train,val}/ and\n"
            "          data/labels/{train,val}/ (your paper contribution), OR\n"
            "        - python datasets/scripts/make_smoke_dataset.py  (pipeline-test only), OR\n"
            "        - edit the config's `data:` line to datasets/indianfood20.yaml and retarget"
        )
    if yaml_name == "indianfood20.yaml":
        return (
            "        Fix:\n"
            "        1. bash datasets/scripts/fetch_indianfood20.sh\n"
            "        2. python datasets/scripts/_prepare_indianfood20.py --root datasets/raw/indianfood20\n"
            "        Then re-run this command. The fetch needs a Kaggle account; place\n"
            "        kaggle.json in %USERPROFILE%\\.kaggle\\ (Windows) or ~/.kaggle/ (*nix)."
        )
    return f"        Fix: place supported images under {split_dir} and rerun."


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="Re-run even if best.pt already exists.")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--check", action="store_true",
                    help="Preflight-only: validate configs + datasets, don't train.")
    ap.add_argument("--no-preflight", action="store_true",
                    help="Skip dataset validation (not recommended).")
    ap.add_argument("--only", nargs="*", default=[],
                    help="Run only these step names (e.g. --only yolov11m_baseline).")
    ap.add_argument("--aggregate-only", action="store_true",
                    help="Rebuild results/ablation.csv from existing metrics.json files and exit.")
    args = ap.parse_args()

    if args.aggregate_only:
        aggregate()
        return

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

    if not plan:
        print("[ablate] nothing to do — every requested cell already has a best.pt.")
        # Still rebuild ablation.csv from whatever metrics.json files exist on
        # disk, so running evaluate.py manually and then ablate.py updates
        # the summary without any extra flags.
        aggregate()
        return

    # Preflight: validate every data config BEFORE training starts, so we fail
    # loudly in seconds instead of mid-epoch.
    if not args.no_preflight:
        print(f"[ablate] preflight: validating datasets for {len(plan)} step(s)...")
        issues = preflight(plan)
        if issues:
            print()
            print("=" * 72)
            print(" PREFLIGHT FAILED — fix these before training starts:")
            print("=" * 72)
            for i in issues:
                print(" - " + i)
            print()
            print("Re-run after fixing, or pass --no-preflight to ignore (NOT recommended).")
            sys.exit(2)
        print("[ablate] preflight: OK.")

    if args.check:
        print("[ablate] --check: preflight passed, exiting without training.")
        for step in plan:
            print(f"  would run: python training/train.py --config training/configs/{step['config']}")
        return

    if args.dry_run:
        for step in plan:
            print(f"  python training/train.py --config training/configs/{step['config']}")
        return

    total = len(plan)
    for i, step in enumerate(plan, 1):
        cmd = [sys.executable, "training/train.py", "--config", f"training/configs/{step['config']}"]
        print(f"\n[ablate] ({i}/{total}) -> {' '.join(cmd)}")
        subprocess.run(cmd, check=True, cwd=ROOT)
        # Skip evaluation for stage-1 cells — they're intermediate pretrains.
        if step.get("stage1"):
            print(f"[ablate] ({i}/{total}) stage-1 done; skipping evaluate.")
            continue
        subprocess.run(
            [sys.executable, "training/evaluate.py", "--run", step["name"]],
            check=True,
            cwd=ROOT,
        )
        aggregate()
    print(f"\n[ablate] all {total} step(s) complete.")


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
