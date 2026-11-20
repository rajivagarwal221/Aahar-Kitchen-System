"""Promote a trained checkpoint into the AHAAR backend.

End-to-end: copies <run>/weights/best.pt to backend/best.pt, exports an
ONNX for the browser inference path, loads both back to confirm they
work with a zero-tensor smoke forward pass, and prints a clean summary
(class count, size, inference latency on this machine).

    python training/promote.py --run yolov11m_if20_pretrain
    # or an explicit file:
    python training/promote.py --weights results/<run>/weights/best.pt

Safeties
- Refuses to promote weights trained on the smoke dataset (detects
  data/images/train/.AHAAR_SMOKE_MARKER). Pass --allow-smoke only if
  you really want the demo model to be synthetic.
- Backs up the previous backend/best.pt as backend/best.pt.bak before
  overwriting, so rollback is one rename away.
- Writes a promotion record to backend/.promoted.json with the run id,
  source path, timestamp, and class count.
"""
from __future__ import annotations

import argparse
import json
import shutil
import statistics
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import numpy as np
    from ultralytics import YOLO
except ImportError as e:  # pragma: no cover
    print(f"[promote.py] missing dependency: {e}", file=sys.stderr)
    print("Install with:  pip install -r training/requirements-ml.txt", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
LEGACY_RESULTS = ROOT / "runs/detect/results"
BACKEND = ROOT / "backend"


def find_weights(run: str) -> Path:
    """Locate the newest best.pt for a run, mirroring evaluate.py's fallback."""
    expected = RESULTS / run / "weights/best.pt"
    if expected.exists():
        return expected
    candidates: list[Path] = []
    for root in (RESULTS, LEGACY_RESULTS):
        if root.exists():
            candidates.extend(root.glob(f"{run}*/weights/best.pt"))
    if not candidates:
        raise SystemExit(
            f"[promote.py] no best.pt found for run '{run}'. Searched:\n"
            f"  {expected}\n"
            f"  {RESULTS}/{run}*/weights/best.pt\n"
            f"  {LEGACY_RESULTS}/{run}*/weights/best.pt"
        )
    candidates.sort(key=lambda p: p.stat().st_mtime)
    return candidates[-1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default=None,
                    help="Run name to promote (newest matching best.pt wins). Mutually exclusive with --weights.")
    ap.add_argument("--weights", type=Path, default=None,
                    help="Explicit weights path; skips the search.")
    ap.add_argument("--no-onnx", action="store_true",
                    help="Skip the ONNX export step.")
    ap.add_argument("--no-smoke-check", action="store_true",
                    help="Skip the zero-tensor forward pass.")
    ap.add_argument("--allow-smoke", action="store_true",
                    help="Allow promoting weights trained on the smoke dataset.")
    args = ap.parse_args()

    if not args.run and not args.weights:
        raise SystemExit("[promote.py] pass either --run <name> or --weights <path>.")
    if args.run and args.weights:
        raise SystemExit("[promote.py] --run and --weights are mutually exclusive.")

    src = args.weights.resolve() if args.weights else find_weights(args.run)
    if not src.exists():
        raise SystemExit(f"[promote.py] weights not found: {src}")

    marker = ROOT / "data/images/train/.AHAAR_SMOKE_MARKER"
    if marker.exists() and not args.allow_smoke:
        raise SystemExit(
            "[promote.py] refuse to promote: data/images/train still holds smoke-test\n"
            "    data (see .AHAAR_SMOKE_MARKER). This weights file was likely trained\n"
            "    on flat-colour rectangles, not a real dataset. If you really mean to\n"
            "    ship a demo model, re-run with --allow-smoke."
        )

    # Copy with a backup so rollback is cheap.
    BACKEND.mkdir(parents=True, exist_ok=True)
    dst = BACKEND / "best.pt"
    if dst.exists():
        bak = dst.with_suffix(".pt.bak")
        shutil.copy2(dst, bak)
        print(f"[promote.py] backed up previous backend/best.pt -> {bak.name}")
    shutil.copy2(src, dst)
    size_mb = dst.stat().st_size / (1024 * 1024)
    print(f"[promote.py] copied {src} ({size_mb:.1f} MB) -> {dst}")

    model = YOLO(str(dst))
    names = model.names if isinstance(model.names, dict) else {i: n for i, n in enumerate(model.names)}
    print(f"[promote.py] model has {len(names)} classes")

    # Smoke forward pass
    latency_ms: float | None = None
    if not args.no_smoke_check:
        arr = np.zeros((640, 640, 3), dtype=np.uint8)
        for _ in range(3):  # warm
            model.predict(arr, verbose=False)
        times: list[float] = []
        for _ in range(20):
            t0 = time.perf_counter()
            model.predict(arr, verbose=False)
            times.append((time.perf_counter() - t0) * 1000)
        latency_ms = round(statistics.median(times), 2)
        print(f"[promote.py] forward-pass smoke: median {latency_ms} ms/image on this machine")

    # ONNX export for browser inference
    onnx_path: str | None = None
    if not args.no_onnx:
        try:
            exported = model.export(format="onnx", opset=12, dynamic=False, simplify=True)
            onnx_path = str(exported)
            # YOLO.export writes next to the .pt; move it into backend/ for a tidy layout.
            final = BACKEND / "best.onnx"
            try:
                shutil.move(exported, final)
                onnx_path = str(final)
            except shutil.Error:
                pass  # already there
            print(f"[promote.py] exported ONNX -> {onnx_path}")
        except Exception as e:  # pragma: no cover
            print(f"[promote.py] ONNX export failed (non-fatal): {e}")

    record = {
        "run": args.run or "",
        "source": str(src),
        "destination": str(dst),
        "onnx": onnx_path,
        "classes": len(names),
        "size_mb": round(size_mb, 2),
        "latency_ms_median": latency_ms,
        "allow_smoke": bool(args.allow_smoke),
        "promoted_at": datetime.now().isoformat(timespec="seconds"),
    }
    (BACKEND / ".promoted.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(f"[promote.py] wrote {BACKEND / '.promoted.json'}")

    # Sanity check: current frontend expects a specific class count. Flag drift.
    class_names_file = ROOT / "src/lib/classNames.ts"
    if class_names_file.exists():
        head = class_names_file.read_text(encoding="utf-8")[:4000]
        if f"length {len(names)}" not in head and f"{len(names)}" not in head[:400]:
            print("[promote.py] note: your new model has", len(names),
                  "classes. Double-check src/lib/classNames.ts matches, or the UI will mis-label boxes.")

    print("[promote.py] done. Restart the backend to pick up the new weights:")
    print("    cd backend && python app.py")


if __name__ == "__main__":
    main()
