# Packaged-food brand detector (v1 plan)

Goal: point the camera at a kitchen shelf or fridge door and have AHAAR recognise branded packaged products common in Indian homes (Amul butter, Maggi, Parle-G, Aashirvaad atta, Tata Salt, Haldiram's namkeen …), and put the right pantry item in the list.

## Decision: a separate model, not more classes in the ingredient model

| | Add ~60 classes to the 107-class ingredient model | Separate packaged-goods model (chosen) |
| --- | --- | --- |
| Labels | Ingredient model is trained on whole-image boxes (`0.5 0.5 1 1`) from classification photos. Brand packs on a shelf need tight boxes, so mixing the two confuses the box head. | Real boxes from day one. |
| Risk to what works today | Every retrain can shift the 107 existing classes. | Ingredient model untouched. |
| Updating brands | Brands and pack designs change often: full retrain of everything. | Retrain only this small model. |
| Cost at inference | One pass. | Two passes (~2× latency on CPU). Acceptable for a photo-at-a-time app; can merge later once both have real boxes. |

## Classes

[`classes.csv`](classes.csv) holds **59 classes** across dairy, staples, spices, instant food, sauces, biscuits, snacks, beverages, chocolate and breakfast. Columns:

- `class`: label the model predicts, at **brand + product line** level (`maggi_noodles`, not `maggi_masala_70g`). Flavours and pack sizes are merged; pack designs vary too much to split them with the data we have.
- `pantry_ingredient`: one of the ingredient model's classes when the product *is* an ingredient (13 of 59, e.g. `amul_butter → butter`, `aashirvaad_atta → atta_flour`, `tata_salt → salt`). This lets recipe ranking keep working without knowing about brands.
- `aliases`: names other datasets use for the same thing (`Parle G`, `parle-g`, `Hourlicks` …). Matching ignores case, spaces and punctuation.

The list is a first guess at what a typical Indian kitchen holds. Prune or add rows to match what is actually in yours; nothing else in the notebook needs editing. The nutrition table at `datasets/raw/nutrition/indian-packaged-foods-nutritional-dataset-2026/` covers many of the same brands (Britannia, Parle, Amul, Haldiram's, Maggi, MTR …), so a later step can attach per-pack nutrition to each class.

## Data sources

| Source | What it gives | Licence | Notes |
| --- | --- | --- | --- |
| [Roboflow: hariom-jyhyf/object-detection-8iyni](https://universe.roboflow.com/hariom-jyhyf/object-detection-8iyni) | 87 Indian FMCG classes, boxes | CC BY 4.0 | Maggi, Parle, Bru, Horlicks, Taaza, Red Label, Tata Gold … Several classes are brand-only (`Britannia`, `Parle`, `Nestle`) and are treated as ambiguous: images containing them are dropped. |
| [Roboflow: st-xaviers-college-zadwr/supermarket-products-detection-yxgj6](https://universe.roboflow.com/st-xaviers-college-zadwr/supermarket-products-detection-yxgj6) | 37 classes, ~70 images | CC BY 4.0 | Amul butter/cheese/dahi, Parle-G, Monaco, Krackjack, Fortune oils, Kissan ketchup, Cerelac. Small but clean. |
| [Roboflow: agentsk47/indian-grocery-object-detection-mfsnx](https://universe.roboflow.com/agentsk47/indian-grocery-object-detection-mfsnx) | 10 classes | CC BY 4.0 | Only Bournvita and Nescafe are food. |
| [Roboflow: nmims-b6ta9/retail-store-india-new-2](https://universe.roboflow.com/nmims-b6ta9/retail-store-india-new-2/dataset/1) | 1,674 images | not shown | Class list not visible publicly; the notebook prints any unmapped classes so aliases can be added. |
| [Open Food Facts](https://world.openfoodfacts.org) (India) | Front-of-pack photos, one product each | CC BY-SA | Optional, noisy; boxed automatically. |
| **Your own photos** | The real thing: your shelves, your lighting | yours | Most important for accuracy. Most of the val split comes from here. |

Shop-shelf datasets look very different from a home fridge door, so expect public data alone to give a weak model. About **34 of the 59 classes have no public boxes at all** (Aashirvaad, Tata Salt, India Gate, MDH, Haldiram's, Kurkure, Lay's …), which is what the labelling plan below fixes.

## Labelling plan for the gaps (about 2 hours of phone photos)

No hand-drawn boxes needed for the first version:

1. For each product you have at home, make a folder named after its `class` in Google Drive: `MyDrive/AAhar/packaged_photos/<class>/`.
2. Take **30–50 photos per product, one product per photo**: front, side, back, tilted, on the shelf, in the fridge door, half hidden, tube-light and warm bulb, near and far. Empty or crumpled packs count.
3. The notebook draws the box around the product automatically with YOLO-World (open-vocabulary, prompts like "food packet", "bottle", "jar") and shows a contact sheet. Green box = auto-drawn, red = fell back to whole image. Delete bad photos and re-run.
4. Later, for multi-product shelf photos, upload ~100 of them to Roboflow, pre-label them with the v1 model, correct, and add the export as another `ROBOFLOW_SOURCES` entry.

Photos must be JPG/PNG (on iPhone: Settings → Camera → Formats → Most Compatible).

## Training

Open [`notebooks/train_aahar_packaged.ipynb`](../../notebooks/train_aahar_packaged.ipynb) in Colab (T4). It follows the ingredient notebook's pattern: Drive for runs, cell-by-cell gates before the long training cell, resumable after a disconnect.

- Base model YOLOv11m at 640 px, 80 epochs, patience 20.
- Horizontal flip **off** (mirrored logos and text are not real products).
- Prints per-class train/val counts and flags classes with fewer than 30 training boxes.
- Writes `per_class.csv` and `pantry_map.json` next to the weights. Upload to Hugging Face is off by default (`UPLOAD_TO_HF=False`).

## Serving it

After training, promote the weights into the backend's `packaged` slot:

```powershell
python training/promote.py --weights <Drive>/runs/aahar_packaged_v1/weights/best.pt --as packaged
```

This copies them to `backend/best_packaged.pt` and the run's `pantry_map.json` to `backend/pantry_map_packaged.json`. It refuses if the model's classes don't match `classes.csv`, so if you prune or add rows, retrain before promoting. Restart the backend: `POST /detect` then runs the ingredient and packaged models together and returns one list (see `backend/README.md`).

## Not done yet

- Frontend: brand-specific UI (logo, per-pack nutrition). Today a branded hit shows as its label (`Amul Butter`) under the mapped pantry item.
