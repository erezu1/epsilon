---
name: epsilon-artifact
description: Turn LaTeX (a paper, notes, a derivation, an arXiv source, a harvmac plain-TeX paper) into a polished, phone-friendly reading page published as a Claude artifact, with typeset math, numbered equations whose references work, a contents panel, footnotes, citations, figures and TikZ. Use it when the user wants LaTeX shown, shared or read as a page ("make this readable", "turn this paper into an artifact", "a page I can read on my phone").
---

# Epsilon: LaTeX as an artifact

Epsilon (https://github.com/erezu1/epsilon) turns a LaTeX document into one self-contained reading page:
- math typeset once, as SVG;
- numbered equations whose references jump and come back;
- a contents panel, footnotes in a sheet, citations, figures and TikZ;
- reading settings: font, size, light or dark.

The page carries its fonts, math and images inside it, so it publishes as a single artifact.

## Setup (once)

Use the folder this skill came from (the Epsilon repository), or clone it:

```bash
git clone https://github.com/erezu1/epsilon.git && cd epsilon && npm install
E="$PWD"
```

You need:
- Python 3.8+ (standard library only);
- a TeX installation with `pdflatex` and `bibtex`, used for the numbering and for TikZ;
- Node.js, used to draw the math.

`pdftoppm` (poppler) is optional, for PDF figures.

## Make the page

```bash
python3 "$E/epsilon_convert.py" paper.tex -o /tmp/paper.l2m --html /tmp/paper.html --artifact
```

`--artifact` writes the page as a fragment (no `<html>`, `<head>` or `<body>`) and starts it with the paper's `<title>`.
Publish that file as the artifact. A paper is typically 1–5 MB.

- **What the source must be.** A whole document, with `\documentclass`. Figures, `.bib`, `.bbl` and `.sty` files
  next to it are found there. Use the main file of a project folder.
- **Notes or a derivation with no preamble.** Wrap the body first, in a standard preamble: amsmath, amssymb,
  mathtools, amsthm with the theorem environments it uses, graphicx, tikz, hyperref.
- **arXiv papers.** Download the source (`https://arxiv.org/src/<id>`), unpack it into an empty folder, and convert
  the file with `\documentclass`. Harvmac papers (plain TeX, `\input harvmac`) are read too. Their main file has
  `\input harvmac` instead of `\documentclass`.
- **Options.** `--title "…"` replaces the title. `--fallback-title` and `--fallback-authors "A; B"` fill them in
  when the source draws its title page by hand. `--kicker "Draft"` puts a small line above the title.
  `--engine xelatex` handles sources that need it.
- **Errors.** Warnings about unknown commands or LaTeX errors usually leave the page fine; look at the page before
  giving up. A real failure prints the converter's error. If a package is missing from TeX, install it.

## Notes on the page

To annotate the page (explain a step, answer a question, point at what matters), give it notes:

```bash
python3 "$E/epsilon_convert.py" paper.tex -o /tmp/paper.l2m --html /tmp/paper.html --artifact --notes notes.json
```

`notes.json` is a list of `{"words", "note", "colour"}`:
- `words`: the words to mark, as the paper's text has them. Formulas are written as their TeX between `$` signs, with
  the paper's own macros. The words must appear once; give a few more if they repeat.
- `note`: the note. It may hold LaTeX: `$...$` in the line, `\[...\]` on its own line.
- `colour`: `orange`, `green`, `pink` or `violet`.
- `"by": "Claude"` shows a note as Claude's.

The notes stand in the margin on a wide screen, behind a small sign on a phone, and in the contents panel's *Notes*
tab. Readers can add marks of their own, which stay in their browser. `examples/demo.tex` with
`examples/demo-notes.json` is a worked example.

## Links into the page

The published page takes a place after `#`. Use one when you point the reader at something:
- by number as the paper prints it: `#eq-2.18` (equation (2.18)), `#section-2.3`, `#section-A.1`, `#figure-3`,
  `#table-1`;
- by `\label`, with each run of characters other than letters, digits and `. _ ~ -` turned into one `-`:
  `\label{eq:shock}` is `#eq-shock`;
- a citation as `#cite-<bibkey>` by the same rule.

The page opens there and highlights the place for a moment. A note is `#mark-n1`, `#mark-n2`, … in the order given.

## Writing LaTeX for it

Ordinary LaTeX works:
- sections;
- `equation` and `align` with `\label` and `\eqref`;
- theorem environments;
- `\cite` with `thebibliography` or a `.bib`;
- footnotes;
- TikZ, drawn by LaTeX;
- figures via `\includegraphics`.

Put a `\label` on what you will want to link to.
