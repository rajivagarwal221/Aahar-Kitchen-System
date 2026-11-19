// Weekly meal planner.
//
// Given a short questionnaire (diet, max cook-time per slot, excluded
// ingredients) plus the household's pantry and family conditions, fills
// 7 days * 3 slots with recipes that are health-adapted, non-repeating,
// and tilted towards each slot's role (lighter breakfasts, substantial
// lunches/dinners).
//
// Uses the already-ranked recipes from src/lib/recipes.ts, so every
// scoring rule (family fit, diabetes/cardiac/reflux penalties) applies.

import { Member } from './store';
import { Nutrition, rankRecipes, Recipe, Scored } from './recipes';

export type Slot = 'breakfast' | 'lunch' | 'dinner';
export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner'];
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type Day = (typeof DAYS)[number];

export type PlanPrefs = {
  diet: 'veg' | 'egg' | 'any';
  maxMinutes: { breakfast: number; lunch: number; dinner: number };
  excludeKeys: string[];  // detector class keys to avoid (e.g. ['raw_prawn'])
  diverseWindow: number;  // no recipe repeats within this many days
};

export type PlannedCell = {
  day: Day;
  slot: Slot;
  scored: Scored | null;    // null = nothing fit
};

export type DayNutrition = {
  day: Day;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
  sodium: number;
};

export type GeneratedPlan = {
  cells: PlannedCell[];      // 21 entries, day-major
  dayTotals: DayNutrition[]; // 7 entries
  weekTotal: DayNutrition;
  shopping: { key: string; name: string; recipes: string[] }[]; // consolidated missing ingredients
};

const SLOT_CAP: Record<Slot, (n: Nutrition) => number> = {
  // Lighter breakfasts: preference drops as calories rise above 350.
  breakfast: (n) => Math.max(0, 1 - Math.max(0, n.calories - 350) / 400),
  // Lunches: 400-650 kcal is ideal.
  lunch: (n) => Math.max(0, 1 - Math.abs(n.calories - 525) / 400),
  // Dinners: 350-600 kcal is ideal, slight prefer-lower.
  dinner: (n) => Math.max(0, 1 - Math.abs(n.calories - 475) / 400),
};

const SLOT_COURSE: Record<Slot, (course: string) => boolean> = {
  breakfast: (c) => /breakfast|brunch|snack/i.test(c) || c === '',
  lunch:     (c) => !/dessert|snack|side|appetiz/i.test(c),
  dinner:    (c) => !/dessert|snack|appetiz/i.test(c),
};

function dietOk(r: Recipe, want: PlanPrefs['diet']): boolean {
  if (want === 'any') return true;
  if (want === 'veg') return r.diet === 'veg';
  return r.diet === 'veg' || r.diet === 'egg';
}

function excludes(r: Recipe, excludeKeys: string[]): boolean {
  if (excludeKeys.length === 0) return false;
  const set = new Set(excludeKeys);
  return r.core.some((k) => set.has(k)) || r.ingredients.some((i) => i.key && set.has(i.key));
}

/** Slot-biased score. Reuses the family-aware `match` and layers a slot
 * suitability bonus, a nutrition tilt, and a "preferred time" check. */
function slotScore(s: Scored, slot: Slot, prefs: PlanPrefs): number {
  const r = s.recipe;
  if (r.minutes > prefs.maxMinutes[slot]) return -Infinity;
  if (!SLOT_COURSE[slot](r.course)) return -Infinity;
  // Base: family-aware match from rankRecipes.
  let score = s.match;
  // Nutrition tilt: only if the recipe has nutrition data.
  if (r.nutrition) {
    score += SLOT_CAP[slot](r.nutrition) * 20;
  }
  // Fast recipes nudged up for breakfast; dinners don't need that nudge.
  if (slot === 'breakfast' && r.minutes <= 25) score += 8;
  return score;
}

const ZERO_NUT: DayNutrition = {
  day: 'Mon', calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0, sodium: 0,
};

