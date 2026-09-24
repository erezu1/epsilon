#!/usr/bin/env python3
"""l2m_library: a library of latex2mobile papers kept in a folder (the private repo erezu1/l2m-library).

    python3 l2m_library.py convert 2609.28331 2609.28280     # arXiv papers: fetch, convert, add
    python3 l2m_library.py convert outdated                  # reconvert papers made by an older converter
    python3 l2m_library.py add-draft path/to/paper.tex        # copy a LaTeX project in, convert it
    python3 l2m_library.py drafts                            # convert drafts whose sources changed
    python3 l2m_library.py feed                              # refresh feed.json (new papers in your categories)
    python3 l2m_library.py list

Options: --library DIR (default: the current folder), --push (commit and push the changes with git).

The folder:
    config.json      {"categories": ["hep-th"], "crossLists": false}   what the feed follows
    library.json     the papers, for the app's list
    feed.json        new arXiv papers in the categories, the last few announcements
    papers/<key>/    each paper's document (paper.json, images/, math.json)
    sources/arxiv/<key>/src.bin, sources/drafts/<name>/   what they were made from, to reconvert later
"""

import argparse
import datetime
import gzip
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from latex2mobile import __version__ as CONVERTER  # noqa: E402

UA = "l2m-library/1.0 (+https://github.com/erezu1/l2m-app)"
ARXIV_ID = re.compile(r"^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?/\d{7})(v\d+)?$")
DEFAULT_CONFIG = {"categories": ["hep-th"], "crossLists": False}
FEED_DAYS = 7


def now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def say(msg):
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- the library folder
class Library:
    def __init__(self, root):
        self.root = Path(root).resolve()

    def read(self, name, default):
        f = self.root / name
        return json.loads(f.read_text()) if f.exists() else default

    def write(self, name, data):
        (self.root / name).write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n")

    def config(self):
        c = dict(DEFAULT_CONFIG)
        c.update(self.read("config.json", {}))
        return c

    def index(self):
        return self.read("library.json", {"name": "Papers", "papers": []})

    def put(self, entry):
        lib = self.index()
        lib["papers"] = [p for p in lib["papers"] if p["key"] != entry["key"]] + [entry]
        lib["papers"].sort(key=lambda p: p.get("added", ""), reverse=True)
        self.write("library.json", lib)

    def entry(self, key):
        return next((p for p in self.index()["papers"] if p["key"] == key), None)


# ---------------------------------------------------------------- arXiv
def http_get(url, tries=3):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError) as e:
            if k == tries - 1:
                raise
            say("  retrying %s (%s)" % (url, e))
            time.sleep(5 * (k + 1))


def arxiv_key(aid):
    return re.sub(r"v\d+$", "", aid).replace("/", "_")


def arxiv_meta(aid):
    """Title, authors, abstract, categories and dates from the arXiv API."""
    xml = http_get("https://export.arxiv.org/api/query?id_list=" + re.sub(r"v\d+$", "", aid))
    ns = {"a": "http://www.w3.org/2005/Atom", "x": "http://arxiv.org/schemas/atom"}
    e = ET.fromstring(xml).find("a:entry", ns)
    if e is None or e.find("a:title", ns) is None:
        raise ValueError("arXiv has no paper %s" % aid)
    clean = lambda t: re.sub(r"\s+", " ", t or "").strip()
    full = e.find("a:id", ns).text.rsplit("/abs/", 1)[-1]
    prim = e.find("x:primary_category", ns)
    return {"id": re.sub(r"v\d+$", "", full), "version": (re.search(r"v(\d+)$", full) or [None, None])[1],
            "title": clean(e.find("a:title", ns).text),
            "authors": [clean(a.find("a:name", ns).text) for a in e.findall("a:author", ns)],
            "abstract": clean(e.find("a:summary", ns).text),
            "primary": prim.get("term") if prim is not None else None,
            "categories": [c.get("term") for c in e.findall("a:category", ns)],
            "published": clean(e.find("a:published", ns).text)[:10]}


