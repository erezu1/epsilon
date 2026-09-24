# latex2mobile

Turns a LaTeX article into a paper you can read comfortably on a phone.

It works in three separate parts:

| part | what it is | made by |
| --- | --- | --- |
| **document** | the paper as data: its HTML, numbering, formulas (as TeX, plus drawn once), figures | `latex2mobile.py`, the only step that runs LaTeX |
| **theme** | how it looks and what the reading bar offers: `viewer/theme.json`, `viewer/theme.css` | you edit it |
| **viewer** | draws a document with a theme in the browser: `viewer/viewer.js`, `viewer/nav.js` | shared by every paper |

Change the theme (a font, a colour, which buttons the bar has) and every paper follows, without converting anything again. A paper can be read through a site with a library (`l2m_viewer.py`) or packed into one self-contained `.html` file (`l2m_render.py`).

- **Numbering matches the PDF.** Sections, equations (including `align` rows), theorems, figures, tables and citations get the numbers LaTeX itself prints. The tool adds hidden `\label`s to a copy of your source and compiles that copy in a temporary folder. Your own files are never changed.
- **Math is drawn once, ahead of time,** with MathJax, and stored with the document, so a paper opens instantly and looks the same everywhere. The TeX of every formula is kept too, so the viewer can draw it itself when needed.
- **Built for small screens.**
  - Tapping a footnote marker slides up a sheet with the note; all notes are also listed at the end.
  - Wide equations scroll sideways, with an edge shadow, while their number stays visible.
  - Theorem-like environments are shaded boxes.
  - Figures and tables open in a full-screen viewer: tap the figure, its expand badge, or any reference to it ("Figure 3"). Inside the viewer, pinch (or trackpad-pinch / Ctrl-scroll) to zoom within the frame, drag to pan, and double-tap to zoom in or back to fit; "Show in text" jumps to its place. Long captions are shortened to three lines with a "More" button, so the figure keeps most of the screen. Opening a figure from a reference does not move the page.
  - Greek text (`\textgreek`, `\textalpha`…, or polytonic Greek typed directly) is set in Noto Serif, because the reading fonts lack accented Greek.
  - The page is never wider than the screen: wide equations, tables and code scroll inside their own box, and long URLs wrap.
- **Reading bar.** Once you scroll past the contents, a slim frosted-glass bar slides in. It has:
  - a back button (it turns into ✕ while the contents panel is open);
  - the title of the current section, which fades to the next one as you scroll; tap it to open the contents panel, attached under the bar;
  - a jump-to-top button;
  - a settings button (also at the top right of the title block): choose the font (STIX Two Text, Literata, Source Serif 4, IBM Plex Sans), the text size (small, medium, large), Light, Dark or System appearance, and a Neutral or Warm tone (Warm has its own light and dark versions). Choices are remembered in the reader's browser, and the reading position is kept when the font changes.
- **Links remember where you were.** Tapping an equation number, a section, a citation or a footnote is a real history step. The browser's back button, or the bar's back button, returns to the exact spot you left, and the target briefly highlights when you land on it.
- **A library.** `l2m_viewer.py` puts many documents behind one page: a list of papers, each opening in place, with back returning to the list. See below.

## Setup (once)

You need:
- Python 3.8+, standard library only;
- a TeX installation with `pdflatex` and `bibtex`;
- Node.js;
- optionally, `pdftoppm` from poppler, for PDF figures (`brew install poppler`).

```bash
cd latex_mobile
npm install
```

## Usage

```bash
python3 latex2mobile.py path/to/paper.tex
```

This writes the document folder `path/to/paper.l2m/` (see [DOCUMENT.md](DOCUMENT.md)). To read it:

```bash
python3 l2m_render.py path/to/paper.l2m -o paper.html
```

packs it with the viewer into one file that works offline. `--html paper.html` on the first command does both at once. Options of `latex2mobile.py`:

| option | effect |
| --- | --- |
| `-o DIR` | the document folder (default: `paper.l2m` next to `paper.tex`) |
| `--html FILE` | also write a one-file page |
| `--artifact` | with `--html`: a page fragment (no `<html>/<head>/<body>`) for publishing as a Claude artifact |
| `--kicker "Draft"` | small line above the title (`l2m_render.py --kicker` changes it later) |
| `--title "..."` | override the title |
| `--engine xelatex` | use `xelatex` or `lualatex` to obtain the numbering |
| `--no-math` | don't draw the formulas ahead of time; the viewer draws them in the browser |
| `--keep-build DIR` | keep the LaTeX build files (for debugging) |

Warnings about unknown commands, missing references or formulas MathJax could not render are printed at the end. The document is still written; unknown commands keep their argument as plain text.

Try it on the example:

```bash
python3 latex2mobile.py examples/sample.tex --html examples/sample.html --kicker Example
```

## The theme

`viewer/theme.json` says what the viewer offers:

| key | meaning |
| --- | --- |
| `bar` | the reading bar's buttons, in order: `back`, `title` (the section title and contents button), `top`, `settings`, `library` |
| `titleblock` | what sits by the title: `settings` (the settings button), `library` (an "All papers" link, on a site) |
| `fonts` | the fonts to choose from: `key`, `name`, `note`, the CSS `stack`, and the Google Fonts `css` family string |
| `sizes`, `appearance`, `tones` | the other settings and their labels |
| `defaults` | what a new reader starts with |
| `icons` | the SVG icons |
| `greekFont`, `mathjax` | the font for polytonic Greek, and where MathJax is loaded from |

