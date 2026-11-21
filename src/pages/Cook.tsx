import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { NextStep, Page, PageHeader, ease } from '../components/Page';
import { Arrow, Back, Check, Pause, Play, Plus, Reset, Timer } from '../components/Icons';
import { Nutrition, Recipe, rankRecipes, useRecipes } from '../lib/recipes';
import { Detection, classifyDish } from '../lib/inference';
import { fileToDataUrl, uid } from '../lib/quality';
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
  const { items, members, addMeal } = useKitchen();
  const pantry = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const [logMemberId, setLogMemberId] = useState<number>(members[0]?.id ?? 0);
  const [logServings, setLogServings] = useState<number>(1);
  const [logTs, setLogTs] = useState<string>(() => {
    // Default: now, formatted for an <input type="datetime-local" />.
    const d = new Date();
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [logged, setLogged] = useState(false);

  const logMeal = () => {
    addMeal({
      id: uid(),
      memberId: logMemberId,
      recipeId: recipe.id,
      recipeName: recipe.name,
      ts: new Date(logTs).toISOString(),
      servings: logServings,
      nutrition: recipe.nutrition
        ? {
            calories: recipe.nutrition.calories,
            carbs:    recipe.nutrition.carbs,
            protein:  recipe.nutrition.protein,
            fat:      recipe.nutrition.fat,
            sugar:    recipe.nutrition.sugar,
            fibre:    recipe.nutrition.fibre,
          }
        : undefined,
    });
    setLogged(true);
    window.setTimeout(() => setLogged(false), 2000);
  };

  // --- Dish classifier: upload a finished-plate photo, verify against the recipe ---
  const dishInput = useRef<HTMLInputElement | null>(null);
  const [dishPhoto, setDishPhoto] = useState<string | null>(null);
  const [dishBusy, setDishBusy] = useState(false);
  const [dishError, setDishError] = useState<string | null>(null);
  const [dishResults, setDishResults] = useState<Detection[] | null>(null);

  const onDishFile = async (f: File | undefined) => {
    if (!f) return;
    setDishError(null);
    setDishResults(null);
    setDishBusy(true);
    try {
      const url = await fileToDataUrl(f);
      setDishPhoto(url);
      const res = await classifyDish(url);
      setDishResults(res);
    } catch (e: unknown) {
      setDishError(e instanceof Error ? e.message : String(e));
    } finally {
      setDishBusy(false);
    }
  };

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, '');
  const topDish = dishResults?.[0];
  const dishMatchesRecipe = topDish
    ? normalize(recipe.name).includes(normalize(topDish.label)) ||
      normalize(topDish.label).includes(normalize(recipe.name).slice(0, 8))
    : false;
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
          <p className="mt-1 text-[0.85rem] text-muted">
            {recipe.minutes} min · serves {recipe.servings}
            {recipe.nutrition && (
              <>
                {' · '}
                <span className="tabular-nums">{Math.round(recipe.nutrition.calories)} kcal/serv.</span>
              </>
            )}
          </p>
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

      <NutritionPanel nutrition={recipe.nutrition} servings={recipe.servings} members={members.length} />

      <section className="card p-5 md:p-6 mt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="kicker text-leaf">Meal log</p>
            <h2 className="font-display text-xl mt-0.5">Record that this was eaten</h2>
            <p className="mt-1 text-[0.82rem] text-muted max-w-[60ch]">
              Logging this meal lets AHAAR line it up with each person&apos;s CGM curve (if they have one)
              and learn how their body responds to {recipe.name}. Over a few meals it starts predicting
              which future recipes will spike their glucose.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
          <label className="block text-[0.8rem] font-medium text-muted">
            For
            <select
              value={logMemberId}
              onChange={(e) => setLogMemberId(Number(e.target.value))}
              className="mt-1 w-full h-11 px-3 rounded-xl border border-ink/15 bg-white focus:outline-none focus:border-leaf"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name || `Member ${m.id}`}</option>
              ))}
            </select>
          </label>
          <label className="block text-[0.8rem] font-medium text-muted">
            Servings
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={logServings}
              onChange={(e) => setLogServings(Math.max(0.5, Number(e.target.value) || 1))}
              className="mt-1 w-full h-11 px-3 rounded-xl border border-ink/15 bg-white focus:outline-none focus:border-leaf tabular-nums"
            />
          </label>
          <label className="block text-[0.8rem] font-medium text-muted sm:col-span-2">
            Eaten at
            <input
              type="datetime-local"
              value={logTs}
              onChange={(e) => setLogTs(e.target.value)}
              className="mt-1 w-full h-11 px-3 rounded-xl border border-ink/15 bg-white focus:outline-none focus:border-leaf"
            />
          </label>
        </div>
        <button
          className="btn-accent mt-4"
          onClick={logMeal}
          disabled={!members.length}
        >
          {logged ? <><Check width={16} /> Logged</> : <><Plus width={16} /> Log this meal</>}
        </button>
      </section>

      <section className="card p-5 md:p-6 mt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="kicker text-leaf">Finished-plate check</p>
            <h2 className="font-display text-xl mt-0.5">Did it turn out like {recipe.name}?</h2>
            <p className="mt-1 text-[0.82rem] text-muted max-w-[60ch]">
              Snap a photo of the plate you just made and AHAAR checks against its 20-class
              Indian-cuisine model. Useful for leftovers, cook-along confidence, or just to
              confirm the camera saw what you cooked.
            </p>
          </div>
          <div>
            <input
              ref={dishInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => onDishFile(e.target.files?.[0] || undefined)}
            />
            <button
              className={dishBusy ? 'btn-ghost' : 'btn-accent'}
              disabled={dishBusy}
              onClick={() => dishInput.current?.click()}
            >
              {dishBusy ? 'Classifying…' : (dishPhoto ? 'Try another photo' : 'Upload or take a photo')}
            </button>
          </div>
        </div>

        {dishError && (
          <p role="alert" className="mt-3 text-[0.88rem] text-chilli">{dishError}</p>
        )}

        {dishPhoto && (
          <div className="mt-4 grid md:grid-cols-[1.1fr_1.4fr] gap-4 items-start">
            <img
              src={dishPhoto}
              alt="Your finished plate"
              className="w-full rounded-xl border border-ink/10 bg-surface max-h-72 object-contain"
            />
            <div>
              {topDish ? (
                <>
                  <div className={`rounded-xl p-4 border ${dishMatchesRecipe ? 'border-leaf/40 bg-leaf/5' : 'border-turmeric/40 bg-turmeric/5'}`}>
                    <p className="kicker" style={{ color: dishMatchesRecipe ? '#3F6B3A' : '#A06A20' }}>
                      {dishMatchesRecipe ? 'Looks like a match' : 'Different dish'}
                    </p>
                    <p className="font-display text-xl mt-0.5 leading-tight">
                      AHAAR sees: <span className="text-leaf">{topDish.label}</span>
                    </p>
                    <p className="mt-1 text-[0.82rem] text-muted tabular-nums">
                      confidence {Math.round(topDish.confidence * 100)}%
                      {!dishMatchesRecipe && (
                        <> · expected <em>{recipe.name}</em></>
                      )}
                    </p>
                  </div>

                  {dishResults && dishResults.length > 1 && (
                    <div className="mt-3">
                      <p className="text-[0.75rem] uppercase tracking-wider text-muted font-semibold">Other possibilities</p>
                      <ul className="mt-1 space-y-1 text-[0.85rem]">
                        {dishResults.slice(1, 4).map((d) => (
                          <li key={d.id} className="flex justify-between">
                            <span>{d.label}</span>
                            <span className="text-muted tabular-nums">{Math.round(d.confidence * 100)}%</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[0.88rem] text-muted">
                  The classifier didn&apos;t find a confident Indian-dish match. Try a sharper, closer shot of the plate.
                </p>
              )}
            </div>
          </div>
        )}

        <p className="mt-3 text-[0.72rem] text-muted">
          Uses the YOLOv11m + IndianFood20 model from the §VI ablation. 20 plated-dish classes;
          raw ingredients (e.g. a bowl of chopped onions) won&apos;t register.
        </p>
      </section>

      <NextStep to="/health" label="Family health log" hint="Log blood pressure and heart rate after the meal." />
    </Page>
  );
}

/** Per-serving nutrition and a "for the whole table" scale-up. */
function NutritionPanel({
  nutrition,
  servings,
  members,
}: {
  nutrition?: Nutrition;
  servings: number;
  members: number;
}) {
  if (!nutrition) {
    return (
      <section className="card p-5 md:p-6 mt-6">
        <p className="kicker text-leaf">Nutrition</p>
        <h2 className="font-display text-xl mt-0.5">Per serving</h2>
        <p className="mt-2 text-[0.88rem] text-muted">
          No match found for this dish in the Indian Food Nutrition dataset.
        </p>
      </section>
    );
  }

  const scale = Math.max(1, members) / Math.max(1, servings);
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

  const fmt = (v: number) => (v >= 100 ? Math.round(v).toString() : v.toFixed(1));

  return (
    <section className="card p-5 md:p-6 mt-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="kicker text-leaf">Nutrition</p>
          <h2 className="font-display text-xl mt-0.5">
            Per serving
            {members > 1 && members !== servings && (
              <span className="text-[0.85rem] text-muted font-sans font-normal ml-2">
                · {members} plate{members === 1 ? '' : 's'} total
              </span>
            )}
          </h2>
          <p className="text-[0.78rem] text-muted mt-1">
            From the Indian Food Nutrition dataset. Source dish: <em>{nutrition.source}</em>.
          </p>
        </div>
        <span className="chip border-leaf/30 bg-leaf/10 text-leaf !text-[0.72rem]">
          {Math.round(nutrition.calories)} kcal / serving
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {rows.slice(0, 6).map(({ k, label, unit }) => {
          const v = nutrition[k] as number;
          return (
            <div key={k} className="rounded-xl bg-surface p-3 border border-ink/5">
              <p className="text-[0.7rem] uppercase tracking-wider text-muted font-semibold">{label}</p>
              <p className="font-display text-xl mt-0.5 tabular-nums">
                {fmt(v)}
                <span className="text-[0.8rem] text-muted ml-1 font-sans font-normal">{unit}</span>
              </p>
              {members > 1 && members !== servings && (
                <p className="text-[0.68rem] text-muted mt-0.5 tabular-nums">
                  {fmt(v * scale)} {unit} total
                </p>
              )}
            </div>
          );
        })}
      </div>

      <details className="mt-4 group">
        <summary className="cursor-pointer text-[0.85rem] text-muted hover:text-ink select-none">
          More micronutrients
        </summary>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {rows.slice(6).map(({ k, label, unit }) => {
            const v = nutrition[k] as number;
            return (
              <div key={k} className="rounded-xl bg-surface p-3 border border-ink/5">
                <p className="text-[0.7rem] uppercase tracking-wider text-muted font-semibold">{label}</p>
                <p className="font-display text-base mt-0.5 tabular-nums">
                  {fmt(v)}
                  <span className="text-[0.7rem] text-muted ml-1 font-sans font-normal">{unit}</span>
                </p>
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}

