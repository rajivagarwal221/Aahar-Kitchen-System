import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { NextStep, Page, PageHeader, ease } from '../components/Page';
import { Bowl, Check, Timer } from '../components/Icons';
import { FILTERS } from '../lib/data';
import { useKitchen } from '../lib/store';
import { fetchRecipes, FetchedRecipe } from '../lib/recipes';

export default function Recipes() {
  const { items } = useKitchen();
  const [filters, setFilters] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [list, setList] = useState<FetchedRecipe[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pantry signal for backend: raw class name when we have it, else a normalized label.
  const have = useMemo(
    () =>
      items.map((i) => i.className ?? i.name.toLowerCase().replace(/\s+/g, '_')),
    [items],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRecipes(have, filters, 24)
      .then((rs) => {
        if (!cancelled) setList(rs);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [have, filters]);

  return (
    <Page>
      <PageHeader
        step="04"
        kicker="Meal recommendations"
        icon={<Bowl />}
        title="Dishes that fit tonight."
        lead="Ranked by how much of each dish you already have, your diet, and how gently it raises blood sugar. Tap Why this? to see the reasons behind any score."
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.85rem] text-muted mr-1">Filter</span>
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
        {filters.length > 0 && (
          <button className="text-[0.85rem] text-muted underline underline-offset-2 ml-1" onClick={() => setFilters([])}>Clear</button>
        )}
      </div>

      {have.length === 0 && !loading && list.length > 0 && (
        <p className="mt-4 text-[0.88rem] text-muted">
          Showing quick staples. <Link to="/scan" className="text-leaf underline underline-offset-2">Scan your fridge</Link> to rank by what you actually have.
        </p>
      )}

      {error && (
        <p className="mt-4 text-[0.88rem] text-chilli">
          Couldn&apos;t reach the recipe backend ({error}). Make sure the FastAPI server is running — see <code>backend/README.md</code>.
        </p>
      )}

      <motion.ul layout className="mt-6 grid md:grid-cols-2 gap-5">
        <AnimatePresence mode="popLayout">
          {list.map((r, i) => {
            const isOpen = open === r.id;
            const usedHave = r.uses.length;
            const total = usedHave + r.missing.length;
            return (
              <motion.li
                key={r.id}
                layout
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.5, ease, delay: Math.min(i * 0.04, 0.4) }}
                className="card overflow-hidden"
              >
                <div className="h-2" style={{ background: r.color }} />
                <div className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="font-display text-[1.6rem] leading-tight">{r.name}</h3>
                      <p className="mt-1 flex items-center gap-1.5 text-[0.88rem] text-muted"><Timer width={16} /> {r.minutes || '—'} min</p>
                    </div>
                    <MatchRing value={r.match} />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {r.tags.map((t) => (
                      <span key={t} className="chip border-ink/10 bg-surface !text-[0.75rem] text-muted">{t}</span>
                    ))}
                  </div>

                  {total > 0 && (
                    <p className="mt-4 text-[0.9rem]">
                      {usedHave > 0 && <span className="text-leaf font-medium">You have {usedHave} of {total}</span>}
                      {r.missing.length > 0 && <span className="text-muted">{usedHave > 0 ? ' · ' : ''}Need {r.missing.join(', ')}</span>}
                    </p>
                  )}

                  <div className="mt-5 flex flex-wrap gap-2">
                    <button
                      className={`chip !py-2 !px-4 transition-colors ${isOpen ? 'bg-turmeric border-turmeric text-ink' : 'border-ink/20 hover:bg-surface'}`}
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : r.id)}
                    >
                      Why this?
                    </button>
                    <Link to={`/cook?recipe=${encodeURIComponent(r.id)}`} className="chip !py-2 !px-4 bg-ink text-bg border-ink hover:bg-[#3a302a]">
                      Cook this →
                    </Link>
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
                          {r.reasons.map((x, j) => (
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
                        <p className="mt-3 text-[0.78rem] text-muted">Score computed from pantry overlap, diet fit, and cook time.</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </motion.ul>

      {!loading && list.length === 0 && !error && (
        <p className="mt-6 text-muted">
          {filters.length
            ? 'No dish matches every filter. Remove one to see suggestions.'
            : have.length
              ? 'Nothing in the index matches your pantry yet. Try scanning again or adding staples.'
              : 'Loading recipes…'}
        </p>
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
