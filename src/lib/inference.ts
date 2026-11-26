// Detection pipeline for AHAAR.
//
// The model runs server-side (FastAPI + ultralytics on your RTX). The
// browser posts the image to /detect and renders the returned boxes.
// Set VITE_DETECT_URL in .env.local to point at the backend. Without it,
// `npm run dev` sends /detect to the Vite dev server, which proxies it to
// http://localhost:8000 (see vite.config.ts), so phones on the LAN work too.

export type Detection = {
  id: string;
  classId: number;
  className: string;      // pantry key, e.g. 'toor_dal'. For a branded pack it is the
                          // mapped ingredient ('butter' for Amul butter) or, if none,
                          // the packaged class ('maggi_noodles').
  label: string;          // display, e.g. 'Toor dal', 'Amul Butter'
  confidence: number;     // 0..1
  box: { x: number; y: number; w: number; h: number }; // % of original image
  source?: 'ingredients' | 'dishes' | 'packaged';  // which backend model found it
  brand?: string;         // packaged class, e.g. 'amul_butter' (packaged hits only)
};

const DETECT_URL: string =
  (import.meta.env.VITE_DETECT_URL as string | undefined) ||
  (import.meta.env.DEV ? '/detect' : 'http://localhost:8000/detect');

async function dataUrlToBlob(src: string): Promise<Blob> {
  // If src is already a blob: or http(s): URL, fetch it (works for both).
  const r = await fetch(src);
  return await r.blob();
}

/** Scan for pantry items. The backend runs the ingredient model and, when
 * backend/best_packaged.pt is installed, the packaged-brand model too, and
 * returns one merged list. */
export async function detectIngredients(
  imageSrc: string,
  onProgress?: (pct: number) => void,
): Promise<Detection[]> {
  onProgress?.(0.05);
  const blob = await dataUrlToBlob(imageSrc);
  onProgress?.(0.25);
  const form = new FormData();
  form.append('file', blob, 'scan.jpg');

  let res: Response;
  try {
    res = await fetch(DETECT_URL, { method: 'POST', body: form });
  } catch {
    // fetch rejects with a bare "Failed to fetch" when nothing is listening.
    throw new Error(
      `Could not reach the detection backend at ${DETECT_URL}. ` +
      'Start it with "python backend/app.py", or set VITE_DETECT_URL.',
    );
  }
  onProgress?.(0.9);
  if (!res.ok) {
    throw new Error(
      `Detection backend returned ${res.status}. ` +
      `Is it running at ${DETECT_URL}? Start it with "python backend/app.py" (see backend/README.md).`,
    );
  }
  const dets = (await res.json()) as Detection[];
  onProgress?.(1);
  return dets;
}

/** Dish-level classification of a finished plated meal. Hits the
 * backend's `/detect/dishes` endpoint (loaded from the IndianFood20
 * ablation checkpoint). Returns 0 or more dishes with confidence —
 * the first entry is the top prediction. */
export async function classifyDish(imageSrc: string): Promise<Detection[]> {
  const blob = await dataUrlToBlob(imageSrc);
  const form = new FormData();
  form.append('file', blob, 'dish.jpg');
  const url = DETECT_URL.replace(/\/detect\/?$/, '/detect/dishes');
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: form });
  } catch {
    throw new Error(
      `Could not reach the dish classifier at ${url}. ` +
      'Make sure the backend is running and backend/best_dishes.pt is in place.',
    );
  }
  if (res.status === 503) {
    throw new Error('The dish classifier isn\'t loaded on this backend. ' +
      'Run `python training/promote.py --run yolov11m_if20_pretrain --as dishes` to install it.');
  }
  if (!res.ok) {
    throw new Error(`Dish classifier returned ${res.status}.`);
  }
  return (await res.json()) as Detection[];
}

/** No-op in server-side mode; kept so pages that call it compile. */
export function warmUpModel(): Promise<void> {
  return fetch(DETECT_URL.replace('/detect', '/health'))
    .then(() => undefined)
    .catch(() => undefined);
}
