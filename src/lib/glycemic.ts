// Per-member glycemic sensitivity: learn from logged meals + CGM, then
// use the learned signal to predict how a new recipe will affect each
// family member's post-prandial glucose.
//
// The approach is deliberately transparent and shippable with as little
// as one logged meal:
//
//   1. For each logged meal that has nutrition AND a CGM window of
//      >=30 min post-prandial, compute the incremental AUC above
//      baseline (iAUC_120) over the 2 hours after the meal.
//   2. The member's Glycemic Sensitivity Index (GSI) is the median
//      ratio of iAUC_120 to the meal's (carbs + 0.5*sugar - 0.3*fibre).
//      Fibre is subtracted because it blunts the response; sugar is
//      double-counted because it spikes faster than complex carbs.
//   3. For an unseen recipe, predicted spike = GSI * (carbs + ...).
//      We bucket this into low / medium / high relative to a
//      population baseline (GSI_POP = 1.5 mg/dL·h / g).
//
// Honesty: GSI is estimated, not measured — the UI labels it as such,
// says how many meals it's based on, and falls back to a neutral
// "Not enough data" state when there are no matched (meal, CGM) pairs.
//
// Reference for the AUC framing: Zeevi et al., Cell 2015
// (PersonalizedNutrition.pdf in /papers) + Huo et al., IEEE BHI 2019.

import { GlucosePoint, MealEntry } from './store';
import { Nutrition } from './recipes';

/** Representative "typical" GSI in mg/dL·h per gram of carb-equivalent.
 * Used as the denominator when bucketing a predicted spike. */
export const GSI_POPULATION = 1.5;

export type GlycemicSummary = {
  memberId: number;
  gsi: number | null;              // null => not enough data
  usedMeals: number;               // meals that matched a CGM window
  totalMeals: number;              // total logged meals for this member
  aucs: { ts: string; auc: number; carbs: number; recipeName: string }[];
};

export type RecipeImpact = {
  spike: number;                   // predicted post-prandial AUC in mg/dL·h
  band: 'low' | 'medium' | 'high';
  colour: '#3F6B3A' | '#E0A21B' | '#C8432A';
  label: 'Low impact' | 'Medium impact' | 'High impact';
};

/** Effective glycemic carbohydrate: discount by fibre, surcharge for free sugar. */
export function carbEquivalent(n: Pick<Nutrition, 'carbs' | 'sugar' | 'fibre'>): number {
  return Math.max(0, n.carbs + 0.5 * n.sugar - 0.3 * n.fibre);
}

/** 2-hour incremental area under the curve above baseline (mg/dL·h), trapezoidal. */
function iauc120(points: GlucosePoint[], mealTs: string): number | null {
  const t0 = Date.parse(mealTs);
  const t2 = t0 + 2 * 3600 * 1000;
  const window = points
    .filter((p) => {
      const t = Date.parse(p.ts);
      return t >= t0 && t <= t2;
    })
    .sort((a, b) => a.ts.localeCompare(b.ts));
  if (window.length < 3) return null; // Not enough resolution to score.

  // Baseline: the lowest of the first three points at/after the meal.
  const baseline = Math.min(window[0].mgdl, window[1].mgdl, window[2].mgdl);

  let auc = 0;
  for (let i = 1; i < window.length; i++) {
    const dtH = (Date.parse(window[i].ts) - Date.parse(window[i - 1].ts)) / 3_600_000;
    const dMean = (window[i - 1].mgdl + window[i].mgdl) / 2 - baseline;
    auc += Math.max(0, dMean) * dtH;
  }
  return auc;
}

/** Compute one member's Glycemic Sensitivity Index from their logged meals. */
export function computeGsi(
  memberId: number,
  meals: MealEntry[],
  glucose: GlucosePoint[],
): GlycemicSummary {
  const mine = meals.filter((m) => m.memberId === memberId);
  const theirPoints = glucose.filter((g) => g.memberId === memberId);
  const rows: GlycemicSummary['aucs'] = [];

  for (const m of mine) {
    if (!m.nutrition) continue;
    const ce = carbEquivalent(m.nutrition) * m.servings;
    if (ce < 5) continue; // Trivial carb load — ratios are noisy.
    const auc = iauc120(theirPoints, m.ts);
    if (auc === null) continue;
    rows.push({ ts: m.ts, auc, carbs: ce, recipeName: m.recipeName });
  }

  if (rows.length === 0) {
    return { memberId, gsi: null, usedMeals: 0, totalMeals: mine.length, aucs: [] };
  }

  const ratios = rows.map((r) => r.auc / r.carbs).sort((a, b) => a - b);
  // Median keeps outliers (a big dinner, a missed reading) from dragging the model.
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return { memberId, gsi: median, usedMeals: rows.length, totalMeals: mine.length, aucs: rows };
}

/** Predict the glycemic impact of a recipe's per-serving nutrition for a
 * member with a given GSI. Returns null if either input is missing. */
export function predictImpact(
  nutrition: Nutrition | undefined,
  gsi: number | null,
): RecipeImpact | null {
  if (!nutrition || gsi == null) return null;
  const ce = carbEquivalent(nutrition);
  const spike = ce * gsi;

  // Bucket relative to a typical population response for the same carbs.
  const populationSpike = ce * GSI_POPULATION;
  const ratio = populationSpike === 0 ? 0 : spike / populationSpike;

  if (ratio < 0.7)  return { spike, band: 'low',    colour: '#3F6B3A', label: 'Low impact' };
  if (ratio < 1.3)  return { spike, band: 'medium', colour: '#E0A21B', label: 'Medium impact' };
  return                   { spike, band: 'high',   colour: '#C8432A', label: 'High impact' };
}

/** Compute GSI for every member in one go — cheap, call it in a top-level memo. */
export function computeAllGsi(
  memberIds: number[],
  meals: MealEntry[],
  glucose: GlucosePoint[],
): Map<number, GlycemicSummary> {
  const out = new Map<number, GlycemicSummary>();
  for (const id of memberIds) out.set(id, computeGsi(id, meals, glucose));
  return out;
}
