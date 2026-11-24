import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { NextStep, Page, PageHeader, ease } from '../components/Page';
import { FridgeArt } from '../components/FridgeArt';
import { Box, Camera, Check, Reset, X } from '../components/Icons';
import { Item } from '../lib/data';
import { useKitchen } from '../lib/store';
import { Detection, detectIngredients } from '../lib/inference';
import { detectionsToItems } from '../lib/detectShots';

type Phase = 'ready' | 'loading-model' | 'scanning' | 'done' | 'error';

export default function Detect() {
  const { shots, mergeItems, setDetected } = useKitchen();
  const navigate = useNavigate();
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [modelProgress, setModelProgress] = useState<number>(0);
  const [shotDone, setShotDone] = useState<number>(0);
  // Merged list across every shot, plus each shot's own boxes for the overlay.
  const [results, setResults] = useState<Item[]>([]);
  const [perShot, setPerShot] = useState<Record<string, Item[]>>({});
  const [seenIn, setSeenIn] = useState<Record<string, number>>({});
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<boolean>(false);

  const shot = shots[active];
  const keptCount = Object.values(kept).filter(Boolean).length;
  const shotBoxes = shot ? perShot[shot.id] ?? [] : [];
  const shotKey = shots.map((s) => s.id).join('|');

  useEffect(() => {
    abortRef.current = false;
    return () => { abortRef.current = true; };
  }, []);

  // A different set of shots invalidates the combined results.
  useEffect(() => {
    setPhase('ready');
    setResults([]);
    setPerShot({});
    setSeenIn({});
    setKept({});
    setError(null);
    setActive((a) => Math.min(a, Math.max(0, shots.length - 1)));
  }, [shotKey]);

  const runDetection = async () => {
    if (shots.length === 0) return;
    setError(null);
    setResults([]);
    setPerShot({});
    setSeenIn({});
    setKept({});
    setModelProgress(0);
    setShotDone(0);
    setPhase('loading-model');
    try {
      const all: Detection[] = [];
      const boxes: Record<string, Item[]> = {};
      const seen: Record<string, number> = {};
      for (let i = 0; i < shots.length; i++) {
        setActive(i);
        const dets = await detectIngredients(shots[i].src, (p) => {
          if (!abortRef.current) setModelProgress(p);
        });
        if (abortRef.current) return;
        boxes[shots[i].id] = detectionsToItems(dets);
        for (const cls of new Set(dets.map((d) => d.className))) seen[cls] = (seen[cls] ?? 0) + 1;
        all.push(...dets);
        setShotDone(i + 1);
      }
      setPhase('scanning');
      const merged = detectionsToItems(all);
      setPerShot(boxes);
      setSeenIn(seen);
      setResults(merged);
      setKept(Object.fromEntries(merged.map((i) => [i.id, true])));
      setDetected(true);
      setPhase('done');
    } catch (e: unknown) {
      if (abortRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  };

  const confirm = () => {
    mergeItems(results.filter((i) => kept[i.id]));
    navigate('/pantry');
  };

  /** Lazy mode: accept every detection above the confidence threshold and
   * jump straight to /recipes. Skips the pantry edit step entirely. */
  const confirmLazy = () => {
    const picks = results.filter((i) => kept[i.id]);
    mergeItems(picks);
    navigate('/recipes');
  };

  return (
    <Page>
      <PageHeader
        step="02"
        kicker="Ingredient detection"
        icon={<Box />}
        title="Every item, named and boxed."
        lead="A YOLOv11m model fine-tuned on 107 Indian pantry classes checks every shot you took and combines them into one list. Each box carries a confidence score; switch off anything it got wrong before it reaches your pantry."
      >
        <span className="chip border-ink/15 bg-surface text-muted">YOLOv11m · 107 classes</span>
      </PageHeader>

      <div className="grid lg:grid-cols-[1.45fr_1fr] gap-6">
        <section className="card p-3 md:p-4">
          <div className="relative rounded-2xl overflow-hidden bg-surface">
            {shot ? (
              <img src={shot.src} alt="Your fridge shot" className="w-full aspect-[4/3] object-cover block" />
            ) : (
              <div className="aspect-[4/3] grid place-items-center"><FridgeArt animate={false} /></div>
            )}

            <AnimatePresence>
              {(phase === 'loading-model' || phase === 'scanning') && (
                <motion.div
                  className="absolute inset-0 pointer-events-none"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="absolute inset-0 bg-ink/25" />
                  <motion.div
                    className="absolute left-0 right-0 h-24 bg-gradient-to-b from-transparent to-turmeric/40 border-b-2 border-turmeric"
                    initial={{ top: '-25%' }}
                    animate={{ top: '100%' }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: 'linear' }}
                  />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 chip border-0 bg-ink text-bg !px-4 !py-2">
                    {phase === 'loading-model'
                      ? `Shot ${Math.min(shotDone + 1, shots.length)} of ${shots.length} · ${Math.round(modelProgress * 100)}%`
                      : 'Combining shots…'}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {phase === 'done' &&
              shotBoxes.map((it, i) => {
                const [x, y, w, h] = it.box;
                const on = kept[it.id];
                const dim = hover && hover !== it.id;
                return (
                  <motion.button
                    key={it.id}
                    onMouseEnter={() => setHover(it.id)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(it.id)}
                    onBlur={() => setHover(null)}
                    onClick={() => setKept((k) => ({ ...k, [it.id]: !k[it.id] }))}
                    aria-label={`${it.name}, ${it.conf}% confidence. ${on ? 'Kept' : 'Removed'}. Click to toggle.`}
                    className="absolute rounded-lg text-left"
                    style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
                    initial={{ opacity: 0, scale: 1.15 }}
                    animate={{ opacity: dim ? 0.35 : 1, scale: 1 }}
                    transition={{ delay: hover ? 0 : i * 0.08, duration: 0.4, ease }}
                  >
                    <span
                      className={`absolute inset-0 rounded-lg border-[2.5px] transition-colors ${on ? 'border-turmeric bg-turmeric/10' : 'border-dashed border-ink/40 bg-ink/10'}`}
                    />
                    <span
                      className={`absolute -top-3 left-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[0.72rem] font-semibold shadow-sm ${on ? 'bg-turmeric text-ink' : 'bg-ink/60 text-bg line-through'}`}
                    >
                      {it.name} {it.conf}%
                    </span>
                  </motion.button>
                );
              })}
          </div>

          {shots.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {shots.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setActive(i)}
                  disabled={phase === 'loading-model' || phase === 'scanning'}
                  aria-label={`Show shot ${i + 1}`}
                  className={`w-16 h-16 rounded-lg overflow-hidden shrink-0 border-2 transition-colors ${i === active ? 'border-leaf' : 'border-transparent opacity-70'}`}
                >
                  <img src={s.src} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1">
            <p className="text-[0.85rem] text-muted max-w-md">
              {phase === 'error'
                ? <span className="text-chilli">Detection failed: {error}</span>
                : shot
                  ? phase === 'done' && shots.length > 1
                    ? `Showing boxes for shot ${active + 1} of ${shots.length}. The list on the right combines all of them.`
                    : `Live inference from the AHAAR detection backend on ${shots.length === 1 ? 'this shot' : `all ${shots.length} shots`}.`
                  : <>No shots yet. <Link to="/scan" className="text-leaf underline underline-offset-2">Take a photo</Link></>}
            </p>
            {phase === 'done' ? (
              <button className="btn-ghost" onClick={runDetection}><Reset width={18} /> Run again</button>
            ) : (
              <button
                className="btn-accent"
                disabled={!shot || phase === 'loading-model' || phase === 'scanning'}
                onClick={runDetection}
              >
                <Box width={18} />{' '}
                {phase === 'loading-model' ? `Shot ${Math.min(shotDone + 1, shots.length)} of ${shots.length}`
                  : phase === 'scanning' ? 'Combining…'
                  : shots.length > 1 ? `Detect all ${shots.length} shots` : 'Run detection'}
              </button>
            )}
          </div>
        </section>

        <aside className="card p-5 flex flex-col">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">Found</h2>
            {phase === 'done' && <span className="text-[0.85rem] text-muted">{keptCount} of {results.length} kept</span>}
          </div>

          {phase !== 'done' ? (
            <div className="flex-1 grid place-items-center text-center py-10">
              <div>
                <span className="mx-auto w-14 h-14 rounded-2xl bg-surface text-muted grid place-items-center"><Camera /></span>
                <p className="mt-3 text-muted text-[0.92rem]">
                  {phase === 'loading-model'
                    ? `Checking shot ${Math.min(shotDone + 1, shots.length)} of ${shots.length}…`
                    : phase === 'scanning'
                      ? 'Combining what every shot found…'
                      : phase === 'error'
                        ? 'Try again or remove the shot that failed.'
                        : shots.length > 1
                          ? `Run detection to check all ${shots.length} shots at once.`
                          : 'Run detection to see what is in the shot.'}
                </p>
              </div>
            </div>
          ) : results.length === 0 ? (
            <div className="flex-1 grid place-items-center text-center py-10">
              <div>
                <p className="mt-3 text-muted text-[0.92rem]">
                  No ingredients detected above the confidence threshold in any shot. Try brighter, closer shots.
                </p>
              </div>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {results.map((it, i) => {
                const on = kept[it.id];
                return (
                  <motion.li
                    key={it.id}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.05, duration: 0.3, ease }}
                    onMouseEnter={() => setHover(it.id)}
                    onMouseLeave={() => setHover(null)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-colors ${hover === it.id ? 'border-turmeric bg-turmeric/5' : 'border-ink/10'} ${on ? '' : 'opacity-50'}`}
                  >
                    <span className="w-3 h-3 rounded-full shrink-0 border border-ink/15" style={{ background: it.color }} />
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium truncate ${on ? '' : 'line-through'}`}>
                        {it.name}
                        {shots.length > 1 && (
                          <span className="ml-2 text-[0.75rem] font-normal text-muted">
                            {seenIn[it.id] ?? 1} of {shots.length} shots
                          </span>
                        )}
                      </p>
                      <div className="mt-1 h-1 rounded-full bg-ink/10 overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full ${it.conf >= 90 ? 'bg-leaf' : it.conf >= 70 ? 'bg-turmeric' : 'bg-chilli'}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${it.conf}%` }}
                          transition={{ delay: 0.2 + i * 0.05, duration: 0.5, ease }}
                        />
                      </div>
                    </div>
                    <span className="text-[0.85rem] tabular-nums text-muted w-10 text-right">{it.conf}%</span>
                    <button
                      onClick={() => setKept((k) => ({ ...k, [it.id]: !k[it.id] }))}
                      aria-label={on ? `Remove ${it.name}` : `Keep ${it.name}`}
                      className={`w-8 h-8 rounded-full grid place-items-center border transition-colors ${on ? 'border-ink/15 hover:border-chilli hover:text-chilli' : 'border-leaf text-leaf'}`}
                    >
                      {on ? <X width={14} /> : <Check width={14} />}
                    </button>
                  </motion.li>
                );
              })}
            </ul>
          )}

          <div className="w-full mt-auto pt-0 !mt-6 flex flex-col sm:flex-row gap-2">
            <button
              className="btn-primary flex-1"
              disabled={phase !== 'done' || keptCount === 0}
              onClick={confirm}
            >
              <Check /> Add {keptCount} to pantry
            </button>
            <button
              className="btn-ghost flex-1"
              disabled={phase !== 'done' || keptCount === 0}
              onClick={confirmLazy}
              title="Skip the pantry step and jump straight to recipes"
            >
              Skip to recipes →
            </button>
          </div>
        </aside>
      </div>

      <NextStep to="/pantry" label="Pantry & quantities" hint="See how much you have and what it can become." />
    </Page>
  );
}
