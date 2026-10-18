#!/usr/bin/env python3
"""epsilon_render: pack one Epsilon document and the viewer into a single HTML file.

    python3 epsilon_convert.py paper.tex                  # once: LaTeX -> paper.l2m/ (the document)
    python3 epsilon_render.py paper.l2m -o paper.html      # any time: the one-file page, no LaTeX

The page carries the document, its drawn formulas (math.json) and the viewer (viewer/theme.json,
theme.css, prefs.js, nav.js, viewer.js) inline, so it works offline and as a Claude artifact. It is
an export: change the theme or the viewer and run this again, the document stays as it is.
"""

import argparse
import base64
import html
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from epsilon_convert import draw_math, load_doc, load_math  # noqa: E402

VIEWER = HERE / "viewer"


def inline_json(obj):
    """JSON that is safe inside <script type="application/json">, in plain ASCII (so the page reads the same
    whatever charset it is served with)."""
    return json.dumps(obj, ensure_ascii=True).replace("</", "<\\/").replace("<!--", "<\\u0021--")


def ascii_html(t):
    return html.escape(t).encode("ascii", "xmlcharrefreplace").decode()


# ---------------------------------------------------------------- the fonts, inside the page
# The page carries its fonts, from the viewer's fonts/ (tools/get_fonts.py puts them there): the reading font it
# opens in and the interface font, each whole in weight, for the Latin letters and whatever other scripts the paper
# shows; and for the font list, each font's name in its own face. It then asks nothing of the network; only another
# font the reader picks would be fetched (from Google Fonts). A theme without fonts/ has the page fetch them all.
def _covers(rng, cps):
    """Whether a unicode-range ('U+0102-0103, U+20AB, ...') holds any of the code points CPS."""
    for part in rng.split(","):
        lo, _, hi = part.strip()[2:].partition("-")
        lo, hi = int(lo.replace("?", "0"), 16), int((hi or lo).replace("?", "F"), 16)
        if any(lo <= c <= hi for c in cps):
            return True
    return False


def font_css(theme, text, theme_dir=VIEWER):
    """@font-face rules with the fonts inside, and what they cover; ('', None) when the theme has no fonts/."""
    folder = Path(theme_dir) / "fonts"
    if not (folder / "fonts.css").is_file():
        return "", None
    fonts = {f["key"]: f for f in theme.get("fonts", [])}
    main = (theme.get("defaults") or {}).get("font")
    families = set()
    if main in fonts:
        families.add(re.match(r'\s*"?([^",]+)', fonts[main].get("stack", "")).group(1))
    if theme.get("uiFont"):
        families.add(theme["uiFont"].split(":")[0].replace("+", " "))
    greek = theme["greekFont"].split(":")[0].replace("+", " ") if theme.get("greekFont") and re.search("[\u1f00-\u1fff]", text) else None
    cps = {ord(c) for c in text if ord(c) > 0x7f}
    rules, has_greek = [], False
    for sub, block in re.findall(r"/\* ([\w-]+) \*/\s*(@font-face \{.*?\})", (folder / "fonts.css").read_text(), re.S):
        fam = re.search(r"font-family: '([^']+)'", block).group(1)
        rng = re.search(r"unicode-range: ([^;]+);", block)
        in_greek = fam == greek and rng and _covers(rng.group(1), cps)      # (for polytonic Greek, as the viewer)
        has_greek = has_greek or bool(in_greek)
        if sub == "preview" or in_greek or (fam in families and (sub == "latin" or (rng and _covers(rng.group(1), cps)))):
            rules.append(re.sub(r"url\(([\w.-]+\.woff2)\)", lambda m: "url(data:font/woff2;base64,%s)" % base64.b64encode(
                (folder / m.group(1)).read_bytes()).decode(), block))
    return "\n".join(rules), {"keys": [main] if main in fonts else [], "ui": bool(theme.get("uiFont")), "previews": True,
                              "greek": has_greek}


