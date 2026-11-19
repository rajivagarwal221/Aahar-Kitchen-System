// Continuous Glucose Monitor (CGM) ingest & metrics.
//
// Supports the two most common Indian-market exports:
//   - Abbott LibreView (FreeStyle Libre / Libre 2 / Libre 3)
//   - Dexcom Clarity   (G6 / G7)
//
// Both are CSVs; LibreView has a multi-line preamble and separate Historic /
// Scan columns; Dexcom has a simpler "Timestamp, Glucose Value" layout.
// We read them robustly: find the header row, map columns by name, drop
// everything that isn't numeric mg/dL.
//
// Also computes standard CGM metrics (ADA 2020 consensus):
//   - mean glucose, estimated A1c (GMI), time-in-range (70-180 mg/dL),
//     time-below-range (<70), time-above-range (>180), CV%, and the
//     number of hyper/hypo events.

import { GlucosePoint } from './store';

export type ParseResult = {
  points: Omit<GlucosePoint, 'memberId'>[];
  format: 'libreview' | 'dexcom' | 'generic' | 'unknown';
  skipped: number;
  error?: string;
};

export type CgmStats = {
  count: number;
  firstTs: string;
  lastTs: string;
  spanHours: number;
  meanMgdl: number;
  stdMgdl: number;
  cvPct: number;
  gmiPct: number;         // "estimated A1c"
  tirPct: number;         // 70-180
  tbrPct: number;         // <70
  tarPct: number;         // >180
  hypoCount: number;      // contiguous dips <70 for >=15 min
  hyperCount: number;     // contiguous spikes >180 for >=15 min
  maxMgdl: number;
  minMgdl: number;
};

const toIso = (s: string): string | null => {
  const raw = s.trim();
  if (!raw) return null;
  // LibreView/Dexcom use 'YYYY-MM-DD HH:MM' or 'MM-DD-YYYY HH:MM' or 'DD-MM-YYYY HH:MM'.
  const d1 = new Date(raw.replace(' ', 'T'));
  if (!isNaN(d1.getTime())) return d1.toISOString();
  // dd-mm-yyyy HH:MM (Indian locale LibreView PDF exports sometimes)
  const m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})[ T]+(\d{1,2}):(\d{2})/);
  if (m) {
    const [, dd, mm, yy, h, mi] = m;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const d = new Date(year, Number(mm) - 1, Number(dd), Number(h), Number(mi));
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
};

// Column-name hints per vendor. Case-insensitive, substring match.
const COLS = {
  ts: ['device timestamp', 'timestamp', 'time', 'date time'],
  historic: ['historic glucose', 'glucose value', 'glucose'],
  scan: ['scan glucose'],
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function findHeader(lines: string[]): { headerIdx: number; headers: string[] } | null {
  // Try each line as a header; the first one that contains BOTH a time-ish
  // column and a glucose-ish column wins. This handles LibreView's multi-row
  // preamble transparently.
  for (let i = 0; i < Math.min(12, lines.length); i++) {
    const cols = splitCsvLine(lines[i]).map((c) => c.toLowerCase());
    const hasTs = cols.some((c) => COLS.ts.some((k) => c.includes(k)));
    const hasG = cols.some((c) => COLS.historic.some((k) => c.includes(k)) || COLS.scan.some((k) => c.includes(k)));
    if (hasTs && hasG) return { headerIdx: i, headers: splitCsvLine(lines[i]) };
  }
  return null;
}

function colIndex(headers: string[], hints: string[]): number {
  const low = headers.map((h) => h.toLowerCase());
  for (const h of hints) {
    const i = low.findIndex((c) => c.includes(h));
    if (i !== -1) return i;
  }
  return -1;
}

export function parseCgmCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { points: [], format: 'unknown', skipped: 0, error: 'The file looks empty.' };
  }
  const found = findHeader(lines);
  if (!found) {
    return { points: [], format: 'unknown', skipped: 0, error: 'Could not find a glucose column. Supported: Abbott LibreView, Dexcom Clarity, or any CSV with a "Timestamp" and "Glucose" column.' };
  }
  const { headerIdx, headers } = found;
  const firstCell = headers[0]?.toLowerCase() ?? '';
  const format: ParseResult['format'] =
    headers.some((h) => h.toLowerCase().includes('historic glucose')) ? 'libreview' :
    headers.some((h) => h.toLowerCase().includes('glucose value')) ? 'dexcom' :
    firstCell ? 'generic' : 'unknown';

  const tsIdx = colIndex(headers, COLS.ts);
  const histIdx = colIndex(headers, COLS.historic);
  const scanIdx = colIndex(headers, COLS.scan);

  const points: Omit<GlucosePoint, 'memberId'>[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const tsCell = cells[tsIdx] ?? '';
    const vCell = (histIdx !== -1 && cells[histIdx]) || (scanIdx !== -1 && cells[scanIdx]) || '';
    if (!tsCell || !vCell) { skipped++; continue; }
    const ts = toIso(tsCell);
    const mgdl = Number(vCell);
    if (!ts || !isFinite(mgdl) || mgdl < 20 || mgdl > 600) { skipped++; continue; }
    points.push({ ts, mgdl: Math.round(mgdl) });
  }
  points.sort((a, b) => a.ts.localeCompare(b.ts));
  return { points, format, skipped };
}

