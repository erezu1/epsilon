"""Harvmac (plain TeX, as many older hep-th papers are written) turned into LaTeX, for Epsilon.

The paper's own definitions are kept (in the preamble); harvmac's commands become their LaTeX counterparts:
\\Title and the centred lines after it (title, authors, affiliations, abstract up to \\Date), \\newsec / \\subsec /
\\subsubsec / \\appendix, \\eqn\\name{...} and $$ ... \\eqno\\eqnn\\name $$ (numbered equations, and \\name after them
a reference to one), \\eqalign{... \\cr ...}, \\lref / \\nref / \\ref and \\refs{\\a, \\b - \\c} (a bibliography, cited
and numbered in harvmac's order), \\foot and plain \\footnote{mark}{text}, \\listrefs, \\bye, and amssym's \\Bbb.
"""
import re

HARVMAC = re.compile(r"^[ \t]*\\input\s+(harvmac|lanlmac)\b", re.M)


def is_harvmac(text):
    return bool(HARVMAC.search(text))


def _strip_comments(t):
    return re.sub(r"(?<!\\)%[^\n]*", "", t)


def _group(s, i):
    """The {...} group starting at i (after spaces): (content, end) or (None, i)."""
    j = i
    while j < len(s) and s[j] in " \t\n":
        j += 1
    if j >= len(s) or s[j] != "{":
        return None, i
    depth, k = 0, j
    while k < len(s):
        c = s[k]
        if c == "\\":
            k += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return s[j + 1:k], k + 1
        k += 1
    return None, i


def _cmd(s, i):
    """A control sequence \\name starting at i (after spaces): (name, end) or (None, i)."""
    m = re.compile(r"\s*\\([A-Za-z]+)").match(s, i)
    return (m.group(1), m.end()) if m else (None, i)


def _each(s, pattern, fn):
    """Replace each match of PATTERN (a regex ending just after the command) by fn(s, match) -> (text, end)."""
    out, i = [], 0
    rx = re.compile(pattern)
    while True:
        m = rx.search(s, i)
        if not m:
            out.append(s[i:])
            return "".join(out)
        rep, end = fn(s, m)
        if rep is None:
            out.append(s[i:m.end()])
            i = m.end()
            continue
        out.append(s[i:m.start()] + rep)
        i = end


def _one_par(t):
    """No blank lines inside a displayed formula (plain TeX lets them pass; LaTeX does not)."""
    return re.sub(r"\n[ \t]*\n+", "\n", t)


def _eqalign(t):
    """\\eqalign{a &= b \\cr c &= d} (and its \\eqalignno) as an aligned block."""
    def fn(s, m):
        g, end = _group(s, m.end())
        if g is None:
            return None, m.end()
        rows = [r.strip() for r in re.split(r"\\cr(?![A-Za-z])", _eqalign(g))]
        rows = [r for r in rows if r]
        return "\\begin{aligned}" + " \\\\ ".join(rows) + "\\end{aligned}", end
    return _each(t, r"\\eqalign(?:no)?(?![A-Za-z])", fn)