def page_marks(doc, notes):
    """NOTES ([{"words", "note", "colour"}], the words as the paper's text has them: formulas as their TeX between $
    signs) as the marks the page carries, placed in DOC's text as the app places them."""
    import epsilon_notes as N
    C, heads = N.paper_text(doc)
    marks = {}
    for k, n in enumerate(notes):
        s, e, _ = N.find_words(C, n["words"])
        s, e = N.whole(C, s, e)
        h = N.head_at(heads, s)
        mid = "n%d" % (k + 1)
        marks[mid] = {"id": mid, "c": N.COLOURS.get(n.get("colour", "orange"), 4), "quote": C[s:e], "pre": C[max(0, s - 40):s],
                      "post": C[e:e + 40], "start": s, "end": e, "sec": h["id"] if h else "", "ver": "page", "made": 0, "at": 0}
        if n.get("note"):
            marks[mid]["note"] = n["note"].strip()
        if n.get("by"):
            marks[mid]["by"] = n["by"]
    return marks


# a page with marks: they are kept as the page came, the reader's own (and changes) in the reader's browser
PAGE_STORE = r"""function l2mPageMarks(key) {
  var given = JSON.parse(document.getElementById("l2m-marks").textContent), LS = "l2m-page-marks:" + key, marks = {};
  var mine = (function () { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { return null; } })() || {};
  Object.keys(given).forEach(function (id) { marks[id] = given[id]; });
  Object.keys(mine).forEach(function (id) { if (!marks[id] || (mine[id].at || 0) > (marks[id].at || 0)) marks[id] = mine[id]; });
  function keep() {
    var own = {};
    Object.keys(marks).forEach(function (id) { if (marks[id] !== given[id]) own[id] = marks[id]; });
    try { localStorage.setItem(LS, JSON.stringify(own)); } catch (e) {}
  }
  function toast(html, ms) {
    var t = document.getElementById("app-toast");
    if (!t) { t = document.createElement("div"); t.id = "app-toast"; t.className = "app-toast glass glass-bottom"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.innerHTML = html; t.onclick = null; t.l2mAway = null;
    if (window.L2M_footer) L2M_footer(t, true);
    clearTimeout(t.l2mTimer);
    t.l2mTimer = setTimeout(function () { if (window.L2M_footer) L2M_footer(t, false); }, ms || 4000);
  }
  function toastAct(html, label, fn, ms) {
    var x = (window.L2M_THEME && L2M_THEME.icons && L2M_THEME.icons.close) || "&times;";
    toast('<span class="app-ask app-act-row"><span class="app-ask-q">' + html + '</span><span class="app-confirm-acts">' +
          '<button type="button" class="app-pill app-ask-yes" data-act-go>' + label + '</button><button type="button" class="bar-btn app-toast-x" data-toast-x aria-label="Close">' +
          x + "</button></span></span>", ms || 5000);
    var t = document.getElementById("app-toast");
    function away(go) { t.onclick = null; t.l2mAway = null; clearTimeout(t.l2mTimer); if (window.L2M_footer) L2M_footer(t, false); if (go) fn(); }
    t.l2mAway = function () { away(false); };
    t.onclick = function (e) { if (e.target.closest("[data-act-go]")) away(true); else if (e.target.closest("[data-toast-x]")) away(false); };
  }
  return {
    version: "page",
    all: function () { return marks; },
    put: function (m) { m.at = Date.now(); marks[m.id] = m; keep(); },
    place: function (m) { marks[m.id] = m; },
    pull: function () { return Promise.resolve(false); },
    flush: function () {},
    link: function (id) { return location.href.split("#")[0] + "#mark-" + encodeURIComponent(id); },
    toast: toast, toastAct: toastAct,
    toastAway: function () { var t = document.getElementById("app-toast"); if (t && t.classList.contains("open") && t.l2mAway) t.l2mAway(); }
  };
}
"""


