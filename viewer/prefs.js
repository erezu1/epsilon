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

  function load(key) {
    var f = FONTS[key];
    if (!f || !f.css) return;
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
  var previews = 0;                    // 0 not asked, 1 coming, 2 in, -1 not to be had
  window.L2M_previewFonts = function () {
    if (previews) return;
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
  window.L2M_previewReady = function () { return previews === 2; };
  window.L2M_previewStack = function (key) { return FONTS[key] ? '"l2m-pv-' + key + '", ' + FONTS[key].stack : ""; };
  window.addEventListener("load", function () {
    setTimeout(function () { (window.requestIdleCallback || setTimeout)(function () { window.L2M_previewFonts(); }); }, 3000);
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
  window.L2M_applyTheme = function (t) { attr("data-theme", t === "light" || t === "dark" ? t : "", "system"); };
  window.L2M_applySize = function (z) { attr("data-size", z, DEF.size); };
  window.L2M_applyTone = function (t) { attr("data-tone", t, DEF.tone); };
  // a change of colours (theme, tone) cross-fades the page; the fade shows a still picture of the page, so anything
  // that moves meanwhile (a panel closing) cuts it short and moves in sight
  var fadeVT = null;
  window.L2M_fade = function (apply) {
    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (document.startViewTransition && !reduced) {
      try {
        var vt = fadeVT = document.startViewTransition(apply);
        vt.finished.then(function () { if (fadeVT === vt) fadeVT = null; }, function () { if (fadeVT === vt) fadeVT = null; });
        return true;
      } catch (e) {}
    }
    return false;
  };
  // reading in full screen (on a touch screen whose browser allows it; not an iPhone): on unless turned off
  window.L2M_canFull = function () {
    var d = document.documentElement;
    return !!(document.fullscreenEnabled && d.requestFullscreen && window.matchMedia && matchMedia("(pointer: coarse)").matches);
  };
  window.L2M_fullOn = function () { return window.L2M_prefs().full === "on"; };
  window.L2M_endFade = function () { if (fadeVT) { try { fadeVT.skipTransition(); } catch (e) {} fadeVT = null; } };
  // found words marked as a highlighter would (a band over the letters): where the browser draws it (Chromium)
  if (/Chrome\/\d/.test(navigator.userAgent)) document.documentElement.classList.add("l2m-marker");
  // a selection shows over formulas too (drawn as pictures, they have no text to select): each formula it reaches is
  // shaded as selected text is, and it is copied whole (as its LaTeX)
  var selMarked = [], selTick = 0;
  document.addEventListener("selectionchange", function () {
    if (selTick) return;
    selTick = requestAnimationFrame(function () {
      selTick = 0;
      var sel = window.getSelection && window.getSelection(), now = [];
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        var r = sel.getRangeAt(0), box = r.commonAncestorContainer;
        box = box.nodeType === 1 ? box : box.parentElement;
        var f = box && box.closest ? box.closest("mjx-container") : null;
        var all = f ? [f] : box ? box.querySelectorAll("mjx-container") : [];
        Array.prototype.forEach.call(all, function (m) { if (sel.containsNode(m, true)) now.push(m); });
      }
      selMarked.forEach(function (m) { if (now.indexOf(m) < 0) { m.classList.remove("l2m-selected"); m.style.boxShadow = ""; } });
      // (all measured first, then all shaded: one layout, not one per formula)
      var fresh = now.filter(function (m) { return selMarked.indexOf(m) < 0 && !m.closest(".eqbody"); });
      var gaps = fresh.map(function (m) {           // in a line of text: shaded the line's full height, as the text is
        var r = m.getBoundingClientRect(), lh = parseFloat(getComputedStyle(m.parentElement).lineHeight) || r.height;
        return Math.max(0, Math.ceil((lh - r.height) / 2 + 0.5));
      });
      now.forEach(function (m) { m.classList.add("l2m-selected"); });
      fresh.forEach(function (m, i) {
        var t = gaps[i];
        m.style.boxShadow = t ? "0 " + (-t).toFixed(1) + "px 0 0 var(--sel), 0 " + t.toFixed(1) + "px 0 0 var(--sel)" : "";
      });
      selMarked = now;
      // while something is selected, links take part (otherwise a long press on one opens the peek, not a selection)
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
    if (theme.uiFont && !document.getElementById("l2m-font-ui")) {      // the font of the bar, panels and app lists
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
    window.L2M_applyTone(p.tone || DEF.tone);
  };
  if (window.L2M_THEME) window.L2M_initPrefs(window.L2M_THEME);   // a bundled page carries its theme inline

})();
