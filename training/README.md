# AAhar food-detector training

Two-click workflow: open the Colab notebook, Run All, walk away.

## Layout

```
data/
  images/{train,val}/   # one .jpg/.png per sample
  labels/{train,val}/   # one .txt per image, YOLO format: `<class_id> <xc> <yc> <w> <h>` (normalized 0-1)
aahar.yaml              # YOLO dataset config - classes auto-populated by notebook
notebooks/
  train_aahar_detector.ipynb   # Run All on a Colab T4
```

## Getting the dataset onto Colab

The notebook accepts one of:
- `DATASET_SOURCE="hf://<repo-id>"` - pulls a Hugging Face dataset
- `DATASET_SOURCE="gdrive://<folder-id>"` - mounts Drive and copies
- `DATASET_SOURCE="url://<zip-url>"` - downloads and unzips

Set the variable in the first config cell before Run All.

## Secrets

- `HF_TOKEN` - the notebook reads it from a Colab secret (left sidebar → key icon → "Add new secret"). Used only to push `best.pt` + ONNX + TFLite to your HF model repo.

## Outputs

After training the notebook uploads to `<HF_USERNAME>/aahar-detector`:
- `best.pt` - PyTorch weights
- `best.onnx` - for `onnxruntime-web` on the frontend
- `best.tflite` - for mobile
- `aahar.yaml` - class list snapshot
