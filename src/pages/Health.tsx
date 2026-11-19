import { ChangeEvent, FormEvent, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { NextStep, Page, PageHeader, ease } from '../components/Page';
import { Heart, Plus, Pulse, Reset, Stethoscope, X } from '../components/Icons';
import { uid } from '../lib/quality';
import { GlucosePoint, Reading, Member, useKitchen } from '../lib/store';
import { aggregateNutrition, Nutrition, rankRecipes, useRecipes } from '../lib/recipes';
import { computeStats, parseCgmCsv } from '../lib/cgm';

// 2017 ACC/AHA adult blood-pressure categories.
function bpCategory(sys: number, dia: number): { label: string; tone: string } {
  if (sys >= 140 || dia >= 90) return { label: 'Stage 2 high', tone: 'bg-chilli text-bg' };
  if (sys >= 130 || dia >= 80) return { label: 'Stage 1 high', tone: 'bg-clay text-bg' };
  if (sys >= 120) return { label: 'Elevated', tone: 'bg-turmeric text-ink' };
  return { label: 'Normal', tone: 'bg-leaf text-bg' };
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export default function Health() {
  const { items, members, readings, addReading, removeReading, glucose, addGlucose, clearGlucose } = useKitchen();
  const { recipes } = useRecipes();

  // Pantry-weighted nutrition average across the top matching recipes.
  // Same signal that drives the Pantry "Nutrition profile" card, reused here
  // to tie each member's condition to a real food-facing recommendation.
  const nutriProfile = useMemo(() => {
    if (items.length === 0 || recipes.length === 0) return null;
    const pantry = new Set(items.map((i) => i.id));
    const scored = rankRecipes(recipes, pantry, members);
    return aggregateNutrition(scored, 12);
  }, [items, recipes, members]);

  const [memberId, setMemberId] = useState(members[0].id);
  const [date, setDate] = useState(today);
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [hr, setHr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const member = members.find((m) => m.id === memberId) ?? members[0];
  const nameOf = (id: number) => members.find((m) => m.id === id)?.name ?? 'Removed member';

  const byMember = useMemo(() => {
    const map = new Map<number, Reading[]>();
    for (const r of [...readings].sort((a, b) => a.date.localeCompare(b.date))) {
      map.set(r.memberId, [...(map.get(r.memberId) ?? []), r]);
    }
    return map;
  }, [readings]);

  const series = byMember.get(member.id) ?? [];
  const history = useMemo(() => [...readings].sort((a, b) => b.date.localeCompare(a.date)), [readings]);

  const latest = members
    .map((m) => {
      const rs = byMember.get(m.id);
      return rs ? rs[rs.length - 1] : undefined;
    })
    .filter((r): r is Reading => Boolean(r));
  const avg = (f: (r: Reading) => number) => Math.round(latest.reduce((s, r) => s + f(r), 0) / latest.length);
  const normal = latest.filter((r) => bpCategory(r.sys, r.dia).label === 'Normal').length;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = Number(sys);
    const d = Number(dia);
    const h = Number(hr);
    if (!date || date > today()) return setError('Pick a date that is today or earlier.');
    if (!(s >= 70 && s <= 250)) return setError('Systolic should be between 70 and 250 mmHg.');
    if (!(d >= 40 && d <= 150)) return setError('Diastolic should be between 40 and 150 mmHg.');
    if (d >= s) return setError('Systolic (the first number) should be higher than diastolic.');
    if (!(h >= 30 && h <= 220)) return setError('Heart rate should be between 30 and 220 bpm.');
    addReading({ id: uid(), memberId: member.id, date, sys: Math.round(s), dia: Math.round(d), hr: Math.round(h) });
    setSys('');
    setDia('');
    setHr('');
    setError(null);
  };

  const field = 'mt-1 w-full h-11 px-3 rounded-xl border border-ink/15 bg-white focus:outline-none focus:border-leaf';

  return (
    <Page>
      <PageHeader
        step="07"
        kicker="Family health log"
        icon={<Pulse />}
        title="Readings you take, trends you can see."
        lead="Log a blood pressure and resting heart rate reading for anyone on your Family page. AHAAR keeps the history on this device, charts it, and uses the latest reading when it sizes that person's portions."
      />

      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Readings logged', value: `${readings.length}`, unit: '', icon: <Stethoscope width={16} />, tone: 'border-turmeric/40 bg-turmeric/10' },
          { label: 'Avg latest BP', value: latest.length ? `${avg((r) => r.sys)}/${avg((r) => r.dia)}` : '—', unit: 'mmHg', icon: <Pulse width={16} />, tone: 'border-clay/30 bg-clay/5' },
          { label: 'Avg latest heart rate', value: latest.length ? `${avg((r) => r.hr)}` : '—', unit: 'bpm', icon: <Heart width={16} />, tone: 'border-chilli/30 bg-chilli/5' },
          { label: 'In normal BP range', value: latest.length ? `${normal} of ${latest.length}` : '—', unit: 'members', icon: <Heart width={16} />, tone: 'border-leaf/30 bg-leaf/5' },
        ].map((c) => (
          <div key={c.label} className={`card p-5 ${c.tone}`}>
            <div className="flex items-center justify-between">
              <span className="text-[0.76rem] uppercase tracking-wider font-bold text-ink/70">{c.label}</span>
              <span className="w-8 h-8 rounded-full bg-white/70 grid place-items-center">{c.icon}</span>
            </div>
            <p className="font-display text-[2.2rem] font-bold text-ink mt-2 leading-none">
              {c.value}
              {c.unit && <span className="text-base text-muted font-normal font-sans"> {c.unit}</span>}
            </p>
          </div>
        ))}
      </section>

      <NutritionAdvice profile={nutriProfile} members={members} pantrySize={items.length} />

      <CgmSection
        member={member}
        members={members}
        glucose={glucose}
        addGlucose={addGlucose}
        clearGlucose={clearGlucose}
        setMemberId={setMemberId}
      />

      <div className="mt-6 grid lg:grid-cols-[1fr_1.5fr] gap-6 items-start">
        <section className="card p-5 md:p-6">
          <h2 className="font-display text-xl">Log a reading</h2>
          <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
            <label className="block text-[0.82rem] font-medium text-muted">
              Family member
              <select value={member.id} onChange={(e) => setMemberId(Number(e.target.value))} className={field}>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name || `Member ${m.id}`}</option>)}
              </select>
            </label>
            <label className="block text-[0.82rem] font-medium text-muted">
              Date
              <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className={field} />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-[0.82rem] font-medium text-muted">
                Systolic
                <input inputMode="numeric" value={sys} onChange={(e) => setSys(e.target.value)} placeholder="120" className={field} />
              </label>
              <label className="block text-[0.82rem] font-medium text-muted">
                Diastolic
                <input inputMode="numeric" value={dia} onChange={(e) => setDia(e.target.value)} placeholder="80" className={field} />
              </label>
              <label className="block text-[0.82rem] font-medium text-muted">
                Heart rate
                <input inputMode="numeric" value={hr} onChange={(e) => setHr(e.target.value)} placeholder="72" className={field} />
              </label>
            </div>
            {error && <p role="alert" className="text-[0.85rem] text-chilli">{error}</p>}
            <button type="submit" className="btn-primary w-full"><Plus width={18} /> Save reading</button>
          </form>
          <p className="mt-4 text-[0.78rem] text-muted">
            Sit quietly for five minutes before measuring, and measure at the same time each day so readings compare fairly.
          </p>
        </section>

        <section className="card p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl">Trend</h2>
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMemberId(m.id)}
                  aria-pressed={m.id === member.id}
                  className={`chip !py-1.5 !px-3 text-[0.8rem] transition-colors ${m.id === member.id ? 'bg-ink text-bg border-ink' : 'border-ink/15 hover:border-ink/30 bg-white/70'}`}
                >
                  {m.name || `Member ${m.id}`}
                </button>
              ))}
            </div>
          </div>

          {series.length === 0 ? (
            <p className="mt-8 mb-6 text-center text-muted text-[0.92rem]">
              No readings for {member.name || 'this member'} yet. Save one on the left to start the chart.
            </p>
          ) : (
            <>
              <TrendChart series={series} />
              <Summary series={series} />
            </>
          )}
        </section>
      </div>

      <section className="card p-5 md:p-6 mt-6">
        <h2 className="font-display text-xl">History</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-muted text-[0.92rem]">Nothing logged yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-ink/10">
            {history.map((r) => {
              const cat = bpCategory(r.sys, r.dia);
              return (
                <li key={r.id} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.92rem]">
                  <span className="w-16 text-muted tabular-nums">{shortDate(r.date)}</span>
                  <span className="font-medium flex-1 min-w-[90px]">{nameOf(r.memberId)}</span>
                  <span className="tabular-nums">{r.sys}/{r.dia} <span className="text-muted text-[0.8rem]">mmHg</span></span>
                  <span className="tabular-nums">{r.hr} <span className="text-muted text-[0.8rem]">bpm</span></span>
                  <span className={`px-2 py-0.5 rounded-md text-[0.72rem] font-bold ${cat.tone}`}>{cat.label}</span>
                  <button onClick={() => removeReading(r.id)} aria-label={`Delete reading from ${shortDate(r.date)} for ${nameOf(r.memberId)}`} className="w-8 h-8 rounded-full grid place-items-center text-muted hover:text-chilli">
                    <X width={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-[0.78rem] text-muted">
          Categories follow the 2017 ACC/AHA adult guideline. This is a log, not a diagnosis; share worrying readings with a doctor.
        </p>
      </section>

      <NextStep to="/family" label="Family portions & details" hint="Calibrate disease, BP, and heart rate for everyone at the table." />
    </Page>
  );
}

function Summary({ series }: { series: Reading[] }) {
  const first = series[0];
  const last = series[series.length - 1];
  const cat = bpCategory(last.sys, last.dia);
  return (
    <div className="mt-4 grid sm:grid-cols-3 gap-3 text-[0.88rem]">
      <div className="rounded-xl bg-clay/5 border border-clay/20 p-3">
        <p className="text-[0.75rem] font-bold text-clay">Blood pressure</p>
        <p className="mt-1 font-bold text-[1.05rem] tabular-nums">{last.sys}/{last.dia}</p>
        <p className="text-muted text-[0.78rem]">
          {series.length > 1 ? `${signed(last.sys - first.sys)} / ${signed(last.dia - first.dia)} since ${shortDate(first.date)}` : 'First reading'}
        </p>
      </div>
      <div className="rounded-xl bg-chilli/5 border border-chilli/20 p-3">
        <p className="text-[0.75rem] font-bold text-chilli">Heart rate</p>
        <p className="mt-1 font-bold text-[1.05rem] tabular-nums">{last.hr} bpm</p>
        <p className="text-muted text-[0.78rem]">
          {series.length > 1 ? `${signed(last.hr - first.hr)} bpm since ${shortDate(first.date)}` : 'First reading'}
        </p>
      </div>
      <div className="rounded-xl bg-surface border border-ink/10 p-3">
        <p className="text-[0.75rem] font-bold text-muted">Latest category</p>
        <p className="mt-1.5"><span className={`px-2 py-1 rounded-md text-[0.78rem] font-bold ${cat.tone}`}>{cat.label}</span></p>
        <p className="mt-1.5 text-muted text-[0.78rem]">{series.length} reading{series.length === 1 ? '' : 's'}</p>
      </div>
    </div>
  );
}

/** Condition -> which nutrients to watch, with a soft target and friendly
 * guidance. Rule-based; shown in the UI as "not medical advice". */
type NutrientKey = keyof Omit<Nutrition, 'source'>;
type Watch = { key: NutrientKey; label: string; unit: string; targetHigh?: number; targetLow?: number; note: string };

function watchFor(disease: string): Watch[] {
  const d = disease.toLowerCase();
  const w: Watch[] = [];
  if (/hyper|bp|pressur/.test(d)) {
    w.push({ key: 'sodium', label: 'Sodium', unit: 'mg', targetHigh: 600,
      note: 'Keep per-dish sodium low — the DASH approach aims for <1500 mg/day across all meals.' });
  }
  if (/diabet|sugar|pre[- ]?diabet/.test(d)) {
    w.push({ key: 'sugar', label: 'Free sugar', unit: 'g', targetHigh: 10,
      note: 'Free sugar spikes blood glucose fastest.' });
    w.push({ key: 'fibre', label: 'Fibre', unit: 'g', targetLow: 4,
      note: 'Fibre blunts the glycemic response of a dish.' });
  }
  if (/cholest|heart|cardio/.test(d)) {
    w.push({ key: 'fat', label: 'Fat', unit: 'g', targetHigh: 18,
      note: 'Trim saturated-fat sources (ghee, cream, deep-frying) when possible.' });
    w.push({ key: 'fibre', label: 'Fibre', unit: 'g', targetLow: 4,
      note: 'Soluble fibre helps lower LDL cholesterol over time.' });
  }
  if (/reflux|acid|gerd|ulcer/.test(d)) {
    w.push({ key: 'fat', label: 'Fat', unit: 'g', targetHigh: 15,
      note: 'High-fat meals slow gastric emptying and worsen reflux.' });
  }
  if (w.length === 0) {
    // Healthy / unspecified: just show protein as a positive signal.
    w.push({ key: 'protein', label: 'Protein', unit: 'g', targetLow: 10,
      note: 'Aim for a steady protein intake across meals.' });
  }
  return w;
}

function NutritionAdvice({
  profile,
  members,
  pantrySize,
}: {
  profile: ReturnType<typeof aggregateNutrition>;
  members: Member[];
  pantrySize: number;
}) {
  if (!profile) {
    return (
      <section className="card p-5 md:p-6 mt-6">
        <p className="kicker text-leaf">Nutrition-aware advice</p>
        <h2 className="font-display text-xl mt-0.5">What to eat for today's readings</h2>
        <p className="mt-2 text-[0.88rem] text-muted">
          {pantrySize === 0
            ? <>Your pantry is empty — <Link to="/scan" className="text-leaf underline underline-offset-2">scan a shelf</Link> so AHAAR can pair each member&apos;s condition with specific nutrients to watch.</>
            : 'Recipes are still loading. Advice appears once at least one pantry item matches a dish in the nutrition dataset.'}
        </p>
      </section>
    );
  }

  const avg = profile.avg;

  return (
    <section className="card p-5 md:p-6 mt-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="kicker text-leaf">Nutrition-aware advice</p>
          <h2 className="font-display text-xl mt-0.5">What to watch, per member</h2>
          <p className="text-[0.78rem] text-muted mt-1">
            Based on the top {profile.count} dish{profile.count === 1 ? '' : 'es'} your pantry can make,
            averaged from the Indian Food Nutrition dataset. Rule-based — not medical advice.
          </p>
        </div>
        <span className="chip border-leaf/30 bg-leaf/10 text-leaf !text-[0.72rem]">
          Per typical dish
        </span>
      </div>

      <ul className="mt-4 grid md:grid-cols-2 gap-3">
        {members.map((m) => {
          const items = watchFor(m.disease);
          return (
            <li key={m.id} className="rounded-xl border border-ink/10 bg-surface/60 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-lg leading-tight">{m.name || `Member ${m.id}`}</p>
                  <p className="mt-0.5 text-[0.78rem] text-muted flex items-center gap-1">
                    <Stethoscope width={13} className="text-leaf" />
                    <span>{m.disease || 'Healthy'}</span>
                  </p>
                </div>
                <span className="chip border-ink/10 bg-white !text-[0.68rem] text-muted tabular-nums">
                  {Math.round(avg.calories)} kcal
                </span>
              </div>

              <ul className="mt-3 space-y-2">
                {items.map((w) => {
                  const v = avg[w.key] as number;
                  const overHigh = w.targetHigh != null && v > w.targetHigh;
                  const underLow = w.targetLow != null && v < w.targetLow;
                  const ok = !overHigh && !underLow;
                  const toneBg = ok ? 'bg-leaf/10' : overHigh ? 'bg-chilli/10' : 'bg-turmeric/10';
                  const toneText = ok ? 'text-leaf' : overHigh ? 'text-chilli' : 'text-amber-800';
                  const verdict = ok
                    ? 'in target'
                    : overHigh
                      ? `over target (${w.targetHigh} ${w.unit})`
                      : `under target (${w.targetLow} ${w.unit})`;
                  return (
                    <li key={w.key} className="flex items-start gap-3">
                      <span className={`shrink-0 w-14 text-center rounded-md px-1 py-0.5 ${toneBg} ${toneText} font-bold text-[0.78rem] tabular-nums`}>
                        {v.toFixed(v >= 100 ? 0 : 1)}{w.unit !== 'kcal' ? w.unit : ''}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[0.82rem] font-semibold text-ink">{w.label} — <span className={`${toneText} font-normal`}>{verdict}</span></p>
                        <p className="text-[0.75rem] text-muted leading-snug">{w.note}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TrendChart({ series }: { series: Reading[] }) {
  const W = 520;
  const H = 200;
  const pad = { l: 34, r: 12, t: 14, b: 26 };
  const values = series.flatMap((r) => [r.sys, r.dia, r.hr]);
  const lo = Math.floor((Math.min(...values) - 8) / 10) * 10;
  const hi = Math.ceil((Math.max(...values) + 8) / 10) * 10;
  const x = (i: number) => (series.length === 1 ? (pad.l + W - pad.r) / 2 : pad.l + (i / (series.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const line = (f: (r: Reading) => number) => series.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(f(r)).toFixed(1)}`).join(' ');
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  const labelEvery = Math.ceil(series.length / 6);
  const lines = [
    { key: 'sys', f: (r: Reading) => r.sys, color: '#C8693E', label: 'Systolic' },
    { key: 'dia', f: (r: Reading) => r.dia, color: '#E0A21B', label: 'Diastolic' },
    { key: 'hr', f: (r: Reading) => r.hr, color: '#B8371F', label: 'Heart rate' },
  ];

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-4 text-[0.78rem] text-muted">
        {lines.map((l) => (
          <span key={l.key} className="flex items-center gap-1.5"><span className="w-3 h-1 rounded-full" style={{ background: l.color }} /> {l.label}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full h-auto" role="img" aria-label={`Blood pressure and heart rate across ${series.length} readings`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#2B2420" strokeOpacity="0.08" strokeDasharray="4 4" />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="#6F6152">{t}</text>
          </g>
        ))}
        {lines.map((l) => (
          <g key={l.key}>
            {series.length > 1 && (
              <motion.path
                d={line(l.f)}
                fill="none"
                stroke={l.color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.9, ease }}
              />
            )}
            {series.map((r, i) => <circle key={r.id} cx={x(i)} cy={y(l.f(r))} r="3.5" fill="#FFFFFF" stroke={l.color} strokeWidth="2" />)}
          </g>
        ))}
        {series.map((r, i) =>
          i % labelEvery === 0 || i === series.length - 1 ? (
            <text key={r.id} x={x(i)} y={H - 6} textAnchor={series.length === 1 ? 'middle' : i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'} fontSize="10" fill="#6F6152">{shortDate(r.date)}</text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

// -----------------------------------------------------------------------------
// CGM ingest: upload a LibreView/Dexcom CSV, parse it, store it per member,
// and show stats + a 24h curve. Metrics follow the ADA 2020 consensus.
// -----------------------------------------------------------------------------

function CgmSection({
  member,
  members,
  glucose,
  addGlucose,
  clearGlucose,
  setMemberId,
}: {
  member: Member;
  members: Member[];
  glucose: GlucosePoint[];
  addGlucose: (p: GlucosePoint[]) => void;
  clearGlucose: (memberId: number) => void;
  setMemberId: (id: number) => void;
}) {
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const myPoints = useMemo(
    () => glucose.filter((g) => g.memberId === member.id),
    [glucose, member.id],
  );
  const stats = useMemo(() => computeStats(myPoints), [myPoints]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      const text = await f.text();
      const { points, format, skipped, error } = parseCgmCsv(text);
      if (error) {
        setMsg({ tone: 'err', text: error });
      } else if (points.length === 0) {
        setMsg({ tone: 'err', text: `Parsed 0 glucose rows (skipped ${skipped}). Check the file format.` });
      } else {
        addGlucose(points.map((p) => ({ ...p, memberId: member.id })));
        setMsg({ tone: 'ok', text: `Imported ${points.length} ${format === 'unknown' ? '' : format + ' '}points for ${member.name || 'this member'}${skipped ? `, skipped ${skipped}` : ''}.` });
      }
    } catch (err) {
      setMsg({ tone: 'err', text: err instanceof Error ? err.message : 'Could not read the file.' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="card p-5 md:p-6 mt-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="kicker text-leaf">Continuous Glucose Monitor</p>
          <h2 className="font-display text-xl mt-0.5">Upload a CGM export</h2>
          <p className="mt-1 text-[0.82rem] text-muted max-w-[62ch]">
            Drop in a CSV from <strong>Abbott LibreView</strong> or <strong>Dexcom Clarity</strong> for {member.name || 'this member'} and AHAAR computes the standard
            ADA 2020 metrics — Time-in-Range, GMI (estimated A1c), coefficient of variation, and hypo/hyper events.
            Everything stays on this device.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`btn-accent cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            <Plus width={16} /> {busy ? 'Reading…' : 'Upload CGM CSV'}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="hidden"
              aria-label="Upload CGM CSV for this member"
            />
          </label>
          {myPoints.length > 0 && (
            <button
              className="btn-ghost"
              onClick={() => {
                if (confirm(`Remove all ${myPoints.length} CGM points for ${member.name}?`)) clearGlucose(member.id);
              }}
            >
              <Reset width={16} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Member picker (reuses the one from the reading log) */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {members.map((m) => {
          const count = glucose.filter((g) => g.memberId === m.id).length;
          return (
            <button
              key={m.id}
              onClick={() => setMemberId(m.id)}
              aria-pressed={m.id === member.id}
              className={`chip !py-1.5 !px-3 text-[0.8rem] transition-colors ${m.id === member.id ? 'bg-ink text-bg border-ink' : 'border-ink/15 hover:border-ink/30 bg-white/70'}`}
            >
              {m.name || `Member ${m.id}`}
              {count > 0 && <span className={`ml-1.5 text-[0.7rem] tabular-nums ${m.id === member.id ? 'text-turmeric' : 'text-leaf'}`}>{count}</span>}
            </button>
          );
        })}
      </div>

      {msg && (
        <p
          role={msg.tone === 'err' ? 'alert' : undefined}
          className={`mt-3 text-[0.85rem] ${msg.tone === 'err' ? 'text-chilli' : msg.tone === 'ok' ? 'text-leaf' : 'text-muted'}`}
        >
          {msg.text}
        </p>
      )}

      {stats ? (
        <>
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { k: 'meanMgdl', label: 'Mean glucose', unit: 'mg/dL', v: stats.meanMgdl, tone: 'ink' },
              { k: 'gmiPct',   label: 'GMI (est. A1c)', unit: '%',    v: stats.gmiPct, tone: stats.gmiPct > 7 ? 'chilli' : 'leaf' },
              { k: 'tirPct',   label: 'Time in range', unit: '%',    v: stats.tirPct, tone: stats.tirPct >= 70 ? 'leaf' : stats.tirPct >= 50 ? 'turmeric' : 'chilli' },
              { k: 'tarPct',   label: 'Above range',   unit: '%',    v: stats.tarPct, tone: stats.tarPct > 25 ? 'chilli' : 'muted' },
              { k: 'tbrPct',   label: 'Below range',   unit: '%',    v: stats.tbrPct, tone: stats.tbrPct > 4  ? 'chilli' : 'muted' },
              { k: 'cvPct',    label: 'CV (variability)', unit: '%', v: stats.cvPct,  tone: stats.cvPct > 36 ? 'turmeric' : 'leaf' },
            ].map((c) => (
              <div key={c.k} className="rounded-xl bg-surface p-3 border border-ink/5">
                <p className="text-[0.68rem] uppercase tracking-wider text-muted font-semibold">{c.label}</p>
                <p className={`font-display text-xl mt-0.5 tabular-nums ${c.tone === 'chilli' ? 'text-chilli' : c.tone === 'leaf' ? 'text-leaf' : c.tone === 'turmeric' ? 'text-amber-800' : 'text-ink'}`}>
                  {c.v}
                  <span className="text-[0.75rem] text-muted ml-1 font-sans font-normal">{c.unit}</span>
                </p>
              </div>
            ))}
          </div>
          <GlucoseCurve points={myPoints} />
          <p className="mt-2 text-[0.72rem] text-muted">
            70-180 mg/dL is the standard "in range" band for adults; targets differ for pregnancy or paediatric care.
            {stats.hypoCount > 0 && <> · <span className="text-chilli font-medium">{stats.hypoCount} hypo event{stats.hypoCount === 1 ? '' : 's'}</span> (≥15 min below 70).</>}
            {stats.hyperCount > 0 && <> · <span className="text-amber-800 font-medium">{stats.hyperCount} hyper event{stats.hyperCount === 1 ? '' : 's'}</span> (≥15 min above 180).</>}
            {' '}Covers {stats.spanHours < 24 ? `${stats.spanHours.toFixed(1)} hours` : `${(stats.spanHours / 24).toFixed(1)} days`} of {stats.count} points.
          </p>
        </>
      ) : (
        <p className="mt-6 text-[0.9rem] text-muted">
          No CGM data for {member.name || 'this member'} yet. The LibreView CSV is downloaded from{' '}
          <a className="text-leaf underline underline-offset-2" href="https://www.libreview.com" target="_blank" rel="noreferrer">libreview.com</a>{' '}
          under <em>Glucose History → Export</em>; Dexcom exports come from{' '}
          <a className="text-leaf underline underline-offset-2" href="https://clarity.dexcom.com" target="_blank" rel="noreferrer">Dexcom Clarity</a>.
        </p>
      )}
    </section>
  );
}

/** Minimal glucose curve: one dot per point, 70-180 mg/dL "in range" band
 * shaded behind. Auto-fits time axis. */
function GlucoseCurve({ points }: { points: { ts: string; mgdl: number }[] }) {
  if (points.length < 2) return null;
  const W = 780;
  const H = 240;
  const pad = { l: 36, r: 12, t: 12, b: 24 };
  const t0 = Date.parse(points[0].ts);
  const t1 = Date.parse(points[points.length - 1].ts);
  const span = Math.max(1, t1 - t0);
  const lo = Math.min(50, Math.floor(Math.min(...points.map((p) => p.mgdl)) / 20) * 20);
  const hi = Math.max(300, Math.ceil(Math.max(...points.map((p) => p.mgdl)) / 20) * 20);
  const x = (ts: string) => pad.l + ((Date.parse(ts) - t0) / span) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)} ${y(p.mgdl).toFixed(1)}`).join(' ');
  const yTicks = [lo, 70, 140, 180, hi].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  const totalHours = span / 3_600_000;
  const xTicks: { ts: number; label: string }[] = [];
  const step = totalHours <= 48 ? 6 : totalHours <= 168 ? 24 : 48; // 6h / 1d / 2d
  for (let t = Math.ceil(t0 / (step * 3_600_000)) * step * 3_600_000; t <= t1; t += step * 3_600_000) {
    const d2 = new Date(t);
    xTicks.push({
      ts: t,
      label: totalHours <= 48
        ? `${String(d2.getHours()).padStart(2, '0')}:${String(d2.getMinutes()).padStart(2, '0')}`
        : d2.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-4" role="img" aria-label={`Glucose curve over ${totalHours.toFixed(0)} hours`}>
      {/* 70-180 in-range band */}
      <rect x={pad.l} y={y(180)} width={W - pad.l - pad.r} height={y(70) - y(180)} fill="#3F6B3A" opacity="0.08" />
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#2B2420" strokeOpacity={v === 70 || v === 180 ? 0.28 : 0.08} strokeDasharray={v === 70 || v === 180 ? '0' : '4 4'} />
          <text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#6F6152">{v}</text>
        </g>
      ))}
      {xTicks.map((t, i) => {
        const tx = pad.l + ((t.ts - t0) / span) * (W - pad.l - pad.r);
        return (
          <text key={i} x={tx} y={H - 6} textAnchor="middle" fontSize="10" fill="#6F6152">{t.label}</text>
        );
      })}
      <motion.path
        d={d}
        fill="none"
        stroke="#C8693E"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease }}
      />
    </svg>
  );
}
