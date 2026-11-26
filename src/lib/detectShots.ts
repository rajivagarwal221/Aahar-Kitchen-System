// Turns backend Detection[] into pantry Item[] and merges detections from
// several shots. Used by the Detect page (one shot) and the Scan page (all shots).

import { displayName } from './classNames';
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
  if (n.endsWith('_rice') || n.endsWith('_dal') || n === 'chickpea' ||
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

/** A pantry item for a class the user picked by hand. */
export function manualItem(className: string): Item {
  return { id: className, name: displayName(className), conf: 100, ...defaultsFor(className), color: colorFor(className), box: [0, 0, 0, 0] };
}

/**
 * One item per class. The box and confidence come from the best sighting;
 * for things counted in pieces the quantity is how many boxes were found.
 */
export function detectionsToItems(dets: Detection[]): Item[] {
  const best = new Map<string, Detection>();
  const count = new Map<string, number>();
  for (const d of dets) {
    count.set(d.className, (count.get(d.className) ?? 0) + 1);
    const prev = best.get(d.className);
    if (!prev || d.confidence > prev.confidence) best.set(d.className, d);
  }
  return Array.from(best.values())
    .sort((a, b) => b.confidence - a.confidence)
    .map((d) => {
      const base = defaultsFor(d.className);
      const n = count.get(d.className) ?? 1;
      return {
        id: d.className,
        name: d.label,
        conf: Math.round(d.confidence * 100),
        qty: base.unit === 'pcs' && d.className !== 'eggs' ? n : base.qty,
        unit: base.unit,
        step: base.step,
        color: colorFor(d.className),
        box: [d.box.x, d.box.y, d.box.w, d.box.h],
      };
    });
}

/**
 * Merge detections from several shots into one item per class. Piece counts
 * take the highest count seen in any single shot, so two overlapping photos
 * of the same shelf do not double the quantity.
 */
export function mergeShots(perShot: Detection[][]): Item[] {
  const maxCount = new Map<string, number>();
  for (const dets of perShot) {
    for (const it of detectionsToItems(dets)) {
      maxCount.set(it.id, Math.max(maxCount.get(it.id) ?? 0, it.qty));
    }
  }
  return detectionsToItems(perShot.flat()).map((it) =>
    it.unit === 'pcs' && it.id !== 'eggs' ? { ...it, qty: maxCount.get(it.id) ?? it.qty } : it,
  );
}

/** Run detection on every shot in turn, reporting progress after each one. */
export async function detectAllShots(
  sources: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Item[]> {
  onProgress?.(0, sources.length);
  const perShot: Detection[][] = [];
  for (let i = 0; i < sources.length; i++) {
    perShot.push(await detectIngredients(sources[i]));
    onProgress?.(i + 1, sources.length);
  }
  return mergeShots(perShot);
}
