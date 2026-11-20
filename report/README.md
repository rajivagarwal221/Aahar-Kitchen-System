# AHAAR — IEEE Project Report

## Files
- `main.tex` — IEEEtran journal-style document (TOC + 10 sections).
- `references.bib` — 10 IEEE references, authors filled.
- `figures/system_flow.svg` — source for Figure 1.
- `figures/system_flow.png` — 980×620 PNG rendered from the SVG, which
  `main.tex` embeds via `\includegraphics`.

## Build on Overleaf
1. https://overleaf.com → New Project → Blank Project.
2. Upload every file in this folder (including `figures/`).
3. Compiler: **pdfLaTeX**. Click Recompile. BibTeX runs automatically.

## Build locally
```bash
pdflatex main.tex
bibtex   main
pdflatex main.tex
pdflatex main.tex
```

## Figures that still need to come from `results/`
These are produced by `training/plot.py` once the group trains the four
ablation cells on their RTX 3050:

- `results/ablation_bars.png` → optional `\includegraphics` in §V
- `results/yolov11m_if20_pretrain/per_class_bars.png` → optional §V
- `results/yolov11m_if20_pretrain/training_curves.png` → optional §V

Drop them into `report/figures/` and uncomment the matching
`\includegraphics` in `main.tex` once they exist.

## Regenerating `figures/system_flow.png`
If you edit `figures/system_flow.svg`, re-rasterize with any of:

```bash
# Using Playwright (works in this container):
node --input-type=module -e "
  import {chromium} from 'playwright';
  import {readFileSync} from 'fs';
  const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'});
  const p = await b.newPage({viewport:{width:980,height:620}, deviceScaleFactor:2});
  const svg = readFileSync('report/figures/system_flow.svg','utf-8');
  await p.setContent('<!doctype html><body style=\"margin:0;background:#FBF6EC\">'+svg+'</body>');
  await p.screenshot({path:'report/figures/system_flow.png'});
  await b.close();
"

# Using Inkscape (local Linux/macOS):
inkscape report/figures/system_flow.svg --export-type=png \
         --export-filename=report/figures/system_flow.png --export-dpi=200

# Using rsvg-convert (on any machine with librsvg2-bin):
rsvg-convert -d 200 -p 200 report/figures/system_flow.svg \
             -o report/figures/system_flow.png
```
