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

# into a folder of the app's library (made if new; matched by name, any case), with the push or later
python3 "$E/epsilon.py" notes.tex --id rmt-notes --title "Notes on supersymmetric RMT" --folder "SUSY RMT"
python3 "$E/epsilon.py" --id rmt-notes --folder "SUSY RMT"

python3 "$E/epsilon.py" --list              # the notes and drafts in the library
python3 "$E/epsilon.py" --remove rmt-notes  # take a note out
```

- Folders: when a note belongs to a project the user keeps a folder for (or asks for one), pass `--folder` with
  that project's name; the note shows in that folder of the Library (the user's other folders are theirs).
- It waits and prints `ok: <link>`, or the converter's error (exit status 1). `--no-wait` returns at once;
  `--here` converts on this machine first (quicker; needs TeX and Node).
- Ids: letters, digits and `. _ ~ -`; pick a stable, descriptive id per note (e.g. `project-topic`) and reuse it
  to update. Not an arXiv number. Tell the user the link it prints (with `#…` to point at a place in it: see 3).
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

## 3. Link to a place in a paper or a note

When an answer mentions a particular equation, section, figure or citation of a paper in the library, or of a
note you pushed, link to that place. The link opens the paper there, just below the bar, and highlights the
place for a moment:

```
https://erezu1.github.io/epsilon/?p=<key>#<place>
```

- `<key>`: for an arXiv paper, its number without the version, with `/` written as `_` (`2607.14042`,
  `hep-th_0605206`). For a note or draft, its id (the `--id` you gave; it is in the `ok: <link>` that was printed).
- `<place>`, by number as the paper prints it: `eq-2.18` for equation (2.18), and likewise `eq-3a`. Also
  `section-2.3` (appendices too: `section-A.1`), `figure-3` and `table-1`.
- Or by `\label`: the label with every run of characters other than letters, digits and `. _ ~ -` turned into one `-`.
  So `\label{eq:shock}` becomes `#eq-shock`, and `\label{sec:2pt}` becomes `#sec-2pt`. This works for equations,
  sections, paragraphs, theorems, figures and tables. A citation is `cite-<bibkey>` by the same rule
  (`\cite{Jackiw:1984je}` gives `#cite-Jackiw-1984je`). Labels are the surest way to link the notes you write
  yourself.
- To be sure of a number or an id on this Mac, look in the library's copy: `git -C "$E/library" pull -q`, then read
  `$E/library/papers/<key>/paper.json`. There, `labels` maps each label to its `number` and `id`, and `headings`
  lists the sections with their `number` and `id`. `python3 "$E/epsilon_library.py" --library "$E/library" list`
  lists the papers by key.
- Write the link into the text, e.g. `[eq. (2.18)](https://erezu1.github.io/epsilon/?p=2607.14042#eq-2.18)`.
- It opens only papers in the library: for another arXiv paper, offer to add it first.
- A one-file page takes the same `#<place>` (`paper.html#eq-2.18`).

## 4. The user's marks and notes

In the app the user marks passages of a paper (orange, green, pink, violet) and writes notes on them. They are kept in the
library as `notes/<key>.json`. On this Mac, the library tool reads them and adds to them (it reads the paper's text
exactly as the app does):

```bash
L="$E/library"
python3 "$E/epsilon_library.py" --library "$L" notes                   # the papers with marks, and how many
python3 "$E/epsilon_library.py" --library "$L" notes 2607.14042        # a paper's marks and notes, in order, under their sections, with links
python3 "$E/epsilon_library.py" --library "$L" text 2607.14042 --section 2.3   # its text as the app reads it (to quote from)
python3 "$E/epsilon_library.py" --library "$L" mark 2607.14042 "the exact words" --note "A short note."   # a mark of yours (violet; --colour orange|green|pink)
python3 "$E/epsilon_library.py" --library "$L" unmark 2607.14042 <id>  # take one of yours off
```

- When the user asks about a paper they have read, or what they made of it, look at their notes first: what they
  marked shows what they found important or puzzling, and a note may be a question to answer.
- To annotate a paper for them (explain an equation where it stands, answer a question they left), mark the exact
  words with a short note. Take the words from `text`, where formulas appear as their TeX between `$` signs. The mark
  is written to the library at once and shows in the app in the margin and under Notes, as "Marked by Claude". The
  tool prints its link.
- The tool refuses words that appear several times (give a few more of them) or that it cannot find (check `text`).
  Quotes, dashes and capitals may differ.
- Leave the user's own marks alone unless they ask; `unmark` is for your own.
- Link to a mark with the link the tool prints (`#mark-<id>`), as to an equation (section 3).

## Writing LaTeX for Epsilon

Ordinary LaTeX works: sections, `equation`/`align` with `\label` and `\eqref`, theorem environments, `\cite` with
`thebibliography` or a `.bib`, footnotes, TikZ (drawn by LaTeX), figures via `\includegraphics` next to the file.
