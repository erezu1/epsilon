"""Load each converted page at phone width (390px) in headless Chrome and report horizontal overflow.

An element counts as overflowing when it reaches past the screen edge and is not inside one of the
page's own sideways-scrolling containers (equations, tables, code). The page must never be wider
than the screen."""
import json, re, subprocess, sys, tempfile
from pathlib import Path

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROBE = r"""
<script>
window.addEventListener('load', function () {
  var f = document.getElementById('f');
  function run() {
    var d = f.contentDocument, w = f.contentWindow, vw = d.documentElement.clientWidth, bad = [];
    var all = d.querySelectorAll('main *, .l2m-bar *, .l2m-menu, .l2m-fnsheet, .l2m-viewer');
    for (var k = 0; k < all.length && bad.length < 12; k++) {
      var el = all[k];
      if (el.closest('.eqbody, .table-wrap, pre, .viewer-stage, .l2m-menu .menu-inner, svg')) continue;
      var r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1 && w.getComputedStyle(el).position !== 'fixed') {
        bad.push((el.tagName + '.' + (el.className && el.className.baseVal === undefined ? el.className : '')).slice(0, 40) +
                 ' right=' + Math.round(r.right) + ' "' + (el.textContent || '').trim().slice(0, 50) + '"');
      }
    }
    var out = {scrollWidth: d.documentElement.scrollWidth, clientWidth: vw, offenders: bad};
    var pre = document.createElement('pre'); pre.id = 'res'; pre.textContent = JSON.stringify(out);
    document.body.appendChild(pre);
  }
  setTimeout(run, 1500);
});
</script>"""

def check(page):
    tmp = Path(tempfile.mkdtemp())
    frame = tmp / "frame.html"
    frame.write_text('<!doctype html><html><body style="margin:0"><iframe id="f" src="%s" '
                     'style="width:390px;height:800px;border:0"></iframe>%s</body></html>' % (page.resolve().as_uri(), PROBE))
    r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--allow-file-access-from-files",
                        "--window-size=600,900", "--virtual-time-budget=12000", "--dump-dom", frame.as_uri()],
                       capture_output=True, text=True, timeout=300)
    m = re.search(r'<pre id="res">(.*?)</pre>', r.stdout, re.S)
    return json.loads(m.group(1).replace("&quot;", '"').replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")) if m else None

if __name__ == "__main__":
    pages = [Path(p) for p in sys.argv[1:]]
    worst = 0
    for p in pages:
        res = check(p)
        if res is None:
            print(p, "could not measure"); continue
        over = res["scrollWidth"] - res["clientWidth"]
        worst = max(worst, over)
        print("%-60s page width %d / screen %d %s" % (p.parent.name if p.name == "paper.html" else p.name,
              res["scrollWidth"], res["clientWidth"], "OK" if over <= 0 else "TOO WIDE by %dpx" % over))
        for o in res["offenders"]:
            print("      ", o)
    sys.exit(1 if worst > 0 else 0)
