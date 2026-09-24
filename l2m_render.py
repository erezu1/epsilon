#!/usr/bin/env python3
"""l2m_render: pack one latex2mobile document and the viewer into a single HTML file.

    python3 latex2mobile.py paper.tex                  # once: LaTeX -> paper.l2m/ (the document)
    python3 l2m_render.py paper.l2m -o paper.html      # any time: the one-file page, no LaTeX

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
from latex2mobile import draw_math, load_doc, load_math  # noqa: E402

VIEWER = HERE / "viewer"


def inline_json(obj):
    """JSON that is safe inside <script type="application/json">, in plain ASCII (so the page reads the same
    whatever charset it is served with)."""
    return json.dumps(obj, ensure_ascii=True).replace("</", "<\\/").replace("<!--", "<\\u0021--")


def ascii_html(t):
    return html.escape(t).encode("ascii", "xmlcharrefreplace").decode()


def bundle(doc, cache, out, artifact=False, kicker=None, theme_dir=VIEWER, info=None):
    """Write the one-file page for DOC (images inline) and its drawn formulas CACHE (or None)."""
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
    head = ("<title>%s</title>\n"
            '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
            "<style>\n%s</style>\n<script>window.L2M_THEME = %s;</script>\n<script>\n%s</script>\n") % (
        ascii_html(doc.get("title") or "Paper"), css(), inline_json(theme), read("prefs.js"))
    boot = ('(function () {\n'
            '  var doc = JSON.parse(document.getElementById("l2m-doc").textContent);\n'
            '  var cache = JSON.parse(document.getElementById("l2m-math").textContent);\n'
            '  L2M_open({doc: doc, theme: window.L2M_THEME, cache: cache, key: doc.source || ""});\n'
            '})();\n')
    body = ('<main><noscript>This page needs JavaScript to show the paper.</noscript></main>\n'
            '<script type="application/json" id="l2m-doc">%s</script>\n'
            '<script type="application/json" id="l2m-math">%s</script>\n'
            "<script>\n%s</script>\n<script>\n%s</script>\n<script>\n%s</script>\n") % (
        inline_json(doc), inline_json(cache), read("nav.js"), read("viewer.js"), boot)
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
    ap = argparse.ArgumentParser(description="Pack a latex2mobile document and the viewer into one HTML file.")
    ap.add_argument("doc", help="the document folder written by latex2mobile.py (or its paper.json)")
    ap.add_argument("-o", "--output", help="output .html file (default: next to the document folder)")
    ap.add_argument("--artifact", action="store_true",
                    help="write a page fragment without <html>/<head>/<body>, for publishing as a Claude artifact")
    ap.add_argument("--kicker", help="small line above the title (default: the one given when converting)")
    ap.add_argument("--theme", metavar="DIR", default=str(VIEWER), help="the viewer folder (default: viewer/)")
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
    bundle(doc, cache, out, a.artifact, a.kicker, a.theme, info)


if __name__ == "__main__":
    main()
