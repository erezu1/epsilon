---
name: epsilon
description: Epsilon, Erez's LaTeX reader. Use it (1) to push LaTeX notes, derivations, summaries or whole papers into the Epsilon app ("put this in my app", "on my phone", "in Epsilon"), where the same id updates the same note; and (2) to turn LaTeX into a polished, phone-friendly single HTML page (for sharing, or published as a Claude artifact) with typeset math, numbered equations, references, footnotes, figures and TikZ.
---

# Epsilon

Epsilon turns LaTeX into a reading page: typeset math (drawn once, as SVG), numbered equations with working
references, a contents panel, footnotes in a sheet, citations, figures and TikZ, reading settings (font, size,
light/dark). The tools live in one folder:

```bash
E="/Users/urbach/IAS Dropbox/Erez Urbach/research/epsilon"
```

## 1. Push a note into the app (https://erezu1.github.io/epsilon/)

It is converted on GitHub (a minute or two) and shows in the library, marked "note". Pushing again with the
same `--id` updates the same note in place (it keeps its place, reading position and pin).

```bash
# a note written as a LaTeX body only (no \documentclass): a standard preamble is added
# (amsmath, amssymb, mathtools, amsthm with theorem/lemma/proposition/definition/remark, graphicx, tikz, hyperref)
python3 "$E/epsilon.py" notes.tex --id rmt-notes --title "Notes on supersymmetric RMT"

# the same from standard input
cat <<'EOF' | python3 "$E/epsilon.py" - --id rmt-notes --title "Notes on supersymmetric RMT"
\section{Setup}
...
EOF

# a whole LaTeX document, or a project folder (figures, .bib and .sty next to it are taken along)
python3 "$E/epsilon.py" paper/main.tex --id bf-draft

python3 "$E/epsilon.py" --list              # the notes and drafts in the library
python3 "$E/epsilon.py" --remove rmt-notes  # take a note out
```

- It waits and prints `ok: <link>`, or the converter's error (exit status 1). `--no-wait` returns at once;
  `--here` converts on this machine first (quicker; needs TeX and Node).
- Ids: letters, digits and `. _ ~ -`; pick a stable, descriptive id per note (e.g. `project-topic`) and reuse it
  to update. Not an arXiv number. Tell the user the link it prints.
- Needs git access to the private repo `erezu1/epsilon-library` (the `gh` login on this Mac).

## 2. Make a standalone HTML page from LaTeX

One self-contained file (the viewer, the math, the images inside), readable offline on any phone or computer:

```bash
python3 "$E/epsilon_convert.py" paper.tex --html paper.html          # a complete HTML page
python3 "$E/epsilon_convert.py" paper.tex --html paper.html --artifact   # the same, shaped to publish as an artifact
```

- The source must be a whole document (with `\documentclass`); for a body only, wrap it first (or write it with
  the preamble above). Harvmac (plain TeX) papers are read too.
- It also writes `paper.l2m/` (the document as data); pass `-o DIR` to choose where.
- Needs TeX (pdflatex, for numbering and TikZ) and Node (run `npm install` in `$E` once).

## Writing LaTeX for Epsilon

Ordinary LaTeX works: sections, `equation`/`align` with `\label` and `\eqref`, theorem environments, `\cite` with
`thebibliography` or a `.bib`, footnotes, TikZ (drawn by LaTeX), figures via `\includegraphics` next to the file.
