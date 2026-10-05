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
  // the reader's colours and widths at once, from what is kept (theme.json's defaults left unset), so that the page
  // drawn while the rest loads (the stand-ins) is in them already
  try {
    var kept = JSON.parse(localStorage.getItem("l2m-prefs") || "{}") || {};
    if (kept.theme === "light" || kept.theme === "dark") root.setAttribute("data-theme", kept.theme);
    if (kept.tone && kept.tone !== "neutral") root.setAttribute("data-tone", kept.tone);
    if (kept.width && kept.width !== "narrow") root.setAttribute("data-width", kept.width);
    if (kept.size && kept.size !== "m") root.setAttribute("data-size", kept.size);
    if (kept.skin && kept.skin !== "glass") root.setAttribute("data-skin", kept.skin);
  } catch (e) {}
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
  window.L2M_applySkin = function (s) { attr("data-skin", s, "glass"); };      // (theme.css's skins)
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
  // A change of colours (theme, tone), the glass staying in sight. At once, the ground and the glass turn to the new
  // colours as the words go, the page's and the glass's: a veil in the new ground comes in over the page (under the
  // glass), a layer in the new ground comes in inside each piece of glass (under its film: with the new ground behind
  // it, that is the new glass's look), and the glass's contents fade out. Under all that, out of sight, the page and the
  // glass are restyled (nothing moving meanwhile: on a phone a moment); then the layers go (the glass is now as they
  // were) and the new words come in, the page's and the glass's. Every move is an opacity, which the compositor plays at
  // its own pace however busy the page is, and nothing heavy is done at the tap. (A view transition restyled the page
  // three times)
  var veil = null, veilT = 0, veilApply = null, barHeld = false, barDue = false, MID = 220, IN = 220;
  function releaseBar() { barHeld = false; if (barDue) { barDue = false; barColour(); } }
  var GLASS = ".glass-top, .glass-bottom.glass";             // (the glass in sight: the bar, a panel, a footer; not the peek,
  var tints = [];                                            // which is of the page) [the glass's new-ground layer, its contents' fades]
  function shown(el) { return !el.checkVisibility || el.checkVisibility({visibilityProperty: true, opacityProperty: true}); }
  function glassShown() {                                   // (the glass is the page's own, or in its chrome: looked for
    var out = [];                                            // there, not through a paper's tens of thousands of elements)
    Array.prototype.forEach.call(document.body.children, function (c) {
      if (c.matches(GLASS)) out.push(c);
      else if (c.classList.contains("l2m-chrome")) Array.prototype.forEach.call(c.children, function (d) { if (d.matches(GLASS)) out.push(d); });
    });
    return out.filter(shown);
  }
  function tintsIn(ground) {                                 // the glass to its new look, its contents out
    tints = glassShown().map(function (el) {
      var t = document.createElement("span");
      t.className = "l2m-tint";
      t.setAttribute("aria-hidden", "true");
      t.style.backgroundColor = ground;
      el.appendChild(t);
      var fades = [t.animate([{opacity: 0}, {opacity: 1}], {duration: MID, easing: "ease-in-out", fill: "forwards"})];
      Array.prototype.forEach.call(el.children, function (c) {
        if (c !== t && !c.classList.contains("l2m-film")) fades.push(c.animate([{opacity: 1}, {opacity: 0}], {duration: MID, easing: "ease-in-out", fill: "forwards"}));
      });
      return [t, fades];
    });
  }
  function tintsOut(fade) {                                  // the layers gone (the glass as they were), its contents in
    tints.forEach(function (x) {
      x[0].remove();
      x[1].slice(1).forEach(function (a) {
        a.cancel();
        if (fade) a.effect.target.animate([{opacity: 0}, {opacity: 1}], {duration: IN, easing: "ease-in-out"});
      });
    });
    tints = [];
  }
  function groundOf(to) {                                    // the page's ground once TO ({theme} or {tone}) is applied
    var theme = to.theme != null ? to.theme : root.getAttribute("data-theme") || "system";
    var tone = to.tone != null ? to.tone : root.getAttribute("data-tone") || DEF.tone;
    var dark = theme === "dark" || (theme !== "light" && !!window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    var c = getComputedStyle(root).getPropertyValue("--ground-" + (tone === "paper" ? "paper" + (dark ? "-dark" : "") : dark ? "dark" : "light")).trim();
    return c || getComputedStyle(root).getPropertyValue("--ground").trim();
  }
  function makeVeil(cls) {                    // (made, and seen unshown once, so that its first showing fades)
    var v = document.createElement("div");
    v.className = "l2m-veil " + cls;
    document.body.appendChild(v);
    getComputedStyle(v).opacity;
    return v;
  }
  window.L2M_fade = function (apply, to) {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    window.L2M_endFade();
    if (!veil) veil = makeVeil("l2m-veil-new");
    var ground = groundOf(to || {});
    veil.style.backgroundColor = ground;
    veil.classList.remove("cut", "out");
    veilApply = apply;
    barHeld = true;
    veil.classList.add("on");                                // 1. the ground and the glass to the new colours, the words out
    if (Element.prototype.animate) tintsIn(ground);
    veilT = setTimeout(function () {
      var f = veilApply;
      veilApply = null;
      f();                                                   // 2. the page and the glass restyled, out of sight
      getComputedStyle(root).color;
      releaseBar();                                          //    (the browser's bar: in the new ground)
      afterPaint(function () {
        tintsOut(true);                                      // 3. the new words in, the page's and the glass's
        veil.classList.add("out");
        veil.classList.remove("on");
      });
    }, MID + 10);
    return true;
  };
  // A panel is one piece of glass growing from the bar's (theme.css): it moves down by its height less the bar's, which
  // it is told as it opens or closes (it may have changed meanwhile); and it has its film, the rim and the colours
  window.L2M_filmPace = function (el, opening) {
    if (!el) return;
    if (!el.querySelector(":scope > .l2m-film")) {
      var f = document.createElement("span"); f.className = "l2m-film"; f.setAttribute("aria-hidden", "true");
      f.appendChild(document.createElement("i")); el.insertBefore(f, el.firstChild);
    }
    var h = el.offsetHeight + "px";
    if (el.style.getPropertyValue("--l2m-panel-h") === h) return;
    if (opening) el.classList.add("l2m-still");      // (closed: put where it starts at once, not moved there)
    el.style.setProperty("--l2m-panel-h", h);
    if (opening) { getComputedStyle(el).translate; if (el.lastElementChild) getComputedStyle(el.lastElementChild).translate; el.classList.remove("l2m-still"); }
  };
  // reading in full screen (on a touch screen whose browser allows it; not an iPhone): on unless turned off
  window.L2M_canFull = function () {
    var d = document.documentElement;
    return !!(document.fullscreenEnabled && d.requestFullscreen && window.matchMedia && matchMedia("(pointer: coarse)").matches);
  };
  window.L2M_fullOn = function () { return window.L2M_prefs().full === "on"; };
  var veilRaf = 0;
  function afterPaint(fn) {                    // fn once what is changed now is on the screen (two frames on)
    veilRaf = requestAnimationFrame(function () { veilRaf = requestAnimationFrame(function () { veilRaf = 0; fn(); }); });
  }
  window.L2M_endFade = function () {           // (at once: the change applied, the veils gone)
    clearTimeout(veilT);
    if (veilRaf) { cancelAnimationFrame(veilRaf); veilRaf = 0; }
    if (veilApply) { var f = veilApply; veilApply = null; f(); }
    if (veil) { veil.classList.add("cut"); veil.classList.remove("on", "out"); }
    tintsOut(false);
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
    window.L2M_applySkin(p.skin || theme.skin || "glass");             // (the reader's, or the app's own)
    window.L2M_applyFont(p.font || DEF.font);
    window.L2M_applyTheme(p.theme || DEF.appearance);
    window.L2M_applySize(p.size || DEF.size);
    window.L2M_applyWidth(p.width || "narrow");
    window.L2M_applyTone(p.tone || DEF.tone);
  };
  if (window.L2M_THEME) window.L2M_initPrefs(window.L2M_THEME);   // a bundled page carries its theme inline

  // On a wide screen with a mouse: one scroll bar for a paper and the app's lists alike, just past the page's right
  // margin, from under the bar to the foot (the browser's own is at the window's edge for a paper, at the lists' for
  // the app, partly under the bar); seen while scrolling or under the mouse, and it can be dragged (theme.css)
  (function () {
    var wide = window.matchMedia && matchMedia("(min-width: 800px) and (hover: hover) and (pointer: fine)");
    if (!wide) return;
    var thumb = null, idle = 0, drag = null, queued = false, at = null;
    function doc(s) { return s === document.scrollingElement || s === root; }
    function scroller() {                        // the page, or the app's list in sight
      if (!root.classList.contains("l2m-app-lists")) return document.scrollingElement || root;
      var ps = document.querySelectorAll(".app-pane"), mid = window.innerWidth / 2;
      for (var i = 0; i < ps.length; i++) { var r = ps[i].getBoundingClientRect(); if (r.left <= mid && r.right > mid) return ps[i]; }
      return null;
    }
    function place() {
      queued = false;
      var s = scroller();
      if (!s) return;
      var view = doc(s) ? window.innerHeight : s.clientHeight, full = s.scrollHeight, y = doc(s) ? window.pageYOffset : s.scrollTop;
      thumb.classList.toggle("none", full <= view + 1);
      if (full <= view + 1) return;
      var top = (parseFloat(getComputedStyle(root).getPropertyValue("--l2m-bar-h")) || 64) + 8, track = window.innerHeight - top - 8;
      var h = Math.round(Math.max(36, track * view / full));
      if (thumb.l2mH !== h) { thumb.style.height = h + "px"; thumb.l2mH = h; }
      thumb.style.transform = "translateY(" + (top + (track - h) * Math.min(1, y / (full - view))) + "px)";
      at = [s, (full - view) / Math.max(1, track - h)];
    }
    function queue() { if (!queued && thumb) { queued = true; requestAnimationFrame(place); } }
    function shown() {                           // in sight a moment, as the browser's own is while scrolling
      thumb.classList.add("on");
      clearTimeout(idle);
      idle = setTimeout(function () { thumb.classList.remove("on"); }, 900);
    }
    function start() {
      if (thumb || !document.body) return;
      thumb = document.createElement("div");
      thumb.className = "l2m-thumb";
      thumb.setAttribute("aria-hidden", "true");
      thumb.appendChild(document.createElement("i"));
      document.body.appendChild(thumb);
      document.addEventListener("scroll", function (e) {
        var s = scroller();
        if (!s || (doc(s) ? e.target !== document : e.target !== s)) return;
        queue(); shown();
      }, {capture: true, passive: true});
      window.addEventListener("resize", queue);
      thumb.addEventListener("pointerenter", queue);
      thumb.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 || !at) return;
        e.preventDefault();
        thumb.setPointerCapture(e.pointerId);
        drag = {y: e.clientY, from: doc(at[0]) ? window.pageYOffset : at[0].scrollTop, s: at[0], k: at[1]};
        thumb.classList.add("drag");
      });
      thumb.addEventListener("pointermove", function (e) {
        if (!drag) return;
        var v = drag.from + (e.clientY - drag.y) * drag.k;
        if (doc(drag.s)) window.scrollTo(0, v); else drag.s.scrollTop = v;
      });
      var end = function () { drag = null; thumb.classList.remove("drag"); };
      thumb.addEventListener("pointerup", end);
      thumb.addEventListener("pointercancel", end);
      queue();
    }
    function apply() {
      root.classList.toggle("l2m-thumbed", wide.matches);
      if (wide.matches) { if (document.body) start(); else document.addEventListener("DOMContentLoaded", start); queue(); }
    }
    apply();
    if (wide.addEventListener) wide.addEventListener("change", apply);
  })();

})();
