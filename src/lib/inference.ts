// On-device YOLO inference for AHAAR, using onnxruntime-web.
// Model: YOLOv11m fine-tuned on 107 Indian pantry ingredient classes.
// Hosted on Hugging Face; fetched once per session and cached in memory.

import * as ort from 'onnxruntime-web';
import { CLASS_NAMES, displayName } from './classNames';

const MODEL_URL =
  'https://huggingface.co/Rajiv221/aahar-ingredient-detector/resolve/main/best.onnx';
const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.45;
const MAX_DETECTIONS = 50;

export type Detection = {
  id: string;
  classId: number;
  className: string;      // raw, e.g. 'toor_dal'
  label: string;          // display, e.g. 'Toor dal'
  confidence: number;     // 0..1
  box: { x: number; y: number; w: number; h: number }; // % of original image
};

// Lazy-loaded, cached across calls.
let sessionPromise: Promise<ort.InferenceSession> | null = null;

function loadSession(onProgress?: (pct: number) => void): Promise<ort.InferenceSession> {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    // Pin wasm files to a version that matches the installed package exactly.
    // Mismatches here cause cryptic "e.getValue is not a function" errors.
    ort.env.wasm.wasmPaths =
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
    // Disable SIMD + threads for the broadest browser support; the model
    // runs in ~3-5 s on a mid-range laptop even single-threaded, which is
    // fine for a one-shot fridge scan.
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = false;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'warning';
    const buffer = await fetchWithProgress(MODEL_URL, onProgress);
    try {
      return await ort.InferenceSession.create(buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
    } catch (e) {
      // Second attempt with lower optimisation if the first one blew up on an op.
      console.warn('[aahar] primary ORT session failed; retrying with basic opt', e);
      return await ort.InferenceSession.create(buffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'basic',
      });
    }
  })();
  return sessionPromise;
}

async function fetchWithProgress(
  url: string,
  onProgress?: (pct: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total || !onProgress) return await res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(received / total);
  }
  const all = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
  return all.buffer;
}

// Letterbox an image into INPUT_SIZE x INPUT_SIZE preserving aspect ratio.
// Returns the Float32 tensor data in CHW layout + the padding/scale needed
// to map boxes back to original pixel coordinates.
function preprocess(img: HTMLImageElement | HTMLCanvasElement | ImageBitmap): {
  data: Float32Array;
  scale: number;
  padX: number;
  padY: number;
  origW: number;
  origH: number;
} {
  const origW =
    'naturalWidth' in img ? (img as HTMLImageElement).naturalWidth : img.width;
  const origH =
    'naturalHeight' in img ? (img as HTMLImageElement).naturalHeight : img.height;
  const scale = Math.min(INPUT_SIZE / origW, INPUT_SIZE / origH);
  const newW = Math.round(origW * scale);
  const newH = Math.round(origH * scale);
  const padX = Math.floor((INPUT_SIZE - newW) / 2);
  const padY = Math.floor((INPUT_SIZE - newH) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(114,114,114)'; // YOLO letterbox pad
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(img as CanvasImageSource, padX, padY, newW, newH);

  const { data: rgba } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  const plane = INPUT_SIZE * INPUT_SIZE;
  const out = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    out[p]             = rgba[i]     / 255;   // R
    out[p + plane]     = rgba[i + 1] / 255;   // G
    out[p + 2 * plane] = rgba[i + 2] / 255;   // B
  }
  return { data: out, scale, padX, padY, origW, origH };
}

// YOLOv11 output shape: [1, 4 + nc, 8400] where nc = 107.
// Column 0..3: cx, cy, w, h in model pixels. Column 4..4+nc-1: per-class scores.
function postprocess(
  raw: Float32Array,
  dims: readonly number[],
  scale: number,
  padX: number,
  padY: number,
  origW: number,
  origH: number,
): Detection[] {
  const [, channels, proposals] = dims as [number, number, number];
  const nc = channels - 4;
  const cand: Detection[] = [];

  for (let i = 0; i < proposals; i++) {
    // find argmax over class scores for this proposal
    let bestScore = 0;
    let bestCls = -1;
    for (let c = 0; c < nc; c++) {
      const s = raw[(4 + c) * proposals + i];
      if (s > bestScore) { bestScore = s; bestCls = c; }
    }
    if (bestScore < CONF_THRESHOLD || bestCls < 0) continue;

    const cx = raw[0 * proposals + i];
    const cy = raw[1 * proposals + i];
    const w  = raw[2 * proposals + i];
    const h  = raw[3 * proposals + i];

    // model pixels -> original image pixels
    const x = (cx - w / 2 - padX) / scale;
    const y = (cy - h / 2 - padY) / scale;
    const bw = w / scale;
    const bh = h / scale;

    // skip boxes that landed completely outside the original image
    if (x + bw < 0 || y + bh < 0 || x > origW || y > origH) continue;

    const name = CLASS_NAMES[bestCls] ?? `class_${bestCls}`;
    cand.push({
      id: `${bestCls}-${i}`,
      classId: bestCls,
      className: name,
      label: displayName(name),
      confidence: bestScore,
      box: {
        x: Math.max(0, x) / origW * 100,
        y: Math.max(0, y) / origH * 100,
        w: Math.min(bw, origW - Math.max(0, x)) / origW * 100,
        h: Math.min(bh, origH - Math.max(0, y)) / origH * 100,
      },
    });
  }

  return nms(cand, IOU_THRESHOLD).slice(0, MAX_DETECTIONS);
}

function nms(dets: Detection[], iouThresh: number): Detection[] {
  dets.sort((a, b) => b.confidence - a.confidence);
  const keep: Detection[] = [];
  for (const d of dets) {
    let drop = false;
    for (const k of keep) {
      if (k.classId !== d.classId) continue;
      if (iou(d.box, k.box) > iouThresh) { drop = true; break; }
    }
    if (!drop) keep.push(d);
  }
  return keep;
}

function iou(a: Detection['box'], b: Detection['box']): number {
  const ax2 = a.x + a.w, ay2 = a.y + a.h;
  const bx2 = b.x + b.w, by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter === 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/** Run detection on an image URL. Caches the ONNX session across calls. */
export async function detectIngredients(
  imageSrc: string,
  onProgress?: (pct: number) => void,
): Promise<Detection[]> {
  const session = await loadSession(onProgress);
  const img = await loadImage(imageSrc);
  const { data, scale, padX, padY, origW, origH } = preprocess(img);
  const tensor = new ort.Tensor('float32', data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const inputName = session.inputNames[0];
  const out = await session.run({ [inputName]: tensor });
  const outputName = session.outputNames[0];
  const outTensor = out[outputName] as ort.Tensor;
  // Some ORT versions make .data a getter that throws if the tensor was
  // released; use getData() when available and fall back otherwise.
  const raw: Float32Array =
    typeof (outTensor as { getData?: () => Promise<Float32Array> }).getData === 'function'
      ? (await (outTensor as { getData: () => Promise<Float32Array> }).getData())
      : (outTensor.data as Float32Array);
  const dims = outTensor.dims as readonly number[];
  return postprocess(raw, dims, scale, padX, padY, origW, origH);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

/** Trigger model download + warm-up in the background (optional). */
export function warmUpModel(): Promise<void> {
  return loadSession().then(() => undefined).catch(() => undefined);
}
