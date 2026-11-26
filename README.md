# AHAAR — Kitchen System

> Open the fridge. Know what's for dinner.

A multi-page progressive web app for AHAAR, a household food assistant for Indian kitchens. Photos go to a YOLOv11m detector trained on 107 Indian pantry classes; what it finds drives a 450-recipe index with dish-level nutrition, per-family-member portioning, a weekly meal planner, a voice-guided cook-along, and a CGM-aware health view that learns each person's glycemic sensitivity.

| Page | Route | What it does |
| --- | --- | --- |
| Home | `/` | Overview and links to every feature |
| Fridge scan | `/scan` | Live camera with on-device light and sharpness checks, capture, upload or drag-and-drop. A **Lazy Mode** checkbox skips the pantry edit and jumps straight to ranked recipes after detection |
| Detection | `/detect` | One shot at a time, with bounding boxes and confidence; switch off wrong items before they reach the pantry, or **Skip to recipes** for the one-tap flow |
| Pantry | `/pantry` | Editable quantities, add or remove items by hand, a Nutrition Profile card driven by the dish nutrition CSV, an ingredient → dish → nutrient graph, and a shopping list with Copy / Share / Export .txt / Clear and deep links to BigBasket, Blinkit and Zepto |
| Recipes | `/recipes` | 450 recipes ranked against your pantry and family, with search, nutrition filter chips (≥20g protein, ≤400 kcal, ≥5g fibre, ≤300mg sodium, ≤5g sugar), six sort modes, per-serving kcal strip on every card, and per-member glycemic-impact chips when a GSI has been learned |
| Family | `/family` | Per-person portions from disease, BP and heart rate, with per-plate and whole-family kcal + macro rollups from the dish nutrition CSV |
| Weekly plan | `/plan` | 7 days × 3 slots filled by a slot-biased planner with diet / max-minutes / no-repeat-window preferences; weekly nutrition totals and consolidated shopping list below |
| Cook-along | `/cook` | One step at a time with a timer per step, a voice guide (Stop / Repeat / Continue), the ingredient list, a per-serving nutrition panel, and a **Meal log** that pairs with CGM data |
| Health | `/health` | Log BP and heart-rate readings per member, upload CGM CSV (LibreView / Dexcom) and see the ADA 2020 metric suite (GMI, TIR, TBR, TAR, CV, hypo/hyper events), plus a learned Glycemic Sensitivity Index per member |
| Login | `/login` | Sign in, create an account, reset a password, or continue with Google |

**Installable PWA** — after first load the app shell, 450-recipe index, sample CGM data and locale files are cached for offline use.

**10 Indian languages** — the UI chrome (nav, CTAs, footer) is translated into English, Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Kannada, Malayalam and Punjabi. Missing keys fall back to English. Add a locale in `src/locales/` and register it in `src/lib/i18n.ts`.

**Built with** React 18 + TypeScript + Vite + Tailwind (PWA), FastAPI + Ultralytics YOLOv11 for detection, Firebase Authentication for optional sign-in, and Vercel for hosting.

Pantry, shopping list, family members, health readings, CGM points and meal history are saved in the browser (`localStorage`); nothing is sent anywhere except the photo that goes to the detection backend and (optionally) Firebase for authentication.

## Quick start

```bash
git clone https://github.com/rajivagarwal221/Aahar-Kitchen-System.git
cd Aahar-Kitchen-System
npm install && npm run dev        # open http://localhost:5173
```

No backend, keys or model are needed to explore the app: use **Load a sample pantry** on the Pantry page and **Try sample data** on the Health page.

## Repository layout

| Path | What's inside |
| --- | --- |
| `src/` | The React app: `pages/` (one file per route), `lib/` (recipe ranking, planner, CGM, GSI, auth), `locales/` (10 languages) |
| `public/` | `recipes.json` (450-recipe index), `sample-cgm.csv`, favicon |
| `backend/` | FastAPI detection server that loads the YOLO model |
| `training/` | Training, evaluation, ablation and plotting scripts plus configs |
| `datasets/` | Dataset configs, fetch scripts and the two CSVs the recipe builder reads |
| `notebooks/` | Colab notebooks for training the detector |
| `results/` | Metrics and plots from training runs (weights are not committed) |
| `report/` | IEEE-format project report (LaTeX) and figures |
| `papers/` | Reading list with links to the papers the report builds on |

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # outputs dist/
```

Detection needs the backend running as well (see `backend/README.md`):

```bash
cd backend
pip install -r requirements.txt
python app.py    # http://localhost:8000
```

The site looks for the backend at `http://localhost:8000/detect`. To point it elsewhere, copy `.env.example` to `.env.local` and set `VITE_DETECT_URL`. Without a backend, every page still works: add pantry items by hand, or use **Load a sample pantry** on the Pantry page.

The camera needs `https://` or `localhost`.

## Login (Firebase Authentication)

Sign-in is email and password or Google. Once the Firebase keys are set, every kitchen page needs an account and each account keeps its own pantry, shopping list, family and health log in the browser. With no keys, the app runs without accounts.

