#!/usr/bin/env python3
"""latex2mobile: turn a LaTeX article into a latex2mobile document, the paper as data.

    python3 latex2mobile.py paper.tex                      # writes the folder paper.l2m/ next to paper.tex
    python3 latex2mobile.py paper.tex --html paper.html    # ... and a one-file page to read it
    python3 l2m_render.py paper.l2m -o paper.html          # the page, later, without LaTeX
    python3 l2m_viewer.py build site paper.l2m ...         # a site with a library of documents

The document (see DOCUMENT.md) holds the paper's HTML, its numbering, its formulas as TeX and its
figures, with no viewer code. How it looks and what the reading bar offers come from viewer/
(theme.json, theme.css, viewer.js, nav.js), which reads the document in the browser.

How it works
  1. The source is read, \\input/\\include files are inlined and comments removed.
  2. Hidden \\label commands are added to every numbered object (sections, equations and
     equation rows, theorem-like environments, captions). This copy is compiled with
     pdflatex (+ bibtex) in a temporary directory, so every number in the document is the
     number LaTeX itself prints. LaTeX is used for nothing else.
  3. The body is converted to HTML. Macros, theorem environments and \\graphicspath are
     read from the preamble. Formulas are kept as TeX, and drawn once with MathJax in node
     (render_math.js) into math.json, so a viewer does not have to draw them.

Requirements: python3 (standard library only), a TeX installation (pdflatex, bibtex),
node, and `npm install` run once in this folder. Optional: pdftoppm (PDF figures).
"""

import argparse
import base64
import datetime
import hashlib
import html
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUTO = "l2m-auto-"
__version__ = "0.4"
DOC_FORMAT = "l2m-doc"   # the document this tool writes (see DOCUMENT.md)
DOC_VERSION = 1

VERB_ENVS = ("verbatim", "verbatim*", "Verbatim", "lstlisting", "minted", "comment", "BVerbatim", "alltt")
SINGLE_MATH = ("equation", "equation*", "displaymath", "multline", "multline*", "math")
ROW_MATH = ("align", "gather", "eqnarray", "flalign", "alignat", "xalignat", "xxalignat")
ROW_SEP = r"\\\\\*?(?:\s*\[[^\]]*\])?"
FLOATS = ("figure", "figure*", "table", "table*", "wrapfigure", "wraptable", "sidewaysfigure",
          "sidewaystable", "subfigure", "subtable", "SCfigure", "margintable", "marginfigure")
LISTS = ("itemize", "enumerate", "description", "compactitem", "compactenum", "compactdesc",
         "inparaenum", "asparaenum", "itemize*", "enumerate*", "description*")
TABULARS = ("tabular", "tabular*", "tabularx", "tabulary", "longtable", "longtable*", "supertabular")
TRANSPARENT = ("ruledtabular", "scalebox", "small", "addmargin", "adjustwidth", "keywords",
               "minipage", "adjustbox", "landscape", "multicols", "multicols*", "subequations",
               "spacing", "singlespace", "onehalfspace", "doublespace", "sloppypar", "appendices",
               "small", "footnotesize", "scriptsize", "tiny", "normalsize", "large", "Large", "LARGE",
               "huge", "Huge", "raggedright", "raggedleft", "samepage", "frame", "otherlanguage",
               "hyphenrules", "linenomath", "linenomath*", "widetext", "fullwidth", "savenotes",
               "threeparttable", "tablenotes", "resizebox", "scope", "document", "abstract*")
PICTURES = ("tikzpicture", "pgfpicture", "picture", "pspicture", "circuitikz", "feynman",
            "fmfgraph", "fmfgraph*", "axis", "asy")

DEFAULT_THMS = {
    "theorem": ("Theorem", "plain"), "thm": ("Theorem", "plain"), "lemma": ("Lemma", "plain"),
    "lem": ("Lemma", "plain"), "proposition": ("Proposition", "plain"), "prop": ("Proposition", "plain"),
    "corollary": ("Corollary", "plain"), "cor": ("Corollary", "plain"), "conjecture": ("Conjecture", "plain"),
    "claim": ("Claim", "plain"), "fact": ("Fact", "plain"), "hypothesis": ("Hypothesis", "plain"),
    "assumption": ("Assumption", "plain"), "observation": ("Observation", "plain"),
    "definition": ("Definition", "definition"), "defn": ("Definition", "definition"),
    "example": ("Example", "definition"), "exercise": ("Exercise", "definition"),
    "problem": ("Problem", "definition"), "question": ("Question", "definition"),
    "remark": ("Remark", "remark"), "rem": ("Remark", "remark"), "note": ("Note", "remark"),
    "notation": ("Notation", "remark"),
}

FORMAT = {
    "emph": ("<em>", "</em>"), "textit": ("<em>", "</em>"), "textsl": ("<em>", "</em>"),
    "textbf": ("<strong>", "</strong>"), "texttt": ("<code>", "</code>"),
    "textsc": ('<span class="sc">', "</span>"), "textrm": ("", ""), "textsf": ("", ""),
    "textnormal": ("", ""), "textup": ("", ""), "textmd": ("", ""), "underline": ("<u>", "</u>"),
    "uline": ("<u>", "</u>"), "textsuperscript": ("<sup>", "</sup>"), "textsubscript": ("<sub>", "</sub>"),
    "mbox": ("", ""), "hbox": ("", ""), "text": ("", ""), "enquote": ("\u201c", "\u201d"),
    "mathrm": ("", ""), "textup": ("", ""), "nolinkurl": ("<code>", "</code>"), "fbox": ("", ""),
    "caps": ('<span class="sc">', "</span>"), "textcircled": ("(", ")"),
    "centerline": ("", ""), "leftline": ("", ""), "rightline": ("", ""), "shortstack": ("", ""),
    "makecell": ("", ""), "mathit": ("<em>", "</em>"), "mathbf": ("<strong>", "</strong>"),
}
DECLS = {
    "bf": ("<strong>", "</strong>"), "bfseries": ("<strong>", "</strong>"), "it": ("<em>", "</em>"),
    "itshape": ("<em>", "</em>"), "em": ("<em>", "</em>"), "sl": ("<em>", "</em>"),
    "slshape": ("<em>", "</em>"), "tt": ("<code>", "</code>"), "ttfamily": ("<code>", "</code>"),
    "sc": ('<span class="sc">', "</span>"), "scshape": ('<span class="sc">', "</span>"),
    "rm": ("", ""), "rmfamily": ("", ""), "sf": ("", ""), "sffamily": ("", ""), "upshape": ("", ""),
    "mdseries": ("", ""), "normalfont": ("", ""),
}
SIZES = ("tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE",
         "huge", "Huge")
IGNORE0 = ("begingroup", "endgroup", "long", "global", "EnsureStandardFontEncoding", "ClearShipoutPicture",
           "sloppy", "raggedbottom", "flushbottom", "noindent", "bigbreak", "medbreak", "smallbreak",
           "medskip", "smallskip", "bigskip", "noindent", "indent", "centering", "raggedright",
           "raggedleft", "newpage", "clearpage", "cleardoublepage", "pagebreak", "nopagebreak",
           "linebreak", "nolinebreak", "protect", "relax", "hfill", "vfill", "hfil", "vfil", "null",
           "leavevmode", "sloppy", "fussy", "qedhere", "xspace", "ignorespaces", "unskip",
           "FloatBarrier", "phantomsection", "makeatletter", "makeatother", "frenchspacing",
           "nonfrenchspacing", "selectfont", "strut", "mathstrut", "break", "allowbreak", "nobreak",
           "onecolumn", "twocolumn", "balance", "normalcolor", "boldmath", "unboldmath", "hline",
           "endinput", "tableofcontents", "listoffigures", "listoftables", "printindex", "maketitle",
           "appendix", "notoc", "toccontinuoustrue", "fi", "else", "iffalse", "iftrue", "normalsize")
IGNORE1 = ("vspace", "vspace*", "pagestyle", "thispagestyle", "index", "glossary", "hypersetup",
           "enlargethispage", "graphicspath", "usetikzlibrary", "pgfplotsset", "tikzset",
           "setcitestyle", "captionsetup", "bibliographystyle", "nocite", "pagenumbering",
           "markboth", "markright", "linespread", "nomenclature", "addcontentsline", "phantom",
           "hphantom", "vphantom", "color", "urlstyle", "hyphenation", "setstretch", "input",
           "include", "includeonly", "arxivnumber", "preprint", "pacs", "subjclass", "noalign",
           "twocolumngrid", "onecolumngrid", "affiliationnote",
           "orcidlink", "includepdf", "AddToShipoutPicture", "AddToShipoutPictureBG", "thispagestyle")
IGNORE2 = ("setlength", "addtolength", "setcounter", "addtocounter", "numberwithin", "setuptodonotes",
           "newlength", "definecolor")
SYMBOLS = {
    "S": "\u00a7", "P": "\u00b6", "dag": "\u2020", "ddag": "\u2021", "copyright": "\u00a9",
    "pounds": "\u00a3", "ldots": "\u2026", "dots": "\u2026", "textellipsis": "\u2026", "cdots": "\u22ef",
    "LaTeX": "LaTeX", "TeX": "TeX", "LaTeXe": "LaTeX2\u03b5", "BibTeX": "BibTeX",
    "textbackslash": "\\", "textasciitilde": "~", "textasciicircum": "^", "textbar": "|",
    "textless": "&lt;", "textgreater": "&gt;", "textendash": "\u2013", "textemdash": "\u2014",
    "textquoteleft": "\u2018", "textquoteright": "\u2019", "textquotedblleft": "\u201c",
    "textquotedblright": "\u201d", "ss": "\u00df", "ae": "\u00e6", "AE": "\u00c6", "oe": "\u0153",
    "OE": "\u0152", "aa": "\u00e5", "AA": "\u00c5", "o": "\u00f8", "O": "\u00d8", "l": "\u0142",
    "L": "\u0141", "i": "\u0131", "j": "\u0237", "quad": "\u2003", "qquad": "\u2003\u2003",
    "textdegree": "\u00b0", "euro": "\u20ac", "textregistered": "\u00ae", "texttrademark": "\u2122",
    "checkmark": "\u2713", "textbullet": "\u2022", "textperiodcentered": "\u00b7", "slash": "/",
    "textsection": "\u00a7", "enspace": "\u2002", "thinspace": "\u2009", "nobreakspace": "\u00a0",
    "textunderscore": "_", "textdollar": "$", "guillemotleft": "\u00ab", "guillemotright": "\u00bb",
    "textquotesingle": "'", "textminus": "\u2212", "textpm": "\u00b1", "texttimes": "\u00d7",
    "bysame": "\u2014\u2014\u2014", "bibrangedash": "\u2013", "bibdatedash": "\u2013", "bibinitperiod": ".", "bibinitdelim": "\u00a0",
    "bibnamedelima": " ", "bibnamedelimb": " ", "bibnamedelimc": " ", "bibnamedelimd": " ", "bibnamedelimi": " ",
    "bibinithyphendelim": ".-", "bibrangessep": ", ",
    "textmu": "\u00b5", "dh": "\u00f0", "DH": "\u00d0", "th": "\u00fe", "TH": "\u00de",
}
_GK = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega".split()
GREEK_TEXT = {}
for _n, _name in enumerate(_GK):
    _lo = chr(0x3B1 + _n + (1 if _n >= 17 else 0))      # skip final sigma U+03C2
    GREEK_TEXT["text" + _name] = _lo
    GREEK_TEXT["text" + _name.capitalize()] = chr(ord(_lo) - 0x20)
GREEK_TEXT["textvarsigma"] = "\u03c2"
ACCENTS = {"'": "\u0301", "`": "\u0300", "^": "\u0302", '"': "\u0308", "~": "\u0303", "=": "\u0304",
           ".": "\u0307", "u": "\u0306", "v": "\u030c", "H": "\u030b", "c": "\u0327", "k": "\u0328",
           "r": "\u030a", "b": "\u0331", "d": "\u0323", "t": "\u0361"}
CONTROL = {" ": " ", ",": "\u2009", ";": " ", ":": " ", "!": "", "-": "", "/": "", "@": "",
           "%": "%", "&": "&amp;", "#": "#", "$": "$", "_": "_", "{": "{", "}": "}", "|": "\u2016",
           "\n": " ", "\t": " "}
REF_KINDS = {"equation": ("Equation", "eq."), "section": ("Section", "section"),
             "subsection": ("Section", "section"), "subsubsection": ("Section", "section"),
             "chapter": ("Chapter", "chapter"), "appendix": ("Appendix", "appendix"),
             "figure": ("Figure", "fig."), "table": ("Table", "table"), "item": ("Item", "item"),
             "footnote": ("Footnote", "footnote"), "part": ("Part", "part")}


class ParseError(Exception):
    pass


