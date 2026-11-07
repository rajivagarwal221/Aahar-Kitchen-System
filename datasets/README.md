# AHAAR Datasets

Curated Indian food datasets powering the detector, recipe recommender and nutrition layer.

## Layout

```
datasets/
├── raw/
│   ├── recipes/            # dish metadata + ingredient lists (CSV; committed)
│   ├── nutrition/          # per-food nutrition tables (CSV; committed)
│   ├── dish_images/        # 80-class Indian dishes (gitignored — fetch via script)
│   └── ingredient_images/  # fruits+veg (33) + Indian spices (gitignored)
└── scripts/
    └── fetch_datasets.sh   # downloads everything from Kaggle (needs kaggle.json)
```

## Sources used (deduplicated)

### Recipes / menu / materials (committed, ~35 MB)
- `nehaprabhavalkar/indian-food-101` — 255 dishes, ingredients, diet, region, prep/cook time
- `sooryaprakash12/cleaned-indian-recipes-dataset` — cleaned Indian recipes
- `kritirathi/indian-food-dataset-with`
- `sukhmandeepsinghbrar/indian-food-dataset`
- `decentsanage/indian-dishes-analysis-dataset`

### Nutrition (committed, ~0.5 MB)
- `batthulavinay/indian-food-nutrition` — 2025 Indian food nutrition values
- `lalit7881/indian-packaged-foods-nutritional-dataset-2026` — packaged foods

### Dish images (gitignored, ~371 MB)
- `iamsouravbanerjee/indian-food-images-dataset` — 80 Indian dish classes
  - Chosen over 5 competing datasets (theeyeschico, l33tc0d3r, cdart99, anshulmehta, campusx) whose classes were 18/20–20/20 duplicates of this one, and several of which polluted the label space with burger/pizza/momos.

### Ingredient images (gitignored, ~3.3 GB)
- `kritikseth/fruit-and-vegetable-image-recognition` — 33 produce classes (apple, onion, potato, tomato, ginger, garlic, cabbage, cauliflower, lemon, carrot, peas, spinach, etc.)
- `tankitrathaur/indian-spices-images-data` — Indian spices (asafoetida, cloves, mace, etc.)

## Reproducing locally

```bash
# 1. put your kaggle.json at ~/.kaggle/kaggle.json (chmod 600)
pip install kaggle
bash datasets/scripts/fetch_datasets.sh
```