/** ADA 2020 consensus CGM metrics. All percentages are 0-100. */
export function computeStats(points: { ts: string; mgdl: number }[]): CgmStats | null {
  if (points.length === 0) return null;
  const n = points.length;
  let sum = 0, min = Infinity, max = -Infinity;
  let belowCount = 0, aboveCount = 0;
  for (const p of points) {
    sum += p.mgdl;
    if (p.mgdl < min) min = p.mgdl;
    if (p.mgdl > max) max = p.mgdl;
    if (p.mgdl < 70) belowCount++;
    else if (p.mgdl > 180) aboveCount++;
  }
  const mean = sum / n;
  let varSum = 0;
  for (const p of points) varSum += (p.mgdl - mean) ** 2;
  const std = Math.sqrt(varSum / n);
  const cv = (std / mean) * 100;

  // GMI = 3.31 + 0.02392 * mean  (per the 2018 Bergenstal paper and ADA).
  const gmi = 3.31 + 0.02392 * mean;

  // Hyper/hypo *events*: contiguous runs of >=15 minutes above/below threshold.
  const windowMs = 15 * 60 * 1000;
  let hypoEvents = 0, hyperEvents = 0;
  let hypoStart: number | null = null, hyperStart: number | null = null;
  const commit = (start: number | null, end: number, kind: 'hypo' | 'hyper') => {
    if (start !== null && end - start >= windowMs) {
      if (kind === 'hypo') hypoEvents++; else hyperEvents++;
    }
  };
  for (let i = 0; i < points.length; i++) {
    const t = Date.parse(points[i].ts);
    const v = points[i].mgdl;
    if (v < 70) {
      if (hypoStart === null) hypoStart = t;
      commit(hyperStart, t, 'hyper'); hyperStart = null;
    } else if (v > 180) {
      if (hyperStart === null) hyperStart = t;
      commit(hypoStart, t, 'hypo'); hypoStart = null;
    } else {
      commit(hypoStart, t, 'hypo'); hypoStart = null;
      commit(hyperStart, t, 'hyper'); hyperStart = null;
    }
  }
  const endT = Date.parse(points[points.length - 1].ts);
  commit(hypoStart, endT, 'hypo');
  commit(hyperStart, endT, 'hyper');

  const firstTs = points[0].ts;
  const lastTs = points[points.length - 1].ts;
  const spanHours = (Date.parse(lastTs) - Date.parse(firstTs)) / 3_600_000;

  return {
    count: n,
    firstTs, lastTs, spanHours,
    meanMgdl: Math.round(mean),
    stdMgdl: Math.round(std),
    cvPct: Math.round(cv * 10) / 10,
    gmiPct: Math.round(gmi * 10) / 10,
    tirPct: Math.round(((n - belowCount - aboveCount) / n) * 1000) / 10,
    tbrPct: Math.round((belowCount / n) * 1000) / 10,
    tarPct: Math.round((aboveCount / n) * 1000) / 10,
    hypoCount: hypoEvents,
    hyperCount: hyperEvents,
    maxMgdl: max,
    minMgdl: min,
  };
}