def unpack(raw, dest):
    """An arXiv source download: a tar archive, a gzipped single .tex file, or a PDF."""
    dest.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(fileobj=io.BytesIO(raw)) as t:
            try:
                t.extractall(dest, filter="data")
            except TypeError:                      # Python without extraction filters
                t.extractall(dest, members=[m for m in t.getmembers()
                                            if not (m.name.startswith("/") or ".." in Path(m.name).parts)])
    except tarfile.ReadError:
        data = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
        (dest / ("paper.pdf" if data[:4] == b"%PDF" else "main.tex")).write_bytes(data)


def main_tex(folder):
    """The main file: the longest .tex with \\documentclass and \\begin{document}."""
    cands = []
    for f in Path(folder).rglob("*.tex"):
        t = f.read_text(errors="replace")
        if re.search(r"^[^%\n]*\\documentclass", t, re.M) and "\\begin{document}" in t:
            cands.append((len(t), str(f)))
    return Path(max(cands)[1]) if cands else None


def run_converter(tex, out, kicker, title=None):
    cmd = [sys.executable, str(HERE / "latex2mobile.py"), str(tex), "-o", str(out), "-q"]
    if kicker:
        cmd += ["--kicker", kicker]
    if title:
        cmd += ["--title", title]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    ok = r.returncode == 0 and (Path(out) / "paper.json").exists()
    return ok, (r.stdout + r.stderr).strip()


def convert_arxiv(lib, aid, refetch=True):
    key = arxiv_key(aid)
    src_dir = lib.root / "sources" / "arxiv" / key
    say("%s: %s" % (key, "fetching" if refetch else "reconverting"))
    meta = arxiv_meta(aid)
    time.sleep(3)                                  # arXiv asks for a pause between requests
    if refetch or not (src_dir / "src.bin").exists():
        raw = http_get("https://arxiv.org/e-print/" + aid)
        time.sleep(3)
        src_dir.mkdir(parents=True, exist_ok=True)
        (src_dir / "src.bin").write_bytes(raw)
    entry = {"key": key, "path": "papers/" + key, "kind": "arxiv", "title": meta["title"],
             "authors": meta["authors"], "arxiv": meta, "added": (lib.entry(key) or {}).get("added") or now()}
    with tempfile.TemporaryDirectory(prefix="l2m-src-") as tmp:
        unpack((src_dir / "src.bin").read_bytes(), Path(tmp))
        tex = main_tex(tmp)
        if tex is None:
            entry.update(status="failed", error="no LaTeX source (PDF only, or an unusual layout)")
        else:
            out = lib.root / "papers" / key
            if out.exists():
                shutil.rmtree(out)
            ok, log = run_converter(tex, out, "arXiv:" + meta["id"])
            entry.update(status="ok" if ok else "failed", source=tex.name)
            if not ok:
                entry["error"] = log[-800:]
    entry.update(converted=now(), converter=CONVERTER)
    lib.put(entry)
    say("  %s" % entry["status"])
    return entry


# ---------------------------------------------------------------- drafts (LaTeX projects pushed in)
def tree_hash(folder):
    h = hashlib.sha1()
    for f in sorted(p for p in Path(folder).rglob("*") if p.is_file()):
        h.update(str(f.relative_to(folder)).encode() + b"\0" + f.read_bytes())
    return h.hexdigest()[:16]


def project_files(tex):
    """The files a LaTeX project needs: the main file, what it \\inputs, its figures and bibliography,
    and the .sty/.cls/.bst/.bib/.bbl files next to it. Nothing else from the folder is taken."""
    root = tex.parent
    need, todo, seen = set(), [tex], set()
    gpath = [root]
    while todo:
        f = todo.pop()
        if f in seen or not f.exists():
            continue
        seen.add(f)
        need.add(f)
        t = re.sub(r"(?<!\\)%.*", "", f.read_text(errors="replace"))
        for m in re.finditer(r"\\graphicspath\s*\{((?:\{[^}]*\})+)\}", t):
            gpath += [(root / g).resolve() for g in re.findall(r"\{([^}]*)\}", m.group(1))]
        for m in re.finditer(r"\\(?:input|include|subfile)\s*\{([^}]+)\}", t):
            n = m.group(1).strip()
            todo.append(root / (n if n.endswith(".tex") else n + ".tex"))
        for m in re.finditer(r"\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}", t):
            n = m.group(1).strip()
            for d in gpath:
                for ext in ("", ".pdf", ".png", ".jpg", ".jpeg", ".eps", ".svg"):
                    if (d / (n + ext)).is_file():
                        need.add(d / (n + ext))
        for m in re.finditer(r"\\(?:bibliography|addbibresource)\s*\{([^}]+)\}", t):
            for n in m.group(1).split(","):
                n = n.strip()
                need.add(root / (n if n.endswith(".bib") else n + ".bib"))
    for pat in ("*.sty", "*.cls", "*.bst", "*.bbx", "*.cbx"):
        need.update(root.glob(pat))
    need.add(tex.with_suffix(".bbl"))
    return sorted(p for p in need if p.is_file() and (p.parent == root or root in p.resolve().parents))


