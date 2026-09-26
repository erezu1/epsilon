#!/usr/bin/env python3
"""get_mathjax: the app's own copy of MathJax, the one viewer/theme.json names ("mathjax", a CDN address), into
viewer/mathjax/ under the name "mathjaxApp" gives it. The app draws with it the formulas of a paper that has none
drawn beforehand (no math.json, or one of other formulas); its service worker keeps it once used, and when such a
paper is kept offline. One-file pages keep the CDN address (their formulas are drawn when they are written).

    python3 tools/get_mathjax.py      # again after changing the MathJax version in theme.json (and "mathjaxApp")
"""

import json
import sys
import urllib.request
from pathlib import Path

VIEWER = Path(__file__).resolve().parent.parent / "viewer"


def main():
    theme = json.loads((VIEWER / "theme.json").read_text())
    url, name = theme["mathjax"], theme["mathjaxApp"]
    out = VIEWER / name
    out.parent.mkdir(exist_ok=True)
    for old in out.parent.glob("*.js"):
        old.unlink()
    data = urllib.request.urlopen(url, timeout=60).read()
    out.write_bytes(data)
    (out.parent / "LICENSE.txt").write_text(
        "MathJax (https://www.mathjax.org), from %s\n\nCopyright (c) 2009-2022 The MathJax Consortium\n"
        "Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0\n" % url)
    print("wrote %s (%.1f MB)" % (out, len(data) / 1e6))


if __name__ == "__main__":
    sys.exit(main())
