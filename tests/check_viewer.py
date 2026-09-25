"""Open every stored paper in the shared viewer at phone width (390px) and compare it with its static page.

    python3 check_viewer.py FOLDER [--browser-math]

FOLDER holds one subfolder per paper with paper.html and paper.l2m/ (as written by run_arxiv.py).
A site with all of them is built in a temporary folder and served locally; headless Chrome then loads
each paper in the site's viewer (fetching paper.json) and, next to it, its one-file page (paper.html,
everything inline). They must have the same text and the same number of formulas, and the viewer
page must not be wider than the screen. With --browser-math the
site is built without math.json, so the browser draws every formula (slower).
"""
import functools, http.server, json, re, shutil, subprocess, sys, tempfile, threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROBE = r"""<!doctype html><html><body style="margin:0">
<iframe id="v" src="site/index.html?p=%(id)s" style="width:390px;height:800px;border:0"></iframe>
<iframe id="s" src="static/%(id)s.html" style="width:390px;height:800px;border:0"></iframe>
<script>
function norm(t) { return (t || "").replace(/\s+/g, " ").trim(); }
function wide(d, w) {
  var vw = d.documentElement.clientWidth, bad = [];
  d.querySelectorAll("main *").forEach(function (el) {
    if (bad.length > 5 || el.closest(".eqbody, .table-wrap, pre, svg")) return;
    var r = el.getBoundingClientRect();
    if (r.width && r.right > vw + 1 && w.getComputedStyle(el).position !== "fixed")
      bad.push(el.tagName + " right=" + Math.round(r.right) + " " + norm(el.textContent).slice(0, 40));
  });
  return bad;
}
function report(o) {
  var pre = document.createElement("pre"); pre.id = "res"; pre.textContent = JSON.stringify(o);
  document.body.appendChild(pre);
}
window.addEventListener("load", function () {
  var v = document.getElementById("v"), s = document.getElementById("s");
  var tries = 0;
  (function wait() {
    var w = v.contentWindow, sw = s.contentWindow;
    if (!w.L2M_current || !sw.L2M_current) { if (++tries < 600) return setTimeout(wait, 50); return report({error: "a page did not start"}); }
    Promise.all([w.L2M_current.ready, sw.L2M_current.ready]).then(function () {
      var vd = v.contentDocument, sd = s.contentDocument;
      var vm = vd.querySelector("main"), sm = sd.querySelector("main");
      var vc = vm.cloneNode(true);   // the viewer's own "All papers" link is not part of the paper
      vc.querySelectorAll(".l2m-libnav").forEach(function (e) { e.remove(); });
      var vt = norm(vc.textContent), st = norm(sm.textContent), at = -1;
      if (vt !== st) { at = 0; while (vt[at] === st[at]) at++; }
      report({
        sameText: vt === st, firstDiff: at < 0 ? "" : vt.slice(Math.max(0, at - 30), at + 30) + " | " + st.slice(Math.max(0, at - 30), at + 30),
        formulas: vm.querySelectorAll("mjx-container").length, staticFormulas: sm.querySelectorAll("mjx-container").length,
        placeholders: vd.querySelectorAll("l2m-math").length,
        scrollWidth: vd.documentElement.scrollWidth, clientWidth: vd.documentElement.clientWidth, offenders: wide(vd, v.contentWindow)
      });
    });
  })();
});
</script></body></html>"""


def main():
    folder = Path(sys.argv[1]).resolve()
    browser_math = "--browser-math" in sys.argv
    papers = sorted(p for p in folder.iterdir() if (p / "paper.l2m" / "paper.json").exists() and (p / "paper.html").exists())
    tmp = Path(tempfile.mkdtemp(prefix="l2m-viewer-check-"))
    cmd = [sys.executable, str(HERE.parent / "epsilon_viewer.py"), "build", str(tmp / "site"), "--local-mathjax", "-q"]
    if browser_math:
        cmd.append("--no-math-cache")
    subprocess.run(cmd + [str(p / "paper.l2m") for p in papers], check=True)
    (tmp / "static").mkdir()
    for p in papers:
        shutil.copy(p / "paper.html", tmp / "static" / (p.name + ".html"))
        (tmp / ("probe_%s.html" % p.name)).write_text(PROBE % {"id": p.name})
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = functools.partial(Quiet, directory=str(tmp))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    bad = 0
    for p in papers:
        r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--window-size=900,900",
                            "--virtual-time-budget=60000", "--dump-dom",
                            "http://127.0.0.1:%d/probe_%s.html" % (port, p.name)],
                           capture_output=True, text=True, timeout=600)
        m = re.search(r'<pre id="res">(.*?)</pre>', r.stdout, re.S)
        res = json.loads(m.group(1).replace("&quot;", '"').replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")) if m else {"error": "no result"}
        ok = (not res.get("error") and res["sameText"] and res["formulas"] == res["staticFormulas"]
              and res["placeholders"] == 0 and res["scrollWidth"] <= res["clientWidth"])
        bad += not ok
        if res.get("error"):
            print("%-12s FAIL  %s" % (p.name, res["error"]))
            continue
        print("%-12s %s  text %s  formulas %d/%d  width %d/%d" % (
            p.name, "ok  " if ok else "FAIL", "same" if res["sameText"] else "DIFFERENT", res["formulas"],
            res["staticFormulas"], res["scrollWidth"], res["clientWidth"]))
        if not res["sameText"]:
            print("      viewer | static:", res["firstDiff"])
        for o in res["offenders"]:
            print("      ", o)
    server.shutdown()
    shutil.rmtree(tmp, ignore_errors=True)
    print("%d of %d papers failed" % (bad, len(papers)))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
