// Shared helpers that turn backend Detection[] into pantry Item[] and
// merge detections from several shots. Used by both the Detect page
// (single shot) and the Scan page (all shots in one pass).

import { Item } from './data';
import { Detection, detectIngredients } from './inference';

export function colorFor(className: string): string {
  let h = 0;
  for (let i = 0; i < className.length; i++) h = (h * 31 + className.charCodeAt(i)) & 0xffffffff;
  return `hsl(${Math.abs(h) % 360} 55% 42%)`;
}

export function defaultsFor(className: string): { qty: number; unit: Item['unit']; step: number } {
  const n = className.toLowerCase();
  if (n.endsWith('_oil')) return { qty: 0.5, unit: 'L', step: 0.25 };
  if (n === 'milk' || n === 'cream') return { qty: 0.5, unit: 'L', step: 0.25 };
  if (n.endsWith('_flour') || n === 'sooji_rava' || n === 'salt' || n === 'sugar' || n === 'jaggery') {
    return { qty: 500, unit: 'g', step: 100 };
  }
  if (n.endsWith('_rice') || n.endsWith('_dal') || n === 'rajma_bean' || n === 'chickpea' ||
      n === 'kala_chana' || n === 'black_eyed_peas' || n === 'moong_whole') {
    return { qty: 500, unit: 'g', step: 100 };
  }
  if (n.startsWith('raw_') || n === 'paneer' || n === 'butter' || n === 'ghee' || n === 'curd_yogurt') {
    return { qty: 250, unit: 'g', step: 50 };
  }
  if (n.includes('leaves') || n === 'spinach') return { qty: 100, unit: 'g', step: 20 };
  if (n === 'eggs') return { qty: 6, unit: 'pcs', step: 1 };
  return { qty: 1, unit: 'pcs', step: 1 };
}

export function toItem(d: Detection): Item {
  const d_ = defaultsFor(d.className);
  return {
    id: d.id,
    name: d.label,
    conf: Math.round(d.confidence * 100),
    qty: d_.qty,
    unit: d_.unit,
    step: d_.step,
    color: colorFor(d.className),
    box: [d.box.x, d.box.y, d.box.w, d.box.h],
  };
}

/** Collapse repeat classes across all shots: keep the highest-confidence sighting. */
export function detectionsToItems(dets: Detection[]): Item[] {
  const byClass = new Map<string, Item>();
  for (const d of dets) {
    const it = toItem(d);
    const prev = byClass.get(it.name);
    if (!prev || it.conf > prev.conf) byClass.set(it.name, it);
  }
  return Array.from(byClass.values()).sort((a, b) => b.conf - a.conf);
}

/** Run detection on every shot sequentially, with progress callback. */
export async function detectAllShots(
  sources: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Item[]> {
  onProgress?.(0, sources.length);
  const all: Detection[] = [];
  for (let i = 0; i < sources.length; i++) {
    const dets = await detectIngredients(sources[i]);
    all.push(...dets);
    onProgress?.(i + 1, sources.length);
  }
  return detectionsToItems(all);
}
