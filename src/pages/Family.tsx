import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { NextStep, Page, PageHeader, ease } from '../components/Page';
import { Bowl, Heart, People, Plus, Pulse, Stethoscope, X } from '../components/Icons';
import { Member, useKitchen } from '../lib/store';

const FOODS = [
  { key: 'roti', label: 'Roti', unit: 'pcs', base: 3, color: '#D9A86C' },
  { key: 'rice', label: 'Rice', unit: 'g', base: 150, color: '#F1EADA' },
  { key: 'dal', label: 'Dal', unit: 'ml', base: 200, color: '#E0A21B' },
  { key: 'sabzi', label: 'Sabzi', unit: 'g', base: 150, color: '#3F6B3A' },
] as const;

const COMMON_DISEASES = [
  'Hypertension',
  'Pre-Diabetes',
  'High Cholesterol',
  'Acid Reflux',
  'None (Healthy)',
];

function baseFactor(m: Member) {
  let f = 1.0;
  const d = m.disease.toLowerCase();
  if (d.includes('diabet')) f *= 0.9;
  if (d.includes('hyper') || d.includes('bp') || d.includes('pressur')) f *= 0.92;
  if (d.includes('heart') || d.includes('cardio')) f *= 0.88;
  if (d.includes('none') || d.includes('healthy') || d.includes('active')) f *= 1.15;
  if (m.heartRate > 85) f *= 0.94;
  else if (m.heartRate < 68) f *= 1.06;
  return f;
}

