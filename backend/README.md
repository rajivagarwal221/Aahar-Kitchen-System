# AHAAR detection backend

A ~150-line FastAPI app that loads `best.pt` and serves `POST /detect`.

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
{ "status": "ok", "classes": 107 }
```

### `POST /detect`
multipart form field `file` (the image).

```json
[
  { "id": "73-0", "classId": 73, "className": "paneer",
    "label": "Paneer", "confidence": 0.94,
    "box": { "x": 12.3, "y": 20.1, "w": 28.6, "h": 24.2 } }
]
```

## Model resolution

The backend tries each source in order and stops at the first that works:

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