CMD_RE = re.compile(r"\\([A-Za-z@]+)(\*?)")
BEGIN_RE = re.compile(r"\\begin\s*\{([^}]*)\}")
BEGIN_ANY = re.compile(r"\\begin\s*\{")
END_ANY = re.compile(r"\\end\s*\{")
SECT_RE = re.compile(r"\\(part|chapter|section|subsection|subsubsection)(\*?)(?![A-Za-z])")
CAPTION_RE = re.compile(r"\\caption(?![A-Za-z])")
LABEL_AT = re.compile(r"\s*\\label\s*\{([^}]*)\}")
BLANK_RE = re.compile(r"\n[ \t]*\n\s*")


# --------------------------------------------------------------------------- parsing helpers
def skip_ws(s, i, newlines=True):
    chars = " \t\n" if newlines else " \t"
    while i < len(s) and s[i] in chars:
        i += 1
    return i


def match_brace(s, i):
    """s[i] == '{'. Return the index just after the matching '}'."""
    depth = 0
    j = i
    n = len(s)
    while j < n:
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return j + 1
        j += 1
    raise ParseError("unbalanced braces near: " + s[i:i + 80].replace("\n", " "))


def read_group(s, i, newlines=True):
    """Read a {...} group starting at i (after whitespace). Returns (content, end) or (None, i)."""
    j = skip_ws(s, i, newlines)
    if j >= len(s) or s[j] != "{":
        return None, i
    k = match_brace(s, j)
    return s[j + 1:k - 1], k


def read_arg(s, i):
    """A braced group or a single token (for macro arguments and accents)."""
    j = skip_ws(s, i)
    if j >= len(s):
        return "", j
    if s[j] == "{":
        return read_group(s, j)
    if s[j] == "\\":
        m = re.match(r"\\([A-Za-z]+|.)", s[j:])
        return m.group(0), j + m.end()
    return s[j], j + 1


def read_opt(s, i):
    """Read an optional [...] argument at i (spaces allowed, not newlines)."""
    j = skip_ws(s, i, newlines=False)
    if j < len(s) and s[j] == "[":
        depth = 0
        k = j + 1
        while k < len(s):
            c = s[k]
            if c == "\\":
                k += 2
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            elif c == "]" and depth == 0:
                return s[j + 1:k], k + 1
            k += 1
    return None, i


def env_end(s, i, env):
    """i is just after \\begin{env}. Return (start of \\end{env}, index after it)."""
    depth = 1
    pat = re.compile(r"\\(begin|end)\s*\{" + re.escape(env) + r"\}")
    for m in pat.finditer(s, i):
        depth += 1 if m.group(1) == "begin" else -1
        if depth == 0:
            return m.start(), m.end()
    raise ParseError("\\begin{%s} without \\end{%s}" % (env, env))


def split_top_keep(s, pattern):
    """Split s at matches of `pattern` outside braces, $...$ and nested environments.
    Returns [(piece, separator), ...]; the last separator is ''."""
    pat = re.compile(pattern)
    parts = []
    depth = 0
    envd = 0
    math = False
    start = 0
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        top = depth == 0 and envd == 0 and not math
        if top:
            m = pat.match(s, i)
            if m and m.end() > i:
                parts.append((s[start:i], m.group(0)))
                i = m.end()
                start = i
                continue
        if c == "\\":
            if s.startswith("\\begin", i) and BEGIN_ANY.match(s, i):
                envd += 1
                i += 6
                continue
            if s.startswith("\\end", i) and END_ANY.match(s, i):
                envd -= 1
                i += 4
                continue
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == "$":
            math = not math
        i += 1
    parts.append((s[start:], ""))
    return parts


def split_top(s, pattern):
    return [p for p, _ in split_top_keep(s, pattern)]


def strip_comments(text):
    """Remove % comments (LaTeX rules), keeping verbatim-like environments and \\verb intact."""
    out = []
    in_verb = None
    begin_verb = re.compile(r"\\begin\{(verbatim\*?|Verbatim|lstlisting|minted|comment|BVerbatim|alltt)\}")
    for line in text.split("\n"):
        if in_verb:
            out.append(line)
            if re.search(r"\\end\{" + re.escape(in_verb) + r"\}", line):
                in_verb = None
            continue
        m = begin_verb.search(line)
        j = 0
        n = len(line)
        cut = None
        while j < n:
            c = line[j]
            if m and j == m.start():
                break
            if c == "\\":
                if line.startswith("\\verb", j) and j + 5 < n and not line[j + 5].isalpha():
                    k = j + 5
                    if line[k] == "*":
                        k += 1
                    d = line[k] if k < n else ""
                    e = line.find(d, k + 1) if d else -1
                    j = e + 1 if e >= 0 else n
                    continue
                j += 2
                continue
            if c == "%":
                cut = j
                break
            j += 1
        if m and (cut is None or cut > m.start()):
            if not re.search(r"\\end\{" + re.escape(m.group(1)) + r"\}", line[m.end():]):
                in_verb = m.group(1)
            out.append(line)
            continue
        out.append(line[:cut] + "\x01" if cut is not None else line)
    s = "\n".join(out)
    s = re.sub("\x01\n[ \t]*", "", s)
    return s.replace("\x01", "")