export default function Family() {
  const { members, setMembers } = useKitchen();
  const [sel, setSel] = useState(members[0].id);

  const portions = useMemo(
    () =>
      members.map((m) => {
        const f = baseFactor(m);
        const food = FOODS.map((x) => {
          const amount =
            x.unit === 'pcs'
              ? Math.max(1, Math.round(x.base * f))
              : Math.round((x.base * f) / 10) * 10;
          return { ...x, amount, f };
        });
        return { m, food };
      }),
    [members],
  );

  const update = (id: number, patch: Partial<Member>) =>
    setMembers(members.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const add = () => {
    if (members.length >= 6) return;
    const id = Math.max(0, ...members.map((m) => m.id)) + 1;
    setMembers([
      ...members,
      {
        id,
        name: `Member ${id}`,
        disease: 'None (Healthy)',
        bp: '120/80',
        heartRate: 72,
      },
    ]);
    setSel(id);
  };

  const remove = (id: number) => {
    if (members.length <= 1) return;
    const next = members.filter((m) => m.id !== id);
    setMembers(next);
    if (sel === id) setSel(next[0].id);
  };

  const cur = members.find((m) => m.id === sel) ?? members[0];
  const total = FOODS.map((x) => {
    const sum = portions.reduce((s, p) => s + p.food.find((f) => f.key === x.key)!.amount, 0);
    return { ...x, sum };
  });

  return (
    <Page>
      <PageHeader
        step="05"
        kicker="Family portions"
        icon={<People />}
        title="One meal. Portioned for everyone."
        lead="Add each family member's disease, blood pressure (BP), and heart rate. Portions of roti, rice, dal and sabzi automatically adapt to keep everyone healthy."
      />

      <div className="grid lg:grid-cols-[1fr_1.2fr] gap-6 items-start">
        {/* Members Column */}
        <section className="card p-5 md:p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-xl text-ink">Family Health Details</h2>
              <p className="text-[0.78rem] text-muted">Disease, BP &amp; Heart Rate per member</p>
            </div>
            <button
              className="btn-ghost !min-h-[38px] !px-3 text-[0.85rem]"
              onClick={add}
              disabled={members.length >= 6}
            >
              <Plus width={16} /> Add
            </button>
          </div>

          {/* Member Tabs */}
          <ul className="mt-4 flex flex-wrap gap-2">
            {members.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => setSel(m.id)}
                  className={`chip !py-2 !px-3.5 transition-all duration-200 ${
                    m.id === cur.id
                      ? 'bg-ink text-bg border-ink shadow-sm scale-[1.02]'
                      : 'border-ink/15 hover:border-ink/40 bg-white/50'
                  }`}
                >
                  <span className="w-6 h-6 -ml-1 rounded-full bg-turmeric text-ink grid place-items-center text-[0.72rem] font-bold">
                    {(m.name[0] || 'M').toUpperCase()}
                  </span>
                  <span className="font-medium">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>

          {/* Selected Member Form - ONLY Disease, BP, Heart Rate */}
          <motion.div
            key={cur.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease }}
            className="mt-6 space-y-4"
          >
            <label className="block">
              <span className="text-[0.82rem] font-medium text-muted">Member Name</span>
              <input
                value={cur.name}
                onChange={(e) => update(cur.id, { name: e.target.value })}
                className="mt-1 w-full h-11 px-4 rounded-xl border border-ink/15 bg-white focus:outline-none focus:border-leaf font-medium text-ink transition-colors"
                placeholder="e.g. Papa, Mummy, Aarav, Dadi..."
              />
            </label>

            {/* Disease Field */}
            <div className="block">
              <div className="flex items-center justify-between text-[0.82rem]">
                <span className="font-medium text-muted flex items-center gap-1.5">
                  <Stethoscope width={15} className="text-leaf" /> Disease / Health Condition
                </span>
                <span className="text-[0.72rem] text-muted">Select or type</span>
              </div>
              <input
                value={cur.disease}
                onChange={(e) => update(cur.id, { disease: e.target.value })}
                className="mt-1.5 w-full h-11 px-4 rounded-xl border border-ink/15 bg-white focus:outline-none focus:border-leaf font-medium text-ink transition-colors"
                placeholder="e.g. Hypertension, Pre-Diabetes, None..."
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {COMMON_DISEASES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => update(cur.id, { disease: d })}
                    className={`text-[0.72rem] px-2.5 py-1 rounded-lg border transition-all ${
                      cur.disease === d
                        ? 'bg-leaf text-bg border-leaf font-semibold'
                        : 'border-ink/10 bg-surface/50 text-muted hover:text-ink hover:border-ink/25'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* BP Field */}
            <label className="block">
              <div className="flex justify-between text-[0.82rem]">
                <span className="font-medium text-muted flex items-center gap-1.5">
                  <Pulse width={15} className="text-clay" /> Blood Pressure (BP)
                </span>
                <span className="font-bold text-ink text-[0.85rem]">{cur.bp} mmHg</span>
              </div>
              <div className="mt-1.5 relative">
                <input
                  type="text"
                  value={cur.bp}
                  onChange={(e) => update(cur.id, { bp: e.target.value })}
                  placeholder="e.g. 120/80"
                  className="w-full h-11 px-4 pr-16 rounded-xl border border-ink/15 bg-white focus:outline-none focus:border-leaf font-medium text-ink transition-colors"
                />
                <span className="absolute right-3.5 top-3 text-[0.75rem] font-medium text-muted">
                  mmHg
                </span>
              </div>
              <p className="text-[0.72rem] text-muted mt-1">
                Systolic/Diastolic reading (e.g. 120/80 is normal range)
              </p>
            </label>

            {/* Heart Rate Field */}
            <label className="block">
              <div className="flex justify-between text-[0.82rem]">
                <span className="font-medium text-muted flex items-center gap-1.5">
                  <Heart width={15} className="text-chilli" /> Heart Rate (Resting HR)
                </span>
                <span className="font-bold text-ink text-[0.85rem]">{cur.heartRate} bpm</span>
              </div>
              <div className="mt-1.5 relative">
                <input
                  type="number"
                  min={40}
                  max={160}
                  value={cur.heartRate}
                  onChange={(e) => update(cur.id, { heartRate: Number(e.target.value) || 0 })}
                  placeholder="e.g. 72"
                  className="w-full h-11 px-4 pr-16 rounded-xl border border-ink/15 bg-white focus:outline-none focus:border-leaf font-medium text-ink transition-colors"
                />
                <span className="absolute right-3.5 top-3 text-[0.75rem] font-medium text-muted">
                  bpm
                </span>
              </div>
              <p className="text-[0.72rem] text-muted mt-1">
                Typical resting heart rate is between 60 – 100 bpm
              </p>
            </label>

            {/* Remove member button */}
            <div className="pt-2 flex items-center justify-between">
              <button
                className="text-[0.85rem] text-chilli hover:text-chilli/80 font-medium flex items-center gap-1.5 disabled:opacity-30 transition-opacity"
                onClick={() => remove(cur.id)}
                disabled={members.length <= 1}
              >
                <X width={15} /> Remove {cur.name}
              </button>
              <span className="text-[0.75rem] text-muted">{members.length} / 6 members</span>
            </div>
          </motion.div>
        </section>

        {/* Plates Column */}
        <section className="card p-5 md:p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-xl text-ink">Plates &amp; Calibrated Portions</h2>
              <p className="text-[0.8rem] text-muted mt-0.5">
                Portions tailored strictly by disease, BP &amp; heart rate
              </p>
            </div>
            <span className="chip text-[0.75rem] bg-leaf/10 border-leaf/30 text-leaf font-semibold">
              Health-adapted
            </span>
          </div>

          <ul className="mt-4 grid sm:grid-cols-2 gap-4">
            {portions.map(({ m, food }) => {
              const isSelected = m.id === cur.id;
              return (
                <li
                  key={m.id}
                  onClick={() => setSel(m.id)}
                  className={`rounded-2xl p-4 cursor-pointer transition-all duration-200 border ${
                    isSelected
                      ? 'bg-turmeric/10 border-turmeric shadow-md ring-2 ring-turmeric/60 scale-[1.01]'
                      : 'bg-white/60 hover:bg-white border-ink/10 hover:border-ink/25 shadow-xs'
                  }`}
                >
                  <Plate food={food} />

                  <div className="text-center mt-3">
                    <p className="font-display text-lg font-semibold text-ink leading-tight">{m.name}</p>
                    {/* ONLY Disease, BP, Heart Rate */}
                    <div className="mt-1.5 flex flex-wrap justify-center gap-1">
                      <span className="px-2 py-0.5 rounded-md bg-leaf/10 text-leaf border border-leaf/20 text-[0.72rem] font-semibold">
                        {m.disease || 'Healthy'}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-clay/10 text-clay border border-clay/20 text-[0.72rem] font-semibold">
                        BP: {m.bp}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-chilli/10 text-chilli border border-chilli/20 text-[0.72rem] font-semibold">
                        HR: {m.heartRate} bpm
                      </span>
                    </div>
                  </div>

                  <ul className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 text-[0.78rem] pt-3 border-t border-ink/10">
                    {food.map((x) => {
                      const bowlOrCup =
                        x.unit === 'g'
                          ? `(${Number((x.amount / 100).toFixed(1))} bowl)`
                          : x.unit === 'ml'
                          ? `(${Number((x.amount / 100).toFixed(1))} cup)`
                          : '';
                      return (
                        <li
                          key={x.key}
                          className="flex flex-col bg-surface/60 border border-ink/10 rounded-xl p-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[0.72rem] font-semibold text-ink">{x.label}</span>
                            {bowlOrCup && (
                              <span className="text-[0.68rem] text-amber-800 font-medium">
                                {bowlOrCup}
                              </span>
                            )}
                          </div>
                          <span className="font-bold text-ink tabular-nums text-[0.95rem] mt-0.5">
                            {x.amount}{' '}
                            <span className="text-[0.72rem] font-semibold text-leaf">{x.unit}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Prominent Standard Measure Definition: 100g = 1 bowl or 100ml = 1 cup */}
      <section className="mt-6 rounded-2xl border-2 border-turmeric/40 bg-gradient-to-r from-turmeric/15 via-turmeric/10 to-turmeric/5 p-5 md:p-7 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <span className="w-12 h-12 rounded-2xl bg-turmeric text-ink grid place-items-center shrink-0 shadow-xs">
              <Bowl width={26} height={26} />
            </span>
            <div>
              <p className="text-[0.74rem] uppercase tracking-wider font-bold text-amber-900">
                Kitchen Measurement Standard
              </p>
              <h3 className="font-display text-xl md:text-2xl text-ink font-bold mt-0.5">
                Standard Measure: 100g = 1 bowl &nbsp;&middot;&nbsp; 100ml = 1 cup
              </h3>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-3.5 py-2 rounded-xl bg-white border border-amber-300 text-ink text-[0.9rem] font-bold shadow-xs">
              🍚 100g = 1 bowl
            </span>
            <span className="px-3.5 py-2 rounded-xl bg-white border border-amber-300 text-ink text-[0.9rem] font-bold shadow-xs">
              🥣 100ml = 1 cup
            </span>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-amber-200/70 grid sm:grid-cols-2 md:grid-cols-3 gap-3 text-[0.84rem] text-ink/85">
          <div className="bg-white/90 rounded-xl p-3.5 border border-amber-200/60 shadow-2xs">
            <p className="font-bold text-ink flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-leaf" /> Solid Dishes: 100g = 1 Bowl
            </p>
            <p className="text-muted mt-1 text-[0.8rem] leading-relaxed">
              Rice, Sabzi, Pulao &amp; Paneer are measured with 1 standard Indian katori (100g). E.g. 150g is 1.5 bowls.
            </p>
          </div>
          <div className="bg-white/90 rounded-xl p-3.5 border border-amber-200/60 shadow-2xs">
            <p className="font-bold text-ink flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-turmeric" /> Liquid Dishes: 100ml = 1 Cup
            </p>
            <p className="text-muted mt-1 text-[0.8rem] leading-relaxed">
              Dal, Kadhi, Soups &amp; Milk are measured with 1 standard household cup (100ml). E.g. 200ml is 2 cups.
            </p>
          </div>
          <div className="bg-white/90 rounded-xl p-3.5 border border-amber-200/60 shadow-2xs sm:col-span-2 md:col-span-1">
            <p className="font-bold text-ink flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-clay" /> Easy Cooking Reference
            </p>
            <p className="text-muted mt-1 text-[0.8rem] leading-relaxed">
              No need for food scales! Simply count your bowls and cups to match each family member's health requirements.
            </p>
          </div>
        </div>
      </section>

      {/* Cooking Totals */}
      <section className="mt-6 rounded-2xl bg-ink text-bg p-6 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-[0.75rem] uppercase tracking-[0.18em] text-turmeric font-semibold">
              Cook this much for tonight's dinner
            </p>
            <p className="text-[0.85rem] text-bg/70 mt-0.5">
              Total for {members.length} family members (measured with 100g=1bowl &amp; 100ml=1cup)
            </p>
          </div>
          <span className="chip border-turmeric/40 bg-turmeric/10 text-turmeric !py-1 !px-3 text-[0.75rem]">
            Standardized Portions
          </span>
        </div>

        <ul className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          {total.map((t) => {
            const bowlOrCup =
              t.unit === 'g'
                ? `${(t.sum / 100).toFixed(1)} bowls`
                : t.unit === 'ml'
                ? `${(t.sum / 100).toFixed(1)} cups`
                : null;

            return (
              <li key={t.key} className="border-l-2 border-turmeric/40 pl-4">
                <span className="flex items-center gap-2 text-bg/70 text-[0.9rem]">
                  <span className="w-3 h-3 rounded-full" style={{ background: t.color }} />
                  <span className="font-medium text-bg">{t.label}</span>
                </span>
                <motion.p
                  key={t.sum}
                  initial={{ y: 8, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  className="font-display text-[2.2rem] mt-1 tabular-nums font-semibold leading-tight"
                >
                  {t.sum}
                  <span className="text-[1rem] text-bg/60 font-sans font-normal ml-1.5">{t.unit}</span>
                </motion.p>
                {bowlOrCup && (
                  <p className="text-[0.82rem] text-turmeric/90 font-medium mt-1">
                    = {bowlOrCup}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <NextStep
        to="/health"
        label="Family health log"
        hint="Log BP and heart rate readings and watch the trend."
      />
    </Page>
  );
}

function Plate({ food }: { food: { key: string; color: string; f: number }[] }) {
  const spots = [
    [42, 42],
    [78, 42],
    [42, 78],
    [78, 78],
  ];
  return (
    <svg viewBox="0 0 120 120" className="w-full max-w-[150px] mx-auto block" aria-hidden="true">
      <circle cx="60" cy="60" r="56" fill="#FFFFFF" stroke="#D9CBB2" strokeWidth="2" />
      <circle cx="60" cy="60" r="47" fill="none" stroke="#EADCC4" strokeWidth="1.5" />
      {food.map((f, i) => {
        const itemScale = Math.min(1.35, Math.max(0.45, f.f));
        return (
          <motion.circle
            key={f.key}
            cx={spots[i][0]}
            cy={spots[i][1]}
            fill={f.color}
            stroke="rgba(43,36,32,0.12)"
            initial={{ r: 14 * itemScale }}
            animate={{ r: 14 * itemScale }}
            transition={{ type: 'spring', stiffness: 220, damping: 18 }}
          />
        );
      })}
    </svg>
  );
}
