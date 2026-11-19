import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { NextStep, Page, PageHeader, ease } from '../components/Page';
import { Arrow, Back, Check, Pause, Play, Reset, Timer } from '../components/Icons';
import { Recipe, RECIPES } from '../lib/data';
import { fetchRecipe } from '../lib/recipes';

const PAN = ['#EFE4CF', '#E7C76A', '#D99A3E', '#B86B3A', '#5E8A45'];

function mmss(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default function Cook() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('recipe') ?? '';
  const staticHit = useMemo(() => RECIPES.find((r) => r.id === requested), [requested]);
  const [fetched, setFetched] = useState<Recipe | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  // Fetch backend recipes (ids like 'r123') when they're not in the static set.
  useEffect(() => {
    if (!requested || staticHit) { setFetched(null); setFetchErr(null); return; }
    let cancelled = false;
    fetchRecipe(requested)
      .then((d) => {
        if (cancelled) return;
        const steps = d.steps.length
          ? d.steps.map((s) => ({ title: s.title, detail: s.detail, seconds: s.seconds }))
          : [{ title: 'Cook', detail: 'No step-by-step instructions available for this recipe.', seconds: 60 }];
        setFetched({
          id: d.id,
          name: d.name,
          match: 0,
          minutes: d.minutes,
          tags: d.tags,
          uses: [],
          missing: [],
          reasons: [],
          steps,
          color: d.color,
        });
      })
      .catch((e: unknown) => { if (!cancelled) setFetchErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [requested, staticHit]);

  const recipe: Recipe = staticHit ?? fetched ?? RECIPES[0];
  const [step, setStep] = useState(0);
  const [left, setLeft] = useState(recipe.steps[0].seconds);
  const [running, setRunning] = useState(false);
  const [dir, setDir] = useState(1);

  const s = recipe.steps[step];
  const last = step === recipe.steps.length - 1;
  const done = left === 0;

  useEffect(() => {
    setStep(0);
    setLeft(recipe.steps[0].seconds);
    setRunning(false);
  }, [recipe]);

  const go = useCallback(
    (to: number) => {
      const n = Math.max(0, Math.min(recipe.steps.length - 1, to));
      setDir(n > step ? 1 : -1);
      setStep(n);
      setLeft(recipe.steps[n].seconds);
      setRunning(false);
    },
    [recipe, step],
  );

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setLeft((l) => (l <= 1 ? 0 : l - 1)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (left === 0) setRunning(false);
  }, [left]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') go(step + 1);
      if (e.key === 'ArrowLeft') go(step - 1);
      if (e.key === ' ') {
        e.preventDefault();
        setRunning((r) => !r);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [go, step]);

  const frac = 1 - left / s.seconds;
  const R = 70;
  const C = 2 * Math.PI * R;
  const panColor = PAN[Math.min(PAN.length - 1, Math.round((step / Math.max(1, recipe.steps.length - 1)) * (PAN.length - 1)))];

  return (
    <Page>
      <PageHeader
        step="06"
        kicker="Cook-along"
        icon={<Timer />}
        title="One step at a time."
        lead="Large text, one instruction on screen, and a timer for every step. Use the arrow keys to move and the space bar to start or pause when your hands are busy."
      >
        <label className="block">
          <span className="text-[0.8rem] text-muted">Recipe</span>
          <select
            value={recipe.id}
            onChange={(e) => setParams({ recipe: e.target.value })}
            className="mt-1 block h-11 px-4 pr-10 rounded-xl border border-ink/15 bg-white font-medium focus:outline-none focus:border-leaf"
          >
            {RECIPES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            {!staticHit && fetched && (
              <option key={fetched.id} value={fetched.id}>{fetched.name}</option>
            )}
          </select>
          {fetchErr && <span className="block mt-1 text-[0.72rem] text-chilli">Recipe backend: {fetchErr}</span>}
        </label>
      </PageHeader>

      {/* Progress */}
      <ol className="flex gap-2" aria-label="Steps">
        {recipe.steps.map((x, i) => (
          <li key={x.title} className="flex-1">
            <button onClick={() => go(i)} className="w-full text-left group" aria-current={i === step ? 'step' : undefined}>
              <span className="block h-1.5 rounded-full bg-ink/10 overflow-hidden">
                <motion.span
                  className="block h-full bg-leaf"
                  animate={{ width: i < step ? '100%' : i === step ? `${frac * 100}%` : '0%' }}
                  transition={{ duration: 0.4, ease }}
                />
              </span>
              <span className={`mt-2 block text-[0.78rem] truncate ${i === step ? 'text-ink font-semibold' : 'text-muted group-hover:text-ink'}`}>
                {i + 1}. {x.title}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <section className="card p-6 md:p-10 relative overflow-hidden min-h-[340px] flex flex-col">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={`${recipe.id}-${step}`}
              custom={dir}
              initial={{ opacity: 0, x: dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -40 }}
              transition={{ duration: 0.45, ease }}
              className="flex-1"
            >
              <p className="kicker">Step {step + 1} of {recipe.steps.length} · {recipe.name}</p>
              <h2 className="h-display text-[clamp(2.4rem,6vw,4rem)] mt-3">{s.title}</h2>
              <p className="mt-5 text-[clamp(1.1rem,2.2vw,1.4rem)] leading-relaxed max-w-[34ch]">{s.detail}</p>
            </motion.div>
          </AnimatePresence>
          <div className="mt-8 flex items-center justify-between gap-3">
            <button className="btn-ghost" onClick={() => go(step - 1)} disabled={step === 0}><Back width={18} /> Back</button>
            {last ? (
              <span className="chip border-leaf/30 bg-leaf/10 text-leaf !py-2 !px-4"><Check width={16} /> Last step — serve warm</span>
            ) : (
              <button className="btn-primary" onClick={() => go(step + 1)}>Next step <Arrow width={18} /></button>
            )}
          </div>
        </section>

        <section className="card p-6 flex flex-col items-center">
          <div className="relative w-[200px] h-[200px]">
            <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
              <circle cx="80" cy="80" r={R} fill="none" stroke="rgba(43,36,32,0.08)" strokeWidth="8" />
              <motion.circle
                cx="80"
                cy="80"
                r={R}
                fill="none"
                stroke={done ? '#3F6B3A' : '#E0A21B'}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={C}
                animate={{ strokeDashoffset: C * (1 - frac) }}
                transition={{ duration: 0.6, ease: 'linear' }}
              />
            </svg>
            {/* Pan */}
            <div className="absolute inset-0 grid place-items-center">
              <svg viewBox="0 0 120 120" className="w-[120px] h-[120px]" aria-hidden="true">
                <circle cx="60" cy="60" r="44" fill="#4A4038" />
                <motion.circle cx="60" cy="60" r="38" animate={{ fill: panColor }} transition={{ duration: 0.8 }} />
                {running &&
                  [0, 1, 2].map((i) => (
                    <motion.circle
                      key={i}
                      cx={46 + i * 14}
                      cy={60}
                      r={3}
                      fill="#FFFFFF"
                      initial={{ opacity: 0, cy: 70 }}
                      animate={{ opacity: [0, 0.8, 0], cy: [70, 50, 40] }}
                      transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.5 }}
                    />
                  ))}
              </svg>
            </div>
          </div>
          <p className="font-display text-[2.6rem] tabular-nums mt-2" aria-live="polite">{done ? 'Done' : mmss(left)}</p>
          <p className="text-[0.85rem] text-muted">{done ? 'Move to the next step when ready.' : `of ${mmss(s.seconds)} for ${s.title.toLowerCase()}`}</p>
          <div className="mt-5 flex gap-2">
            <button className="btn-accent min-w-[120px]" onClick={() => setRunning((r) => !r)} disabled={done}>
              {running ? <><Pause width={18} /> Pause</> : <><Play width={18} /> Start</>}
            </button>
            <button className="btn-ghost" onClick={() => { setLeft(s.seconds); setRunning(false); }} aria-label="Reset timer">
              <Reset width={18} />
            </button>
          </div>
          <p className="mt-5 text-[0.78rem] text-muted text-center">← → to change step · Space to start/pause</p>
        </section>
      </div>

      <NextStep to="/health" label="Family health growth" hint="See how family health increased during AHAAR usage." />
    </Page>
  );
}
