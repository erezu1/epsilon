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


def harvmac_to_latex(text):
    t = _strip_comments(text)
    t = re.sub(r"^[ \t]*\\input\s+(harvmac|lanlmac|amssym(\.tex|\.def)?|epsf(\.tex)?|psfig(\.tex)?)\b[^\n]*", "", t, flags=re.M)
    t = re.sub(r"\\(draftmode|overfullrule\s*=?\s*[\d.]+\s*\w*)", "", t)
    t = re.sub(r"\\bye(?![A-Za-z])", "", t)

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
            return {"lref": "", "nref": "\x02N%s\x02" % name, "ref": "\x02R%s\x02" % name}[kind], end
        return fn
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
    t = _each(t, r"\\matrix(?![A-Za-z])", matrix("matrix"))

    # the title block: \Title{preprint}{title}, then centred lines (authors, affiliations), the abstract, \Date{...}
    title, authors, affil, abstract = None, [], [], None
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
                for c in cl:
                    x = c.group(1).strip()
                    if not x or re.fullmatch(r"(and|&)", x):
                        continue
                    (affil if re.match(r"\\(it|sl|em)\b", x) else authors).append(re.sub(r"^\\(it|sl|em)\s*", "", x))
                rest = head[cl[-1].end():] if cl else head
                rest = re.sub(r"\\(noindent|medskip|bigskip|smallskip|vfill|eject|baselineskip\s*\d+pt)(?![A-Za-z])", "", rest).strip()
                abstract = rest or None
        pre = re.sub(r"\\(Title|Date)(?![A-Za-z])", "", pre)

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

    def footnote(s, m):
        a, j = _group(s, m.end())
        b, end = _group(s, j) if a is not None else (None, j)
        if b is None or len(a.strip()) > 4:
            return None, m.end()
        return "\\footnote{%s}" % b, end
    t2 = _each(t2, r"\\footnote(?![A-Za-z])", footnote)

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

    def scan_order(s):
        out, i = [], 0
        rx = re.compile(r"\x02([NR])([A-Za-z]+)\x02|\\refs(?![A-Za-z])")
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
            else:
                rep, end = refs_group(s, m)
                out.append(rep if rep is not None else m.group(0))
                i = end if rep is not None else m.end()
    t2 = scan_order(t2)
    pre = scan_order(pre) if pre is not None else None

    # a bare \name of a reference or an equation, after its definition: a citation, or a reference to the equation
    names = {x: "\\cite{%s}" % x for x in refs}
    names.update({x: "\\eqref{%s}" % x for x in labels})
    if names:
        rx = re.compile(r"\\(%s)(?![A-Za-z])" % "|".join(sorted(map(re.escape, names), key=len, reverse=True)))

        def bare(m):
            k = t2.rfind("\\label{", 0, m.start())
            if m.group(1) in refs:
                number(m.group(1))
            return names[m.group(1)]
        t2 = re.sub(r"\\label\{([A-Za-z]+)\}", lambda m: "\\label{\x03%s}" % m.group(1), t2)
        t2 = rx.sub(bare, t2)
        t2 = t2.replace("\\label{\x03", "\\label{")

    # the references, at \listrefs (or the end)
    for x in refs:
        number(x)
    bib = "\\begin{thebibliography}{%d}\n%s\\end{thebibliography}\n" % (
        len(order), "".join("\\bibitem{%s} %s\n" % (x, refs[x]) for x in order if x in refs))
    if "\\listrefs" in t2:
        t2 = re.sub(r"\\listrefs(?![A-Za-z])", lambda m: bib, t2, count=1)
    else:
        t2 += "\n" + bib

    head = ["\\documentclass[11pt]{article}", "\\usepackage{amsmath,amssymb,graphicx,epsfig}",
            "\\let\\Bbb\\mathbb", "\\providecommand{\\affiliation}[1]{}", "\\numberwithin{equation}{section}", "\\providecommand{\\half}{{\\textstyle{1\\over2}}}"]
    if title:
        head.append("\\title{%s}" % title)
    if authors:
        head.append("\\author{%s}" % " \\and ".join(authors))
    for a in affil:
        head.append("\\affiliation{%s}" % a)
    out = "\n".join(head) + "\n" + (pre or "") + "\n\\begin{document}\n"
    if title:
        out += "\\maketitle\n"
    if abstract:
        out += "\\begin{abstract}\n%s\n\\end{abstract}\n" % abstract
    return out + t2 + "\n\\end{document}\n"
