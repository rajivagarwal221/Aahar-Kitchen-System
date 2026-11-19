"""AHAAR detection backend.

Loads best.pt once at startup, exposes POST /detect that takes an image
and returns ingredient detections as JSON. Keeps the model warm; typical
response time ~50-150 ms on an RTX 3050.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from ultralytics import YOLO
except ImportError as e:
    raise SystemExit("pip install ultralytics fastapi uvicorn python-multipart pillow") from e

# --- model path ---------------------------------------------------------------
# 1) If MODEL_PATH env var is set, use that.
# 2) Else look for backend/best.pt (copied in by the user).
# 3) Else download from the Hugging Face CDN.
MODEL_PATH = os.environ.get("MODEL_PATH")
if not MODEL_PATH:
    local = Path(__file__).parent / "best.pt"
    if local.exists():
        MODEL_PATH = str(local)
    else:
        from urllib.request import urlretrieve
        print("Downloading best.pt from Hugging Face (one-time)...")
        urlretrieve(
            "https://huggingface.co/Rajiv221/aahar-ingredient-detector/resolve/main/best.pt",
            str(local),
        )
        MODEL_PATH = str(local)

CONF = float(os.environ.get("CONF", "0.25"))
IOU  = float(os.environ.get("IOU",  "0.45"))

print(f"Loading YOLO from {MODEL_PATH}")
model = YOLO(MODEL_PATH)
# Warm-up so the first request isn't the slow one.
import numpy as np
model.predict(np.zeros((640, 640, 3), dtype=np.uint8), verbose=False)
print(f"Model ready. {len(model.names)} classes.")

# --- display-name mapping (matches src/lib/classNames.ts) ---------------------
DISPLAY_OVERRIDES = {
    "cinnamom stick": "Cinnamon stick", "dry red chilly": "Dry red chilli",
    "jalepeno": "Jalapeño", "raddish": "Radish",
    "sweetpotato": "Sweet potato", "sweetcorn": "Sweet corn",
    "curd_yogurt": "Curd / yoghurt", "rajma_bean": "Rajma (kidney beans)",
    "moong_whole": "Moong (whole)", "moong_dal_split": "Moong dal (split)",
    "chana_dal": "Chana dal", "masoor_dal": "Masoor dal",
    "toor_dal": "Toor dal", "urad_dal": "Urad dal",
    "kala_chana": "Kala chana", "black_eyed_peas": "Black-eyed peas",
    "atta_flour": "Atta flour", "besan_flour": "Besan (gram flour)",
    "maida_flour": "Maida", "rice_flour": "Rice flour",
    "sooji_rava": "Sooji / rava",
    "bajra_flour": "Bajra flour", "jowar_flour": "Jowar flour",
    "ragi_flour": "Ragi flour",
    "basmati_rice": "Basmati rice", "sona_masoori_rice": "Sona masoori rice",
    "idli_rice": "Idli rice",
    "mustard_oil": "Mustard oil", "groundnut_oil": "Groundnut oil",
    "coconut_oil": "Coconut oil", "sesame_oil": "Sesame oil",
    "sunflower_oil": "Sunflower oil",
    "methi_leaves": "Methi (fenugreek) leaves",
    "coriander_leaves": "Coriander leaves", "mint_leaves": "Mint leaves",
    "curry_leaves": "Curry leaves", "drumstick_leaves": "Drumstick leaves",
    "raw_chicken": "Chicken (raw)", "raw_fish": "Fish (raw)",
    "raw_mutton": "Mutton (raw)", "raw_prawn": "Prawns (raw)",
    "fresh_coconut": "Fresh coconut", "grated_coconut": "Grated coconut",
    "hing_block": "Hing (asafoetida block)",
}
def display(raw: str) -> str:
    if raw in DISPLAY_OVERRIDES:
        return DISPLAY_OVERRIDES[raw]
    s = re.sub(r"_", " ", raw)
    return s[:1].upper() + s[1:]

# --- API ----------------------------------------------------------------------
app = FastAPI(title="AHAAR detector", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],                # for local dev; tighten in production
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

class Det(BaseModel):
    id: str
    classId: int
    className: str
    label: str
    confidence: float
    box: dict          # {x, y, w, h} in % of original image

@app.get("/health")
def health():
    return {"status": "ok", "classes": len(model.names)}

@app.post("/detect", response_model=List[Det])
async def detect(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Expected an image upload")
    raw = await file.read()
    from PIL import Image
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"Could not read image: {e}")

    W, H = img.size
    res = model.predict(img, conf=CONF, iou=IOU, verbose=False)[0]
    out: list[Det] = []
    if res.boxes is None:
        return out
    boxes = res.boxes.xyxy.cpu().numpy()
    confs = res.boxes.conf.cpu().numpy()
    clses = res.boxes.cls.cpu().numpy().astype(int)
    for i in range(len(boxes)):
        x1, y1, x2, y2 = boxes[i].tolist()
        cid = int(clses[i])
        raw_name = model.names[cid]
        out.append(Det(
            id=f"{cid}-{i}",
            classId=cid,
            className=raw_name,
            label=display(raw_name),
            confidence=float(confs[i]),
            box={
                "x": max(0.0, x1) / W * 100,
                "y": max(0.0, y1) / H * 100,
                "w": max(0.0, x2 - x1) / W * 100,
                "h": max(0.0, y2 - y1) / H * 100,
            },
        ))
    out.sort(key=lambda d: d.confidence, reverse=True)
    return out

# =============================================================================
# Recipes: load the 16k-row Indian recipe CSV and serve ranked matches.
# =============================================================================
RECIPES_CSV = Path(os.environ.get(
    "RECIPES_CSV",
    str(Path(__file__).parent.parent / "datasets/raw/recipes/indian-food-dataset/IndianFoodDatasetCSV.csv"),
))

# Map YOLO class name -> patterns to substring-match in recipe ingredient text.
# Recipe text is lowercase before matching, so patterns are lowercase too.
CLASS_ALIASES: dict[str, list[str]] = {
    "paneer": ["paneer", "cottage cheese"],
    "spinach": ["spinach", "palak"],
    "coriander_leaves": ["coriander", "cilantro", "dhania"],
    "curry_leaves": ["curry leaves", "kadi patta"],
    "methi_leaves": ["methi", "fenugreek leaves"],
    "mint_leaves": ["mint", "pudina"],
    "drumstick_leaves": ["drumstick leaves", "moringa"],
    "tomato": ["tomato"], "onion": ["onion"],
    "garlic": ["garlic", "lahsun"], "ginger": ["ginger", "adrak"],
    "potato": ["potato", "aloo"], "sweetpotato": ["sweet potato", "shakarkandi"],
    "cauliflower": ["cauliflower", "gobi"], "cabbage": ["cabbage", "patta gobi"],
    "okra": ["okra", "bhindi", "lady finger"], "carrot": ["carrot", "gajar"],
    "capsicum": ["capsicum", "bell pepper", "shimla"],
    "eggplant": ["eggplant", "brinjal", "baingan"],
    "pumpkin": ["pumpkin", "kaddu"], "raddish": ["radish", "mooli"],
    "beetroot": ["beetroot", "beet"], "cucumber": ["cucumber", "kheera"],
    "mushroom": ["mushroom"], "peas": ["peas", "matar"], "sweetcorn": ["corn", "makka"],
    "bitter_gourd": ["bitter gourd", "karela"], "bottle_gourd": ["bottle gourd", "lauki"],
    "ridge_gourd": ["ridge gourd", "turai"], "ash_gourd": ["ash gourd", "petha"],
    "drumstick": ["drumstick", "sahjan"], "green_beans": ["green beans", "french beans"],
    "lemon": ["lemon", "nimbu"], "banana": ["banana", "kela"],
    "mango": ["mango", "aam"], "apple": ["apple"], "coconut": ["coconut", "nariyal"],
    "fresh_coconut": ["coconut", "nariyal"], "grated_coconut": ["grated coconut"],
    "chilli": ["chilli", "chilly", "chili"],
    "green_chilli": ["green chilli", "green chilly", "hari mirch"],
    "dry red chilly": ["red chilli", "red chilly", "dry chilli"],
    "jalepeno": ["jalapeno"],
    "milk": ["milk", "doodh"], "curd_yogurt": ["curd", "yogurt", "yoghurt", "dahi"],
    "ghee": ["ghee"], "butter": ["butter", "makhan"], "cream": ["cream", "malai"],
    "egg": ["egg"], "eggs": ["egg"],
    "raw_chicken": ["chicken"], "raw_fish": ["fish"],
    "raw_mutton": ["mutton", "lamb"], "raw_prawn": ["prawn", "shrimp"],
    "basmati_rice": ["basmati", "rice"], "sona_masoori_rice": ["rice"],
    "idli_rice": ["rice"], "rice_flour": ["rice flour"],
    "atta_flour": ["atta", "wheat flour"],
    "besan_flour": ["besan", "gram flour", "chickpea flour"],
    "maida_flour": ["maida", "all purpose flour", "all-purpose flour"],
    "sooji_rava": ["sooji", "suji", "rava", "semolina"],
    "bajra_flour": ["bajra"], "jowar_flour": ["jowar"], "ragi_flour": ["ragi"],
    "toor_dal": ["toor dal", "tur dal", "arhar"], "chana_dal": ["chana dal"],
    "moong_dal_split": ["moong dal", "mung dal"], "moong_whole": ["moong", "mung bean"],
    "masoor_dal": ["masoor dal", "red lentil"], "urad_dal": ["urad dal"],
    "rajma_bean": ["rajma", "kidney bean"], "kala_chana": ["kala chana", "black chickpea"],
    "chickpea": ["chickpea", "chole", "chana"],
    "black_eyed_peas": ["black eyed peas", "lobia"],
    "mustard_oil": ["mustard oil"], "groundnut_oil": ["groundnut oil", "peanut oil"],
    "coconut_oil": ["coconut oil"], "sesame_oil": ["sesame oil", "til oil"],
    "sunflower_oil": ["sunflower oil"],
    "jaggery": ["jaggery", "gur"], "sugar": ["sugar", "cheeni"],
    "salt": ["salt", "namak"], "turmeric": ["turmeric", "haldi"],
    "cumin": ["cumin", "jeera"], "mustard_seeds": ["mustard seed"],
    "fennel_seeds": ["fennel", "saunf"],
    "coriander_seeds": ["coriander seed", "dhaniya"],
    "hing_block": ["hing", "asafoetida"], "tamarind": ["tamarind", "imli"],
    "cinnamom stick": ["cinnamon"], "cardamom": ["cardamom", "elaichi"],
    "clove": ["clove", "laung"], "bay_leaf": ["bay leaf", "tejpatta"],
    "star_anise": ["star anise"], "nutmeg": ["nutmeg"],
    "black_pepper": ["black pepper", "kali mirch"],
}

def normalize_class(name: str) -> str:
    """Accept either a raw YOLO class ('toor_dal') or a display label ('Toor dal')."""
    return name.strip().lower().replace("/", "_").replace("-", "_").replace(" ", "_")

def patterns_for(name: str) -> list[str]:
    key = normalize_class(name)
    if key in CLASS_ALIASES:
        return CLASS_ALIASES[key]
    # Fall back to the human-friendly form
    return [key.replace("_", " ")]

def load_recipes() -> list[dict]:
    """Streaming CSV read — avoids a pandas dependency."""
    if not RECIPES_CSV.exists():
        print(f"[recipes] CSV not found at {RECIPES_CSV}; /recipes will return [].")
        return []
    recipes: list[dict] = []
    with RECIPES_CSV.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for i, row in enumerate(reader):
            name = (row.get("TranslatedRecipeName") or row.get("RecipeName") or "").strip()
            ings = (row.get("TranslatedIngredients") or row.get("Ingredients") or "").strip()
            if not name or not ings:
                continue
            try:
                minutes = int(float(row.get("TotalTimeInMins") or 0))
            except ValueError:
                minutes = 0
            try:
                servings = int(float(row.get("Servings") or 2))
            except ValueError:
                servings = 2
            recipes.append({
                "id": f"r{i}",
                "name": name,
                "ingredients_text": ings.lower(),
                "ingredients_list": [x.strip() for x in ings.split(",") if x.strip()],
                "minutes": minutes,
                "cuisine": (row.get("Cuisine") or "").strip(),
                "course": (row.get("Course") or "").strip(),
                "diet": (row.get("Diet") or "").strip(),
                "servings": servings,
                "instructions": (row.get("TranslatedInstructions") or row.get("Instructions") or "").strip(),
                "url": (row.get("URL") or "").strip(),
            })
    return recipes

print(f"[recipes] loading {RECIPES_CSV.name}")
RECIPES: list[dict] = load_recipes()
print(f"[recipes] {len(RECIPES)} indexed")

def color_for(name: str) -> str:
    h = int(hashlib.md5(name.encode("utf-8")).hexdigest()[:6], 16) % 360
    return f"hsl({h} 55% 42%)"

def match_count(pantry_patterns: list[list[str]], text: str) -> int:
    n = 0
    for pats in pantry_patterns:
        if any(p in text for p in pats):
            n += 1
    return n

def recipe_tags(r: dict) -> list[str]:
    d = r["diet"].lower()
    tags: list[str] = []
    if "vegetarian" in d and "non" not in d:
        tags.append("Veg")
    if "high protein" in d:
        tags.append("High protein")
    if r["minutes"] and r["minutes"] <= 30:
        tags.append("Quick")
    if "diabetic" in d:
        tags.append("Low GI")
    return tags

def passes_filter(r: dict, filters: list[str]) -> bool:
    d = r["diet"].lower()
    text = r["ingredients_text"]
    if "Veg" in filters:
        if "non" in d or any(x in text for x in ("chicken", "mutton", "fish", "prawn", "egg ")):
            return False
    if "High protein" in filters and "high protein" not in d:
        return False
    if "Quick" in filters and (not r["minutes"] or r["minutes"] > 30):
        return False
    if "Low GI" in filters and "diabetic" not in d:
        return False
    return True

def parse_steps(instructions: str) -> list[dict]:
    if not instructions:
        return []
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", instructions) if p.strip()]
    steps: list[dict] = []
    for i, p in enumerate(parts[:12]):
        m = re.search(r"(\d+)\s*(min|minute|minutes|hour|hours|sec|seconds?)", p.lower())
        if m:
            n = int(m.group(1))
            unit = m.group(2)
            seconds = n * 3600 if "hour" in unit else n * 60 if "min" in unit else n
        else:
            seconds = 60
        first = p.split(",", 1)[0].split(".", 1)[0].strip()
        title = (first[:40] + "…") if len(first) > 40 else first or f"Step {i + 1}"
        steps.append({"title": title, "detail": p, "seconds": max(5, min(seconds, 3600))})
    return steps

class RecipeQuery(BaseModel):
    have: list[str] = []
    filters: list[str] = []
    limit: int = 24

@app.post("/recipes")
def recipes_endpoint(q: RecipeQuery):
    pantry_patterns = [patterns_for(h) for h in q.have] if q.have else []
    results: list[tuple[int, int, int, dict]] = []
    for r in RECIPES:
        if not passes_filter(r, q.filters):
            continue
        total = max(1, len(r["ingredients_list"]))
        matched = match_count(pantry_patterns, r["ingredients_text"]) if pantry_patterns else 0
        if pantry_patterns and matched == 0:
            continue
        pct = int(round(100 * matched / total)) if pantry_patterns else 0
        results.append((pct, matched, total, r))

    if pantry_patterns:
        results.sort(key=lambda t: (t[0], t[1]), reverse=True)
    else:
        # No pantry: show quick, highly-rated staples (shortest cook time first).
        results = [(0, 0, max(1, len(r["ingredients_list"])), r)
                   for r in RECIPES if passes_filter(r, q.filters) and r["minutes"]]
        results.sort(key=lambda t: t[3]["minutes"])

    out: list[dict] = []
    for pct, matched, total, r in results[: q.limit]:
        matched_cls: list[str] = []
        text = r["ingredients_text"]
        for h, pats in zip(q.have, pantry_patterns):
            if any(p in text for p in pats):
                matched_cls.append(h)
        # Missing: first few recipe ingredients not covered by pantry
        missing: list[str] = []
        for ing in r["ingredients_list"]:
            low = ing.lower()
            if any(p in low for pats in pantry_patterns for p in pats):
                continue
            short = re.split(r"[\-\(]", ing, 1)[0].strip().strip(",")
            # trim leading amount tokens like "1 tablespoon "
            short = re.sub(r"^\s*(\d+\S*\s+)+", "", short)
            if short:
                missing.append(short[:40])
            if len(missing) >= 3:
                break
        tags = recipe_tags(r)
        quick_v = 100 if r["minutes"] and r["minutes"] <= 30 else max(10, 100 - (r["minutes"] or 60))
        out.append({
            "id": r["id"],
            "name": r["name"],
            "match": pct,
            "minutes": r["minutes"],
            "tags": tags,
            "uses": matched_cls,
            "missing": missing,
            "color": color_for(r["name"]),
            "reasons": [
                {"label": "Uses what you have", "value": pct},
                {"label": "Fits your diet", "value": 85 if "Veg" in tags else 60},
                {"label": "Quick to make", "value": quick_v},
            ],
        })
    return out

@app.get("/recipes/{rid}")
def recipe_detail(rid: str):
    r = next((x for x in RECIPES if x["id"] == rid), None)
    if r is None:
        raise HTTPException(404, "Recipe not found")
    return {
        "id": r["id"],
        "name": r["name"],
        "minutes": r["minutes"],
        "cuisine": r["cuisine"],
        "course": r["course"],
        "diet": r["diet"],
        "servings": r["servings"],
        "url": r["url"],
        "color": color_for(r["name"]),
        "tags": recipe_tags(r),
        "ingredients": r["ingredients_list"],
        "steps": parse_steps(r["instructions"]),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
