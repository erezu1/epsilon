// Epsilon reading preferences: font, text size, appearance (light/dark/system) and tone.
// L2M_initPrefs(theme) applies the reader's saved choices before anything is drawn; the options
// themselves come from theme.json, and theme.css styles the data-size / data-tone / data-theme values.
(function () {
  "use strict";
  var root = document.documentElement;
  // the app opened on a paper (a link to it, or reloaded while reading it): the page shows the paper's stand-ins
  // from its first frame, not the library's (this runs before the page is drawn)
  if (root.classList.contains("l2m-app-lists")) {
    try {
      var q = new URLSearchParams(location.search), st = history.state || {};
      if (q.get("p") || q.get("doc") || (st.l2mPaper && String(st.l2mPaper).indexOf("app:") !== 0 && !q.get("v"))) {
        root.classList.remove("l2m-app-lists");
        root.classList.add("l2m-boot-paper");
      }
    } catch (e) {}
  }
  var FONTS = {}, DEF = {};

  var INLINE = window.L2M_FONTS_INLINE || null;       // (a one-file page carrying its fonts)
  // the app declares all its fonts itself, from its own fonts/ (fonts.css): nothing to fetch from Google Fonts
  function own() { return !!document.getElementById("l2m-fonts"); }
  function load(key) {
    var f = FONTS[key];
    if (!f || !f.css || own() || (INLINE && INLINE.keys.indexOf(key) >= 0)) return;
    var id = "l2m-font-" + key;
    if (document.getElementById(id)) return;
    var l = document.createElement("link");
    l.id = id;
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + f.css + "&display=swap";
    (document.head || root).appendChild(l);
  }
  // The font list shows each font's name in its own face. For that, a few kilobytes: each face cut down to the letters
  // of its name (Google Fonts' text= subsets), under a name of its own (never mixed with the real font), fetched once the
  // app is running and idle. Only the font one reads in comes whole. If they cannot come, the list fetches the whole
  // fonts when it opens, as before.
  var previews = INLINE && INLINE.previews ? 2 : 0;       // 0 not asked, 1 coming, 2 in, -1 not to be had
  window.L2M_previewFonts = function () {
    if (previews) return;
    if (own()) { previews = 2; return; }
    var keys = Object.keys(FONTS).filter(function (k) { return FONTS[k].css; });
    if (!keys.length || !window.FontFace || !document.fonts || !window.fetch) { previews = -1; return; }
    previews = 1;
    Promise.all(keys.map(function (k) {
      var f = FONTS[k];
      return fetch("https://fonts.googleapis.com/css2?family=" + f.css.split(":")[0] + "&text=" + encodeURIComponent(f.name))
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
        .then(function (css) {
          var m = /url\((https:[^)]+)\)/.exec(css);
          if (!m) throw new Error("no face");
          var face = new FontFace("l2m-pv-" + k, "url(" + m[1] + ")");
          return face.load();
        });
    })).then(function (faces) {
      faces.forEach(function (face) { document.fonts.add(face); });     // (all together: one restyle)
      previews = 2;
    }, function () { previews = -1; });
  };
  window.L2M_previewReady = function () { return previews === 2 || own(); };
  window.L2M_previewStack = function (key) { return FONTS[key] ? '"l2m-pv-' + key + '", ' + FONTS[key].stack : ""; };
  // (fetched once the app is idle and no paper is open: fonts added have the whole page restyled and laid out again,
  // for a long paper a second or more on a phone; a paper open, they wait till it is left, or the font list opens)
  window.addEventListener("load", function () {
    (function soon() {
      setTimeout(function () {
        (window.requestIdleCallback || setTimeout)(function () { if (window.L2M_current) soon(); else window.L2M_previewFonts(); });
      }, 3000);
    })();
  });
  function attr(name, value, def) {
    if (value && value !== def) root.setAttribute(name, value); else root.removeAttribute(name);
  }
  window.L2M_loadFont = load;
  window.L2M_applyFont = function (key) {
    if (!FONTS[key] || key === DEF.font) { root.style.removeProperty("--serif"); return; }
    load(key);
    root.style.setProperty("--serif", FONTS[key].stack);
  };
  // the browser's bar (and a phone's status bar) in the page's own colour (theme.css's --ground), whatever the
  // appearance and tone; the page's meta tags give it before this runs
  function barColour() {
    if (barHeld) { barDue = true; return; }       // (a change of colours under way: once the screen is in the new ground)
    var c = getComputedStyle(root).getPropertyValue("--ground").trim();
    if (c) Array.prototype.forEach.call(document.querySelectorAll('meta[name="theme-color"]'), function (m) { m.setAttribute("content", c); });
  }
  window.L2M_barColour = barColour;
  if (window.matchMedia) {
    var dark = window.matchMedia("(prefers-color-scheme: dark)");
    if (dark.addEventListener) dark.addEventListener("change", barColour);
  }
  window.L2M_applyTheme = function (t) { attr("data-theme", t === "light" || t === "dark" ? t : "", "system"); barColour(); };
  window.L2M_applySize = function (z) { attr("data-size", z, DEF.size); };
  window.L2M_applyWidth = function (w) { attr("data-width", w, "narrow"); };
  // the page width chosen: at once the bars and panels glide to it while the text fades out; the text keeps its width
  // until it is out of sight, is then laid out anew (KEEP holds the reader's place through it) and fades back in
  window.L2M_changeWidth = function (w, keep) {
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var held = Array.prototype.map.call(document.querySelectorAll("main, .app-pane-in, .peek-main"), function (el) {
      var c = getComputedStyle(el), was = [el, el.style.width, el.style.maxWidth];
      el.style.width = c.width;
      el.style.maxWidth = c.width;
      return was;
    });
    root.classList.add("l2m-widthing", "l2m-width-fade");
    clearTimeout(root.l2mWidthT);
    window.L2M_applyWidth(w);
    setTimeout(function () {
      (keep || function (f) { f(); })(function () {
        held.forEach(function (h) { h[0].style.width = h[1]; h[0].style.maxWidth = h[2]; });
      });
      root.classList.remove("l2m-width-fade");
      root.l2mWidthT = setTimeout(function () { root.classList.remove("l2m-widthing"); }, 300);
    }, reduced ? 0 : 180);                         // (the text wholly out of sight first)
  };
  window.L2M_applyTone = function (t) { attr("data-tone", t, DEF.tone); barColour(); };
  // A change of colours (theme, tone): the page's words fade out as its ground turns into the new one (a veil in the new
  // ground over the page, under the bar and the panels, whose glass stays in sight; theme.css names the grounds), then
  // the new colours come in all together, the words with them. The
  // page is restyled once, the moment the veil has closed over it (before, the change would show through it), and the
  // second step waits till the page is drawn anew under it. The glass changes by a cross-fade: a copy of what is in
  // sight, its old colours held in it, laid over it as the colours change, fades out as the glass, in its new ones,
  // fades in. Every move is a fade, which the compositor plays at full pace however busy the page is (a colour moved by
  // the page itself, at every frame, had a frame only as often as the page could draw one: a few, on a phone).
  // (A view transition cross-faded two pictures of the page, but had the page restyled whole as it began and again as
  // it ended: three restyles for one change, the screen still until the second was done)
  var veil = null, veilT = 0, veilApply = null, barHeld = false, barDue = false, OUT = 130, IN = 200;   // (theme.css's .l2m-veil)
  var GLASS = ".l2m-bar, .l2m-menu, .l2m-fnsheet, .app-toast";    // (what stays above the veil)
  var ghosts = [];                                           // [the glass, its copy, the glass's hold out of sight]
  function releaseBar() { barHeld = false; if (barDue) { barDue = false; barColour(); } }
  function shown(el) { return !el.checkVisibility || el.checkVisibility({visibilityProperty: true, opacityProperty: true}); }
  function ghostsOver() {                                    // the glass in sight copied as it is, its colours held
    var cs = getComputedStyle(root), held = [];
    for (var i = 0; i < cs.length; i++) if (cs[i].lastIndexOf("--", 0) === 0) held.push([cs[i], cs.getPropertyValue(cs[i])]);
    ghosts = Array.prototype.filter.call(document.querySelectorAll(GLASS), shown).map(function (el) {
      var g = el.cloneNode(true), from = el.querySelectorAll("*"), to = g.querySelectorAll("*"), own = getComputedStyle(el);
      // (the ones it has from the page; not its own, as a panel's unrolling: held, the copy would be rolled up)
      held.forEach(function (h) { if (own.getPropertyValue(h[0]) === h[1]) g.style.setProperty(h[0], h[1]); });
      g.style.colorScheme = cs.colorScheme;
      g.style.pointerEvents = "none";
      g.setAttribute("aria-hidden", "true");
      g.inert = true;
      el.after(g);
      for (var k = 0; k < from.length; k++) {                // (where its lists are scrolled to, what its fields hold)
        if (from[k].scrollTop || from[k].scrollLeft) { to[k].scrollTop = from[k].scrollTop; to[k].scrollLeft = from[k].scrollLeft; }
        if ("value" in from[k] && from[k].value !== to[k].value) try { to[k].value = from[k].value; } catch (e) {}
      }
      return [el, g, el.animate ? el.animate([{opacity: 0}], {fill: "forwards"}) : null];
    });
  }
  function ghostsGone() { ghosts.forEach(function (x) { if (x[2]) x[2].cancel(); x[1].remove(); }); ghosts = []; }
  function groundOf(to) {                                    // the page's ground once TO ({theme} or {tone}) is applied
    var theme = to.theme != null ? to.theme : root.getAttribute("data-theme") || "system";
    var tone = to.tone != null ? to.tone : root.getAttribute("data-tone") || DEF.tone;
    var dark = theme === "dark" || (theme !== "light" && !!window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    var c = getComputedStyle(root).getPropertyValue("--ground-" + (tone === "paper" ? "paper" + (dark ? "-dark" : "") : dark ? "dark" : "light")).trim();
    return c || getComputedStyle(root).getPropertyValue("--ground").trim();
  }
  window.L2M_fade = function (apply, to) {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    window.L2M_endFade();
    if (!veil) {                                             // (made, and seen unshown once, so that its first showing fades)
      veil = document.createElement("div"); veil.className = "l2m-veil"; document.body.appendChild(veil);
      getComputedStyle(veil).opacity;
    }
    veil.style.backgroundColor = groundOf(to || {});           // (the ground moves to the new one as the words go)
    veil.classList.remove("cut", "out");
    veil.classList.add("on");                                // the words out
    veilApply = apply;
    barHeld = true;
    veilT = setTimeout(function () {
      var f = veilApply;
      veilApply = null;
      if (Element.prototype.animate) ghostsOver();
      f();                                                   // (the restyle)
      getComputedStyle(root).color;
      releaseBar();                                          // (the browser's bar: the screen is in the new ground)
      requestAnimationFrame(function () {                    // (and once the page is drawn anew, out of sight)
        veilT = setTimeout(function () {
          ghosts.forEach(function (x) {                      // the glass's cross-fade: the new in under the old first, the
            if (x[2]) x[2].cancel();                         // old out over it after (two half-shown panes of glass would
            x[2] = null;                                     // show the page through them)
            x[0].animate([{opacity: 0}, {opacity: 1}], {duration: IN / 2, easing: "ease-out"});
            x[1].animate([{opacity: 1}, {opacity: 0}], {duration: IN, easing: "ease-in", fill: "forwards"});
          });
          veil.classList.add("out");
          veil.classList.remove("on");                       // the new colours in, words and all
          veilT = setTimeout(ghostsGone, IN + 40);
        }, 0);
      });
    }, OUT + 10);
    return true;
  };
  // A panel's film keeps to its shown edge as it unrolls (theme.css): the edge moves at the panel's pace from under the
  // bar to 60px past the panel's foot (room for its shadow), the film's bottom with it but no further than the foot.
  // A move the compositor plays has one pace from start to end, so the film's is made for this panel and this way
  // (opening, or closing): the panel's own pace, the film's share of each moment of it
  function bezier(t) {                         // cubic-bezier(0.2, 0.8, 0.2, 1) at t
    var lo = 0, hi = 1, s = t;
    for (var i = 0; i < 24; i++) { s = (lo + hi) / 2; if (3 * (1 - s) * s * (0.2 * (1 - s) + 0.2 * s) + s * s * s < t) lo = s; else hi = s; }
    return 3 * (1 - s) * s * (0.8 * (1 - s) + 1 * s) + s * s * s;
  }
  window.L2M_filmPace = function (el, opening) {
    var cs = getComputedStyle(root), top = (parseFloat(cs.getPropertyValue("--l2m-bar-h")) || 64) + (parseFloat(cs.getPropertyValue("--l2m-join-h")) || 0);
    var h = el.offsetHeight, span = h + 60 - top;
    if (!(span > 60)) return;
    var k = (h - top) / span, pts = [];
    if (!el.querySelector(":scope > .l2m-film")) {   // (theme.css: the frame, and the colours in it)
      var f = document.createElement("span"); f.className = "l2m-film"; f.setAttribute("aria-hidden", "true");
      f.appendChild(document.createElement("i")); el.insertBefore(f, el.firstChild);
      getComputedStyle(f.firstChild).transform;      // (seen where it starts, so that it moves from there)
    }
    for (var i = 0; i <= 30; i++) {
      var t = i / 30, e = bezier(t), g = opening ? Math.min(1, e / k) : Math.max(0, (e - (1 - k)) / k);
      pts.push(g.toFixed(4) + " " + (t * 100).toFixed(2) + "%");
    }
    el.style.setProperty("--film-pace", "linear(" + pts.join(", ") + ")");
  };
  // reading in full screen (on a touch screen whose browser allows it; not an iPhone): on unless turned off
  window.L2M_canFull = function () {
    var d = document.documentElement;
    return !!(document.fullscreenEnabled && d.requestFullscreen && window.matchMedia && matchMedia("(pointer: coarse)").matches);
  };
  window.L2M_fullOn = function () { return window.L2M_prefs().full === "on"; };
  window.L2M_endFade = function () {           // (at once: the change applied, the veil and the copies gone)
    clearTimeout(veilT);
    if (veilApply) { var f = veilApply; veilApply = null; f(); }
    if (veil) { veil.classList.add("cut"); veil.classList.remove("on", "out"); }
    ghostsGone();
    releaseBar();
  };
  // found words marked as a highlighter would (a band over the letters): where the browser draws it (Chromium)
  if (/Chrome\/\d/.test(navigator.userAgent)) document.documentElement.classList.add("l2m-marker");
  // while something is selected, links take part (otherwise a long press on one opens the peek, not a selection)
  var selTick = 0;
  document.addEventListener("selectionchange", function () {
    if (selTick) return;
    selTick = requestAnimationFrame(function () {
      selTick = 0;
      var sel = window.getSelection && window.getSelection();
      document.documentElement.classList.toggle("l2m-selecting", !!(sel && sel.rangeCount && !sel.isCollapsed));
    });
  });
  window.L2M_prefs = function () {
    try { return JSON.parse(localStorage.getItem("l2m-prefs") || "{}") || {}; } catch (e) { return {}; }
  };
  window.L2M_savePrefs = function (p) { try { localStorage.setItem("l2m-prefs", JSON.stringify(p)); } catch (e) {} };

  window.L2M_initPrefs = function (theme) {
    FONTS = {};
    (theme.fonts || []).forEach(function (f) { FONTS[f.key] = f; });
    DEF = theme.defaults || {};
    if (DEF.font) load(DEF.font);
    if (theme.uiFont && !(INLINE && INLINE.ui) && !own() && !document.getElementById("l2m-font-ui")) {      // the font of the bar, panels and app lists
      var l = document.createElement("link");
      l.id = "l2m-font-ui";
      l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=" + theme.uiFont + "&display=swap";
      (document.head || root).appendChild(l);
    }
    var p = window.L2M_prefs();
    window.L2M_applyFont(p.font || DEF.font);
    window.L2M_applyTheme(p.theme || DEF.appearance);
    window.L2M_applySize(p.size || DEF.size);
    window.L2M_applyWidth(p.width || "narrow");
    window.L2M_applyTone(p.tone || DEF.tone);
  };
  if (window.L2M_THEME) window.L2M_initPrefs(window.L2M_THEME);   // a bundled page carries its theme inline

})();
