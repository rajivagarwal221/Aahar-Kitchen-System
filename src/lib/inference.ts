// Detection pipeline for AHAAR.
//
// The model runs server-side (FastAPI + ultralytics on your RTX). The
// browser posts the image to /detect and renders the returned boxes.
// Set VITE_DETECT_URL in .env.local to point at the backend; defaults
// to http://localhost:8000/detect for local dev.

export type Detection = {
  id: string;
  classId: number;
  className: string;      // raw, e.g. 'toor_dal'
  label: string;          // display, e.g. 'Toor dal'
  confidence: number;     // 0..1
  box: { x: number; y: number; w: number; h: number }; // % of original image
};

const DETECT_URL: string =
  (import.meta.env.VITE_DETECT_URL as string | undefined) ??
  'http://localhost:8000/detect';

async function dataUrlToBlob(src: string): Promise<Blob> {
  // If src is already a blob: or http(s): URL, fetch it (works for both).
  const r = await fetch(src);
  return await r.blob();
}

export async function detectIngredients(
  imageSrc: string,
  onProgress?: (pct: number) => void,
): Promise<Detection[]> {
  onProgress?.(0.05);
  const blob = await dataUrlToBlob(imageSrc);
  onProgress?.(0.25);
  const form = new FormData();
  form.append('file', blob, 'scan.jpg');

  const res = await fetch(DETECT_URL, { method: 'POST', body: form });
  onProgress?.(0.9);
  if (!res.ok) {
    throw new Error(
      `Detection backend returned ${res.status}. ` +
      `Is it running at ${DETECT_URL}? See backend/README.md.`,
    );
  }
  const dets = (await res.json()) as Detection[];
  onProgress?.(1);
  return dets;
}

/** No-op in server-side mode; kept so pages that call it compile. */
export function warmUpModel(): Promise<void> {
  return fetch(DETECT_URL.replace('/detect', '/health'))
    .then(() => undefined)
    .catch(() => undefined);
}
