#!/usr/bin/env python3
"""get_fonts: the fonts of viewer/theme.json, from Google Fonts into viewer/fonts/. The app serves them itself (and
its service worker keeps them), and one-file pages take theirs from there: no page asks Google for anything.

    python3 tools/get_fonts.py        # again after changing the fonts in theme.json

Each font comes whole in weight (variable), in every script Google has it in (a page downloads only the scripts it
shows, by unicode-range); for the font list, each font's name in its own face (a few hundred bytes each). Files are
named by their content, so a copy a phone keeps never goes stale. fonts.css declares them all, each rule after a
comment naming its script, as Google writes it.
"""

import hashlib
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

VIEWER = Path(__file__).resolve().parent.parent / "viewer"
OUT = VIEWER / "fonts"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read()


def variable(spec):
    """A family's static weights as one range: 'Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,...' ->
    'Newsreader:ital,opsz,wght@0,6..72,400..600;1,...'."""
    if "@" not in spec:
        return spec
    fam, rest = spec.split(":", 1)
    axes, tuples = rest.split("@", 1)
    names = axes.split(",")
    if "wght" not in names:
        return spec
    w = names.index("wght")
    groups = {}
    for t in tuples.split(";"):
        v = t.split(",")
        key = tuple(x for i, x in enumerate(v) if i != w)
        groups.setdefault(key, []).append(float(v[w].split("..")[0]))
    out = []
    for key, ws in sorted(groups.items()):
        v = list(key)
        v.insert(w, "%g..%g" % (min(ws), max(ws)) if len(ws) > 1 else "%g" % ws[0])
        out.append(",".join(v))
    return "%s:%s@%s" % (fam, axes, ";".join(out))


def keep(data, stem):
    name = "%s.%s.woff2" % (stem, hashlib.sha256(data).hexdigest()[:10])
    (OUT / name).write_bytes(data)
    return name


def main():
    theme = json.loads((VIEWER / "theme.json").read_text())
    specs = [(f["key"], f["css"]) for f in theme.get("fonts", []) if f.get("css")]
    if theme.get("uiFont"):
        specs.append(("ui", theme["uiFont"]))
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.woff2"):
        old.unlink()
    rules, total = [], 0
    for key, spec in specs:
        css = get("https://fonts.googleapis.com/css2?family=" + variable(spec) + "&display=swap").decode()
        for sub, block in re.findall(r"/\* ([\w-]+) \*/\s*(@font-face \{.*?\})", css, re.S):
            style = re.search(r"font-style: (\w+)", block).group(1)
            data = get(re.search(r"url\((https://[^)]+)\)", block).group(1))
            total += len(data)
            name = keep(data, "%s-%s-%s" % (key, style, sub))
            rules.append("/* %s */\n%s" % (sub, re.sub(r"url\(https://[^)]+\)", "url(%s)" % name, block)))
    for f in theme.get("fonts", []):                    # the names in the font list, each in its own face
        if not f.get("css"):
            continue
        css = get("https://fonts.googleapis.com/css2?family=" + f["css"].split(":")[0] + "&text=" + urllib.parse.quote(f["name"])).decode()
        data = get(re.search(r"url\((https://[^)]+)\)", css).group(1))
        total += len(data)
        rules.append("/* preview */\n@font-face {\n  font-family: 'l2m-pv-%s';\n  src: url(%s) format('woff2');\n}" % (
            f["key"], keep(data, "pv-" + f["key"])))
    # the licence goes with the files: each family's copyright notice, then the SIL Open Font License once
    notes, body = [], ""
    for key, spec in specs:
        fam = spec.split(":")[0].replace("+", " ")
        text = get("https://raw.githubusercontent.com/google/fonts/main/ofl/%s/OFL.txt" % fam.lower().replace(" ", "")).decode()
        head, _, rest = text.partition("This Font Software is licensed")
        notes.append("%s: %s" % (fam, " ".join(head.split())))
        body = body or "This Font Software is licensed" + rest
    (OUT / "OFL.txt").write_text("\n".join(notes) + "\n\n" + body)
    (OUT / "fonts.css").write_text(
        "/* The app's fonts, from Google Fonts by tools/get_fonts.py (SIL Open Font License: OFL.txt). Written by the\n"
        "   tool: run it again rather than editing this. */\n" + "\n".join(rules) + "\n")
    print("wrote %s: %d faces, %.1f MB" % (OUT, len(rules), total / 1e6))


if __name__ == "__main__":
    sys.exit(main())
