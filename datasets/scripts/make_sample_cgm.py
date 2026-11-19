"""Generate a synthetic 7-day LibreView-style CGM export for demo use.

Produces public/sample-cgm.csv — 15-minute readings over 7 days with a
realistic diurnal baseline, meal spikes at breakfast/lunch/dinner, one
post-prandial hyper event, and one overnight mild hypo. The file header
is clearly labelled as synthetic so no one mistakes it for real patient
data. The format matches Abbott's LibreView export, which the parser in
src/lib/cgm.ts already understands.

    python datasets/scripts/make_sample_cgm.py

For real evaluation data use datasets/scripts/fetch_cgmacros.sh (Texas
A&M's CGMacros dataset on PhysioNet).
"""
from __future__ import annotations

import csv
import math
import random
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public/sample-cgm.csv"

STEP = timedelta(minutes=15)
DAYS = 7
SEED = 42  # deterministic so the demo is stable

# Meal profile: (hour_of_day, carb_intensity, duration_hours)
BASE_MEALS = [
    (7.5,  0.6, 2.5),   # breakfast  — moderate
    (13.0, 1.0, 3.0),   # lunch      — largest
    (19.5, 0.8, 2.5),   # dinner     — second largest
]


def baseline(ts: datetime) -> float:
    """Diurnal baseline — slight dawn phenomenon, lowest around 02:00-03:00."""
    h = ts.hour + ts.minute / 60.0
    return 95 + 7 * math.sin((h - 3) / 24 * 2 * math.pi) + 6 * math.sin((h - 15) / 24 * 2 * math.pi)


def meal_contribution(ts: datetime, meals: list[tuple[float, float, float]]) -> float:
    """Sum of asymmetric meal curves (fast rise, slower decay)."""
    h = ts.hour + ts.minute / 60.0
    total = 0.0
    for m_h, intensity, dur in meals:
        dt = h - m_h
        if dt < -0.3 or dt > dur:
            continue
        if dt <= 0.6:
            # Rising limb
            peak = 55 * intensity
            total += peak * (dt + 0.3) / 0.9
        else:
            # Decaying limb
            peak = 55 * intensity
            tail = 1 - (dt - 0.6) / (dur - 0.6)
            total += peak * max(0.0, tail)
    return total


def main() -> None:
    rng = random.Random(SEED)
    start = datetime(2026, 11, 13, 6, 0, 0)  # Fri 06:00
    points: list[tuple[datetime, int]] = []
    for day in range(DAYS):
        day_start = start + timedelta(days=day)
        # Perturb the meal times a bit each day so it feels human.
        meals = [
            (h + rng.uniform(-0.4, 0.4),
             intensity * rng.uniform(0.85, 1.1),
             dur)
            for h, intensity, dur in BASE_MEALS
        ]
        # Day 3: a heavy post-prandial response (hyper event).
        if day == 2:
            meals = [(h, i * (1.4 if h > 12 else 1.0), d) for h, i, d in meals]
        # Day 5: a mild overnight hypo.
        inject_hypo = (day == 4)

        n_steps = int(timedelta(days=1) / STEP)
        for s in range(n_steps):
            ts = day_start + s * STEP
            v = baseline(ts) + meal_contribution(ts, meals)
            # Noise
            v += rng.gauss(0, 4.5)
            # Overnight hypo window on day 5: 02:15 to 03:45.
            if inject_hypo and 2.25 <= ts.hour + ts.minute / 60 <= 3.75:
                v -= 35
            # Clamp to physiological range.
            v = max(45, min(260, v))
            points.append((ts, int(round(v))))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["AHAAR sample CGM export (SYNTHETIC — for demo only)"])
        w.writerow(["Generated on", datetime.now().strftime("%Y-%m-%d"), "", "", ""])
        w.writerow(["Device", "AHAAR Simulator v1 (not a real device)", "", "", ""])
        w.writerow(["Patient", "Demo", "", "", ""])
        w.writerow(["Device Timestamp", "Record Type", "Historic Glucose mg/dL", "Scan Glucose mg/dL", "Notes"])
        for ts, mgdl in points:
            w.writerow([ts.strftime("%Y-%m-%d %H:%M"), 0, mgdl, "", ""])

    print(f"Wrote {len(points)} points across {DAYS} days -> {OUT.relative_to(ROOT)}")
    print(f"Size: {OUT.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
