# AHAAR ingredient scraper

Scrapes the 55 pantry-ingredient classes missing from the Kaggle datasets
(dals, flours, dairy, oils, leafy greens, raw proteins, dry fruits, other
staples) and lands them at
`datasets/raw/ingredient_images/scraped/<class>/*.jpg`.

## Why we need this

The Kaggle image datasets cover **cooked dishes + produce + a few spices**.
For a pantry/fridge scanner, we need images of the **raw ingredients** a
household actually has on the shelf: raw toor dal, besan, atta, paneer, ghee,
raw chicken, etc.  No single Kaggle dataset covers these — they have to be
scraped.

## What it does

* 55 classes × 1–3 tuned search queries each, biased toward RAW form
  (e.g. `"raw toor dal split pigeon pea"` not just `"toor dal"`).
* Scrapes Bing Images (or DuckDuckGo) through `scrapling`'s StealthyFetcher
  so anti-bot measures don't block it.
* Every downloaded image is validated:
    * header is a real JPEG / PNG / WEBP
    * at least 300 × 300 px and no more than 4000 × 4000
    * aspect ratio between 0.5 and 2.0 (drops banners / strips)
    * at least 10 KB
* URL-level blacklist drops anything whose URL hints it's a cooked dish
  (`recipe`, `curry-recipe`, `biryani-recipe`, `-fried-`, `sabzi`, …).
* Perceptual-hash dedup: near-duplicate images within a class are skipped.
* **Resumable**: classes that already have `--target` images are skipped on
  re-run.
* **Strict mode** (`--strict`): abort a class as soon as the reject streak
  passes 20 images in a row (good signal the query is poisoned).

## Install (one time)

```bash
pip install "scrapling[all]" pillow imagehash requests
scrapling install        # downloads Playwright-chromium (~200 MB)
```

## Run

```bash
# Full pipeline, 150 images per class (≈ 8 000 images, ~1 GB)
python datasets/scripts/scrape_ingredient_images.py --target 150

# Only a few classes (great for a smoke test)
python datasets/scripts/scrape_ingredient_images.py --only toor_dal besan_flour paneer --target 20

# Strict relevance (abort a class on 20-image reject streak)
python datasets/scripts/scrape_ingredient_images.py --strict

# DuckDuckGo instead of Bing (no browser needed)
python datasets/scripts/scrape_ingredient_images.py --engine duckduckgo

# List all 55 class names
python datasets/scripts/scrape_ingredient_images.py --list
```

Output lives under
`datasets/raw/ingredient_images/scraped/<class>/0001_<md5>.jpg`
and a `report.json` summary is written next to it.

## After scraping

Re-run the manifest merger so the training notebook picks up the new classes:

```bash
python datasets/scripts/rebuild_manifest.py   # (to be added)
```

Then re-run the Colab notebook — it reads the manifest and will train on the
new ingredient classes automatically.
