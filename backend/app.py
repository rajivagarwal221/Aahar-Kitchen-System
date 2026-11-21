"""AHAAR detection backend.

Loads two YOLO models at startup and serves both:

    POST /detect?model=ingredients   (default) - 107-class fridge-interior
                                                  ingredient detector trained
                                                  on fruit-veg + indian-spices
                                                  + the group's scraped set.
                                                  Backs the Scan/Detect/Pantry
                                                  flow.
    POST /detect?model=dishes                   - 20-class IndianFood20 plated
                                                  dish classifier produced by
                                                  the §VI ablation (best
                                                  ablation cell).
    POST /detect/dishes                         - alias for /detect?model=dishes

Both models stay resident on the GPU (~100 MB total VRAM). Startup warms
them with a zero-tensor forward pass each so the first request isn't the
slow one.

Backwards compatible: existing clients that POST /detect with no `model`
param get the 107-class ingredient detector exactly as before.
"""
from __future__ import annotations

import io
import json
import os
import re
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from ultralytics import YOLO
except ImportError as e:
    raise SystemExit("pip install ultralytics fastapi uvicorn python-multipart pillow") from e

# --- model path ---------------------------------------------------------------
# Resolution order:
#   1. MODEL_PATH env var (explicit absolute path on disk).
#   2. backend/best.pt (copied in from a training run).
#   3. MODEL_URL env var (any direct-download URL — your own mirror).
#   4. Hugging Face: Rajiv221/aahar-ingredient-detector (default).
#   5. MODEL_URL_FALLBACK env var (second mirror in case HF 404s).
#
# Keep two of {2, 3, 5} populated in production so the backend is not held
# hostage by a single checkpoint source. Each download is written to
# backend/best.pt and reused on subsequent boots.

_HF_DEFAULT = "https://huggingface.co/Rajiv221/aahar-ingredient-detector/resolve/main/best.pt"
BACKEND_DIR = Path(__file__).parent

def _download(url: str, dst: Path) -> bool:
    from urllib.error import URLError, HTTPError
    from urllib.request import urlretrieve
    try:
        print(f"[model] fetching {dst.name} from {url} ...")
        urlretrieve(url, str(dst))
        size_mb = dst.stat().st_size / (1024 * 1024)
        print(f"[model] downloaded {size_mb:.1f} MB")
        return True
    except (URLError, HTTPError, OSError) as e:
        print(f"[model] failed from {url}: {e}")
        if dst.exists():
            dst.unlink()
        return False


def _resolve(slot: str, filename: str, hf_default: str | None) -> str | None:
    """Return a path to a .pt for the given slot, downloading as needed.
    Resolution order mirrors the single-model version for the ingredients slot;
    the dishes slot is optional — if no local file and no URL provided, we
    simply skip loading (the /detect/dishes endpoint returns 503)."""
    env_path = os.environ.get(f"MODEL_PATH_{slot.upper()}")
    if slot == "ingredients" and not env_path:
        env_path = os.environ.get("MODEL_PATH")  # backcompat with the old var
    if env_path and Path(env_path).exists():
        return env_path

    local = BACKEND_DIR / filename
    if local.exists():
        return str(local)

    url = os.environ.get(f"MODEL_URL_{slot.upper()}") or (hf_default if slot == "ingredients" else None)
    if slot == "ingredients" and not url:
        url = os.environ.get("MODEL_URL") or hf_default
    url_fallback = os.environ.get(f"MODEL_URL_FALLBACK_{slot.upper()}")
    if slot == "ingredients" and not url_fallback:
        url_fallback = os.environ.get("MODEL_URL_FALLBACK")

    if url and _download(url, local):
        return str(local)
    if url_fallback and _download(url_fallback, local):
        return str(local)
    return None

import numpy as np  # for warm-up

CONF = float(os.environ.get("CONF", "0.25"))
IOU  = float(os.environ.get("IOU",  "0.45"))

# --- ingredient detector (required — backend refuses to boot without it) ------
_ing_path = _resolve("ingredients", "best.pt", _HF_DEFAULT)
if not _ing_path:
    raise SystemExit(
        "\n".join([
            "[model] Could not resolve the ingredients detector. Options:",
            "          - Copy a .pt file to backend/best.pt (cheapest),",
            "          - Set MODEL_URL to a working mirror,",
            "          - Set MODEL_URL_FALLBACK to a second mirror,",
            "          - Set MODEL_PATH to an absolute path on disk.",
            "        See backend/README.md § 'Model resolution' for details.",
        ])
    )
