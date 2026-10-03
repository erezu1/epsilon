// Epsilon paper view: reading bar (back / contents / top / settings), footnote sheet and figure
// viewer. Every internal link becomes a history step, so the browser's back button and the bar's back
// button both return to the exact place the reader left.
//
// L2M_nav(opts) starts it on the page viewer.js has drawn and returns {destroy}, so one page can open
// and close many papers. opts: key (which paper; history entries are tagged with it), theme,
// ready (a promise: the saved place is restored once formulas and images are in), onLibrary; marks (where the host
// keeps the reader's marks: marks.js draws them), textReady (a promise: the text and formulas in, for the marks).
// A piece of glass that moves (a sheet rising, the peek dragged) keeps its film where it is on the screen: the film's
// colours belong to where one looks from (the angle), not to the glass, so the glass moves through them. For ms
// milliseconds (a transition's length; 0: once, now) the film is set against the glass's place on the screen.
window.L2M_pinFilm = function (el, ms) {
  if (!el) return;
  var end = performance.now() + (ms || 0);
  (function step() {
    var r = el.getBoundingClientRect();
    el.style.setProperty("--film-x", -Math.round(r.left) + "px");
    el.style.setProperty("--film-y", -Math.round(r.top) + "px");
    if (performance.now() < end) requestAnimationFrame(step);
  })();
};
window.L2M_nav = function (opts) {
  "use strict";
  opts = opts || {};
  var KEY = opts.key || "";
  var theme = opts.theme || {};
  var DEF = theme.defaults || {};
  var ALWAYS = theme.barShows !== "afterTitle";   // the bar is always shown, or only once the title block is passed
  var dead = false, offs = [];
  function on(target, type, fn, o) { target.addEventListener(type, fn, o); offs.push([target, type, fn, o]); }
  var bar = document.getElementById("l2m-bar");
  if (!bar) return {destroy: function () {}};
  function part(sel) { return bar.querySelector(sel) || document.createElement("button"); }   // a theme may leave one out
  var root = document.documentElement;
  var menu = document.getElementById("l2m-menu");
  var sheet = document.getElementById("l2m-fnsheet");
  var sheetBody = sheet ? sheet.querySelector(".sheet-body") : null;
  var sheetNum = sheet ? sheet.querySelector(".sheet-num") : null;
  var titleBtn = part(".bar-title");
  var titleInner = bar.querySelector(".bar-title-inner") || document.createElement("span");
  var backBtn = part('[data-act="back"]');
  var topBtn = part('[data-act="top"]');
  var docTitle = titleInner.innerHTML;
  var trigger = document.querySelector(".titleblock") || document.querySelector("main h2, main h3");
  var heads = Array.prototype.filter.call(
    document.querySelectorAll("main h2[id], main h3[id]"),
    function (h) { return !h.closest(".titleblock"); }
  );
  var menuLinks = menu ? menu.querySelectorAll("a") : [];
  var idx = 0;          // position of the current entry among the entries this page pushed
  var mem = [];         // fallback stack when the History API is unavailable
  var useHistory = true;
  var shown = ALWAYS;
  var panels = {menu: menu, settings: document.getElementById("l2m-settings")};
  var panel = null;       // "menu" | "settings" | null
  var activeRef = null;

  function state() { try { return history.state || {}; } catch (e) { return {}; } }
  function assign(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

  try {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    var st0 = state();
    idx = typeof st0.l2mIdx === "number" && st0.l2mPaper === KEY ? st0.l2mIdx : 0;
    history.replaceState(assign(st0, {l2mIdx: idx, l2mPaper: KEY}), "");
  } catch (e) { useHistory = false; }

  function barHeight() { return bar.getBoundingClientRect().height; }
  function offset() { return barHeight() + 14; }
  function yOf(el) { return Math.max(0, el.getBoundingClientRect().top + window.pageYOffset - offset()); }
  function scrollToY(y) { window.scrollTo(0, y); }
  // A place kept in the history (where Back returns) by the page's block there and how far into it, as well as by its
  // height on the page: blocks far from the view are laid out by the browser only as they come near (theme.css), so
  // heights above a place can change between leaving it and coming back; the block is still the block
  function placeAt(y) {
    var kids = document.querySelector("main").children, lo = 0, hi = kids.length - 1, base = window.pageYOffset;
    if (!kids.length) return null;
    while (lo < hi) {                                   // (the last one whose top is at or above y: by halving)
      var mid = (lo + hi + 1) >> 1;
      if (kids[mid].getBoundingClientRect().top + base <= y) lo = mid; else hi = mid - 1;
    }
    return {n: lo, d: Math.round(y - (kids[lo].getBoundingClientRect().top + base))};
  }
  function yAt(st) {                                    // a kept place's height now (its block's, else as it was kept)
    var b = st && st.l2mB, el = b && document.querySelector("main").children[b.n];
    return el ? Math.max(0, el.getBoundingClientRect().top + window.pageYOffset + b.d) : st.l2mY;
  }
  function kept(y) { return {l2mY: y, l2mB: placeAt(y)}; }
  // Where a jump lands is held there while the page around it is laid out: the blocks near it may be laid out only now
  // (theme.css: far from the view they are skipped, at an estimate of their height), a frame or two after the jump, and
  // their true heights would move the target. For a moment after (till the reader touches or scrolls the page), each
  // time the page's height changes, the target is put back where it landed: in the browser's step after laying out and
  // before drawing (a ResizeObserver), so nothing is seen to move
  var touched = 0;
  function moving() { touched = Date.now(); }
  on(window, "wheel", moving, {passive: true});
  on(window, "touchstart", moving, {passive: true});
  on(document, "keydown", function (e) {            // (a key that scrolls the page; not one typed in a field: the
    var t = e.target;                               // search's Enter, that made the jump)
    if (/^(Arrow(Up|Down)|Page(Up|Down)|Home|End| )$/.test(e.key) && !(t && t.closest && t.closest("input, textarea, select, [contenteditable]"))) moving();
  });
  function landOn(where, box) {         // where(): the scroll the target wants now (null: none); box: its scroller
    var t0 = Date.now(), done = false, frames = 0, ro = null;
    function end() { done = true; if (ro) ro.disconnect(); }
    function hold() {
      if (done) return;
      if (dead || touched > t0 || Date.now() - t0 > 1500) { end(); return; }
      var y = where(), now = box ? box.scrollTop : window.pageYOffset;
      if (y == null || !isFinite(y)) { end(); return; }
      if (Math.abs(y - now) >= 1) { if (box) box.scrollTo(0, y); else scrollToY(y); }
      placeFlash();                       // (the highlight on what it lit, as it moves)
    }
    if (window.ResizeObserver) {
      ro = new ResizeObserver(hold);
      ro.observe(box ? (box.firstElementChild || box) : document.querySelector("main"));
    }
    (function frame() { requestAnimationFrame(function () { hold(); if (!done && ++frames < 40) frame(); else end(); }); })();
  }
  // what an address's #… names: an id (a \label's, made URL-safe: eq:shock → eq-shock; a section's), or a number as
  // the paper prints it: #eq-2.18 (equation (2.18)), #section-2.3, #figure-3, #table-1
  function linked(hash) {
    var name = decodeURIComponent(String(hash || "").replace(/^#/, "")), hit = null;
    if (!name) return null;
    var el = document.getElementById(name);
    if (el) return el;
    var m = /^(eq|equation|sec|section|fig|figure|tab|table)[-:]?\(?([\w.]+?)\)?$/i.exec(name), main = document.querySelector("main");
    if (!m || !main) return null;
    var kind = m[1].slice(0, 2).toLowerCase(), n = m[2];
    function first(sel, test, box) {
      Array.prototype.some.call(main.querySelectorAll(sel), function (x) { if (test(x.textContent)) { hit = x.closest(box) || x; return true; } });
    }
    if (kind === "eq") first(".eqno", function (t) { return t.replace(/[\s()]/g, "") === n; }, ".display");
    else if (kind === "se") first(".secnum", function (t) { return t.trim() === n; }, "h1, h2, h3, h4, h5, h6");
    else first(".capname", function (t) { return t.trim().replace(/\.$/, "") === (kind === "fi" ? "Figure " : "Table ") + n; }, "figure");
    return hit;
  }

  // where a link lands: a soft mark laid over the block for a moment, tinting what is under it (so an
  // equation's own grounds and fades cannot hide it), in the progress bar's blue
  var flashing = null;                     // the highlight a jump left, and what it lights: {m, t, box}
  function flash(el) {
    var t = el.closest(".display, .thm, .defn, .remark, figure, li, h2, h3, h4, h5, p") || el;
    var box = t.closest(".peek-main") || document.body;
    var old = box.querySelector(":scope > .l2m-mark");
    if (old) old.remove();
    var m = document.createElement("div");
    m.className = "l2m-mark";
    m.setAttribute("aria-hidden", "true");
    flashing = {m: m, t: t, box: box};
    placeFlash();
    m.addEventListener("animationend", function () { m.remove(); if (flashing && flashing.m === m) flashing = null; });
    box.appendChild(m);
  }
  function placeFlash() {                   // (and again while the page around it settles: landOn)
    var f = flashing;
    if (!f) return;
    var r = f.t.getBoundingClientRect(), b = f.box.getBoundingClientRect(), page = f.box === document.body;
    var x0 = page ? window.pageXOffset : -b.left, y0 = page ? window.pageYOffset : -b.top;
    f.m.style.left = (r.left + x0 - 8) + "px";
    f.m.style.top = (r.top + y0 - 5) + "px";
    f.m.style.width = (r.width + 16) + "px";
    f.m.style.height = (r.height + 10) + "px";
  }

  function saveHere() {
    if (!useHistory) return;
    try { history.replaceState(assign(state(), assign({l2mIdx: idx, l2mPaper: KEY}, kept(window.pageYOffset))), ""); } catch (e) {}
  }

  // a step in the history to the place y, the address naming it (#name): back returns to where the reader was
  function jumpTo(y, name) {
    if (finding) closeFind("jump");
    var from = window.pageYOffset;
    if (useHistory) {
      try {
        history.replaceState(assign(state(), assign({l2mIdx: idx, l2mPaper: KEY}, kept(from))), "");
        var next = assign({l2mIdx: idx + 1, l2mId: name, l2mPaper: KEY}, kept(y));
        try { history.pushState(next, "", "#" + name); } catch (e1) { history.pushState(next, ""); }
        idx += 1;
      } catch (e2) { useHistory = false; mem.push(from); }
    } else {
      mem.push(from);
    }
    scrollToY(y);
    update();
  }
  function navigate(id) {
    var el = document.getElementById(id);
    if (!el) return false;
    if (finding) closeFind("jump");
    jumpTo(id === "l2m-top" ? 0 : yOf(el), id);
    if (id !== "l2m-top") { flash(el); landOn(function () { return yOf(el); }); }
    return true;
  }

  function goBack() {
    if (useHistory && idx > 0) { saveHere(); history.back(); return; }
    if (mem.length) { scrollToY(mem.pop()); update(); return; }
    if (opts.onLibrary) opts.onLibrary();    // nothing left to go back to in the paper: the library
  }

  var skipPop = false;       // the history step of a panel being closed by hand: already handled
  // The peek, a note's sheet and the figure viewer each take a step in the history, in the order they open: back
  // closes the one opened last, and only it (a note closed leaves the peek open, and the other way round). Closed by
  // hand, its step goes too (back, when it is the last one; else its mark is taken off the entry). So does a selection
  // (with the bar to mark it): back lets it go first, as it closes a sheet. What opens over a selection (a note's
  // sheet, the search, a panel, the peek) takes its step for its own, and the selection goes
  var overlays = [], stepAt = {};   // stepAt: where in the history each one's step is (to go back to it exactly)
  var marks = null;          // the marks in the paper (marks.js), where the host keeps them
  function here() { try { return window.navigation && navigation.currentEntry ? navigation.currentEntry.index : -1; } catch (e) { return -1; } }
  function backTo(at) {      // back to before the step at "at", past any left above it (a sheet closed as a link was
    var now = here();        // followed); else one step
    skipPop = true;
    history.go(at >= 0 && now >= at ? at - now - 1 : -1);
  }
  function stepIn(o) {       // the step of what opens (o: its mark on the entry): the selection's, if that is the last
    var st = state();
    if (!o.l2mSel && overlays[overlays.length - 1] === "l2mSel" && st.l2mSel) {
      overlays.pop();
      if (marks) marks.dropSel();
      st = assign(st, o); delete st.l2mSel;
      history.replaceState(st, "");
    } else history.pushState(assign(st, o), "");
  }
  function overlayIn(flag) {
    if (!useHistory) return;
    try { var o = {}; o[flag] = true; stepIn(o); overlays.push(flag); stepAt[flag] = here(); } catch (e) {}
  }
  function overlayOut(flag, how) {           // how: "pop" (back did it), "hand" (the reader), else something follows
    var i = overlays.lastIndexOf(flag);
    if (i < 0) return;
    overlays.splice(i, 1);
    if (how === "pop" || !useHistory) return;
    try {
      if (how === "hand" && i === overlays.length && state()[flag]) backTo(stepAt[flag]);
      else if (state()[flag]) { var st = assign(state(), {}); delete st[flag]; history.replaceState(st, ""); }
    } catch (e) {}
  }
  function closeOverlay(flag, how) {
    if (flag === "l2mPeek") closePeek(how); else if (flag === "l2mSheet") closeSheet(how);
    else if (flag === "l2mMark") { if (marks) marks.closeSheet(how); }
    else if (flag === "l2mSel") { overlayOut(flag, how); if (marks) marks.dropSel(); }
    else if (flag === "l2mFound") {
      overlayOut(flag, how);
      root.classList.remove("l2m-find-off");
      if (selRides) { selRides = false; if (marks) marks.dropSel(); }
    }
    else closeViewer(how);
  }
  on(window, "popstate", function (e) {
    if (opts.leaving && opts.leaving()) return;    // the host is taking the reader out of the paper
    if (skipPop) { skipPop = false; return; }
    if (panel) { closeMenu("pop"); return; }       // back closes the open panel, nothing else
    if (finding && !(e.state && e.state.l2mFind)) { closeFind("pop"); return; }   // then the search
    var top = overlays[overlays.length - 1];      // then the peek, sheet or viewer opened last
    if (top && !(e.state && e.state[top])) { closeOverlay(top, "pop"); return; }
    var st = e.state;
    if (st && st.l2mPaper !== undefined && st.l2mPaper !== KEY) return;   // another paper's entry: the host switches
    if (st && typeof st.l2mIdx === "number") {
      idx = st.l2mIdx;
      var el = st.l2mId ? document.getElementById(st.l2mId) : null;
      if (typeof st.l2mY === "number") { scrollToY(yAt(st)); landOn(function () { return yAt(st); }); }
      else if (el) { scrollToY(yOf(el)); landOn(function () { return yOf(el); }); }
    } else if (marks && /^#mark-/.test(location.hash)) {
      marks.reveal(decodeURIComponent(location.hash.slice(6)));
    } else if (location.hash.length > 1) {
      var t = linked(location.hash);
      if (t) { scrollToY(yOf(t)); landOn(function () { return yOf(t); }); }
    }
    closeMenu();
    closeSheet("pop");
    closeViewer("pop");
    update();
  });

  // ---------------------------------------------------------------- panels (contents, settings)
  function hidePanel(name) {
    panels[name].classList.remove("open");
    panels[name].setAttribute("aria-hidden", "true");
  }
  // a panel's list fades out under the bar, and at the bottom, where there is more to scroll
  function edgeFade(box) {
    box.classList.toggle("fade-top", box.scrollTop > 2);
    box.classList.toggle("fade-bottom", box.scrollTop + box.clientHeight < box.scrollHeight - 2);
  }
  Array.prototype.forEach.call(document.querySelectorAll(".menu-inner"), function (box) {
    box.addEventListener("scroll", function () { edgeFade(box); }, {passive: true});
  });
  function openPanel(name) {
    var el = panels[name];
    if (!el || panel === name) return;
    closeSheet();
    if (panel) hidePanel(panel);
    else if (useHistory) {
      try { if (!state().l2mPanel) stepIn({l2mPanel: true}); } catch (e) {}
    }
    panel = name;
    root.style.setProperty("--l2m-bar-h", barHeight() + "px");
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
    bar.classList.add("menu-open");
    root.classList.toggle("l2m-settings-open", name === "settings");
    titleBtn.setAttribute("aria-expanded", name === "menu" ? "true" : "false");
    backBtn.setAttribute("aria-label", name === "menu" ? "Close contents" : "Close settings");
    if (name === "menu") {
      var cur = menu.querySelector("a.current"), box = menu.querySelector(".menu-inner");
      if (cur) box.scrollTop = Math.max(0, box.scrollTop + cur.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 2);
      if (marks) marks.panelOpened();
    } else {
      refreshSettings(true);
    }
    var inner = el.querySelector(".menu-inner");
    if (inner) { edgeFade(inner); requestAnimationFrame(function () { edgeFade(inner); }); }
    update();
  }
  function closeMenu(how) {          // closes whichever panel is open; how: "pop" (by back), "jump" (a link follows)
    if (!panel) return;
    if (window.L2M_endFade) L2M_endFade();
    if (useHistory && how !== "pop") {
      try {
        if (state().l2mPanel) {
          if (how === "jump") { var st = assign(state(), {}); delete st.l2mPanel; history.replaceState(st, ""); }
          else { skipPop = true; history.back(); }
        }
      } catch (e) {}
    }
    hidePanel(panel);
    panel = null;
    var fp = panels.settings && panels.settings.querySelector(".font-pick.open");   // next time, the fonts start folded
    if (fp) setTimeout(function () { fp.classList.remove("open"); fp.querySelector(".font-current").setAttribute("aria-expanded", "false"); }, 320);
    bar.classList.remove("menu-open");
    root.classList.remove("l2m-settings-open");
    titleBtn.setAttribute("aria-expanded", "false");
    backBtn.setAttribute("aria-label", opts.onLibrary ? "Library" : "Back to where you were");
    update();
  }
  function toggle(name) {
    return function (e) {
      e.stopPropagation();
      if (panel === name) closeMenu(); else openPanel(name);
    };
  }


  // ---------------------------------------------------------------- search in the paper: words, or TeX
  // The search field takes the bar (as the library's does). Words are found in the text, as a browser finds them;
  // a query with TeX in it (\phi, x^2, \frac{1}{2}) is looked for in the formulas' TeX. A single symbol (\phi,
  // \alpha, \partial, or "phi", or φ itself) is found as its drawn glyph, in every formula, so a paper's own macros
  // for it are found too, and each one is marked where it stands in its formula; longer TeX marks the formulas
  // whose TeX has it. Found text is marked yellow (a highlight laid over the text, which is left as it is); the
  // match one is on, amber. Enter or the arrows go on to the next (Shift+Enter, back); nothing enters history
  // except the search itself (back closes it).
  var findBar = bar.querySelector(".bar-find"), findBtn = bar.querySelector('[data-act="find"]');
  var findField = findBar ? findBar.querySelector("input") : null, findCount = findBar ? findBar.querySelector(".find-count") : null;
  var finding = false, hits = [], hitAt = -1, findTimer = null, findAt = -1;
  var GLYPH = {alpha: "1D6FC", beta: "1D6FD", gamma: "1D6FE", delta: "1D6FF", epsilon: "1D716", varepsilon: "1D700", zeta: "1D701",
    eta: "1D702", theta: "1D703", vartheta: "1D717", iota: "1D704", kappa: "1D705", varkappa: "1D718", lambda: "1D706", mu: "1D707",
    nu: "1D708", xi: "1D709", pi: "1D70B", varpi: "1D71B", rho: "1D70C", varrho: "1D71A", sigma: "1D70E", varsigma: "1D70D",
    tau: "1D70F", upsilon: "1D710", phi: "1D719", varphi: "1D711", chi: "1D712", psi: "1D713", omega: "1D714", Gamma: "393",
    Delta: "394", Theta: "398", Lambda: "39B", Xi: "39E", Pi: "3A0", Sigma: "3A3", Upsilon: "3A5", Phi: "3A6", Psi: "3A8",
    Omega: "3A9", varGamma: "1D6E4", varDelta: "1D6E5", varTheta: "1D6E9", varLambda: "1D6EC", varXi: "1D6EF", varPi: "1D6F1",
    varSigma: "1D6F4", varUpsilon: "1D6F6", varPhi: "1D6F7", varPsi: "1D6F9", varOmega: "1D6FA", ell: "2113", hbar: "210F",
    hslash: "210F", partial: "1D715", nabla: "2207", infty: "221E", aleph: "2135", wp: "2118", emptyset: "2205", varnothing: "2205"};
  var GREEK = {"α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ϵ": "epsilon", "ε": "varepsilon", "ζ": "zeta", "η": "eta",
    "θ": "theta", "ϑ": "vartheta", "ι": "iota", "κ": "kappa", "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "π": "pi", "ρ": "rho",
    "σ": "sigma", "ς": "varsigma", "τ": "tau", "υ": "upsilon", "ϕ": "phi", "φ": "varphi", "χ": "chi", "ψ": "psi", "ω": "omega",
    "Γ": "Gamma", "Δ": "Delta", "Θ": "Theta", "Λ": "Lambda", "Ξ": "Xi", "Π": "Pi", "Σ": "Sigma", "Υ": "Upsilon", "Φ": "Phi",
    "Ψ": "Psi", "Ω": "Omega", "ℓ": "ell", "ℏ": "hbar", "∂": "partial", "∇": "nabla", "∞": "infty"};
  var BLOCK = "p, li, h1, h2, h3, h4, h5, h6, .display, figcaption, td, th, dt, dd, blockquote, pre, .thm, .titleblock";
  // found words get a marker's stroke laid over them (blended, so the letters stay as they are): its ends slanted as
  // a chisel tip leaves them, each a little tilted and a little off the line, never two quite alike
  var findLayer = null, findLaying = 0;
  function tilt(i) { return {a: -0.5 - ((i * 37) % 11) / 10, dy: (((i * 53) % 5) - 2) * 0.5}; }
  // the stroke's outline in a unit box, for a mark wp x hp pixels: the chisel's slant at its ends and the waver of its
  // edges a few pixels, whatever its size (a big mark stays close to its box; a word's looks drawn)
  function markD(wp, hp) {
    var sx = Math.min(0.28 * hp, 6) / wp, ay = Math.min(0.07 * hp, 1.8) / hp, f = function (v) { return v.toFixed(4); };
    return "M0 " + f(1 - ay) + "L" + f(sx) + " " + f(ay) + "C" + f(0.3) + " 0 " + f(0.65) + " " + f(2 * ay) + " 1 " + f(0.5 * ay) +
      "L" + f(1 - sx) + " " + f(1 - ay) + "C" + f(0.66) + " 1 " + f(0.34) + " " + f(1 - 2 * ay) + " 0 " + f(1 - ay) + "Z";
  }
  function markTilt(a, wp, hp, fs) {              // less tilt on a tall mark, and never more than its ends can bear
    a *= Math.min(1, 1.3 * fs / hp);
    var most = Math.atan(0.22 * hp / wp) * 180 / Math.PI;
    return Math.max(-most, Math.min(most, a));
  }
  // boxes (a range's, a formula's) as one band per line: what a marker's stroke covers, for the search and the marks
  function lines(rects) {
    var out = [];
    rects.filter(function (r) { return r.right - r.left > 0.5 && r.bottom - r.top > 0.5; })
      .sort(function (x, y) { return x.top - y.top || x.left - y.left; })
      .forEach(function (r) {
        var cy = (r.top + r.bottom) / 2;
        for (var k = out.length - 1; k >= 0 && k >= out.length - 3; k--) {
          var b = out[k], by = (b.top + b.bottom) / 2;
          if ((cy >= b.top && cy <= b.bottom) || (by >= r.top && by <= r.bottom)) {
            b.left = Math.min(b.left, r.left); b.right = Math.max(b.right, r.right);
            b.top = Math.min(b.top, r.top); b.bottom = Math.max(b.bottom, r.bottom);
            return;
          }
        }
        out.push({left: r.left, right: r.right, top: r.top, bottom: r.bottom});
      });
    return out;
  }
  // a marker's stroke over the box x, y, w, h (page pixels): its place, size, outline and tilt, as a style; the k-th
  // stroke laid (each a little different)
  function strokeCss(x, y, w, h, k) {
    var t = tilt(k), wp = w + 4, hp = h + 2;
    return "left:" + (x - 2) + "px;top:" + (y - 1 + t.dy) + "px;width:" + wp + "px;height:" + hp + "px;" +
      "clip-path:path('" + markD(wp, hp).replace(/(-?[\d.]+) (-?[\d.]+)/g, function (all, a, b) {
        return (a * wp).toFixed(1) + " " + (b * hp).toFixed(1);
      }) + "');transform:rotate(" + markTilt(t.a, wp, hp, hp).toFixed(2) + "deg)";
  }
  function strokes() {
    if (!findLayer) { findLayer = document.createElement("div"); findLayer.className = "l2m-find-layer"; findLayer.setAttribute("aria-hidden", "true"); }
    if (!findLayer.parentNode) document.body.appendChild(findLayer);
    findLayer.textContent = "";
    var x0 = window.pageXOffset, y0 = window.pageYOffset, k = 0, rects = [];
    // every place first (one layout), then every stroke at once (one insertion)
    hits.forEach(function (h, i) { if (h.range) rects.push([h, i, lines(Array.prototype.slice.call(rectsOf(h)))]); });
    var frag = document.createDocumentFragment();
    rects.forEach(function (e) {
      var h = e[0], i = e[1];
      h.boxes = []; h.rr = [];                       // (rr: its lines on the page, where a tap finds it)
      Array.prototype.forEach.call(e[2], function (r) {
        var m = document.createElement("span");
        m.className = "l2m-find-m" + (i === hitAt ? " now" : "");
        m.style.cssText = strokeCss(r.left + x0, r.top + y0, r.right - r.left, r.bottom - r.top, k++);
        frag.appendChild(m);
        h.boxes.push(m);
        h.rr.push({left: r.left + x0, top: r.top + y0, right: r.right + x0, bottom: r.bottom + y0});
      });
    });
    findLayer.appendChild(frag);
  }
  function relay() {                   // the page moved under them (a formula drawn, the window turned): laid again
    if (!finding || findLaying) return;
    findLaying = requestAnimationFrame(function () { findLaying = 0; if (finding && hits.length) strokes(); });
  }
  on(window, "resize", relay);
  if (window.ResizeObserver) { var findRO = new ResizeObserver(relay); findRO.observe(document.querySelector("main")); }
  function findClear() {
    if (window.CSS && CSS.highlights) { CSS.highlights.delete("l2m-find"); CSS.highlights.delete("l2m-find-now"); }
    if (findLayer) findLayer.textContent = "";
    Array.prototype.forEach.call(document.querySelectorAll("main .l2m-find-g"), function (r) { r.remove(); });
    Array.prototype.forEach.call(document.querySelectorAll("main .l2m-find-f, main .l2m-find-now"), function (e) {
      e.classList.remove("l2m-find-f", "l2m-find-now");
    });
    hits = []; hitAt = -1;
  }
  // what a query looks for: {text} (words), {tex} (TeX in formulas), {glyph} (a symbol, as drawn)
  // operators drawn as upright words (\log, \sin, ...): their letters, as drawn
  var OPNAME = /^(log|ln|lg|exp|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|coth|arcsin|arccos|arctan|det|dim|ker|deg|hom|lim|liminf|limsup|max|min|sup|inf|arg|gcd|Pr|Tr|tr)$/;
  function findWhat(q) {
    q = q.trim();
    if (!q) return null;
    var dm = /^\\\[([\s\S]*)\\\]$/.exec(q);
    if (dm && dm[1].indexOf("\\]") < 0) q = "$" + dm[1] + "$";      // (a displayed formula, as copied: the same)
    var parts = [], last = 0, fm, FORM = /\$([^$]+)\$|\\\[([\s\S]+?)\\\]/g;
    while ((fm = FORM.exec(q))) {                  // words and formulas, as copied: "the trace $\mathrm{Tr}\,\rho$ is"
      if (q.slice(last, fm.index).trim()) parts.push({t: q.slice(last, fm.index)});
      parts.push({f: fm[1] != null ? fm[1] : fm[2]});
      last = FORM.lastIndex;
    }
    if (q.slice(last).trim()) parts.push({t: q.slice(last)});
    if (parts.length > 1 && parts.some(function (x) { return x.f != null; })) return {mixed: parts};
    if (q.charAt(0) === "$") {                       // "$...": the formulas only (the rest read as TeX)
      q = q.slice(1).replace(/\$$/, "").trim();
      if (!q) return null;
      if (GLYPH[q]) q = "\\" + q;
      var c1 = /^\\([A-Za-z]+)$/.exec(q);
      return c1 && GLYPH[c1[1]] ? {glyph: GLYPH[c1[1]], tex: q} : {tex: q};
    }
    if (GREEK[q]) return {glyph: GLYPH[GREEK[q]], tex: "\\" + GREEK[q]};
    var cmd = /^\\([A-Za-z]+)$/.exec(q);
    if (cmd && GLYPH[cmd[1]]) return {glyph: GLYPH[cmd[1]], tex: q};
    if (/[\\^_{}]/.test(q)) return {tex: q};
    var w = {text: q.replace(/[^A-Za-z]/g, "").length >= 3 || /[^A-Za-z\s]/.test(q) && q.length >= 2 ? q.toLowerCase() : null};
    if (GLYPH[q]) { w.glyph = GLYPH[q]; w.tex = "\\" + q; }         // "phi": the word, and the symbol
    else if (/^[A-Za-z]{3,}$/.test(q) && (OPS[q] || OPNAME.test(q))) w.tex = "\\" + q;   // "sum", "log": the word, and the command
    if (!w.text && !w.tex && !w.glyph) return null;              // (too short to look for yet)
    else if (/[^A-Za-z\s]/.test(q)) w.tex = q.replace(/\s+/g, ""); // "O(N)", "a+b": in the text, and in the formulas
    return w;
  }
  function texHas(tex, q) {
    var t = texNorm(tex), i;
    q = texNorm(q); i = t.indexOf(q);
    while (i >= 0) {
      // \phi is not the start of \phiup: after a command name the next character is no letter
      if (!(/\\[A-Za-z]+$/.test(q) && /[A-Za-z]/.test(t.charAt(i + q.length)))) return true;
      i = t.indexOf(q, i + 1);
    }
    return false;
  }
  // the glyphs a piece of TeX draws, in the order a formula's drawing has them (a letter: italic or upright; a
  // command: its symbol; braces, _ and ^ draw nothing); null when it has something this cannot tell
  var OPS = {cdot: "22C5", times: "D7", pm: "B1", mp: "2213", sum: "2211", int: "222B", prod: "220F", oint: "222E", sqrt: "221A",
    langle: "27E8", rangle: "27E9", dagger: "2020", ldots: "2026", cdots: "22EF", to: "2192", rightarrow: "2192", leftarrow: "2190",
    leq: "2264", le: "2264", geq: "2265", ge: "2265", neq: "2260", ne: "2260", approx: "2248", sim: "223C", equiv: "2261",
    propto: "221D", otimes: "2297", oplus: "2295", wedge: "2227", vee: "2228", cap: "2229", cup: "222A", in: "2208",
    subset: "2282", mid: "2223", prime: "2032", star: "22C6", ast: "2217", circ: "2218", bullet: "2219"};
  var QUIET = /^(frac|dfrac|tfrac|mathrm|mathit|mathbf|mathsf|text|textrm|operatorname|left|right|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|,|;|!|quad|qquad|displaystyle|textstyle|scriptstyle)$/;
  var SYM = {"+": "2B", "-": "2212", "=": "3D", "(": "28", ")": "29", "[": "5B", "]": "5D", ",": "2C", ";": "3B", ":": "3A", "!": "21",
    "/": "2F", "<": "3C", ">": "3E", "|": "7C", "'": "2032", "*": "2217", ".": "2E"};
  function hex(c) { return c.toString(16).toUpperCase(); }
  var FONTCMD = /^(mathcal|mathbb|mathfrak|mathscr|boldsymbol|bm|mathbf|mathsf|mathtt|mathit|mathrm|operatorname)$/;
  function glyphsOf(q) {
    var out = [], i = 0, m, wildTo = -1;              // letters in \mathcal{...} and the like: drawn in their own fonts
    while (i < q.length) {
      var c = q.charAt(i);
      if ((m = /^\\([A-Za-z]+|.)/.exec(q.slice(i)))) {
        var name = m[1]; i += m[0].length;
        if (FONTCMD.test(name)) {
          if (q.charAt(i) === "{") {
            for (var d = 0, e = i; e < q.length; e++) { if (q.charAt(e) === "{") d++; else if (q.charAt(e) === "}" && !--d) break; }
            wildTo = e;
          } else wildTo = i + 1;
          continue;
        }
        if (GLYPH[name]) out.push([GLYPH[name]]);
        else if (OPNAME.test(name)) { for (var o = 0; o < name.length; o++) out.push([hex(name.charCodeAt(o))]); }
        else if (OPS[name]) out.push([OPS[name]]);
        else if (name === "{" || name === "}") out.push([hex(name.charCodeAt(0))]);
        else if (!QUIET.test(name)) return null;
        continue;
      }
      i++;
      if (i - 1 < wildTo && /[A-Za-z0-9]/.test(c)) { out.push(["*"]); continue; }
      if (/[A-Za-z]/.test(c)) {
        var k = c.charCodeAt(0), it = c === "h" ? "210E" : hex((c < "a" ? 0x1D434 + k - 65 : 0x1D44E + k - 97));
        out.push([it, hex(k)]);
      } else if (/[0-9]/.test(c)) out.push([hex(c.charCodeAt(0))]);
      else if (SYM[c]) out.push([SYM[c]].concat(c === "-" ? ["2D"] : c === "|" ? ["2223"] : []));
      else if (/[\s_^{}&~]/.test(c)) continue;
      else return null;
    }
    return out.length ? out : null;
  }
  // one marker's stroke over the given glyphs (or the whole formula), drawn inside the formula's own picture, so it
  // scrolls and scales with it: behind the glyphs, at least as tall as the text round it
  function markGeom(f, gs, n) {         // where one mark goes (reads the page only)
    try {
      var svg = f.querySelector("svg");
      if (!svg) return null;
      var L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
      (gs && gs.length ? gs : [svg]).forEach(function (g) {
        var r = g.getBoundingClientRect();
        L = Math.min(L, r.left); T = Math.min(T, r.top); R = Math.max(R, r.right); B = Math.max(B, r.bottom);
      });
      var fs = parseFloat(getComputedStyle(f).fontSize) || 16, cy = (T + B) / 2, hh = Math.max(B - T + 2, fs * 1.05);
      T = cy - hh / 2; B = cy + hh / 2; L -= 2; R += 2;
      var M = svg.getScreenCTM().inverse(), pt = svg.createSVGPoint();
      pt.x = L; pt.y = T; var a = pt.matrixTransform(M);
      pt.x = R; pt.y = B; var b = pt.matrixTransform(M);
      var x = a.x, y = a.y, w = b.x - a.x, h = b.y - a.y, t = tilt(n + 7), wp = R - L;
      return {svg: svg, d: markD(wp, hh), tf: "rotate(" + markTilt(t.a, wp, hh, fs) + " " + (x + w / 2) + " " + (y + h / 2) + ") translate(" + x + " " +
        (y + (hh > 2 * fs ? 0 : t.dy) * h / hh) + ") scale(" + w + " " + h + ")"};
    } catch (e) { return null; }
  }
  function markPlace(g) {                // (writes only)
    if (!g) return null;
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("class", "l2m-find-g");
    p.setAttribute("d", g.d);
    p.setAttribute("transform", g.tf);
    g.svg.insertBefore(p, g.svg.firstChild);
    return p;
  }
  // the marks of the found places in drawn formulas (a formula drawn later gets its own when it is drawn)
  function markFormulas(list) {
    var todo = list.filter(function (h) { return !h.range && !h.mark && !h.el.hasAttribute("data-lazy"); });
    todo.forEach(function (h) {
      if (h.span && !h.glyphs) h.glyphs = Array.prototype.slice.call(h.el.querySelectorAll("[data-c]"), h.span[0], h.span[1]);
    });
    var geoms = todo.map(function (h) { return markGeom(h.el, h.glyphs, hits.indexOf(h)); });
    todo.forEach(function (h, i) { h.mark = markPlace(geoms[i]); if (h.mark && hits[hitAt] === h) h.mark.classList.add("now"); });
  }
  if (window.L2M_math) {
    L2M_math.onDraw = function (el) {
      if (finding && hits.length) markFormulas(hits.filter(function (h) { return h.el === el; }));
    };
    L2M_math.onUndraw = function (el) {
      hits.forEach(function (h) { if (h.el === el) { h.mark = null; if (h.span) h.glyphs = null; } });
    };
  }
  var MACROS = opts.macros || {}, expanded = {};
  function expand(t) {
    for (var pass = 0; pass < 3; pass++) {
      var t2 = t.replace(/\\([A-Za-z]+)(?![A-Za-z])/g, function (x, n) { return typeof MACROS[n] === "string" ? MACROS[n] + " " : x; });
      if (t2 === t) break;
      t = t2;
    }
    return t;
  }
  function texNorm(t) {
    t = expand(t || "").replace(/\\(mathcal|mathbb|mathfrak|mathscr|boldsymbol|bm|mathbf|mathsf|mathtt|mathit|mathrm)\s+([A-Za-z0-9])/g, "\\$1{$2}");
    t = t.replace(/(\\[A-Za-z]+)\s+(?=[A-Za-z])/g, "$1\u0001").replace(/\s+/g, "").replace(/\u0001/g, " ");
    return t.replace(/([_^])\{([^{}\\]|\\[A-Za-z]+)\}/g, "$1$2");
  }
  function findRun() {
    foundBack();
    findClear();
    var what = findWhat(findField.value);
    if (!what) { findShow(); return; }
    if (what.mixed) { findMixed(what.mixed); return; }
    var main = document.querySelector("main"), text = "", nodes = [], starts = [], forms = [], lastBlock = null;
    var walk = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {acceptNode: function (n) {
      if (n.nodeType === 1) {
        if (n.matches("mjx-container[data-n], l2m-math[n]")) return NodeFilter.FILTER_ACCEPT;
        if (n.matches("svg, script, style, button, .skel-paper, [hidden], .l2m-mark, .mjx-hl")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    }});
    for (var n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeType === 1) {                          // a formula: its place in the text, and what it has
        forms.push({el: n, at: text.length});
        text += "\u0000";
        continue;
      }
      var blk = n.parentNode.closest(BLOCK);
      if (blk !== lastBlock) { text += "\u0001"; lastBlock = blk; }
      nodes.push(n); starts.push(text.length);
      text += n.data;
    }
    var found = [];                                     // {at, range} | {at, el, glyph} | {at, el}
    if (what.text) {
      // any spacing (a space, a line's end, a no-break space before a citation) as any other
      var low = text.toLowerCase(), q = what.text, re = new RegExp(reEsc(q.trim()).replace(/\s+/g, "\\s+"), "g"), mm = re.exec(low), i = mm ? mm.index : -1, len = mm ? mm[0].length : 0;
      function pos(k) {                                 // the text node and offset of the k-th character
        var lo = 0, hi = starts.length - 1;
        while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (starts[mid] <= k) lo = mid; else hi = mid - 1; }
        return {node: nodes[lo], off: Math.min(k - starts[lo], nodes[lo].data.length)};
      }
      while (i >= 0 && found.length < 1500) {
        var a = pos(i), b = pos(i + len);
        try { var r = document.createRange(); r.setStart(a.node, a.off); r.setEnd(b.node, b.off); found.push({at: i, range: r}); } catch (e) {}
        mm = re.exec(low); i = mm ? mm.index : -1; len = mm ? mm[0].length : 0;
      }
    }
    if (what.glyph || what.tex) {
      var seq = what.glyph ? [[what.glyph]] : glyphsOf(texNorm(what.tex));
      forms.forEach(function (f) {
        var drawn = f.el.tagName !== "L2M-MATH", tex = opts.tex ? opts.tex(f.el.getAttribute("data-n") || f.el.getAttribute("n")) : "";
        // a single symbol: wherever it is drawn (a paper's own macros for it too); more TeX: in formulas whose TeX has it
        if (!what.glyph && !texHas(tex, what.tex)) return;
        var got = 0, lazy = drawn && f.el.hasAttribute("data-lazy") && window.L2M_math;
        if (drawn && seq) {
          // a formula not drawn yet is searched in its drawing as kept (its marks come when it is drawn)
          var gl = lazy ? null : f.el.querySelectorAll("[data-c]");
          var codes = lazy ? L2M_math.codes(+f.el.getAttribute("data-n")) : Array.prototype.map.call(gl, function (g) { return g.getAttribute("data-c"); });
          for (var i = 0; i + seq.length <= codes.length; i++) {
            var ok = true;
            for (var j = 0; j < seq.length && ok; j++) ok = seq[j][0] === "*" || seq[j].indexOf(codes[i + j]) >= 0;
            if (!ok && seq.length > 2) {               // the same glyphs in another order (a script's two parts)
              var left = seq.slice();
              ok = true;
              for (var jj = 0; jj < seq.length && ok; jj++) {
                var at = -1;
                for (var kk = 0; kk < left.length; kk++) if (left[kk][0] === "*" || left[kk].indexOf(codes[i + jj]) >= 0) { at = kk; break; }
                if (at < 0) ok = false; else left.splice(at, 1);
              }
            }
            if (!ok) continue;
            found.push({at: f.at + (got++) * 1e-4, el: f.el, span: [i, i + seq.length], glyphs: gl ? Array.prototype.slice.call(gl, i, i + seq.length) : null});
            i += seq.length - 1;
          }
        }
        if (!got && (!what.glyph || texHas(tex, what.tex))) {                                // the formula as a whole
          if (lazy) L2M_math.draw(f.el);
          found.push({at: f.at, el: f.el});
        }
      });
    }
    found.sort(function (x, y) { return x.at - y.at; });
    hits = found;
    var ranges = [];
    hits.forEach(function (h) { if (h.range) ranges.push(h.range); });
    markFormulas(hits);
    if (ranges.length) strokes();
    // the first one from where the reader is
    var top = barHeight() + 4, k0 = 0;
    for (var j = 0; j < hits.length; j++) { if (hitRect(hits[j]).top >= top) { k0 = j; break; } k0 = 0; }
    findGo(hits.length ? k0 : -1, true);
  }
  // a passage of words and formulas (as copied): the paper read with each formula as its TeX, the words in any case
  // and any spacing; a hit is its words and its formulas, each marked as words are
  function reEsc(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function findMixed(parts) {
    var main = document.querySelector("main"), text = "", pieces = [], lastBlock = null;
    var walk = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {acceptNode: function (n) {
      if (n.nodeType === 1) {
        if (n.matches("mjx-container[data-n]")) return NodeFilter.FILTER_ACCEPT;
        if (n.matches("svg, script, style, button, .skel-paper, [hidden], .l2m-mark, .mjx-hl")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    }});
    for (var n = walk.nextNode(); n; n = walk.nextNode()) {
      var blk = (n.nodeType === 1 ? n : n.parentNode).closest(BLOCK);
      if (blk !== lastBlock) { text += "\n"; lastBlock = blk; }
      if (n.nodeType === 1) {
        var t = "\u0002" + texNorm(opts.tex ? opts.tex(n.getAttribute("data-n")) : "") + "\u0003";
        pieces.push({at: text.length, el: n, len: t.length});
        text += t;
      } else {
        pieces.push({at: text.length, node: n, len: n.data.length});
        text += n.data.toLowerCase();
      }
    }
    var re = new RegExp(parts.map(function (p) {
      return p.f != null ? "\u0002" + reEsc(texNorm(p.f)) + "\u0003" : reEsc(p.t.trim().toLowerCase()).replace(/\s+/g, "\\s+");
    }).join("\\s*"), "g");
    function at(k) {                                   // the piece holding the k-th character
      var lo = 0, hi = pieces.length - 1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (pieces[mid].at <= k) lo = mid; else hi = mid - 1; }
      return lo;
    }
    var found = [], m;
    while ((m = re.exec(text)) && found.length < 1500) {
      if (!m[0]) { re.lastIndex++; continue; }
      var i = m.index, j = i + m[0].length, p0 = at(i), p1 = at(j - 1), bits = [];
      for (var k = p0; k <= p1; k++) {
        var pc = pieces[k];
        if (pc.el) { bits.push(pc.el); continue; }
        var s0 = Math.max(0, i - pc.at), s1 = Math.min(pc.len, j - pc.at);
        if (s1 <= s0) continue;
        var rr = document.createRange(); rr.setStart(pc.node, s0); rr.setEnd(pc.node, s1); bits.push(rr);
      }
      var whole = document.createRange(), a = pieces[p0], b = pieces[p1];
      if (a.el) whole.setStartBefore(a.el); else whole.setStart(a.node, Math.max(0, i - a.at));
      if (b.el) whole.setEndAfter(b.el); else whole.setEnd(b.node, Math.min(b.len, j - b.at));
      found.push({at: i, range: whole, bits: bits});
    }
    hits = found;
    if (hits.length) strokes();
    var top = barHeight() + 4, k0 = 0;
    for (var q = 0; q < hits.length; q++) { if (hitRect(hits[q]).top >= top) { k0 = q; break; } }
    findGo(hits.length ? k0 : -1, true);
  }
  function rectsOf(h) {                              // a hit's boxes: its words' lines, and each formula's box whole
    if (!h.bits) return h.range.getClientRects();
    var out = [];
    h.bits.forEach(function (b) {
      if (b.nodeType === 1) { var r = (b.querySelector("svg") || b).getBoundingClientRect(); if (r.width) out.push(r); }
      else Array.prototype.forEach.call(b.getClientRects(), function (r) { if (r.width >= 1) out.push(r); });
    });
    return out;
  }
  function hitRect(h) {
    var el = h.range || h.mark || h.el;
    return el.getBoundingClientRect();
  }
  function findGo(k, soft) {
    if (hitAt >= 0 && hits[hitAt]) {
      var o = hits[hitAt];
      if (o.mark) o.mark.classList.remove("now"); else if (o.range) (o.boxes || []).forEach(function (b) { b.classList.remove("now"); });
    }
    hitAt = k;
    if (window.CSS && CSS.highlights) CSS.highlights.delete("l2m-find-now");
    if (k >= 0 && hits[k]) {
      var h = hits[k];
      if (!h.range && h.el.hasAttribute("data-lazy") && window.L2M_math) L2M_math.draw(h.el);
      if (h.range) (h.boxes || []).forEach(function (b) { b.classList.add("now"); });
      else if (h.mark) h.mark.classList.add("now");
      // in sight: below the bar, above the peek, a third of the way down if it has to move, and held there while the
      // page round it is laid out (as every jump is: else it drifts as the paper above it takes its true size)
      var r = hitRect(h), top = barHeight() + 12, bottom = window.innerHeight - Math.max(peekOpen ? peekH : 0, keyboardH()) - 24;
      if (r.top < top || r.bottom > bottom) {
        var spot = top + (bottom - top) * 0.3;
        window.scrollTo(0, Math.max(0, window.pageYOffset + r.top - spot));
        landOn(function () { return Math.max(0, window.pageYOffset + hitRect(h).top - spot); });
      }
      var at = (h.glyphs && h.mark) || (h.range && h.range.startContainer.parentElement), eq = at && at.closest && at.closest(".eqbody");
      if (eq) {                                           // a wide formula scrolled sideways to it
        var er = eq.getBoundingClientRect(), gr = hitRect(h);
        if (gr.left < er.left + 16 || gr.right > er.right - 16) eq.scrollLeft += gr.left - er.left - er.width / 2 + gr.width / 2;
      }
    }
    findShow();
  }
  function findShow() {
    if (!findCount) return;
    var q = findField.value.trim();
    if (q && !findWhat(q)) q = "";                  // (too short to look for yet: no count)
    findCount.textContent = !q ? "" : hits.length ? (hitAt + 1) + "/" + (hits.length >= 1500 ? "1500+" : hits.length) : "0";
    findCount.classList.toggle("none", !!q && !hits.length);
    findBar.querySelector(".find-prev").disabled = findBar.querySelector(".find-next").disabled = hits.length < 2;
  }
  // a keyboard's height over the page's foot (laid over it, or the view shrunk by it), 0 with none up
  function keyboardH() {
    var vk = navigator.virtualKeyboard, vv = window.visualViewport;
    if (vk && vk.overlaysContent && vk.boundingRect) return vk.boundingRect.height;
    return vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  }
  // The keyboard up while searching (it comes as the search opens): the place it is on, if it went under it, is
  // brought back in sight above it once the keyboard is up, in one smooth move, as a note's words are as it is written
  var sightT = 0;
  function findSight(after) {
    clearTimeout(sightT);
    sightT = setTimeout(function () {
      sightT = 0;
      if (!finding || hitAt < 0 || !hits[hitAt]) return;
      var r = hitRect(hits[hitAt]), top = barHeight() + 12, bottom = window.innerHeight - Math.max(peekOpen ? peekH : 0, keyboardH()) - 24;
      if (bottom - top < 40 || (r.top >= top && r.bottom <= bottom)) return;
      var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({top: Math.round(r.top - top - (bottom - top) * 0.3), behavior: still ? "auto" : "smooth"});
    }, after);
  }
  if (navigator.virtualKeyboard) on(navigator.virtualKeyboard, "geometrychange", function () { findSight(250); });
  function findStep(d) { foundBack(); if (hits.length) findGo((hitAt + d + hits.length) % hits.length); }
  // A found place tapped: the search's blue goes (a step in the history: back brings it, and only back; a step on to
  // another place, or a new search, too), and the place is selected, as one selects by hand. With a finger, the
  // selection is laid on it as the finger lifts, and the browser's own tap, on a selection, makes it the browser's: its
  // handles and its menu, as after a long press. With a mouse, once the click is done (a press would have let it go).
  // The bar to mark it comes, as for any selection (and goes with the blue's step, back letting both go). A place
  // already marked opens its mark's sheet instead, as a tap on a mark does. (Not a link's tap, nor a long press, a
  // drag or a double click: those are the browser's; nor a tap where the blue has gone)
  var downX = 0, downY = 0, downT = 0, downBy = "", selRides = false;
  function foundOff() { return root.classList.contains("l2m-find-off"); }
  function foundHide() { if (!foundOff()) { root.classList.add("l2m-find-off"); overlayIn("l2mFound"); } }
  function foundBack() {                           // (the blue back, as the search goes on)
    if (foundOff()) { if (overlays.indexOf("l2mFound") >= 0) closeOverlay("l2mFound", "hand"); else root.classList.remove("l2m-find-off"); }
  }
  function hitUnder(e, el) {                       // the found place a tap is on (the smallest, where they overlap)
    var x = e.clientX + window.pageXOffset, y = e.clientY + window.pageYOffset, best = null, least = Infinity;
    hits.forEach(function (h) {
      var boxes = h.rr || [];
      if (!h.range) {
        if (!h.el.contains(el)) return;
        var b = (h.mark || h.el).getBoundingClientRect();
        boxes = [{left: b.left + window.pageXOffset, top: b.top + window.pageYOffset, right: b.right + window.pageXOffset, bottom: b.bottom + window.pageYOffset}];
      }
      boxes.forEach(function (r) {
        var a = (r.right - r.left) * (r.bottom - r.top);
        if (x >= r.left - 3 && x <= r.right + 3 && y >= r.top - 3 && y <= r.bottom + 3 && a < least) { least = a; best = h; }
      });
    });
    return best;
  }
  function foundAt(e) {
    if (!finding || !hits.length || foundOff() || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 8) return null;
    var el = e.target.nodeType === 1 ? e.target : e.target.parentNode;
    if (!el || !el.closest || !document.querySelector("main").contains(el) ||
        el.closest("a[href], button, input, textarea, select, summary, label, [role='button']")) return null;
    return hitUnder(e, el);
  }
  function selectFound(h) {
    var r = document.createRange(), sel = window.getSelection();
    if (h.range) r = h.range.cloneRange(); else r.selectNode(h.el);    // (a formula: whole, as one is selected)
    sel.removeAllRanges();
    sel.addRange(r);
  }
  function tapFound(e) {
    var h = foundAt(e);
    if (!h) return;
    foundHide();
    if (!(marks && marks.at(e.clientX, e.clientY))) selectFound(h);     // (on a mark: its sheet opens, as the tap goes on)
  }
  on(window, "pointerdown", function (e) { downX = e.clientX; downY = e.clientY; downT = Date.now(); downBy = e.pointerType; }, true);
  on(window, "pointerup", function (e) { if (e.pointerType !== "mouse" && Date.now() - downT <= 450) tapFound(e); }, true);
  on(window, "click", function (e) { if (downBy === "mouse" && e.detail < 2) tapFound(e); }, true);
  // what is selected, as a search: a formula (or a part of one) as its TeX, text as it reads; nothing when too long
  function selectedQuery() {
    var sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return "";
    var range = sel.getRangeAt(0), node = range.commonAncestorContainer, el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || (el.closest && el.closest(".l2m-bar"))) return "";
    // as it would be copied: its formulas as their TeX ($...$), words and formulas searched together
    var t = opts.tex ? texText(range) : null, q = (t != null ? t : String(sel)).replace(/\s+/g, " ").trim();
    return q.length <= 300 ? q : "";
  }
  function openFind(q) {
    if (typeof q === "string" && q && findField) { findField.value = q; if (finding) { findRun(); findField.focus(); } }
    if (!findBar || finding) return;
    closeMenu("jump"); closeSheet();
    finding = true;
    if (useHistory) { try { if (!state().l2mFind) { stepIn({l2mFind: true}); findAt = here(); } } catch (e) {} }
    bar.classList.remove("find-in", "find-out"); void bar.offsetWidth;
    bar.classList.add("finding", "find-in");
    update();
    setTimeout(function () { findField.focus(); findField.select(); }, 40);
    if (findField.value.trim()) findRun();
    // (and once a phone's keyboard is up, whether or not the window said so: it comes in some 300ms)
    if (window.matchMedia && matchMedia("(pointer: coarse)").matches) findSight(700);
    setTimeout(function () { bar.classList.remove("find-in"); }, 320);
  }
  function closeFind(how) {            // how: "pop" (by back), "jump" (something else follows)
    if (!finding) return;
    finding = false;
    clearTimeout(findTimer);
    var fi = overlays.lastIndexOf("l2mFound");      // (the blue's step, if it is gone: goes with the search's)
    if (fi >= 0) {
      overlays.splice(fi, 1);
      root.classList.remove("l2m-find-off");
      if (selRides) { selRides = false; if (marks) marks.dropSel(); }
    }
    if (useHistory && how !== "pop") {
      try {
        if (state().l2mFind) {
          if (how === "jump") { var st = assign(state(), {}); delete st.l2mFind; delete st.l2mFound; history.replaceState(st, ""); }
          else backTo(findAt);
        }
      } catch (e) {}
    }
    findClear();
    findField.blur();
    bar.classList.remove("finding", "find-in"); void bar.offsetWidth;
    bar.classList.add("find-out");
    setTimeout(function () { bar.classList.remove("find-out"); }, 300);
    update();
  }
  if (findBar) {
    var pressedSel = "";                            // (a tap on the button can clear the selection before its click)
    findBtn.addEventListener("pointerdown", function () { pressedSel = selectedQuery(); });
    findBtn.addEventListener("click", function () { var q = pressedSel || selectedQuery(); pressedSel = ""; openFind(q); });
    findField.addEventListener("input", function () {
      clearTimeout(findTimer);
      findTimer = setTimeout(findRun, findField.value.trim().length < 3 ? 350 : 160);   // (short: a moment more to type on)
    });
    findField.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); clearTimeout(findTimer); if (!hits.length) findRun(); else findStep(e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFind(); }
    });
    findBar.querySelector(".find-prev").addEventListener("click", function () { findStep(-1); });
    findBar.querySelector(".find-next").addEventListener("click", function () { findStep(1); });
    findBar.querySelector('[data-act="find-close"]').addEventListener("click", function () { closeFind(); });
    on(document, "keydown", function (e) {           // Ctrl/Cmd+F: this search, not the browser's (which cannot read formulas)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        var q = selectedQuery();
        if (finding && !q) { findField.focus(); findField.select(); } else openFind(q);
      }
    });
  }

  function formulaOf(n) { var el = n.nodeType === 1 ? n : n.parentElement; return el && el.closest && el.closest("mjx-container[data-n]"); }
  function texOf(f) {                                // a formula's TeX (a picture drawn in it: named, not its stand-in)
    return (opts.tex ? opts.tex(f.getAttribute("data-n")) || "" : "").trim()
      .replace(/\\class\{l2mpic-\d+\}\{\\rule(\[[^\]]*\])?\{[^}]*\}\{[^}]*\}\}/g, "\\text{[picture]}");
  }
  // ---------------------------------------------------------------- copying: formulas as their LaTeX
  // A selection with formulas in it is copied with each formula as its TeX ($...$ in a line, \[...\] on its own);
  // a formula counts whole, even when the selection only reaches into it.
  function texText(range) {                         // the selection's text so (null: no formula in it)
    var r = range.cloneRange(), a = formulaOf(r.startContainer), b = formulaOf(r.endContainer);
    if (a) r.setStartBefore(a);
    if (b) r.setEndAfter(b);
    var frag = r.cloneContents();
    var forms = frag.querySelectorAll("mjx-container[data-n]");
    if (!forms.length) return null;
    Array.prototype.forEach.call(forms, function (f) {
      var tex = texOf(f);
      f.replaceWith(document.createTextNode(f.getAttribute("display") === "true" ? "\\[" + tex + "\\]" : "$" + tex + "$"));
    });
    var box = document.createElement("div");       // laid out off screen, so its text keeps its paragraphs
    box.style.cssText = "position:fixed;left:-9999px;top:0;width:600px;white-space:normal";
    box.appendChild(frag);
    document.body.appendChild(box);
    var text = box.innerText;
    box.remove();
    return text.replace(/\n{3,}/g, "\n\n").trim();
  }
  on(document, "copy", function (e) {
    var sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed || !opts.tex || !e.clipboardData) return;
    var range = sel.getRangeAt(0), main = document.querySelector("main");
    if (!main || !main.contains(range.commonAncestorContainer)) return;
    var text = texText(range);
    if (text == null) return;
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
  });

  // ---------------------------------------------------------------- full screen while reading (a phone's own
  // bars away), when turned on. Asked for as the paper opens (the tap that opened it allows it) or else at the first
  // touch; left when the paper is. Back leaves full screen (as the phone does), and it stays left for this paper.
  var fullMine = false, fullLeaving = false, fullArmed = false;
  function fullWanted() { return !!(window.L2M_canFull && L2M_canFull() && ((session && session.full) || prefs().full) === "on"); }
  function fullEnter() {
    if (dead || !fullWanted() || document.fullscreenElement) return;
    try {
      var r = document.documentElement.requestFullscreen({navigationUI: "hide"});
      fullMine = true;
      if (r && r.then) r.then(function () { fullArmed = false; }, function () { fullMine = false; fullArmed = true; });
    } catch (e) { fullArmed = true; }
  }
  function fullLeave() {
    fullArmed = false;
    if (document.fullscreenElement && fullMine) { fullLeaving = true; try { document.exitFullscreen(); } catch (e) {} }
    fullMine = false;
  }
  on(document, "fullscreenchange", function () {
    if (document.fullscreenElement || dead) return;
    if (fullLeaving) { fullLeaving = false; return; }
    if (!fullMine) return;
    fullMine = false;                                  // left by the reader (back): so it stays, until the next paper
    fullArmed = false;
  });
  on(document, "pointerup", function () { if (fullArmed) fullEnter(); });
  fullArmed = true;
  setTimeout(fullEnter, 480);         // after the page's transition in (a size change midway would cut it short)

  // ---------------------------------------------------------------- reading settings
  var FONTS = {};
  (theme.fonts || []).forEach(function (f) { FONTS[f.key] = f; });
  function prefs() {
    try { return JSON.parse(localStorage.getItem("l2m-prefs") || "{}") || {}; } catch (e) { return {}; }
  }
  function savePrefs(p) { try { localStorage.setItem("l2m-prefs", JSON.stringify(p)); } catch (e) {} }
  var session = prefs();              // survives even when storage is unavailable
  function placeIndicators(instant) {
    // a highlight that slides to the chosen option in every group
    var groups = panels.settings.querySelectorAll(".seg, .opt-list");
    for (var g = 0; g < groups.length; g++) {
      var ind = groups[g].querySelector(".sel-ind"), on = groups[g].querySelector('[aria-checked="true"]');
      if (!ind || !on) continue;
      if (instant) ind.classList.add("no-anim");
      ind.style.width = on.offsetWidth + "px";
      ind.style.height = on.offsetHeight + "px";
      ind.style.transform = "translate(" + on.offsetLeft + "px," + on.offsetTop + "px)";
      if (instant) { void ind.offsetWidth; ind.classList.remove("no-anim"); }
    }
  }
  function refreshSettings(instant) {
    var el = panels.settings;
    if (!el) return;
    var font = session.font || DEF.font, look = session.theme || DEF.appearance;
    var opts = el.querySelectorAll("[data-font]");
    for (var k = 0; k < opts.length; k++) opts[k].setAttribute("aria-checked", opts[k].getAttribute("data-font") === font ? "true" : "false");
    var curBtn = el.querySelector(".font-current"), f0 = FONTS[font];
    if (curBtn && f0) {
      var nm = curBtn.querySelector(".opt-name");
      nm.textContent = f0.name;
      nm.style.fontFamily = window.L2M_previewStack ? L2M_previewStack(font) : f0.stack;
      curBtn.querySelector(".opt-note").textContent = f0.note || "";
      curBtn.setAttribute("aria-label", "Font: " + f0.name + ", tap to choose another");
    }
    var want = {"data-theme-opt": look, "data-size-opt": session.size || DEF.size, "data-tone-opt": session.tone || DEF.tone,
                "data-width-opt": session.width || "narrow",
                "data-full-opt": session.full === "on" ? "on" : "off"};
    for (var attr in want) {
      var segs = el.querySelectorAll("[" + attr + "]");
      for (var m = 0; m < segs.length; m++) segs[m].setAttribute("aria-checked", segs[m].getAttribute(attr) === want[attr] ? "true" : "false");
    }
    placeIndicators(instant);
  }
  // A text size or font chosen: the line the reader is at stays where it is, in the paper and in the peek. Held by
  // one letter of it (not its paragraph, which grows around it): the first line in sight, below the settings panel
  // when it covers the top of the paper, and the first one in the peek.
  function letterAt(box, x, y) {
    var els = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [], el = null;
    for (var k = 0; k < els.length; k++) if (box.contains(els[k]) && els[k] !== box) { el = els[k]; break; }
    if (!el) return null;
    var w = document.createTreeWalker(el.closest("p, li, h1, h2, h3, h4, h5, h6, figcaption, td, th, dd, dt, blockquote") || el, NodeFilter.SHOW_TEXT);
    var r = document.createRange(), n;
    while ((n = w.nextNode())) {
      if (!n.data.trim()) continue;
      r.selectNodeContents(n);
      var last = r.getClientRects();
      if (!last.length || last[last.length - 1].bottom <= y) continue;
      var lo = 0, hi = n.data.length - 1;                  // the first letter whose line reaches below y
      while (lo < hi) {
        var mid = (lo + hi) >> 1;
        r.setStart(n, mid); r.setEnd(n, mid + 1);
        if (r.getBoundingClientRect().bottom > y) hi = mid; else lo = mid + 1;
      }
      return {node: n, at: lo, el: el};
    }
    return {el: el};
  }
  function letterTop(a) {
    if (a.node && a.node.isConnected) {
      var r = document.createRange();
      r.setStart(a.node, a.at); r.setEnd(a.node, Math.min(a.at + 1, a.node.data.length));
      var b = r.getBoundingClientRect();
      if (b.height) return b.top;
    }
    return a.el.getBoundingClientRect().top;
  }
  function keepPlace(change) {
    var main = document.querySelector("main"), x = window.innerWidth / 2;
    var over = panel && panels[panel] ? panels[panel].getBoundingClientRect().bottom : 0;
    var here = main && letterAt(main, x, Math.max(barHeight(), over) + 6), hereY = here ? letterTop(here) : 0;
    var inPeek = null, peekY = 0;
    if (peekOpen && peekScroll) {
      var pr = peekScroll.getBoundingClientRect();
      inPeek = letterAt(peekMain, pr.left + pr.width / 2, pr.top + 6);
      if (inPeek) peekY = letterTop(inPeek);
    }
    change();
    function fix() {
      if (here) window.scrollBy(0, letterTop(here) - hereY);
      if (inPeek) peekScroll.scrollTop += letterTop(inPeek) - peekY;
      root.style.setProperty("--l2m-bar-h", barHeight() + "px");
      update();
    }
    fix();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fix);
  }
  function swapTheme(t) { crossfade(function () { window.L2M_applyTheme(t); }); }
  function crossfade(apply) { if (!(window.L2M_fade && L2M_fade(apply))) apply(); }   // (prefs.js: a dip through a veil)

  if (panels.settings) {
    var pick = panels.settings.querySelector(".font-pick");
    function openFonts(on) {
      if (!pick) return;
      // the fonts' own faces for their names in the list: fetched when the list opens (each new face restyles the page)
      if (on && !(window.L2M_previewReady && L2M_previewReady())) for (var key in FONTS) if (window.L2M_loadFont) window.L2M_loadFont(key);
      pick.classList.toggle("open", on);
      pick.querySelector(".font-current").setAttribute("aria-expanded", on ? "true" : "false");
      placeIndicators(true);
    }
    panels.settings.addEventListener("click", function (e) {
      if (e.target.closest("[data-font-toggle]")) { openFonts(!pick.classList.contains("open")); return; }
      var fo = e.target.closest("[data-full-opt]");
      if (fo) {
        session.full = fo.getAttribute("data-full-opt");
        var pf = prefs(); pf.full = session.full; savePrefs(pf);
        refreshSettings();
        if (session.full === "on") fullEnter(); else fullLeave();
        return;
      }
      var b = e.target.closest("[data-font], [data-theme-opt], [data-size-opt], [data-tone-opt], [data-width-opt]");
      if (!b) return;
      if (b.hasAttribute("data-font")) setTimeout(function () { openFonts(false); }, 260);   // chosen: the list folds away
      var f = b.getAttribute("data-font"), t = b.getAttribute("data-theme-opt");
      var z = b.getAttribute("data-size-opt"), tone = b.getAttribute("data-tone-opt"), mg = b.getAttribute("data-width-opt");
      if (mg) {
        session.width = mg;
        window.L2M_changeWidth(mg, keepPlace);
      } else if (f) {
        session.font = f;
        keepPlace(function () { window.L2M_applyFont(f); });
      } else if (z) {
        session.size = z;
        keepPlace(function () { window.L2M_applySize(z); });
      } else if (tone) {
        session.tone = tone;
        crossfade(function () { window.L2M_applyTone(tone); });
      } else {
        session.theme = t;
        swapTheme(t);
      }
      var p = prefs();
      p.font = session.font;
      p.theme = session.theme;
      p.size = session.size;
      p.tone = session.tone;
      p.width = session.width;
      savePrefs(p);
      refreshSettings();
    });
  }

  // ---------------------------------------------------------------- footnote sheet
  function openSheet(ref) {
    if (!sheet) return false;
    var id = decodeURIComponent(ref.getAttribute("href").slice(1));
    var note = document.getElementById(id);
    var text = note ? note.querySelector(".fn-text") : null;
    if (!text) return false;
    closeMenu();
    sheetBody.innerHTML = text.innerHTML;
    sheetNum.textContent = ref.textContent.trim();
    sheetBody.scrollTop = 0;
    if (activeRef) activeRef.classList.remove("active");
    activeRef = ref;
    ref.classList.add("active");
    if (!sheet.classList.contains("open")) overlayIn("l2mSheet");
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
    L2M_pinFilm(sheet, 360);
    return true;
  }
  function closeSheet(how) {              // how: as overlayOut's
    if (!sheet || !sheet.classList.contains("open")) return;
    overlayOut("l2mSheet", how);
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    L2M_pinFilm(sheet, 360);
    if (activeRef) { activeRef.classList.remove("active"); activeRef = null; }
  }

  // ---------------------------------------------------------------- figure and table viewer
  var viewer = document.getElementById("l2m-viewer");
  var vStage = viewer ? viewer.querySelector(".viewer-stage") : null;
  var vContent = viewer ? viewer.querySelector(".viewer-content") : null;
  var vCap = viewer ? viewer.querySelector(".viewer-cap") : null;
  var vTitle = viewer ? viewer.querySelector(".viewer-title") : null;
  var vFigure = null;
  var EXPAND = (theme.icons || {}).expand || "";

  function outerFigure(el) {
    var f = el && el.closest ? el.closest("figure.float") : null;
    while (f && f.parentElement && f.parentElement.closest("figure.float")) f = f.parentElement.closest("figure.float");
    return f;
  }
  function fitStage() {
    // figures fit the space left above the caption
    if (viewer) viewer.style.setProperty("--l2m-stage-h", vStage.clientHeight + "px");
  }
  function setupCaption() {
    vCap.classList.remove("clamped");
    var old = vCap.querySelector(".cap-more");
    if (old) old.remove();
    var text = vCap.querySelector(".cap-text");
    if (!text) return;
    vCap.classList.add("clamped");
    if (text.scrollHeight <= text.clientHeight + 2) {      // short caption: nothing to expand
      vCap.classList.remove("clamped");
      fitStage();
      return;
    }
    var b = document.createElement("button");
    b.type = "button";
    b.className = "cap-more";
    b.textContent = "More";
    b.setAttribute("aria-expanded", "false");
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = vCap.classList.toggle("clamped") === false;
      b.textContent = open ? "Less" : "More";
      b.setAttribute("aria-expanded", open ? "true" : "false");
      if (!open) vCap.scrollTop = 0;
      requestAnimationFrame(function () { fitStage(); if (viewer.l2mResetZoom) viewer.l2mResetZoom(); });
      setTimeout(fitStage, 300);
    });
    vCap.appendChild(b);
    fitStage();
  }
  function viewerOpen() { return viewer && viewer.classList.contains("open"); }
  function openViewer(fig) {
    if (!viewer || !fig) return false;
    closeMenu();
    closeSheet();
    vFigure = fig;
    vContent.innerHTML = "";
    // its formulas drawn first (the page draws a figure's only as it comes near the screen: a copy would be empty)
    if (window.L2M_math) Array.prototype.forEach.call(fig.querySelectorAll("mjx-container[data-lazy]"), L2M_math.draw);
    var caps = [];
    Array.prototype.forEach.call(fig.children, function (ch) {
      if (ch.tagName === "FIGCAPTION") { caps.push(ch.innerHTML); return; }
      if (ch.classList.contains("fig-open")) return;
      vContent.appendChild(ch.cloneNode(true));
    });
    Array.prototype.forEach.call(vContent.querySelectorAll("[id]"), function (n) { n.removeAttribute("id"); });
    vCap.innerHTML = '<span class="cap-text">' + caps.join(" ") + '</span>';
    Array.prototype.forEach.call(vCap.querySelectorAll(".capname"), function (n) { if (!n.closest("figure")) n.remove(); });
    vCap.hidden = !caps.length;
    setupCaption();
    var name = fig.querySelector("figcaption .capname");
    vTitle.textContent = name ? name.textContent.replace(/\.\s*$/, "") : (fig.classList.contains("table") ? "Table" : "Figure");
    vStage.scrollTop = 0;
    vStage.classList.toggle("gesture", !!vContent.querySelector("img"));
    if (viewer.l2mResetZoom) viewer.l2mResetZoom();
    if (!viewerOpen()) overlayIn("l2mFig");
    viewer.classList.add("open");
    viewer.setAttribute("aria-hidden", "false");
    root.classList.add("l2m-noscroll");
    return true;
  }
  function closeViewer(how) {             // how: as overlayOut's
    if (!viewerOpen()) return;
    overlayOut("l2mFig", how);
    viewer.classList.remove("open");
    viewer.setAttribute("aria-hidden", "true");
    root.classList.remove("l2m-noscroll");
  }
  if (viewer) {
    // an expand badge on every top-level figure and table
    Array.prototype.forEach.call(document.querySelectorAll("main figure.float"), function (f) {
      if (f.parentElement.closest("figure.float")) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "fig-open";
      b.setAttribute("aria-label", f.classList.contains("table") ? "Open table" : "Open figure");
      b.innerHTML = EXPAND;
      f.insertBefore(b, f.firstChild);
    });
    viewer.querySelector('[data-act="vclose"]').addEventListener("click", function () { closeViewer("hand"); });
    viewer.querySelector('[data-act="goto"]').addEventListener("click", function () {
      var f = vFigure;
      closeViewer();
      if (f && f.id) navigate(f.id);
    });
    // ---- zoom inside the figure frame: pinch, drag, double-tap, trackpad pinch / ctrl+wheel
    var z = {s: 1, x: 0, y: 0}, ptrs = {}, g = null, lastTap = 0, moved = false;
    function box() {
      return {ox: vContent.offsetLeft, oy: vContent.offsetTop, w: vContent.offsetWidth, h: vContent.offsetHeight,
              W: vStage.clientWidth, H: vStage.clientHeight};
    }
    function clampAxis(t, o, len, view) {
      return len <= view ? (view - len) / 2 - o : Math.min(-o, Math.max(view - len - o, t));
    }
    function applyZoom(animate) {
      var b = box();
      z.s = Math.min(8, Math.max(1, z.s));
      z.x = clampAxis(z.x, b.ox, b.w * z.s, b.W);
      z.y = clampAxis(z.y, b.oy, b.h * z.s, b.H);
      if (z.s === 1) { z.x = 0; z.y = 0; }
      vContent.classList.toggle("animating", !!animate);
      vContent.style.transform = z.s === 1 ? "" : "translate(" + z.x + "px," + z.y + "px) scale(" + z.s + ")";
      vStage.classList.toggle("zoomed", z.s > 1);
    }
    function zoomAt(newS, cx, cy, animate) {      // keep the content point under (cx, cy) fixed
      var b = box(), s0 = z.s;
      var px = (cx - b.ox - z.x) / s0, py = (cy - b.oy - z.y) / s0;
      z.s = Math.min(8, Math.max(1, newS));
      z.x = cx - b.ox - px * z.s;
      z.y = cy - b.oy - py * z.s;
      applyZoom(animate);
    }
    function local(e) { var r = vStage.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; }
    function resetZoom() { z = {s: 1, x: 0, y: 0}; applyZoom(false); }
    viewer.l2mResetZoom = resetZoom;
    vStage.addEventListener("pointerdown", function (e) {
      if (!vStage.classList.contains("gesture")) return;
      try { vStage.setPointerCapture(e.pointerId); } catch (err) {}
      ptrs[e.pointerId] = local(e);
      moved = false;
      var ids = Object.keys(ptrs);
      if (ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        g = {type: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: z.s, m: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, x: z.x, y: z.y};
      } else {
        g = {type: "pan", p: ptrs[e.pointerId], x: z.x, y: z.y};
      }
    });
    vStage.addEventListener("pointermove", function (e) {
      if (!g || !ptrs[e.pointerId]) return;
      ptrs[e.pointerId] = local(e);
      var ids = Object.keys(ptrs);
      if (g.type === "pinch" && ids.length >= 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y), m = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
        var bx = box(), s = Math.min(8, Math.max(0.6, g.s * d / g.d));
        var px = (g.m.x - bx.ox - g.x) / g.s, py = (g.m.y - bx.oy - g.y) / g.s;
        z.s = s; z.x = m.x - bx.ox - px * s; z.y = m.y - bx.oy - py * s;
        vContent.classList.remove("animating");
        vContent.style.transform = "translate(" + z.x + "px," + z.y + "px) scale(" + z.s + ")";
        moved = true;
      } else if (g.type === "pan" && z.s > 1) {
        var q = ptrs[e.pointerId];
        z.x = g.x + q.x - g.p.x; z.y = g.y + q.y - g.p.y;
        applyZoom(false);
        moved = true;
      } else if (g.p && Math.hypot(ptrs[e.pointerId].x - g.p.x, ptrs[e.pointerId].y - g.p.y) > 6) {
        moved = true;
      }
    });
    function endPointer(e) {
      if (!ptrs[e.pointerId]) return;
      var p = ptrs[e.pointerId];
      delete ptrs[e.pointerId];
      if (g && g.type === "pinch") {
        if (Object.keys(ptrs).length < 2) { g = null; applyZoom(true); }
        return;
      }
      g = null;
      if (moved) return;
      var now = Date.now();
      if (now - lastTap < 320) {                     // double-tap: zoom in at the point, or back to fit
        lastTap = 0;
        if (z.s > 1) { z = {s: 1, x: 0, y: 0}; applyZoom(true); } else zoomAt(2.5, p.x, p.y, true);
        return;
      }
      lastTap = now;
      var target = document.elementFromPoint(e.clientX, e.clientY);
      if (z.s === 1 && (target === vStage || target === vContent)) {
        setTimeout(function () { if (lastTap === now) closeViewer("hand"); }, 330);
      }
    }
    vStage.addEventListener("pointerup", endPointer);
    vStage.addEventListener("pointercancel", endPointer);
    vStage.addEventListener("wheel", function (e) {
      if (!vStage.classList.contains("gesture")) return;
      e.preventDefault();
      var p = local(e);
      if (e.ctrlKey) zoomAt(z.s * Math.exp(-e.deltaY * 0.01), p.x, p.y, false);
      else if (z.s > 1) { z.x -= e.deltaX; z.y -= e.deltaY; applyZoom(false); }
    }, {passive: false});
    on(window, "resize", function () { if (viewerOpen()) { fitStage(); applyZoom(false); } });
  }


  // ---------------------------------------------------------------- the peek: a second view of the paper, below
  // A long press on a link (an equation, a section, a theorem, a figure, a citation, a note; or an entry of the
  // contents) opens its target in a sheet rising from the bottom, while the reading stays where it is above; a long
  // press in the peek opens its target above instead. The bar stays the top view's. Back closes the peek (its own
  // jumps step back with its own back button); it keeps no place of its own.
  var peek = null, peekMain = null, peekScroll = null, peekHead = null, peekTitle = null, peekBack = null;
  var peekOpen = false, peekStack = [], peekHeads = [], peekCloseTimer = null, peekUserH = null;
  function peekBuild() {
    if (peek) return;
    var I = theme.icons || {};
    peek = document.createElement("div");
    peek.className = "l2m-peek";
    peek.id = "l2m-peek";
    peek.setAttribute("role", "region");
    peek.setAttribute("aria-label", "Second view of the paper");
    peek.setAttribute("aria-hidden", "true");
    peek.innerHTML = '<div class="peek-scroll"><main class="peek-main" tabindex="-1"></main></div>' +
      '<div class="peek-head"><span class="peek-grab" aria-hidden="true"></span><div class="peek-row">' +
      '<button type="button" class="bar-btn peek-back" aria-label="Back in the second view" hidden>' + (I.back || "&lsaquo;") + "</button>" +
      '<span class="peek-title"></span>' +
      '<button type="button" class="bar-btn peek-expand" aria-label="Read here in the full page">' + (I.expand || "&#8599;") + "</button>" +
      '<button type="button" class="bar-btn peek-close" aria-label="Close the second view">' + (I.close || "&times;") + "</button></div></div>";
    document.body.appendChild(peek);
    peekMain = peek.querySelector(".peek-main");
    peekScroll = peek.querySelector(".peek-scroll");
    peekHead = peek.querySelector(".peek-head");
    peekTitle = peek.querySelector(".peek-title");
    peekBack = peek.querySelector(".peek-back");
    peek.querySelector(".peek-close").addEventListener("click", function () { closePeek(); });
    peek.querySelector(".peek-expand").addEventListener("click", expandPeek);
    peekBack.addEventListener("click", function () {
      if (!peekStack.length) return;
      peekScroll.scrollTo(0, peekStack.pop());
      peekBack.hidden = !peekStack.length;
      peekTitleNow();
    });
    var ticking = false;
    peekScroll.addEventListener("scroll", function () {
      if (peekStale(true)) peekRefresh();
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; peekTitleNow(); });
    }, {passive: true});
    // the head drags the peek's height; it snaps to a third, a half or two thirds, and closes when dragged low.
    // While it is held nothing is laid out again: the peek is made as tall as it can be and only slid (a
    // transform, which the screen does alone), and it takes its new height once, where it comes to rest.
    // Above the highest place it pulls back (it follows less and less, as a rubber band) and on release springs
    // back to it; pushed on until the finger reaches the bar, the band gives: the peek becomes the page at once, by
    // itself (as its expand button does), from where the band held it.
    var drag = null, settle = null;
    // while it is dragged no selection starts on the page (a listener: a class on the page's root would restyle
    // every element of the paper and of the peek's copy, a freeze at each drag's start and end on a phone)
    on(document, "selectstart", function (e) { if (drag) e.preventDefault(); });
    var SPRING = "transform 460ms linear(0, 0.262, 0.470, 0.631, 0.753, 0.843, 0.908, 0.954, 0.984, 1.004, 1.016, " +
      "1.022, 1.024, 1.023, 1.022, 1.019, 1.017, 1.014, 1.011, 1.009, 1.007, 1.005, 1.004, 1.003, 1)";
    function slide(h, max) { peek.style.transform = "translateY(" + Math.round(max - h) + "px)"; if (drag) L2M_pinFilm(peekHead); }
    function snaps(max) {
      var avail = window.innerHeight - barHeight();
      return [0.34, 0.5, 0.66].map(function (f) { return Math.min(max, Math.round(avail * f)); });
    }
    function band(x, d) { return d * (1 - 1 / (x * 0.55 / d + 1)); }          // how far it goes for x pulled
    // near the bottom it wants to go: below a low line it drops faster than the finger (and is let go, it goes)
    function fall(x, c) { var u = Math.max(0, x) / c; return c * u * u * u * u * (4 - 3 * u); }
    function unfall(y, c) { var lo = 0, hi = c; for (var i = 0; i < 20; i++) { var m = (lo + hi) / 2; if (fall(m, c) < y) lo = m; else hi = m; } return lo; }
    function unband(y, d) { y = Math.min(y, d - 1); return d / 0.55 * y / (d - y); }
    function rest() {                 // the slide ended: the height it shows becomes its height
      if (!settle) return;
      clearTimeout(settle.timer);
      var h = settle.h;
      settle = null;
      peek.style.transition = "";
      peek.classList.add("dragging");
      setPeekHeight(h);
      peek.style.transform = "";
      void peek.offsetWidth;
      peek.classList.remove("dragging");
    }
    peekHead.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button") || !peekOpen) return;
      e.preventDefault();                 // a drag, not the start of a selection (the press's own, carried over the page)
      var h = window.innerHeight - peek.getBoundingClientRect().top, max = peekMax();   // where it is now, even mid-slide
      if (settle) { clearTimeout(settle.timer); settle = null; }
      peek.style.transition = "";
      var top = snaps(max)[2], low = Math.round((window.innerHeight - barHeight()) * 0.25);
      var raw = h > top ? top + unband(h - top, max - top) : h < low ? unfall(h, low) : h;   // (caught mid-way: the pull it shows)
      drag = {y: e.clientY, h: raw, at: h, max: max, top: top, low: low, id: e.pointerId};
      peek.classList.add("dragging");
      peek.style.height = max + "px";
      slide(h, max);
      peekHead.setPointerCapture(e.pointerId);
    });
    peekHead.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var raw = drag.h + drag.y - e.clientY;
      if (raw > drag.top && e.clientY <= barHeight()) {    // (held back all the way, until the finger reaches the bar)
        var id = drag.id;
        drag = null;                    // the band gives: no longer the finger's; up it goes, and is the page
        try { peekHead.releasePointerCapture(id); } catch (x) {}
        if (navigator.vibrate) { try { navigator.vibrate(10); } catch (x) {} }
        peek.classList.remove("dragging");
        peek.style.transition = "";
        expandPeek(true);
        return;
      }
      drag.at = raw > drag.top ? drag.top + band(raw - drag.top, drag.max - drag.top) : raw < drag.low ? fall(raw, drag.low) : raw;
      slide(drag.at, drag.max);
    });
    function dragEnd(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var h = drag.at, max = drag.max;
      drag = null;
      peek.classList.remove("dragging");
      var avail = window.innerHeight - barHeight();
      if (h < avail * 0.17) {         // let go low: it falls away, quickening
        peek.style.transition = "transform 240ms cubic-bezier(0.5, 0, 1, 1), visibility 0s linear 240ms";
        peek.style.transform = "";
        closePeek();
        setTimeout(function () { if (!peekOpen) peek.style.transition = ""; }, 260);
        return;
      }
      var best = snaps(max).reduce(function (a, b) { return Math.abs(b - h) < Math.abs(a - h) ? b : a; });
      peekUserH = best / avail;
      peek.style.transition = SPRING;
      slide(best, max);
      L2M_pinFilm(peekHead, 480);
      settle = {h: best, timer: setTimeout(rest, 480)};
    }
    peekHead.addEventListener("pointerup", dragEnd);
    peekHead.addEventListener("pointercancel", dragEnd);
  }
  function peekMax() { return window.innerHeight - barHeight() - 56; }
  // the peek's height, set on the few things that follow it (not on the page's root, which would restyle the
  // whole paper): the peek, and the room kept under the page to read its end
  var peekH = 0;
  function peekHeight() { return peekH; }
  function setPeekHeight(h) {
    peekH = Math.round(h);
    if (peek) peek.style.height = peekH + "px";
    if (peekOpen) document.body.style.paddingBottom = (peekH + 72) + "px";
  }
  // a copy of (part of) the paper made ready: its ids kept as data-pid (the page's own ids stay unique), the page's
  // passing marks off, its formulas not drawn yet (drawn as they come in sight)
  function prepCopy(root) {
    function all(sel) { var l = Array.prototype.slice.call(root.querySelectorAll(sel)); if (root.matches && root.matches(sel)) l.push(root); return l; }
    all("[id]").forEach(function (n) { n.setAttribute("data-pid", n.id); n.removeAttribute("id"); });
    all(".fnref.active").forEach(function (n) { n.classList.remove("active"); });
    all(".l2m-find-g").forEach(function (n) { n.remove(); });
    all(".l2m-find-f, .l2m-find-now").forEach(function (n) { n.classList.remove("l2m-find-f", "l2m-find-now"); });
    if (window.L2M_math) {
      all("mjx-container[data-n]:not([data-lazy])").forEach(function (m) {
        var pic = m.querySelector(":scope > svg");
        if (L2M_math.lazy(m.getAttribute("data-n")) && !m.closest(L2M_math.eager) && pic) {
          pic.textContent = ""; m.setAttribute("data-lazy", "");
        }
      });
    }
  }
  function peekFinish() {
    // (its formulas drawn in as they come in sight: watched once it is shown, not while set aside, where finding
    // their places would have the browser lay the whole copy out)
    if (window.L2M_math && peekScroll.style.contentVisibility !== "hidden") peekWatch();
    peekHeads = Array.prototype.filter.call(peekMain.querySelectorAll("h2[data-pid], h3[data-pid]"), function (h) {
      return !h.closest(".titleblock");
    });
    peekMain.l2mBuilding = null;
    peekMain.l2mFilled = true;
  }
  function peekFill() {                     // all at once (the peek wanted now)
    peekMain.l2mBuilding = null;
    peekMain.innerHTML = document.querySelector("main").innerHTML;
    peekMain.l2mGen = (peekMain.l2mGen || 0) + 1;          // (a copy of its own: the marks read it anew)
    prepCopy(peekMain);
    peekFinish();
  }
  // In the background it is made a little at a time, in the page's idle moments: a few blocks of the paper copied, then
  // the next few, while it is set aside (content-visibility: hidden), so the browser neither styles nor lays them out
  // (a long paper's copy laid out as it came held a phone for seconds); opened, it is laid out near what it shows
  // only (theme.css). So no moment is long, however long the paper. Opened meanwhile, the rest comes at once.
  function peekFillSlices(idle, done) {
    var kids = Array.prototype.slice.call(document.querySelector("main").children), i = 0;
    peekAside(true);                                  // (made while set aside: copied only, not styled or laid out yet)
    peekMain.innerHTML = "";
    peekMain.l2mFilled = false;
    peekMain.l2mGen = (peekMain.l2mGen || 0) + 1;
    var job = peekMain.l2mBuilding = {rest: function () {
      var f = document.createDocumentFragment();
      while (i < kids.length) f.appendChild(kids[i++].cloneNode(true));
      prepCopy(f);
      peekMain.appendChild(f);
      peekFinish();
    }};
    function slice(d) {
      if (dead || peekMain.l2mBuilding !== job) return;
      var t0 = performance.now(), f = document.createDocumentFragment();
      while (i < kids.length && performance.now() - t0 < 1) f.appendChild(kids[i++].cloneNode(true));
      prepCopy(f);
      peekMain.appendChild(f);
      if (i < kids.length) idle(slice, {timeout: 3000});
      else { peekFinish(); if (done) done(); }
    }
    idle(slice, {timeout: 3000});
  }
  // the page draws its formulas after it opens (nearest first): a copy made meanwhile keeps some undrawn, so it
  // is made again once the page has drawn more, keeping in place what the peek shows
  function peekStale(all) {           // all: only once the page has drawn every formula (while scrolling the peek)
    var left = peekMain && peekMain.l2mFilled ? peekMain.getElementsByTagName("l2m-math").length : 0;
    var page = left ? document.querySelector("main").getElementsByTagName("l2m-math").length : 0;
    return left > 0 && (all ? page === 0 : page < left);
  }
  var PEEK_BLOCKS = "p, li, h2, h3, h4, .display, figure, .thm, .defn, .remark, table, blockquote";
  function peekRefresh() {
    var line = peekScroll.getBoundingClientRect().top + peekHead.offsetHeight, blocks = peekMain.querySelectorAll(PEEK_BLOCKS), k = -1, off = 0;
    for (var i = 0; i < blocks.length; i++) {
      var r = blocks[i].getBoundingClientRect();
      if (r.bottom > line) { k = i; off = r.top - line; break; }
    }
    peekFill();
    if (k >= 0) {
      var b = peekMain.querySelectorAll(PEEK_BLOCKS)[k];
      if (b) peekScroll.scrollTop += b.getBoundingClientRect().top - line - off;
    }
  }
  function peekFind(id) {
    if (!peekMain) return null;
    var all = peekMain.querySelectorAll("[data-pid]");
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute("data-pid") === id) return all[i];
    return null;
  }
  // the name of what a link led to, as HTML: a title's formulas come along (its text alone would drop them)
  function peekText(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }
  function peekName(el) {             // an element's own HTML, without a closing "." or ":"
    var c = el.cloneNode(true), w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT), last = null;
    while (w.nextNode()) if (w.currentNode.nodeValue.trim()) last = w.currentNode;
    if (last) last.nodeValue = last.nodeValue.replace(/[.:]\s*$/, "");
    return c.innerHTML.trim();
  }
  function peekLabel(el) {
    var d = el.closest(".display");
    if (d) { var n = d.querySelector(".eqno"); return "Equation " + (n ? peekText(n.textContent.trim()) : ""); }
    if (/^H[1-6]$/.test(el.tagName)) return el.innerHTML;
    var li = el.closest("li");
    if (el.closest(".footnotes")) { var fb = li && li.querySelector(".fnback"); return "Note " + (fb ? peekText(fb.textContent.trim()) : ""); }
    if (el.closest(".references")) { var rn = li && li.querySelector(".refnum"); return "Reference " + (rn ? peekText(rn.textContent.trim()) : ""); }
    var f = el.closest("figure");
    if (f) { var c = f.querySelector(".capname"); return c ? peekName(c) : "Figure"; }
    var t = el.closest(".thm, .defn, .remark");
    if (t) { var tn = t.querySelector(".thm-name"); return tn ? peekName(tn) : "Statement"; }
    return null;
  }
  var peekFade = null, peekNext = null;
  function peekTitleSet(html) {
    if (html === peekNext) return;
    peekNext = html;
    if (!peek.classList.contains("open")) { peekTitle.innerHTML = html; return; }
    if (peekFade) return;                 // a fade is running; it takes the latest
    peekTitle.classList.add("fading");
    peekFade = setTimeout(function () {
      peekFade = null;
      peekTitle.innerHTML = peekNext;
      peekTitle.classList.remove("fading");
    }, 140);
  }
  function peekTitleNow() {
    if (!peek) return;
    var line = peekScroll.getBoundingClientRect().top + peekHead.offsetHeight + 8, cur = null;
    for (var k = 0; k < peekHeads.length; k++) {
      if (peekHeads[k].getBoundingClientRect().top <= line) cur = peekHeads[k]; else break;
    }
    if (peekTitle.l2mFixed && Math.abs(peekScroll.scrollTop - peekTitle.l2mFixedAt) < 40) return;   // the target's name, until one scrolls on
    peekTitle.l2mFixed = false;
    peekTitleSet(cur ? cur.innerHTML : docTitle);
  }
  function peekGo(id, push) {
    var el = peekFind(id);
    if (!el) return false;
    if (push) { peekStack.push(peekScroll.scrollTop); peekBack.hidden = false; }
    function want() { return Math.max(0, el.getBoundingClientRect().top - peekScroll.getBoundingClientRect().top + peekScroll.scrollTop - peekHead.offsetHeight - 12); }
    peekScroll.scrollTo(0, want());
    landOn(want, peekScroll);
    flash(el);
    var label = peekLabel(el);
    if (label) { peekTitleSet(label); peekTitle.l2mFixed = true; peekTitle.l2mFixedAt = peekScroll.scrollTop; }
    else { peekTitle.l2mFixed = false; peekTitleNow(); }
    return true;
  }
  // The peek closed keeps its copy out of the way (content-visibility: hidden): not styled, laid out or drawn, not
  // reached by Tab; shown again, it is laid out near what it shows only (theme.css). (Its text sets its own
  // visibility, so showing the peek restyles only its frame, not the thousands of elements of the copy under it.)
  function peekAside(on) {
    if (!peekScroll) return;
    peekScroll.style.contentVisibility = on ? "hidden" : "";
    if (!on && peekMain && peekMain.l2mFilled) peekWatch();
  }
  function peekWatch() {                    // the copy's formulas drawn in as they come in sight (once a copy)
    if (!window.L2M_math || !peekMain || peekMain.l2mWatched === peekMain.l2mGen) return;
    peekMain.l2mWatched = peekMain.l2mGen;
    L2M_math.watch(peekMain, peekScroll);
  }
  function openPeek(id, from) {
    peekBuild();
    peekAside(false);
    if (peekMain.l2mBuilding) peekMain.l2mBuilding.rest();      // (being made in the background: the rest now)
    if (!peekMain.l2mFilled || peekStale()) peekFill();
    if (!peekFind(id)) return false;
    clearTimeout(peekCloseTimer);
    closeMenu("jump");
    closeSheet();
    var avail = window.innerHeight - barHeight();
    setPeekHeight(Math.min(peekMax(), Math.round(avail * (peekUserH || 0.48))));
    var was = peekOpen;
    peekOpen = true;
    root.classList.add("l2m-peeking");
    peek.style.transform = "";
    peek.style.transition = "";
    L2M_pinFilm(peekHead, 360);
    setPeekHeight(peekH);
    peek.setAttribute("aria-hidden", "false");
    peekStack = [];
    peekBack.hidden = true;
    peekGo(id, false);
    if (!was) {
      void peek.offsetWidth;
      peek.classList.add("open");
      overlayIn("l2mPeek");
    }
    if (marks) marks.peekOpened(peekMain, peekMain.l2mGen || 0);
    // the link it came from stays in sight above: moved up, if the peek would cover it
    if (from && !peek.contains(from)) {
      var r = from.getBoundingClientRect(), top = barHeight(), bottom = window.innerHeight - peekHeight();
      if (r.bottom > bottom - 16 || r.top < top) {
        var want = top + (bottom - top) * 0.35;
        window.scrollTo({top: window.pageYOffset + r.top - want, behavior: "smooth"});
      }
    }
    return true;
  }
  // The peek made the page: it grows up to the bar (its head joining it) while its text and the page's fade out; the
  // page is then where the peek was, and fades back in, the peek gone. Back returns to where the page was.
  var expanding = false;
  function expandPeek(fromDrag) {       // fromDrag: it is slid (a transform) where a drag left it, and glides on from there
    if (!peekOpen || expanding) return;
    expanding = true;
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var line = peekScroll.getBoundingClientRect().top + peekHead.offsetHeight, blocks = peekMain.querySelectorAll(PEEK_BLOCKS), k = -1, off = 0;
    for (var i = 0; i < blocks.length; i++) {
      var r = blocks[i].getBoundingClientRect();
      if (r.bottom > line) { k = i; off = r.top - line; break; }
    }
    closeSheet();
    overlayOut("l2mPeek", "hand");                   // (its history step goes now; the page's jump comes at the end)
    peekOpen = false;
    if (marks) marks.peekClosed();
    clearTimeout(peekCloseTimer);
    var main = document.querySelector("main"), T = reduced ? 0 : 340, half = reduced ? 0 : 150;
    peek.classList.add("expanding");
    main.classList.add("l2m-fading");
    if (fromDrag) {                                   // its bottom stays at the screen's: grown by as much as it is slid
      var slid = peek.getBoundingClientRect().top - (window.innerHeight - peek.offsetHeight);
      peek.style.transition = "none";
      peek.style.height = (peek.offsetHeight - slid) + "px";
      peek.style.transform = "";
      void peek.offsetWidth;
      peek.style.transition = "";
    }
    peek.style.height = (window.innerHeight - barHeight()) + "px";
    // halfway up, the page (out of sight a moment) goes to where the peek is and fades in, as the peek fades away
    setTimeout(function () {
      var from = window.pageYOffset, b = k >= 0 ? main.querySelectorAll(PEEK_BLOCKS)[k] : null;
      root.classList.remove("l2m-peeking");
      document.body.style.paddingBottom = "";
      if (b) {
        var y = Math.max(0, b.getBoundingClientRect().top + window.pageYOffset - barHeight() - off);
        if (useHistory) {
          try {
            history.replaceState(assign(state(), assign({l2mIdx: idx, l2mPaper: KEY}, kept(from))), "");
            history.pushState(assign({l2mIdx: idx + 1, l2mPaper: KEY}, kept(y)), "");
            idx += 1;
          } catch (e) { mem.push(from); }
        } else mem.push(from);
        scrollToY(y);
        landOn(function () { return Math.max(0, b.getBoundingClientRect().top + window.pageYOffset - barHeight() - off); });
      }
      update();
      void main.offsetWidth;
      main.classList.remove("l2m-fading");
    }, half);
    setTimeout(function () {                          // up, and faded away: gone
      peek.style.transition = "none";
      peek.classList.remove("open", "expanding");
      peek.setAttribute("aria-hidden", "true");
      setTimeout(function () { peek.style.transition = ""; peek.style.height = peekH + "px"; expanding = false; peekAside(true); }, 60);
    }, T);
  }
  function closePeek(how) {           // how: "pop" (closed by back); by hand otherwise
    if (!peekOpen) return;
    overlayOut("l2mPeek", how || "hand");
    peekOpen = false;
    if (marks) marks.peekClosed();
    peek.classList.remove("open");
    L2M_pinFilm(peekHead, 360);
    peek.setAttribute("aria-hidden", "true");
    clearTimeout(peekCloseTimer);
    peekCloseTimer = setTimeout(function () {
      if (peekOpen) return;
      peekAside(true);
      root.classList.remove("l2m-peeking");
      document.body.style.paddingBottom = "";
    }, 340);
  }

  // long press: a timer on the pointer (touch, pen, or a held mouse button), and the context menu (a right click, or
  // a browser's own long press) taken over for internal links
  var lp = null;
  function internalLink(t) {
    var a = t && t.closest ? t.closest("a[href^='#']") : null;
    if (!a || !(a.closest("main") || (menu && menu.contains(a)) || (sheet && sheet.contains(a)))) return null;
    var id = decodeURIComponent(a.getAttribute("href").slice(1));
    return id && id !== "l2m-top" ? {a: a, id: id} : null;
  }
  function eatClick() {
    var stop = function (ev) { ev.preventDefault(); ev.stopPropagation(); document.removeEventListener("click", stop, true); };
    document.addEventListener("click", stop, true);
    setTimeout(function () { document.removeEventListener("click", stop, true); }, 700);
  }
  function longPress(l) {
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    eatClick();
    if (peek && peek.contains(l.a)) {           // from the peek: the top view goes there
      closeSheet();
      if (document.getElementById(l.id)) navigate(l.id);
      return;
    }
    if (l.a.closest(".cite")) {                // a citation (a tap peeks at it): the page goes to the reference
      closeSheet();
      if (document.getElementById(l.id)) navigate(l.id);
      return;
    }
    if (sheet && sheet.contains(l.a)) {        // from a note's sheet: the sheet gives way to the peek
      closeSheet();
      openPeek(l.id, null);
      return;
    }
    openPeek(l.id, menu && menu.contains(l.a) ? null : l.a);
  }
  function lpCancel() { if (lp && lp.t) clearTimeout(lp.t); if (lp && !lp.fired) lp = null; }
  on(document, "pointerdown", function (e) {
    if (e.button !== 0) return;
    var l = internalLink(e.target);
    if (!l) return;
    lp = {x: e.clientX, y: e.clientY, l: l, fired: false};
    lp.t = setTimeout(function () { if (lp && !lp.fired) { lp.fired = true; longPress(lp.l); } }, 460);
  });
  on(document, "pointermove", function (e) {
    if (lp && !lp.fired && Math.abs(e.clientX - lp.x) + Math.abs(e.clientY - lp.y) > 10) lpCancel();
  }, {passive: true});
  on(document, "pointerup", function () { if (lp && !lp.fired) lpCancel(); else if (lp) setTimeout(function () { lp = null; }, 700); });
  on(document, "pointercancel", lpCancel);
  on(document, "scroll", lpCancel, {passive: true, capture: true});
  on(document, "contextmenu", function (e) {
    var l = internalLink(e.target);
    if (!l) return;
    e.preventDefault();
    if (lp && lp.fired) return;                 // the long press has already opened it
    if (lp && lp.t) clearTimeout(lp.t);
    lp = {l: l, fired: true};
    longPress(l);
    setTimeout(function () { lp = null; }, 700);
  });

  // ---------------------------------------------------------------- clicks and keys
  on(document, "click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest("a[href^='#']") : null;
    // in the peek: a note opens its sheet, a figure its viewer, any other link moves the peek (not the page)
    if (a && peek && peek.contains(a)) {
      if (a.closest(".fnref") && openSheet(a)) { e.preventDefault(); return; }
      var pid = decodeURIComponent(a.getAttribute("href").slice(1));
      var ptarget = document.getElementById(pid), pfig = ptarget ? outerFigure(ptarget) : null;
      if (pfig && openViewer(pfig)) { e.preventDefault(); return; }
      if (peekGo(pid, true)) { e.preventDefault(); closeSheet(); return; }
    }
    if (a && a.closest(".fnref") && openSheet(a)) {
      e.preventDefault();
      return;
    }
    // a citation: the reference shown in the peek (a long press goes there instead)
    if (a && a.closest(".cite") && !(peek && peek.contains(a))) {
      var cid = decodeURIComponent(a.getAttribute("href").slice(1));
      if (document.getElementById(cid) && openPeek(cid, sheet && sheet.contains(a) ? null : a)) { e.preventDefault(); return; }
    }
    if (viewer && !viewer.contains(e.target)) {
      // a reference to a figure or table opens it in the viewer; so does tapping a figure
      var target = a ? document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1))) : null;
      var fig = target ? outerFigure(target) : null;
      if (!a) {
        var hit = e.target.closest(".fig-open, figure.float img");
        if (hit) fig = outerFigure(hit);
      }
      if (fig && openViewer(fig)) { e.preventDefault(); return; }
    }
    if (a) {
      var id = decodeURIComponent(a.getAttribute("href").slice(1));
      if (id && document.getElementById(id)) {
        e.preventDefault();
        closeMenu("jump");
        closeSheet();
        navigate(id);
        return;
      }
    }
    if (panel && !bar.contains(e.target) && !panels[panel].contains(e.target) &&
        !e.target.closest('[data-act="settings"]')) closeMenu();
    // a tap elsewhere closes a note's sheet; not one in the peek (the two stand apart: its close leaves the note open)
    if (sheet && sheet.classList.contains("open") && !sheet.contains(e.target) && !(peek && peek.contains(e.target))) closeSheet("hand");
  });
  on(document, "keydown", function (e) {
    if (e.key === "Escape") {                        // as the x of what is on top: one layer at a time
      if (panel) { e.preventDefault(); closeMenu(); return; }   // the panel, then the one opened last, then the search
      var top = overlays[overlays.length - 1];
      if (top) { e.preventDefault(); closeOverlay(top, "hand"); return; }
      if (finding) { e.preventDefault(); closeFind(); }
    }
  });
  backBtn.addEventListener("click", function () {
    if (panel) { closeMenu(); return; }
    // the bar's back button always leads to the library, past any jumps inside the paper
    // (the phone's own back button still steps back through them)
    if (opts.onLibrary) {                        // (past the steps of an open peek, sheet or viewer too)
      var steps = useHistory ? idx + overlays.length : 0;
      overlays.slice().reverse().forEach(function (f) { closeOverlay(f, "pop"); });
      saveHere(); opts.onLibrary(steps); return;
    }
    goBack();
  });
  topBtn.addEventListener("click", function () { closeMenu("jump"); navigate("l2m-top"); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-act="library"]'), function (b) {
    b.addEventListener("click", function (e) {
      if (!opts.onLibrary || e.metaKey || e.ctrlKey || e.shiftKey) return;   // a plain link otherwise
      e.preventDefault();
      closeMenu("jump");
      opts.onLibrary();
    });
  });
  if (menu) titleBtn.addEventListener("click", toggle("menu"));
  if (panels.settings) {
    var sb = document.querySelectorAll('[data-act="settings"]');
    for (var q = 0; q < sb.length; q++) sb[q].addEventListener("click", toggle("settings"));
  }
  if (sheet) {
    sheet.querySelector('[data-act="fnclose"]').addEventListener("click", function () { closeSheet("hand"); });
  }

  // ---------------------------------------------------------------- scroll state
  var fadeTimer = null, pendingTitle = null;
  function swapTitle(h) {
    pendingTitle = h;
    if (!shown) {                     // bar hidden: switch without animation
      clearTimeout(fadeTimer);
      fadeTimer = null;
      titleInner.innerHTML = h;
      titleInner.classList.remove("fading");
      return;
    }
    if (fadeTimer) return;            // a fade is running; it will pick up the latest title
    titleInner.classList.add("fading");
    fadeTimer = setTimeout(function () {
      fadeTimer = null;
      titleInner.innerHTML = pendingTitle;
      titleInner.classList.remove("fading");
    }, 140);
  }

  // how far through the paper: the references count as the end (they are reached, not read)
  // an underline under the section title, lit as far as the paper is read
  var prog = document.createElement("span");
  prog.className = "bar-progress";
  prog.setAttribute("aria-hidden", "true");
  prog.innerHTML = "<i><b></b></i>";
  (bar.querySelector(".bar-inner") || bar).appendChild(prog);
  function placeProgress() {                // exactly over the text's margins
    var main = document.querySelector("main"), box = prog.parentNode;
    if (!main || !box) return;
    var m = main.getBoundingClientRect(), cs = getComputedStyle(main), b = box.getBoundingClientRect();
    var left = m.left + parseFloat(cs.paddingLeft) - b.left, right = b.right - (m.right - parseFloat(cs.paddingRight));
    prog.style.left = left.toFixed(1) + "px";
    prog.style.right = right.toFixed(1) + "px";
  }
  placeProgress();
  function readEnd() {                    // the scroll at which the paper counts as read (its references reach the view's foot)
    var refs = document.getElementById("refs-h");
    var end = refs ? refs.getBoundingClientRect().top + window.pageYOffset : document.documentElement.scrollHeight;
    return Math.max(1, end - window.innerHeight);
  }
  function progress() { return Math.max(0, Math.min(1, window.pageYOffset / readEnd())); }
  // the underline follows the scroll by itself where the browser runs scroll-linked animations (on the graphics card:
  // no work at all while scrolling); it is only told where the reading ends. Elsewhere it is moved from here, when
  // the change shows.
  var SCROLL_LINKED = !!(window.CSS && CSS.supports && CSS.supports("animation-timeline: scroll()"));
  var shownEnd = -1, shownP = -1;
  window.L2M_progress = progress;
  function update() {
    if (SCROLL_LINKED) {
      var e = Math.round(readEnd());
      if (e !== shownEnd) { shownEnd = e; prog.style.setProperty("--read-end", e + "px"); }
    } else {
      var p = Math.round(progress() * 400) / 400;       // (moved when the change shows, not at every frame)
      if (p !== shownP) { shownP = p; prog.firstChild.firstChild.style.transform = "translateX(calc(max(" + (p * 100).toFixed(2) + "%, 3px) - 100%))"; }
    }
    var show = ALWAYS || (trigger ? trigger.getBoundingClientRect().bottom < 8 : window.pageYOffset > 240) || panel !== null || finding;
    if (show !== shown) {
      shown = show;
      bar.classList.toggle("show", show);
      bar.setAttribute("aria-hidden", show ? "false" : "true");
      if (!show) closeMenu();
    }
    var line = offset() + 8;
    var cur = null;
    for (var k = 0; k < heads.length; k++) {
      if (heads[k].getBoundingClientRect().top <= line) cur = heads[k];
      else break;
    }
    var cid = cur ? cur.id : "";
    if (titleInner.getAttribute("data-cur") !== cid) {
      titleInner.setAttribute("data-cur", cid);
      swapTitle(cur ? cur.innerHTML : docTitle);
      for (var m = 0; m < menuLinks.length; m++) {
        menuLinks[m].classList.toggle("current", !!cid && menuLinks[m].getAttribute("href") === "#" + cid);
      }
    }
    backBtn.disabled = !(panel || opts.onLibrary || (useHistory ? idx > 0 : mem.length > 0));
  }

  // a wide formula, table or code scrolled sideways shows its thin scroll bar until it has been still a moment
  on(document, "scroll", function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.matches(".eqbody, .table-wrap, pre")) return;
    t.classList.add("l2m-scrolling");
    clearTimeout(t.l2mStill);
    t.l2mStill = setTimeout(function () { t.classList.remove("l2m-scrolling"); }, 900);
  }, true);

  var ticking = false, saveTimer = null;
  on(window, "scroll", function () {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(function () { ticking = false; update(); });
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveHere, 400);
  }, {passive: true});
  on(window, "resize", function () {
    root.style.setProperty("--l2m-bar-h", barHeight() + "px");
    placeProgress();
    update();
  });

  function start() {
    root.style.setProperty("--l2m-bar-h", barHeight() + "px");
    placeProgress();
    var st = state();
    if (typeof st.l2mY === "number" && st.l2mPaper === KEY) {
      scrollToY(yAt(st));
      landOn(function () { return yAt(st); });
    } else if (marks && /^#mark-/.test(location.hash)) {
      marks.reveal(decodeURIComponent(location.hash.slice(6)));      // (once the marks are in)
    } else if (location.hash.length > 1) {
      var el = linked(location.hash);
      if (el) { scrollToY(yOf(el)); flash(el); landOn(function () { return yOf(el); }); }
    }
    update();
  }
  // the saved place is found once the formulas and images are in (opts.ready)
  Promise.resolve(opts.ready).then(function () { if (!dead) start(); });
  // the peek made ready ahead, in the background: a while after the paper is in, when the page is idle (and not while
  // the reader scrolls), so its first opening is quick and the paper's own opening no slower
  Promise.resolve(opts.ready).then(function () {
    var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1); };
    var lastScroll = 0;
    on(window, "scroll", function () { lastScroll = Date.now(); }, {passive: true});
    function tryBuild() {
      if (dead || (peekMain && (peekMain.l2mFilled || peekMain.l2mBuilding))) return;
      if (Date.now() - lastScroll < 800) { setTimeout(tryBuild, 900); return; }
      peekBuild();
      // at the height it opens at, copied a little at a time while set aside
      peek.style.height = Math.min(peekMax(), Math.round((window.innerHeight - barHeight()) * (peekUserH || 0.48))) + "px";
      peekFillSlices(function (f, o) {                  // (an idle moment, and not while the reader scrolls)
        idle(function (d) { if (Date.now() - lastScroll < 300) setTimeout(function () { f(d); }, 400); else f(d); }, o);
      }, function () { if (!peekOpen) peekAside(true); });
    }
    setTimeout(tryBuild, 2500);
  });
  // ---------------------------------------------------------------- marks (marks.js), where the host keeps them
  if (opts.marks && window.L2M_marks) {
    marks = window.L2M_marks({
      store: opts.marks, icons: theme.icons || {}, block: BLOCK, ready: opts.textReady || opts.ready,   // (the text and formulas in)
      menu: menu, closeMenu: closeMenu,
      jump: function (y, name, where) { jumpTo(y, name); if (where) landOn(where); },   // (where(): the place again)
      land: landOn,
      tex: opts.tex || function () { return ""; },
      overlayIn: overlayIn, overlayOut: overlayOut,
      selIn: function () {                         // (the bar up: a step; on the blue's, if that is the last one)
        if (overlays.indexOf("l2mSel") >= 0 || selRides) return;
        if (overlays[overlays.length - 1] === "l2mFound" && state().l2mFound) selRides = true; else overlayIn("l2mSel");
      },
      selOut: function (how) { if (selRides) selRides = false; else overlayOut("l2mSel", how); },
      closeOthers: function () { closeMenu("jump"); closeSheet(); },
      find: function (q) { openFind(typeof q === "string" ? q : selectedQuery()); },
      barHeight: barHeight, peekHeight: function () { return peekOpen ? peekH : 0; },
      strokeCss: strokeCss, lines: lines,
      copyText: function (range) { return opts.tex ? texText(range) : null; }   // (a range's text as copied: formulas as TeX)
    });
  }
  update();

  return {
    land: landOn,                         // (the host's own jumps, its reading place: held as they land)
    destroy: function (save) {
      if (dead) return;
      if (save !== false) saveHere();
      dead = true;
      closeViewer("pop");
      closeSheet("pop");
      if (marks) { marks.destroy(); marks = null; }
      offs.forEach(function (o) { o[0].removeEventListener(o[1], o[2], o[3]); });
      offs = [];
      clearTimeout(fadeTimer);
      clearTimeout(saveTimer);
      root.classList.remove("l2m-noscroll", "l2m-settings-open", "l2m-peeking");
      if (peek) { peek.remove(); peek = null; peekOpen = false; document.body.style.paddingBottom = ""; }
      fullLeave();
      if (findLayer && findLayer.parentNode) findLayer.remove();
      if (window.CSS && CSS.highlights) { CSS.highlights.delete("l2m-find"); CSS.highlights.delete("l2m-find-now"); }
      clearTimeout(peekCloseTimer);
      if (window.L2M_progress === progress) window.L2M_progress = null;
    }
  };
};