# what harvmac itself defines that a paper uses without defining it: its formulas' shorthands, and layout commands
# (fonts, page breaks) that mean nothing here
HARV_MACROS = ["\\providecommand{%s}%s" % (k, v) for k, v in [
    ("\\half", "{{\\textstyle{1\\over2}}}"), ("\\ha", "{{1\\over2}}"), ("\\del", "{\\partial}"), ("\\tr", "{{\\rm tr}}"),
    ("\\Tr", "{{\\rm Tr}}"), ("\\vev", "[1]{\\langle #1 \\rangle}"), ("\\inv", "{^{-1}}"), ("\\dup", "{^{\\vphantom{1}}}"),
    ("\\dsl", "{\\partial\\!\\!\\!/}"), ("\\Dsl", "{D\\!\\!\\!/}"), ("\\Psl", "{\\partial\\!\\!\\!/}"), ("\\ph", "{\\varphi}"),
    ("\\psibar", "{\\overline\\psi}"), ("\\om", "[2]{\\omega^{#1}{}_{#2}}"), ("\\e", "[1]{{\\rm e}^{#1}}"),
    ("\\grad", "[1]{\\,\\nabla_{#1}\\,}"), ("\\gradgrad", "[2]{\\,\\nabla_{#1}\\nabla_{#2}\\,}"),
    ("\\roughly", "[1]{\\mathrel{\\raise.3ex\\hbox{$#1$\\kern-.75em\\lower1ex\\hbox{$\\sim$}}}}"),
    ("\\CAG", "{{\\cal A/\\cal G}}"), ("\\CO", "{{\\cal O}}"), ("\\CA", "{{\\cal A}}"), ("\\CC", "{{\\cal C}}"),
    ("\\CF", "{{\\cal F}}"), ("\\CG", "{{\\cal G}}"), ("\\CL", "{{\\cal L}}"), ("\\CH", "{{\\cal H}}"), ("\\CI", "{{\\cal I}}"),
    ("\\CU", "{{\\cal U}}"), ("\\CB", "{{\\cal B}}"), ("\\CR", "{{\\cal R}}"), ("\\CD", "{{\\cal D}}"), ("\\CT", "{{\\cal T}}"),
    ("\\litfont", "{}"), ("\\tenpoint", "{}"), ("\\ninepoint", "{}"), ("\\titlefont", "{}"), ("\\abstractfont", "{}"),
    ("\\authorfont", "{}"), ("\\noblackbox", "{}"), ("\\nolabels", "{}"), ("\\footnotefont", "{}"),
    ("\\writedef", "[1]{}"), ("\\wrlabeL", "[1]{}"), ("\\eqlabeL", "[1]{}"), ("\\reflabeL", "[1]{}"), ("\\DefWarn", "[1]{}"),
    ("\\leftbracket", "{}"), ("\\answ", "{b }"), ("\\bigans", "{b }"), ("\\writedefs", "{}"), ("\\writestop", "{}"),
    ("\\writetoc", "{}"), ("\\listtoc", "{}"), ("\\draft", "{}"), ("\\footend", "{}"), ("\\footatend", "{}")]] + [
    # (its counters, which a paper's own macros advance and print)
    "\\newcount\\figno\\figno=1", "\\newcount\\secno", "\\newcount\\subsecno", "\\newcount\\meqno\\meqno=1",
    "\\newcount\\refno\\refno=1", "\\newcount\\ftno"]

# the commands of harvmac's a paper may give another name (\def\lr{\lref})
ALIASABLE = ("lref", "nref", "ref", "refs", "eqn", "eqnn", "foot", "newsec", "subsec", "subsubsec", "appendix", "seclab", "subseclab")

# harvmac's own commands, which a paper may define again its own way (its layout): read as harvmac's
LAYOUT = ("Title", "Date", "HUTP", "newsec", "subsec", "subsubsec", "appendix", "eqn", "eqnn", "eqna", "foot", "ref",
          "nref", "lref", "refs", "listrefs", "seclab", "subseclab", "nfig", "figs", "listfigs", "footend", "draft")


def _drop_defs(t, names):
    """T without the definitions (\\def, \\gdef, \\edef, \\xdef) of the commands NAMES."""
    rx = re.compile(r"\\[gex]?def\s*\\(%s)(?![A-Za-z])[^{]*" % "|".join(map(re.escape, names)))
    out, i = [], 0
    while True:
        m = rx.search(t, i)
        if not m:
            return "".join(out) + t[i:]
        g, end = _group(t, m.end())
        if g is None:
            out.append(t[i:m.end()])
            i = m.end()
            continue
        out.append(t[i:m.start()])
        i = end