`viewer/theme.css` is the look: colours are tokens at the top, with dark and warm sets; `data-size`, `data-tone` and `data-theme` on the page carry the reader's choices. A new size or tone needs an entry in `theme.json` and its values in `theme.css`. On a site, edit the site's copies and reload; for one-file pages, run `l2m_render.py` again.

## What is supported

- **Macros and theorems:** `\newcommand`, `\def`, `\DeclareMathOperator` and `\newenvironment` are read from the preamble (and the body). Shortcuts such as `\be`…`\ee` for `equation` work. `\newtheorem` and `\theoremstyle` (plain, definition and remark), shared counters, `\newtheorem*`, `proof`.
- **Math:** `equation`, `align`, `gather`, `multline`, `eqnarray`, `alignat` (starred or not), `split`, `\[..\]`, `$..$`, `\(..\)`, `\tag`, `\nonumber`.
- **References and citations:**
  - `\ref`, `\eqref`, `\autoref`, `\cref`;
  - `\cite` and natbib's `\citep`/`\citet` (numeric and author–year), with references from BibTeX or an inline `thebibliography`.
- **Text and lists:**
  - sectioning up to `\subsubsection`, `\paragraph`, `\appendix`;
  - title, authors (`\and`, several `\author`s), affiliations, `\thanks`, abstract (environment or JHEP-style `\abstract{}`), acknowledgments;
  - `itemize`, `enumerate`, `description`, `\item[...]`;
  - `\emph`/`\textbf`/…, `{\bf ...}`-style switches, accents, dashes, quotes, `\url`, `\href`, `\verb`, `verbatim`, `quote`, `\input`/`\include`.
- **Tables and figures:**
  - `tabular` (booktabs and `\hline` rules, `\multicolumn`);
  - `table` and `figure` floats with captions;
  - `\includegraphics` of PDF, PNG, JPG and SVG files (PDF and EPS are rasterised), honouring `\graphicspath` and `width=0.7\textwidth`-style sizes.

## Limitations

- TikZ/PGF pictures are not drawn; a placeholder marks them. Compile them to PDF and `\includegraphics` the result instead.
- biblatex is not supported; use BibTeX (`\bibliography{...}`) or `thebibliography`.
- Macros that come from a package rather than your preamble are only understood in math, and only if MathJax knows them. Unknown text commands degrade to their argument.
- `\multirow` and complicated table layouts are approximated.

## Tests

`tests/run_arxiv.py FOLDER` converts every paper in a folder of arXiv sources (one subfolder per paper with `src.bin`) and writes `results.json`. `tests/check_viewer.py FOLDER` opens every paper in a site at phone width and checks that it has the same text and formulas as its one-file page and is not wider than the screen (`--browser-math` tests formulas drawn in the browser). `tests/check_docs.py FOLDER` packs each document again and checks the page is identical to the one written at conversion. `tests/check_layout.py PAGES...` loads pages at phone width (390px) in headless Chrome and reports anything wider than the screen. `tests/arxiv-2026-09-24/` holds a full run on one day of hep-th, with a report.

## A site with a library

```bash
python3 latex2mobile.py a.tex
python3 latex2mobile.py b.tex
python3 l2m_viewer.py build site a.l2m b.l2m
python3 l2m_viewer.py serve site
```

Then open `http://localhost:8000/` for the library, or `http://localhost:8000/?p=a` for one paper. Papers open in place; the back button moves between the library and the papers, and inside a paper it steps back through the links you followed. Adding papers to an existing site keeps the ones already there.

The site is plain static files: `index.html`, the theme and the viewer scripts (copied from `viewer/`), `library.json`, and `papers/<name>/` with each document. Any web server can host it; it must be served over http(s), since browsers do not let a page opened from a file load other files. MathJax, needed only for documents without `math.json` (`--no-math-cache`), is loaded from a CDN, or from the site itself with `--local-mathjax`.

## Publishing as a Claude artifact

- One paper: `l2m_render.py paper.l2m -o page.html --artifact`, then publish `page.html`.
- A library: `l2m_viewer.py build site ... --artifact` writes `index.html` with the viewer inline; publish it with the site's other files. An artifact's address cannot carry `?p=`, so a link from outside always opens the library.

## Files

| file | role |
| --- | --- |
| `latex2mobile.py` | the converter: LaTeX to a document (command-line entry point) |
| `render_math.js` | draws formulas to SVG with MathJax in node (called by the converter) |
| `l2m_render.py` | packs one document and the viewer into a single `.html` |
| `l2m_viewer.py` | builds and serves a site of documents with a library |
| `viewer/theme.json`, `viewer/theme.css` | the theme |
| `viewer/viewer.js` | draws a document: bar, contents, settings, footnote sheet, figure viewer, formulas |
| `viewer/nav.js` | runs an open paper: history-aware links, panels, figure zoom |
| `viewer/prefs.js` | applies the reader's saved choices before the page is drawn |
| `viewer/site.js`, `viewer/index.html` | the site: library and papers on one page |
| `DOCUMENT.md` | the document format |
| `examples/` | a sample document that exercises the supported features |
