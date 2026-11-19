import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { NextStep, Page, PageHeader, ease } from '../components/Page';
import { Bowl, Check, Plus, Timer } from '../components/Icons';
import { displayName } from '../lib/classNames';
import { colorFor } from '../lib/detectShots';
import { FILTERS, rankRecipes, useRecipes } from '../lib/recipes';
import { useKitchen } from '../lib/store';

const PAGE = 12;

export default function Recipes() {
  const { items, members, shopping, addShopping } = useKitchen();
  const { recipes, status, retry, ...rest } = useRecipes();
  const [filters, setFilters] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  const pantry = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const ranked = useMemo(() => rankRecipes(recipes, pantry, members), [recipes, pantry, members]);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ranked.filter(
      (s) => filters.every((f) => s.tags.includes(f)) && (!q || s.recipe.name.toLowerCase().includes(q)),
    );
  }, [ranked, filters, query]);

  useEffect(() => setShown(PAGE), [filters, query]);

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