def png_size(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    return None


def plain_text(tex):
    t = re.sub(r"\$([^$]*)\$", r"\1", tex)
    t = re.sub(r"\\(?:thanks|footnote)\s*\{[^{}]*\}", "", t)
    t = re.sub(r"\\\\", " ", t)
    t = re.sub(r"\\[A-Za-z]+\*?", " ", t)
    t = t.replace("{", "").replace("}", "").replace("~", " ")
    return re.sub(r"\s+", " ", t).strip()

def wrap_greek(page):
    """Polytonic Greek is missing from the reading fonts: put whole Greek words in span.greek (Noto Serif)."""
    if not re.search("[\u1f00-\u1fff]", page):
        return page

    def wrap(seg):
        return re.sub("(?<![\u0370-\u03ff\u1f00-\u1fff])([\u0370-\u03ff\u1f00-\u1fff]*[\u1f00-\u1fff][\u0370-\u03ff\u1f00-\u1fff]*)",
                      r'<span class="greek" lang="el">\1</span>', seg)
    parts = re.split(r"(<[^>]+>)", page)
    inside_greek = 0
    for k, part in enumerate(parts):
        if part.startswith("<"):
            if part.startswith('<span class="greek"'):
                inside_greek += 1
            elif part == "</span>" and inside_greek:
                inside_greek -= 1
        elif not inside_greek and re.search("[\u1f00-\u1fff]", part):
            parts[k] = wrap(part)
    return "".join(parts)



# --------------------------------------------------------------------------- converter
class Converter:
    def __init__(self, args):
        self.args = args
        self.src = Path(args.input).resolve()
        self.srcdir = self.src.parent
        self.warnings = {}
        self.macros = {}
        self.env_defs = {}
        self.thms = {}
        self.packages = set()
        self.graphicspath = []
        self.labels = {}
        self.label_anchor = {}
        self.bibcite = {}
        self.math_items = []
        self.pending_fn = []
        self.fn_count = 0
        self.headings = []
        self.meta = {"title": None, "authors": [], "affil": [], "email": [], "date": None,
                     "thanks": [], "abstract": None, "keywords": None}
        self.title_done = False
        self.just_titled = False
        self.have_chapters = False
        self.image_cache = {}
        self.build = None
        self.expansions = 0
        self.id_map = {}
        self.all_fn = []
        self.used_ids = {"l2m-top", "l2m-bar", "l2m-menu", "l2m-fnsheet", "refs-h", "abstract-h", "notes-h"}

    def sid(self, key):
        """A URL-safe, unique id for a LaTeX label (letters, digits, . _ ~ - only)."""
        key = key.strip()
        if key in self.id_map:
            return self.id_map[key]
        base = re.sub(r"[^A-Za-z0-9._~-]+", "-", key).strip("-") or "id"
        cand = base
        k = 2
        while cand in self.used_ids:
            cand = "%s-%d" % (base, k)
            k += 1
        self.id_map[key] = cand
        self.used_ids.add(cand)
        return cand

    # ------------------------------------------------------------------ messages
    def warn(self, msg):
        self.warnings[msg] = self.warnings.get(msg, 0) + 1

    def info(self, msg):
        if not self.args.quiet:
            print(msg, file=sys.stderr)

    # ------------------------------------------------------------------ source
    def find_file(self, name, basedir, exts):
        for base in [basedir, self.srcdir]:
            for ext in exts:
                p = (base / (name + ext)).resolve()
                if p.is_file():
                    return p
        return None

    def inline_inputs(self, text, basedir, depth=0):
        if depth > 20:
            return text

        def rep(m):
            name = (m.group(2) or m.group(3)).strip()
            p = self.find_file(name, basedir, [".tex", ""])
            if p is None or p.suffix not in (".tex", ".bbl", ""):
                if p is None:
                    self.warn("could not find \\%s{%s}" % (m.group(1), name))
                return m.group(0)
            sub = strip_comments(p.read_text(errors="replace"))
            return self.inline_inputs(sub, p.parent, depth + 1)

        return re.sub(r"\\(input|include)\s*(?:\{([^}]*)\}|(?<=\s)([^\s{}\\]+\.tex))", rep, text)

    # ------------------------------------------------------------------ definitions
    def parse_definition(self, s, m):
        """m matched a definition command at its start; register it and return the end index."""
        cmd, star = m.group(1), m.group(2)
        i = m.end()
        try:
            if cmd in ("newcommand", "renewcommand", "providecommand", "DeclareRobustCommand"):
                j = skip_ws(s, i)
                if s[j] == "{":
                    g, j = read_group(s, j)
                    name = g.strip()
                else:
                    mm = re.match(r"\\([A-Za-z@]+|.)", s[j:])
                    name = mm.group(0)
                    j += mm.end()
                name = name.lstrip("\\")
                nargs, default = 0, None
                o, j2 = read_opt(s, j)
                if o is not None:
                    nargs = int(o.strip() or 0)
                    j = j2
                    o, j2 = read_opt(s, j)
                    if o is not None:
                        default = o
                        j = j2
                body, j = read_group(s, j)
                if body is None:
                    return j
                if not (cmd == "providecommand" and name in self.macros):
                    self.macros[name] = dict(nargs=nargs, default=default, body=body, math_only=False)
                return j
            if cmd == "DeclareMathOperator":
                g, j = read_group(s, i)
                name = g.strip().lstrip("\\")
                body, j = read_group(s, j)
                op = "\\operatorname*" if star else "\\operatorname"
                self.macros[name] = dict(nargs=0, default=None, body="%s{%s}" % (op, body), math_only=True)
                return j
            if cmd in ("def", "gdef", "edef", "xdef"):
                mm = re.match(r"\s*\\([A-Za-z@]+|.)", s[i:])
                name = mm.group(1)
                j = i + mm.end()
                k = s.find("{", j)
                params = s[j:k]
                body, j = read_group(s, k)
                nargs = len(re.findall(r"#\d", params))
                self.macros[name] = dict(nargs=nargs, default=None, body=body, math_only=False)
                return j
            if cmd == "let":
                mm = re.match(r"\s*\\([A-Za-z@]+)\s*=?\s*(\\[A-Za-z@]+|.)", s[i:])
                if mm:
                    self.macros[mm.group(1)] = dict(nargs=0, default=None, body=mm.group(2), math_only=False)
                    return i + mm.end()
                return i
            if cmd in ("newenvironment", "renewenvironment"):
                name, j = read_group(s, i)
                nargs, default = 0, None
                o, j2 = read_opt(s, j)
                if o is not None:
                    nargs = int(o.strip() or 0)
                    j = j2
                    o, j2 = read_opt(s, j)
                    if o is not None:
                        default = o
                        j = j2
                begin, j = read_group(s, j)
                end, j = read_group(s, j)
                self.env_defs[name.strip()] = dict(nargs=nargs, default=default, begin=begin, end=end)
                return j
            if cmd == "theoremstyle":
                g, j = read_group(s, i)
                self.thm_style = g.strip()
                return j
            if cmd == "newtheorem":
                name, j = read_group(s, i)
                shared, j2 = read_opt(s, j)
                j = j2
                title, j = read_group(s, j)
                _, j = read_opt(s, j)
                self.thms[name.strip()] = dict(title=title, style=getattr(self, "thm_style", "plain"),
                                               numbered=not star)
                return j
            if cmd == "declaretheorem":
                o, j = read_opt(s, i)
                name, j = read_group(s, j)
                opts = dict(re.findall(r"(\w+)\s*=\s*([^,\]]+)", o or ""))
                title = opts.get("name", opts.get("title", name.strip().capitalize()))
                self.thms[name.strip()] = dict(title=title.strip(), style=opts.get("style", "plain").strip(),
                                               numbered="numbered" not in opts or opts["numbered"] != "no")
                return j
        except (ParseError, AttributeError, ValueError, IndexError):
            self.warn("could not parse a \\%s definition" % cmd)
        return i

    DEF_RE = re.compile(r"\\(newcommand|renewcommand|providecommand|DeclareRobustCommand|DeclareMathOperator|"
                        r"def|gdef|edef|xdef|let|newenvironment|renewenvironment|theoremstyle|newtheorem|"
                        r"declaretheorem)(\*?)(?![A-Za-z])")

    def scan_definitions(self, s):
        i = 0
        while True:
            m = self.DEF_RE.search(s, i)
            if not m:
                return
            i = max(self.parse_definition(s, m), m.end())

    def parse_preamble(self, pre):
        self.scan_definitions(pre)
        for m in re.finditer(r"\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}", pre):
            for p in m.group(1).split(","):
                p = p.strip()
                self.packages.add(p)
                local = self.srcdir / (p + ".sty")
                if local.is_file() and p not in getattr(self, "_seen_sty", set()):
                    self._seen_sty = getattr(self, "_seen_sty", set()) | {p}
                    before = set(self.macros)
                    self.scan_definitions(strip_comments(local.read_text(errors="replace")))
                    for k in set(self.macros) - before:
                        self.macros[k]["from_sty"] = True
        m = re.search(r"\\graphicspath\s*\{", pre)
        if m:
            g, _ = read_group(pre, m.end() - 1)
            self.graphicspath = re.findall(r"\{([^}]*)\}", g)
        self.have_chapters = bool(re.search(r"\\documentclass\s*(?:\[[^\]]*\])?\s*\{(book|report|memoir|scrbook|scrreprt)\}", pre))
        self.grab_meta(pre)

    META_RE = re.compile(r"\\(title|author|date|affiliation|affil|address|institute|emailAdd|email|thanks|"
                         r"keywords|abstract)(?![A-Za-z])")

    def grab_meta(self, s):
        i = 0
        while True:
            m = self.META_RE.search(s, i)
            if not m:
                return
            i = self.meta_command(s, m.group(1), m.end())

    def meta_command(self, s, name, i):
        o, j = read_opt(s, i)
        g, j = read_group(s, j)
        if g is None:
            return i
        if name == "title":
            self.meta["title"] = g
        elif name == "author":
            parts = re.split(r"\\and(?![A-Za-z])", g)
            self.meta["authors"].extend(p.strip() for p in parts if p.strip())
        elif name == "date":
            self.meta["date"] = g
        elif name in ("affiliation", "affil", "address", "institute"):
            self.meta["affil"].append(g)
        elif name in ("emailAdd", "email"):
            self.meta["email"].append(g)
        elif name == "thanks":
            self.meta["thanks"].append(g)
        elif name == "keywords":
            self.meta["keywords"] = g
        elif name == "abstract":
            self.meta["abstract"] = g
        return j

    # ------------------------------------------------------------------ theorems
    def thm_info(self, env):
        if env in self.thms:
            return self.thms[env]
        base = env.rstrip("*")
        if base in DEFAULT_THMS and env not in self.env_defs:
            title, style = DEFAULT_THMS[base]
            return dict(title=title, style=style, numbered=not env.endswith("*"))
        return None

    def expand_env_shortcuts(self, body):
        """Expand argument-free macros such as \\be -> \\begin{equation}, so environments are visible."""
        short = {k: d["body"] for k, d in self.macros.items()
                 if d["nargs"] == 0 and self.expandable(k) and re.search(r"\\(begin|end)\s*\{", d["body"])}
        if not short:
            return body
        pat = re.compile(r"\\(%s)(?![A-Za-z@])" % "|".join(sorted(map(re.escape, short), key=len, reverse=True)))
        for _ in range(5):
            new = pat.sub(lambda m: short[m.group(1)], body)
            if new == body:
                break
            body = new
        return body

    NATIVE = {"section", "subsection", "subsubsection", "paragraph", "subparagraph", "chapter", "part",
              "maketitle", "title", "author", "date", "caption", "label", "ref", "eqref", "cite", "footnote",
              "item", "emph", "textbf", "textit", "texttt", "begin", "end", "bibliography", "appendix", "thanks",
              "url", "href", "includegraphics", "abstract", "keywords", "affiliation", "email", "emailAdd",
              "tableofcontents", "printbibliography", "bibitem", "proof", "qed", "par", "footnotemark",
              "footnotetext", "newline", "and", "today", "verb", "input", "include"}
    NATIVE_ENVS = {"thebibliography", "itemize", "enumerate", "description", "equation", "equation*", "align",
                   "align*", "gather", "gather*", "multline", "multline*", "eqnarray", "eqnarray*", "figure",
                   "figure*", "table", "table*", "tabular", "abstract", "center", "quote", "quotation", "verbatim"}
    COMPLEX = re.compile(r"@|\\(if[a-z]*|else|fi|expandafter|csname|endcsname|futurelet|edef|xdef|def|gdef|let|"
                         r"relax|protect|noexpand|the|advance|global|long|makeatletter|makeatother|setlength|"
                         r"renewcommand|newcommand|begingroup|endgroup|ifx|ifdim|ifnum)(?![A-Za-z])")

    def expandable(self, name):
        """Whether a user macro may be expanded in running text (not LaTeX internals or our own commands)."""
        d = self.macros.get(name)
        if not d or d["math_only"] or d.get("from_sty") or name in self.NATIVE:
            return False
        return not self.COMPLEX.search(d["body"])

    def _alias_re(self, builtin):
        names = [k for k, d in self.macros.items()
                 if d["nargs"] <= 1 and re.search(r"\\(%s)(?![A-Za-z])" % builtin, d["body"])]
        alt = "|".join([builtin] + [re.escape(n) for n in sorted(names, key=len, reverse=True)])
        return re.compile(r"\\(?:%s)(?![A-Za-z@])" % alt)

    def nonum_re(self):
        if not hasattr(self, "_nonum"):
            self._nonum = self._alias_re("nonumber|notag")
        return self._nonum

    def label_re(self):
        if not hasattr(self, "_labre"):
            self._labre = self._alias_re("label")
        return self._labre

    # ------------------------------------------------------------------ auto labels
    def add_auto_labels(self, body):
        out = []
        i = 0
        n = len(body)
        count = [0]

        def new():
            count[0] += 1
            return "\\label{%s%d}" % (AUTO, count[0])

        while i < n:
            c = body[i]
            if c != "\\":
                out.append(c)
                i += 1
                continue
            if body.startswith("\\verb", i) and i + 5 < n and not body[i + 5].isalpha():
                k = i + 5 + (1 if body[i + 5] == "*" else 0)
                e = body.find(body[k], k + 1)
                e = n if e < 0 else e + 1
                out.append(body[i:e])
                i = e
                continue
            m = BEGIN_RE.match(body, i)
            if m:
                env = m.group(1)
                j = m.end()
                if env in VERB_ENVS:
                    _, after = env_end(body, j, env)
                    out.append(body[i:after])
                    i = after
                    continue
                info = self.thm_info(env)
                if info and info["numbered"]:
                    _, j2 = read_opt(body, j)
                    out.append(body[i:j2] + new())
                    i = j2
                    continue
                if env in ("equation", "multline"):
                    end, after = env_end(body, j, env)
                    inner = body[j:end]
                    skip = self.nonum_re().search(inner) or self.label_re().search(inner)
                    lab = "" if skip else new()
                    out.append(body[i:j] + inner + lab + body[end:after])
                    i = after
                    continue
                if env in ROW_MATH:
                    k = j
                    if env in ("alignat", "xalignat", "xxalignat"):
                        _, k = read_group(body, k)
                    end, after = env_end(body, j, env)
                    rows = []
                    carried = False   # amsmath: a label in an unnumbered row moves to the next numbered row
                    for row, sep in split_top_keep(body[k:end], ROW_SEP):
                        has_label = bool(self.label_re().search(row))
                        if self.nonum_re().search(row) or not row.strip():
                            carried = carried or has_label
                        else:
                            if not (has_label or carried):
                                row += new()
                            carried = False
                        rows.append(row + sep)
                    out.append(body[i:k] + "".join(rows) + body[end:after])
                    i = after
                    continue
                out.append(body[i:j])
                i = j
                continue
            m = SECT_RE.match(body, i)
            if m:
                j = m.end()
                _, j = read_opt(body, j)
                g, j2 = read_group(body, j)
                if g is not None:
                    out.append(body[i:j2] + ("" if m.group(2) else new()))
                    i = j2
                    continue
            m = CAPTION_RE.match(body, i)
            if m:
                j = m.end()
                _, j = read_opt(body, j)
                g, j2 = read_group(body, j)
                if g is not None:
                    out.append(body[i:j2] + new())
                    i = j2
                    continue
            out.append(body[i:i + 2])
            i += 2
        return "".join(out)

    # ------------------------------------------------------------------ LaTeX run
    def compile(self, text, stem):
        tex = self.build / (stem + ".tex")
        tex.write_text(text)
        env = os.environ.copy()
        for var in ("TEXINPUTS", "BIBINPUTS", "BSTINPUTS"):
            env[var] = str(self.srcdir) + os.pathsep + env.get(var, "")
        engine = self.args.engine

        def run(cmd):
            try:
                return subprocess.run(cmd, cwd=self.build, env=env, stdout=subprocess.PIPE,
                                      stderr=subprocess.STDOUT, text=True, errors="replace", timeout=600)
            except FileNotFoundError:
                sys.exit("latex2mobile: %s not found; is TeX installed and on PATH?" % cmd[0])

        latex = [engine, "-interaction=nonstopmode", "-file-line-error", stem + ".tex"]
        shipped = self.srcdir / (self.src.stem + ".bbl")
        if not shipped.exists():
            found = list(self.srcdir.glob("*.bbl"))
            shipped = found[0] if len(found) == 1 else None
        if shipped:
            shutil.copy(shipped, self.build / (stem + ".bbl"))
        self.info("running %s ..." % engine)
        run(latex)
        aux = self.build / (stem + ".aux")
        auxtext = aux.read_text(errors="replace") if aux.exists() else ""
        m = re.search(r"\\bibdata\{([^}]*)\}", auxtext)
        if m:
            bibs = [b.strip() for b in m.group(1).split(",") if b.strip()]
            have = all((self.srcdir / (b if b.endswith(".bib") else b + ".bib")).exists() for b in bibs)
            if have or not shipped:
                self.info("running bibtex ...")
                run(["bibtex", stem])
        elif (self.build / (stem + ".bcf")).exists() and not shipped and shutil.which("biber"):
            self.info("running biber ...")
            run(["biber", "--input-directory", str(self.srcdir), stem])
        run(latex)
        r = run(latex)
        if not aux.exists():
            tail = "\n".join(r.stdout.splitlines()[-25:])
            sys.exit("latex2mobile: LaTeX produced no .aux file. End of the log:\n" + tail)
        if r.returncode != 0:
            errs = [l for l in r.stdout.splitlines() if re.match(r"^.*:\d+: ", l)]
            self.warn("LaTeX reported errors (the page may still be fine): " + (errs[0] if errs else "see log"))
        bbl = self.build / (stem + ".bbl")
        return aux.read_text(errors="replace"), (bbl.read_text(errors="replace") if bbl.exists() else "")

    def parse_aux(self, aux):
        for m in re.finditer(r"\\newlabel\{", aux):
            try:
                key, j = read_group(aux, m.end() - 1)
                val, j = read_group(aux, j)
                fields = []
                k = 0
                while True:
                    g, k2 = read_group(val, k)
                    if g is None:
                        break
                    fields.append(g)
                    k = k2
            except ParseError:
                continue
            if key.endswith("@cref") or not fields:
                continue
            self.labels[key] = fields[0]
            if len(fields) >= 4:
                self.label_anchor[key] = fields[3]
        for m in re.finditer(r"\\bibcite\{", aux):
            try:
                key, j = read_group(aux, m.end() - 1)
                val, j = read_group(aux, j)
            except ParseError:
                continue
            if val.startswith("{"):
                fields = []
                k = 0
                while True:
                    g, k2 = read_group(val, k)
                    if g is None:
                        break
                    fields.append(g)
                    k = k2
                if len(fields) >= 3 and fields[2].strip("{} \t\n"):
                    self.bibcite[key] = dict(num=fields[0], year=fields[1], short=fields[2],
                                             long=fields[3] if len(fields) > 3 else fields[2])
                    continue
                if fields:
                    self.bibcite[key] = dict(num=fields[0])
                    continue
            self.bibcite[key] = dict(num=val)

    # ------------------------------------------------------------------ numbers and refs
    def number(self, key):
        v = self.labels.get(key)
        if v is None:
            return None
        v = re.sub(r"\\(relax|ignorespaces|protect)(?![A-Za-z])", "", v).strip()
        return v

    def number_html(self, key):
        v = self.number(key)
        return "??" if v is None else self.convert_inline(v).strip()

    def ref_html(self, key, kind="ref"):
        key = key.strip()
        if key not in self.labels:
            self.warn("undefined reference %s" % key)
            return "??"
        num = self.number_html(key)
        if kind == "eqref":
            num = "(%s)" % num
        elif kind in ("autoref", "cref", "Cref"):
            anchor = self.label_anchor.get(key, "")
            base = anchor.split(".")[0]
            names = REF_KINDS.get(base)
            if base.startswith("theorem") or base in self.thms:
                names = (self.thms.get(base, {}).get("title", "Theorem"),) * 2
            if names:
                word = names[0] if kind in ("autoref", "Cref") else names[1]
                if base == "equation":
                    num = "(%s)" % num
                return '%s\u00a0<a href="#%s">%s</a>' % (word, self.sid(key), num)
        return '<a href="#%s">%s</a>' % (self.sid(key), num)

    def cite_html(self, cmd, opts, keys):
        items = []
        natbib = False
        for k in keys:
            k = k.strip()
            if not k:
                continue
            bc = self.bibcite.get(k)
            if bc is None:
                self.warn("undefined citation %s" % k)
                items.append(("?", "?", "?", k))
                continue
            if "short" in bc:
                natbib = True
                items.append((self.convert_inline(bc["num"]), self.convert_inline(bc["short"]),
                              self.convert_inline(bc["year"]), k))
            else:
                items.append((self.convert_inline(bc["num"]), None, None, k))
        pre = post = ""
        if len(opts) == 1 and opts[0]:
            post = self.convert_inline(opts[0])
        elif len(opts) >= 2:
            pre = self.convert_inline(opts[0]) if opts[0] else ""
            post = self.convert_inline(opts[1]) if opts[1] else ""

        def link(k, text):
            return '<a href="#%s">%s</a>' % (self.sid("cite:" + k), text)

        if natbib:
            if cmd in ("citeauthor", "citeauthor*"):
                return ", ".join(link(k, a) for _, a, _, k in items)
            if cmd in ("citeyear", "citeyearpar"):
                return ", ".join(link(k, y) for _, _, y, k in items)
            if cmd in ("citep", "citep*", "parencite", "autocite", "citealp"):
                inner = "; ".join(link(k, "%s, %s" % (a, y)) for _, a, y, k in items)
                inner = (pre + " " if pre else "") + inner + (", " + post if post else "")
                return inner if cmd == "citealp" else "(%s)" % inner
            return "; ".join("%s (%s)" % (a, link(k, y)) for _, a, y, k in items) + (" (%s)" % post if post else "")
        inner = ", ".join(link(k, n) for n, _, _, k in items)
        if post:
            inner += ", " + post
        if pre:
            inner = pre + " " + inner
        return '<span class="cite">[%s]</span>' % inner

    # ------------------------------------------------------------------ math
    def math(self, tex, display):
        tex = re.sub(r"\\label\s*\{[^}]*\}", "", tex)
        tex = re.sub(r"\\eqref\s*\{([^}]*)\}", lambda m: "\\text{(%s)}" % (self.number(m.group(1)) or "??"), tex)
        tex = re.sub(r"\\ref\s*\{([^}]*)\}", lambda m: "\\text{%s}" % (self.number(m.group(1)) or "??"), tex)
        tex = tex.strip()
        self.math_items.append({"tex": tex, "display": display})
        return "\x00M%d\x00" % (len(self.math_items) - 1)

    def mathjax_config(self):
        macros = {}
        for name, d in self.macros.items():
            if not (re.fullmatch(r"[A-Za-z]+", name) or re.fullmatch(r"[^A-Za-z\s{}\\%#$&^_~]", name)):
                continue
            if name in self.NATIVE or "@" in d["body"] or re.search(r"\\(csname|expandafter|futurelet|ifx|ifdim|ifnum)", d["body"]):
                continue
            if d["nargs"] == 0:
                macros[name] = d["body"]
            elif d["default"] is None:
                macros[name] = [d["body"], d["nargs"]]
            else:
                macros[name] = [d["body"], d["nargs"], d["default"]]
        extras = {"ensuremath": ["#1", 1], "xspace": "", "qedhere": "", "bm": ["\\boldsymbol{#1}", 1],
                  "nobreak": "", "allowbreak": "", "mathbbm": ["\\mathbb{#1}", 1],
                  "intertext": ["\\text{#1}", 1], "shortintertext": ["\\text{#1}", 1],
                  "num": ["#1", 1], "si": ["\\mathrm{#1}", 1], "SI": ["#1\\,\\mathrm{#2}", 2],
                  "textsc": ["\\text{#1}", 1], "vspace": ["", 1], "nolimits": "", "displaybreak": "",
                  "dd": "\\mathrm{d}", "mathds": ["\\mathbb{#1}", 1], "boldmath": "", "unboldmath": "",
                  "slashed": ["{\\not{#1}}", 1], "dag": "\\dagger", "Bar": ["\\bar{#1}", 1],
                  "Tilde": ["\\tilde{#1}", 1], "Hat": ["\\hat{#1}", 1], "Tr": "\\operatorname{Tr}",
                  "tr": "\\operatorname{tr}", "widecheck": ["\\check{#1}", 1], "tcboxmath": ["\\boxed{#1}", 1],
                  "footnote": ["", 1], "footnotesize": "", "small": "", "toprule": "\\hline", "midrule": "\\hline",
                  "bottomrule": "\\hline", "href": ["#2", 2], "relax": "", "ensuremath": ["#1", 1],
                  "bbone": "\\mathbb{1}", "one": "\\mathbb{1}"}
        for k, v in extras.items():
            macros.setdefault(k, v)
        pk = ["base", "ams", "newcommand", "configmacros", "textmacros", "boldsymbol", "upgreek", "noundefined"]
        optional = {"mathtools": "mathtools", "physics": "physics", "braket": "braket", "cancel": "cancel",
                    "xcolor": "color", "color": "color", "mhchem": "mhchem", "gensymb": "gensymb",
                    "cases": "cases", "empheq": "empheq", "centernot": "centernot", "extpfeil": "extpfeil"}
        for p, mjp in optional.items():
            if p in self.packages and mjp not in pk:
                pk.append(mjp)
        return macros, pk

    # ------------------------------------------------------------------ inline conversion
    def expand_macro(self, name, s, i):
        d = self.macros[name]
        args = []
        k = i
        if d["nargs"] > 0:
            if d["default"] is not None:
                o, k2 = read_opt(s, k)
                if o is None:
                    args.append(d["default"])
                else:
                    args.append(o)
                    k = k2
            while len(args) < d["nargs"]:
                a, k = read_arg(s, k)
                args.append(a if a is not None else "")
        body = d["body"]
        for n in range(len(args), 0, -1):
            body = body.replace("#%d" % n, args[n - 1])
        self.expansions += 1
        if self.expansions > 200000:
            raise ParseError("macro expansion does not terminate (\\%s)" % name)
        return body, k

    def convert_inline(self, s):
        out = []
        i = 0
        while i < len(s):
            n = len(s)
            c = s[i]
            if c == "$":
                if s.startswith("$$", i):
                    j = s.find("$$", i + 2)
                    j = n if j < 0 else j
                    out.append(self.display_html(s[i + 2:j], None, []))
                    i = j + 2
                    continue
                j = i + 1
                while j < n and s[j] != "$":
                    j += 2 if s[j] == "\\" else 1
                out.append(self.math(s[i + 1:j], False))
                i = j + 1
                continue
            if c == "\\":
                if s.startswith("\\(", i):
                    j = s.find("\\)", i + 2)
                    j = n if j < 0 else j
                    out.append(self.math(s[i + 2:j], False))
                    i = j + 2
                    continue
                if s.startswith("\\[", i):
                    j = s.find("\\]", i + 2)
                    j = n if j < 0 else j
                    out.append(self.display_html(s[i + 2:j], None, []))
                    i = j + 2
                    continue
                m = CMD_RE.match(s, i)
                if not m:
                    sym = s[i + 1] if i + 1 < n else ""
                    i += 2
                    if sym == "\\":
                        if s[i:i + 1] == "*":
                            i += 1
                        _, i = read_opt(s, i)
                        out.append("<br>")
                    elif sym in ACCENTS:
                        a, i = read_arg(s, i)
                        out.append(self.accent(sym, a))
                    else:
                        out.append(CONTROL.get(sym, html.escape(sym)))
                    continue
                name, star = m.group(1), m.group(2)
                i = m.end()
                while i < len(s) and s[i] in " \t\n":
                    i += 1
                if self.expandable(name):
                    exp, k = self.expand_macro(name, s, i)
                    s = exp + s[k:]
                    i = 0
                    continue
                res = self.command(name, star, s, i, out)
                if isinstance(res, tuple):
                    s, i = res
                else:
                    i = res
                continue
            if c == "{":
                g, i = read_group(s, i)
                out.append(self.convert_inline(g))
                continue
            if c == "}":
                i += 1
                continue
            if c == "~":
                out.append("\u00a0")
                i += 1
                continue
            if s.startswith("---", i):
                out.append("\u2014")
                i += 3
                continue
            if s.startswith("--", i):
                out.append("\u2013")
                i += 2
                continue
            if s.startswith("``", i):
                out.append("\u201c")
                i += 2
                continue
            if s.startswith("''", i):
                out.append("\u201d")
                i += 2
                continue
            if c == "'":
                out.append("\u2019")
                i += 1
                continue
            if c == "`":
                out.append("\u2018")
                i += 1
                continue
            if c in "\n\t":
                out.append(" ")
                i += 1
                continue
            if c == "&":
                out.append(" ")
                i += 1
                continue
            out.append(html.escape(c))
            i += 1
        return re.sub(r"  +", " ", "".join(out))

    def accent(self, sym, a):
        a = {"\\i": "i", "\\j": "j"}.get(a, a)
        base = self.convert_inline(a) if a else ""
        if not base:
            return ""
        return unicodedata.normalize("NFC", base[0] + ACCENTS[sym] + base[1:])

    def command(self, name, star, s, i, out):
        """Handle \\name at s[i] (just after the name). Append html to out; return the new index
        or (new_string, new_index) when the rest of the string was rewritten."""
        full = name + star
        if name == "lmobilerunin":
            g, i = read_group(s, i)
            out.append('<strong class="runin">%s</strong> ' % self.convert_inline(g or ""))
            return i
        if name == "texorpdfstring":
            g, i = read_group(s, i)
            _, i = read_group(s, i)
            out.append(self.convert_inline(g or ""))
            return i
        if name == "newline":
            out.append("<br>")
            return i
        if name == "proof":
            out.append('<em class="proof-head">Proof.</em> ')
            return i
        if name in ("qed", "endproof", "qedsymbol", "QED", "blacksquare", "qquad@qed"):
            out.append('<span class="qed" aria-label="end of proof">\u220e</span>')
            return i
        if name in ("subfigure", "subfloat", "subcaptionbox"):
            o, i = read_opt(s, i)
            if name == "subcaptionbox":
                o, i = read_group(s, i)
            g, i = read_group(s, i)
            cap = (' <span class="subcap">%s</span>' % self.convert_inline(o)) if o else ""
            out.append('<span class="subfig">%s%s</span>' % (self.convert_inline(g or ""), cap))
            return i
        if name == "textgreek":
            g, i = read_group(s, i)
            out.append('<span class="greek" lang="el">%s</span>' % self.convert_inline(g or ""))
            return i
        if name in GREEK_TEXT:
            out.append(GREEK_TEXT[name])
            return i
        if name == "keyword":
            g, i = read_group(s, i)
            out.append(self.convert_inline(g or "") + "; ")
            return i
        if name == "newcounter":
            _, i = read_group(s, i)
            _, i = read_opt(s, i)
            return i
        if name == "definecolor":
            for _ in range(3):
                _, i = read_group(s, i)
            return i
        if name in FORMAT:
            g, i = read_arg(s, i)
            o, c = FORMAT[name]
            out.append(o + self.convert_inline(g) + c)
            return i
        if name in DECLS:
            o, c = DECLS[name]
            out.append(o + self.convert_inline(s[i:]) + c)
            return len(s)
        if name in SIZES or full in IGNORE0 or name in IGNORE0:
            return i
        if name in ("ref", "eqref", "autoref", "cref", "Cref", "pageref", "vref", "nameref", "subref"):
            g, i = read_group(s, i)
            if name in ("pageref",):
                return i
            if name in ("cref", "Cref") and "," in g:
                out.append(", ".join(self.ref_html(k, name) for k in g.split(",")))
                return i
            kind = {"eqref": "eqref", "autoref": "autoref", "cref": "cref", "Cref": "Cref"}.get(name, "ref")
            out.append(self.ref_html(g, kind))
            return i
        if name in ("cite", "citep", "citet", "citealp", "citealt", "citeauthor", "citeyear", "citeyearpar",
                    "parencite", "textcite", "autocite", "Cite", "Citep", "Citet", "footcite", "supercite"):
            opts = []
            while True:
                o, j = read_opt(s, i)
                if o is None:
                    break
                opts.append(o)
                i = j
            g, i = read_group(s, i)
            out.append(self.cite_html(full, opts, (g or "").split(",")))
            return i
        if name == "nocite":
            _, i = read_group(s, i)
            return i
        if name == "footnote":
            _, i = read_opt(s, i)
            g, i = read_group(s, i)
            self.fn_count += 1
            k = self.fn_count
            self.pending_fn.append((k, self.convert_inline(g or "")))
            out.append('<sup class="fnref"><a href="#fn%d" id="fnref%d">%d</a></sup>' % (k, k, k))
            return i
        if name in ("footnotemark", "footnotetext"):
            _, i = read_opt(s, i)
            if name == "footnotetext":
                g, i = read_group(s, i)
                self.fn_count += 1
                self.pending_fn.append((self.fn_count, self.convert_inline(g or "")))
            self.warn("\\%s is approximated" % name)
            return i
        if name == "thanks":
            g, i = read_group(s, i)
            self.meta["thanks"].append(g or "")
            return i
        if name == "label":
            g, i = read_group(s, i)
            if g and not g.startswith(AUTO):
                out.append('<span id="%s" class="anchor"></span>' % self.sid(g))
            return i
        if name in ("url", "path"):
            g, i = read_group(s, i)
            u = (g or "").strip()
            out.append('<a href="%s">%s</a>' % (html.escape(u, quote=True), html.escape(u)))
            return i
        if name == "href":
            u, i = read_group(s, i)
            g, i = read_group(s, i)
            out.append('<a href="%s">%s</a>' % (html.escape((u or "").strip(), quote=True), self.convert_inline(g or "")))
            return i
        if name == "doi":
            g, i = read_group(s, i)
            u = (g or "").strip()
            out.append('<a href="https://doi.org/%s">doi:%s</a>' % (html.escape(u, quote=True), html.escape(u)))
            return i
        if name == "hyperref":
            o, i = read_opt(s, i)
            g, i = read_group(s, i)
            if o:
                out.append('<a href="#%s">%s</a>' % (self.sid(o), self.convert_inline(g or "")))
            else:
                _, i = read_group(s, i)
                _, i = read_group(s, i)
                g2, i = read_group(s, i)
                out.append(self.convert_inline(g2 or g or ""))
            return i
        if name in ("hyperlink", "hypertarget"):
            _, i = read_group(s, i)
            g, i = read_group(s, i)
            out.append(self.convert_inline(g or ""))
            return i
        if name == "includegraphics":
            o, i = read_opt(s, i)
            g, i = read_group(s, i)
            out.append(self.image_html((g or "").strip(), o or ""))
            return i
        if name == "ensuremath":
            g, i = read_group(s, i)
            out.append(self.math(g or "", False))
            return i
        if name in ("verb", "lstinline"):
            if name == "lstinline":
                _, i = read_opt(s, i)
            if s[i:i + 1] == "*":
                i += 1
            if s[i:i + 1] == "{":
                g, i = read_group(s, i)
            else:
                d = s[i:i + 1]
                e = s.find(d, i + 1)
                g = s[i + 1:e]
                i = e + 1
            out.append("<code>%s</code>" % html.escape(g or ""))
            return i
        if name == "today":
            out.append(datetime.date.today().strftime("%B %d, %Y").replace(" 0", " "))
            return i
        if name in SYMBOLS:
            out.append(SYMBOLS[name])
            return i
        if name in ACCENTS and name.isalpha():
            a, i = read_arg(s, i)
            out.append(self.accent(name, a))
            return i
        if name in ("hspace", "hskip", "kern", "vskip", "vspace"):
            if s[i:i + 1] == "*":
                i += 1
            g, j = read_group(s, i)
            if g is not None:
                i = j
            else:
                m = re.match(r"\s*=?\s*-?[\d.]+\s*(pt|em|ex|cm|mm|in|bp|pc|sp|dd|mu|\\[A-Za-z]+)"
                             r"(\s*(plus|minus)\s*-?[\d.]+\s*\w+)*", s[i:])
                if m:
                    i += m.end()
            if name in ("hspace", "hskip"):
                out.append(" ")
            return i
        if name in IGNORE1 or full in IGNORE1:
            _, i = read_opt(s, i)
            _, i = read_group(s, i)
            return i
        if name in IGNORE2:
            _, i = read_group(s, i)
            _, i = read_group(s, i)
            return i
        if name in ("makebox", "framebox"):
            _, i = read_opt(s, i)
            _, i = read_opt(s, i)
            g, i = read_group(s, i)
            out.append(self.convert_inline(g or ""))
            return i
        if name in ("parbox", "raisebox", "scalebox", "textcolor", "colorbox", "rotatebox", "foreignlanguage"):
            _, i = read_opt(s, i)
            _, i = read_group(s, i)
            _, i = read_opt(s, i)
            g, i = read_group(s, i)
            out.append(self.convert_inline(g or ""))
            return i
        if name == "resizebox":
            _, i = read_group(s, i)
            _, i = read_group(s, i)
            g, i = read_group(s, i)
            out.append(self.convert_inline(g or ""))
            return i
        if name == "caption":
            _, i = read_opt(s, i)
            g, i = read_group(s, i)
            out.append(self.convert_inline(g or ""))
            return i
        if name in ("par", "item"):
            out.append(" ")
            return i
        m = self.DEF_RE.match(s, i - len(name) - 1 - len(star))
        if m:
            return max(self.parse_definition(s, m), i)
        if name in ("title", "author", "date", "affiliation", "affil", "address", "institute", "emailAdd",
                    "email", "keywords"):
            return self.meta_command(s, name, i)
        if name == "begin":
            env, j = read_group(s, i)
            env = (env or "").strip()
            try:
                end, after = env_end(s, j, env)
            except ParseError:
                self.warn("\\begin{%s} without \\end{%s}" % (env, env))
                return j
            body = s[j:end]
            if env == "math":
                out.append(self.math(body, False))
            elif env in SIZES or env in DECLS:
                out.append(self.convert_inline(body))
            else:
                blocks = self.convert_block("\\begin{%s}%s\\end{%s}" % (env, body, env))
                out.append("".join(blocks))
            return after
        if name == "end":
            _, i = read_group(s, i)
            return i
        self.warn("unknown command \\%s (its argument is kept as text)" % name)
        g, j = read_group(s, i, newlines=False)
        if g is not None:
            out.append(self.convert_inline(g))
            return j
        return i

    # ------------------------------------------------------------------ images
    def image_html(self, name, opts):
        path = None
        dirs = [self.srcdir] + [(self.srcdir / d).resolve() for d in self.graphicspath]
        for d in dirs:
            for ext in ("", ".pdf", ".png", ".jpg", ".jpeg", ".svg", ".eps", ".gif"):
                p = d / (name + ext)
                if p.is_file():
                    path = p
                    break
            if path:
                break
        if path is None:
            self.warn("image not found: %s" % name)
            return '<span class="omitted">[missing image: %s]</span>' % html.escape(name)
        if path in self.image_cache:
            data, mime, natural = self.image_cache[path]
        else:
            data, mime, natural = self.load_image(path)
            self.image_cache[path] = (data, mime, natural)
        if data is None:
            return '<span class="omitted">[image: %s]</span>' % html.escape(path.name)
        style = ""
        o = dict((k.strip(), v.strip()) for k, v in re.findall(r"([A-Za-z]+)\s*=\s*([^,]+)", opts))
        w = o.get("width")
        if w:
            m = re.match(r"([\d.]*)\s*\\(textwidth|linewidth|columnwidth|hsize|paperwidth)", w)
            if m:
                style = "width:%g%%" % (100 * float(m.group(1) or 1))
            elif re.match(r"[\d.]+\s*(cm|mm|in|pt|bp|em|ex|px)$", w):
                style = "width:%s" % w.replace(" ", "").replace("bp", "pt")
        elif "scale" in o and natural:
            try:
                style = "width:%dpx" % round(natural * float(o["scale"]))
            except ValueError:
                pass
        elif natural:
            style = "width:%dpx" % round(natural)
        b64 = base64.b64encode(data).decode()
        return '<img src="data:%s;base64,%s" alt=""%s>' % (mime, b64, (' style="%s"' % style) if style else "")

    def load_image(self, path):
        suf = path.suffix.lower()
        try:
            if suf in (".png", ".jpg", ".jpeg", ".gif", ".svg"):
                data = path.read_bytes()
                mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                        ".gif": "image/gif", ".svg": "image/svg+xml"}[suf]
                sz = png_size(data)
                return data, mime, (sz[0] * 96 / 144 if sz else None)
            if suf == ".eps":
                pdf = self.build / (path.stem + "-eps.pdf")
                subprocess.run(["epstopdf", str(path), "--outfile=" + str(pdf)], capture_output=True, timeout=120)
                if not pdf.exists():
                    self.warn("could not convert %s (epstopdf failed)" % path.name)
                    return None, None, None
                path, suf = pdf, ".pdf"
            if suf == ".pdf":
                dpi = 200
                prefix = self.build / ("img-%d" % len(self.image_cache))
                png = Path(str(prefix) + ".png")
                if shutil.which("pdftoppm"):
                    subprocess.run(["pdftoppm", "-png", "-r", str(dpi), "-f", "1", "-l", "1", "-singlefile",
                                    str(path), str(prefix)], capture_output=True, timeout=300)
                elif shutil.which("sips"):
                    dpi = 72
                    subprocess.run(["sips", "-s", "format", "png", str(path), "--out", str(png)],
                                   capture_output=True, timeout=300)
                if not png.exists():
                    self.warn("could not convert %s (install poppler's pdftoppm)" % path.name)
                    return None, None, None
                data = png.read_bytes()
                sz = png_size(data)
                return data, "image/png", (sz[0] * 96 / dpi if sz else None)
        except (OSError, subprocess.SubprocessError) as e:
            self.warn("could not read image %s: %s" % (path.name, e))
            return None, None, None
        self.warn("unsupported image type: %s" % path.name)
        return None, None, None

    # ------------------------------------------------------------------ block helpers
    def pop_footnotes(self):
        """Footnotes are collected for the notes list at the end (the page shows them in a sheet)."""
        self.all_fn.extend(self.pending_fn)
        self.pending_fn.clear()
        return []

    def notes_html(self):
        if not self.all_fn:
            return ""
        items = "".join('<li id="fn%d"><a class="fnback" href="#fnref%d" aria-label="Back to the text">%d</a>'
                        '<div class="fn-text">%s</div></li>' % (n, n, n, h) for n, h in self.all_fn)
        return ('<section class="footnotes" aria-labelledby="notes-h"><h2 id="notes-h">Notes</h2>'
                '<ol class="fnlist">%s</ol></section>' % items)

    def display_html(self, tex, number, ids, multi=False):
        ids = [k for k in ids if not k.startswith(AUTO)]
        idattr = (' id="%s"' % self.sid(ids[0])) if ids else ""
        anchors = "".join('<span id="%s" class="anchor"></span>' % self.sid(k) for k in ids[1:])
        eqno = ('<span class="eqno">(%s)</span>' % number) if number else ""
        cls = "display multi" if multi else "display"
        return '<div class="%s"%s>%s<div class="eqbody">%s</div>%s</div>' % (cls, idattr, anchors,
                                                                           self.math(tex, True), eqno)

    def math_env_html(self, env, body):
        base = env.rstrip("*")
        starred = env.endswith("*")
        ids = re.findall(r"\\label\s*\{([^}]*)\}", body)
        if base in ("equation", "displaymath", "math", "multline"):
            numbered = not starred and base in ("equation", "multline") and bool(ids)
            num = None
            tex = body
            if numbered:
                num = self.number_html(ids[0])
                tex = re.sub(r"\\tag\*?\s*\{[^}]*\}", "", tex)
            tex = self.nonum_re().sub("", tex)
            if base == "multline":
                rows = [r.strip() for r in split_top(tex, ROW_SEP) if r.strip()]
                tex = "\\begin{aligned}%s\\end{aligned}" % "\\\\".join(
                    ("&" if k == 0 else "&\\qquad ") + r for k, r in enumerate(rows))
            return self.display_html(tex, num, ids)
        arg = ""
        if base in ("alignat", "xalignat", "xxalignat"):
            g, k = read_group(body, 0)
            arg = "{%s}" % g
            body = body[k:]
        rows = []
        pending = []
        for row, sep in split_top_keep(body, ROW_SEP):
            labs = re.findall(r"\\label\s*\{([^}]*)\}", row)
            nonum = bool(self.nonum_re().search(row))
            clean = self.nonum_re().sub("", row)
            if not starred and (nonum or not row.strip()):
                pending += labs
            elif not starred:
                labs = pending + labs
                pending = []
                if labs:
                    num = self.number(labs[0]) or "??"
                    clean = re.sub(r"\\tag\*?\s*\{[^}]*\}", "", clean)
                    clean = clean.rstrip() + " \\tag{%s}" % num
            rows.append(clean + sep)
        mj_env = {"xalignat": "alignat", "xxalignat": "alignat"}.get(base, base)
        tex = "\\begin{%s*}%s%s\\end{%s*}" % (mj_env, arg, "".join(rows), mj_env)
        return self.display_html(tex, None, ids, multi=True)

    @staticmethod
    def insert_head(blocks, head):
        for k, b in enumerate(blocks):
            if b.startswith("<p"):
                j = b.index(">") + 1
                blocks[k] = b[:j] + head + " " + b[j:]
                return blocks
        return ["<p>%s</p>" % head] + blocks

    @staticmethod
    def append_qed(blocks):
        for k in range(len(blocks) - 1, -1, -1):
            if blocks[k].startswith("<p"):
                j = blocks[k].rindex("</p>")
                blocks[k] = blocks[k][:j] + '<span class="qed" aria-label="end of proof">\u220e</span>' + blocks[k][j:]
                return blocks
        return blocks + ['<p><span class="qed" aria-label="end of proof">\u220e</span></p>']

    def thm_html(self, env, info, body):
        opt, k = read_opt(body, 0)
        inner = body[k:]
        labs = []
        while True:
            m = re.match(r"\s*\\label\s*\{([^}]*)\}", inner)
            if not m:
                break
            labs.append(m.group(1))
            inner = inner[m.end():]
        name = self.convert_inline(info["title"])
        head = '<span class="thm-name">%s' % name
        if info["numbered"] and labs:
            head += " " + self.number_html(labs[0])
        head += "</span>"
        if opt:
            head += ' <span class="thm-opt">(%s)</span>' % self.convert_inline(opt)
        head += "."
        blocks = self.insert_head(self.convert_block(inner), head)
        cls = {"plain": "thm", "definition": "defn", "remark": "remark"}.get(info["style"], "thm")
        user = [l for l in labs if not l.startswith(AUTO)]
        idattr = (' id="%s"' % self.sid(user[0])) if user else ""
        return '<div class="%s"%s>%s</div>' % (cls, idattr, "".join(blocks))

    def proof_html(self, body):
        opt, k = read_opt(body, 0)
        head = '<em class="proof-head">%s.</em>' % (self.convert_inline(opt) if opt else "Proof")
        blocks = self.append_qed(self.insert_head(self.convert_block(body[k:]), head))
        return '<div class="proof">%s</div>' % "".join(blocks)

    def list_html(self, env, body):
        _, k = read_opt(body, 0)
        pieces = split_top(body[k:], r"\\item(?![A-Za-z])")
        items = []
        for it in pieces[1:]:
            label, j = read_opt(it, 0)
            blocks = self.convert_block(it[j:])
            items.append((label, blocks))
        if env.startswith("description") or env == "compactdesc":
            parts = []
            for label, blocks in items:
                parts.append("<dt>%s</dt><dd>%s</dd>" % (self.convert_inline(label or ""), "".join(blocks)))
            return '<dl class="desc">%s</dl>' % "".join(parts)
        tag = "ol" if "enum" in env else "ul"
        lis = []
        for label, blocks in items:
            if label is not None:
                blocks = self.insert_head(blocks, '<span class="item-label">%s</span>' % self.convert_inline(label))
                lis.append('<li style="list-style:none">%s</li>' % "".join(blocks))
            else:
                lis.append("<li>%s</li>" % "".join(blocks))
        return "<%s>%s</%s>" % (tag, "".join(lis), tag)

    @staticmethod
    def parse_colspec(spec):
        aligns = []
        i = 0
        while i < len(spec):
            c = spec[i]
            if c in "lcrS":
                aligns.append({"l": "left", "c": "center", "r": "right", "S": "center"}[c])
            elif c in "pmbX":
                aligns.append("left")
                if i + 1 < len(spec) and spec[i + 1] == "{":
                    i = match_brace(spec, i + 1) - 1
            elif c in "@!><":
                if i + 1 < len(spec) and spec[i + 1] == "{":
                    i = match_brace(spec, i + 1) - 1
            elif c == "*":
                try:
                    g1, j = read_group(spec, i + 1)
                    g2, j = read_group(spec, j)
                    aligns.extend(Converter.parse_colspec(g2) * int(g1))
                    i = j - 1
                except (ValueError, ParseError, TypeError):
                    pass
            i += 1
        return aligns

    def tabular_html(self, env, body):
        k = 0
        if env in ("tabular*", "tabularx", "tabulary"):
            _, k = read_group(body, k)
        _, k = read_opt(body, k)
        spec, k = read_group(body, k)
        aligns = self.parse_colspec(spec or "")
        rows = split_top(body[k:], r"\\\\\*?(?:\s*\[[^\]]*\])?|\\tabularnewline(?![A-Za-z])")
        parsed = []
        pending = None
        header_end = None
        toprule = False
        rule_re = re.compile(r"\s*\\(hline|toprule|midrule|bottomrule|cline|cmidrule|specialrule|addlinespace|"
                             r"hdashline|Xhline|endhead|endfirsthead|endfoot|endlastfoot)(?![A-Za-z])")
        for r in rows:
            while True:
                m = rule_re.match(r)
                if not m:
                    break
                cmd = m.group(1)
                r = r[m.end():]
                if cmd in ("cline", "Xhline"):
                    _, j = read_group(r, 0)
                    r = r[j:]
                elif cmd == "cmidrule":
                    r = re.sub(r"^\s*\([^)]*\)", "", r)
                    _, j = read_group(r, 0)
                    r = r[j:]
                elif cmd == "specialrule":
                    for _ in range(3):
                        _, j = read_group(r, 0)
                        r = r[j:]
                elif cmd == "addlinespace":
                    _, j = read_opt(r, 0)
                    r = r[j:]
                if cmd in ("toprule", "bottomrule", "Xhline", "specialrule"):
                    pending = "rule-thick"
                elif cmd in ("hline", "midrule", "hdashline"):
                    pending = pending or "rule"
                    if cmd == "midrule" and toprule and header_end is None:
                        header_end = len(parsed)
                if cmd == "toprule":
                    toprule = True
            if not r.strip():
                continue
            parsed.append((split_top(r, r"&"), pending))
            pending = None
        end_rule = pending
        trs = []
        for ri, (cells, rule) in enumerate(parsed):
            tag = "th" if header_end is not None and ri < header_end else "td"
            classes = []
            if rule:
                classes.append(rule)
            if ri == len(parsed) - 1 and end_rule:
                classes.append("rule-end" if end_rule == "rule-thick" else "rule-end-thin")
            tds = []
            col = 0
            for cell in cells:
                cell = cell.strip()
                span = 1
                align = aligns[col] if col < len(aligns) else "left"
                m = re.match(r"\\multicolumn\s*\{(\d+)\}", cell)
                if m:
                    span = int(m.group(1))
                    cs, j = read_group(cell, m.end())
                    content, j = read_group(cell, j)
                    a = self.parse_colspec(cs or "")
                    if a:
                        align = a[0]
                    cell = content or ""
                cell = re.sub(r"^\\multirow\s*\{[^}]*\}\s*(\[[^\]]*\])?\s*\{[^}]*\}", "", cell)
                attrs = ""
                if span > 1:
                    attrs += ' colspan="%d"' % span
                if align != "left":
                    attrs += ' style="text-align:%s"' % align
                tds.append("<%s%s>%s</%s>" % (tag, attrs, self.convert_inline(cell), tag))
                col += span
            cl = (' class="%s"' % " ".join(classes)) if classes else ""
            trs.append("<tr%s>%s</tr>" % (cl, "".join(tds)))
        if header_end:
            html_rows = "<thead>%s</thead><tbody>%s</tbody>" % ("".join(trs[:header_end]), "".join(trs[header_end:]))
        else:
            html_rows = "<tbody>%s</tbody>" % "".join(trs)
        return '<div class="table-wrap"><table>%s</table></div>' % html_rows

    def float_html(self, env, body):
        kind = "table" if "table" in env else "figure"
        k = 0
        _, k = read_opt(body, k)
        if env.startswith("wrap"):
            _, k = read_opt(body, k)
            _, k = read_group(body, k)
            _, k = read_group(body, k)
        if env in ("subfigure", "subtable"):
            _, k = read_group(body, k)
        body = body[k:]
        ids = [x for x in re.findall(r"\\label\s*\{([^}]*)\}", body) if not x.startswith(AUTO)]
        pieces = split_top(body, r"\\caption(?![A-Za-z])")
        blocks = self.convert_block(pieces[0])
        cap_ids = []
        for seg in pieces[1:]:
            if seg.startswith("*"):
                seg = seg[1:]
            _, j = read_opt(seg, 0)
            cap, j = read_group(seg, j)
            labs = []
            while True:
                m = LABEL_AT.match(seg, j)
                if not m:
                    break
                labs.append(m.group(1))
                j = m.end()
            num = self.number_html(labs[0]) if labs else ""
            cap_ids += labs
            if env in ("subfigure", "subtable"):
                name = "(%s)" % num if num else ""
            else:
                name = ("%s %s." % ("Table" if kind == "table" else "Figure", num)) if num else ""
            blocks.append('<figcaption><span class="capname">%s</span> %s</figcaption>'
                          % (name, self.convert_inline(cap or "")))
            blocks.extend(self.convert_block(seg[j:]))
        key = ids[0] if ids else (cap_ids[0] if cap_ids else None)
        idattr = (' id="%s"' % self.sid(key)) if key else ""
        return ['<figure class="float %s"%s>%s</figure>' % (kind, idattr, "".join(blocks))] + self.pop_footnotes()

    # ---- biblatex .bbl files (\entry ... \endentry)
    def biblatex_entries(self, text):
        k = text.find("\\enddatalist")
        first = text[:k] if k >= 0 else text
        entries = []
        for m in re.finditer(r"\\entry\{([^}]*)\}\{([^}]*)\}", first):
            e = first.find("\\endentry", m.end())
            body = first[m.end():e if e >= 0 else len(first)]
            fields = {}
            for f in re.finditer(r"\\field\{([^}]*)\}", body):
                v, _ = read_group(body, f.end())
                if v is not None:
                    fields.setdefault(f.group(1), v)
            for f in re.finditer(r"\\verb\{([^}]*)\}\s*\\verb\s+(.*?)\s*\\endverb", body, re.S):
                fields.setdefault(f.group(1), f.group(2).strip())
            names = {}
            for nm in re.finditer(r"\\name\{([^}]*)\}\{\d+\}\{[^}]*\}\{", body):
                g, _ = read_group(body, nm.end() - 1)
                people = []
                for person in re.finditer(r"family=\{", g or ""):
                    fam, j = read_group(g, person.end() - 1)
                    chunk = g[j:j + 400]
                    gm = re.search(r"given=\{", chunk)
                    giv = read_group(chunk, gm.end() - 1)[0] if gm else ""
                    pm = re.search(r"prefix=\{", g[max(0, person.start() - 200):person.start()])
                    people.append(((giv or "") + " " + (fam or "")).strip())
                names[nm.group(1)] = people
            entries.append(dict(key=m.group(1), type=m.group(2), f=fields, names=names))
        return entries

    def biblatex_item_html(self, e):
        f, parts = e["f"], []
        people = e["names"].get("author") or e["names"].get("editor") or []
        if people:
            ppl = people if len(people) <= 6 else people[:5] + ["et al."]
            parts.append(", ".join(ppl[:-1]) + (" and " if len(ppl) > 1 else "") + ppl[-1] if len(ppl) > 1 else ppl[0])
        if f.get("title"):
            parts.append("<em>%s</em>" % self.convert_inline(f["title"]))
        venue = f.get("journaltitle") or f.get("booktitle") or f.get("publisher") or ""
        pub = self.convert_inline(venue) if venue else ""
        if f.get("volume"):
            pub += " <strong>%s</strong>" % self.convert_inline(f["volume"])
        year = f.get("year") or (f.get("date", "")[:4])
        if year:
            pub += " (%s)" % year
        if f.get("pages") or f.get("number") and venue:
            pub += " %s" % self.convert_inline(f.get("pages") or f.get("number"))
        if pub.strip():
            parts.append(pub.strip())
        text = ", ".join(parts)
        if f.get("doi"):
            text += ', <a href="https://doi.org/%s">doi:%s</a>' % (html.escape(f["doi"], quote=True), html.escape(f["doi"]))
        if f.get("eprint"):
            text += ' [<a href="https://arxiv.org/abs/%s">arXiv:%s</a>]' % (html.escape(f["eprint"], quote=True), html.escape(f["eprint"]))
        elif f.get("url") and not f.get("doi"):
            text += ', <a href="%s">%s</a>' % (html.escape(f["url"], quote=True), html.escape(f["url"]))
        return text + "."

    def bbl_numbers(self, text):
        """Give citations LaTeX did not number (biblatex, mismatched .bbl) their order in the .bbl."""
        if "\\entry{" in text:
            keys = [e["key"] for e in self.biblatex_entries(text)]
        else:
            keys = [re.sub(r"\s", "", k) for k in re.findall(r"\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}", text)]
        for n, k in enumerate(keys, 1):
            self.bibcite.setdefault(k, dict(num=str(n)))

    def bibliography_html(self, text):
        if "\\entry{" in text:
            items = []
            for e in self.biblatex_entries(text):
                label = self.convert_inline(self.bibcite.get(e["key"], {}).get("num", ""))
                items.append('<li id="%s">%s<span class="reftext">%s</span></li>' % (
                    self.sid("cite:" + e["key"]), ('<span class="refnum">[%s]</span>' % label) if label else "",
                    self.biblatex_item_html(e)))
            return ('<section class="references" aria-labelledby="refs-h"><h2 id="refs-h">References</h2>'
                    '<ol class="refs">%s</ol></section>' % "".join(items))
        m = re.search(r"\\begin\{thebibliography\}", text)
        if not m:
            return ""
        body = text[m.end():]
        _, j = read_group(body, 0)
        body = body[j:]
        e = body.find("\\end{thebibliography}")
        if e >= 0:
            body = body[:e]
        items = []
        for it in split_top(body, r"\\bibitem(?![A-Za-z])")[1:]:
            opt, j = read_opt(it, 0)
            key, j = read_group(it, j)
            if key is None:
                continue
            txt = it[j:]
            txt = re.sub(r"\\penalty-?\d+", "", txt)
            txt = re.sub(r"\\(newblock|urlprefix|BibitemOpen|bibAnnoteFile|natexlab)(?![A-Za-z])", " ", txt)
            txt = re.sub(r"\\BibitemShut\s*\{[^}]*\}", "", txt)
            txt = re.sub(r"\\(bibinfo|bibfield)\s*\{[^}]*\}", "", txt)
            txt = re.sub(r"\\(bibnamefont|bibfnamefont|citenamefont|href@noop)(?![A-Za-z])", "", txt)
            txt = re.sub(r"\\Eprint\s*\{([^}]*)\}\s*\{([^}]*)\}", r"\\href{\1}{\2}", txt)
            key = key.strip()
            bc = self.bibcite.get(key, {})
            label = None
            if "short" not in bc and bc.get("num"):
                label = self.convert_inline(bc["num"])
            elif "short" not in bc and opt:
                label = self.convert_inline(opt)
            items.append('<li id="%s">%s<span class="reftext">%s</span></li>'
                         % (self.sid("cite:" + key),
                            ('<span class="refnum">[%s]</span>' % label) if label else "",
                            self.convert_inline(txt.strip())))
        return ('<section class="references" aria-labelledby="refs-h"><h2 id="refs-h">References</h2>'
                '<ol class="refs">%s</ol></section>' % "".join(items))

    # ------------------------------------------------------------------ blocks
    BLOCK_CMD = re.compile(r"\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)(?![A-Za-z])")

    def heading_html(self, cmd, star, s, i):
        _, i = read_opt(s, i)
        title, i = read_group(s, i)
        labs = []
        while True:
            m = LABEL_AT.match(s, i)
            if not m:
                break
            labs.append(m.group(1))
            i = m.end()
        th = self.convert_inline(title or "")
        num = self.number_html(labs[0]) if (labs and not star) else ""
        user = [l for l in labs if not l.startswith(AUTO)]
        if user:
            hkey = user[0]
        elif num:
            hkey = "section-" + plain_text(num)
        else:
            hkey = re.sub(r"[^a-z0-9]+", "-", plain_text(title or "").lower()).strip("-") or "section"
        hid = self.sid(hkey)
        if cmd == "part":
            tag, toc = "h2", 1
            num = ("Part " + num) if num else ""
        elif cmd == "chapter":
            tag, toc = "h2", 1
        elif cmd == "section":
            tag, toc = ("h3", 2) if self.have_chapters else ("h2", 1)
        elif cmd == "subsection":
            tag, toc = ("h4", 3) if self.have_chapters else ("h3", 2)
        else:
            tag, toc = ("h5", 4) if self.have_chapters else ("h4", 3)
        if toc <= 2:
            self.headings.append((toc, num, th, hid))
        cls = ' class="part"' if cmd == "part" else ""
        numh = ('<span class="secnum">%s</span> ' % num) if num else ""
        return '<%s id="%s"%s>%s%s</%s>' % (tag, hid, cls, numh, th, tag), i

    def convert_block(self, s):
        out = []
        para = []
        state = {"cont": False}

        def flush():
            text = "".join(para).strip()
            if text:
                h = self.convert_inline(text).strip()
                if h:
                    self.just_titled = False
                    cls = ' class="cont"' if state["cont"] else ""
                    out.append("<p%s>%s</p>" % (cls, h))
                out.extend(self.pop_footnotes())
            para.clear()
            state["cont"] = False

        i = 0
        n = len(s)
        while i < n:
            c = s[i]
            if c == "\n":
                m = BLANK_RE.match(s, i)
                if m:
                    flush()
                    i = m.end()
                    continue
                para.append(c)
                i += 1
                continue
            if c == "$":
                if s.startswith("$$", i):
                    j = s.find("$$", i + 2)
                    j = n if j < 0 else j
                    if "".join(para).strip():
                        flush()
                    out.append(self.display_html(s[i + 2:j], None, []))
                    state["cont"] = True
                    i = j + 2
                    continue
                j = i + 1
                while j < n and s[j] != "$":
                    j += 2 if s[j] == "\\" else 1
                para.append(s[i:j + 1])
                i = j + 1
                continue
            if c == "{":
                try:
                    k = match_brace(s, i)
                except ParseError:
                    k = n
                para.append(s[i:k])
                i = k
                continue
            if c != "\\":
                para.append(c)
                i += 1
                continue
            # backslash
            if s.startswith("\\(", i):
                j = s.find("\\)", i + 2)
                j = n if j < 0 else j + 2
                para.append(s[i:j])
                i = j
                continue
            if s.startswith("\\[", i):
                j = s.find("\\]", i + 2)
                j = n if j < 0 else j
                if "".join(para).strip():
                    flush()
                out.append(self.display_html(s[i + 2:j], None, []))
                state["cont"] = True
                i = j + 2
                continue
            m = CMD_RE.match(s, i)
            if not m:
                para.append(s[i:i + 2])
                i += 2
                continue
            name, star = m.group(1), m.group(2)
            j = m.end()
            if name == "verb" or name == "lstinline":
                k = j
                if name == "lstinline":
                    _, k = read_opt(s, k)
                if s[k:k + 1] == "*":
                    k += 1
                if s[k:k + 1] == "{":
                    k = match_brace(s, k)
                else:
                    e = s.find(s[k:k + 1], k + 1)
                    k = n if e < 0 else e + 1
                para.append(s[i:k])
                i = k
                continue
            if name == "par":
                flush()
                i = j
                continue
            if name == "begin":
                env, k = read_group(s, j)
                env = (env or "").strip()
                try:
                    end, after = env_end(s, k, env)
                except ParseError:
                    self.warn("\\begin{%s} without \\end{%s}" % (env, env))
                    i = k
                    continue
                body = s[k:end]
                blocks, inline_cont = self.block_env(env, body)
                if blocks is None:
                    para.append(s[i:after])
                    i = after
                    continue
                if "".join(para).strip():
                    flush()
                elif not blocks:
                    pass
                out.extend(blocks)
                state["cont"] = inline_cont
                i = after
                continue
            mm = self.BLOCK_CMD.match(s, i)
            if mm:
                cmd = mm.group(1)
                flush()
                self.just_titled = False
                if cmd in ("paragraph", "subparagraph"):
                    _, k = read_opt(s, j)
                    title, k = read_group(s, k)
                    while True:
                        lm = LABEL_AT.match(s, k)
                        if not lm:
                            break
                        k = lm.end()
                    para.append("\\lmobilerunin{%s}" % (title or ""))
                    i = k
                    continue
                h, k = self.heading_html(cmd, star, s, j)
                out.append(h)
                i = k
                continue
            if name == "appendix":
                flush()
                i = j
                continue
            if name in ("acknowledgments", "acknowledgements", "acknowledgment", "acknowledgement"):
                flush()
                hid = self.sid("acknowledgments")
                self.headings.append((2 if self.have_chapters else 1, "", "Acknowledgments", hid))
                out.append('<h2 id="%s">Acknowledgments</h2>' % hid)
                i = j
                continue
            if name == "maketitle":
                flush()
                out.append("\x00TITLE\x00")
                self.title_done = True
                self.just_titled = True
                i = j
                continue
            if name in ("bibliography", "printbibliography"):
                flush()
                _, k = read_opt(s, j)
                if name == "bibliography":
                    _, k = read_group(s, k)
                out.append("\x00BIB\x00")
                i = k
                continue
            if name in ("title", "author", "date", "affiliation", "affil", "address", "institute", "emailAdd",
                        "email", "keywords", "thanks"):
                i = self.meta_command(s, name, j)
                continue
            if name == "abstract" and s[j:j + 1] in "{ \n\t":
                g, k = read_group(s, j)
                if g is not None:
                    self.meta["abstract"] = g
                    i = k
                    continue
            dm = self.DEF_RE.match(s, i)
            if dm:
                i = max(self.parse_definition(s, dm), dm.end())
                continue
            if name == "item":
                self.warn("\\item outside a list, near: " + re.sub(r"\s+", " ", s[max(0, i - 80):i])[-60:])
                flush()
                i = j
                continue
            para.append(s[i:j])
            i = j
        flush()
        return out

    def block_env(self, env, body):
        """Return (list of html blocks, whether following text continues the paragraph).
        (None, False) means: treat the environment as inline text."""
        base = env.rstrip("*")
        if env in VERB_ENVS:
            if env == "comment":
                return [], False
            b = body
            if env == "lstlisting":
                _, k = read_opt(b, 0)
                b = b[k:]
            if env == "minted":
                _, k = read_opt(b, 0)
                _, k = read_group(b, k)
                b = b[k:]
            return ["<pre><code>%s</code></pre>" % html.escape(b.strip("\n"))], False
        if env == "math":
            return None, False
        if env in SINGLE_MATH or base in ROW_MATH:
            return [self.math_env_html(env, body)], True
        if env in self.env_defs and env not in self.NATIVE_ENVS:
            d = self.env_defs[env]
            args = []
            k = 0
            if d["nargs"]:
                if d["default"] is not None:
                    o, k2 = read_opt(body, k)
                    args.append(d["default"] if o is None else o)
                    if o is not None:
                        k = k2
                while len(args) < d["nargs"]:
                    a, k = read_arg(body, k)
                    args.append(a or "")
            begin = d["begin"]
            for n_ in range(len(args), 0, -1):
                begin = begin.replace("#%d" % n_, args[n_ - 1])
            return self.convert_block(begin + body[k:] + d["end"]), False
        info = self.thm_info(env)
        if info:
            return [self.thm_html(env, info, body)] + self.pop_footnotes(), False
        if env == "proof":
            return [self.proof_html(body)] + self.pop_footnotes(), False
        if env in LISTS:
            return [self.list_html(env, body)] + self.pop_footnotes(), True
        if env in TABULARS:
            return [self.tabular_html(env, body)] + self.pop_footnotes(), True
        if env == "array":
            return None, False
        if env in FLOATS:
            return self.float_html(env, body), False
        if env in ("center", "centering"):
            return ['<div class="center">%s</div>' % "".join(self.convert_block(body))], False
        if env in ("flushright", "raggedleft"):
            return ['<div class="flushright">%s</div>' % "".join(self.convert_block(body))], False
        if env in ("flushleft",):
            return self.convert_block(body), False
        if env in ("quote", "quotation", "verse"):
            return ["<blockquote>%s</blockquote>" % "".join(self.convert_block(body))], False
        if env == "abstract":
            if not self.title_done or self.just_titled:
                self.meta["abstract"] = body
                return [], False
            return ['<section class="abstract"><h2>Abstract</h2>%s</section>' % "".join(self.convert_block(body))], False
        if env in ("acknowledgments", "acknowledgements", "acknowledgment", "acknowledgement"):
            hid = self.sid("acknowledgments")
            self.headings.append((2 if self.have_chapters else 1, "", "Acknowledgments", hid))
            return ['<h2 id="%s">Acknowledgments</h2>' % hid] + self.convert_block(body), False
        if env == "thebibliography":
            return [self.bibliography_html("\\begin{thebibliography}" + body + "\\end{thebibliography}")], False
        if env in PICTURES:
            self.warn("%s environments are not rendered (placeholder shown)" % env)
            return ['<div class="omitted">[%s omitted in the HTML version]</div>' % html.escape(env)], False
        if env == "minipage":
            _, k = read_opt(body, 0)
            _, k = read_opt(body, k)
            _, k = read_opt(body, k)
            _, k = read_group(body, k)
            return self.convert_block(body[k:]), False
        if env in ("multicols", "multicols*", "spacing", "adjustbox", "otherlanguage", "hyphenrules"):
            _, k = read_group(body, 0)
            return self.convert_block(body[k:]), False
        if env in TRANSPARENT:
            return self.convert_block(body), False
        self.warn("unknown environment %s (its content is kept)" % env)
        return self.convert_block(body), False

    # ------------------------------------------------------------------ title block
    def title_block(self):
        m = self.meta
        if not (m["title"] or m["authors"] or m["abstract"]):
            return ""
        parts = ['<header class="titleblock">']
        parts.append('<l2m-slot name="settings"></l2m-slot><l2m-slot name="kicker"></l2m-slot>')
        title = self.args.title or m["title"]
        if title:
            parts.append("<h1>%s</h1>" % (html.escape(title) if self.args.title else self.convert_inline(title)))
        parts.append('<div class="titlemeta">')
        if m["authors"]:
            names = []
            for a in m["authors"]:
                ah = self.convert_inline(a).strip()
                names.append(ah)
            joined = ""
            for k, a in enumerate(names):
                if k == 0:
                    joined = a
                elif re.match(r"(and|&amp;)\s", re.sub(r"<[^>]+>", "", a)):
                    joined += " " + a
                else:
                    joined += ", " + a
            parts.append('<p class="authors">%s</p>' % joined)
        for a in m["affil"]:
            parts.append('<p class="affil">%s</p>' % self.convert_inline(a))
        for e in m["email"]:
            parts.append('<p class="email">%s</p>' % self.convert_inline(e))
        if m["date"] and m["date"].strip():
            parts.append('<p class="date">%s</p>' % self.convert_inline(m["date"]))
        for t in m["thanks"]:
            parts.append('<p class="thanks">%s</p>' % self.convert_inline(t))
        parts.append("</div>")
        if m["abstract"]:
            parts.append('<section class="abstract" aria-labelledby="abstract-h"><h2 id="abstract-h">Abstract</h2>%s</section>'
                         % "".join(self.convert_block(m["abstract"])))
        if m["keywords"]:
            parts.append('<p class="keywords"><strong>Keywords:</strong> %s</p>' % self.convert_inline(m["keywords"]))
        parts.append("\x00TOC\x00")
        parts.append("</header>")
        return "".join(parts)

    def toc_html(self):
        if len(self.headings) < 2:
            return ""
        toc = []
        open_sub = False
        top = min(h[0] for h in self.headings)
        for level, num, th, hid in self.headings:
            link = '<a href="#%s"><span class="tocnum">%s</span>%s</a>' % (hid, num, th)
            if level == top:
                if open_sub:
                    toc.append("</ol></li>")
                toc.append("<li>%s<ol>" % link)
                open_sub = True
            else:
                toc.append("<li>%s</li>" % link)
        if open_sub:
            toc.append("</ol></li>")
        inner = "".join(toc).replace("<ol></ol>", "")
        return '<details class="toc"><summary>Contents</summary><ol>%s</ol></details>' % inner

    # ------------------------------------------------------------------ main
    def run(self):
        text = strip_comments(self.src.read_text(errors="replace"))
        text = self.inline_inputs(text, self.srcdir)
        text = re.sub(r"\\iffalse(?![A-Za-z]).*?\\fi(?![A-Za-z])", "", text, flags=re.S)
        b = text.find("\\begin{document}")
        e = text.rfind("\\end{document}")
        if b < 0:
            sys.exit("latex2mobile: no \\begin{document} found")
        pre = text[:b]
        body = text[b + len("\\begin{document}"):(e if e > b else len(text))]
        self.parse_preamble(pre)
        # aliases of definition commands, e.g. \let\newc\newcommand or \def\nc{\newcommand}
        defcmds = {"\\newcommand", "\\renewcommand", "\\providecommand", "\\def", "\\DeclareMathOperator"}
        aliases = {k: d["body"].strip() for k, d in self.macros.items() if d["body"].strip() in defcmds}
        pre_c, body_c = pre, body      # what LaTeX compiles: the author's source, untouched apart from labels
        if aliases:
            pat = re.compile(r"\\(%s)(?![A-Za-z@])" % "|".join(map(re.escape, aliases)))
            self.parse_preamble(pat.sub(lambda m: aliases[m.group(1)], pre))
            body = pat.sub(lambda m: aliases[m.group(1)], body)
        self.scan_definitions(body)
        body = self.add_auto_labels(self.expand_env_shortcuts(body))
        body_c = self.add_auto_labels(self.expand_env_shortcuts(body_c))
        tmp = None
        if self.args.keep_build:
            self.build = Path(self.args.keep_build).resolve()
            self.build.mkdir(parents=True, exist_ok=True)
        else:
            tmp = tempfile.mkdtemp(prefix="latex2mobile-")
            self.build = Path(tmp)
        try:
            aux, bbl = self.compile(pre_c + "\\begin{document}" + body_c + "\\end{document}\n", "l2mdoc")
            self.parse_aux(aux)
            if bbl:
                self.bbl_numbers(bbl)
            # subequations only affects numbering, which LaTeX already did; authors sometimes let it cross items
            body = re.sub(r"\\(begin|end)\s*\{subequations\}", "", body)
            blocks = self.convert_block(body)
            refs = self.bibliography_html(bbl) if bbl else ""
            titleblock = self.title_block()
            toc = self.toc_html()
            page_body = "\n".join(blocks)
            if "\x00TITLE\x00" in page_body:
                page_body = page_body.replace("\x00TITLE\x00", titleblock, 1).replace("\x00TITLE\x00", "")
            else:
                page_body = titleblock + page_body
            page_body = page_body.replace("\x00TOC\x00", toc)
            if "\x00BIB\x00" in page_body:
                page_body = page_body.replace("\x00BIB\x00", refs, 1).replace("\x00BIB\x00", "")
            elif refs and "thebibliography" not in body:
                page_body += refs
            self.pop_footnotes()
            notes = self.notes_html()
            if notes:
                k = page_body.find('<section class="references"')
                page_body = (page_body[:k] + notes + page_body[k:]) if k >= 0 else page_body + notes
            doc = self.document(page_body)
            folder = Path(self.args.output) if self.args.output else self.src.with_suffix(".l2m")
            cache = None if self.args.no_math else draw_math(doc, self.warn, self.info)
            save_doc(doc, folder, cache)
            self.info("wrote %s (%d formulas, %d footnotes)" % (folder, len(doc["math"]["items"]), len(doc["footnotes"])))
            if self.args.html:
                from l2m_render import bundle
                bundle(doc, cache, Path(self.args.html), artifact=self.args.artifact, info=self.info)
        finally:
            if tmp:
                shutil.rmtree(tmp, ignore_errors=True)
        if self.warnings and not self.args.quiet:
            print("warnings:", file=sys.stderr)
            for msg, count in sorted(self.warnings.items()):
                print("  " + msg + ("  (x%d)" % count if count > 1 else ""), file=sys.stderr)

    def document(self, page_body):
        """Everything the page needs, independent of the viewer: see DOCUMENT.md."""
        def enc(h):
            return re.sub(r"\x00M(\d+)\x00", r'<l2m-math n="\1"></l2m-math>', h)
        body = wrap_greek(enc(page_body))
        if "\x00" in body:
            self.warn("internal: unresolved placeholder in the page")
            body = body.replace("\x00", "")
        macros, packages = self.mathjax_config()
        return {
            "format": DOC_FORMAT, "version": DOC_VERSION, "converter": __version__,
            "source": self.src.name, "engine": self.args.engine,
            "title": self.args.title or plain_text(self.meta["title"] or self.src.stem),
            "authors": [re.sub(r"^(and|&)\s+", "", plain_text(a)) for a in self.meta["authors"]],
            "kicker": self.args.kicker, "lang": self.args.lang,
            "body": body,
            "headings": [{"level": l, "number": n, "html": enc(t), "id": i} for l, n, t, i in self.headings],
            "labels": {k: {"number": v, "id": self.id_map.get(k)}
                       for k, v in self.labels.items() if not k.startswith(AUTO)},
            "footnotes": [{"n": n, "html": enc(h)} for n, h in self.all_fn],
            "math": math_section(self.math_items, macros, packages),
            "warnings": dict(self.warnings),
        }



