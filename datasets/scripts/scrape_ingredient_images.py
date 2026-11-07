#!/usr/bin/env python3
"""
AHAAR ingredient-image scraper.

Pulls the 55 pantry classes missing from the Kaggle datasets (dals, flours,
dairy, oils, leafy herbs, raw proteins, dry fruits, other staples).

Design:
  * Each class uses tightly-scoped queries that bias toward RAW/UNCOOKED images.
  * URL-level blacklist drops results whose URL hints they're a cooked dish.
  * Every image is validated (format, min side, aspect ratio, max side).
  * Perceptual hash (phash) dedupes near-duplicates within each class.
  * Resumable: classes with >= --target valid images are skipped.
  * --strict mode stops a class as soon as the signal-to-noise ratio drops.

Install:
    pip install scrapling[all] pillow imagehash requests
    scrapling install          # one-time, installs the stealth browser

Run:
    python scrape_ingredient_images.py --target 150
    python scrape_ingredient_images.py --only toor_dal besan_flour
    python scrape_ingredient_images.py --engine bing      # default
    python scrape_ingredient_images.py --engine duckduckgo

Output:
    datasets/raw/ingredient_images/scraped/<class_name>/0001_<hash>.jpg
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote_plus

import requests
from PIL import Image

try:
    import imagehash
except ImportError:
    imagehash = None

# --------------------------------------------------------------------------- #
# Config

ROOT = Path(__file__).resolve().parents[1]
OUT_ROOT = ROOT / "raw" / "ingredient_images" / "scraped"
LOG_FILE = ROOT / "scripts" / "scrape.log"

TARGET_PER_CLASS = 150
MIN_SIDE = 300           # drop images smaller than this on either side
MAX_SIDE = 4000          # drop absurdly huge images (often screenshots/banners)
MIN_BYTES = 10_000       # drop almost-empty files
AR_MIN, AR_MAX = 0.5, 2.0  # drop extreme aspect ratios (banners / strips)
ALLOWED_EXT = {"jpg", "jpeg", "png", "webp"}
DL_TIMEOUT = 10
PAGE_SLEEP = 1.0
DL_SLEEP = 0.15

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0 Safari/537.36"
)
REQ_HEADERS = {"User-Agent": USER_AGENT, "Accept": "image/*"}

# URL-level rejection: any of these substrings and the image is skipped.
URL_BLACKLIST = {
    "recipe", "cooked", "cooking", "biryani-recipe", "sabzi", "sabji",
    "curry-recipe", "dish-", "-dish-", "-fried-", "-masala-", "halwa-recipe",
}

# --------------------------------------------------------------------------- #
# 55 ingredient classes × tuned queries (each biased toward RAW form)

INGREDIENTS: list[tuple[str, list[str]]] = [
    # --- Pulses / dals (10)
    ("toor_dal",          ["raw toor dal split pigeon pea",
                           "arhar dal yellow split uncooked",
                           "toor dal pile grain"]),
    ("moong_dal_split",   ["moong dal split yellow raw",
                           "yellow mung dal uncooked"]),
    ("moong_whole",       ["whole green moong beans raw",
                           "whole mung beans dry"]),
    ("chana_dal",         ["chana dal split chickpea raw",
                           "yellow bengal gram split"]),
    ("urad_dal",          ["urad dal split black gram raw",
                           "white urad dal uncooked"]),
    ("masoor_dal",        ["masoor dal red lentil raw",
                           "pink lentils uncooked pile"]),
    ("rajma",             ["raw rajma dry red kidney beans",
                           "kidney beans raw pile"]),
    ("chickpea",          ["raw white chickpeas kabuli chana",
                           "dry white chickpeas pile"]),
    ("kala_chana",        ["raw kala chana black chickpea dry"]),
    ("black_eyed_peas",   ["raw black eyed peas lobia dry"]),

    # --- Flours (8)
    ("atta_flour",        ["whole wheat atta flour pile indian"]),
    ("besan_flour",       ["besan gram flour pile bowl",
                           "chickpea flour raw yellow"]),
    ("maida_flour",       ["maida refined white flour pile"]),
    ("rice_flour",        ["rice flour raw white pile"]),
    ("sooji_rava",        ["sooji rava semolina pile bowl"]),
    ("bajra_flour",       ["bajra pearl millet flour pile"]),
    ("jowar_flour",       ["jowar sorghum flour pile"]),
    ("ragi_flour",        ["ragi finger millet flour pile"]),

    # --- Rice varieties (3)
    ("basmati_rice",      ["basmati rice raw long grain uncooked"]),
    ("sona_masoori_rice", ["sona masoori rice raw short grain"]),
    ("idli_rice",         ["idli rice parboiled raw"]),

    # --- Dairy (6)
    ("milk",              ["milk packet pouch indian",
                           "milk glass white"]),
    ("curd_yogurt",       ["plain curd dahi bowl white",
                           "indian yogurt bowl"]),
    ("paneer",            ["raw paneer block white indian cottage cheese"]),
    ("ghee",              ["ghee jar clarified butter indian"]),
    ("butter",            ["butter block amul yellow",
                           "butter stick wrapped"]),
    ("cream",             ["fresh cream bowl malai"]),

    # --- Oils (5)
    ("mustard_oil",       ["mustard oil bottle indian kacchi ghani"]),
    ("groundnut_oil",     ["groundnut peanut oil bottle"]),
    ("coconut_oil",       ["coconut oil bottle indian"]),
    ("sesame_oil",        ["sesame til oil bottle"]),
    ("sunflower_oil",     ["sunflower cooking oil bottle"]),

    # --- Leafy / fresh herb (5)
    ("methi_leaves",      ["fresh fenugreek methi leaves bunch"]),
    ("coriander_leaves",  ["fresh coriander dhania leaves bunch cilantro"]),
    ("mint_leaves",       ["fresh mint pudina leaves bunch"]),
    ("curry_leaves",      ["curry leaves kadi patta sprig fresh"]),
    ("drumstick_leaves",  ["moringa drumstick leaves fresh bunch"]),

    # --- Protein (5)
    ("raw_chicken",       ["raw chicken pieces cut fresh"]),
    ("raw_mutton",        ["raw mutton lamb pieces fresh"]),
    ("raw_fish",          ["raw fresh fish fillet rohu indian"]),
    ("raw_prawn",         ["raw fresh prawn shrimp whole"]),
    ("eggs",              ["raw eggs carton white brown"]),

    # --- Dry fruits (5)
    ("cashew",            ["raw cashew nuts whole pile"]),
    ("almond",            ["raw almonds whole pile"]),
    ("raisin",            ["black raisins kismis pile",
                           "golden raisins pile"]),
    ("pistachio",         ["raw pistachio nuts shelled pile"]),
    ("walnut",            ["raw walnut halves pile"]),

    # --- Other staples (8)
    ("fresh_coconut",     ["fresh whole coconut brown",
                           "coconut halved white"]),
    ("grated_coconut",    ["fresh grated coconut bowl white"]),
    ("tamarind",          ["raw tamarind imli pulp block",
                           "tamarind pod dry"]),
    ("jaggery",           ["jaggery gur block indian brown",
                           "jaggery pieces pile"]),
    ("kokum",             ["dried kokum fruit indian dark"]),
    ("salt",              ["table salt crystals bowl white"]),
    ("sugar",             ["raw white sugar granules bowl"]),
    ("hing_block",        ["asafoetida hing resin block raw"]),
]

assert len(INGREDIENTS) == 55, f"expected 55 classes, got {len(INGREDIENTS)}"

# --------------------------------------------------------------------------- #
# Logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stdout),
              logging.FileHandler(LOG_FILE, mode="a")],
)
log = logging.getLogger("aahar.scrape")

# --------------------------------------------------------------------------- #
# Image validation

def validate_bytes(data: bytes) -> Image.Image | None:
    if len(data) < MIN_BYTES:
        return None
    try:
        im = Image.open(io.BytesIO(data))
        im.verify()                       # re-parse header
        im = Image.open(io.BytesIO(data)) # re-open to use after verify
    except Exception:
        return None
    w, h = im.size
    if w < MIN_SIDE or h < MIN_SIDE: return None
    if w > MAX_SIDE or h > MAX_SIDE: return None
    ar = w / h
    if ar < AR_MIN or ar > AR_MAX: return None
    return im

# --------------------------------------------------------------------------- #
# Search engines

def scrape_bing(query: str, want: int) -> list[str]:
    """Return raw image URLs from Bing Images for the query."""
    from scrapling.fetchers import StealthyFetcher
    urls: list[str] = []
    first = 1
    while len(urls) < want * 2 and first < want * 5:
        url = (
            "https://www.bing.com/images/search?"
            f"q={quote_plus(query)}&first={first}&count=35&form=HDRSC2"
        )
        try:
            page = StealthyFetcher.fetch(
                url, headless=True, network_idle=True, humanize=True,
            )
        except Exception as e:
            log.warning("bing fetch failed for %r first=%d: %s", query, first, e)
            break
        for a in page.css("a.iusc"):
            m = a.attrib.get("m", "")
            match = re.search(r'"murl":"([^"]+)"', m)
            if match:
                urls.append(match.group(1).replace("\\", ""))
        first += 35
        time.sleep(PAGE_SLEEP)
    # preserve-order dedupe
    seen, out = set(), []
    for u in urls:
        if u in seen: continue
        seen.add(u); out.append(u)
    return out


def scrape_duckduckgo(query: str, want: int) -> list[str]:
    """Return raw image URLs from DuckDuckGo image search."""
    from scrapling.fetchers import StealthyFetcher
    # DDG's image search uses a two-step: token request then JSON query
    s = requests.Session(); s.headers.update(REQ_HEADERS)
    try:
        html = s.get(f"https://duckduckgo.com/?q={quote_plus(query)}", timeout=DL_TIMEOUT).text
        token_m = re.search(r"vqd='([^']+)'", html)
        token = token_m.group(1) if token_m else None
        if not token:
            return []
        urls = []
        params = {"q": query, "vqd": token, "o": "json", "p": "1"}
        while len(urls) < want * 2:
            r = s.get("https://duckduckgo.com/i.js", params=params, timeout=DL_TIMEOUT)
            if r.status_code != 200: break
            data = r.json()
            for row in data.get("results", []):
                if row.get("image"):
                    urls.append(row["image"])
            nxt = data.get("next")
            if not nxt: break
            # next is a URL-ish with new params
            m = re.search(r"s=(\d+)", nxt)
            if not m: break
            params["s"] = m.group(1)
            time.sleep(PAGE_SLEEP)
        seen, out = set(), []
        for u in urls:
            if u in seen: continue
            seen.add(u); out.append(u)
        return out
    except Exception as e:
        log.warning("ddg fetch failed for %r: %s", query, e)
        return []


ENGINES = {"bing": scrape_bing, "duckduckgo": scrape_duckduckgo}

# --------------------------------------------------------------------------- #
# Per-class pipeline

def collect_existing_hashes(out_dir: Path) -> set[str]:
    hashes: set[str] = set()
    if imagehash is None:
        return hashes
    for p in out_dir.iterdir():
        if p.suffix.lower()[1:] not in ALLOWED_EXT: continue
        try:
            hashes.add(str(imagehash.phash(Image.open(p))))
        except Exception:
            continue
    return hashes


def existing_count(out_dir: Path) -> int:
    return sum(
        1 for p in out_dir.iterdir()
        if p.suffix.lower()[1:] in ALLOWED_EXT
    )


def download_class(
    name: str, queries: list[str], target: int,
    engine: str, strict: bool,
) -> int:
    out_dir = OUT_ROOT / name
    out_dir.mkdir(parents=True, exist_ok=True)

    have = existing_count(out_dir)
    if have >= target:
        log.info("[SKIP] %s: already have %d >= %d", name, have, target)
        return 0

    log.info("[START] %s: have=%d target=%d", name, have, target)
    seen_hashes = collect_existing_hashes(out_dir)
    scraper = ENGINES[engine]

    added = 0
    for q in queries:
        if have + added >= target: break
        urls = scraper(q, want=target - have - added + 25)
        log.info("[%s] %r -> %d candidate URLs", name, q, len(urls))
        rejected_streak = 0

        for url in urls:
            if have + added >= target: break
            low = url.lower()
            if any(bad in low for bad in URL_BLACKLIST):
                continue
            try:
                r = requests.get(url, headers=REQ_HEADERS, timeout=DL_TIMEOUT, stream=True)
                if r.status_code != 200: continue
                data = r.content
            except Exception:
                continue
            im = validate_bytes(data)
            if not im:
                rejected_streak += 1
                if strict and rejected_streak >= 20:
                    log.info("[%s] strict abort for %r (too many rejects)", name, q)
                    break
                continue
            if imagehash is not None:
                h = str(imagehash.phash(im))
                if h in seen_hashes:
                    continue
                seen_hashes.add(h)
            rejected_streak = 0
            fname = (
                f"{have + added:04d}_"
                f"{hashlib.md5(url.encode()).hexdigest()[:10]}.jpg"
            )
            try:
                im.convert("RGB").save(out_dir / fname, format="JPEG", quality=90)
                added += 1
            except Exception:
                continue
            time.sleep(DL_SLEEP)

    log.info("[DONE] %s: have=%d (new=%d)", name, have + added, added)
    return added

# --------------------------------------------------------------------------- #
# CLI

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--target", type=int, default=TARGET_PER_CLASS,
                    help=f"images per class (default {TARGET_PER_CLASS})")
    ap.add_argument("--only", nargs="*", metavar="CLASS",
                    help="restrict to these class names")
    ap.add_argument("--engine", choices=list(ENGINES), default="bing")
    ap.add_argument("--strict", action="store_true",
                    help="stop a class once reject streak crosses threshold")
    ap.add_argument("--list", action="store_true",
                    help="list all class names and exit")
    args = ap.parse_args()

    if args.list:
        for name, _ in INGREDIENTS:
            print(name)
        return 0

    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    report: dict[str, int] = {}
    total_new = 0
    for name, queries in INGREDIENTS:
        if args.only and name not in args.only:
            continue
        try:
            n = download_class(name, queries, args.target, args.engine, args.strict)
            report[name] = n
            total_new += n
        except KeyboardInterrupt:
            log.warning("stopped by user")
            break
        except Exception as e:
            log.error("[FAIL] %s: %s", name, e)
            report[name] = -1

    out_report = OUT_ROOT / "report.json"
    out_report.write_text(json.dumps(report, indent=2))
    log.info("total new images: %d (report: %s)", total_new, out_report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
