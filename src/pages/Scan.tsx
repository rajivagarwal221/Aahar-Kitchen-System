import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { NextStep, Page, PageHeader, ease } from '../components/Page';
import { Box, Camera, Check, Flip, Hand, Shelf, Sun, Upload, X } from '../components/Icons';
import { detectAllShots } from '../lib/detectShots';
import { fileToDataUrl, loadImage, measure, Quality, uid } from '../lib/quality';
import { useKitchen } from '../lib/store';

type Mode = 'camera' | 'upload';
type CamState = 'idle' | 'starting' | 'live' | 'denied' | 'unsupported';

export default function Scan() {
  const [mode, setMode] = useState<Mode>('camera');
  const { shots, removeShot, setItems, setDetected } = useKitchen();
  const navigate = useNavigate();
  const anyOk = shots.some((s) => s.quality.ok);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(0);
  const [scanError, setScanError] = useState<string | null>(null);

  const detect = async () => {
    if (shots.length === 0 || scanning) return;
    setScanError(null);
    setScanDone(0);
    setScanning(true);
    try {
      const items = await detectAllShots(
        shots.map((s) => s.src),
        (done) => setScanDone(done),
      );
      setItems(items);
      setDetected(true);
      navigate('/pantry');
    } catch (e) {
      setScanError(e instanceof Error ? e.message : String(e));
      setScanning(false);
    }
  };

  return (
    <Page>
      <PageHeader
        step="01"
        kicker="Fridge scan"
        icon={<Camera />}
        title="A clear photo, or no advice."
        lead="Use your camera or upload photos of your fridge and pantry shelves. AHAAR checks light and sharpness live, and asks for a retake when a shot is too dark or blurry to read."
      />

      <div className="grid lg:grid-cols-[1.35fr_1fr] gap-6">
        {/* Capture panel */}
        <section className="card p-3 md:p-4">
          <div role="tablist" aria-label="Capture method" className="relative grid grid-cols-2 p-1 rounded-full bg-surface">
            {(['camera', 'upload'] as Mode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`relative z-10 flex items-center justify-center gap-2 h-11 rounded-full text-[0.92rem] font-medium transition-colors ${mode === m ? 'text-bg' : 'text-muted hover:text-ink'}`}
              >
                {mode === m && (
                  <motion.span layoutId="scan-tab" className="absolute inset-0 -z-10 rounded-full bg-ink" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />
                )}
                {m === 'camera' ? <Camera width={18} /> : <Upload width={18} />}
                {m === 'camera' ? 'Use camera' : 'Upload photos'}
              </button>
            ))}
          </div>

          <div className="mt-3">
            <AnimatePresence mode="wait">
              <motion.div key={mode} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease }}>
                {mode === 'camera' ? <CameraCapture onFallback={() => setMode('upload')} /> : <UploadCapture />}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        {/* Shots + guide */}
        <aside className="flex flex-col gap-6">
          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl">Your shots</h2>
              <span className="text-[0.85rem] text-muted">{shots.length} / 6</span>
            </div>
            {shots.length === 0 ? (
              <p className="mt-3 text-[0.92rem] text-muted">
                Nothing yet. Take one photo per shelf — top, middle and bottom work best.
              </p>
            ) : (
              <ul className="mt-4 grid grid-cols-3 gap-2.5">
                <AnimatePresence>
                  {shots.map((s) => (
                    <motion.li
                      key={s.id}
                      layout
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.35, ease }}
                      className="relative aspect-square rounded-xl overflow-hidden bg-surface group"
                    >
                      <img src={s.src} alt={`Shot from ${s.source}`} className="w-full h-full object-cover" />
                      <span
                        className={`absolute left-1.5 bottom-1.5 chip !px-2 !py-0.5 !text-[0.68rem] border-0 ${s.quality.ok ? 'bg-leaf text-bg' : 'bg-chilli text-bg'}`}
                      >
                        {s.quality.ok ? `Good · ${s.quality.score}` : 'Retake'}
                      </span>
                      <button
                        onClick={() => removeShot(s.id)}
                        aria-label="Remove shot"
                        className="absolute right-1.5 top-1.5 w-7 h-7 rounded-full bg-ink/70 text-bg grid place-items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                      >
                        <X width={14} height={14} />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
            <button
              className="btn-accent w-full mt-5"
              disabled={shots.length === 0 || scanning}
              onClick={detect}
            >
              {scanning ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="inline-block"
                  >
                    <Box width={18} />
                  </motion.span>
                  Scanning {scanDone} / {shots.length}…
                </>
              ) : (
                <>
                  <Check /> Detect ingredients {shots.length > 0 && `(${shots.length})`}
                </>
              )}
            </button>
            {shots.length > 0 && !anyOk && !scanning && (
              <p className="mt-2 text-[0.82rem] text-chilli">Every shot is marked for retake. Detection will be less reliable.</p>
            )}
            {scanning && (
              <p className="mt-2 text-[0.82rem] text-muted">Running detection on every shot. Pantry opens when done.</p>
            )}
            {scanError && (
              <p className="mt-2 text-[0.82rem] text-chilli">
                {scanError}
              </p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="font-display text-xl">For a good shot</h2>
            <ul className="mt-3 space-y-3 text-[0.92rem]">
              {[
                [Hand, 'Hold steady', 'Rest your elbow on the door.'],
                [Shelf, 'Open fully', 'Whole shelf in frame, door wide.'],
                [Sun, 'Good light', 'Fridge light on, no harsh glare.'],
              ].map(([Icon, t, d]) => {
                const I = Icon as typeof Hand;
                return (
                  <li key={t as string} className="flex gap-3">
                    <span className="w-9 h-9 rounded-lg bg-surface text-leaf grid place-items-center shrink-0"><I width={18} /></span>
                    <span><strong className="font-medium">{t as string}.</strong> <span className="text-muted">{d as string}</span></span>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>

      <NextStep to="/detect" label="Ingredient detection" hint="See what AHAAR finds in your shots." />
    </Page>
  );
}

function QualityBar({ q }: { q: Quality | null }) {
  const checks = [
    { label: 'Light', ok: q ? q.light === 'ok' : false, bad: q?.light === 'dark' ? 'Too dark' : q?.light === 'bright' ? 'Too bright' : '' },
    { label: 'Steady', ok: q ? q.steady : false, bad: 'Blurry' },
  ];
  const score = q?.score ?? 0;
  const color = !q ? '#D9CBB2' : q.ok ? '#3F6B3A' : score > 40 ? '#E0A21B' : '#B8371F';
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-[140px]">
        <div className="flex justify-between text-[0.78rem] text-muted"><span>Shot quality</span><span>{q ? score : '—'}</span></div>
        <div className="mt-1 h-1.5 rounded-full bg-ink/10 overflow-hidden">
          <motion.div className="h-full rounded-full" animate={{ width: `${score}%`, backgroundColor: color }} transition={{ duration: 0.4, ease }} />
        </div>
      </div>
      {checks.map((c) => (
        <span
          key={c.label}
          className={`chip !text-[0.75rem] ${!q ? 'border-ink/10 text-muted' : c.ok ? 'border-leaf/30 text-leaf bg-leaf/5' : 'border-chilli/30 text-chilli bg-chilli/5'}`}
        >
          {q && c.ok ? <Check width={13} height={13} /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
          {q && !c.ok ? c.bad : c.label}
        </span>
      ))}
    </div>
  );
}

function CameraCapture({ onFallback }: { onFallback: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CamState>('idle');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [q, setQ] = useState<Quality | null>(null);
  const [flash, setFlash] = useState(false);
  const [last, setLast] = useState<Quality | null>(null);
  const { addShot } = useKitchen();

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async (face: 'environment' | 'user') => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }
    stop();
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: face }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setState('live');
    } catch {
      setState('denied');
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  // Live quality checks twice a second.
  useEffect(() => {
    if (state !== 'live') return;
    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (v && v.videoWidth) setQ(measure(v, v.videoWidth, v.videoHeight));
    }, 500);
    return () => window.clearInterval(id);
  }, [state]);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * k);
    c.height = Math.round(v.videoHeight * k);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    const quality = measure(c, c.width, c.height);
    addShot({ id: uid(), src: c.toDataURL('image/jpeg', 0.86), quality, source: 'camera' });
    setLast(quality);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    window.setTimeout(() => setLast(null), 2200);
  };

  const live = state === 'live';
  const frameColor = !live || !q ? 'border-bg/70' : q.ok ? 'border-[#7FB069]' : 'border-turmeric';

  return (
    <div>
      <div className="relative aspect-[4/3] rounded-2xl overflow-hidden bg-ink">
        <video ref={videoRef} playsInline muted className={`w-full h-full object-cover ${facing === 'user' ? '-scale-x-100' : ''} ${live ? 'opacity-100' : 'opacity-0'}`} />

        {/* Viewfinder corners */}
        {live && (
          <div className="absolute inset-6 pointer-events-none">
            {['left-0 top-0 border-l-[3px] border-t-[3px] rounded-tl-xl', 'right-0 top-0 border-r-[3px] border-t-[3px] rounded-tr-xl', 'left-0 bottom-0 border-l-[3px] border-b-[3px] rounded-bl-xl', 'right-0 bottom-0 border-r-[3px] border-b-[3px] rounded-br-xl'].map((c) => (
              <span key={c} className={`absolute w-10 h-10 transition-colors duration-300 ${frameColor} ${c}`} />
            ))}
            <span
              className="absolute left-0 right-0 top-0 h-16 bg-gradient-to-b from-transparent to-turmeric/30 border-b-2 border-turmeric/80"
              style={{ animation: 'scanline 2.4s linear infinite', ['--scan-h' as string]: 'calc(100% - 4rem)' }}
            />
          </div>
        )}

        {/* Off states */}
        {!live && (
          <div className="absolute inset-0 grid place-items-center text-center p-6">
            <div className="max-w-xs">
              <span className="mx-auto w-16 h-16 rounded-2xl bg-bg/10 text-bg grid place-items-center">
                <Camera width={30} height={30} />
              </span>
              {state === 'idle' && (
                <>
                  <p className="mt-4 text-bg font-medium">Camera is off</p>
                  <p className="mt-1 text-bg/60 text-[0.88rem]">AHAAR asks for permission. Photos stay in this browser tab.</p>
                  <button className="btn-accent mt-5" onClick={() => start(facing)}>Turn on camera</button>
                </>
              )}
              {state === 'starting' && <p className="mt-4 text-bg/80">Starting camera…</p>}
              {(state === 'denied' || state === 'unsupported') && (
                <>
                  <p className="mt-4 text-bg font-medium">{state === 'denied' ? 'Camera blocked or unavailable' : 'No camera support here'}</p>
                  <p className="mt-1 text-bg/60 text-[0.88rem]">Allow camera access in your browser settings, or upload photos instead.</p>
                  <div className="mt-5 flex justify-center gap-2 flex-wrap">
                    {state === 'denied' && <button className="btn-ghost !text-bg !border-bg/30 hover:!bg-bg/10" onClick={() => start(facing)}>Try again</button>}
                    <button className="btn-accent" onClick={onFallback}>Upload instead</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <AnimatePresence>
          {flash && <motion.div className="absolute inset-0 bg-white" initial={{ opacity: 0.9 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} />}
        </AnimatePresence>

        <AnimatePresence>
          {last && (
            <motion.div
              initial={{ opacity: 0, y: 10, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: 10, x: '-50%' }}
              className={`absolute left-1/2 top-4 chip border-0 !px-4 !py-2 ${last.ok ? 'bg-leaf text-bg' : 'bg-chilli text-bg'}`}
            >
              {last.ok ? 'Saved — good shot' : 'Saved — retake suggested'}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-4 px-1"><QualityBar q={live ? q : null} /></div>

      <div className="mt-4 flex items-center justify-center gap-4">
        <button
          className="w-11 h-11 rounded-full border border-ink/15 grid place-items-center hover:bg-surface disabled:opacity-30"
          disabled={!live}
          onClick={() => {
            const next = facing === 'environment' ? 'user' : 'environment';
            setFacing(next);
            start(next);
          }}
          aria-label="Switch camera"
        >
          <Flip />
        </button>
        <motion.button
          whileTap={{ scale: 0.92 }}
          onClick={capture}
          disabled={!live}
          aria-label="Capture photo"
          className="w-[72px] h-[72px] rounded-full border-4 border-ink/15 grid place-items-center disabled:opacity-30"
        >
          <span className={`w-14 h-14 rounded-full transition-colors ${q?.ok ? 'bg-leaf' : 'bg-turmeric'}`} />
        </motion.button>
        <button
          className="w-11 h-11 rounded-full border border-ink/15 grid place-items-center hover:bg-surface disabled:opacity-30"
          disabled={!live}
          onClick={() => {
            stop();
            setState('idle');
            setQ(null);
          }}
          aria-label="Turn camera off"
        >
          <X />
        </button>
      </div>
    </div>
  );
}

function UploadCapture() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(0);
  const { addShot } = useKitchen();

  const handle = async (files: FileList | null) => {
    if (!files) return;
    const list = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 6);
    if (list.length === 0) return;
    setBusy(list.length);
    for (const f of list) {
      try {
        const src = await fileToDataUrl(f);
        const img = await loadImage(src);
        addShot({ id: uid(), src, quality: measure(img, img.width, img.height), source: 'upload' });
      } finally {
        setBusy((b) => b - 1);
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    handle(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      className={`relative aspect-[4/3] rounded-2xl border-2 border-dashed grid place-items-center text-center p-6 transition-colors duration-300 ${drag ? 'border-leaf bg-leaf/5' : 'border-ink/20 bg-surface/50'}`}
    >
      <div>
        <motion.span
          animate={drag ? { y: -6, scale: 1.08 } : { y: 0, scale: 1 }}
          className="mx-auto w-16 h-16 rounded-2xl bg-leaf text-bg grid place-items-center"
        >
          <Upload width={28} height={28} />
        </motion.span>
        <p className="mt-4 font-medium text-[1.05rem]">{busy > 0 ? `Checking ${busy} photo${busy > 1 ? 's' : ''}…` : 'Drop shelf photos here'}</p>
        <p className="mt-1 text-[0.88rem] text-muted">JPG or PNG, up to 6. On a phone this opens your camera roll or camera.</p>
        <button className="btn-primary mt-5" onClick={() => inputRef.current?.click()}>
          Choose photos
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            handle(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
