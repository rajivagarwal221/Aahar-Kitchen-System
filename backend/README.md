# AHAAR detection backend

A ~90-line FastAPI app that loads `best.pt` and serves `POST /detect`.

## Local run (your RTX 3050)

```powershell
cd backend
pip install -r requirements.txt
python app.py
```

First boot downloads `best.pt` from Hugging Face (~40 MB) into `backend/`.
Subsequent starts are instant. Visit http://localhost:8000/health to check.

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

## Environment overrides
- `MODEL_PATH`  path to a .pt (defaults to backend/best.pt)
- `CONF`        confidence threshold (default 0.25)
- `IOU`         NMS IoU threshold (default 0.45)
