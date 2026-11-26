"""The backend's model slots and the class list each one must have.

Three YOLO models can be served side by side. Each lives in its own file in
backend/ so promoting one never overwrites another:

    slot          file               classes come from (in the repo)
    ingredients   best.pt            src/lib/classNames.ts   (107, required)
    dishes        best_dishes.pt     datasets/indianfood20.yaml (20, optional)
    packaged      best_packaged.pt   datasets/packaged/classes.csv (59, optional)

Both backend/app.py (startup check) and training/promote.py (refuses a wrong
model) use expected_classes() so the rule lives in one place. When the repo
files aren't next to the backend (a slim deployment), the checks are skipped.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
ROOT = BACKEND_DIR.parent

SLOTS: dict[str, dict] = {
    "ingredients": {"file": "best.pt", "required": True},
    "dishes": {"file": "best_dishes.pt", "required": False},
    "packaged": {"file": "best_packaged.pt", "required": False},
}

# Written by training/promote.py from the run's pantry_map.json (or from
# classes.csv). Kept next to the weights so a deployment needs only backend/.
PACKAGED_MAP_FILE = BACKEND_DIR / "pantry_map_packaged.json"
PACKAGED_CSV = ROOT / "datasets/packaged/classes.csv"


def _ingredient_classes() -> list[str] | None:
    ts = ROOT / "src/lib/classNames.ts"
    if not ts.exists():
        return None
    m = re.search(r"CLASS_NAMES[^=]*=\s*\[(.*?)\]\s*as const",
                  ts.read_text(encoding="utf-8"), re.S)
    return re.findall(r'"([^"]+)"', m.group(1)) if m else None


def _dish_classes() -> list[str] | None:
    path = ROOT / "datasets/indianfood20.yaml"
    if not path.exists():
        return None
    import yaml
    names = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("names")
    if isinstance(names, dict):
        return [str(names[k]) for k in sorted(names, key=int)]
    return [str(n) for n in names] if names else None


def _packaged_rows() -> list[dict] | None:
    if not PACKAGED_CSV.exists():
        return None
    with PACKAGED_CSV.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def expected_classes(slot: str) -> list[str] | None:
    """Class names in model output order, or None if the source isn't present."""
    if slot == "ingredients":
        return _ingredient_classes()
    if slot == "dishes":
        return _dish_classes()
    if slot == "packaged":
        rows = _packaged_rows()
        return [r["class"] for r in rows] if rows else None
    raise KeyError(slot)


def model_names(model) -> list[str]:
    names = model.names
    if isinstance(names, dict):
        return [names[i] for i in sorted(names)]
    return list(names)


def diff_classes(got: list[str], expected: list[str]) -> str | None:
    """Human-readable mismatch, or None when names and order are identical."""
    if got == expected:
        return None
    missing = [c for c in expected if c not in got]
    extra = [c for c in got if c not in expected]
    lines = [f"model has {len(got)} classes, expected {len(expected)}"]
    if missing:
        lines.append(f"not in model: {missing[:10]}{' ...' if len(missing) > 10 else ''}")
    if extra:
        lines.append(f"not expected: {extra[:10]}{' ...' if len(extra) > 10 else ''}")
    if not missing and not extra:
        lines.append("same names, different order (class ids would be mislabelled)")
    return "; ".join(lines)


def packaged_map_from_csv() -> dict[str, dict] | None:
    rows = _packaged_rows()
    if not rows:
        return None
    return {r["class"]: {"brand": r["brand"], "product": r["product"],
                         "category": r["category"],
                         "pantry": r["pantry_ingredient"] or None} for r in rows}


def load_packaged_map() -> dict[str, dict]:
    """packaged class -> {brand, product, category, pantry}. Empty if unknown."""
    if PACKAGED_MAP_FILE.exists():
        return json.loads(PACKAGED_MAP_FILE.read_text(encoding="utf-8"))
    return packaged_map_from_csv() or {}


def suggest_slot(got: list[str]) -> str | None:
    """The slot whose expected class list this model matches exactly."""
    for slot in SLOTS:
        exp = expected_classes(slot)
        if exp is not None and exp == got:
            return slot
    return None
