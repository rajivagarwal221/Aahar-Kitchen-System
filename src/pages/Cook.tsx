import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { NextStep, Page, PageHeader, ease } from '../components/Page';
import { Arrow, Back, Check, Pause, Play, Reset, Timer } from '../components/Icons';
import { Recipe, rankRecipes, useRecipes } from '../lib/recipes';
import { useKitchen } from '../lib/store';
import { VoiceCommand, canListen, canSpeak, useVoice } from '../lib/voice';

const PAN = ['#EFE4CF', '#E7C76A', '#D99A3E', '#B86B3A', '#5E8A45'];

function mmss(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default function Cook() {
  const [params] = useSearchParams();
  const { items, members } = useKitchen();
  const state = useRecipes();
  const wanted = params.get('recipe');

  // With no recipe in the URL, cook the best match for the pantry.
  const recipe = useMemo(() => {
    if (state.status !== 'ready') return null;
    const picked = state.recipes.find((r) => r.id === wanted);
    if (picked) return picked;
    return rankRecipes(state.recipes, new Set(items.map((i) => i.id)), members)[0]?.recipe ?? null;
  }, [state.status, state.recipes, wanted, items, members]);

  if (recipe) return <CookAlong key={recipe.id} recipe={recipe} />;

  return (
    <Page>
      <PageHeader
        step="06"
        kicker="Cook-along"
        icon={<Timer />}
        title="One step at a time."
        lead="Large text, one instruction on screen, and a timer for every step."
      />
      <div className="card p-8 text-center">
        {state.status === 'loading' && <p className="text-muted">Loading the recipe…</p>}
        {state.status === 'error' && (
          <>
            <p className="text-chilli">{state.error}</p>
            <button className="btn-ghost mt-4" onClick={state.retry}>Try again</button>
          </>
        )}
        {state.status === 'ready' && (
          <>
            <p className="text-muted">No recipe to cook yet.</p>
            <Link to="/recipes" className="btn-primary mt-4 inline-flex">Pick a dish</Link>
          </>
        )}
      </div>
    </Page>
  );
}

function CookAlong({ recipe }: { recipe: Recipe }) {
  const { items } = useKitchen();
  const pantry = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const [step, setStep] = useState(0);
  const [left, setLeft] = useState(recipe.steps[0].seconds);
  const [running, setRunning] = useState(false);
  const [dir, setDir] = useState(1);

  const s = recipe.steps[step];
  const last = step === recipe.steps.length - 1;
  const done = left === 0;

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

  // Voice guide: reads each step, then listens for "stop", "repeat" and "continue".
  const [voice, setVoice] = useState(false);
  const [halted, setHalted] = useState(false);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const total = recipe.steps.length;

  const onCommand = (c: VoiceCommand) => {
    if (c === 'stop') {
      hush();
      setRunning(false);
      setHalted(true);
    } else if (c === 'repeat') {
      setHalted(false);
      setRunning(false);
      readStep(step);
    } else if (halted) {
      // "Continue" after "stop" picks the same step back up.
      setHalted(false);
      speak('Continuing.', () => setRunning(true));
    } else if (!last) {
      go(step + 1);
    } else {
      speak('That was the last step. Enjoy your meal.');
    }
  };
  const { speak, hush, speaking, mic, heard } = useVoice(voice, onCommand);

  const readStep = useCallback(
    (n: number) => {
      const st = recipe.steps[n];
      speak(`Step ${n + 1} of ${total}. ${st.detail}`, () => setRunning(true));
    },
    [recipe, total, speak],
  );

  useEffect(() => {
    if (!voice) {
      hush();
      return;
    }
    setHalted(false);
    readStep(step);
  }, [voice, step, readStep, hush]);

  useEffect(() => {
    if (left !== 0) return;
    setRunning(false);
    if (voiceRef.current) {
      speak(last ? 'Time is up. That was the last step. Enjoy your meal.' : 'Time is up. Say continue for the next step.');
    }
  }, [left, last, speak]);

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
        lead="Large text, one instruction on screen, and a timer for every step. Turn on the voice guide to have each step read to you and to move on by saying Stop, Repeat or Continue."
      >
        <div className="md:text-right">
          <p className="font-display text-xl leading-tight max-w-[22ch] md:ml-auto">{recipe.name}</p>
          <p className="mt-1 text-[0.85rem] text-muted">{recipe.minutes} min · serves {recipe.servings}</p>
          <Link to="/recipes" className="mt-2 inline-block text-[0.88rem] text-leaf font-medium underline underline-offset-2">Change dish</Link>
        </div>
      </PageHeader>

      {/* Progress */}
      <ol className="flex gap-1.5 sm:gap-2" aria-label="Steps">
        {recipe.steps.map((x, i) => (
          <li key={i} className="flex-1 min-w-0">
            <button onClick={() => go(i)} className="w-full text-left group" aria-current={i === step ? 'step' : undefined}>
              <span className="block h-1.5 rounded-full bg-ink/10 overflow-hidden">
                <motion.span
                  className="block h-full bg-leaf"
                  animate={{ width: i < step ? '100%' : i === step ? `${frac * 100}%` : '0%' }}
                  transition={{ duration: 0.4, ease }}
                />
              </span>
              <span className={`mt-2 block text-[0.78rem] truncate ${i === step ? 'text-ink font-semibold' : 'text-muted group-hover:text-ink'}`}>
                {i + 1}<span className="hidden sm:inline">. {x.title}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <section className="card p-4 md:p-5 mt-6 flex flex-wrap items-center gap-x-5 gap-y-3" aria-label="Voice guide">
        <button
          className={voice ? 'btn-primary' : 'btn-accent'}
          aria-pressed={voice}
          disabled={!canSpeak()}
          onClick={() => setVoice((v) => !v)}
        >
          {voice ? 'Voice guide on' : 'Turn on voice guide'}
        </button>
        <p className="flex-1 min-w-[220px] text-[0.9rem] text-muted" aria-live="polite">
          {!canSpeak()
            ? 'This browser cannot read steps aloud.'
            : !voice
              ? 'AHAAR reads each step aloud and listens for three commands: Stop, Repeat and Continue.'
              : mic === 'unsupported' || !canListen()
                ? 'Reading steps aloud. This browser cannot listen for commands, so use the buttons. Chrome and Edge can listen.'
                : mic === 'blocked'
                  ? 'Reading steps aloud. The microphone is blocked; allow it in the address bar, or use the buttons.'
                  : halted
                    ? 'Stopped. Say "Continue" to carry on or "Repeat" to hear the step again.'
                    : speaking
                      ? 'Reading the step… say "Stop" to interrupt.'
                      : `Listening. Say "Stop", "Repeat" or "Continue".${heard ? ` Last heard: "${heard}".` : ''}`}
        </p>
        {voice && (
          <div className="flex gap-2">
            <button className="btn-ghost !min-h-[44px]" onClick={() => onCommand('stop')}><Pause width={16} /> Stop</button>
            <button className="btn-ghost !min-h-[44px]" onClick={() => onCommand('repeat')}><Reset width={16} /> Repeat</button>
            <button className="btn-ghost !min-h-[44px]" onClick={() => onCommand('continue')}><Play width={16} /> Continue</button>
          </div>
        )}
      </section>

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
              <p className="mt-5 text-[clamp(1.1rem,2.2vw,1.4rem)] leading-relaxed max-w-[46ch]">{s.detail}</p>
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

      <section className="card p-5 md:p-6 mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl">Ingredients</h2>
          <a href={recipe.url} target="_blank" rel="noreferrer" className="text-[0.82rem] text-muted underline underline-offset-2">Recipe source</a>
        </div>
        <ul className="mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[0.92rem]">
          {recipe.ingredients.map((ing, i) => {
            const have = ing.key ? pantry.has(ing.key) : false;
            return (
              <li key={i} className="flex items-start gap-2">
                <span
                  className={`mt-1 w-4 h-4 shrink-0 rounded-full grid place-items-center ${have ? 'bg-leaf text-bg' : 'border border-ink/25'}`}
                  aria-hidden="true"
                >
                  {have && <Check width={10} height={10} />}
                </span>
                <span>{ing.text}{have && <span className="sr-only"> (in your pantry)</span>}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-[0.8rem] text-muted">A green tick means the item is in your pantry.</p>
      </section>

      <NextStep to="/health" label="Family health log" hint="Log blood pressure and heart rate after the meal." />
    </Page>
  );
}