def draw_math(doc, warn=None, info=None):
    """Draw every formula of a document once with MathJax in node: the math.json cache (see DOCUMENT.md)."""
    m = doc["math"]
    tmp = Path(tempfile.mkdtemp(prefix="latex2mobile-math-"))
    job, res = tmp / "job.json", tmp / "out.json"
    job.write_text(json.dumps({"items": m["items"], "macros": m["macros"], "packages": m["packages"]}))
    if info:
        info("drawing %d formulas ..." % len(m["items"]))
    try:
        r = subprocess.run(["node", str(HERE / "render_math.js"), str(job), str(res)],
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=1200)
    except FileNotFoundError:
        sys.exit("latex2mobile: node not found; install Node.js")
    if r.returncode != 0 or not res.exists():
        sys.exit("latex2mobile: math rendering failed:\n" + r.stdout[-3000:])
    out = json.loads(res.read_text())
    shutil.rmtree(tmp, ignore_errors=True)
    if warn:
        for e in out["errors"]:
            warn("math error: %s  in  %s" % (e["message"], e["tex"][:100].replace("\n", " ")))
        for k in out["undefined"]:
            warn("math uses an undefined macro (shown in red): %s" % m["items"][k]["tex"][:100].replace("\n", " "))
    return {"format": "l2m-math", "version": 1, "key": m.get("key"), "mathjax": mathjax_version(),
            "svg": out["out"], "cache": out["cache"], "css": out["css"]}


