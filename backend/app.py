"""AHAAR detection backend.

Serves up to three YOLO models side by side (see backend/slots.py):

    ingredients  backend/best.pt           107-class ingredient detector (required)
    dishes       backend/best_dishes.pt    20-class IndianFood20 dish model (optional)
    packaged     backend/best_packaged.pt  59-class branded packaged-food model (optional)

Endpoints:

    POST /detect                 Scan: ingredients + packaged (if loaded), merged.
                                 A packaged hit that maps to a pantry ingredient
                                 (amul_butter -> butter) is returned under that
                                 ingredient's className, with the brand attached.
    POST /detect?model=<slot>    One model only: ingredients | dishes | packaged.
    POST /detect/<slot>          Same, as a path.
    GET  /health                 Which slots are loaded, and whether each one's
                                 classes match the repo's class list.

Optional slots that have no weights are skipped at startup and their endpoints
return 503. With only best.pt present, POST /detect behaves exactly as before.
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

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import slots as S  # noqa: E402  (backend/slots.py)

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


def _resolve(slot: str) -> str | None:
    """Return a path to the slot's .pt, downloading as needed.
    Order: MODEL_PATH_<SLOT>, backend/<file>, MODEL_URL_<SLOT>, MODEL_URL_FALLBACK_<SLOT>.
    The ingredients slot also honours the old MODEL_PATH / MODEL_URL /
    MODEL_URL_FALLBACK names and falls back to the Hugging Face default."""
    up = slot.upper()
    ing = slot == "ingredients"
    env_path = os.environ.get(f"MODEL_PATH_{up}") or (os.environ.get("MODEL_PATH") if ing else None)
    if env_path and Path(env_path).exists():
        return env_path

    local = BACKEND_DIR / S.SLOTS[slot]["file"]
    if local.exists():
        return str(local)

    url = os.environ.get(f"MODEL_URL_{up}") or (os.environ.get("MODEL_URL") or _HF_DEFAULT if ing else None)
    url_fallback = os.environ.get(f"MODEL_URL_FALLBACK_{up}") or (os.environ.get("MODEL_URL_FALLBACK") if ing else None)
    if url and _download(url, local):
        return str(local)
    if url_fallback and _download(url_fallback, local):
        return str(local)
    return None

import numpy as np  # for warm-up

CONF = float(os.environ.get("CONF", "0.25"))
IOU  = float(os.environ.get("IOU",  "0.45"))

# --- load every slot that has weights -----------------------------------------
MODELS: dict = {}          # slot -> YOLO
CLASS_CHECK: dict = {}     # slot -> "ok" | "mismatch: ..." | "unchecked"

for _slot, _cfg in S.SLOTS.items():
    _path = _resolve(_slot)
    if not _path:
        if _cfg["required"]:
            raise SystemExit("\n".join([
                "[model] Could not resolve the ingredients detector. Options:",
                "          - Copy a .pt file to backend/best.pt (cheapest),",
                "          - Set MODEL_URL to a working mirror,",
                "          - Set MODEL_URL_FALLBACK to a second mirror,",
                "          - Set MODEL_PATH to an absolute path on disk.",
                "        See backend/README.md § 'Model resolution' for details.",
            ]))
        print(f"[model] {_slot}: no backend/{_cfg['file']}; /detect/{_slot} will 503")
        continue
    print(f"[model] loading {_slot} model from {_path}")
    _m = YOLO(_path)
    _m.predict(np.zeros((640, 640, 3), dtype=np.uint8), verbose=False)
    MODELS[_slot] = _m

    # The UI's lists (Pantry ingredients, packaged pantry map) assume a fixed
    # class order per slot. A model promoted into the wrong slot breaks them.
    _got = S.model_names(_m)
    _exp = S.expected_classes(_slot)
    if _exp is None:
        CLASS_CHECK[_slot] = "unchecked"
        print(f"[model] {_slot} ready: {len(_got)} classes (no repo class list to check against)")
    else:
        _d = S.diff_classes(_got, _exp)
        CLASS_CHECK[_slot] = "ok" if _d is None else f"mismatch: {_d}"
        if _d is None:
            print(f"[model] {_slot} ready: {len(_got)} classes, match the repo list")
        else:
            _hint = S.suggest_slot(_got)
            print(f"[model] WARNING: {_slot} classes don't match the repo list ({_d})."
                  + (f" This looks like a {_hint} model: promote it with --as {_hint}." if _hint else ""))

PACKAGED_MAP = S.load_packaged_map() if "packaged" in MODELS else {}

# Legacy aliases so code expecting the old globals still works.
model_ing = MODELS["ingredients"]
model_dish = MODELS.get("dishes")
model = model_ing

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
    className: str     # pantry key: ingredient class, or packaged class if unmapped
    label: str
    confidence: float
    box: dict          # {x, y, w, h} in % of original image
    source: str = "ingredients"   # which slot produced it
    brand: Optional[str] = None   # packaged class (e.g. 'amul_butter') for packaged hits


@app.get("/health")
def health():
    return {
        "status": "ok",
        "models": {
            slot: {"loaded": slot in MODELS,
                   "classes": len(MODELS[slot].names) if slot in MODELS else 0,
                   "classCheck": CLASS_CHECK.get(slot)}
            for slot in S.SLOTS
        },
        # Backwards compat with older clients that only checked top-level `classes`.
        "classes": len(model_ing.names),
    }


_ALIASES = {
    "ingredients": "ingredients", "ingredient": "ingredients", "ing": "ingredients",
    "dishes": "dishes", "dish": "dishes", "if20": "dishes",
    "packaged": "packaged", "package": "packaged", "brands": "packaged", "brand": "packaged",
}


def _pick(model_name: Optional[str]) -> str:
    """Resolve ?model=... to a loaded slot name."""
    key = _ALIASES.get((model_name or "ingredients").strip().lower())
    if key is None:
        raise HTTPException(400, f"Unknown model: {model_name!r}. Use one of {list(S.SLOTS)}.")
    if key not in MODELS:
        raise HTTPException(503, f"The {key} model is not loaded on this backend. "
                                 f"Promote a checkpoint to backend/{S.SLOTS[key]['file']} "
                                 f"(python training/promote.py --weights <best.pt> --as {key}) and restart.")
    return key


async def _read_image(file: UploadFile):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Expected an image upload")
    raw = await file.read()
    from PIL import Image
    try:
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"Could not read image: {e}")


def _packaged_label(cls: str) -> tuple[str, Optional[str]]:
    """(label, pantry ingredient) for a packaged class."""
    info = PACKAGED_MAP.get(cls) or {}
    brand, product = info.get("brand") or "", (info.get("product") or "").split(" (")[0]
    if brand and product:
        label = product if product.lower().startswith(brand.lower()[:5]) else f"{brand} {product}"
    else:
        label = display(cls)
    return label, info.get("pantry")


def _infer(img, slot: str) -> list[Det]:
    chosen = MODELS[slot]
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
        class_name, label, brand = raw_name, display(raw_name), None
        if slot == "packaged":
            label, pantry = _packaged_label(raw_name)
            brand = raw_name
            class_name = pantry or raw_name
        out.append(Det(
            id=f"{slot[0]}{cid}-{i}",
            classId=cid,
            className=class_name,
            label=label,
            confidence=float(confs[i]),
            box={
                "x": max(0.0, x1) / W * 100,
                "y": max(0.0, y1) / H * 100,
                "w": max(0.0, x2 - x1) / W * 100,
                "h": max(0.0, y2 - y1) / H * 100,
            },
            source=slot,
            brand=brand,
        ))
    out.sort(key=lambda d: d.confidence, reverse=True)
    return out


def _iou(a: dict, b: dict) -> float:
    ax2, ay2, bx2, by2 = a["x"] + a["w"], a["y"] + a["h"], b["x"] + b["w"], b["y"] + b["h"]
    iw = max(0.0, min(ax2, bx2) - max(a["x"], b["x"]))
    ih = max(0.0, min(ay2, by2) - max(a["y"], b["y"]))
    inter = iw * ih
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union > 0 else 0.0


def _scan(img) -> list[Det]:
    """Ingredients + packaged, merged. Where a branded pack and an ingredient
    box name the same pantry item in the same place, keep the branded one."""
    dets = _infer(img, "ingredients")
    if "packaged" not in MODELS:
        return dets
    packs = _infer(img, "packaged")
    dets = [d for d in dets
            if not any(p.className == d.className and _iou(p.box, d.box) > 0.3 for p in packs)]
    merged = dets + packs
    merged.sort(key=lambda d: d.confidence, reverse=True)
    return merged


@app.post("/detect", response_model=List[Det])
async def detect(
    file: UploadFile = File(...),
    model: Optional[str] = Query(None, description="omit for a merged scan, or one of: ingredients, dishes, packaged"),
):
    img = await _read_image(file)
    if model is None or model.strip().lower() in ("", "scan", "all"):
        return _scan(img)
    return _infer(img, _pick(model))


@app.post("/detect/{slot}", response_model=List[Det])
async def detect_slot(slot: str, file: UploadFile = File(...)):
    key = _pick(slot)
    return _infer(await _read_image(file), key)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
