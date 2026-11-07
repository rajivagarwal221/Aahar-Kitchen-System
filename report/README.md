# AHAAR — IEEE Report (Overleaf-ready)

## Files
- `main.tex` — full IEEEtran document (journal style with Table of Contents / index)
- `references.bib` — BibTeX for all 10 IEEE references

## How to use on Overleaf
1. Go to https://www.overleaf.com → **New Project → Blank Project**.
2. Delete the default `main.tex`.
3. Upload `main.tex` and `references.bib` from this folder.
4. Set compiler to **pdfLaTeX** (Menu → Compiler).
5. Click **Recompile**. Overleaf runs bibtex automatically.

## Local compile
```bash
pdflatex main.tex
bibtex   main
pdflatex main.tex
pdflatex main.tex
```

## Report structure
```
Abstract
Index Terms
Table of Contents
I.    Introduction
II.   Related Work (all 10 IEEE papers)
III.  Existing System Architecture (current frontend)
IV.   Proposed Methodology (every upgrade)
V.    Backend and Database Design (Java 26, Spring Boot, Postgres, DJL)
VI.   Dataset Construction and Training Protocol
VII.  Evaluation Plan
VIII. Discussion
IX.   Conclusion and Future Work
References
```

## Placeholders to fill
- Figure 1 (system-flow diagram) — replace the `fbox` placeholder with a real image.
- One or two references have `author = {Anonymous}` (IEEE CICN 2025 YOLOv11m paper and IndianFoodNet 2023) because author names were not confirmed in the search. Replace with the real author list from IEEE Xplore before submission.
