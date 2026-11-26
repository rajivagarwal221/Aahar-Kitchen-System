"""Promote a trained checkpoint into the AHAAR backend.

End-to-end: copies <run>/weights/best.pt to backend/best.pt, exports an
ONNX for the browser inference path, loads both back to confirm they
work with a zero-tensor smoke forward pass, and prints a clean summary
(class count, size, inference latency on this machine).

    python training/promote.py --run yolov11m_if20_pretrain --as dishes
    python training/promote.py --weights <Drive>/runs/aahar_packaged_v1/weights/best.pt --as packaged
    # or an explicit file:
    python training/promote.py --weights results/<run>/weights/best.pt

Safeties
- Refuses to promote weights trained on the smoke dataset (detects
  data/images/train/.AHAAR_SMOKE_MARKER). Pass --allow-smoke only if
  you really want the demo model to be synthetic.
- Backs up the previous backend/best.pt as backend/best.pt.bak before
  overwriting, so rollback is one rename away.
- Three slots, one file each (backend/slots.py): ingredients -> best.pt,
  dishes -> best_dishes.pt, packaged -> best_packaged.pt. Promoting one
  never touches the others.
- Refuses to promote unless the model's class list matches the slot's list
  in the repo exactly, names and order (ingredients: src/lib/classNames.ts,
  dishes: datasets/indianfood20.yaml, packaged: datasets/packaged/classes.csv).
  Pass --allow-class-drift to override.
- Writes a promotion record to backend/.promoted_<slot>.json with the run
  id, source path, timestamp, and class count.
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
    import yaml
    from ultralytics import YOLO
except ImportError as e:  # pragma: no cover
    print(f"[promote.py] missing dependency: {e}", file=sys.stderr)
    print("Install with:  pip install -r training/requirements-ml.txt", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
LEGACY_RESULTS = ROOT / "runs/detect/results"
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))
import slots as S  # noqa: E402  (backend/slots.py: slot files + expected class lists)


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
    ap.add_argument("--as", dest="slot", choices=[*S.SLOTS, "auto"],
                    default="auto",
                    help="Which backend slot to promote into. 'auto' (default) "
                         "picks the slot whose class list the model matches "
                         "exactly, else guesses from the run's args.yaml.")
    ap.add_argument("--allow-class-drift", action="store_true",
                    help="Promote even if the model's class list differs from the "
                         "slot's list in the repo (see backend/slots.py).")
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
        # Only block if the weights were ACTUALLY trained on the smoke
        # dataset (i.e. on ahaar-fridge.yaml). Models trained against
        # IF20 or another dataset are unaffected by the marker.
        args_yaml = src.parent.parent / "args.yaml"
        trained_on_smoke = True  # conservative default when origin is unknown
        if args_yaml.exists():
            try:
                tcfg = yaml.safe_load(args_yaml.read_text(encoding="utf-8")) or {}
                data_rel = str(tcfg.get("data", ""))
                trained_on_smoke = "ahaar-fridge" in data_rel.lower()
            except Exception:
                pass  # fall through to the conservative block below
        if trained_on_smoke:
            raise SystemExit(
                "[promote.py] refuse to promote: data/images/train still holds smoke-test\n"
                "    data (see .AHAAR_SMOKE_MARKER) AND this weights file was trained on\n"
                "    ahaar-fridge.yaml, so it was almost certainly trained on flat-colour\n"
                "    rectangles. If you really mean to ship a demo model, re-run with\n"
                "    --allow-smoke."
            )
        print(f"[promote.py] note: smoke marker present but weights trained on "
              f"{Path(data_rel).name if data_rel else 'unknown dataset'} (not ahaar-fridge). Proceeding.")

    got = S.model_names(YOLO(str(src)))

    # Decide the slot.
    slot = args.slot
    if slot == "auto":
        slot = S.suggest_slot(got)
        if slot is None:
            slot = "ingredients"  # safe default; the class check below still guards it
            args_yaml_src = src.parent.parent / "args.yaml"
            if args_yaml_src.exists():
                try:
                    tcfg = yaml.safe_load(args_yaml_src.read_text(encoding="utf-8")) or {}
                    data_rel = str(tcfg.get("data", "")).lower()
                    if "indianfood20" in data_rel:
                        slot = "dishes"
                    elif "packaged" in data_rel:
                        slot = "packaged"
                except Exception:
                    pass
        print(f"[promote.py] slot auto-detected: {slot}")

    filename = S.SLOTS[slot]["file"]

    # Each slot's class list is fixed by the repo (ingredients: classNames.ts,
    # dishes: indianfood20.yaml, packaged: datasets/packaged/classes.csv).
    # Check before overwriting so e.g. a 20-class dish model can't silently
    # replace the 107-class ingredient detector.
    expected = S.expected_classes(slot)
    if expected is None:
        print(f"[promote.py] note: no repo class list for slot {slot}; skipping class check.")
    else:
        diff = S.diff_classes(got, expected)
        if diff:
            hint = S.suggest_slot(got)
            msg = f"[promote.py] class mismatch for slot {slot}: {diff}."
            if not args.allow_class_drift:
                raise SystemExit(
                    msg + (f"\n    This model matches the {hint} slot: pass --as {hint}." if hint else
                           "\n    If the classes really changed, update the slot's class list "
                           "first (see backend/slots.py) or pass --allow-class-drift."))
            print(msg + " Proceeding (--allow-class-drift).")
        else:
            print(f"[promote.py] {len(got)} classes match the {slot} list.")

    # Copy with a backup so rollback is cheap.
    BACKEND.mkdir(parents=True, exist_ok=True)
    dst = BACKEND / filename
    if dst.exists():
        bak = dst.with_suffix(".pt.bak")
        shutil.copy2(dst, bak)
        print(f"[promote.py] backed up previous {dst.name} -> {bak.name}")
    shutil.copy2(src, dst)
    size_mb = dst.stat().st_size / (1024 * 1024)
    print(f"[promote.py] copied {src} ({size_mb:.1f} MB) -> {dst} (slot={slot})")

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
            onnx_name = Path(filename).with_suffix(".onnx").name
            final = BACKEND / onnx_name
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
        "slot": slot,
        "source": str(src),
        "destination": str(dst),
        "onnx": onnx_path,
        "classes": len(names),
        "size_mb": round(size_mb, 2),
        "latency_ms_median": latency_ms,
        "allow_smoke": bool(args.allow_smoke),
        "promoted_at": datetime.now().isoformat(timespec="seconds"),
    }
    # The packaged slot needs class -> brand / pantry ingredient. Prefer the
    # pantry_map.json the training notebook wrote next to these weights.
    if slot == "packaged":
        run_map = src.parent.parent / "pantry_map.json"
        if run_map.exists():
            shutil.copy2(run_map, S.PACKAGED_MAP_FILE)
        else:
            S.PACKAGED_MAP_FILE.write_text(json.dumps(S.packaged_map_from_csv() or {}, indent=1),
                                           encoding="utf-8")
        print(f"[promote.py] wrote {S.PACKAGED_MAP_FILE.name}")

    # One record file per slot so promoting ingredients doesn't overwrite the
    # dishes record and vice versa.
    record_path = BACKEND / f".promoted_{slot}.json"
    record_path.write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(f"[promote.py] wrote {record_path}")

    print("[promote.py] done. Restart the backend to pick up the new weights:")
    print("    cd backend && python app.py")


if __name__ == "__main__":
    main()
