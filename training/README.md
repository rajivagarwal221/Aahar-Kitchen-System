# AHAAR detector — training protocol

Reproducible YOLO training, evaluation, and ablation for the AHAAR
fridge-interior ingredient detector. Everything below runs from a cold
clone on an RTX 3050 (or any CUDA-capable GPU; drop `device: 0` to
`cpu` in the configs to run on CPU, slowly).

The pipeline produces every number and plot the IEEE project report
embeds in §VII (mAP@50, mAP@50:95, per-class precision/recall, latency,
and a four-cell ablation bar chart).

---

## 0 · Install

```bash
# Optional: isolate from the backend deps
python -m venv .venv && source .venv/bin/activate         # macOS / Linux
# .venv\Scripts\activate                                  # Windows PowerShell
pip install -r training/requirements-ml.txt
```

Ultralytics will auto-download the base YOLO weights
(`yolov8m.pt`, `yolo11m.pt`, `yolo11l.pt`) on first use.

### Important: install the CUDA build of PyTorch

`pip install torch` from PyPI installs a CPU-only build on Windows and
most Linux distros. Training a YOLO model on CPU is effectively
impossible (hours per epoch instead of minutes). On a CUDA-capable
machine, follow up the install with:

```powershell
pip uninstall -y torch torchvision
# CUDA 12.1 (matches current NVIDIA drivers on Windows and Linux):
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
# If your driver is older, try the CUDA 11.8 build instead:
#   pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

Then verify:

```powershell
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no-gpu')"
```

Expected: `True  NVIDIA GeForce RTX 3050 ...`.
`train.py` now resolves `device: auto` (the default in every config)
to `cuda:0` when a GPU is visible and prints a loud message with the
exact `pip install` command above when it falls back to CPU, so you
will know immediately if CUDA isn't wired up.

---

## 1 · Datasets

### AHAAR-Fridge (the primary contribution)

**You shoot this.** Target: 20 Indian pantry classes × ~150 photos per
class in realistic household lighting (tube-light, LED, warm bulb,
door-light). A 120/30 train/val split per class is enough for demo
quality; publishable numbers want 500–1000 images per class.

Required on-disk layout (already created as empty `.gitkeep`
placeholders):

```
data/
  images/train/*.jpg
  images/val/*.jpg
  labels/train/*.txt   # YOLO format: cls xc yc w h, normalised 0–1
  labels/val/*.txt
```

Class list and `data.yaml` are in `datasets/ahaar-fridge.yaml`. Label
with [Roboflow](https://roboflow.com) or [LabelImg](https://github.com/HumanSignal/labelImg).

### Smoke test the pipeline first (optional, ~10 minutes)

Before you invest days in shooting + labeling, verify the full
pipeline (train → eval → plot → export) actually works on your box
with a disposable synthetic dataset:

```bash
python datasets/scripts/make_smoke_dataset.py          # 48 + 20 fake PNGs
python training/train.py --config training/configs/yolov8m_baseline.yaml
python training/evaluate.py --run yolov8m_baseline
python training/plot.py --run yolov8m_baseline
```

The model learns nothing useful (the images are flat-colour
rectangles); the point is to catch install / path / GPU bugs in
minutes instead of after a 3-hour real run. A tripwire file,
`data/images/train/.AHAAR_SMOKE_MARKER`, is written so you can tell
smoke data from real data at a glance. **Delete the smoke `.png` /
`.txt` files before shooting AHAAR-Fridge for real** — the file set is
small enough that `del /q data\images\train\smoke_* data\labels\train\smoke_*`
on Windows (or `rm data/images/train/smoke_* data/labels/train/smoke_*`
on *nix) wipes it in one command.

### IndianFood20 (the stage-1 pretraining target)

Dish-level (plated) Indian food, 20 classes, from Pandey et al.,
IEEE ICDEW 2022 (arXiv:2205.04841). Used only to pre-season the
backbone before fine-tuning on AHAAR-Fridge.

```bash
# needs a free Kaggle account + kaggle.json in ~/.kaggle/
bash datasets/scripts/fetch_indianfood20.sh
```

The script downloads, unzips, drops classes outside AHAAR's whitelist,
and rewrites the folder-per-class layout into YOLO form. Final location:
`datasets/raw/indianfood20/` (git-ignored).

---

## 2 · Train

Each ablation cell has its own YAML; nothing else differs between
runs. `train.py` is a thin wrapper that forwards the YAML straight to
`ultralytics.YOLO.train()`.

```bash
# Baselines (~45 min each on an RTX 3050 @ 50 epochs, 640 px)
python training/train.py --config training/configs/yolov8m_baseline.yaml
python training/train.py --config training/configs/yolov11m_baseline.yaml

# Two-stage transfer: first the stage-1 pretrain on IndianFood20…
python training/train.py --config training/configs/stage1_if20_yolov11m.yaml
python training/train.py --config training/configs/stage1_if20_yolov11l.yaml

# …then the stage-2 fine-tune on AHAAR-Fridge.
python training/train.py --config training/configs/yolov11m_if20_pretrain.yaml
python training/train.py --config training/configs/yolov11l_if20_pretrain.yaml
```

Weights land at `results/<run>/weights/best.pt`; per-epoch metrics at
`results/<run>/results.csv`.

---

## 3 · Evaluate

```bash
python training/evaluate.py --run yolov11m_baseline
```

Writes two artifacts under `results/<run>/`:

| File                | Contents                                         |
|---------------------|--------------------------------------------------|
| `metrics.json`      | mAP@50, mAP@50:95, overall P/R/F1, latency (CPU & CUDA), parameters, weights size, and a `per_class` array |
| `per_class.csv`     | one row per class, directly citable in the report |

Pass `--no-latency` on CI runners without a GPU.

---

## 4 · Ablation (one command)

```bash
python training/ablate.py           # run everything missing
python training/ablate.py --dry-run # print the plan without running
python training/ablate.py --only yolov11m_baseline yolov8m_baseline
```

After each cell completes the script re-aggregates
`results/ablation.csv`, which is the table the report cites:

| run                     | label                         | mAP@50 | mAP@50:95 | P | R | F1 | params M | weights MB | CPU ms | CUDA ms |
|-------------------------|-------------------------------|--------|-----------|---|---|----|----------|------------|--------|---------|
| yolov8m_baseline        | YOLOv8m (baseline)            |   —    |     —     | — | — | —  |    —     |     —      |   —    |    —    |
| yolov11m_baseline       | YOLOv11m (baseline)           |   —    |     —     | — | — | —  |    —     |     —      |   —    |    —    |
| yolov11m_if20_pretrain  | YOLOv11m + IF20 pretrain      |   —    |     —     | — | — | —  |    —     |     —      |   —    |    —    |
| yolov11l_if20_pretrain  | YOLOv11l + IF20 pretrain      |   —    |     —     | — | — | —  |    —     |     —      |   —    |    —    |

---

## 5 · Plots for the report

```bash
python training/plot.py                       # all plots for all runs
python training/plot.py --run yolov11m_baseline
```

Produces:

- `results/ablation_bars.png` — the four-cell comparison for §VII.
- `results/<run>/per_class_bars.png` — horizontal bar chart of per-class mAP@50.
- `results/<run>/training_curves.png` — loss + mAP across epochs.

All plots are 180 DPI PNGs, sized to drop straight into IEEEtran
`\includegraphics[width=\linewidth]{...}`.

---

## 6 · Export for the backend

The backend (`backend/app.py`) loads a YOLO checkpoint and serves
`POST /detect`. Replace the currently-served Hugging Face checkpoint
with your freshly-trained one in one command:

```bash
python training/promote.py --run yolov11m_if20_pretrain
```

This copies `results/<run>/weights/best.pt` to `backend/best.pt`,
exports an ONNX next to it for browser-side inference, runs a
zero-tensor smoke forward pass to confirm both load, backs up any
previous `backend/best.pt` as `.pt.bak`, writes a promotion record
to `backend/.promoted.json`, and flags class-count drift against
`src/lib/classNames.ts`.

Flags:
- `--weights <path>` — promote a specific file instead of a run.
- `--no-onnx` — skip the ONNX export (saves 10–20 s).
- `--no-smoke-check` — skip the forward-pass verification.
- `--allow-smoke` — force-promote weights trained on the smoke
  dataset; off by default to prevent synthetic-rectangle models
  from reaching production.

Restart the backend to pick up the new weights:

```bash
cd backend && python app.py
```

---

## What lands in the paper

Four claims this pipeline is set up to defend:

1. **Fridge-interior dataset is a real contribution.** Existing Indian
   food datasets (FoodNet 2017, IndianFood10 2022, IndianFoodNet 2023)
   are all *plated* meals. AHAAR-Fridge is ingredient-level and
   fridge-interior — the data.yaml class list reflects this.
2. **Two-stage transfer helps.** The baseline cells (1, 2) vs the
   pretrained cells (3, 4) isolate the effect of IndianFood20
   stage-1 pretraining on final mAP.
3. **Backbone scale matters, but not linearly.** Cells 3 vs 4 isolate
   the YOLOv11m → YOLOv11l jump at the same data budget.
4. **Latency is honest.** The reported ms/image comes from a measured
   median over 300 warm runs, not a marketing number.
