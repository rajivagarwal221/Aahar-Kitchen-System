"""Reshape the Kaggle IndianFood20 folders-per-class drop into the YOLO
layout AHAAR training expects. Helper for fetch_indianfood20.sh.

Classes outside the 20-class whitelist in datasets/indianfood20.yaml
are dropped so the stage-1 pretrain target matches the stage-1 data
config. Whole-image bounding boxes are generated (one box per image,
centred, covering 95% of the frame) because stage-1 pretraining only
needs the backbone to learn Indian-food textures — not localisation.

    python datasets/scripts/_prepare_indianfood20.py --root <path>
"""
from __future__ import annotations

import argparse
import random
import re
import shutil
from pathlib import Path

CLASSES = [
    "biryani", "butter_chicken", "chapati", "chole_bhature", "dal_makhani",
    "dosa", "fried_rice", "idli", "jalebi", "kofta",
    "naan", "pakoda", "paneer_tikka", "pani_puri", "pav_bhaji",
    "poha", "pulao", "rasmalai", "samosa", "upma",
]
VAL_FRACTION = 0.2


def normalise(name: str) -> str:
    """Kaggle folder names drift — strip casing, punctuation, whitespace."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="unpacked dataset directory")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    root = Path(args.root).resolve()
    out_img = root / "images"
    out_lbl = root / "labels"
    for split in ("train", "val"):
        (out_img / split).mkdir(parents=True, exist_ok=True)
        (out_lbl / split).mkdir(parents=True, exist_ok=True)

    rng = random.Random(args.seed)
    cls_to_id = {c: i for i, c in enumerate(CLASSES)}
    aliases = {normalise(c): c for c in CLASSES}
    aliases.update({
        normalise("butter chicken"): "butter_chicken",
        normalise("chole bhature"): "chole_bhature",
        normalise("dal makhani"): "dal_makhani",
        normalise("paneer tikka"): "paneer_tikka",
        normalise("pani puri"): "pani_puri",
        normalise("pav bhaji"): "pav_bhaji",
        normalise("fried rice"): "fried_rice",
    })

    n_moved, n_skipped = 0, 0
    seen_folders: list[str] = []
    recognised: list[str] = []
    unrecognised: list[str] = []
    # Walk recursively — Kaggle datasets often nest class folders inside a
    # "dataset" or "images" wrapper, which the previous straight iterdir
    # missed entirely and silently emitted zero images.
    for folder in [p for p in root.rglob("*") if p.is_dir()]:
        rel = folder.relative_to(root).as_posix()
        if rel in ("", "images", "labels") or rel.startswith(("images/", "labels/")):
            continue
        images = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
        if not images:
            continue  # not a leaf class folder
        seen_folders.append(rel)
        key = aliases.get(normalise(folder.name))
        if key is None:
            unrecognised.append(folder.name)
            continue
        recognised.append(folder.name)
        cls_id = cls_to_id[key]
        rng.shuffle(images)
        n_val = max(1, int(len(images) * VAL_FRACTION))
        for i, src in enumerate(images):
            split = "val" if i < n_val else "train"
            dst_img = out_img / split / f"{key}_{i:04d}{src.suffix.lower()}"
            dst_lbl = out_lbl / split / f"{key}_{i:04d}.txt"
            if dst_img.exists():
                n_skipped += 1
                continue
            shutil.copy2(src, dst_img)
            # centred box covering 95% of the image — stage-1 pretrain only
            # needs texture, not accurate boxes.
            dst_lbl.write_text(f"{cls_id} 0.5 0.5 0.95 0.95\n", encoding="utf-8")
            n_moved += 1

    print(f"[indianfood20] walked {len(seen_folders)} leaf class folders under {root}")
    print(f"[indianfood20] recognised {len(recognised)}: {sorted(recognised)[:6]}{'...' if len(recognised)>6 else ''}")
    if unrecognised:
        print(f"[indianfood20] SKIPPED {len(unrecognised)} (names didn't match whitelist):")
        for n in sorted(set(unrecognised)):
            print(f"              - {n!r}  (normalised: {normalise(n)!r})")
        print("[indianfood20] edit CLASSES / aliases at the top of this script to include them.")
    print(f"[indianfood20] moved {n_moved} images, skipped {n_skipped} already present.")
    if n_moved == 0:
        raise SystemExit(
            "[indianfood20] FAILED: zero images moved. Likely causes:\n"
            f"  - {root} doesn't contain any class folders yet (fetch_indianfood20.sh didn't finish)\n"
            "  - the class folder names don't match this script's whitelist (see SKIPPED list above)\n"
            f"  - images are nested inside a wrapper folder you can inspect with:  dir {root}"
        )


if __name__ == "__main__":
    main()