print(f"[model] loading ingredients model from {_ing_path}")
model_ing = YOLO(_ing_path)
model_ing.predict(np.zeros((640, 640, 3), dtype=np.uint8), verbose=False)
print(f"[model] ingredients ready: {len(model_ing.names)} classes")

# --- dishes classifier (optional — present only if the IF20 ablation ran) -----
_dish_path = _resolve("dishes", "best_dishes.pt", None)
model_dish = None
if _dish_path:
    print(f"[model] loading dishes model from {_dish_path}")
    model_dish = YOLO(_dish_path)
    model_dish.predict(np.zeros((640, 640, 3), dtype=np.uint8), verbose=False)
    print(f"[model] dishes ready: {len(model_dish.names)} classes")
else:
    print("[model] dishes model not configured; /detect?model=dishes will 503")

# Legacy alias so any code expecting the single `model` global still works.
model = model_ing
MODEL_PATH = _ing_path

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

# CORS policy:
#   - Local dev (dev server at :5173) and the FastAPI self-origin always work.
#   - Production origins come from the ALLOWED_ORIGINS env var, a
#     comma-separated list of exact hostnames (e.g. "https://ahaar.vercel.app").
#   - To fall back to wide-open for a quick demo, set ALLOWED_ORIGINS="*".
_DEFAULT_ALLOWED = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
]
_env = (os.environ.get("ALLOWED_ORIGINS") or "").strip()
if _env == "*":
    _allowed, _allow_credentials = ["*"], False
elif _env:
    _allowed = [o.strip() for o in _env.split(",") if o.strip()] + _DEFAULT_ALLOWED
    _allow_credentials = True
else:
    _allowed, _allow_credentials = _DEFAULT_ALLOWED, True
print(f"[cors] allowed origins: {_allowed}")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
    allow_credentials=_allow_credentials,
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
    return {
        "status": "ok",
        "models": {
            "ingredients": {"loaded": True, "classes": len(model_ing.names)},
            "dishes": {"loaded": model_dish is not None,
                       "classes": len(model_dish.names) if model_dish is not None else 0},
        },
        # Backwards compat with older clients that only checked top-level `classes`.
        "classes": len(model_ing.names),
    }


def _pick(model_name: Optional[str]):
    """Resolve ?model=... to the loaded YOLO. Default is the ingredients detector."""
    key = (model_name or "ingredients").strip().lower()
    if key in ("", "ingredients", "ing", "ingredient"):
        return model_ing, "ingredients"
    if key in ("dishes", "dish", "if20"):
        if model_dish is None:
            raise HTTPException(503, "The dishes model is not loaded on this backend. "
                                     "Promote a dishes checkpoint to backend/best_dishes.pt "
                                     "(see backend/README.md) and restart.")
        return model_dish, "dishes"
    raise HTTPException(400, f"Unknown model: {model_name!r}. Use 'ingredients' or 'dishes'.")


async def _infer(file: UploadFile, chosen) -> list[Det]:
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Expected an image upload")
    raw = await file.read()
    from PIL import Image
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"Could not read image: {e}")

    W, H = img.size
    res = chosen.predict(img, conf=CONF, iou=IOU, verbose=False)[0]
    out: list[Det] = []
    if res.boxes is None:
        return out
    boxes = res.boxes.xyxy.cpu().numpy()
    confs = res.boxes.conf.cpu().numpy()
    clses = res.boxes.cls.cpu().numpy().astype(int)
    for i in range(len(boxes)):
        x1, y1, x2, y2 = boxes[i].tolist()
        cid = int(clses[i])
        raw_name = chosen.names[cid]
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


@app.post("/detect", response_model=List[Det])
async def detect(
    file: UploadFile = File(...),
    model: Optional[str] = Query(None, description="'ingredients' (default) or 'dishes'"),
):
    chosen, _ = _pick(model)
    return await _infer(file, chosen)


@app.post("/detect/dishes", response_model=List[Det])
async def detect_dishes(file: UploadFile = File(...)):
    chosen, _ = _pick("dishes")
    return await _infer(file, chosen)


@app.post("/detect/ingredients", response_model=List[Det])
async def detect_ingredients(file: UploadFile = File(...)):
    chosen, _ = _pick("ingredients")
    return await _infer(file, chosen)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
