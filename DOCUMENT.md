# The document

`latex2mobile.py paper.tex` writes the paper as data, with no viewer code:

```
paper.l2m/
  paper.json        the document
  images/           figures, one file each, named by a hash of their content
  math.json         every formula drawn once (a cache, see below)
```

Everything that shows it reads this folder without LaTeX: `l2m_render.py` packs it with the viewer into one `.html` file, and `l2m_viewer.py` puts it on a site. How it looks comes from the theme (`viewer/theme.json`, `viewer/theme.css`), which the viewer applies when the paper is shown, so changing the theme never means converting again.

Reconvert from LaTeX only when the converter itself changes: how LaTeX is read, numbering, macros. The `converter` field says which version wrote a document.

## `paper.json`

| field | content |
| --- | --- |
| `format`, `version` | `"l2m-doc"` and `1`. A reader refuses newer versions. |
| `converter` | version of `latex2mobile.py` that wrote it |
| `source`, `engine` | main `.tex` file name and the LaTeX engine used for the numbering |
| `title`, `authors`, `kicker`, `lang` | plain-text title and author names (for page titles and library lists), the small line above the title (may be null), language code |
| `body` | the paper as HTML, see below |
| `headings` | `[{level, number, html, id}]`, in order: the contents list |
| `labels` | `{latex label: {number, id}}`: the number LaTeX printed and the HTML id of the target (author labels only) |
| `footnotes` | `[{n, html}]` |
| `math.items` | `[{tex, display}]`, one per formula, in the order they are referenced |
| `math.macros`, `math.packages` | the paper's macros and the MathJax packages, enough to render any item on its own |
| `math.key` | a fingerprint of `math`, so a cache of drawn formulas can be checked against it |
| `warnings` | `{message: count}` from the conversion |

## The body

The body is HTML without any viewer code: no reading bar, panels, scripts or styles. It has two kinds of marker:

- `<l2m-math n="k"></l2m-math>` stands for formula `k` of `math.items`. A viewer can render it however it likes (SVG ahead of time, MathJax in the browser, MathML).
- `<l2m-slot name="settings"></l2m-slot>` and `<l2m-slot name="kicker"></l2m-slot>` mark where the title block's settings button and kicker go. A viewer may leave them empty.

Images are `<img src="images/<hash>.<ext>">`, relative to the document folder.

The viewer relies on these classes and ids, and the converter keeps them stable:

| markup | meaning |
| --- | --- |
| `header.titleblock` | title, authors, abstract (`section.abstract`), contents (`details.toc`) |
| `h2`–`h5` with `id` | sections, number in `.secnum`; the id is the one in `headings` |
| `.display` | a displayed equation, with its number in `.eqno` |
| `.thm`, `.defn`, `.remark`, `.proof` | theorem-like boxes, headed by `.thm-name` ("Theorem 2.2") or `.proof-head` |
| `figure.float` | figure or table, caption in `figcaption` starting with `.capname` ("Figure 3") |
| `a.fnref` / `section.footnotes` with `li#fnN` and `.fn-text` | footnote markers and their notes |
| `span.cite`, `section.references` | citations and the reference list |
| `a[href^="#"]` | internal links (equations, sections, figures, citations) |
| `span.greek` | Greek text, set in a font that has polytonic Greek |

## `math.json`

The converter draws every formula once with MathJax (in node) into `math.json`:

| field | content |
| --- | --- |
| `format`, `version` | `"l2m-math"` and `1` |
| `key` | the `math.key` of the document it was drawn from |
| `mathjax` | the MathJax version used |
| `svg` | one SVG per item of `math.items` |
| `cache`, `css` | MathJax's shared glyph definitions and stylesheet |

The viewer uses `math.json` only when its `key` matches the document's `math.key` and it has one SVG per formula. Otherwise, or when the file is missing, MathJax draws the formulas in the browser: the text appears first, the formulas nearest the reader are drawn first, and the reading position is held still. `math.json` is a cache: deleting it loses nothing, and `l2m_render.py` / `l2m_viewer.py` draw it again when it is missing or out of date.

## A site

`l2m_viewer.py build site/ a.l2m b.l2m ...` copies documents into `site/papers/<name>/`, writes `site/library.json` (the name, title, authors and path of each paper) and copies the viewer next to them. `index.html?p=<name>` opens a paper; without `?p` the page lists the library.
