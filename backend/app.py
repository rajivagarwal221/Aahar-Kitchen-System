"""AHAAR detection backend.

Loads best.pt once at startup, exposes POST /detect that takes an image
and returns ingredient detections as JSON. Keeps the model warm; typical
response time ~50-150 ms on an RTX 3050.
"""
from __future__ import annotations

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
_URL_PRIMARY   = os.environ.get("MODEL_URL") or _HF_DEFAULT
_URL_FALLBACK  = os.environ.get("MODEL_URL_FALLBACK")

MODEL_PATH = os.environ.get("MODEL_PATH")
if not MODEL_PATH:
    local = Path(__file__).parent / "best.pt"
    if local.exists():
        MODEL_PATH = str(local)
    else:
        from urllib.error import URLError, HTTPError
        from urllib.request import urlretrieve

        def _try(url: str) -> bool:
            try:
                print(f"[model] fetching best.pt from {url} ...")
                urlretrieve(url, str(local))
                size_mb = local.stat().st_size / (1024 * 1024)
                print(f"[model] downloaded {size_mb:.1f} MB")
                return True
            except (URLError, HTTPError, OSError) as e:
                print(f"[model] failed from {url}: {e}")
                if local.exists():
                    local.unlink()  # don't leave a half-file behind
                return False

        downloaded = _try(_URL_PRIMARY) or (_URL_FALLBACK and _try(_URL_FALLBACK))
        if not downloaded:
            raise SystemExit(
                "\n".join([
                    "[model] Could not fetch best.pt from any configured source.",
                    "        Options:",
                    "          - Copy a .pt file to backend/best.pt (cheapest),",
                    f"          - Set MODEL_URL to a working mirror (tried {_URL_PRIMARY}),",
                    "          - Set MODEL_URL_FALLBACK to a second mirror,",
                    "          - Set MODEL_PATH to an absolute path on disk.",
                    "        See backend/README.md § 'Model resolution' for details.",
                ])
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