1. In the [Firebase console](https://console.firebase.google.com), create a project (the free Spark plan is enough) and add a **Web app**.
2. Under **Authentication > Sign-in method**, enable **Email/Password** and **Google**.
3. Copy `.env.example` to `.env.local` and fill the four `VITE_FIREBASE_*` values from the web app's config. Add the same four in Vercel's environment variables.
4. Under **Authentication > Settings > Authorised domains**, add your Vercel domain.

To try login without a real project, run `firebase emulators:start --only auth --project demo-ahaar` and set `VITE_FIREBASE_AUTH_EMULATOR=http://127.0.0.1:9099` in `.env.local`.

Accounts decide who can open the app; the kitchen data itself still lives in the browser, so it does not follow you to another device.

## Voice cook-along

On the Cook page, **Turn on voice guide** reads each step aloud, starts its timer, and listens for three commands: **Stop** (stop talking and pause the timer), **Repeat** (read this step again) and **Continue** (carry on after a stop, otherwise go to the next step). It uses the browser's built-in speech; listening works in Chrome and Edge, and the three buttons do the same job everywhere else.

## How recipes are ranked

`datasets/scripts/build_recipes.py` reads the committed recipe CSV, maps each ingredient line onto the 107 detector classes, splits the method into timed steps and writes `public/recipes.json`. Re-run it after changing the alias table:

```bash
python datasets/scripts/build_recipes.py
```

For each recipe, `src/lib/recipes.ts` computes:

- **Uses what you have**: share of the recipe's core ingredients that are in the pantry (salt, sugar, oils, ghee and cumin are assumed and not counted).
- **Fits your family**: starts at 100 and loses points when an ingredient works against a condition on the Family page (quick-sugar ingredients for diabetes, saturated fat and deep frying for heart conditions and hypertension, acidic or spicy ingredients for reflux).
- **Quick to cook**: from total time.

Match = 60% coverage + 25% family fit + 15% speed. The family-fit rules and the Low GI and High protein tags are ingredient-based rules, not a clinical model.

## CGM-aware personalisation

On `/health`, upload a CGM CSV export from **Abbott LibreView** (FreeStyle Libre / Libre 2 / Libre 3), **Dexcom Clarity** (G6 / G7), or any generic CSV with a timestamp + glucose column. The parser auto-detects the header row, handles ISO and Indian-locale timestamps, and rejects impossible readings. `src/lib/cgm.ts` computes the full ADA 2020 metric suite (mean, CV%, GMI, TIR / TAR / TBR, hypo + hyper event counts).

Clicking **Try sample data** on the Health page loads `public/sample-cgm.csv`, a 7-day synthetic export (672 points) generated by `datasets/scripts/make_sample_cgm.py` with planted hyper and hypo events so every metric tile lights up.

For real evaluation data: `bash datasets/scripts/fetch_cgmacros.sh <physionet-user>` pulls the CGMacros dataset (Texas A&M, 2025, *Scientific Data*, CC-BY) from PhysioNet — 45 subjects × 10 days of CGM plus logged meals and macronutrient composition.

**Per-user Glycemic Sensitivity Index (GSI)** — on `/cook`, the Meal log records which dish each family member ate and when. `src/lib/glycemic.ts` aligns each log entry to the following 2-hour CGM window, computes incremental AUC above baseline, and divides by an effective carb load (`carbs + 0.5·sugar − 0.3·fibre`). The median across logged meals is that person's GSI. Future recipes carry a `Low / Medium / High impact` chip per family member, and the Health page exposes the raw iAUC per meal so the signal is auditable.

## ML training pipeline

`training/` holds a reproducible YOLO training pipeline that produces every number the IEEE report (`report/main.tex`) cites.

```bash
pip install -r training/requirements-ml.txt
bash datasets/scripts/fetch_indianfood20.sh      # Kaggle, one-time
# shoot + label AHAAR-Fridge into data/images/{train,val}/ and data/labels/{train,val}/
python training/ablate.py                        # four ablation cells, ~3h on RTX 3050
python training/plot.py                          # figures for the report
```

See `training/README.md` for the full protocol (install, dataset collection, ablation design, ONNX export back into the backend).

## Deploy (Vercel)

`vercel.json` already sets the Vite build, the `dist` output and SPA rewrites. To ship:

1. Push to GitHub.
2. [Import the repo on Vercel](https://vercel.com/new) — Vercel auto-detects the Vite config.
3. In **Project Settings → Environment Variables**, add:
   - `VITE_DETECT_URL` → your backend's `/detect` URL (see below).
   - `VITE_FIREBASE_*` (four values) → from your Firebase web-app config, if you want sign-in enabled. Leave them unset to run without accounts.
4. Deploy. Deep links like `/scan`, `/plan`, `/health` resolve through the SPA rewrite.

Vercel hosts the static site only. **Detection needs `backend/` running somewhere that can load the 40 MB model** — your own RTX 3050 exposed via a tunnel, or a Python host (Railway, Fly.io, Hugging Face Spaces). Without a backend every page still works: add pantry items by hand, or use **Load a sample pantry** on the Pantry page; the recipes, planner, family portions, nutrition profile, CGM ingest and GSI learner all run entirely client-side.

## Edit

- Recipe ranking, tags and the nutrient map: `src/lib/recipes.ts`
- Ingredient aliases and recipe selection: `datasets/scripts/build_recipes.py`
- Default quantities per ingredient: `src/lib/detectShots.ts`
- Weekly planner (slot bias, diversity window): `src/lib/plan.ts`
- CGM parser + ADA 2020 metrics: `src/lib/cgm.ts`
- GSI learner + recipe impact prediction: `src/lib/glycemic.ts`
- UI strings per language: `src/locales/<lang>.json`, register in `src/lib/i18n.ts`
- Colours and fonts: `tailwind.config.ts`
- Photo quality thresholds: `src/lib/quality.ts`
- PWA manifest and precache strategy: `vite.config.ts`

## Project report

`report/` holds the IEEE-format project report (`main.tex`, `references.bib`, `figures/system_flow.{svg,png}`). See `report/README.md` for build steps on Overleaf and locally.

Group 19: Rajiv Agarwal, Alan Joseph, Aryan Raina. Guide: Ms. Sharlene Rebeiro. AY 2026-27.

## Keys and secrets

Never commit `.env.local` or any file with real keys; `.gitignore` already excludes them. Only `.env.example`, with empty values, belongs in the repo.