def add_draft(lib, tex, name=None):
    tex = Path(tex).resolve()
    name = name or tex.stem
    if not re.fullmatch(r"[\w.~-]+", name):
        sys.exit("l2m_library: a draft name may only use letters, digits and . _ ~ -")
    dest = lib.root / "sources" / "drafts" / name
    if dest.exists():
        shutil.rmtree(dest)
    for f in project_files(tex):
        target = dest / f.resolve().relative_to(tex.parent)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, target)
    say("%s: copied %d files" % (name, sum(1 for p in dest.rglob("*") if p.is_file())))
    return convert_draft(lib, name)


def convert_draft(lib, name):
    folder = lib.root / "sources" / "drafts" / name
    tex = main_tex(folder)
    old = lib.entry(name) or {}
    entry = {"key": name, "path": "papers/" + name, "kind": "draft", "added": old.get("added") or now(),
             "sourceHash": tree_hash(folder)}
    if tex is None:
        entry.update(status="failed", error="no main .tex file", title=name, authors=[])
    else:
        out = lib.root / "papers" / name
        if out.exists():
            shutil.rmtree(out)
        with tempfile.TemporaryDirectory(prefix="l2m-draft-") as tmp:
            work = Path(tmp) / "src"
            shutil.copytree(folder, work)           # LaTeX writes nothing into the library
            ok, log = run_converter(work / tex.relative_to(folder), out, "Draft")
        entry.update(status="ok" if ok else "failed", source=tex.name)
        if ok:
            doc = json.loads((out / "paper.json").read_text())
            entry.update(title=doc.get("title") or name, authors=doc.get("authors", []))
        else:
            entry.update(error=log[-800:], title=old.get("title", name), authors=old.get("authors", []))
    entry.update(converted=now(), converter=CONVERTER)
    lib.put(entry)
    say("%s: %s" % (name, entry["status"]))
    return entry


def changed_drafts(lib):
    root = lib.root / "sources" / "drafts"
    out = []
    for d in sorted(p for p in root.iterdir() if p.is_dir()) if root.exists() else []:
        e = lib.entry(d.name)
        if not e or e.get("sourceHash") != tree_hash(d):
            out.append(d.name)
    return out


def outdated(lib):
    def ver(v):
        return tuple(int(x) for x in re.findall(r"\d+", v or "0"))
    return [p for p in lib.index()["papers"] if ver(p.get("converter")) < ver(CONVERTER)]


