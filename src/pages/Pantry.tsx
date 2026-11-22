import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { NextStep, Page, PageHeader, ease } from '../components/Page';
import { Check, Minus, Plus, Scale, X } from '../components/Icons';
import { CLASS_NAMES, displayName } from '../lib/classNames';
import { SAMPLE_ITEMS } from '../lib/data';
import { manualItem } from '../lib/detectShots';
import { aggregateNutrition, NUTRIENTS, NUTRITION_UNITS, rankRecipes, useRecipes } from '../lib/recipes';
import { useKitchen } from '../lib/store';

function fmt(qty: number, unit: string) {
  if (unit === 'pcs') return `× ${qty}`;
  if (unit === 'L') return `${qty.toFixed(2).replace(/\.?0+$/, '')} L`;
  return `~ ${qty} g`;
}

const GRAPH_ITEMS = 8;
const GRAPH_DISHES = 4;

type Node = { id: string; label: string; x: number; y: number; color: string };

export default function Pantry() {
  const { items, setItems, mergeItems, removeItem, members } = useKitchen();
  const { recipes, status } = useRecipes();
  const [hover, setHover] = useState<string | null>(null);
  const [pick, setPick] = useState('');

  const bump = (id: string, dir: 1 | -1) =>
    setItems(items.map((i) => (i.id === id ? { ...i, qty: Math.max(0, +(i.qty + dir * i.step).toFixed(2)) } : i)));

  const addable = useMemo(() => {
    const have = new Set(items.map((i) => i.id));
    return CLASS_NAMES.filter((c) => !have.has(c))
      .map((c) => ({ key: c, label: displayName(c) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items]);

  const add = () => {
    if (!pick) return;
    mergeItems([manualItem(pick)]);
    setPick('');
  };

  // Rank once per change — reused for the graph and for the nutrition profile.
  const scored = useMemo(
    () => rankRecipes(recipes, new Set(items.map((i) => i.id)), members),
    [recipes, items, members],
  );

  // Aggregate per-serving nutrition across the top matching dishes, weighted
  // by how well each one fits the pantry. 80% of recipes carry a CSV match.
  const nutriProfile = useMemo(
    () => (items.length > 0 ? aggregateNutrition(scored, 12) : null),
    [scored, items.length],
  );

  // Graph layout: ingredients left, best-matching dishes middle, nutrients right.
  const graph = useMemo(() => {
    const shown = items.slice(0, GRAPH_ITEMS);
    const ids = new Set(shown.map((i) => i.id));
    const dishes = scored
      .filter((s) => s.have.some((k) => ids.has(k)))
      .slice(0, GRAPH_DISHES);
    const nutrients = Object.keys(NUTRIENTS).filter((n) => NUTRIENTS[n].some((u) => ids.has(u)));
    const H = Math.max(280, shown.length * 46);
    const y = (i: number, n: number) => (H / (n + 1)) * (i + 1);
    const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    const ing: Node[] = shown.map((it, i) => ({ id: it.id, label: short(it.name, 13), x: 90, y: y(i, shown.length), color: it.color }));
    const dsh: Node[] = dishes.map((d, i) => ({ id: `dish:${d.recipe.id}`, label: short(d.recipe.name, 19), x: 345, y: y(i, dishes.length), color: '#2B2420' }));
    const nut: Node[] = nutrients.map((n, i) => ({ id: `nut:${n}`, label: n, x: 590, y: y(i, nutrients.length), color: '#3F6B3A' }));
    const edges: { a: string; b: string; ax: number; ay: number; bx: number; by: number; pad: number }[] = [];
    dishes.forEach((d, i) => {
      for (const u of d.have) {
        const s = ing.find((n) => n.id === u);
        if (s) edges.push({ a: s.id, b: dsh[i].id, ax: s.x, ay: s.y, bx: dsh[i].x, by: dsh[i].y, pad: 80 });
      }
    });
    for (const n of nut) {
      for (const u of NUTRIENTS[n.label]) {
        const s = ing.find((x) => x.id === u);
        if (s) edges.push({ a: s.id, b: n.id, ax: s.x, ay: s.y, bx: n.x, by: n.y, pad: 54 });
      }
    }
    return { ing, dsh, nut, edges, H };
  }, [items, scored]);

  const linked = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    graph.edges.forEach((e) => {
      if (e.a === hover) s.add(e.b);
      if (e.b === hover) s.add(e.a);
    });
    return s;
  }, [hover, graph.edges]);

  const node = (n: Node, kind: 'ing' | 'dish' | 'nut', i: number) => {
    const lit = !linked || linked.has(n.id);
    const w = kind === 'dish' ? 160 : 108;
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
          y={n.y + 4.5}
          textAnchor="middle"
          fontSize="12.5"
          fontFamily="Figtree"
          fontWeight={600}
          fill={kind === 'dish' ? '#FBF6EC' : '#2B2420'}
        >
          {n.label}
        </text>
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
        lead="Everything detected in your shots lands here. Items counted in pieces start at the number of boxes found; the rest start at a typical pack size. Nudge any amount, add what the camera missed, and see which dishes and nutrients each ingredient leads to."
      />

      {nutriProfile && (
        <section className="card p-5 md:p-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="kicker text-leaf">Nutrition profile</p>
              <h2 className="font-display text-xl mt-0.5">Per typical dish your pantry can make</h2>
              <p className="text-[0.82rem] text-muted mt-1">
                Averaged over {nutriProfile.count} matched dish{nutriProfile.count === 1 ? '' : 'es'},
                weighted by pantry fit. Source: Indian Food Nutrition dataset (1,014 dishes).
              </p>
            </div>
            <span className="chip border-leaf/30 bg-leaf/10 text-leaf !text-[0.72rem]">Dish-level, per serving</span>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {(['calories', 'protein', 'carbs', 'fat', 'fibre', 'iron'] as const).map((k) => {
              const v = nutriProfile.avg[k] ?? 0;
              return (
                <div key={k} className="rounded-xl bg-surface p-3 border border-ink/5">
                  <p className="text-[0.7rem] uppercase tracking-wider text-muted font-semibold">{k}</p>
                  <p className="font-display text-xl mt-0.5 tabular-nums">
                    {v.toFixed(v >= 100 ? 0 : 1)}
                    <span className="text-[0.8rem] text-muted ml-1 font-sans font-normal">{NUTRITION_UNITS[k]}</span>
                  </p>
                </div>
              );
            })}
          </div>
          {nutriProfile.dishes.length > 0 && (
            <p className="mt-3 text-[0.78rem] text-muted">
              Based on {nutriProfile.dishes.slice(0, 3).map((d) => d.name).join(', ')}
              {nutriProfile.dishes.length > 3 ? `, +${nutriProfile.dishes.length - 3} more.` : '.'}
            </p>
          )}
        </section>
      )}

      <div className="grid lg:grid-cols-[1fr_1.6fr] gap-6 items-start">
        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">Your pantry</h2>
            <span className="chip border-turmeric/40 bg-turmeric/10 text-ink !text-[0.72rem]">{items.length} item{items.length === 1 ? '' : 's'}</span>
          </div>

          {items.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-ink/20 p-5 text-center">
              <p className="text-muted text-[0.92rem]">Nothing in the pantry yet. Scan a shelf, or add items by hand below.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Link to="/scan" className="btn-primary">Scan your fridge</Link>
                <button className="btn-ghost" onClick={() => mergeItems(SAMPLE_ITEMS)}>Load a sample pantry</button>
              </div>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {items.map((it, i) => (
                <motion.li
                  key={it.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 8) * 0.05, duration: 0.4, ease }}
                  onMouseEnter={() => setHover(it.id)}
                  onMouseLeave={() => setHover(null)}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 border transition-colors ${hover === it.id ? 'border-turmeric bg-turmeric/5' : 'border-ink/10 bg-white/60'}`}
                >
                  <span className="w-3 h-3 rounded-full border border-ink/15 shrink-0" style={{ background: it.color }} />
                  <span className="flex-1 min-w-0 font-medium truncate">{it.name}</span>
                  <button onClick={() => bump(it.id, -1)} aria-label={`Less ${it.name}`} className="w-8 h-8 shrink-0 rounded-full border border-ink/15 grid place-items-center hover:bg-surface">
                    <Minus width={14} />
                  </button>
                  <motion.span key={it.qty} initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="w-[66px] shrink-0 text-center tabular-nums text-[0.92rem]">
                    {fmt(it.qty, it.unit)}
                  </motion.span>
                  <button onClick={() => bump(it.id, 1)} aria-label={`More ${it.name}`} className="w-8 h-8 shrink-0 rounded-full border border-ink/15 grid place-items-center hover:bg-surface">
                    <Plus width={14} />
                  </button>
                  <button onClick={() => removeItem(it.id)} aria-label={`Remove ${it.name}`} className="w-8 h-8 shrink-0 rounded-full grid place-items-center text-muted hover:text-chilli">
                    <X width={14} />
                  </button>
                </motion.li>
              ))}
            </ul>
          )}

          <div className="mt-5 pt-4 border-t border-ink/10">
            <label className="block text-[0.82rem] font-medium text-muted" htmlFor="add-item">Add an ingredient by hand</label>
            <div className="mt-1.5 flex gap-2">
              <select
                id="add-item"
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="flex-1 min-w-0 h-11 px-3 rounded-xl border border-ink/15 bg-white focus:outline-none focus:border-leaf"
              >
                <option value="">Choose…</option>
                {addable.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <button className="btn-accent !min-h-[44px]" disabled={!pick} onClick={add}><Plus width={16} /> Add</button>
            </div>
          </div>
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
          {items.length === 0 ? (
            <p className="mt-6 mb-4 text-muted text-[0.92rem]">Add ingredients to see the dishes and nutrients they connect to.</p>
          ) : (
            <>
              <div className="mt-3 overflow-x-auto">
                <svg viewBox={`0 0 660 ${graph.H}`} className="min-w-[580px] w-full h-auto" role="img" aria-label="Graph linking ingredients to dishes and nutrients">
                  {graph.edges.map((e, i) => {
                    const lit = !hover || e.a === hover || e.b === hover;
                    const mx = (e.ax + e.bx) / 2;
                    return (
                      <motion.path
                        key={`${e.a}-${e.b}`}
                        d={`M${e.ax + 54} ${e.ay} C ${mx} ${e.ay}, ${mx} ${e.by}, ${e.bx - e.pad} ${e.by}`}
                        fill="none"
                        stroke={lit && hover ? '#E0A21B' : '#2B2420'}
                        strokeOpacity={lit ? (hover ? 0.9 : 0.18) : 0.05}
                        strokeWidth={lit && hover ? 2 : 1.2}
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ delay: 0.3 + Math.min(i, 20) * 0.03, duration: 0.7, ease }}
                      />
                    );
                  })}
                  {graph.ing.map((n, i) => node(n, 'ing', i))}
                  {graph.dsh.map((n, i) => node(n, 'dish', i + graph.ing.length))}
                  {graph.nut.map((n, i) => node(n, 'nut', i + graph.ing.length + graph.dsh.length))}
                </svg>
              </div>
              <p className="mt-2 text-[0.82rem] text-muted">
                {status === 'loading' && 'Loading dishes… '}
                {status === 'error' && 'Dishes could not be loaded; nutrients are still shown. '}
                Hover any ingredient, dish or nutrient to trace what it connects to.
                {items.length > GRAPH_ITEMS && ` Showing the first ${GRAPH_ITEMS} of ${items.length} ingredients.`}
              </p>
            </>
          )}
        </section>
      </div>

      <ShoppingListSection />

      <NextStep to="/recipes" label="Meal recommendations" hint="Dishes ranked for what you have tonight." />
    </Page>
  );
}

/** Shopping list with copy/share/export and a quick grocery-app search link. */
function ShoppingListSection() {
  const { shopping, mergeItems, removeShopping } = useKitchen();
  const [copied, setCopied] = useState<'copied' | 'shared' | null>(null);

  const text = useMemo(() => {
    if (shopping.length === 0) return '';
    const lines = shopping.map((e, i) => `${i + 1}. ${e.name}`);
    return `AHAAR shopping list (${shopping.length} item${shopping.length === 1 ? '' : 's'}):\n${lines.join('\n')}`;
  }, [shopping]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('copied');
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard denied: fall back to a downloadable text file.
      downloadTxt();
    }
  };

  const share = async () => {
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (!nav.share) return copy();
    try {
      await nav.share({ title: 'AHAAR shopping list', text });
      setCopied('shared');
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // User cancelled or share failed — not an error worth surfacing.
    }
  };

  const downloadTxt = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ahaar-shopping-list.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearAll = () => shopping.forEach((e) => removeShopping(e.id));

  const groceryQuery = encodeURIComponent(shopping.map((e) => e.name).join(', '));
  const grocerySearches = shopping.length > 0 ? [
    { label: 'BigBasket', href: `https://www.bigbasket.com/ps/?q=${groceryQuery}` },
    { label: 'Blinkit',   href: `https://blinkit.com/s/?q=${groceryQuery}` },
    { label: 'Zepto',     href: `https://www.zeptonow.com/search?query=${groceryQuery}` },
  ] : [];

  return (
    <section className="card p-5 mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-xl">Shopping list</h2>
          <span className="text-[0.85rem] text-muted">{shopping.length} to buy</span>
        </div>
        {shopping.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button onClick={copy} className="chip !py-1.5 !px-3 !text-[0.78rem] border-ink/15 hover:border-ink/40">
              {copied === 'copied' ? <><Check width={13} height={13} /> Copied</> : 'Copy'}
            </button>
            <button onClick={share} className="chip !py-1.5 !px-3 !text-[0.78rem] border-ink/15 hover:border-ink/40">
              {copied === 'shared' ? <><Check width={13} height={13} /> Shared</> : 'Share'}
            </button>
            <button onClick={downloadTxt} className="chip !py-1.5 !px-3 !text-[0.78rem] border-ink/15 hover:border-ink/40">Export .txt</button>
            <button onClick={clearAll} className="chip !py-1.5 !px-3 !text-[0.78rem] border-chilli/40 text-chilli hover:bg-chilli/5">Clear</button>
          </div>
        )}
      </div>
      {shopping.length === 0 ? (
        <p className="mt-3 text-[0.92rem] text-muted">
          Empty. On the <Link to="/recipes" className="text-leaf underline underline-offset-2">Recipes</Link> page, any dish that needs something you don't have can add it here.
        </p>
      ) : (
        <>
          <ul className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {shopping.map((e) => (
              <li key={e.id} className="flex items-center gap-2 rounded-xl border border-ink/10 bg-white/60 px-3 py-2">
                <span className="flex-1 min-w-0 truncate font-medium">{e.name}</span>
                <button
                  onClick={() => mergeItems([manualItem(e.id)])}
                  className="chip !py-1.5 !px-3 border-leaf/40 text-leaf hover:bg-leaf/10 !text-[0.78rem]"
                  aria-label={`Bought ${e.name}, move to pantry`}
                >
                  <Check width={13} height={13} /> Bought
                </button>
                <button onClick={() => removeShopping(e.id)} aria-label={`Remove ${e.name} from the list`} className="w-8 h-8 shrink-0 rounded-full grid place-items-center text-muted hover:text-chilli">
                  <X width={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[0.82rem] text-muted">
            <span>Order online:</span>
            {grocerySearches.map((g) => (
              <a
                key={g.label}
                href={g.href}
                target="_blank"
                rel="noopener noreferrer"
                className="chip !py-1.5 !px-3 !text-[0.78rem] border-leaf/40 text-leaf hover:bg-leaf/10"
              >
                {g.label} ↗
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
