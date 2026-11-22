"""Reshape the Kaggle IndianFood20 folders-per-class drop
(theeyeschico/indian-food-classification) into the YOLO layout AHAAR
training expects. Helper for fetch_indianfood20.sh.

CLASSES matches the 20 folders that Kaggle release actually ships, in
the same order as datasets/indianfood20.yaml. Whole-image bounding
boxes are generated (one centred box covering 95% of the frame) because
the dataset is classification-grade.

The images/ and labels/ splits are rebuilt from scratch on every run so
stale files with old class ids never leak into training.

    python datasets/scripts/_prepare_indianfood20.py --root datasets/raw/indianfood20
"""
from __future__ import annotations

import argparse
import random
import re
import shutil
from collections import Counter
from pathlib import Path

CLASSES = [
    "burger", "butter_naan", "chai", "chapati", "chole_bhature",
    "dal_makhani", "dhokla", "fried_rice", "idli", "jalebi",
    "kaathi_rolls", "kadai_paneer", "kulfi", "masala_dosa", "momos",
    "paani_puri", "pakode", "pav_bhaji", "pizza", "samosa",
]
ALIASES = {
    "naan": "butter_naan",
    "tea": "chai", "masala_chai": "chai",
    "chapathi": "chapati", "roti": "chapati",
    "chole_bhatura": "chole_bhature",
    "kathi_rolls": "kaathi_rolls", "kathi_roll": "kaathi_rolls", "kaathi_roll": "kaathi_rolls",
    "kadhai_paneer": "kadai_paneer",
    "dosa": "masala_dosa",
    "momo": "momos",
    "pani_puri": "paani_puri", "panipuri": "paani_puri", "golgappa": "paani_puri",
    "pakoda": "pakode", "pakora": "pakode", "pakoras": "pakode",
}
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
VAL_FRACTION = 0.2


def normalise(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="unpacked dataset directory")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--allow-missing", action="store_true",
                    help="continue even if some of the 20 classes have no images")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        raise SystemExit(f"[indianfood20] FAILED: {root} does not exist. Download the dataset first.")
    out_img, out_lbl = root / "images", root / "labels"

    cls_to_id = {c: i for i, c in enumerate(CLASSES)}
    lookup = {normalise(c): c for c in CLASSES}
    lookup.update({normalise(k): v for k, v in ALIASES.items()})

    # Kaggle zips often contain both train/ and test/ copies of each class
    # folder, so images for one class are pooled across every matching folder.
    pooled: dict[str, list[Path]] = {c: [] for c in CLASSES}
    unrecognised: list[str] = []
    for folder in sorted(p for p in root.rglob("*") if p.is_dir()):
        rel = folder.relative_to(root).parts
        if rel and rel[0] in ("images", "labels"):
            continue
        images = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMG_EXT]
        if not images:
            continue
        key = lookup.get(normalise(folder.name))
        if key is None:
            unrecognised.append(folder.relative_to(root).as_posix())
            continue
        pooled[key].extend(images)

    if not any(pooled.values()):
        print(f"[indianfood20] folders with images under {root}:")
        for n in unrecognised or ["(none)"]:
            print(f"              - {n}")
        raise SystemExit(
            "[indianfood20] FAILED: no dish folders found, so nothing was changed.\n"
            "The original Kaggle class folders (samosa/, idli/, ...) must be inside --root. Re-download with:\n"
            "  kaggle datasets download -d theeyeschico/indian-food-classification "
            f"-p {root} --unzip")

    # Only now is it safe to replace the old split.
    for d in (out_img, out_lbl):
        if d.exists():
            shutil.rmtree(d)
    for split in ("train", "val"):
        (out_img / split).mkdir(parents=True)
        (out_lbl / split).mkdir(parents=True)

    rng = random.Random(args.seed)
    counts: Counter[tuple[str, str]] = Counter()
    for cls, images in pooled.items():
        images = sorted(set(images))
        rng.shuffle(images)
        n_val = max(1, int(len(images) * VAL_FRACTION)) if images else 0
        for i, src in enumerate(images):
            split = "val" if i < n_val else "train"
            stem = f"{cls}_{i:05d}"
            shutil.copy2(src, out_img / split / f"{stem}{src.suffix.lower()}")
            (out_lbl / split / f"{stem}.txt").write_text(
                f"{cls_to_id[cls]} 0.5 0.5 0.95 0.95\n", encoding="utf-8")
            counts[(cls, split)] += 1

    print(f"\n[indianfood20] {'id':>2}  {'class':<15} {'train':>6} {'val':>5}")
    missing = []
    for cls in CLASSES:
        tr, va = counts[(cls, "train")], counts[(cls, "val")]
        flag = "" if tr and va else "   <-- MISSING"
        if flag:
            missing.append(cls)
        print(f"[indianfood20] {cls_to_id[cls]:>2}  {cls:<15} {tr:>6} {va:>5}{flag}")
    total = sum(counts.values())
    print(f"[indianfood20] total images: {total}")

    if unrecognised:
        print(f"\n[indianfood20] ignored {len(unrecognised)} folder(s) whose names matched no class:")
        for n in unrecognised:
            print(f"              - {n}  (normalised: {normalise(Path(n).name)!r})")
        print("[indianfood20] if one of these is a real dish, add it to ALIASES at the top of this script.")

    if total == 0:
        raise SystemExit(f"[indianfood20] FAILED: no images found under {root}. "
                         "Did fetch_indianfood20.sh finish downloading?")
    if missing and not args.allow_missing:
        raise SystemExit(f"\n[indianfood20] FAILED: {len(missing)} class(es) have no images: {missing}\n"
                         "Check the ignored-folder list above, or re-download the dataset. "
                         "Pass --allow-missing to continue anyway.")
    print("\n[indianfood20] OK: all 20 classes have train and val images.")


if __name__ == "__main__":
    main()