# a title page's centred lines: whose they are
PLACE = re.compile(r"(?i)universit|institut|departm|\bdept\b|school|laborator|\bcent(er|re)\b|college|division|faculty|"
                   r"physics|theory group|\bcern\b|\bslac\b|campus|\broad\b|street|avenue|\bbox\b|\d{4,}|\b(usa|germany|"
                   r"france|japan|israel|netherlands|switzerland|italy|canada|china|india|korea|spain|sweden|denmark|russia|"
                   r"england|uk)\b|cedex|\b[A-Z]{2}\s+\d{5}|,\s*[A-Z]{2}\s*$")


def _plain_footnote(s, m):
    """Plain TeX's \\footnote{mark}{text} (the mark a symbol or a number): LaTeX's \\footnote{text}."""
    a, j = _group(s, m.end())
    b, end = _group(s, j) if a is not None else (None, j)
    if b is None or len(a.strip()) > 4:
        return None, m.end()
    return "\\footnote{%s}" % b, end


def _unwrap(x):
    """X without braces round the whole of it ({\\it Name}: \\it Name)."""
    x = x.strip()
    while x.startswith("{"):
        g, end = _group(x, 0)
        if g is None or end != len(x):
            break
        x = g.strip()
    return x


def _plain_line(x):
    """A centred line's words, without the font it is set in (\\it, \\sl, \\bf, \\ticp...)."""
    x = _unwrap(x)
    m = re.match(r"((?:\\[A-Za-z]+\s*)+)(?=[^\\\s{])", x)
    if m and not re.search(r"\\(footnote|foot)\b", m.group(1)):
        x = x[m.end():]
    return _unwrap(x)


NOTE = re.compile(r"\\footnote\s*(?:\{(?:[^{}]|\{[^{}]*\})*\}\s*)?\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}")


def _kind(x):
    p = NOTE.sub("", _plain_line(x)).strip()
    if not p or re.fullmatch(r"(?i)(and|&|abstract|,)", p):
        return "skip"
    if re.search(r"[\w.+-]+@[\w.-]+", p) and not re.search(r"[A-Z][a-z]+", re.sub(r"[\w.+-]+@[\w.-]+", "", p)):
        return "email"
    return "place" if PLACE.search(p) else "name"


def _split_names(p):
    """Names on one line, split at their commas and "and"s (not inside $...$ or braces)."""
    out, cur, depth, math, i = [], "", 0, False, 0
    while i < len(p):
        c = p[i]
        if c == "\\":
            cur += p[i:i + 2]
            i += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == "$":
            math = not math
        if depth == 0 and not math:
            m = re.match(r"\s*,\s*(?:and\s+)?|\s+and\s+|\s*&\s*|\\and(?![A-Za-z])\s*", p[i:])
            if m and m.end() > 0:
                out.append(cur)
                cur = ""
                i += m.end()
                continue
        cur += c
        i += 1
    out.append(cur)
    return [x.strip() for x in out if x.strip()]


def _sort_lines(lines, authors, affil, emails):
    """A title page's lines sorted out: names (several on a line: split), their places, their e-mails (an e-mail in a
    note to a name stays in it)."""
    for x in lines:
        k, p = _kind(x), _plain_line(x)
        if k == "skip":
            continue
        if k == "place":
            affil.append(p)
            continue
        bare = NOTE.sub("", p)
        found = re.findall(r"[\w.+-]+@[\w.-]+\w", bare)
        if k == "email":
            emails.extend(found)
            continue
        for f in found:                            # ("Juan Maldacena malda@pauli.harvard.edu": the name, and the e-mail)
            emails.append(f)
            p = p.replace(f, "")
        authors.extend(_split_names(p.strip()))


