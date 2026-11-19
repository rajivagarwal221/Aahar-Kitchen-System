import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { NextStep, Page, PageHeader, Reveal, ease } from '../components/Page';
import { Minus, Plus, Scale } from '../components/Icons';
import { RECIPES } from '../lib/data';
import { useKitchen } from '../lib/store';
import { fetchPantryNutrition, PantryNutritionResult, UNITS, Nutrition } from '../lib/nutrition';

function fmt(qty: number, unit: string) {
  if (unit === 'pcs') return `× ${qty}`;
  if (unit === 'L') return `${qty.toFixed(2).replace(/\.?0+$/, '')} L`;
  return `~ ${qty} g`;
}

const FALLBACK_NUTRIENTS: Record<string, string[]> = {
  Protein: ['paneer', 'milk'],
  Iron: ['spinach'],
  'Vitamin C': ['tomato', 'chilli'],
  Calcium: ['paneer', 'milk'],
};

export default function Pantry() {
  const { items, setItems } = useKitchen();
  const [hover, setHover] = useState<string | null>(null);
  const [nutri, setNutri] = useState<PantryNutritionResult | null>(null);
  const [nutriErr, setNutriErr] = useState<string | null>(null);
  const [nutriLoading, setNutriLoading] = useState(false);

  const bump = (id: string, dir: 1 | -1) =>
    setItems(items.map((i) => (i.id === id ? { ...i, qty: Math.max(0, +(i.qty + dir * i.step).toFixed(2)) } : i)));

  const have = useMemo(
    () => items.map((i) => i.className ?? i.name.toLowerCase().replace(/\s+/g, '_')),
    [items],
  );

  // Fetch dish-level nutrition from the backend, aggregated across the top
  // recipes the pantry can make.
  useEffect(() => {
    if (have.length === 0) { setNutri(null); setNutriErr(null); return; }
    let cancelled = false;
    setNutriLoading(true);
    setNutriErr(null);
    fetchPantryNutrition(have, 12)
      .then((r) => { if (!cancelled) setNutri(r); })
      .catch((e: unknown) => { if (!cancelled) setNutriErr(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setNutriLoading(false); });
    return () => { cancelled = true; };
  }, [have]);

  // Decide which nutrient nodes to show on the right of the graph.
  // Prefer the real top nutrients from the backend; fall back to the
  // ingredient-based hand-coded map when the backend is offline.
  const graphNutrients = useMemo(() => {
    if (nutri && nutri.top_nutrients.length > 0) {
      return nutri.top_nutrients.map((n) => ({
        key: n.key as keyof Nutrition,
        label: n.label,
        value: n.value,
        unit: UNITS[n.key as keyof Nutrition],
      }));
    }
    return Object.keys(FALLBACK_NUTRIENTS).map((n) => ({
      key: n as unknown as keyof Nutrition,
      label: n,
      value: 0,
      unit: '',
    }));
  }, [nutri]);

  // Ingredient -> nutrient edges. With backend data we don't have ingredient-
  // level attribution, so we draw edges from *every* pantry ingredient to the
  // top nutrients (every contribution helps). Without backend data we use the
  // hand-coded FALLBACK_NUTRIENTS map.
  const ingredientNutrientEdges = (ingredientKey: string, nutrientLabel: string): boolean => {
    if (nutri && nutri.top_nutrients.length > 0) return true;
    const list = FALLBACK_NUTRIENTS[nutrientLabel];
    return Boolean(list?.includes(ingredientKey));
  };

  // Graph layout: ingredients left, dishes middle, nutrients right.
  const graph = useMemo(() => {
    const ids = items.map((i) => i.id);
    const dishes = RECIPES.filter((r) => r.uses.some((u) => ids.includes(u)));
    const H = 360;
    const y = (i: number, n: number) => (H / (n + 1)) * (i + 1);
    const ing = items.map((it, i) => ({ id: it.id, label: it.name, x: 90, y: y(i, items.length), color: it.color }));
    const dsh = dishes.map((d, i) => ({ id: d.id, label: d.name, x: 330, y: y(i, dishes.length), color: d.color }));
    const nut = graphNutrients.map((n, i) => ({
      id: `nut-${n.label}`,
      label: n.label,
      value: n.value,
      unit: n.unit,
      x: 560,
      y: y(i, graphNutrients.length),
      color: '#3F6B3A',
    }));
    const edges: { a: string; b: string; ax: number; ay: number; bx: number; by: number }[] = [];
    for (const d of dsh) {
      const r = RECIPES.find((x) => x.id === d.id)!;
      for (const u of r.uses) {
        const s = ing.find((n) => n.id === u);
        if (s) edges.push({ a: s.id, b: d.id, ax: s.x, ay: s.y, bx: d.x, by: d.y });
      }
    }
    for (const n of nut) {
      for (const s of ing) {
        if (ingredientNutrientEdges(s.id, n.label)) {
          edges.push({ a: s.id, b: n.id, ax: s.x, ay: s.y, bx: n.x, by: n.y });
        }
      }
    }
    return { ing, dsh, nut, edges, H };
  }, [items, graphNutrients]);

  const linked = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    graph.edges.forEach((e) => {
      if (e.a === hover) s.add(e.b);
      if (e.b === hover) s.add(e.a);
    });
    return s;
  }, [hover, graph.edges]);

  const node = (
    n: { id: string; label: string; x: number; y: number; color: string; value?: number; unit?: string },
    kind: 'ing' | 'dish' | 'nut',
    i: number,
  ) => {
    const lit = !linked || linked.has(n.id);
    const w = kind === 'dish' ? 132 : kind === 'nut' ? 128 : 108;
    const showValue = kind === 'nut' && typeof n.value === 'number' && n.value > 0;
    return (
      <motion.g
        key={n.id}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: lit ? 1 : 0.25, scale: 1 }}
        transition={{ delay: hover ? 0 : 0.2 + i * 0.06, duration: 0.4, ease }}
        style={{ transformOrigin: `${n.x}px ${n.y}px`, cursor: 'pointer' }}
        onMouseEnter={() => setHover(n.id)}
        onMouseLeave={() => setHover(null)}
        tabIndex={0}
        onFocus={() => setHover(n.id)}
        onBlur={() => setHover(null)}
        role="button"
        aria-label={n.label}
      >
        <rect
          x={n.x - w / 2}
          y={n.y - 17}
          width={w}
          height={34}
          rx={17}
          fill={kind === 'dish' ? '#2B2420' : '#FFFFFF'}
          stroke={hover === n.id ? '#E0A21B' : kind === 'dish' ? '#2B2420' : 'rgba(43,36,32,0.15)'}
          strokeWidth={hover === n.id ? 2.5 : 1.2}
        />
        {kind !== 'dish' && <circle cx={n.x - w / 2 + 16} cy={n.y} r={6} fill={n.color} stroke="rgba(43,36,32,0.15)" />}
        <text
          x={kind === 'dish' ? n.x : n.x + 8}
          y={showValue ? n.y + 1 : n.y + 4.5}
          textAnchor="middle"
          fontSize={showValue ? 12 : 13}
          fontFamily="Figtree"
          fontWeight={600}
          fill={kind === 'dish' ? '#FBF6EC' : '#2B2420'}
        >
          {n.label}
        </text>
        {showValue && (
          <text
            x={n.x + 8}
            y={n.y + 13}
            textAnchor="middle"
            fontSize="10"
            fontFamily="Figtree"
            fontWeight={500}
            fill="#6F6152"
          >
            {n.value!.toFixed(n.value! >= 100 ? 0 : 1)} {n.unit}
          </text>
        )}
      </motion.g>
    );
  };

  return (
    <Page>
      <PageHeader
        step="03"
        kicker="Pantry & quantities"
        icon={<Scale />}
        title="How much you have, and what it can become."
        lead="Quantities are estimated from the size of each item in the photo. They're approximate, so nudge any of them. Every ingredient is linked to the dishes it can make and what it gives you."
      />

      {/* Nutrition profile card — real data from the dish nutrition CSV. */}
      {items.length > 0 && (
        <section className="card p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="kicker text-leaf">Nutrition profile</p>
              <h2 className="font-display text-xl mt-0.5">Per typical dish your pantry can make</h2>
            </div>
            {nutri && typeof nutri.dishes_considered === 'number' && nutri.dishes_considered > 0 && (
              <span className="chip border-leaf/30 bg-leaf/10 text-leaf !text-[0.72rem]">
                Averaged over {nutri.dishes_considered} dish{nutri.dishes_considered === 1 ? '' : 'es'}
              </span>
            )}
          </div>

          {nutriLoading && <p className="mt-3 text-[0.9rem] text-muted">Computing from the Indian Food Nutrition dataset…</p>}
          {nutriErr && (
            <p className="mt-3 text-[0.88rem] text-chilli">
              Couldn&apos;t reach the nutrition backend ({nutriErr}).
            </p>
          )}
          {!nutriLoading && !nutriErr && nutri && nutri.totals && Object.keys(nutri.totals).length > 0 && (
            <>
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {(['calories', 'protein', 'carbs', 'fat', 'fibre', 'iron'] as const).map((k) => {
                  const v = nutri.totals[k] ?? 0;
                  return (
                    <div key={k} className="rounded-xl bg-surface p-3 border border-ink/5">
                      <p className="text-[0.7rem] uppercase tracking-wider text-muted font-semibold">{k}</p>
                      <p className="font-display text-xl mt-0.5 tabular-nums">
                        {v.toFixed(v >= 100 ? 0 : 1)}
                        <span className="text-[0.8rem] text-muted ml-1 font-sans font-normal">{UNITS[k]}</span>
                      </p>
                    </div>
                  );
                })}
              </div>
              {nutri.dishes.length > 0 && (
                <p className="mt-3 text-[0.78rem] text-muted">
                  Based on dishes matching your pantry — {nutri.dishes.slice(0, 3).map((d) => d.recipe_name).join(', ')}
                  {nutri.dishes.length > 3 ? `, +${nutri.dishes.length - 3} more.` : '.'}
                </p>
              )}
            </>
          )}
          {!nutriLoading && !nutriErr && nutri && nutri.dishes.length === 0 && (
            <p className="mt-3 text-[0.88rem] text-muted">
              No dishes in the nutrition dataset matched your pantry yet. Add more staples or scan again.
            </p>
          )}
        </section>
      )}

      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-6 mt-6">
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">Your pantry</h2>
            <span className="chip border-turmeric/40 bg-turmeric/10 text-ink !text-[0.72rem]">Approximate</span>
          </div>
          {items.length === 0 ? (
            <p className="mt-4 text-muted">Nothing in the pantry yet. Run a detection first.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {items.map((it, i) => (
                <motion.li
                  key={it.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.4, ease }}
                  onMouseEnter={() => setHover(it.id)}
                  onMouseLeave={() => setHover(null)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 border transition-colors ${hover === it.id ? 'border-turmeric bg-turmeric/5' : 'border-ink/10 bg-white/60'}`}
                >
                  <span className="w-3 h-3 rounded-full border border-ink/15" style={{ background: it.color }} />
                  <span className="flex-1 font-medium">{it.name}</span>
                  <button onClick={() => bump(it.id, -1)} aria-label={`Less ${it.name}`} className="w-8 h-8 rounded-full border border-ink/15 grid place-items-center hover:bg-surface">
                    <Minus width={14} />
                  </button>
                  <motion.span key={it.qty} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="w-[74px] text-center tabular-nums text-[0.95rem]">
                    {fmt(it.qty, it.unit)}
                  </motion.span>
                  <button onClick={() => bump(it.id, 1)} aria-label={`More ${it.name}`} className="w-8 h-8 rounded-full border border-ink/15 grid place-items-center hover:bg-surface">
                    <Plus width={14} />
                  </button>
                </motion.li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-[0.82rem] text-muted">Approximate. You can correct it.</p>
        </section>

        <section className="card p-4 md:p-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl">Pantry graph</h2>
            <div className="flex gap-3 text-[0.78rem] text-muted">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-white border border-ink/20" /> Ingredient</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-ink" /> Dish</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-leaf" /> Nutrient</span>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <svg viewBox={`0 0 650 ${graph.H}`} className="min-w-[560px] w-full h-auto" role="img" aria-label="Graph linking ingredients to dishes and nutrients">
              {graph.edges.map((e, i) => {
                const lit = !hover || e.a === hover || e.b === hover;
                const mx = (e.ax + e.bx) / 2;
                return (
                  <motion.path
                    key={`${e.a}-${e.b}-${i}`}
                    d={`M${e.ax + 54} ${e.ay} C ${mx} ${e.ay}, ${mx} ${e.by}, ${e.bx - 66} ${e.by}`}
                    fill="none"
                    stroke={lit && hover ? '#E0A21B' : '#2B2420'}
                    strokeOpacity={lit ? (hover ? 0.9 : 0.18) : 0.05}
                    strokeWidth={lit && hover ? 2 : 1.2}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ delay: 0.4 + i * 0.03, duration: 0.7, ease }}
                  />
                );
              })}
              {graph.ing.map((n, i) => node(n, 'ing', i))}
              {graph.dsh.map((n, i) => node(n, 'dish', i + graph.ing.length))}
              {graph.nut.map((n, i) => node(n, 'nut', i + graph.ing.length + graph.dsh.length))}
            </svg>
          </div>
          <p className="mt-2 text-[0.82rem] text-muted">
            {nutri && nutri.top_nutrients.length > 0
              ? 'Nutrient totals are per typical dish, from the Indian Food Nutrition dataset.'
              : 'Hover any ingredient, dish or nutrient to trace what it connects to.'}
          </p>
        </section>
      </div>

      <Reveal className="mt-6 grid sm:grid-cols-3 gap-4">
        {[
          ['Substitutes', 'Out of paneer? Tofu fills the same slot in Palak Paneer and Bhurji.'],
          ['Use first', 'Spinach wilts first. It is weighted higher in tonight\'s suggestions.'],
          ['Nutrition from data', 'Dish nutrition is matched against the 1,014-row Indian Food Nutrition dataset.'],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl bg-surface p-5">
            <p className="font-display text-lg">{t}</p>
            <p className="mt-1 text-[0.9rem] text-muted">{d}</p>
          </div>
        ))}
      </Reveal>

      <NextStep to="/recipes" label="Meal recommendations" hint="Dishes ranked for what you have tonight." />
    </Page>
  );
}
