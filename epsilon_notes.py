#!/usr/bin/env python3
"""epsilon_notes: the reader's marks and notes on the papers of an Epsilon library, read and added to from here (by
Claude, through epsilon_library.py's notes, text, mark and unmark commands). The app writes them as notes/<key>.json
in the library: {"paper": key, "marks": {id: mark}}, a mark being

    {"id", "c" (1 green, 2 pink, 3 violet, 4 orange), "quote" (the words it marks), "pre", "post" (some words before and after
     them), "start", "end" (their place in the paper's text), "sec" (its section's heading id), "ver" (the conversion
     it was placed in), "made", "at" (milliseconds), "note" (if any), "by" (who made it, if not the reader),
     "was" (its words before the paper was revised, if they changed)}

or {"id", "gone": true, "at"} once removed (kept, so the removal reaches every device).

A paper's text is read as the app reads it (viewer/marks.js): its words with each run of spaces as one, each formula
as its TeX between $ signs, a line between blocks. A mark is found by its words: at its place if they are still
there, else where they are (those before and after choosing between repeats), else, the paper revised, where words
nearly the same are (at most a quarter of their characters changed).

Marks are written through GitHub's API (the gh login), as the app writes them: read with the file's sha, written
against it, again on a conflict; so a mark from here and one from the app never overwrite each other.
"""

import base64
import html.parser
import json
import os
import random
import re
import subprocess
import sys
import time
from pathlib import Path

APP = os.environ.get("L2M_APP", "https://erezu1.github.io/epsilon/")
COLOURS = {"green": 1, "pink": 2, "violet": 3, "orange": 4}
NAMES = {1: "green", 2: "pink", 3: "violet", 4: "orange"}

# ---------------------------------------------------------------- the paper's text, as the app reads it
WS = set(" \n\t\r\f    ")
BLOCK_TAGS = {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "figcaption", "td", "th", "dt", "dd", "blockquote", "pre"}
BLOCK_CLASSES = {"display", "thm", "titleblock"}
SKIP_TAGS = {"svg", "script", "style", "button", "textarea", "input", "l2m-slot"}
SKIP_CLASSES = {"skel-paper", "l2m-mark", "l2m-mk-layer", "l2m-libnav", "l2m-actions", "mjx-hl"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
# HTML's own rule (as the browser builds the page): a paragraph open when one of these begins is ended there, so the
# words after a displayed formula within a <p> stand outside it, in the paper's own text
P_CLOSERS = {"address", "article", "aside", "blockquote", "center", "details", "dialog", "dir", "div", "dl", "fieldset",
             "figcaption", "figure", "footer", "header", "hgroup", "main", "menu", "nav", "ol", "p", "search", "section",
             "summary", "ul", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "listing", "form", "li", "dd", "dt", "plaintext",
             "table", "hr", "xmp"}
P_SCOPE = {"applet", "caption", "html", "table", "td", "th", "marquee", "object", "template", "button"}


class _Reader(html.parser.HTMLParser):
    def __init__(self, items):
        super().__init__(convert_charrefs=True)
        self.items, self.stack, self.out, self.length = items, [], [], 0
        self.space, self.last, self.skip, self.heads = True, None, 0, []

    def _block(self):
        for x in reversed(self.stack):
            if x["tag"] in BLOCK_TAGS or x["cls"] & BLOCK_CLASSES:
                return x
        return None

    def _emit(self, s):
        self.out.append(s)
        self.length += len(s)

    def _ends_line(self):
        return self.out and self.out[-1].endswith("\n")

    def _enter(self):                              # (a piece of text or a formula: in which block)
        b = self._block()
        if b is not self.last:
            if self.length and not self._ends_line():
                self._emit("\n")
            self.space, self.last = True, b
            if b and b["tag"] in ("h2", "h3", "h4", "h5") and b["id"]:
                self.heads.append({"a": self.length, "id": b["id"], "level": int(b["tag"][1]), "el": b})

    def _close_p(self):                            # (a paragraph open, within reach: ended, and what it holds)
        for i in range(len(self.stack) - 1, -1, -1):
            t = self.stack[i]["tag"]
            if t == "p":
                self.skip -= sum(1 for x in self.stack[i:] if x["skip"])
                del self.stack[i:]
                return
            if t in P_SCOPE:
                return

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = set((a.get("class") or "").split())
        if tag in P_CLOSERS:
            self._close_p()
        if tag == "l2m-math" and not self.skip:
            self._enter()
            item = self.items[int(a.get("n", 0))] if a.get("n", "").isdigit() and int(a["n"]) < len(self.items) else {}
            self._emit("$" + " ".join(str(item.get("tex", "")).split()) + "$")
            self.space = False
        if tag in VOID:
            return
        node = {"tag": tag, "cls": cls, "id": a.get("id"), "text": [],
                "skip": tag in SKIP_TAGS or "hidden" in a or bool(cls & SKIP_CLASSES) or (tag == "details" and "toc" in cls)}
        self.stack.append(node)
        if node["skip"]:
            self.skip += 1

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i]["tag"] == tag:
                self.skip -= sum(1 for x in self.stack[i:] if x["skip"])
                del self.stack[i:]
                return

    def handle_data(self, d):
        if self.skip:
            return
        for x in self.stack:                       # (a heading's own words, for its name)
            if x["tag"] in ("h2", "h3", "h4", "h5"):
                x["text"].append(d)
        self._enter()
        out, space = [], self.space
        for ch in d:
            if ch in WS:
                if not space:
                    out.append(" ")
                    space = True
            else:
                out.append(ch)
                space = False
        self.space = space
        if out:
            self._emit("".join(out))


