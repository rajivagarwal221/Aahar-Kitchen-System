// Weekly meal planner. Wires lib/plan.ts into a simple 7-day x 3-slot
// grid, plus a side panel for the preferences form and a nutrition
// summary below the grid.
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { NextStep, Page, PageHeader } from '../components/Page';
import { Bowl, Timer } from '../components/Icons';
import { useRecipes } from '../lib/recipes';
import { useKitchen } from '../lib/store';
import {
  DAYS, GeneratedPlan, PlanPrefs, SLOTS, defaultPrefs, generatePlan,
} from '../lib/plan';
import { displayName } from '../lib/classNames';

const SLOT_LABEL: Record<(typeof SLOTS)[number], string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

export default function Plan() {
  const { items, members } = useKitchen();
  const { recipes, status } = useRecipes();
  const [prefs, setPrefs] = useState<PlanPrefs>(() => defaultPrefs(members));

  const pantry = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const plan: GeneratedPlan | null = useMemo(() => {
    if (status !== 'ready') return null;
    return generatePlan(recipes, pantry, members, prefs);
  }, [status, recipes, pantry, members, prefs]);

  const updateMinutes = (slot: keyof PlanPrefs['maxMinutes'], v: number) =>
    setPrefs((p) => ({ ...p, maxMinutes: { ...p.maxMinutes, [slot]: v } }));

  return (
    <Page>
      <PageHeader
        step="08"
        kicker="Weekly planner"
        icon={<Bowl />}
        title="A week of dinners, planned in one tap."
        lead="AHAAR fills seven days times three slots with recipes that fit your pantry, your family's conditions, and each slot's role (lighter breakfasts, substantial lunches and dinners). Never the same dish twice in the same week."
      />

      <div className="grid lg:grid-cols-[1fr_2.4fr] gap-6 items-start">
        <section className="card p-5">
          <h2 className="font-display text-xl">Preferences</h2>
          <div className="mt-4 space-y-4">
            <label className="block text-[0.82rem] font-medium text-muted">
              Diet
              <select
                value={prefs.diet}
                onChange={(e) => setPrefs((p) => ({ ...p, diet: e.target.value as PlanPrefs['diet'] }))}
                className="mt-1 w-full h-11 px-3 rounded-xl border border-ink/15 bg-white focus:outline-none focus:border-leaf"
              >
                <option value="any">Any</option>
                <option value="egg">Vegetarian + eggs</option>
                <option value="veg">Pure vegetarian</option>
              </select>
            </label>

            <div>
              <p className="text-[0.82rem] font-medium text-muted mb-2">Max minutes per slot</p>
              <div className="grid grid-cols-3 gap-2">
                {SLOTS.map((s) => (
                  <label key={s} className="block text-[0.78rem] text-muted">
                    {SLOT_LABEL[s]}
                    <input
                      type="number"
                      min={10}
                      max={120}
                      step={5}
                      value={prefs.maxMinutes[s]}
                      onChange={(e) => updateMinutes(s, Math.max(10, Number(e.target.value) || 30))}
                      className="mt-1 w-full h-10 px-2 rounded-lg border border-ink/15 bg-white text-ink tabular-nums text-center focus:outline-none focus:border-leaf"
                    />
                  </label>
                ))}
              </div>
            </div>

            <label className="block text-[0.82rem] font-medium text-muted">
              Don&apos;t repeat within
              <input
                type="number"
                min={1}
                max={6}
                value={prefs.diverseWindow}
                onChange={(e) => setPrefs((p) => ({ ...p, diverseWindow: Math.max(1, Math.min(6, Number(e.target.value) || 3)) }))}
                className="mt-1 w-full h-10 px-3 rounded-lg border border-ink/15 bg-white focus:outline-none focus:border-leaf tabular-nums"
              />
              <span className="text-[0.72rem] text-muted mt-0.5 block">days</span>
            </label>

            <button
              className="btn-ghost w-full"
              onClick={() => setPrefs(defaultPrefs(members))}
              type="button"
            >
              Reset to sensible defaults
            </button>
          </div>
        </section>

        <section>
          {status === 'loading' && (
            <div className="card p-10 text-center text-muted">Loading recipes…</div>
          )}
          {status === 'error' && (
            <div className="card p-6 text-chilli text-center">Couldn&apos;t load recipes.</div>
          )}
          {plan && (
            <>
              <div className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-2">
                <div />
                {SLOTS.map((s) => (
                  <div key={s} className="kicker text-center">{SLOT_LABEL[s]}</div>
                ))}
                {DAYS.map((day, di) => (
                  <Fragment key={day}>
                    <div className="self-center text-[0.82rem] font-semibold text-ink/75">
                      {day}
                    </div>
                    {SLOTS.map((slot) => {
                      const cell = plan.cells.find((c) => c.day === day && c.slot === slot);
                      return (
                        <motion.div
                          key={`${day}-${slot}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: di * 0.03 }}
                          className="card !p-3 min-h-[86px] flex flex-col justify-between"
                        >
                          {cell?.scored ? (
                            <>
                              <Link
                                to={`/cook?recipe=${cell.scored.recipe.id}`}
                                className="font-display text-[0.95rem] leading-tight hover:text-leaf transition-colors line-clamp-2"
                              >
                                {cell.scored.recipe.name}
                              </Link>
                              <div className="mt-2 flex items-center justify-between text-[0.72rem] text-muted">
                                <span className="inline-flex items-center gap-1"><Timer width={11} /> {cell.scored.recipe.minutes} min</span>
                                <span className="tabular-nums text-leaf font-semibold">{cell.scored.match}%</span>
                              </div>
                            </>
                          ) : (
                            <p className="text-[0.78rem] text-muted">Nothing fit this slot.</p>
                          )}
                        </motion.div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>

              <section className="card p-5 mt-6">
                <h2 className="font-display text-xl">Weekly nutrition</h2>
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {([
                    { k: 'calories', label: 'Calories', unit: 'kcal' },
                    { k: 'protein',  label: 'Protein',  unit: 'g' },
                    { k: 'carbs',    label: 'Carbs',    unit: 'g' },
                    { k: 'fat',      label: 'Fat',      unit: 'g' },
                    { k: 'fibre',    label: 'Fibre',    unit: 'g' },
                    { k: 'sodium',   label: 'Sodium',   unit: 'mg' },
                  ] as const).map(({ k, label, unit }) => {
                    const v = plan.weekTotal[k];
                    return (
                      <div key={k} className="rounded-xl bg-surface p-3 border border-ink/5">
                        <p className="text-[0.7rem] uppercase tracking-wider text-muted font-semibold">{label}</p>
                        <p className="font-display text-xl mt-0.5 tabular-nums">
                          {v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1)}
                          <span className="text-[0.8rem] text-muted ml-1 font-sans font-normal">{unit}</span>
                        </p>
                        <p className="text-[0.68rem] text-muted mt-0.5 tabular-nums">
                          ~{v >= 100 ? Math.round(v / 7).toLocaleString() : (v / 7).toFixed(1)} {unit}/day
                        </p>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-[0.78rem] text-muted">
                  Summed across every dish in the grid that has a nutrition match from the
                  Indian Food Nutrition dataset.
                </p>
              </section>

              {plan.shopping.length > 0 && (
                <section className="card p-5 mt-6">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-display text-xl">Shopping for the week</h2>
                    <span className="text-[0.85rem] text-muted">{plan.shopping.length} to buy</span>
                  </div>
                  <ul className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {plan.shopping.map((s) => (
                      <li key={s.key} className="rounded-xl border border-ink/10 bg-white/60 px-3 py-2">
                        <p className="font-medium">{displayName(s.key) || s.name}</p>
                        <p className="mt-0.5 text-[0.72rem] text-muted truncate" title={s.recipes.join(', ')}>
                          needed for {s.recipes.length} dish{s.recipes.length === 1 ? '' : 'es'}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[0.78rem] text-muted">
                    Head to the <Link to="/pantry" className="text-leaf underline underline-offset-2">Pantry</Link> page to export or share this list.
                  </p>
                </section>
              )}
            </>
          )}
        </section>
      </div>

      <NextStep to="/cook" label="Cook the first dish" hint="Jump straight into tonight's recipe." />
    </Page>
  );
}
