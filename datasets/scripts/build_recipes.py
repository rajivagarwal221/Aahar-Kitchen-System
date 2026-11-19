"""Build public/recipes.json for the AHAAR frontend.

Reads the committed recipe CSV, maps every ingredient line onto the 107
classes the detector can see (src/lib/classNames.ts), splits the method
into timed steps, and keeps the recipes the pantry can actually reason
about. Standard library only:

    python datasets/scripts/build_recipes.py
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "datasets/raw/recipes/indian-food-dataset/IndianFoodDatasetCSV.csv"
OUT = ROOT / "public/recipes.json"
MAX_RECIPES = 450
MIN_CORE = 3

# class key -> phrases that mean it in an ingredient line. Order matters:
# the first class whose phrase matches wins, so specific entries come first.
ALIASES: list[tuple[str, list[str]]] = [
    ("sweetpotato", ["sweet potato"]),
    ("sweetcorn", ["sweet corn"]),
    ("corn", ["corn cob", "corn on the cob", "baby corn", "corn kernels", "american corn"]),
    ("dry ginger", ["dry ginger", "sonth"]),
    ("dry red chilly", ["dry red chilli", "dry red chillies", "dried red chilli"]),
    ("chilli pepper", ["green chilli", "green chillies", "green chili"]),
    ("jalepeno", ["jalapeno"]),
    ("paprika", ["paprika"]),
    ("capsicum", ["capsicum", "bell pepper"]),
    ("black pepper", ["whole black pepper", "black peppercorn", "peppercorns"]),
    ("black cardamom", ["black cardamom", "badi elaichi"]),
    ("green cardamom", ["cardamom", "elaichi"]),
    ("cinnamom stick", ["cinnamon stick", "dalchini"]),
    ("cloves", ["cloves (laung)", "laung"]),
    ("bay leaf", ["bay leaf", "bay leaves", "tej patta"]),
    ("star anise", ["star anise"]),
    ("mace", ["mace", "javitri"]),
    ("nutmeg", ["nutmeg"]),
    ("stone flowers", ["stone flower", "dagad phool"]),
    ("caraway seeds", ["caraway", "shah jeera"]),
    ("cumin seeds", ["cumin seeds", "jeera seeds"]),
    ("coriander seeds", ["coriander seeds", "coriander (dhania) seeds"]),
    ("fennel seeds", ["fennel seeds", "saunf"]),
    ("poppy seeds", ["poppy seeds", "khus khus"]),
    ("hing_block", ["asafoetida", "hing"]),
    ("kokum", ["kokum"]),
    ("tamarind", ["tamarind"]),
    ("curry_leaves", ["curry leaves"]),
    ("mint_leaves", ["mint leaves", "pudina"]),
    ("methi_leaves", ["methi leaves", "fenugreek leaves"]),
    ("drumstick_leaves", ["drumstick leaves", "moringa leaves"]),
    ("coriander_leaves", ["coriander (dhania) leaves", "coriander leaves", "cilantro"]),
    ("spinach", ["spinach", "palak"]),
    ("lettuce", ["lettuce"]),
    ("cabbage", ["cabbage"]),
    ("cauliflower", ["cauliflower", "gobi"]),
    ("eggplant", ["brinjal", "eggplant", "baingan"]),
    ("beetroot", ["beetroot"]),
    ("carrot", ["carrot"]),
    ("raddish", ["radish", "mooli"]),
    ("turnip", ["turnip", "shalgam"]),
    ("cucumber", ["cucumber"]),
    ("peas", ["green peas", "matar"]),
    ("potato", ["potato", "aloo"]),
    ("tomato", ["tomato"]),
    ("onion", ["onion"]),
    ("garlic", ["garlic"]),
    ("ginger", ["ginger"]),
    ("lemon", ["lemon", "lime juice"]),
    ("grated_coconut", ["grated coconut", "coconut - grated", "fresh coconut - grated", "desiccated coconut"]),
    ("coconut_oil", ["coconut oil"]),
    ("fresh_coconut", ["fresh coconut", "coconut"]),
    ("mustard_oil", ["mustard oil"]),
    ("groundnut_oil", ["groundnut oil", "peanut oil"]),
    ("sesame_oil", ["sesame (gingelly) oil", "sesame oil", "gingelly oil"]),
    ("sunflower_oil", ["sunflower oil", "cooking oil", "vegetable oil"]),
    ("ghee", ["ghee"]),
    ("butter", ["butter"]),
    ("cream", ["fresh cream", "heavy cream", "whipping cream"]),
    ("curd_yogurt", ["curd", "yogurt", "yoghurt", "dahi"]),
    ("paneer", ["paneer"]),
    ("milk", ["milk"]),
    ("eggs", ["egg"]),
    ("raw_chicken", ["chicken"]),
    ("raw_mutton", ["mutton", "lamb"]),
    ("raw_prawn", ["prawn", "shrimp"]),
    ("raw_fish", ["fish"]),
    ("toor_dal", ["arhar dal", "toor dal", "tur dal"]),
    ("chana_dal", ["chana dal"]),
    ("masoor_dal", ["masoor dal"]),
    ("urad_dal", ["urad dal"]),
    ("moong_whole", ["green moong", "whole moong", "moong sprouts", "moong dal (whole)"]),
    ("moong_dal_split", ["moong dal"]),
    ("kala_chana", ["kala chana", "black chickpea"]),
    ("chickpea", ["kabuli chana", "chickpea", "chole"]),
    ("black_eyed_peas", ["black eyed", "lobia", "chawli"]),
    ("besan_flour", ["gram flour", "besan"]),
    ("atta_flour", ["whole wheat flour", "wheat flour", "atta"]),
    ("maida_flour", ["all purpose flour", "maida"]),
    ("rice_flour", ["rice flour"]),
    ("ragi_flour", ["ragi"]),
    ("bajra_flour", ["bajra"]),
    ("jowar_flour", ["jowar"]),
    ("sooji_rava", ["sooji", "semolina", "rava"]),
    ("idli_rice", ["idli rice", "idli dosa rice"]),
    ("basmati_rice", ["basmati rice"]),
    ("sona_masoori_rice", ["rice"]),
    ("jaggery", ["jaggery"]),
    ("sugar", ["sugar"]),
    ("salt", ["salt"]),
    ("almond", ["almond", "badam"]),
    ("cashew", ["cashew"]),
    ("pistachio", ["pistachio"]),
    ("walnut", ["walnut"]),
    ("raisin", ["raisin", "kishmish"]),
    ("apple", ["apple"]),
    ("banana", ["banana"]),
    ("mango", ["mango"]),
    ("orange", ["orange"]),
    ("grape", ["grape"]),
    ("pineapple", ["pineapple"]),
    ("pomegranate", ["pomegranate"]),
    ("watermelon", ["watermelon"]),
    ("kiwi", ["kiwi"]),
    ("pear", ["pear"]),
]

# A phrase that matched but really names something the camera cannot see.
BLOCK = re.compile(
    r"powder|paste|puree|sauce|ketchup|vinegar|essence|extract|syrup|stock|broth|"
    r"coconut milk|condensed milk|milk powder|buttermilk|peanut butter|raw mango|"
    r"mango powder|pineapple juice|orange juice|apple cider|rice bran|puffed rice|"
    r"flattened rice|poha|rice noodles|rice vinegar|sweet corn soup|corn flour|"
    r"cornflour|corn starch|eggless|fish sauce|grapeseed|ginger garlic|"
    r"spring onion|onion seeds|fenugreek seeds|garlic salt|sugar free"
)

# Staples every Indian kitchen is assumed to hold; never counted as "missing".
STAPLES = {
    "salt", "sugar", "sunflower_oil", "mustard_oil", "groundnut_oil", "sesame_oil",
    "coconut_oil", "ghee", "cumin seeds", "black pepper", "hing_block",
}

VERBS = [
    ("pressure cook", "Pressure cook"), ("marinate", "Marinate"), ("soak", "Soak"),
    ("knead", "Knead"), ("grind", "Grind"), ("blend", "Blend"), ("whisk", "Whisk"),
    ("roast", "Roast"), ("saute", "Sauté"), ("sauté", "Sauté"), ("fry", "Fry"),
    ("temper", "Temper"), ("tadka", "Temper"), ("boil", "Boil"), ("simmer", "Simmer"),
    ("steam", "Steam"), ("bake", "Bake"), ("grill", "Grill"), ("chop", "Chop"),
    ("garnish", "Garnish"), ("serve", "Serve"), ("heat", "Heat"), ("mix", "Mix"),
    ("stir", "Stir"), ("add", "Add"), ("cook", "Cook"),
]

TIME = re.compile(r"(\d+)(?:\s*(?:to|-)\s*(\d+))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)", re.I)


def match_class(line: str) -> str | None:
    low = line.lower()
    if BLOCK.search(low):
        return None
    for key, phrases in ALIASES:
        for p in phrases:
            if re.search(rf"(?<![a-z]){re.escape(p)}", low):
                return key
    return None


def split_ingredients(raw: str) -> list[str]:
    parts = re.split(r",(?![^(]*\))", raw)
    return [re.sub(r"\s+", " ", p).strip() for p in parts if p.strip()]


def step_seconds(text: str) -> int:
    total = 0
    for m in TIME.finditer(text):
        n = int(m.group(2) or m.group(1))
        unit = m.group(3).lower()
        if unit.startswith("h"):
            n *= 3600
        elif unit.startswith("m"):
            n *= 60
        total = max(total, n)
    # Overnight soaks and long rests are not something to sit and watch.
    return min(total, 45 * 60) if total else 120


def step_title(text: str, n: int) -> str:
    low = text.lower()
    best = None
    for needle, title in VERBS:
        i = low.find(needle)
        if i != -1 and (best is None or i < best[0]):
            best = (i, title)
    return best[1] if best else f"Step {n}"


def split_steps(raw: str) -> list[dict]:
    text = re.sub(r"\s+", " ", raw.replace("\xa0", " ")).strip()
    text = re.sub(r"Click here[^.]*\.", "", text)
    text = re.sub(r"([a-z)])\.([A-Z])", r"\1. \2", text)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])", text) if len(s.strip()) > 8]
    chunks: list[str] = []
    for s in sentences:
        if chunks and len(chunks[-1]) + len(s) < 230:
            chunks[-1] += " " + s
        else:
            chunks.append(s)
    while len(chunks) > 10:
        i = min(range(len(chunks) - 1), key=lambda k: len(chunks[k]) + len(chunks[k + 1]))
        chunks[i : i + 2] = [chunks[i] + " " + chunks[i + 1]]
    return [
        {"title": step_title(c, i + 1), "detail": c, "seconds": step_seconds(c)}
        for i, c in enumerate(chunks)
    ]


def clean_name(name: str) -> str:
    name = re.sub(r"\s*\(.*?\)\s*", " ", name)
    name = re.sub(r"\s+Recipe\b.*$", "", name, flags=re.I)
    return re.sub(r"\s+", " ", name).strip(" -")


def diet_of(raw: str) -> str:
    low = raw.lower()
    if "non veg" in low:
        return "nonveg"
    if "egg" in low:
        return "egg"
    return "veg"


def main() -> None:
    rows = list(csv.DictReader(SRC.open(encoding="utf-8-sig")))
    out, seen = [], set()
    for r in rows:
        name = clean_name(r["TranslatedRecipeName"])
        if not name or not name.isascii() or name.lower() in seen:
            continue
        try:
            minutes = int(r["TotalTimeInMins"])
            servings = int(r["Servings"])
        except ValueError:
            continue
        if not (5 <= minutes <= 150) or not (1 <= servings <= 12):
            continue
        steps = split_steps(r["TranslatedInstructions"])
        if len(steps) < 2:
            continue

        ingredients, keys = [], []
        for line in split_ingredients(r["TranslatedIngredients"]):
            if not line.isascii():
                break
            key = match_class(line)
            ingredients.append({"text": line, "key": key} if key else {"text": line})
            if key and key not in keys:
                keys.append(key)
        else:
            core = [k for k in keys if k not in STAPLES]
            if len(core) < MIN_CORE or len(ingredients) > 22:
                continue
            unseen = sum(1 for i in ingredients if "key" not in i)
            seen.add(name.lower())
            out.append({
                "id": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
                "name": name,
                "minutes": minutes,
                "servings": servings,
                "cuisine": re.sub(r"\s*Recipes$", "", r["Cuisine"]).strip(),
                "course": r["Course"].strip(),
                "diet": diet_of(r["Diet"]),
                "core": core,
                "ingredients": ingredients,
                "steps": steps,
                "url": r["URL"].strip(),
                "_rank": len(core) / (len(core) + unseen + 1),
            })

    # Prefer recipes whose ingredients the detector can mostly see.
    out.sort(key=lambda x: (-x["_rank"], x["name"]))
    out = out[:MAX_RECIPES]
    for x in out:
        del x["_rank"]
    out.sort(key=lambda x: x["name"])

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    used = {k for x in out for k in x["core"]}
    print(f"{len(rows)} rows -> {len(out)} recipes, {OUT.stat().st_size / 1024:.0f} KB")
    print(f"{len(used)} detector classes appear as a core ingredient")


if __name__ == "__main__":
    main()
