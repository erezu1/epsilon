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
  // A change of colours (theme, tone), in three fades, each the compositor's (smooth however busy the page is): the
  // page fades into its ground (a veil in the old ground, over everything); the ground fades into the new one (a second
  // veil, in the new ground, over the first), the page restyled in its new colours under them meanwhile, out of sight;
  // and the page fades back in. next: what changes ({theme} or {tone}), whose ground theme.css names (without it, the
  // page is restyled first). (A view transition cross-faded two pictures of the page, but had the page restyled whole
  // as it began and again as it ended: three restyles for one change, the screen still until the second was done)
  var veils = null, veilT = 0, veilApply = null, barHeld = false, barDue = false, FADE = 170;
  function groundFor(theme, tone) {
    var dark = theme === "dark" || (theme !== "light" && !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches));
    return getComputedStyle(root).getPropertyValue("--ground-" + (tone === "paper" ? "paper" + (dark ? "-dark" : "") : dark ? "dark" : "light")).trim();
  }
  function veil(i) {
    if (!veils) veils = [0, 1].map(function () { var v = document.createElement("div"); v.className = "l2m-veil"; document.body.appendChild(v); return v; });
    return veils[i];
  }
  function cut(v) { v.classList.add("cut"); v.classList.remove("on", "out"); }
  function run() { if (veilApply) { var f = veilApply; veilApply = null; f(); } }
  function releaseBar() { barHeld = false; if (barDue) { barDue = false; barColour(); } }
  window.L2M_fade = function (apply, next) {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    window.L2M_endFade();
    var a = veil(0), b = veil(1);
    a.style.backgroundColor = getComputedStyle(root).getPropertyValue("--ground").trim();
    b.style.backgroundColor = next ? groundFor(next.theme != null ? next.theme : root.getAttribute("data-theme") || "system",
                                              next.tone != null ? next.tone : root.getAttribute("data-tone") || DEF.tone) : "";
    a.classList.remove("cut"); b.classList.remove("cut");
    a.classList.add("on");                                   // the page into its ground
    veilApply = apply;
    barHeld = true;
    veilT = setTimeout(function () {
      if (!b.style.backgroundColor) { run(); b.style.backgroundColor = getComputedStyle(root).getPropertyValue("--ground").trim(); }
      b.classList.add("on");                                 // the ground into the new one, and once that fade runs (on the
      requestAnimationFrame(function () { setTimeout(run, 0); });   // compositor), the page restyled under it
      veilT = setTimeout(function () {                       // the page back in its new colours
        run();
        cut(a);
        releaseBar();
        b.classList.add("out");
        b.classList.remove("on");
      }, FADE);
    }, FADE);
    return true;
  };
  // reading in full screen (on a touch screen whose browser allows it; not an iPhone): on unless turned off
  window.L2M_canFull = function () {
    var d = document.documentElement;
    return !!(document.fullscreenEnabled && d.requestFullscreen && window.matchMedia && matchMedia("(pointer: coarse)").matches);
  };
  window.L2M_fullOn = function () { return window.L2M_prefs().full === "on"; };
  window.L2M_endFade = function () {           // (at once: the change applied, the veils gone)
    clearTimeout(veilT);
    run();
    if (veils) { cut(veils[0]); cut(veils[1]); }
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
