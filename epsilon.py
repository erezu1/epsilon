#!/usr/bin/env python3
"""Push a LaTeX note into the Epsilon app (the library repo on GitHub), where it is converted and shows in the
library. The same --id updates the same note, in place, as often as you like.

    epsilon.py NOTE.tex --id my-note          a whole LaTeX file (with its figures, .bib, ... beside it)
    epsilon.py FOLDER --id my-note            a LaTeX project folder (its main .tex is found)
    epsilon.py BODY.tex --id my-note --title "Notes on X"
                                               a note's body only (no \\documentclass): a standard preamble
                                               (amsmath, amssymb, mathtools, amsthm, graphicx, tikz, hyperref)
                                               is put around it
    cat body.tex | epsilon.py - --id my-note --title "..."    the same, from standard input
    epsilon.py --remove my-note               take the note out of the library
    epsilon.py --list                         the notes and drafts in the library

It waits for the conversion (a minute or two) and prints the link to the note, or the converter's error; with
--no-wait it returns at once. With --here it converts on this machine first (needs TeX and Node, as
epsilon_convert.py does) and pushes the result: quicker, and errors come back at once.

Ids: letters, digits and . _ ~ - (not an arXiv number). Needs git access to the library repo (gh or git
credentials); the library is found in L2M_LIBRARY, in ./library next to this script, or cloned once into
~/.cache/epsilon-library.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import epsilon_library as L  # noqa: E402

REPO = os.environ.get("L2M_REPO", "erezu1/epsilon-library")
APP = os.environ.get("L2M_APP", "https://erezu1.github.io/epsilon/")

PREAMBLE = r"""\documentclass[11pt]{article}
\usepackage[utf8]{inputenc}
\usepackage{amsmath,amssymb,amsthm,mathtools}
\usepackage{graphicx,xcolor,tikz}
\usepackage{hyperref}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{proposition}[theorem]{Proposition}
\newtheorem{corollary}[theorem]{Corollary}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\newtheorem{example}[theorem]{Example}
\theoremstyle{remark}
\newtheorem{remark}[theorem]{Remark}
"""


def die(msg):
    sys.exit("epsilon: " + msg)


def git(root, *a, check=True):
    r = subprocess.run(["git", "-C", str(root)] + list(a), capture_output=True, text=True)
    if check and r.returncode != 0:
        die("git %s failed: %s" % (a[0], (r.stderr or r.stdout).strip()))
    return r


def library_clone():
    for cand in [os.environ.get("L2M_LIBRARY"), str(HERE / "library")]:
        if cand and (Path(cand) / ".git").exists():
            return Path(cand)
    cache = Path.home() / ".cache" / "epsilon-library"
    if not (cache / ".git").exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        if shutil.which("gh"):
            r = subprocess.run(["gh", "repo", "clone", REPO, str(cache), "--", "-q"], capture_output=True, text=True)
        else:
            r = subprocess.run(["git", "clone", "-q", "https://github.com/%s.git" % REPO, str(cache)], capture_output=True, text=True)
        if r.returncode != 0:
            die("could not clone %s: %s" % (REPO, (r.stderr or r.stdout).strip()))
    return cache


def check_id(i):
    if not re.fullmatch(r"[\w.~-]+", i or ""):
        die("an id may only use letters, digits and . _ ~ -")
    if L.ARXIV_ID.match(i) or re.fullmatch(r"\d{4}\.\d{4,5}(v\d+)?", i):
        die("an id must not look like an arXiv number")


def wrap(body, title, author):
    """A note's body (no \\documentclass) as a whole document."""
    head = PREAMBLE + ("\\title{%s}\n" % title if title else "") + ("\\author{%s}\n" % author if author else "\\author{}\n")
    return head + "\\date{}\n\\begin{document}\n" + ("\\maketitle\n" if title else "") + body.strip() + "\n\\end{document}\n"


