# AHAAR — Kitchen System

Open the fridge. Know what's for dinner.

A multi-page web app for AHAAR, a household food assistant for Indian kitchens. Photos go to a YOLOv11m detector trained on 107 Indian pantry classes; what it finds drives the pantry, the recipe ranking, the cook-along and the shopping list.

| Page | Route | What it does |
| --- | --- | --- |
| Home | `/` | Overview and links to every feature |
| Fridge scan | `/scan` | Live camera with on-device light and sharpness checks, capture, upload or drag-and-drop. **Detect ingredients** runs the model on every shot and opens the pantry |
| Detection | `/detect` | One shot at a time, with bounding boxes and confidence; switch off wrong items before they reach the pantry |
| Pantry | `/pantry` | Editable quantities, add or remove items by hand, shopping list, and an ingredient → dish → nutrient graph |
| Recipes | `/recipes` | 450 recipes ranked against your pantry and family, with search, filters, "Why this?" and add-missing-to-shopping-list |
| Family | `/family` | Per-person portions from disease, BP and heart rate, with totals to cook |
| Cook-along | `/cook` | One step at a time with a timer per step, a voice guide with Stop / Repeat / Continue, and the ingredient list |
| Health | `/health` | Log BP and heart-rate readings per member, with a trend chart and history |
| Login | `/login` | Sign in, create an account, reset a password, or continue with Google |

Pantry, shopping list, family members and health readings are saved in the browser (`localStorage`); nothing is sent anywhere except the photo that goes to the detection backend.

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

## Deploy (Vercel)

`vercel.json` sets the Vite build, the `dist` output and SPA rewrites, so deep links like `/scan` work. Import the repo and deploy.

Vercel hosts the site only. Detection needs `backend/` running somewhere that can load the 40 MB model (your own machine, or a Python host), with `VITE_DETECT_URL` set to its `/detect` address in the Vercel project's environment variables before you build.

## Edit

- Recipe ranking, tags and the nutrient map: `src/lib/recipes.ts`
- Ingredient aliases and recipe selection: `datasets/scripts/build_recipes.py`
- Default quantities per ingredient: `src/lib/detectShots.ts`
- Colours and fonts: `tailwind.config.ts`
- Photo quality thresholds: `src/lib/quality.ts`

Group 19: Rajiv Agarwal, Alan Joseph, Aryan Raina. Guide: Ms. Sharlene Rebeiro. AY 2026-27.