function accrue(acc: DayNutrition, n: Nutrition | undefined): DayNutrition {
  if (!n) return acc;
  return {
    ...acc,
    calories: acc.calories + n.calories,
    protein:  acc.protein  + n.protein,
    carbs:    acc.carbs    + n.carbs,
    fat:      acc.fat      + n.fat,
    fibre:    acc.fibre    + n.fibre,
    sodium:   acc.sodium   + n.sodium,
  };
}

/** Pick the best candidate not already used in the recent diversity window. */
function pickBest(
  candidates: Scored[],
  slot: Slot,
  prefs: PlanPrefs,
  usedRecently: Map<string, number>, // recipe id -> dayIdx last used
  dayIdx: number,
): Scored | null {
  let best: Scored | null = null;
  let bestScore = -Infinity;
  for (const s of candidates) {
    const sc = slotScore(s, slot, prefs);
    if (sc === -Infinity) continue;
    const last = usedRecently.get(s.recipe.id);
    if (last !== undefined && dayIdx - last < prefs.diverseWindow) continue;
    if (sc > bestScore) {
      bestScore = sc;
      best = s;
    }
  }
  return best;
}

export function generatePlan(
  recipes: Recipe[],
  pantry: Set<string>,
  members: Member[],
  prefs: PlanPrefs,
): GeneratedPlan {
  const ranked = rankRecipes(recipes, pantry, members)
    .filter((s) => dietOk(s.recipe, prefs.diet) && !excludes(s.recipe, prefs.excludeKeys));

  const cells: PlannedCell[] = [];
  const usedRecently = new Map<string, number>();
  const dayTotals: DayNutrition[] = [];
  const weekTotal: DayNutrition = { ...ZERO_NUT, day: 'Mon' };
  const shopping = new Map<string, { name: string; recipes: Set<string> }>();

  for (let d = 0; d < DAYS.length; d++) {
    let dayNut: DayNutrition = { ...ZERO_NUT, day: DAYS[d] };
    const usedInDay = new Set<string>();
    for (const slot of SLOTS) {
      const candidates = ranked.filter((s) => !usedInDay.has(s.recipe.id));
      const chosen = pickBest(candidates, slot, prefs, usedRecently, d);
      cells.push({ day: DAYS[d], slot, scored: chosen });
      if (chosen) {
        usedRecently.set(chosen.recipe.id, d);
        usedInDay.add(chosen.recipe.id);
        dayNut = accrue(dayNut, chosen.recipe.nutrition);
        // Consolidate missing ingredients across the week.
        for (const key of chosen.missing) {
          const entry = shopping.get(key) ?? { name: humanise(key), recipes: new Set() };
          entry.recipes.add(chosen.recipe.name);
          shopping.set(key, entry);
        }
      }
    }
    dayTotals.push(dayNut);
    weekTotal.calories += dayNut.calories;
    weekTotal.protein  += dayNut.protein;
    weekTotal.carbs    += dayNut.carbs;
    weekTotal.fat      += dayNut.fat;
    weekTotal.fibre    += dayNut.fibre;
    weekTotal.sodium   += dayNut.sodium;
  }

  return {
    cells,
    dayTotals,
    weekTotal,
    shopping: [...shopping.entries()]
      .map(([key, v]) => ({ key, name: v.name, recipes: [...v.recipes] }))
      .sort((a, b) => b.recipes.length - a.recipes.length),
  };
}

function humanise(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Default questionnaire state tailored to typical Indian household use. */
export function defaultPrefs(members: Member[]): PlanPrefs {
  // If nobody at the table eats meat/eggs, auto-switch to veg.
  const anyNonVeg = members.length === 0 ? true : members.some((m) => /nonveg|non-veg/i.test(m.disease));
  return {
    diet: anyNonVeg ? 'any' : 'veg',
    maxMinutes: { breakfast: 25, lunch: 45, dinner: 60 },
    excludeKeys: [],
    diverseWindow: 3,
  };
}
