#!/usr/bin/env python3
"""Pack AHAAR's three YOLO detectors into ONE ONNX file.

    ingredients  (107 classes)  backend/best.pt
    dishes       ( 20 classes)  backend/best_dishes.pt
    packaged     ( 59 classes)  backend/best_packaged.pt
                 ---------------
    combined     (186 classes)  aahar_combined.onnx

One forward pass runs all three networks on the same 640x640 image and
returns a single standard YOLO output tensor (1, 4 + 186, 3 * 8400). Each
network's anchors carry its own class scores in its own column range and
zeros elsewhere, so ordinary YOLO post-processing (NMS) gives one list of
detections over all 186 classes. Nothing is retrained: the three networks'
weights are copied in unchanged, so accuracy is identical to running them
separately (check with --verify).

The file is a normal Ultralytics ONNX detector (YOLO('aahar_combined.onnx')
works) and also carries `aahar_slots`, which says which class-id range
belongs to which original model:

    {"ingredients": [0, 107], "dishes": [107, 127], "packaged": [127, 186]}

Usage:
    python training/combine_models.py \
        --ingredients backend/best.pt --dishes backend/best_dishes.pt \
        --packaged backend/best_packaged.pt --out backend/aahar_combined.onnx --verify img.jpg

Any of the three may be left out; the slots that are given are combined.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
import torch.nn as nn

SLOT_ORDER = ("ingredients", "dishes", "packaged")


def _prepare(pt: str):
    """Load a YOLO .pt, fused and in export mode (forward returns (B, 4+nc, N))."""
    from ultralytics import YOLO
    y = YOLO(pt)
    if y.task != "detect":
        raise SystemExit(f"{pt}: task is {y.task!r}, only detect models can be combined")
    m = y.model.fuse().eval().float()
    for p in m.parameters():
        p.requires_grad_(False)
    head = m.model[-1]
    head.export, head.format, head.dynamic = True, "onnx", False
    if getattr(head, "end2end", False):
        raise SystemExit(f"{pt}: end-to-end (NMS-free) heads are not supported")
    names = y.names
    names = [names[i] for i in sorted(names)] if isinstance(names, dict) else list(names)
    return m, names, int(max(m.stride))


class Combined(nn.Module):
    """Runs every sub-model and lays their outputs side by side.

    Sub-model k has nc_k classes and N_k anchors. Its output (B, 4+nc_k, N_k)
    is placed in rows [4+off_k, 4+off_k+nc_k) of a (B, 4+NC, N_k) block, zeros
    elsewhere; blocks are concatenated along the anchor axis."""

    def __init__(self, models: list[nn.Module], ncs: list[int]):
        super().__init__()
        self.models = nn.ModuleList(models)
        self.ncs = ncs
        self.total = sum(ncs)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        blocks, off = [], 0
        for m, nc in zip(self.models, self.ncs):
            y = m(x)
            if isinstance(y, (list, tuple)):
                y = y[0]
            boxes, scores = y[:, :4], y[:, 4:4 + nc]
            # Pad (not concatenated zero tensors): keeps the zeros out of the
            # file as constants.
            scores = nn.functional.pad(scores, (0, 0, off, self.total - off - nc))
            blocks.append(torch.cat([boxes, scores], 1))
            off += nc
        return torch.cat(blocks, 2)


def build(weights: dict[str, str], out: Path, imgsz: int = 640, opset: int = 12) -> dict:
    models, ncs, names, slots, strides = [], [], [], {}, set()
    for slot in SLOT_ORDER:
        if not weights.get(slot):
            continue
        m, n, s = _prepare(weights[slot])
        slots[slot] = [len(names), len(names) + len(n)]
        models.append(m); ncs.append(len(n)); names += n; strides.add(s)
        print(f"[combine] {slot:12s} {len(n):3d} classes  {sum(p.numel() for p in m.parameters()):,} params  ({weights[slot]})")
    if not models:
        raise SystemExit("Give at least one of --ingredients / --dishes / --packaged")

    net = Combined(models, ncs).eval()
    total_params = sum(p.numel() for p in net.parameters())
    dummy = torch.zeros(1, 3, imgsz, imgsz)
    with torch.no_grad():
        shape = tuple(net(dummy).shape)
    print(f"[combine] combined: {len(names)} classes, {total_params:,} params, output {shape}")

    out.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(net, dummy, str(out), opset_version=opset, input_names=["images"],
                      output_names=["output0"], do_constant_folding=True, dynamo=False)

    import onnx
    model = onnx.load(str(out))
    try:
        import onnxslim
        model = onnxslim.slim(model)
    except Exception as e:  # slimming is optional
        print(f"[combine] onnxslim skipped: {e}")
    meta = {
        "description": "AHAAR combined detector (ingredients + dishes + packaged)",
        "author": "AHAAR",
        "stride": str(max(strides)),
        "task": "detect",
        "batch": "1",
        "imgsz": str([imgsz, imgsz]),
        "names": str({i: n for i, n in enumerate(names)}),
        "args": str({"nms": False, "dynamic": False}),
        "channels": "3",
        "aahar_slots": json.dumps(slots),
        "aahar_params": str(total_params),
    }
    del model.metadata_props[:]
    for k, v in meta.items():
        p = model.metadata_props.add(); p.key, p.value = k, v
    onnx.save(model, str(out))
    print(f"[combine] wrote {out} ({out.stat().st_size / 1e6:.1f} MB)")
    return {"slots": slots, "names": names, "params": total_params, "path": str(out)}


def verify(weights: dict[str, str], combined: Path, image: str, conf: float = 0.25, imgsz: int = 640) -> bool:
    """Run each original .pt and the combined file on one image; compare.

    The image is letterboxed to a fixed imgsz x imgsz first. (A .pt model
    otherwise pads to the nearest multiple of 32, a static ONNX file always to
    640 x 640, and that alone shifts scores by a few points.)"""
    import cv2
    from ultralytics import YOLO
    from ultralytics.data.augment import LetterBox
    img = LetterBox((imgsz, imgsz), auto=False)(image=cv2.imread(image))
    slots = read_slots(combined)
    # The combined file can return up to 3x the detections of one model.
    comb = YOLO(str(combined), task="detect").predict(img, imgsz=imgsz, conf=conf, max_det=900, verbose=False)[0]
    ok = True
    for slot, (lo, hi) in slots.items():
        ref = YOLO(weights[slot]).predict(img, imgsz=imgsz, conf=conf, verbose=False)[0]
        rc = sorted((int(c), round(float(s), 2)) for c, s in zip(ref.boxes.cls, ref.boxes.conf))
        cc = sorted((int(c) - lo, round(float(s), 2)) for c, s in zip(comb.boxes.cls, comb.boxes.conf)
                    if lo <= int(c) < hi)
        same = len(rc) == len(cc) and all(a[0] == b[0] and abs(a[1] - b[1]) <= 0.02 for a, b in zip(rc, cc))
        print(f"[verify] {slot:12s} separate {len(rc):3d} dets, combined {len(cc):3d} dets  {'OK' if same else 'DIFFERENT'}")
        if not same:
            print(f"         separate: {rc[:8]}\n         combined: {cc[:8]}")
        ok &= same
    return ok


def read_slots(path: Path) -> dict:
    import onnxruntime as ort
    meta = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"]).get_modelmeta().custom_metadata_map
    return json.loads(meta["aahar_slots"])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ingredients"); ap.add_argument("--dishes"); ap.add_argument("--packaged")
    ap.add_argument("--out", default="backend/aahar_combined.onnx")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--verify", metavar="IMAGE", help="compare against the separate models on this image")
    a = ap.parse_args()
    w = {"ingredients": a.ingredients, "dishes": a.dishes, "packaged": a.packaged}
    build(w, Path(a.out), a.imgsz)
    if a.verify:
        raise SystemExit(0 if verify({k: v for k, v in w.items() if v}, Path(a.out), a.verify, imgsz=a.imgsz) else 1)


if __name__ == "__main__":
    main()
