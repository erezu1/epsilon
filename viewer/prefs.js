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
  window.L2M_fullOn = function () { return window.L2M_prefs().full !== "off"; };
  window.L2M_endFade = function () { if (fadeVT) { try { fadeVT.skipTransition(); } catch (e) {} fadeVT = null; } };
  // found words marked as a highlighter would (a band over the letters): where the browser draws it (Chromium)
  if (/Chrome\/\d/.test(navigator.userAgent)) document.documentElement.classList.add("l2m-marker");
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
