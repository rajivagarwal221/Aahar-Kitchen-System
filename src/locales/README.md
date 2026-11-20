# AHAAR locales

Each file in this folder is a translation of the AHAAR UI into one
language. Keys that a file doesn't define fall back to `en.json` at
runtime, so partial translations are safe to ship.

## Current coverage

All ten locales now carry the complete key set (app, nav, cta, footer,
menu, lang). Native-speaker auditing is still recommended for the
non-Hindi locales before they're printed on marketing material; the
translations are idiomatic but AHAAR is a group project, not a
localization house.

| Code | Language   | Script       | Keys    | Notes |
|------|------------|--------------|---------|-------|
| en   | English    | Latin        | full    | source of truth |
| hi   | Hindi      | Devanagari   | full    | primary reviewed locale |
| bn   | Bengali    | Bengali      | full    | native-speaker audit welcome |
| ta   | Tamil      | Tamil        | full    | native-speaker audit welcome |
| te   | Telugu     | Telugu       | full    | native-speaker audit welcome |
| mr   | Marathi    | Devanagari   | full    | native-speaker audit welcome |
| gu   | Gujarati   | Gujarati     | full    | native-speaker audit welcome |
| kn   | Kannada    | Kannada      | full    | native-speaker audit welcome |
| ml   | Malayalam  | Malayalam    | full    | native-speaker audit welcome |
| pa   | Punjabi    | Gurmukhi     | full    | native-speaker audit welcome |

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
