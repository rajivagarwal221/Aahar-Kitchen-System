# AHAAR detection backend

A FastAPI app that serves up to three YOLO models side by side. Each has its
own file in `backend/`, so promoting one never touches the others
(`backend/slots.py`):

| Slot | File | Classes must match | Needed? |
|------|------|--------------------|---------|
| `ingredients` | `best.pt` | `src/lib/classNames.ts` (107) | yes, won't boot without it |
| `dishes` | `best_dishes.pt` | `datasets/indianfood20.yaml` (20) | optional |
| `packaged` | `best_packaged.pt` + `pantry_map_packaged.json` | `datasets/packaged/classes.csv` (59) | optional |

Install a model with `training/promote.py` (it picks the slot from the class
list and refuses a model whose classes don't match the slot):

```powershell
python training/promote.py --weights runs/aahar_ingredients_v54/weights/best.pt   # -> best.pt
python training/promote.py --run yolov11m_baseline --as dishes                    # -> best_dishes.pt
python training/promote.py --weights <Drive>/runs/aahar_packaged_v1/weights/best.pt --as packaged
```

At startup the backend loads every slot that has a file, and logs whether
each one's classes match the repo list. A missing optional slot just makes
its endpoint return 503.

## Local run (your RTX 3050)

```powershell
cd backend
pip install -r requirements.txt
python app.py
```

First boot resolves `best.pt` using the order below. Subsequent starts are
instant — the file is cached at `backend/best.pt`. Visit
http://localhost:8000/health to check.

## API

### `GET /health`
```json
{ "status": "ok", "classes": 107,
  "models": {
    "ingredients": { "loaded": true,  "classes": 107, "classCheck": "ok" },
    "dishes":      { "loaded": true,  "classes": 20,  "classCheck": "ok" },
    "packaged":    { "loaded": false, "classes": 0,   "classCheck": null } } }
```

### `POST /detect`
multipart form field `file` (the image). With no `model` param this is the
pantry scan: the ingredient model plus, if loaded, the packaged model, merged
into one list. A branded pack that maps to a pantry ingredient comes back
under that ingredient (`className: "butter"`, `label: "Amul Butter"`,
`brand: "amul_butter"`); if it overlaps an ingredient box for the same item,
only the branded one is kept. Unmapped packs keep their own class
(`maggi_noodles`).

`POST /detect?model=ingredients|dishes|packaged` or `POST /detect/<slot>`
runs one model only.

```json
[
  { "id": "73-0", "classId": 73, "className": "paneer",
    "label": "Paneer", "confidence": 0.94,
    "box": { "x": 12.3, "y": 20.1, "w": 28.6, "h": 24.2 },
    "source": "ingredients", "brand": null }
]
```

## Model resolution

Per slot, the backend tries `MODEL_PATH_<SLOT>`, then `backend/<file>`, then
`MODEL_URL_<SLOT>`, then `MODEL_URL_FALLBACK_<SLOT>` (e.g.
`MODEL_URL_PACKAGED`). The packaged slot falls back to
`https://huggingface.co/Rajiv221/aahar-packaged-detector/resolve/main/best.pt`
(and fetches `pantry_map.json` from the same repo); if that repo doesn't exist
the slot is skipped. For the ingredients slot the older names below still
work, in this order:

1. **`MODEL_PATH`** env var → use the `.pt` at this absolute path.
2. **`backend/best.pt`** → if a file is already on disk.
3. **`MODEL_URL`** env var → any direct-download URL (your own mirror).
4. **Hugging Face default** → `https://huggingface.co/Rajiv221/aahar-ingredient-detector/resolve/main/best.pt` (used if `MODEL_URL` is unset).
5. **`MODEL_URL_FALLBACK`** env var → a second mirror in case the primary 404s.

If every source fails, the process exits with a clear message naming the
options — the backend never boots with a broken detector.

### Avoiding the single-point-of-failure

The Hugging Face repo above is a convenience; don't let it be the only copy.
Recommended setups:

- **Vendor your own checkpoint.** After training, commit the file to a
  GitHub Release (free, up to 2 GB per asset) and set
  `MODEL_URL=https://github.com/<you>/<repo>/releases/download/<tag>/best.pt`.
- **Bake into the image.** If you containerise the backend, copy
  `best.pt` into the image at build time. The `backend/best.pt` branch
  of the resolver catches it with no network needed.
- **Mirror to a second host.** Set `MODEL_URL_FALLBACK` to a copy on
  another CDN (e.g. an S3 or R2 bucket, or Google Drive direct link).

## Environment overrides
| Var                   | Default                                 | Purpose |
|-----------------------|-----------------------------------------|---------|
| `MODEL_PATH`          | –                                       | Absolute path to a `.pt`; skips all downloads |
| `MODEL_URL`           | HF `Rajiv221/aahar-ingredient-detector` | Primary download URL |
| `MODEL_URL_FALLBACK`  | –                                       | Second mirror if primary fails |
| `CONF`                | `0.25`                                  | Detection confidence threshold |
| `IOU`                 | `0.45`                                  | NMS IoU threshold |
| `ALLOWED_ORIGINS`     | `localhost:5173, localhost:8000`        | Comma-separated origins allowed via CORS; use `*` for wide-open demos |

## CORS

The service starts with a locked-down allow-list (local dev + self). To
accept requests from a deployed frontend, set
`ALLOWED_ORIGINS="https://your-vercel-domain.app"` (comma-separate
multiple). The local-dev origins are always appended, so you never lose
localhost testing. Setting `ALLOWED_ORIGINS=*` reverts to wide-open and
disables credentialed requests.