def paper_text(doc):
    """The paper's text as the app reads it, and its sections: (text, [{a, id, level, title}])."""
    r = _Reader((doc.get("math") or {}).get("items") or [])
    r.feed(doc.get("body") or "")
    r.close()
    heads = [{"a": h["a"], "id": h["id"], "level": h["level"], "title": " ".join("".join(h["el"]["text"]).split())} for h in r.heads]
    return "".join(r.out), heads


def head_at(heads, s):
    h = None
    for x in heads:
        if x["a"] <= s:
            h = x
    return h


# ---------------------------------------------------------------- finding a mark
def _common(a, b, back=False):
    n, k = min(len(a), len(b)), 0
    while k < n and ((a[-1 - k] == b[-1 - k]) if back else (a[k] == b[k])):
        k += 1
    return k


def _align(q, t):
    """q against the stretch of t it fits best (q's every character, any stretch of t): (start, end, edits)."""
    w = len(t)
    prev, ps = [0] * (w + 1), list(range(w + 1))
    for i in range(1, len(q) + 1):
        qc, cur, cs = q[i - 1], [i] + [0] * w, [0] * (w + 1)
        for j in range(1, w + 1):
            sub = prev[j - 1] + (qc != t[j - 1])
            dele, ins = prev[j] + 1, cur[j - 1] + 1
            if sub <= dele and sub <= ins:
                cur[j], cs[j] = sub, ps[j - 1]
            elif dele <= ins:
                cur[j], cs[j] = dele, ps[j]
            else:
                cur[j], cs[j] = ins, cs[j - 1]
        prev, ps = cur, cs
    end = min(range(w + 1), key=lambda j: prev[j])
    return ps[end], end, prev[end]


WORDY = re.compile(r"[\w'’]")


def whole(C, s, e):
    """A stretch of the text as whole words, without spaces at its ends."""
    while s < e and C[s] in WS:
        s += 1
    while e > s and C[e - 1] in WS:
        e -= 1
    while s > 0 and WORDY.match(C[s - 1]) and WORDY.match(C[s]):
        s -= 1
    while e < len(C) and WORDY.match(C[e]) and WORDY.match(C[e - 1]):
        e += 1
    return s, e


