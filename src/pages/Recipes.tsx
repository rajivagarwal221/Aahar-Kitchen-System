import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { NextStep, Page, PageHeader, ease } from '../components/Page';
import { Bowl, Check, Plus, Timer } from '../components/Icons';
import { displayName } from '../lib/classNames';
import { colorFor } from '../lib/detectShots';
import { FILTERS, Nutrition, rankRecipes, Scored, useRecipes } from '../lib/recipes';
import { computeAllGsi, predictImpact, RecipeImpact } from '../lib/glycemic';

/** Nutrition chips the user can toggle. Predicates run against a recipe's
 * per-serving nutrition from the Indian Food Nutrition dataset. Recipes
 * without a nutrition match fail every chip (treated as "unknown"). */
const NUTRI_FILTERS: { key: string; label: string; test: (n: Nutrition) => boolean }[] = [
  { key: 'hi-protein', label: '≥20g protein',    test: (n) => n.protein   >= 20 },
  { key: 'lo-cal',     label: '≤400 kcal',       test: (n) => n.calories  <= 400 },
  { key: 'hi-fibre',   label: '≥5g fibre',       test: (n) => n.fibre     >= 5 },
  { key: 'lo-sodium',  label: '≤300mg sodium',   test: (n) => n.sodium    <= 300 },
  { key: 'lo-sugar',   label: '≤5g sugar',       test: (n) => n.sugar     <= 5 },
];

type SortKey = 'match' | 'kcal-asc' | 'protein-desc' | 'fibre-desc' | 'sodium-asc' | 'quickest';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'match',        label: 'Best match' },
  { key: 'quickest',     label: 'Quickest' },
  { key: 'kcal-asc',     label: 'Lowest calories' },
  { key: 'protein-desc', label: 'Highest protein' },
  { key: 'fibre-desc',   label: 'Highest fibre' },
  { key: 'sodium-asc',   label: 'Lowest sodium' },
];

function sortScored(scored: Scored[], key: SortKey): Scored[] {
  const nutOr = (s: Scored, k: keyof Nutrition, fallback: number) =>
    (s.recipe.nutrition?.[k] as number) ?? fallback;
  const arr = [...scored];
  switch (key) {
    case 'match':        return arr; // already match-sorted upstream
    case 'quickest':     return arr.sort((a, b) => a.recipe.minutes - b.recipe.minutes || b.match - a.match);
    case 'kcal-asc':     return arr.sort((a, b) => nutOr(a, 'calories', Infinity) - nutOr(b, 'calories', Infinity) || b.match - a.match);
    case 'protein-desc': return arr.sort((a, b) => nutOr(b, 'protein', -1)        - nutOr(a, 'protein', -1)        || b.match - a.match);
    case 'fibre-desc':   return arr.sort((a, b) => nutOr(b, 'fibre', -1)          - nutOr(a, 'fibre', -1)          || b.match - a.match);
    case 'sodium-asc':   return arr.sort((a, b) => nutOr(a, 'sodium', Infinity)   - nutOr(b, 'sodium', Infinity)   || b.match - a.match);
  }
}
import { useKitchen } from '../lib/store';

const PAGE = 12;