def stage(src, nid, title, author, dest):
    """The note's files, as they go into the library: DEST/<main>.tex and what it needs."""
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    if src == "-":
        text, base = sys.stdin.read(), Path.cwd()
    else:
        p = Path(src).expanduser().resolve()
        if p.is_dir():
            tex = L.main_tex(p)
            if tex is None:
                die("no main .tex file (with \\documentclass and \\begin{document}) in %s" % p)
            p = tex
        if not p.is_file():
            die("no such file: %s" % src)
        text, base = p.read_text(errors="replace"), p.parent
        if re.search(r"^[^%\n]*\\documentclass", text, re.M):
            # a whole document: it and what it uses, as they are
            for f in L.project_files(p):
                t = dest / f.resolve().relative_to(p.parent)
                t.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, t)
            if title:
                print("epsilon: --title is ignored for a whole document (its own \\title is used)", file=sys.stderr)
            return
    if re.search(r"^[^%\n]*\\documentclass", text, re.M):
        (dest / (nid + ".tex")).write_text(text)
    else:
        (dest / (nid + ".tex")).write_text(wrap(text, title, author))
    # the figures and bibliography it names, from the folder it came from
    tmp = base / (".epsilon-%d.tex" % os.getpid())
    try:
        tmp.write_text((dest / (nid + ".tex")).read_text())
        for f in L.project_files(tmp):
            if f == tmp:
                continue
            t = dest / f.resolve().relative_to(base)
            t.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, t)
    except OSError:
        pass                                    # a read-only folder: the note without its figures
    finally:
        if tmp.exists():
            tmp.unlink()


def remote_entry(root, nid):
    git(root, "fetch", "-q", "origin", "main")
    r = git(root, "show", "origin/main:library.json", check=False)
    if r.returncode != 0:
        return None
    for p in json.loads(r.stdout).get("papers", []):
        if p.get("key") == nid:
            return p
    return None


def wait_for(root, nid, sha, since, timeout=900):
    t0 = time.time()
    print("converting on GitHub", end="", flush=True)
    while time.time() - t0 < timeout:
        time.sleep(12)
        print(".", end="", flush=True)
        e = remote_entry(root, nid)
        if e and e.get("sourceHash") == sha and e.get("converted", "") >= since:
            print()
            return e
    print()
    return None


def main():
    ap = argparse.ArgumentParser(description="Push a LaTeX note into the Epsilon app; the same --id updates it.",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("source", nargs="?", help="a .tex file, a LaTeX folder, or - for standard input")
    ap.add_argument("--id", help="the note's identifier (the same id updates the same note)")
    ap.add_argument("--title", help="the title, for a note given by its body only")
    ap.add_argument("--author", help="the author(s), for a note given by its body only")
    ap.add_argument("--here", action="store_true", help="convert on this machine, then push the result")
    ap.add_argument("--no-wait", action="store_true", help="do not wait for the conversion on GitHub")
    ap.add_argument("--remove", metavar="ID", help="take the note ID out of the library")
    ap.add_argument("--list", action="store_true", help="list the notes and drafts in the library")
    a = ap.parse_args()

    root = library_clone()
    git(root, "pull", "-q", "--rebase")
    lib = L.Library(str(root))

    if a.list:
        for p in lib.index().get("papers", []):
            if p.get("kind") in ("draft", "note"):
                print("%-28s %-6s %s  %s" % (p["key"], p.get("status"), p.get("converted", "")[:16], p.get("title", "")))
        return
    if a.remove:
        check_id(a.remove)
        d = root / "sources" / "drafts" / a.remove
        if not d.exists() and not lib.entry(a.remove):
            die("no note %s" % a.remove)
        L.remove(lib, [a.remove])
        L.push(lib, "Remove note " + a.remove)
        print("removed", a.remove)
        return

    if not a.source or not a.id:
        ap.error("give a source and --id")
    check_id(a.id)
    dest = root / "sources" / "drafts" / a.id
    stage(a.source, a.id, a.title, a.author, dest)
    (dest / ".l2m-note").write_text("pushed by epsilon\n")
    sha = L.tree_hash(dest)
    old = lib.entry(a.id)
    if old and old.get("sourceHash") == sha and old.get("status") == "ok":
        print("unchanged:", APP + "?p=" + a.id)
        return
    since = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()
    if a.here:
        e = L.convert_draft(lib, a.id)
        L.push(lib, "Note " + a.id)
        print(("ok: " if e.get("status") == "ok" else "failed: ") + APP + "?p=" + a.id)
        if e.get("status") != "ok":
            print(e.get("error", ""), file=sys.stderr)
            sys.exit(1)
        return
    L.push(lib, "Note " + a.id)
    link = APP + "?p=" + a.id
    if a.no_wait:
        print("pushed; converting on GitHub (a minute or two):", link)
        return
    e = wait_for(root, a.id, sha, since)
    if not e:
        print("still converting (see the repo's Actions tab); it will appear at", link)
    elif e.get("status") == "ok":
        print("ok:", link)
    else:
        print("failed:", link, file=sys.stderr)
        print(e.get("error", ""), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
