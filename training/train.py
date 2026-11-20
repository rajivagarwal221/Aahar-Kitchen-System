"""Train a YOLO detector from a YAML config.

    python training/train.py --config training/configs/yolov11m_baseline.yaml

The config owns every hyperparameter — this script is a thin, auditable
wrapper so the four ablation cells differ only by their YAML. All other
training (resume, auto-batch, multi-GPU, etc.) is delegated to
`ultralytics.YOLO.train`.

The output lands at `results/<name>/`:
    weights/best.pt, weights/last.pt
    results.csv        — per-epoch metrics
    args.yaml          — exact training arguments ultralytics used

On failure to find a pretrained checkpoint (e.g. a stage-2 config that
expects stage-1 weights), the script refuses to run and prints the
command needed to produce that checkpoint first — so the ablation can
be reproduced from a cold clone without hidden steps.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    import yaml
    from ultralytics import YOLO
except ImportError as e:  # pragma: no cover
    print(f"[train.py] missing dependency: {e}", file=sys.stderr)
    print("Install with:  pip install -r training/requirements-ml.txt", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parents[1]


def load_config(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh)
    if "run_id" not in cfg or "model" not in cfg or "data" not in cfg:
        raise SystemExit(f"[train.py] {path} missing one of: run_id, model, data")
    return cfg


def resolve_model(model: str) -> str:
    """ultralytics accepts either a weights filename (downloaded from GitHub
    Releases) or a path on disk. If the config points to a stage-1 checkpoint,
    make sure the file exists and bail with a helpful message if not."""
    p = ROOT / model
    if "/" in model and not p.exists():
        raise SystemExit(
            f"[train.py] pretrained checkpoint not found: {p}\n"
            f"  This config expects a stage-1 checkpoint. Build it first with:\n"
            f"    python training/train.py --config training/configs/stage1_if20_yolov11m.yaml\n"
            f"  (or the matching stage-1 config for this backbone)."
        )
    return str(p) if p.exists() else model


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, type=Path)
    ap.add_argument("--dry-run", action="store_true",
                    help="Load the config and print what would be trained; do not start.")
    args = ap.parse_args()

    cfg = load_config(args.config.resolve())
    run_id = cfg["run_id"]
    model_arg = resolve_model(cfg["model"])
    print(f"[train.py] run_id={run_id}  model={model_arg}  data={cfg['data']}  epochs={cfg.get('epochs')}")

    if args.dry_run:
        print("[train.py] --dry-run set, exiting before training.")
        return

    # Everything in the YAML (minus our own run_id) is forwarded to ultralytics.
    train_kwargs = {k: v for k, v in cfg.items() if k != "run_id"}
    train_kwargs["model"] = model_arg

    model = YOLO(model_arg)
    results = model.train(**train_kwargs)
    print(f"[train.py] done. best weights: {Path(results.save_dir) / 'weights/best.pt'}")


if __name__ == "__main__":
    main()
