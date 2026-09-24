#!/usr/bin/env python3
"""l2m_viewer: a site of latex2mobile documents behind one viewer.

    python3 l2m_viewer.py build site/ a.l2m b.l2m ...   # the viewer, site/papers/<name>/, site/library.json
    python3 l2m_viewer.py serve site/                   # http://localhost:8000/        (the library)
                                                        # http://localhost:8000/?p=<name> (one paper)

The site is the viewer folder (viewer/: index.html, theme.json, theme.css, prefs.js, nav.js,
viewer.js, app.js, ...) next to the documents. Edit theme.json or theme.css in the site, or rebuild
from viewer/, and every paper changes; the documents are never rewritten. Papers carry their drawn
formulas (math.json, made by latex2mobile.py); a paper without one is drawn here, or with
--no-math-cache left to the browser. Adding papers to an existing site keeps the ones already there.
"""

import argparse
import html
import http.server
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from latex2mobile import DOC_FORMAT, DOC_VERSION, draw_math, load_math  # noqa: E402
from l2m_render import ascii_html, inline_json  # noqa: E402

VIEWER = HERE / "viewer"
FILES = ["index.html", "theme.json", "theme.css", "prefs.js", "nav.js", "viewer.js", "app.js", "sw.js",
         "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon.png", "film.webp"]


def doc_name(folder):
    """papers/<name>: the folder's name without .l2m, or its parent's name for a generic paper.l2m."""
    stem = folder.name[:-4] if folder.name.endswith(".l2m") else folder.name
    return folder.resolve().parent.name if stem in ("paper", "") else stem


def artifact_page(name, viewer):
    """index.html as one page fragment with the viewer inline (an artifact loads no scripts of its own)."""
    read = lambda f: (viewer / f).read_text()
    theme = json.loads(read("theme.json"))
    return ("<title>%s</title>\n"
            '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
            '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
            "<style>\n%s</style>\n<script>window.L2M_THEME = %s;</script>\n<script>\n%s</script>\n"
            '<main><p class="l2m-note">Loading&hellip;</p></main>\n'
            "<script>\n%s</script>\n<script>\n%s</script>\n<script>\n%s</script>\n") % (
        ascii_html(name), read("theme.css"), inline_json(theme), read("prefs.js"),
        read("nav.js"), read("viewer.js"), read("app.js"))


def build(a):
    site = Path(a.site)
    viewer = Path(a.viewer)
    (site / "papers").mkdir(parents=True, exist_ok=True)
    lib_file = site / "library.json"
    lib = json.loads(lib_file.read_text()) if lib_file.exists() else {"papers": []}
    lib["name"] = a.name or lib.get("name") or "Papers"
    papers = {p["path"]: p for p in lib["papers"]}
    for d in a.docs:
        folder = Path(d)
        if folder.is_file():
            folder = folder.parent
        doc = json.loads((folder / "paper.json").read_text())
        if doc.get("format") != DOC_FORMAT or doc.get("version", 0) > DOC_VERSION:
            sys.exit("l2m_viewer: %s is not a document this viewer reads" % folder)
        path = "papers/" + doc_name(folder)
        dest = site / path
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(folder, dest)
        if a.no_math_cache:
            (dest / "math.json").unlink(missing_ok=True)
        elif load_math(dest, doc) is None and doc["math"]["items"]:
            # missing or drawn from other formulas: draw it now
            (dest / "math.json").write_text(json.dumps(draw_math(doc), ensure_ascii=False))
        papers[path] = {"path": path, "title": doc.get("title", ""), "authors": doc.get("authors", []),
                        "source": doc.get("source", "")}
    lib["papers"] = sorted(papers.values(), key=lambda p: p["path"])
    if a.local_mathjax:
        (site / "mathjax").mkdir(exist_ok=True)
        shutil.copy(HERE / "node_modules" / "mathjax-full" / "es5" / "tex-svg-full.js", site / "mathjax" / "tex-svg-full.js")
        lib["mathjax"] = "mathjax/tex-svg-full.js"
    lib_file.write_text(json.dumps(lib, ensure_ascii=False, indent=1))
    if a.artifact:
        for f in FILES + ["site.js"]:
            (site / f).unlink(missing_ok=True)
        (site / "index.html").write_text(artifact_page(lib["name"], viewer))
    else:
        (site / "site.js").unlink(missing_ok=True)
        for f in FILES:
            shutil.copy(viewer / f, site / f)
        index = (site / "index.html").read_text().replace("<title>Papers</title>", "<title>%s</title>" % html.escape(lib["name"]))
        (site / "index.html").write_text(index)
    if not a.quiet:
        print("wrote %s: viewer and %d papers" % (site, len(lib["papers"])), file=sys.stderr)


def serve(a):
    site = str(Path(a.site).resolve())

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kw):
            super().__init__(*args, directory=site, **kw)

        def log_message(self, *args):
            pass

    print("serving %s at http://localhost:%d/" % (site, a.port), file=sys.stderr)
    http.server.ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()


def main():
    ap = argparse.ArgumentParser(description="A site of latex2mobile documents behind one viewer.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="copy the viewer and documents into a site folder")
    b.add_argument("site", help="the site folder (created if needed)")
    b.add_argument("docs", nargs="*", help="document folders written by latex2mobile.py")
    b.add_argument("--name", help='library title (default: "Papers")')
    b.add_argument("--viewer", default=str(VIEWER), help="the viewer folder to use (default: viewer/)")
    b.add_argument("--local-mathjax", action="store_true", help="copy MathJax into the site instead of loading it from a CDN")
    b.add_argument("--no-math-cache", action="store_true",
                   help="leave out math.json, so the browser draws the formulas when a paper opens")
    b.add_argument("--artifact", action="store_true",
                   help="write index.html as one page fragment with the viewer inline, for a Claude artifact")
    b.add_argument("-q", "--quiet", action="store_true")
    s = sub.add_parser("serve", help="serve a site folder locally")
    s.add_argument("site")
    s.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    build(a) if a.cmd == "build" else serve(a)


if __name__ == "__main__":
    main()
