"""Generate the three plots the AHAAR IEEE report embeds:

    1. results/ablation_bars.png
       mAP@50, mAP@50-95 and F1 for each ablation cell.
    2. results/<run>/per_class_bars.png
       per-class mAP@50 for a single run.
    3. results/<run>/training_curves.png
       loss + mAP across epochs, read from the ultralytics results.csv.

    python training/plot.py                       # all plots for all runs
    python training/plot.py --run yolov11m_baseline  # single run
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError as e:  # pragma: no cover
    print(f"[plot.py] missing matplotlib: {e}", file=sys.stderr)
    print("Install with:  pip install -r training/requirements-ml.txt", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
LEGACY_RESULTS = ROOT / "runs/detect/results"


def find_run_dir(run: str) -> Path:
    """Locate a run directory under either results/ or the ultralytics
    runs/detect/results/ fallback. Returns the newest matching one, or
    just RESULTS / run if nothing exists yet."""
    candidates: list[Path] = []
    for root in (RESULTS, LEGACY_RESULTS):
        if not root.exists():
            continue
        for p in root.iterdir():
            if p.is_dir() and (p.name == run or p.name.startswith(f"{run}-") or p.name.startswith(f"{run}2") or p.name.startswith(f"{run}3")):
                candidates.append(p)
    if candidates:
        candidates.sort(key=lambda p: p.stat().st_mtime)
        return candidates[-1]
    return RESULTS / run


def read_rows(csv_path: Path) -> list[dict]:
    with csv_path.open(encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def plot_ablation_bars() -> None:
    src = RESULTS / "ablation.csv"
    if not src.exists():
        print(f"[plot.py] {src} not found; run training/ablate.py first.")
        return
    rows = read_rows(src)
    labels = [r["label"] for r in rows]
    map50 = [float(r["map50"]) for r in rows]
    map50_95 = [float(r["map50_95"]) for r in rows]
    f1 = [float(r["f1"]) for r in rows]

    x = range(len(labels))
    width = 0.27
    fig, ax = plt.subplots(figsize=(8.5, 4.2))
    ax.bar([i - width for i in x], map50,    width, label="mAP@50",    color="#3F6B3A")
    ax.bar(list(x),                 map50_95, width, label="mAP@50:95", color="#E0A21B")
    ax.bar([i + width for i in x], f1,       width, label="F1",        color="#C8693E")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, rotation=18, ha="right")
    ax.set_ylim(0, 1.0)
    ax.set_ylabel("Score")
    ax.set_title("AHAAR-Fridge ablation (val split)")
    ax.legend(loc="upper left", frameon=False)
    ax.grid(axis="y", linestyle="--", alpha=0.3)
    fig.tight_layout()
    out = RESULTS / "ablation_bars.png"
    fig.savefig(out, dpi=180)
    plt.close(fig)
    print(f"[plot.py] wrote {out}")


def plot_per_class_bars(run: str) -> None:
    run_dir = find_run_dir(run)
    src = run_dir / "metrics.json"
    if not src.exists():
        print(f"[plot.py] {src} not found; run training/evaluate.py --run {run} first.")
        return
    data = json.loads(src.read_text(encoding="utf-8"))
    rows = sorted(data["per_class"], key=lambda r: r["map50"], reverse=True)
    names = [r["name"] for r in rows]
    vals = [r["map50"] for r in rows]
    fig, ax = plt.subplots(figsize=(8.5, 0.28 * len(names) + 1.2))
    ax.barh(range(len(names)), vals, color="#3F6B3A")
    ax.set_yticks(range(len(names)))
    ax.set_yticklabels(names)
    ax.invert_yaxis()
    ax.set_xlim(0, 1.0)
    ax.set_xlabel("mAP@50")
    ax.set_title(f"Per-class mAP@50 — {run}")
    for i, v in enumerate(vals):
        ax.text(v + 0.01, i, f"{v:.2f}", va="center", fontsize=8, color="#555")
    ax.grid(axis="x", linestyle="--", alpha=0.3)
    fig.tight_layout()
    out = run_dir / "per_class_bars.png"
    fig.savefig(out, dpi=180)
    plt.close(fig)
    print(f"[plot.py] wrote {out}")


def plot_training_curves(run: str) -> None:
    run_dir = find_run_dir(run)
    src = run_dir / "results.csv"
    if not src.exists():
        print(f"[plot.py] {src} not found; nothing to plot.")
        return
    rows = read_rows(src)
    if not rows:
        return
    ep = [int(r["epoch"]) for r in rows]
    # ultralytics column names
    def col(name: str) -> list[float] | None:
        key = next((k for k in rows[0] if k.strip() == name), None)
        if key is None:
            return None
        return [float(r[key] or 0) for r in rows]

    train_box = col("train/box_loss") or col("train/loss")
    val_box = col("val/box_loss") or col("val/loss")
    m50 = col("metrics/mAP50(B)") or col("metrics/mAP_0.5")
    m5095 = col("metrics/mAP50-95(B)") or col("metrics/mAP_0.5:0.95")

    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 3.6))
    if train_box: a1.plot(ep, train_box, label="train box loss", color="#C8693E")
    if val_box:   a1.plot(ep, val_box,   label="val box loss",   color="#3F6B3A")
    a1.set_xlabel("Epoch"); a1.set_ylabel("Loss")
    a1.legend(frameon=False); a1.grid(linestyle="--", alpha=0.3)

    if m50:   a2.plot(ep, m50,   label="mAP@50",    color="#3F6B3A")
    if m5095: a2.plot(ep, m5095, label="mAP@50:95", color="#E0A21B")
    a2.set_xlabel("Epoch"); a2.set_ylabel("Score"); a2.set_ylim(0, 1.0)
    a2.legend(frameon=False); a2.grid(linestyle="--", alpha=0.3)

    fig.suptitle(f"Training curves — {run}")
    fig.tight_layout()
    out = run_dir / "training_curves.png"
    fig.savefig(out, dpi=180)
    plt.close(fig)
    print(f"[plot.py] wrote {out}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default=None, help="Single run name to plot; omit for everything.")
    args = ap.parse_args()

    if args.run:
        plot_per_class_bars(args.run)
        plot_training_curves(args.run)
        return
    plot_ablation_bars()
    for run_dir in sorted(RESULTS.iterdir()) if RESULTS.exists() else []:
        if not run_dir.is_dir() or run_dir.name == "ablation.csv":
            continue
        if (run_dir / "metrics.json").exists():
            plot_per_class_bars(run_dir.name)
        if (run_dir / "results.csv").exists():
            plot_training_curves(run_dir.name)


if __name__ == "__main__":
    main()
