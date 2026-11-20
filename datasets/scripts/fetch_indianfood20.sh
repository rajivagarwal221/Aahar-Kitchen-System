#!/usr/bin/env bash
#
# Fetch the IndianFood20 dataset (Pandey et al., IEEE ICDEW 2022,
# arXiv:2205.04841) for use as the stage-1 pretraining target in
# AHAAR's training pipeline.
#
# The original paper releases the dataset through Kaggle:
#   https://www.kaggle.com/datasets/theeyeschico/indian-food-classification
# You'll need a Kaggle account and the `kaggle` CLI installed:
#   pip install kaggle
#   mkdir -p ~/.kaggle && cp kaggle.json ~/.kaggle/ && chmod 600 ~/.kaggle/kaggle.json
#
#   bash datasets/scripts/fetch_indianfood20.sh

set -euo pipefail

OUT="$(cd "$(dirname "$0")/.." && pwd)/raw/indianfood20"
mkdir -p "$OUT"

if ! command -v kaggle >/dev/null 2>&1; then
  echo "kaggle CLI not found. Install it with: pip install kaggle"
  echo "Then place your kaggle.json at ~/.kaggle/kaggle.json (chmod 600)."
  exit 2
fi

echo "Downloading IndianFood20 into $OUT ..."
kaggle datasets download -d theeyeschico/indian-food-classification -p "$OUT" --unzip

# The Kaggle release ships one folder per class — reshape it into the
# YOLO layout AHAAR expects and generate placeholder whole-image labels
# (ingredient-level bounding boxes aren't needed for stage-1 pretrain,
# we treat each image as a single centred box).
python3 "$(dirname "$0")/_prepare_indianfood20.py" --root "$OUT"

echo
echo "Done. Cite as:"
echo "  Pandey et al. Object Detection in Indian Food Platters using"
echo "  Transfer Learning with YOLOv4. IEEE ICDEW 2022. arXiv:2205.04841."