def mathjax_version():
    try:
        return json.loads((HERE / "node_modules" / "mathjax-full" / "package.json").read_text())["version"]
    except (OSError, ValueError, KeyError):
        return None


def load_math(folder, doc):
    """The document's math.json, if it was drawn from exactly these formulas."""
    f = Path(folder) / "math.json"
    try:
        c = json.loads(f.read_text())
    except (OSError, ValueError):
        return None
    ok = (c.get("format") == "l2m-math" and c.get("key") and c.get("key") == doc["math"].get("key")
          and len(c.get("svg", [])) == len(doc["math"]["items"]))
    return c if ok else None

def math_section(items, macros, packages):
    """The document's formulas; `key` fingerprints them, so a cache of rendered formulas can be checked."""
    m = {"items": items, "macros": macros, "packages": packages}
    m["key"] = hashlib.sha1(json.dumps(m, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
    return m

IMAGE_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg"}


def save_doc(doc, folder, cache=None):
    """Write the document as FOLDER/paper.json, its images as files in FOLDER/images/, and the drawn
    formulas (if given) as FOLDER/math.json."""
    folder.mkdir(parents=True, exist_ok=True)
    if cache is not None:
        (folder / "math.json").write_text(json.dumps(cache, ensure_ascii=False))
    elif (folder / "math.json").exists():
        (folder / "math.json").unlink()
    (folder / "images").mkdir(exist_ok=True)

    def extract(m):
        mime, data = m.group(1), base64.b64decode(m.group(2))
        name = "%s.%s" % (hashlib.sha1(data).hexdigest()[:16], IMAGE_EXT.get(mime, "bin"))
        (folder / "images" / name).write_bytes(data)
        return 'src="images/%s"' % name

    pat = re.compile(r'src="data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)"')
    doc = dict(doc, body=pat.sub(extract, doc["body"]),
               footnotes=[dict(f, html=pat.sub(extract, f["html"])) for f in doc["footnotes"]])
    (folder / "paper.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1))


def load_doc(path):
    """Read a document written by save_doc (the folder, or its paper.json)."""
    path = Path(path)
    folder = path if path.is_dir() else path.parent
    doc = json.loads((folder / "paper.json" if path.is_dir() else path).read_text())
    if doc.get("format") != DOC_FORMAT:
        sys.exit("latex2mobile: %s is not a latex2mobile document" % path)
    if doc.get("version", 0) > DOC_VERSION:
        sys.exit("latex2mobile: %s uses document version %s; this tool reads up to %d"
                 % (path, doc.get("version"), DOC_VERSION))
    mime = {v: k for k, v in IMAGE_EXT.items()}

    def inline(m):
        f = folder / "images" / m.group(1)
        return 'src="data:%s;base64,%s"' % (mime.get(m.group(2), "application/octet-stream"),
                                            base64.b64encode(f.read_bytes()).decode())

    pat = re.compile(r'src="images/([0-9a-f]{16}\.(\w+))"')
    doc["body"] = pat.sub(inline, doc["body"])
    for f in doc["footnotes"]:
        f["html"] = pat.sub(inline, f["html"])
    return doc


def main():
    ap = argparse.ArgumentParser(description="Convert a LaTeX article into a latex2mobile document (paper.json, "
                                             "figures and drawn formulas), optionally also a one-file HTML page.")
    ap.add_argument("input", help="the main .tex file")
    ap.add_argument("-o", "--output", metavar="DIR", help="the document folder (default: paper.l2m next to paper.tex)")
    ap.add_argument("--html", metavar="FILE", help="also write a one-file page (the same as l2m_render.py DIR -o FILE)")
    ap.add_argument("--artifact", action="store_true",
                    help="with --html: write a page fragment without <html>/<head>/<body>, for a Claude artifact")
    ap.add_argument("--kicker", help='small line above the title, for example "Draft"')
    ap.add_argument("--title", help="override the title")
    ap.add_argument("--engine", default="pdflatex", choices=["pdflatex", "xelatex", "lualatex"],
                    help="LaTeX engine used to obtain the numbering (default: pdflatex)")
    ap.add_argument("--keep-build", metavar="DIR", help="keep the LaTeX build files in DIR (for debugging)")
    ap.add_argument("--no-math", action="store_true",
                    help="do not draw the formulas into math.json (the viewer then draws them in the browser)")
    ap.add_argument("--lang", default="en", help="language code of the paper (default: en)")
    ap.add_argument("--save-doc", metavar="DIR", help=argparse.SUPPRESS)       # older name of -o
    ap.add_argument("-q", "--quiet", action="store_true", help="print nothing but errors")
    args = ap.parse_args()
    # the older command line: -o paper.html wrote the page; keep that working (document next to it)
    if args.output and args.output.endswith((".html", ".htm")):
        args.html = args.html or args.output
        args.output = args.save_doc or str(Path(args.output).with_suffix(".l2m"))
    elif args.save_doc and not args.output:
        args.output = args.save_doc
    Converter(args).run()

if __name__ == "__main__":
    main()
