---
name: l2m-push
description: Push LaTeX notes (or whole papers) into Erez's "Papers" reading app, where they are converted and appear in the library; the same id updates the same note. Use when asked to put notes, a derivation, a summary or a draft "in the app", "on my phone", or "in Papers".
---

# Pushing notes to the Papers app

`l2m_push.py` sends LaTeX to the Papers app (https://erezu1.github.io/l2m-app/). It is converted on GitHub
(a minute or two) and shows in the library, marked "note". Pushing again with the same `--id` updates the
same note in place (it keeps its place, reading position and pin).

```bash
L2M="/Users/urbach/IAS Dropbox/Erez Urbach/research/latex_mobile/l2m_push.py"

# a note written as a LaTeX body only (no \documentclass): a standard preamble is added
# (amsmath, amssymb, mathtools, amsthm with theorem/lemma/proposition/definition/remark, graphicx, tikz, hyperref)
python3 "$L2M" notes.tex --id rmt-notes --title "Notes on supersymmetric RMT"

# the same from standard input
cat <<'EOF' | python3 "$L2M" - --id rmt-notes --title "Notes on supersymmetric RMT"
\section{Setup}
...
EOF

# a whole LaTeX document, or a project folder (figures, .bib and .sty next to it are taken along)
python3 "$L2M" paper/main.tex --id bf-draft

python3 "$L2M" --list              # the notes and drafts in the library
python3 "$L2M" --remove rmt-notes  # take a note out
```

- It waits for the conversion and prints `ok: <link>`, or the converter's error (exit status 1). `--no-wait`
  returns at once; `--here` converts on this machine first (needs TeX and Node), which is quicker.
- Ids: letters, digits and `. _ ~ -`; choose a stable, descriptive id per note (e.g. `project-topic`) and reuse
  it to update. Not an arXiv number.
- Write ordinary LaTeX: sections, equations (numbered, with `\label`/`\eqref`), theorem environments,
  `\cite` with a `thebibliography`, TikZ (drawn by LaTeX), figures via `\includegraphics` next to the file.
  Harvmac (plain TeX) papers are read too.
- Needs git access to the private repo `erezu1/l2m-library` (the `gh` login on this Mac).
- Tell the user the link it prints.
