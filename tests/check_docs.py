"""Rebuild every page from its stored document and check it is identical to the direct conversion.

    python3 check_docs.py FOLDER     # FOLDER holds one subfolder per paper with paper.html and paper.l2m/
"""
import subprocess, sys, time
from pathlib import Path

render = Path(__file__).resolve().parent.parent / "l2m_render.py"
folder = Path(sys.argv[1])
bad = 0
for d in sorted(p for p in folder.iterdir() if (p / "paper.l2m").is_dir()):
    t0 = time.time()
    out = d / "rebuilt.html"
    r = subprocess.run([sys.executable, str(render), str(d / "paper.l2m"), "-o", str(out), "-q"],
                       capture_output=True, text=True)
    same = r.returncode == 0 and out.exists() and out.read_bytes() == (d / "paper.html").read_bytes()
    doc_mb = sum(f.stat().st_size for f in (d / "paper.l2m").rglob("*") if f.is_file()) / 1e6
    page_mb = (d / "paper.html").stat().st_size / 1e6
    print("%-12s %s  rebuild %4.1f s  document %5.2f MB  page %5.2f MB"
          % (d.name, "identical" if same else "DIFFERENT", time.time() - t0, doc_mb, page_mb))
    if not same:
        bad += 1
        print(r.stderr[-800:])
    out.unlink(missing_ok=True)
print("%d different" % bad)
sys.exit(1 if bad else 0)