def harvmac_to_latex(text):
    t = _strip_comments(text)
    t = re.sub(r"^[ \t]*\\input\s+(harvmac|lanlmac|amssym(\.tex|\.def)?|epsf(\.tex)?|psfig(\.tex)?)\b[^\n]*", "", t, flags=re.M)
    t = re.sub(r"\\(draftmode|overfullrule\s*=?\s*[\d.]+\s*\w*)", "", t)
    t = re.sub(r"\\bye(?![A-Za-z])", "", t)

    # a paper's own versions of harvmac's layout commands (\def\Title#1#2{...} to set the title page its way): not
    # read as the paper's title or text, the commands themselves being turned into LaTeX's below
    t = _drop_defs(t, LAYOUT)
    # another name for one of harvmac's commands (\def\lr{\lref}, \let\nr=\nref): the command itself, wherever it is used
    for m in list(re.finditer(r"\\(?:[gx]?def\s*\\([A-Za-z]+)\s*\{\s*\\(%s)\s*\}|let\s*\\([A-Za-z]+)\s*=?\s*\\(%s)(?![A-Za-z]))"
                              % ("|".join(ALIASABLE), "|".join(ALIASABLE)), t)):
        alias, target = m.group(1) or m.group(3), m.group(2) or m.group(4)
        if alias in LAYOUT or alias == target:
            continue
        t = t.replace(m.group(0), "", 1)
        t = re.sub(r"\\%s(?![A-Za-z])" % re.escape(alias), lambda _: "\\" + target, t)
    # the numbers harvmac wrote at an earlier run, pasted in so that a reference before its equation printed
    # (\def\fields{(1)}): the labels below give them, so these go (a name not labelled anywhere keeps its)
    labelled = set(re.findall(r"\\(?:eqn|eqnn|eqna|nref|ref|lref|seclab|subseclab|figlabel|nfig)\s*\\([A-Za-z]+)", t))
    t = re.sub(r"\\[gx]?def\s*\\([A-Za-z]+)(#1)?\s*\{(?:\(|\[|fig|\\hbox\{\$\()[^{}\n]*\}\}?[ \t]*\n?",
               lambda m: "" if m.group(1) in labelled else m.group(0), t)
    # numbered 1, 2, 3 through the paper, not (section.n)
    sequential = bool(re.search(r"\\sequentialequations(?![A-Za-z])", t))
    t = re.sub(r"\\sequentialequations(?![A-Za-z])", "", t)
    # labels for a section, a subsection, a figure: \seclab\intro, \subseclab\a, \figlabel\b (each then \ref'd by name)
    seclabels = []

    def seclab(m):
        seclabels.append(m.group(1))
        return "\\label{%s}" % m.group(1)
    t = re.sub(r"\\(?:seclab|subseclab|figlabel)\s*\\([A-Za-z]+)", seclab, t)
    # Witten's figures: a \fig{caption}{file.eps}{width} of the paper's own, drawn with \epsfbox: a figure
    fd = re.search(r"\\def\s*\\fig\s*#1#2#3\s*\{", t)
    if fd:
        _, fend = _group(t, fd.end() - 1)
        if re.search(r"\\eps(?:fbox|ffile)\s*\{?\s*#2", t[fd.end():fend]):
            t = t[:fd.start()] + t[fend:]

            def figure(s, m):
                a, j = _group(s, m.end())
                b, j = _group(s, j) if a is not None else (None, j)
                c, end = _group(s, j) if b is not None else (None, j)
                if c is None:
                    return None, m.end()
                return "\\begin{figure}[h]\\centering\\includegraphics{%s}\\caption{%s}\\end{figure}" % (b.strip(), a), end
            t = _each(t, r"\\fig(?![A-Za-z])", figure)
            t = _drop_defs(t, ("figlabel",))
    # \ifig\name{caption}{drawing} (Douglas and Moore's, BFSS's...): a figure, \name cited as "fig. N"
    figlabels = []
    if re.search(r"\\def\s*\\ifig\s*#1#2#3", t):
        t = _drop_defs(t, ("ifig", "figinsert"))

        def ifig(s, m):
            name, j = _cmd(s, m.end())
            a, j = _group(s, j) if name else (None, j)
            b, end = _group(s, j) if a is not None else (None, j)
            if b is None:
                return None, m.end()
            figlabels.append(name)
            return "\\begin{figure}[h]\\centering %s\\caption{%s}\\label{%s}\\end{figure}" % (b, a, name), end
        t = _each(t, r"\\ifig(?![A-Za-z])", ifig)
    t = re.sub(r"\\semi(?![A-Za-z])", "; ", t)              # (harvmac's \semi between two works in one reference)
    t = re.sub(r"\\foot(?![A-Za-z])", r"\\footnote", t)     # (\foot{...}: in the title's lines too)
    t = _each(t, r"\\footnote(?![A-Za-z])", _plain_footnote)  # (plain TeX's \footnote{mark}{text} there too)

    # references: \lref\a{...} (defined), \nref\a{...} (defined and numbered), \ref\a{...} (and cited)
    refs, order = {}, []

    def number(name):
        if name not in order:
            order.append(name)

    def refdef(kind):
        def fn(s, m):
            name, j = _cmd(s, m.end())
            g, end = _group(s, j) if name else (None, j)
            if g is None:
                return None, m.end()
            refs[name] = g.strip()
            out = {"lref": "", "nref": "\x02N%s\x02" % name, "ref": "\x02R%s\x02" % name}[kind]
            # (the line it ends taken with it, as a space: references defined a line each inside a paragraph, once
            # gone, leave no empty line behind, which would end the paragraph)
            k = end
            while k < len(s) and s[k] in " \t":
                k += 1
            if k < len(s) and s[k] == "\n":
                return out + " ", k + 1
            return out, end
        return fn
    # a reference's name defined more than once: as TeX makes them, each \nref or \ref a reference of its own (and a
    # number), and an \lref one at its first citation after it; a citation means the latest. The later ones renamed
    # (name, namezz, namezzzz...), their citations with them
    kinds = {}
    for m in re.finditer(r"\\(lref|nref|ref)\s*\\([A-Za-z]+)", t):
        kinds.setdefault(m.group(2), []).append(m.group(1))
    for n in [n for n, ks in kinds.items() if len(ks) > 1]:
        ev = re.compile(r"\\(lref|nref|ref)(\s*\\)%s(?![A-Za-z])|\\%s(?![A-Za-z])" % (re.escape(n), re.escape(n)))
        made, pending, cur, edits = 0, False, 0, []

        def inst(k):
            return n + "zz" * k
        for m in ev.finditer(t):
            if m.group(1) in ("nref", "ref"):
                cur, made, pending = made, made + 1, False
                edits.append((m.start(), m.end(), "\\%s%s%s" % (m.group(1), m.group(2), inst(cur))))
            elif m.group(1) == "lref":
                pending = True
                edits.append((m.start(), m.end(), None, made))     # (named when it is first cited)
            else:
                if pending:
                    cur, made, pending = made, made + 1, False
                    for x in range(len(edits) - 1, -1, -1):       # the \lref waiting: this reference
                        if len(edits[x]) == 4:
                            a, b, _, _ = edits[x]
                            edits[x] = (a, b, "\\lref" + t[a + 5:b - len(n)] + inst(cur))
                            break
                edits.append((m.start(), m.end(), "\\" + inst(cur)))
        edits = [e if len(e) == 3 else (e[0], e[1], "\\lref" + t[e[0] + 5:e[1] - len(n)] + inst(e[3])) for e in edits]
        for a, b, rep_ in sorted(edits, reverse=True):
            t = t[:a] + rep_ + t[b:]
    for kind in ("lref", "nref", "ref"):
        t = _each(t, r"\\%s(?![A-Za-z])" % kind, refdef(kind))

    # equations: \eqn\name{...}, and $$ ... \eqno\eqnn\name $$ ($$ ... \eqno(\eqna\name) $$)
    labels = []

    def eqn(s, m):
        name, j = _cmd(s, m.end())
        g, end = _group(s, j) if name else (None, j)
        if g is None:
            return None, m.end()
        labels.append(name)
        return "\\begin{equation}\\label{%s}%s\\end{equation}" % (name, _eqalign(_one_par(g))), end
    t = _each(t, r"\\eqn(?![A-Za-z])", eqn)

    def dollars(m):
        body = _one_par(m.group(1))
        k = re.search(r"\\eqno\s*\(?\s*\\eqn[na](?![A-Za-z])\s*\\([A-Za-z]+)\s*\)?", body)
        if not k:
            return "$$" + _eqalign(body) + "$$"
        labels.append(k.group(1))
        return "\\begin{equation}\\label{%s}%s\\end{equation}" % (k.group(1), _eqalign(body[:k.start()] + body[k.end():]))
    t = re.sub(r"\$\$(.+?)\$\$", dollars, t, flags=re.S)
    t = _eqalign(t)

    # plain TeX's \matrix{a & b \cr c & d} and \pmatrix{...} (amsmath has its own), as environments
    def matrix(env):
        def fn(s, m):
            g, end = _group(s, m.end())
            if g is None:
                return None, m.end()
            rows = [r.strip() for r in re.split(r"\\cr(?![A-Za-z])", g)]
            return "\\begin{%s}%s\\end{%s}" % (env, " \\\\ ".join(r for r in rows if r), env), end
        return fn
    t = _each(t, r"\\pmatrix(?![A-Za-z])", matrix("pmatrix"))
    t = _each(t, r"\\cases(?![A-Za-z])", matrix("cases"))
    t = _each(t, r"\\matrix(?![A-Za-z])", matrix("matrix"))

    # the title block: \Title{preprint}{title}, then centred lines (authors, affiliations), the abstract, \Date{...}
    title, authors, affil, abstract, emails = None, [], [], None, []
    m = re.search(r"\\Title(?![A-Za-z])", t)
    pre, body = (t[:m.start()], t[m.end():]) if m else (None, t)
    if m:
        _, j = _group(body, 0)
        g, j = _group(body, j)
        if g is not None:
            lines = re.findall(r"\\centerline\s*\{((?:[^{}]|\{[^{}]*\})*)\}", g) or [g]
            title = " ".join(x.strip() for x in lines if x.strip()) or None
            body = body[j:]
            d = re.search(r"\\Date(?![A-Za-z])", body)
            head = body[:d.start()] if d else ""
            if d:
                _, dend = _group(body, d.end())
                body = body[dend:]
                cl = list(re.finditer(r"\\centerline\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}", head))
                _sort_lines([c.group(1) for c in cl], authors, affil, emails)
                rest = head[cl[-1].end():] if cl else head
                rest = re.sub(r"^\s*(\\[a-z]+skip\s*[\d.]*\s*\w*\s*)*", "", rest)
                rest = re.sub(r"\\(noindent|medskip|bigskip|smallskip|vfill|eject|baselineskip\s*\d+pt)(?![A-Za-z])", "", rest).strip()
                abstract = rest or None
        pre = re.sub(r"\\(Title|Date)(?![A-Za-z])", "", pre)
    else:
        # no \Title: a title page of centred lines of its own, before the first section (the title, its authors and
        # their places, then "Abstract" and the abstract)
        sec = re.search(r"\\newsec(?![A-Za-z])", t)
        top = t[:sec.start()] if sec else ""
        cl = list(re.finditer(r"\\centerline\s*\{((?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*)\}", top))
        ab = next((c for c in cl if re.fullmatch(r"(?i)\s*(\\[A-Za-z]+\s*)*\{?\s*abstract\s*\}?\s*", c.group(1))), None)
        if cl and ab is not None:
            lines = [c.group(1) for c in cl[:cl.index(ab)]]
            # (the title: the first lines, set in the first one's font; then the names and places)
            font = lambda x: (re.match(r"\s*\{?\s*((?:\\[A-Za-z]+\s*)*)", x).group(1) or "").split()
            k = 1
            while k < len(lines) and font(lines[k]) == font(lines[0]) and font(lines[0]):
                k += 1
            title = " ".join(_plain_line(x) for x in lines[:k]) or None
            _sort_lines(lines[k:], authors, affil, emails)
            abstract = re.sub(r"^\s*(\\[a-z]+skip\s*[\d.]*\s*\w*\s*)*", "", top[ab.end():]).strip() or None
            pre, t = t[:cl[0].start()], t[sec.start():]
            body = t
    if pre is not None:
        # a macro package written into the paper (btxmac's BibTeX for plain TeX, epsf...), between \catcode`\@=11 and
        # its end: plain TeX's own workings, which in LaTeX would replace LaTeX's (\@gobble and the like); left out
        pre = re.sub(r"\\catcode\s*`\\?@\s*=\s*11.*?(?:\\catcode\s*`\\?@\s*=\s*(?:12|\\@oldatcatcode)\b|$)", "", pre, flags=re.S)

    # sections
    t2 = body
    t2 = re.sub(r"\\newsec(?![A-Za-z])", r"\\section", t2)
    t2 = re.sub(r"\\subsubsec(?![A-Za-z])", r"\\subsubsection", t2)
    t2 = re.sub(r"\\subsec(?![A-Za-z])", r"\\subsection", t2)
    first = [True]

    def appendix(s, m):
        _, j = _group(s, m.end())
        g, end = _group(s, j)
        if g is None:
            return None, m.end()
        out = ("\\appendix\n" if first[0] else "") + "\\section{%s}" % g
        first[0] = False
        return out, end
    t2 = _each(t2, r"\\appendix(?![A-Za-z])", appendix)

    # footnotes: \foot{text}; plain \footnote{mark}{text}
    t2 = re.sub(r"\\foot(?![A-Za-z])", r"\\footnote", t2)

    t2 = _each(t2, r"\\footnote(?![A-Za-z])", _plain_footnote)

    # citations, in harvmac's numbering (\nref and \ref in their order; \refs{\a - \c} a range of it)
    def refs_group(s, m):
        g, end = _group(s, m.end())
        if g is None:
            return None, m.end()
        names = []
        for part in g.split(","):
            r = re.findall(r"\\([A-Za-z]+)", part)
            if "-" in part and len(r) == 2 and r[0] in order and r[1] in order:
                a, b = order.index(r[0]), order.index(r[1])
                names += order[a:b + 1]
            else:
                names += [x for x in r if x in refs]
        for x in names:
            number(x)
        return ("\\cite{%s}" % ",".join(names)) if names else "", end

    # (as harvmac numbers them: in reading order, a reference at its \nref or \ref, or, defined by \lref, where it is
    # first cited, by its name alone or in a \refs{...})
    bare_ref = "|".join(sorted(map(re.escape, refs), key=len, reverse=True))

    def scan_order(s):
        out, i = [], 0
        rx = re.compile(r"\x02([NR])([A-Za-z]+)\x02|\\refs(?![A-Za-z])" +
                        (r"|\\(%s)(?![A-Za-z])" % bare_ref if bare_ref else ""))
        while True:
            m = rx.search(s, i)
            if not m:
                out.append(s[i:])
                return "".join(out)
            out.append(s[i:m.start()])
            if m.group(1):
                number(m.group(2))
                out.append("" if m.group(1) == "N" else "\\cite{%s}" % m.group(2))
                i = m.end()
            elif m.lastindex == 3 and m.group(3):
                number(m.group(3))
                out.append("\\cite{%s}" % m.group(3))
                i = m.end()
            else:
                rep, end = refs_group(s, m)
                out.append(rep if rep is not None else m.group(0))
                i = end if rep is not None else m.end()
    # a macro of the paper's that cites (\def\ilsii{\refs{\ils, \intin}}): its citations made where it is used, as TeX makes
    # them, not where it is defined (the references are numbered at their first citation)
    if refs:
        citing = re.compile(r"\\refs(?![A-Za-z])|\x02[NR]|\\(%s)(?![A-Za-z])" % bare_ref)

        def citing_defs(src):                  # (the definitions in SRC that cite: their names and bodies; SRC without them)
            found, out, i = [], [], 0
            for m in re.finditer(r"\\[gx]?def\s*\\([A-Za-z]+)\s*\{", src):
                if m.start() < i:
                    continue
                g, end = _group(src, m.end() - 1)
                if g is None or not citing.search(g) or m.group(1) in refs:
                    continue
                found.append((m.group(1), g))
                out.append(src[i:m.start()])
                i = end
            return found, "".join(out) + src[i:]
        found = []
        if pre is not None:
            f1, pre = citing_defs(pre)
            found += f1
        f2, t2 = citing_defs(t2)
        for name, g in found + f2:
            t2 = re.sub(r"\\%s(?![A-Za-z])" % re.escape(name), lambda _: g, t2)
    t2 = scan_order(t2)
    pre = scan_order(pre) if pre is not None else None

    # a bare \name of a reference or an equation, after its definition: a citation, or a reference to the equation
    names = {x: "\\cite{%s}" % x for x in refs}
    names.update({x: "\\eqref{%s}" % x for x in labels})
    names.update({x: "\\ref{%s}" % x for x in seclabels})
    names.update({x: "fig.~\\ref{%s}" % x for x in figlabels})
    if names:
        rx = re.compile(r"\\(%s)(?![A-Za-z])" % "|".join(sorted(map(re.escape, names), key=len, reverse=True)))

        # an equation's name given twice (\eqn\obbo twice): as in TeX, each equation keeps the number it had, and a
        # reference means the one named last before it; the later ones get labels of their own
        seen = {}

        def relabel(m):
            n = m.group(1)
            seen[n] = seen.get(n, 0) + 1
            return "\\label{%s}" % (n if seen[n] == 1 or n not in labels else n + "zz" * (seen[n] - 1))
        t2 = re.sub(r"\\label\{([A-Za-z]+)\}", relabel, t2)
        t2 = re.sub(r"\\label\{([A-Za-z]+)\}", lambda m: "\\label{\x03%s}" % m.group(1), t2)
        defs = {}
        for d in re.finditer(r"\\label\{\x03([A-Za-z]+?)((?:zz)*)\}", t2):
            defs.setdefault(d.group(1), []).append((d.start(), d.group(1) + d.group(2)))

        def bare(m):
            n = m.group(1)
            if n in refs:
                number(n)
            if n in labels and len(defs.get(n, [])) > 1:
                before = [lab for at, lab in defs[n] if at < m.start()]
                return "\\eqref{%s}" % (before[-1] if before else defs[n][0][1])
            return names[n]
        t2 = rx.sub(bare, t2)
        t2 = t2.replace("\\label{\x03", "\\label{")

    # the references, at \listrefs (or the end): those numbered, and those cited only in another one's text (numbered
    # as the list is set); an \lref never cited is not listed, as in TeX
    for x in refs:
        if x not in order and any(re.search(r"\\%s(?![A-Za-z])" % re.escape(x), refs[y]) for y in order if y in refs):
            number(x)
    bib = "\\begin{thebibliography}{%d}\n%s\\end{thebibliography}\n" % (
        len(order), "".join("\\bibitem{%s} %s\n" % (x, refs[x]) for x in order if x in refs))
    if "\\listrefs" in t2:
        t2 = re.sub(r"\\listrefs(?![A-Za-z])", lambda m: bib, t2, count=1)
    else:
        t2 += "\n" + bib

    head = ["\\documentclass[11pt]{article}", "\\usepackage{amsmath,amssymb,graphicx,epsfig}",
            "\\let\\Bbb\\mathbb", "\\providecommand{\\affiliation}[1]{}"] + ([] if sequential else ["\\numberwithin{equation}{section}"]) + HARV_MACROS
    if title:
        head.append("\\title{%s}" % title)
    if authors:
        head.append("\\author{%s}" % " \\and ".join(authors))
    for e in emails:
        head.append("\\email{%s}" % e)
    for a in affil:
        head.append("\\affiliation{%s}" % a)
    out = "\n".join(head) + "\n" + (pre or "") + "\n\\begin{document}\n"
    if title:
        out += "\\maketitle\n"
    if abstract:
        out += "\\begin{abstract}\n%s\n\\end{abstract}\n" % abstract
    return out + t2 + "\n\\end{document}\n"