def bundle(doc, cache, out, artifact=False, kicker=None, theme_dir=VIEWER, info=None, notes=None):
    """Write the one-file page for DOC (images inline) and its drawn formulas CACHE (or None); with NOTES, the marks
    and notes it carries (see page_marks), the reader able to mark it too."""
    theme_dir = Path(theme_dir)
    theme = json.loads((theme_dir / "theme.json").read_text())
    if kicker:
        doc = dict(doc, kicker=kicker)
    read = lambda name: (theme_dir / name).read_text()

    def css():
        # the theme's own images (the glass's soap film) go inside the page, which has no files beside it
        def inline(m):
            f = theme_dir / m.group(1)
            if not f.is_file():
                return m.group(0)
            kind = {".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml"}.get(f.suffix, "application/octet-stream")
            return "url(data:%s;base64,%s)" % (kind, base64.b64encode(f.read_bytes()).decode())
        return re.sub(r"url\(([\w.-]+\.(?:webp|png|svg))\)", inline, read("theme.css"))
    faces, inline = font_css(theme, json.dumps(doc, ensure_ascii=False), theme_dir)
    if info and not inline:
        info("the theme has no fonts/ folder: the page will fetch its fonts from Google Fonts")
    head = ("<title>%s</title>\n" % ascii_html(doc.get("title") or "Paper") +
            ("<style>\n%s\n</style>\n<script>window.L2M_FONTS_INLINE = %s;</script>\n" % (faces, json.dumps(inline)) if inline else
             '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n') +
            "<style>\n%s</style>\n<script>window.L2M_THEME = %s;</script>\n<script>\n%s</script>\n" % (
        css(), inline_json(theme), read("prefs.js")))
    marks = page_marks(doc, notes) if notes is not None else None
    boot = ('(function () {\n'
            '  var doc = JSON.parse(document.getElementById("l2m-doc").textContent);\n'
            '  var cache = JSON.parse(document.getElementById("l2m-math").textContent);\n'
            '  L2M_open({doc: doc, theme: window.L2M_THEME, cache: cache, key: doc.source || ""%s});\n'
            '})();\n') % (', marks: l2mPageMarks(doc.source || "")' if marks is not None else "")
    body = ('<main tabindex="-1"><noscript>This page needs JavaScript to show the paper.</noscript></main>\n'
            '<script type="application/json" id="l2m-doc">%s</script>\n'
            '<script type="application/json" id="l2m-math">%s</script>\n' % (inline_json(doc), inline_json(cache)) +
            ('<script type="application/json" id="l2m-marks">%s</script>\n<script>\n%s%s</script>\n' % (
                inline_json(marks), read("marks.js"), PAGE_STORE) if marks is not None else "") +
            "<script>\n%s</script>\n<script>\n%s</script>\n<script>\n%s</script>\n" % (read("nav.js"), read("viewer.js"), boot))
    if artifact:
        page = head + body
    else:
        page = ('<!doctype html>\n<html lang="%s">\n<head>\n<meta charset="utf-8">\n'
                '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
                '%s</head>\n<body>\n%s</body>\n</html>\n') % (html.escape(doc.get("lang") or "en"), head, body)
    Path(out).write_text(page)
    if info:
        info("wrote %s (%.1f MB)" % (out, len(page.encode()) / 1e6))


def main():
    ap = argparse.ArgumentParser(description="Pack an Epsilon document and the viewer into one HTML file.")
    ap.add_argument("doc", help="the document folder written by epsilon_convert.py (or its paper.json)")
    ap.add_argument("-o", "--output", help="output .html file (default: next to the document folder)")
    ap.add_argument("--artifact", action="store_true",
                    help="write a page fragment without <html>/<head>/<body>, for publishing as a Claude artifact")
    ap.add_argument("--kicker", help="small line above the title (default: the one given when converting)")
    ap.add_argument("--theme", metavar="DIR", default=str(VIEWER), help="the viewer folder (default: viewer/)")
    ap.add_argument("--notes", metavar="FILE", help='marks and notes the page carries: a JSON list of {"words", "note", '
                    '"colour"} (the words as the paper has them, formulas as their TeX between $ signs; the colour orange, '
                    'green, pink or violet); the reader can mark the page too')
    ap.add_argument("-q", "--quiet", action="store_true", help="print nothing but errors")
    a = ap.parse_args()
    path = Path(a.doc)
    folder = path if path.is_dir() else path.parent
    out = Path(a.output) if a.output else folder.with_suffix(".html")
    info = None if a.quiet else (lambda m: print(m, file=sys.stderr))
    doc = load_doc(path)
    cache = load_math(folder, doc)
    if cache is None and doc["math"]["items"]:
        warnings = {}
        cache = draw_math(doc, lambda m: warnings.__setitem__(m, warnings.get(m, 0) + 1), info)
        if warnings and not a.quiet:
            print("%d formula warnings (math.json was missing or out of date)" % sum(warnings.values()), file=sys.stderr)
    notes = json.loads(Path(a.notes).read_text()) if a.notes else None
    bundle(doc, cache, out, a.artifact, a.kicker, a.theme, info, notes)


if __name__ == "__main__":
    main()
