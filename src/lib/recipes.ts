// Recipe fetch client. Talks to the same FastAPI backend as inference.ts.

export type FetchedRecipe = {
  id: string;
  name: string;
  match: number;          // 0..100
  minutes: number;
  tags: string[];
  uses: string[];         // pantry class names actually used
  missing: string[];      // short names of up-to-3 recipe ingredients not in pantry
  color: string;
  reasons: { label: string; value: number }[];
};

export type RecipeDetail = {
  id: string;
  name: string;
  minutes: number;
  cuisine: string;
  course: string;
  diet: string;
  servings: number;
  url: string;
  color: string;
  tags: string[];
  ingredients: string[];
  steps: { title: string; detail: string; seconds: number }[];
};

const BASE: string =
  ((import.meta.env.VITE_DETECT_URL as string | undefined)?.replace(/\/detect\/?$/, '')) ??
  'http://localhost:8000';

export async function fetchRecipes(
  have: string[],
  filters: string[],
  limit = 24,
): Promise<FetchedRecipe[]> {
  const res = await fetch(`${BASE}/recipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ have, filters, limit }),
  });
  if (!res.ok) throw new Error(`Recipes backend returned ${res.status}`);
  return (await res.json()) as FetchedRecipe[];
}

export async function fetchRecipe(id: string): Promise<RecipeDetail> {
  const res = await fetch(`${BASE}/recipes/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Recipe ${id} returned ${res.status}`);
  return (await res.json()) as RecipeDetail;
}
