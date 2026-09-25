"""Unpack arXiv sources in a folder, convert each paper with Epsilon, and summarise."""
import gzip, io, json, re, subprocess, sys, tarfile, time
from pathlib import Path

root = Path(sys.argv[1]).resolve()
tool = Path(__file__).resolve().parent.parent / "epsilon_convert.py"
results = []
for d in sorted(p for p in root.iterdir() if p.is_dir()):
    src = d / "src.bin"
    sd = d / "src"
    if not sd.exists():
        sd.mkdir()
        raw = src.read_bytes()
        try:
            with tarfile.open(fileobj=io.BytesIO(raw)) as t:
                t.extractall(sd, filter="data")
        except tarfile.ReadError:
            data = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
            if data[:4] == b"%PDF":
                (sd / "paper.pdf").write_bytes(data)
            else:
                (sd / "main.tex").write_bytes(data)
    cands = []
    for f in sd.rglob("*.tex"):
        t = f.read_text(errors="replace")
        if re.search(r"^[^%\n]*\\documentclass", t, re.M) and "\\begin{document}" in t:
            cands.append((len(t), f))
    if not cands:
        results.append(dict(id=d.name, status="no main .tex (PDF-only or unusual)"))
        continue
    main = max(cands)[1]
    out = d / "paper.html"
    t0 = time.time()
    try:
        r = subprocess.run([sys.executable, str(tool), str(main), "-o", str(d / "paper.l2m"), "--html", str(out)], capture_output=True, text=True, timeout=900)
        log = r.stdout + r.stderr
        status = "ok" if r.returncode == 0 and out.exists() else "FAILED"
    except subprocess.TimeoutExpired:
        log, status = "timeout", "TIMEOUT"
    (d / "convert.log").write_text(log)
    warns = log.split("warnings:\n", 1)[1].strip().splitlines() if "warnings:\n" in log else []
    m = re.search(r"\((\d+) formulas, (\d+) footnotes\)", log)
    mb = re.search(r"\(([\d.]+) MB\)", log)
    results.append(dict(id=d.name, main=str(main.relative_to(d)), status=status, secs=round(time.time() - t0, 1),
                        mb=float(mb.group(1)) if mb else None, formulas=int(m.group(1)) if m else None,
                        warnings=len(warns), warn_lines=warns, tail=log.strip().splitlines()[-3:] if status != "ok" else []))
    print(d.name, status, results[-1].get("secs"), "s", results[-1].get("formulas"), "formulas", len(warns), "warnings", flush=True)
(root / "results.json").write_text(json.dumps(results, indent=1))
