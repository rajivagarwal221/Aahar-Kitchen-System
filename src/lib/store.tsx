import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Item } from './data';
import { Quality } from './quality';

export type Shot = { id: string; src: string; quality: Quality; source: 'camera' | 'upload' };

export type Member = {
  id: number;
  name: string;
  disease: string;
  bp: string;
  heartRate: number;
};

export type Reading = {
  id: string;
  memberId: number;
  date: string; // yyyy-mm-dd
  sys: number;
  dia: number;
  hr: number;
};

/** One point from a continuous glucose monitor export (LibreView / Dexcom).
 * ts is a full ISO-8601 instant. */
export type GlucosePoint = {
  memberId: number;
  ts: string;
  mgdl: number;
};

export type ShoppingEntry = { id: string; name: string };

const START_MEMBERS: Member[] = [
  { id: 1, name: 'Papa', disease: 'Hypertension', bp: '124/80', heartRate: 72 },
  { id: 2, name: 'Mummy', disease: 'Pre-Diabetes', bp: '118/76', heartRate: 70 },
  { id: 3, name: 'Aarav', disease: 'None (Healthy)', bp: '112/70', heartRate: 64 },
  { id: 4, name: 'Dadi', disease: 'Joint Inflammation', bp: '128/82', heartRate: 74 },
];

type Saved = {
  items: Item[];
  shopping: ShoppingEntry[];
  members: Member[];
  readings: Reading[];
  glucose: GlucosePoint[];
};

type Kitchen = Saved & {
  shots: Shot[];
  addShot: (s: Shot) => void;
  removeShot: (id: string) => void;
  setItems: (items: Item[]) => void;
  /** Add detected or hand-picked items; quantities already in the pantry are kept. */
  mergeItems: (items: Item[]) => void;
  removeItem: (id: string) => void;
  addShopping: (entries: ShoppingEntry[]) => void;
  removeShopping: (id: string) => void;
  setMembers: (members: Member[]) => void;
  addReading: (r: Reading) => void;
  removeReading: (id: string) => void;
  addGlucose: (points: GlucosePoint[]) => void;
  clearGlucose: (memberId: number) => void;
  detected: boolean;
  setDetected: (v: boolean) => void;
};

const KEY = 'ahaar:v1';
/** Each signed-in account gets its own saved kitchen; guests share the base key. */
const keyFor = (userId: string | null) => (userId ? `${KEY}:${userId}` : KEY);
const EMPTY: Saved = { items: [], shopping: [], members: START_MEMBERS, readings: [], glucose: [] };

function load(key: string): Saved {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as Partial<Saved>;
    return {
      items: Array.isArray(v.items) ? v.items : [],
      shopping: Array.isArray(v.shopping) ? v.shopping : [],
      members: Array.isArray(v.members) && v.members.length > 0 ? v.members : START_MEMBERS,
      readings: Array.isArray(v.readings) ? v.readings : [],
      glucose: Array.isArray(v.glucose) ? v.glucose : [],
    };
  } catch {
    return EMPTY;
  }
}

const Ctx = createContext<Kitchen | null>(null);

export function KitchenProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const key = keyFor(userId);
  const [saved, setSaved] = useState<Saved>(() => load(key));
  const [shots, setShots] = useState<Shot[]>([]);
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(saved));
    } catch {
      // Private mode or a full quota: the app still works for this visit.
    }
  }, [key, saved]);

  const value = useMemo<Kitchen>(() => {
    const patch = (f: (s: Saved) => Partial<Saved>) => setSaved((s) => ({ ...s, ...f(s) }));
    return {
      ...saved,
      shots,
      addShot: (s) => setShots((prev) => [...prev, s].slice(-6)),
      removeShot: (id) => setShots((prev) => prev.filter((s) => s.id !== id)),
      setItems: (items) => patch(() => ({ items })),
      mergeItems: (incoming) =>
        patch((s) => {
          const byId = new Map(s.items.map((i) => [i.id, i]));
          for (const it of incoming) {
            const prev = byId.get(it.id);
            byId.set(it.id, prev ? { ...it, qty: prev.qty } : it);
          }
          const ids = new Set(incoming.map((i) => i.id));
          return { items: Array.from(byId.values()), shopping: s.shopping.filter((e) => !ids.has(e.id)) };
        }),
      removeItem: (id) => patch((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      addShopping: (entries) =>
        patch((s) => {
          const have = new Set(s.shopping.map((e) => e.id));
          return { shopping: [...s.shopping, ...entries.filter((e) => !have.has(e.id))] };
        }),
      removeShopping: (id) => patch((s) => ({ shopping: s.shopping.filter((e) => e.id !== id) })),
      setMembers: (members) => patch(() => ({ members })),
      addReading: (r) =>
        patch((s) => ({
          readings: [...s.readings, r],
          // The newest reading becomes the member's current vitals on the Family page.
          members: s.members.map((m) => {
            if (m.id !== r.memberId) return m;
            const newer = s.readings.some((x) => x.memberId === m.id && x.date > r.date);
            return newer ? m : { ...m, bp: `${r.sys}/${r.dia}`, heartRate: r.hr };
          }),
        })),
      removeReading: (id) => patch((s) => ({ readings: s.readings.filter((r) => r.id !== id) })),
      addGlucose: (points) =>
        patch((s) => {
          // Deduplicate by (memberId, ts) so re-importing the same export is safe.
          const seen = new Set(s.glucose.map((g) => `${g.memberId}@${g.ts}`));
          const incoming = points.filter((p) => !seen.has(`${p.memberId}@${p.ts}`));
          return { glucose: [...s.glucose, ...incoming].sort((a, b) => a.ts.localeCompare(b.ts)) };
        }),
      clearGlucose: (memberId) =>
        patch((s) => ({ glucose: s.glucose.filter((g) => g.memberId !== memberId) })),
      detected,
      setDetected,
    };
  }, [saved, shots, detected]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKitchen() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useKitchen must be used inside KitchenProvider');
  return v;
}