export default function Recipes() {
  const { items, members, shopping, addShopping, meals, glucose } = useKitchen();

  // Per-member glycemic sensitivity, learned from any logged meals that fell
  // inside a CGM window. Members without data stay as GSI=null and the
  // per-card prediction simply hides.
  const gsiByMember = useMemo(
    () => computeAllGsi(members.map((m) => m.id), meals, glucose),
    [members, meals, glucose],
  );
  const activeMembers = useMemo(
    () => members.filter((m) => gsiByMember.get(m.id)?.gsi != null),
    [members, gsiByMember],
  );
  const { recipes, status, retry, ...rest } = useRecipes();
  const [filters, setFilters] = useState<string[]>([]);
  const [nutriFilters, setNutriFilters] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>('match');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  const pantry = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const ranked = useMemo(() => rankRecipes(recipes, pantry, members), [recipes, pantry, members]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const activeNutri = NUTRI_FILTERS.filter((f) => nutriFilters.includes(f.key));
    const filtered = ranked.filter((s) => {
      if (!filters.every((f) => s.tags.includes(f))) return false;
      if (q && !s.recipe.name.toLowerCase().includes(q)) return false;
      if (activeNutri.length > 0) {
        if (!s.recipe.nutrition) return false; // no data -> cannot assert
        if (!activeNutri.every((f) => f.test(s.recipe.nutrition!))) return false;
      }
      return true;
    });
    return sortScored(filtered, sort);
  }, [ranked, filters, nutriFilters, query, sort]);

  useEffect(() => setShown(PAGE), [filters, nutriFilters, query, sort]);

  const listed = new Set(shopping.map((e) => e.id));

  return (
    <Page>
      <PageHeader
        step="04"
        kicker="Meal recommendations"
        icon={<Bowl />}
        title="Dishes that fit tonight."
        lead="Real recipes ranked by how much of each one is already in your pantry, whether it suits the conditions on your Family page, and how long it takes. Tap Why this? to see what is behind any score."
      />

      {items.length === 0 && (
        <p className="mb-5 rounded-xl border border-turmeric/40 bg-turmeric/10 px-4 py-3 text-[0.92rem]">
          Your pantry is empty, so nothing can be matched yet.{' '}
          <Link to="/scan" className="text-leaf font-medium underline underline-offset-2">Scan a shelf</Link> or{' '}
          <Link to="/pantry" className="text-leaf font-medium underline underline-offset-2">add items by hand</Link>.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search dishes"
          aria-label="Search dishes"
          className="h-10 w-full sm:w-56 px-4 rounded-full border border-ink/15 bg-white focus:outline-none focus:border-leaf"
        />
        <span className="text-[0.85rem] text-muted ml-1 mr-1">Filter</span>
        {FILTERS.map((f) => {
          const on = filters.includes(f);
          return (
            <motion.button
              key={f}
              whileTap={{ scale: 0.95 }}
              aria-pressed={on}
              onClick={() => setFilters((p) => (on ? p.filter((x) => x !== f) : [...p, f]))}
              className={`chip !py-2 !px-4 transition-colors duration-300 ${on ? 'bg-leaf text-bg border-leaf' : 'border-ink/15 hover:border-ink/40'}`}
            >
              {on && <Check width={14} height={14} />} {f}
            </motion.button>
          );
        })}
        {(filters.length > 0 || query) && (
          <button className="text-[0.85rem] text-muted underline underline-offset-2 ml-1" onClick={() => { setFilters([]); setQuery(''); }}>Clear</button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[0.85rem] text-muted mr-1">Nutrition</span>
        {NUTRI_FILTERS.map((f) => {
          const on = nutriFilters.includes(f.key);
          return (
            <motion.button
              key={f.key}
              whileTap={{ scale: 0.95 }}
              aria-pressed={on}
              onClick={() => setNutriFilters((p) => (on ? p.filter((x) => x !== f.key) : [...p, f.key]))}
              className={`chip !py-2 !px-3 transition-colors duration-300 ${on ? 'bg-leaf text-bg border-leaf' : 'border-ink/15 hover:border-ink/40'}`}
            >
              {on && <Check width={14} height={14} />} {f.label}
            </motion.button>
          );
        })}
        {nutriFilters.length > 0 && (
          <button className="text-[0.85rem] text-muted underline underline-offset-2 ml-1" onClick={() => setNutriFilters([])}>Clear</button>
        )}
        <label className="ml-auto flex items-center gap-2 text-[0.85rem] text-muted">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-9 px-3 pr-7 rounded-full border border-ink/15 bg-white focus:outline-none focus:border-leaf text-ink"
          >
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {status === 'loading' && (
        <ul className="mt-6 grid md:grid-cols-2 gap-5" aria-label="Loading recipes">
          {[0, 1, 2, 3].map((i) => <li key={i} className="card h-56 animate-pulse bg-surface/60" />)}
        </ul>
      )}

      {status === 'error' && (
        <div className="mt-6 card p-6 text-center">
          <p className="text-chilli">{'error' in rest ? rest.error : 'Could not load recipes.'}</p>
          <button className="btn-ghost mt-4" onClick={retry}>Try again</button>
        </div>
      )}

      {status === 'ready' && (
        <>
          <p className="mt-4 text-[0.85rem] text-muted">{list.length} of {recipes.length} dishes</p>
          <ul className="mt-3 grid md:grid-cols-2 gap-5">
            {list.slice(0, shown).map((s, i) => {
              const r = s.recipe;
              const isOpen = open === r.id;
              const toBuy = s.missing.filter((k) => !listed.has(k));
              return (
                <motion.li
                  key={r.id}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease, delay: (i % PAGE) * 0.04 }}
                  className="card overflow-hidden"
                >
                  <div className="h-2" style={{ background: colorFor(r.id) }} />
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="font-display text-[1.5rem] leading-tight">{r.name}</h3>
                        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[0.88rem] text-muted">
                          <Timer width={16} /> {r.minutes} min · serves {r.servings} · {r.cuisine}
                        </p>
                      </div>
                      <MatchRing value={s.match} />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {s.tags.map((t) => (
                        <span key={t} className="chip border-ink/10 bg-surface !text-[0.75rem] text-muted">{t}</span>
                      ))}
                    </div>

                    <NutritionStrip nutrition={r.nutrition} />
                    <GlycemicImpactStrip
                      nutrition={r.nutrition}
                      members={activeMembers.map((m) => ({
                        id: m.id,
                        name: m.name || `Member ${m.id}`,
                        impact: predictImpact(r.nutrition, gsiByMember.get(m.id)?.gsi ?? null),
                      }))}
                    />

                    <p className="mt-4 text-[0.9rem]">
                      <span className="text-leaf font-medium">You have {s.have.length} of {r.core.length}</span>
                      {s.missing.length > 0 && (
                        <span className="text-muted"> · Need {s.missing.slice(0, 4).map(displayName).join(', ')}{s.missing.length > 4 && ` +${s.missing.length - 4} more`}</span>
                      )}
                    </p>

                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        className={`chip !py-2 !px-4 transition-colors ${isOpen ? 'bg-turmeric border-turmeric text-ink' : 'border-ink/20 hover:bg-surface'}`}
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : r.id)}
                      >
                        Why this?
                      </button>
                      <Link to={`/cook?recipe=${r.id}`} className="chip !py-2 !px-4 bg-ink text-bg border-ink hover:bg-[#3a302a]">
                        Cook this →
                      </Link>
                      {s.missing.length > 0 && (
                        <button
                          className="chip !py-2 !px-4 border-leaf/40 text-leaf hover:bg-leaf/10 disabled:opacity-50"
                          disabled={toBuy.length === 0}
                          onClick={() => addShopping(toBuy.map((k) => ({ id: k, name: displayName(k) })))}
                        >
                          {toBuy.length === 0 ? <><Check width={14} height={14} /> On shopping list</> : <><Plus width={14} height={14} /> Add {toBuy.length} to shopping list</>}
                        </button>
                      )}
                    </div>

                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.4, ease }}
                          className="overflow-hidden"
                        >
                          <ul className="mt-5 space-y-3 border-t border-ink/10 pt-5">
                            {s.reasons.map((x, j) => (
                              <li key={x.label} className="text-[0.88rem]">
                                <div className="flex justify-between"><span>{x.label}</span><span className="tabular-nums text-muted">{x.value}</span></div>
                                <div className="mt-1.5 h-2 rounded-full bg-ink/10 overflow-hidden">
                                  <motion.div
                                    className="h-full rounded-full bg-turmeric"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${x.value}%` }}
                                    transition={{ delay: 0.1 + j * 0.1, duration: 0.6, ease }}
                                  />
                                </div>
                              </li>
                            ))}
                          </ul>
                          <ul className="mt-4 space-y-1 text-[0.85rem]">
                            {s.notes.map((n) => <li key={n}>{n}</li>)}
                          </ul>
                          <NutritionDetail nutrition={r.nutrition} servings={r.servings} />
                          <p className="mt-3 text-[0.78rem] text-muted">
                            Match = 60% pantry coverage + 25% family fit + 15% speed. Family fit is rule-based and is not medical advice.
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.li>
              );
            })}
          </ul>

          {list.length === 0 && <p className="mt-6 text-muted">No dish matches that search and every filter. Remove one to see suggestions.</p>}

          {list.length > shown && (
            <div className="mt-6 text-center">
              <button className="btn-ghost" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>
            </div>
          )}
        </>
      )}

      <NextStep to="/family" label="Family portions" hint="Split the meal for everyone at the table." />
    </Page>
  );
}

/** Compact per-serving strip shown on every card. Silent for the ~21% of
 * recipes whose name didn't match the Indian Food Nutrition CSV. */
function NutritionStrip({ nutrition }: { nutrition?: Nutrition }) {
  if (!nutrition) return null;
  const tiles: { k: keyof Nutrition; label: string; unit: string }[] = [
    { k: 'calories', label: 'kcal',    unit: '' },
    { k: 'protein',  label: 'protein', unit: 'g' },
    { k: 'carbs',    label: 'carbs',   unit: 'g' },
    { k: 'fibre',    label: 'fibre',   unit: 'g' },
  ];
  return (
    <div className="mt-4 grid grid-cols-4 gap-2" aria-label="Per-serving nutrition">
      {tiles.map(({ k, label, unit }) => {
        const v = nutrition[k] as number;
        return (
          <div key={k} className="rounded-lg bg-surface/70 border border-ink/5 px-2 py-1.5 text-center">
            <p className="text-[0.62rem] uppercase tracking-wider text-muted font-semibold">{label}</p>
            <p className="font-display text-[0.95rem] tabular-nums leading-tight">
              {v.toFixed(v >= 100 ? 0 : 1)}<span className="text-[0.65rem] text-muted ml-0.5 font-sans font-normal">{unit}</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** One chip per family member whose glycemic sensitivity AHAAR has learned.
 * Hidden entirely when no member has logged enough meals yet, so cards stay
 * clean for first-time users. */
function GlycemicImpactStrip({
  nutrition,
  members,
}: {
  nutrition?: Nutrition;
  members: { id: number; name: string; impact: RecipeImpact | null }[];
}) {
  if (!nutrition) return null;
  const live = members.filter((m) => m.impact !== null);
  if (live.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Predicted glycemic impact per member">
      {live.map((m) => {
        const i = m.impact!;
        return (
          <span
            key={m.id}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.72rem] font-medium"
            style={{ borderColor: `${i.colour}33`, background: `${i.colour}0f`, color: i.colour }}
            title={`Predicted 2-hour post-prandial AUC: ${i.spike.toFixed(0)} mg/dL·h`}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: i.colour }} />
            {m.name}: {i.label}
          </span>
        );
      })}
    </div>
  );
}

/** Expanded nutrition inside the "Why this?" drawer. */
function NutritionDetail({ nutrition, servings }: { nutrition?: Nutrition; servings: number }) {
  if (!nutrition) {
    return (
      <p className="mt-4 text-[0.82rem] text-muted border-t border-ink/10 pt-4">
        No nutrition match found for this dish in the Indian Food Nutrition dataset.
      </p>
    );
  }
  const rows: { k: keyof Nutrition; label: string; unit: string }[] = [
    { k: 'calories',  label: 'Calories',  unit: 'kcal' },
    { k: 'protein',   label: 'Protein',   unit: 'g' },
    { k: 'carbs',     label: 'Carbs',     unit: 'g' },
    { k: 'fat',       label: 'Fat',       unit: 'g' },
    { k: 'fibre',     label: 'Fibre',     unit: 'g' },
    { k: 'sugar',     label: 'Sugar',     unit: 'g' },
    { k: 'sodium',    label: 'Sodium',    unit: 'mg' },
    { k: 'calcium',   label: 'Calcium',   unit: 'mg' },
    { k: 'iron',      label: 'Iron',      unit: 'mg' },
    { k: 'vitamin_c', label: 'Vitamin C', unit: 'mg' },
    { k: 'folate',    label: 'Folate',    unit: 'µg' },
  ];
  return (
    <div className="mt-4 border-t border-ink/10 pt-4">
      <p className="text-[0.75rem] uppercase tracking-wider font-semibold text-muted">Per serving ({servings} serv.)</p>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[0.85rem]">
        {rows.map(({ k, label, unit }) => {
          const v = nutrition[k] as number;
          return (
            <div key={k} className="flex justify-between">
              <span>{label}</span>
              <span className="tabular-nums text-muted">{v.toFixed(v >= 100 ? 0 : 1)} {unit}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[0.72rem] text-muted">
        Source: <em>{nutrition.source}</em> · Indian Food Nutrition dataset (1,005 dishes).
      </p>
    </div>
  );
}

function MatchRing({ value }: { value: number }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative w-16 h-16 shrink-0" aria-label={`${value}% match`}>
      <svg viewBox="0 0 60 60" className="w-full h-full -rotate-90">
        <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(43,36,32,0.1)" strokeWidth="5" />
        <motion.circle
          cx="30"
          cy="30"
          r={r}
          fill="none"
          stroke="#3F6B3A"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 1, ease, delay: 0.2 }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[0.9rem] font-semibold text-leaf">{value}%</span>
    </div>
  );
}
