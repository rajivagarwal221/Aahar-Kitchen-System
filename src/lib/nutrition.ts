// Pantry nutrition client. Talks to the same FastAPI backend.

export type Nutrition = {
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
  sugar: number;
  fibre: number;
  sodium: number;
  calcium: number;
  iron: number;
  vitamin_c: number;
  folate: number;
};

export type PantryDishNutrition = {
  recipe_id: string;
  recipe_name: string;
  match: number;
  nutrition_source: string;
  nutrition: Nutrition;
};

export type TopNutrient = {
  key: keyof Nutrition;
  label: string;
  value: number;
  daily_pct: number;
};

export type PantryNutritionResult = {
  available: boolean;
  dishes_considered?: number;
  dishes: PantryDishNutrition[];
  totals: Partial<Nutrition>;
  top_nutrients: TopNutrient[];
};

const BASE: string =
  ((import.meta.env.VITE_DETECT_URL as string | undefined)?.replace(/\/detect\/?$/, '')) ??
  'http://localhost:8000';

export async function fetchPantryNutrition(have: string[], topN = 12): Promise<PantryNutritionResult> {
  const res = await fetch(`${BASE}/nutrition/pantry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ have, top_n: topN }),
  });
  if (!res.ok) throw new Error(`Nutrition backend returned ${res.status}`);
  return (await res.json()) as PantryNutritionResult;
}

/** Unit for a nutrient key — matches the CSV's column headers. */
export const UNITS: Record<keyof Nutrition, string> = {
  calories: 'kcal',
  carbs: 'g',
  protein: 'g',
  fat: 'g',
  sugar: 'g',
  fibre: 'g',
  sodium: 'mg',
  calcium: 'mg',
  iron: 'mg',
  vitamin_c: 'mg',
  folate: 'µg',
};
