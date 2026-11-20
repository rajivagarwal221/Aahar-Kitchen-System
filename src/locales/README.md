# AHAAR locales

Each file in this folder is a translation of the AHAAR UI into one
language. Keys that a file doesn't define fall back to `en.json` at
runtime, so partial translations are safe to ship.

## Current coverage

| Code | Language   | Script       | Primary strings        | Other strings     |
|------|------------|--------------|------------------------|-------------------|
| en   | English    | Latin        | full                   | full              |
| hi   | Hindi      | Devanagari   | full                   | full              |
| bn   | Bengali    | Bengali      | nav + CTAs + tagline   | fallback to en    |
| ta   | Tamil      | Tamil        | nav + CTAs + tagline   | fallback to en    |
| te   | Telugu     | Telugu       | nav + CTAs + tagline   | fallback to en    |
| mr   | Marathi    | Devanagari   | nav + CTAs + tagline   | fallback to en    |
| gu   | Gujarati   | Gujarati     | nav + CTAs + tagline   | fallback to en    |
| kn   | Kannada    | Kannada      | nav + CTAs + tagline   | fallback to en    |
| ml   | Malayalam  | Malayalam    | nav + CTAs + tagline   | fallback to en    |
| pa   | Punjabi    | Gurmukhi     | nav + CTAs + tagline   | fallback to en    |

## Adding a new string

1. Add the key to `en.json` first — English is the source of truth.
2. Optionally add the translation to `hi.json` (Hindi is the second
   most-tested locale).
3. Every other locale is free to leave the key out; the UI will fall
   back to English until a native speaker fills it in.

## Adding a new language

1. Create `<code>.json` next to the existing locales. Use the same
   top-level keys as `en.json`.
2. Register the language in `src/lib/i18n.ts` — import the file and
   add an entry to `LANGUAGES`.

## Switching languages at runtime

The in-app language picker (top bar) writes to `localStorage` under
`ahaar:lang`; the `i18next-browser-languagedetector` plugin reads that
on next load. Browser `navigator.language` is used for first-visit
guessing.
