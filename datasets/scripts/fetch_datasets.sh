#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p raw/{recipes,nutrition,dish_images,ingredient_images}

echo "== Recipes =="
for ref in \
  nehaprabhavalkar/indian-food-101 \
  sooryaprakash12/cleaned-indian-recipes-dataset \
  kritirathi/indian-food-dataset-with \
  sukhmandeepsinghbrar/indian-food-dataset \
  decentsanage/indian-dishes-analysis-dataset ; do
    name=$(basename "$ref")
    mkdir -p "raw/recipes/$name"
    kaggle datasets download -d "$ref" -p "raw/recipes/$name" --unzip
done

echo "== Nutrition =="
for ref in \
  batthulavinay/indian-food-nutrition \
  lalit7881/indian-packaged-foods-nutritional-dataset-2026 ; do
    name=$(basename "$ref")
    mkdir -p "raw/nutrition/$name"
    kaggle datasets download -d "$ref" -p "raw/nutrition/$name" --unzip
done

echo "== Dish images (80 classes) =="
mkdir -p raw/dish_images/indian-food-images-dataset
kaggle datasets download -d iamsouravbanerjee/indian-food-images-dataset \
    -p raw/dish_images/indian-food-images-dataset --unzip

echo "== Ingredient images =="
mkdir -p raw/ingredient_images/fruit-veg raw/ingredient_images/indian-spices
kaggle datasets download -d kritikseth/fruit-and-vegetable-image-recognition \
    -p raw/ingredient_images/fruit-veg --unzip
kaggle datasets download -d tankitrathaur/indian-spices-images-data \
    -p raw/ingredient_images/indian-spices --unzip

echo "Done."

# ------------------------------------------------------------------
# Optional: scrape the 55 raw pantry ingredients Kaggle does not have
# (dals, flours, dairy, oils, leafy greens, raw proteins, dry fruits)
# ------------------------------------------------------------------
#   pip install "scrapling[all]" pillow imagehash requests
#   scrapling install
#   python scripts/scrape_ingredient_images.py --target 150