# ---------------------------------------------------------------- the feed
def fetch_feed(lib):
    """New papers in the configured categories, from arXiv's RSS feeds (one announcement each)."""
    cfg = lib.config()
    kinds = {"new", "cross"} if cfg.get("crossLists") else {"new"}
    ns = {"arxiv": "http://arxiv.org/schemas/atom", "dc": "http://purl.org/dc/elements/1.1/"}
    old = lib.read("feed.json", {"items": []})
    items = {(i["id"], i["category"]): i for i in old.get("items", [])}
    for cat in cfg["categories"]:
        if not re.fullmatch(r"[a-z-]+(\.[A-Za-z-]+)?", cat):
            say("skipping odd category %r" % cat)
            continue
        xml = http_get("https://rss.arxiv.org/rss/" + cat)
        time.sleep(3)
        chan = ET.fromstring(xml).find("channel")
        day = chan.findtext("pubDate") or ""
        try:
            announced = datetime.datetime.strptime(day[:16], "%a, %d %b %Y").date().isoformat()
        except ValueError:
            announced = now()[:10]
        for it in chan.findall("item"):
            kind = (it.findtext("arxiv:announce_type", namespaces=ns) or "").strip()
            if kind not in kinds:
                continue
            aid = it.findtext("link", "").rsplit("/abs/", 1)[-1].strip()
            desc = it.findtext("description", "")
            abstract = re.sub(r"\s+", " ", desc.split("Abstract:", 1)[-1]).strip()
            authors = [a.strip() for a in re.split(r",\s*|\s+and\s+", it.findtext("dc:creator", "", ns)) if a.strip()]
            items[(aid, cat)] = {"id": aid, "title": re.sub(r"\s+", " ", it.findtext("title", "")).strip(),
                                 "authors": authors, "abstract": abstract, "category": cat, "type": kind,
                                 "announced": announced}
        say("%s: %s" % (cat, announced))
    cutoff = (datetime.date.today() - datetime.timedelta(days=FEED_DAYS)).isoformat()
    keep = [i for i in items.values() if i["announced"] >= cutoff and i["category"] in cfg["categories"]
            and i["type"] in kinds]
    keep.sort(key=lambda i: (i["announced"], i["id"]), reverse=True)
    lib.write("feed.json", {"updated": now(), "categories": cfg["categories"], "crossLists": cfg.get("crossLists", False),
                            "items": keep})
    say("feed: %d papers" % len(keep))


# ---------------------------------------------------------------- git
def push(lib, message):
    def git(*a):
        return subprocess.run(["git", "-C", str(lib.root)] + list(a), capture_output=True, text=True)
    git("add", "-A")
    if not git("status", "--porcelain").stdout.strip():
        say("nothing to commit")
        return
    git("commit", "-q", "-m", message)
    for _ in range(3):
        if git("push", "-q").returncode == 0:
            say("pushed")
            return
        git("pull", "-q", "--rebase")
    sys.exit("l2m_library: git push failed")


def main():
    ap = argparse.ArgumentParser(description="A library of latex2mobile papers in a folder.")
    ap.add_argument("--library", default=".", help="the library folder (default: the current folder)")
    ap.add_argument("--push", action="store_true", help="commit and push the changes with git")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("convert", help="fetch and convert arXiv papers (ids, or 'outdated')")
    c.add_argument("ids", nargs="+")
    d = sub.add_parser("add-draft", help="copy a LaTeX project into the library and convert it")
    d.add_argument("tex")
    d.add_argument("--name")
    sub.add_parser("drafts", help="convert the drafts whose sources changed")
    sub.add_parser("feed", help="refresh feed.json")
    sub.add_parser("list", help="list the papers")
    a = ap.parse_args()
    lib = Library(a.library)
    if a.cmd == "convert":
        ids = " ".join(a.ids).replace(",", " ").split()
        if ids == ["outdated"]:
            todo = outdated(lib)
            say("%d papers made by an older converter" % len(todo))
            for p in todo:
                if p["kind"] == "arxiv":
                    convert_arxiv(lib, p["arxiv"]["id"], refetch=False)
                else:
                    convert_draft(lib, p["key"])
            msg = "Reconvert %d papers with converter %s" % (len(todo), CONVERTER)
        else:
            clean = []
            for i in ids:
                i = re.sub(r"^(https?://)?(www\.)?arxiv\.org/(abs|pdf|html)/", "", i.strip()).removesuffix(".pdf")
                if not ARXIV_ID.match(i):
                    sys.exit("l2m_library: not an arXiv id: %r" % i)
                clean.append(i)
            for i in clean:
                convert_arxiv(lib, i)
            msg = "Add " + ", ".join(clean)
    elif a.cmd == "add-draft":
        e = add_draft(lib, a.tex, a.name)
        msg = "Draft " + e["key"]
    elif a.cmd == "drafts":
        names = changed_drafts(lib)
        for n in names:
            convert_draft(lib, n)
        msg = "Convert drafts: " + (", ".join(names) or "none")
    elif a.cmd == "feed":
        fetch_feed(lib)
        msg = "Feed " + now()[:10]
    else:
        for p in lib.index()["papers"]:
            print("%-22s %-7s %s" % (p["key"], p.get("status"), p.get("title", "")[:70]))
        return
    if a.push:
        push(lib, msg)


if __name__ == "__main__":
    main()