def nearly(C, q, pre="", post="", least=0.75):
    """Where words nearly q stand in C (a quarter of their characters changed at most): (start, end, likeness) or None."""
    n = len(q)
    if n < 12:
        return None
    K = 8 if n < 60 else 12
    step, votes, B = max(1, (n - K) // 20), {}, 16
    for o in range(0, n - K + 1, step):
        g = q[o:o + K]
        if len(g.strip()) < 6:
            continue
        hits, i = [], C.find(g)
        while i >= 0 and len(hits) <= 40:
            hits.append(i)
            i = C.find(g, i + 1)
        if not hits or len(hits) > 40:
            continue
        for p in hits:
            b = round((p - o) / B)
            votes[b] = votes.get(b, 0) + 1
    weight = lambda b: votes.get(b, 0) + 0.5 * (votes.get(b - 1, 0) + votes.get(b + 1, 0))
    best = None
    for b in sorted((b for b in votes if weight(b) >= 2), key=weight, reverse=True)[:4]:
        est, slack = b * B, max(24, round(n * 0.35))
        w0, w1 = max(0, est - slack), min(len(C), est + n + slack)
        if n <= 700:
            a, z, d = _align(q, C[w0:w1])
            s, e, sim = w0 + a, w0 + z, 1 - d / n
        else:                                       # a long one: its first and last words, each laid against the text
            H = 240
            z0 = max(0, est + n - H - slack)
            a1, _, d1 = _align(q[:H], C[w0:min(len(C), est + H + slack)])
            _, z2, d2 = _align(q[-H:], C[z0:w1])
            s, e, sim = w0 + a1, z0 + z2, 1 - (d1 + d2) / (2 * H)
            if e - s < n * 0.5 or e - s > n * 1.6:
                continue
        if sim < least or e <= s:
            continue
        score = sim + 0.003 * (_common(C[max(0, s - 40):s], pre, True) + _common(C[e:e + 40], post))
        if not best or score > best[2]:
            best = (s, e, score, sim)
    if not best:
        return None
    s, e = whole(C, best[0], best[1])
    return s, e, best[3]


def locate(C, m):
    """Where a mark is in the text: (start, end), or None."""
    q = m.get("quote") or ""
    if not q:
        return None
    s, e = m.get("start", 0), m.get("end", 0)
    if C[s:e] == q:
        return s, e
    best, best_score, i, seen = -1, None, C.find(q), 0
    while i >= 0 and seen < 300:
        seen += 1
        score = (_common(C[max(0, i - len(m.get("pre") or "")):i], m.get("pre") or "", True) +
                 _common(C[i + len(q):i + len(q) + len(m.get("post") or "")], m.get("post") or "") -
                 abs(i - s) / (len(C) + 1))
        if best_score is None or score > best_score:
            best, best_score = i, score
        i = C.find(q, i + 1)
    if best >= 0:
        return best, best + len(q)
    r = nearly(C, q, m.get("pre") or "", m.get("post") or "")
    return (r[0], r[1]) if r else None


# ---------------------------------------------------------------- the library's files
def load(lib, key):
    """(the paper's document, its entry in library.json)."""
    f = Path(lib) / "papers" / key / "paper.json"
    if not f.exists():
        sys.exit("epsilon_notes: no paper %r in the library (see epsilon_library.py list)" % key)
    idx = json.loads((Path(lib) / "library.json").read_text())
    entry = next((p for p in idx.get("papers", []) if p.get("key") == key), {})
    return json.loads(f.read_text()), entry


def marks_of(lib, key):
    f = Path(lib) / "notes" / (key + ".json")
    return (json.loads(f.read_text()).get("marks") or {}) if f.exists() else {}


def live(m):
    return m and not m.get("gone") and m.get("quote")


def link(key, mid=None):
    return APP + "?p=" + key + ("#mark-" + mid if mid else "")


def pull(lib):                                      # the library's copy brought up to date (when it is a git clone)
    if (Path(lib) / ".git").exists():
        subprocess.run(["git", "-C", str(lib), "pull", "-q", "--rebase", "--autostash"], capture_output=True)


# ---------------------------------------------------------------- written as the app writes: GitHub's API, by sha
def repo_of(lib):
    if os.environ.get("EPSILON_NOTES_API"):
        return os.environ.get("EPSILON_NOTES_REPO", "x/y")
    url = subprocess.run(["git", "-C", str(lib), "remote", "get-url", "origin"], capture_output=True, text=True).stdout.strip()
    m = re.search(r"github\.com[:/]([^/]+/[^/.]+?)(?:\.git)?$", url)
    if not m:
        sys.exit("epsilon_notes: the library %s is not a clone of a GitHub repository" % lib)
    return m.group(1)


def _gh(args, data=None):
    test = os.environ.get("EPSILON_NOTES_API")    # (tests: a stand-in for GitHub's API at this address, no gh)
    if test:
        import urllib.error
        import urllib.request
        method = args[1] if args[0] == "-X" else "GET"
        path = [a for a in args if a.startswith("repos/")][0]
        req = urllib.request.Request(test.rstrip("/") + "/" + path, method=method,
                                     data=json.dumps(data).encode() if data is not None else None,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return 0, r.read().decode(), ""
        except urllib.error.HTTPError as e:
            return 1, e.read().decode(), "HTTP %d" % e.code
    r = subprocess.run(["gh", "api"] + args, input=json.dumps(data) if data is not None else None, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def read_remote(repo, path):
    """(data, sha) of a file in the repository; (None, None) if there is none."""
    code, out, err = _gh(["repos/%s/contents/%s" % (repo, path)])
    if code:
        if "404" in err or "Not Found" in (out + err):
            return None, None
        sys.exit("epsilon_notes: could not read %s: %s" % (path, (err or out).strip()))
    j = json.loads(out)
    return json.loads(base64.b64decode(j["content"]).decode("utf-8")), j["sha"]


def change_remote(repo, path, change, message):
    """Read, change (change(data) -> new data), and write back against the sha it was read with; again on a conflict."""
    for attempt in range(5):
        data, sha = read_remote(repo, path)
        new = change(data)
        body = {"message": message, "content": base64.b64encode((json.dumps(new, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")).decode()}
        if sha:
            body["sha"] = sha
        code, out, err = _gh(["-X", "PUT", "repos/%s/contents/%s" % (repo, path), "--input", "-"], body)
        if not code:
            return new
        if "409" not in (out + err) and "does not match" not in (out + err) and "sha" not in (out + err):
            sys.exit("epsilon_notes: could not write %s: %s" % (path, (err or out).strip()))
        time.sleep(1 + attempt)                     # (someone wrote it meanwhile: theirs read again)
    sys.exit("epsilon_notes: %s kept changing; try again" % path)


def write_marks(lib, key, change, message):
    """A paper's marks changed (change(marks) changes them in place) in the library, and its count with them."""
    repo = repo_of(lib)

    def notes(d):
        d = d or {"paper": key, "marks": {}}
        d.setdefault("marks", {})
        change(d["marks"])
        return d
    d = change_remote(repo, "notes/%s.json" % key, notes, message)
    n = sum(1 for m in d["marks"].values() if live(m))
    w = sum(1 for m in d["marks"].values() if live(m) and m.get("note"))

    def counts(r):                                  # (the library's rows say how many: kept in reading.json)
        r = r or {}
        r.setdefault("marks", {})[key] = {"n": n, "w": w, "at": int(time.time() * 1000)}
        return r
    change_remote(repo, "reading.json", counts, "Reading places")
    pull(lib)
    return d["marks"]


# ---------------------------------------------------------------- the commands
def cmd_notes(lib, key=None):
    pull(lib)
    if not key:
        idx = json.loads((Path(lib) / "library.json").read_text())
        titles = {p["key"]: p.get("title", "") for p in idx.get("papers", [])}
        rows = []
        for f in sorted((Path(lib) / "notes").glob("*.json")) if (Path(lib) / "notes").exists() else []:
            ms = [m for m in (json.loads(f.read_text()).get("marks") or {}).values() if live(m)]
            if ms:
                rows.append((f.stem, len(ms), sum(1 for m in ms if m.get("note")), titles.get(f.stem, "(not in the library)")))
        if not rows:
            print("No marks yet.")
        for k, n, w, t in rows:
            print("%-22s %3d mark%s %3d with notes  %s" % (k, n, " " if n == 1 else "s", w, t))
        return
    doc, entry = load(lib, key)
    C, heads = paper_text(doc)
    ms = marks_of(lib, key)
    found, lost = [], []
    for m in ms.values():
        if not live(m):
            continue
        r = locate(C, m)
        (found if r else lost).append((r[0] if r else 0, m, r))
    found.sort(key=lambda x: x[0])
    nn = sum(1 for _, m, _ in found + lost if m.get("note"))
    tot = len(found) + len(lost)
    print("%s (%s): %d mark%s, %d with notes" % (entry.get("title") or doc.get("title") or key, key, tot, "" if tot == 1 else "s", nn))
    print(link(key))
    last = None
    for _, m, r in found:
        h = head_at(heads, r[0])
        if h is not last:
            print("\n" + (h["title"] if h else "(before the first section)"))
            last = h
        show_mark(key, m, C[r[0]:r[1]])
    if lost:
        print("\nNot found in this version")
        for _, m, _ in lost:
            show_mark(key, m, m.get("quote"))


def show_mark(key, m, words):
    print("  %-6s “%s”%s" % (NAMES.get(m.get("c"), "green"), words, "  (marked by %s)" % m["by"] if m.get("by") else ""))
    if m.get("note"):
        print("         note: " + m["note"].replace("\n", "\n               "))
    if m.get("was"):
        print("         (its words changed; they read: “%s”)" % m["was"])
    print("         " + link(key, m["id"]))


def cmd_text(lib, key, section=None):
    pull(lib)
    doc, _ = load(lib, key)
    C, heads = paper_text(doc)
    if not section:
        print(C)
        return
    want = section.strip()
    h = next((x for x in heads if x["id"] == want or x["title"] == want or x["title"].startswith(want + " ")), None)
    if not h:
        sys.exit("epsilon_notes: no section %r; the sections:\n  %s" % (section, "\n  ".join("%s  (%s)" % (x["title"], x["id"]) for x in heads)))
    after = [x for x in heads if x["a"] > h["a"] and x["level"] <= h["level"]]
    print(C[h["a"]:after[0]["a"] if after else len(C)].rstrip())


def _loose(s):                                     # (quotes, dashes and case let go of: one character for one)
    return s.translate(str.maketrans("“”‘’–—−", "\"\"''--" + "-")).lower()


def find_words(C, words):
    """Where the words stand in the text: (start, end, how) or exits saying why not."""
    w = " ".join(words.split())
    hits = [m.start() for m in re.finditer(re.escape(w), C)]
    how = "exactly"
    if not hits:
        lc, lw = _loose(C), _loose(w)
        hits = [m.start() for m in re.finditer(re.escape(lw), lc)]
        how = "with quotes, dashes or case let go of"
    if len(hits) > 1:
        sys.exit("epsilon_notes: the words are in the paper %d times; give a few more of them, to say which" % len(hits))
    if hits:
        return hits[0], hits[0] + len(w), how
    r = nearly(C, w, least=0.88)
    if r:
        return r[0], r[1], "nearly (%d%% alike)" % round(100 * r[2])
    sys.exit("epsilon_notes: the words are not in the paper (its text, as the app reads it: epsilon_library.py text <key>)")


def cmd_mark(lib, key, words, note=None, colour="violet", by="Claude"):
    pull(lib)
    doc, entry = load(lib, key)
    C, heads = paper_text(doc)
    s, e, how = find_words(C, words)
    s, e = whole(C, s, e)
    now = int(time.time() * 1000)
    mid = "m" + _b36(now) + "".join(random.choice("0123456789abcdefghijklmnopqrstuvwxyz") for _ in range(4))
    h = head_at(heads, s)
    m = {"id": mid, "c": COLOURS.get(colour, 3), "quote": C[s:e], "pre": C[max(0, s - 40):s], "post": C[e:e + 40],
         "start": s, "end": e, "sec": h["id"] if h else "", "ver": entry.get("converted", ""), "made": now, "at": now, "by": by}
    if note:
        m["note"] = note.strip()

    def add(marks):
        marks[mid] = m
    write_marks(lib, key, add, "Notes on %s (a mark by %s)" % (key, by))
    print("marked (%s) in %s: “%s”" % (how, h["title"] if h else key, C[s:e]))
    print("link: " + link(key, mid))


def cmd_unmark(lib, key, mid):
    pull(lib)
    if mid not in marks_of(lib, key):
        sys.exit("epsilon_notes: no mark %s on %s (see epsilon_library.py notes %s)" % (mid, key, key))

    def drop(marks):
        marks[mid] = {"id": mid, "gone": True, "at": int(time.time() * 1000)}
    write_marks(lib, key, drop, "Notes on %s (a mark removed)" % key)
    print("removed " + mid)


def _b36(n):
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = "0123456789abcdefghijklmnopqrstuvwxyz"[r] + s
    return s or "0"
