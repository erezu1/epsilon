// latex2mobile paper view: reading bar (back / contents / top / settings), footnote sheet and figure
// viewer. Every internal link becomes a history step, so the browser's back button and the bar's back
// button both return to the exact place the reader left.
//
// L2M_nav(opts) starts it on the page viewer.js has drawn and returns {destroy}, so one page can open
// and close many papers. opts: key (which paper; history entries are tagged with it), theme,
// ready (a promise: the saved place is restored once formulas and images are in), onLibrary.
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

  function flash(el) {
    var t = el.closest(".display, .thm, .defn, .remark, figure, li, h2, h3, h4, h5, p") || el;
    t.classList.remove("l2m-flash");
    void t.offsetWidth;
    t.classList.add("l2m-flash");
  }

  function saveHere() {
    if (!useHistory) return;
    try { history.replaceState(assign(state(), {l2mIdx: idx, l2mY: window.pageYOffset, l2mPaper: KEY}), ""); } catch (e) {}
  }

  function navigate(id) {
    var el = document.getElementById(id);
    if (!el) return false;
    var from = window.pageYOffset;
    var y = id === "l2m-top" ? 0 : yOf(el);
    if (useHistory) {
      try {
        history.replaceState(assign(state(), {l2mIdx: idx, l2mY: from, l2mPaper: KEY}), "");
        var next = {l2mIdx: idx + 1, l2mY: y, l2mId: id, l2mPaper: KEY};
        try { history.pushState(next, "", "#" + id); } catch (e1) { history.pushState(next, ""); }
        idx += 1;
      } catch (e2) { useHistory = false; mem.push(from); }
    } else {
      mem.push(from);
    }
    scrollToY(y);
    if (id !== "l2m-top") flash(el);
    update();
    return true;
  }

  function goBack() {
    if (useHistory && idx > 0) { saveHere(); history.back(); return; }
    if (mem.length) { scrollToY(mem.pop()); update(); }
  }

  var skipPop = false;       // the history step of a panel being closed by hand: already handled
  on(window, "popstate", function (e) {
    if (skipPop) { skipPop = false; return; }
    if (panel) { closeMenu("pop"); return; }       // back closes the open panel, nothing else
    var st = e.state;
    if (st && st.l2mPaper !== undefined && st.l2mPaper !== KEY) return;   // another paper's entry: the host switches
    if (st && typeof st.l2mIdx === "number") {
      idx = st.l2mIdx;
      var el = st.l2mId ? document.getElementById(st.l2mId) : null;
      if (typeof st.l2mY === "number") scrollToY(st.l2mY);
      else if (el) scrollToY(yOf(el));
    } else if (location.hash.length > 1) {
      var t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (t) scrollToY(yOf(t));
    }
    closeMenu();
    closeSheet();
    closeViewer();
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
      try { if (!state().l2mPanel) history.pushState(assign(state(), {l2mPanel: true}), ""); } catch (e) {}
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
      if (cur) box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 2);
    } else {
      for (var key in FONTS) if (window.L2M_loadFont) window.L2M_loadFont(key);
      refreshSettings(true);
    }
    var inner = el.querySelector(".menu-inner");
    if (inner) { edgeFade(inner); requestAnimationFrame(function () { edgeFade(inner); }); }
    update();
  }
  function closeMenu(how) {          // closes whichever panel is open; how: "pop" (by back), "jump" (a link follows)
    if (!panel) return;
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
    bar.classList.remove("menu-open");
    root.classList.remove("l2m-settings-open");
    titleBtn.setAttribute("aria-expanded", "false");
    backBtn.setAttribute("aria-label", "Back to where you were");
    update();
  }
  function toggle(name) {
    return function (e) {
      e.stopPropagation();
      if (panel === name) closeMenu(); else openPanel(name);
    };
  }

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
    var want = {"data-theme-opt": look, "data-size-opt": session.size || DEF.size, "data-tone-opt": session.tone || DEF.tone};
    for (var attr in want) {
      var segs = el.querySelectorAll("[" + attr + "]");
      for (var m = 0; m < segs.length; m++) segs[m].setAttribute("aria-checked", segs[m].getAttribute(attr) === want[attr] ? "true" : "false");
    }
    placeIndicators(instant);
  }
  function keepPlace(change) {
    // keep the text the reader is looking at in the same place while the layout changes
    var main = document.querySelector("main"), anchor = null, y0 = 0;
    var probe = document.elementsFromPoint ? document.elementsFromPoint(window.innerWidth / 2, window.innerHeight - 40) : [];
    for (var k = 0; k < probe.length; k++) {
      if (main.contains(probe[k]) && probe[k] !== main) { anchor = probe[k]; break; }
    }
    if (anchor) y0 = anchor.getBoundingClientRect().top;
    change();
    function fix() {
      if (anchor) window.scrollBy(0, anchor.getBoundingClientRect().top - y0);
      root.style.setProperty("--l2m-bar-h", barHeight() + "px");
      update();
    }
    fix();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fix);
  }
  function swapTheme(t) { crossfade(function () { window.L2M_applyTheme(t); }); }
  function crossfade(apply) {
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { apply(); return; }
    if (document.startViewTransition) {
      try { document.startViewTransition(apply); return; } catch (e) {}
    }
    // fallback: a veil in the page color fades in, the theme changes under it, and it fades out
    var veil = document.querySelector(".l2m-veil");
    if (!veil) {
      veil = document.createElement("div");
      veil.className = "l2m-veil";
      document.body.appendChild(veil);
    }
    void veil.offsetWidth;
    veil.classList.add("on");
    setTimeout(function () {
      apply();
      requestAnimationFrame(function () { veil.classList.remove("on"); });
    }, 150);
  }

  if (panels.settings) {
    panels.settings.addEventListener("click", function (e) {
      var b = e.target.closest("[data-font], [data-theme-opt], [data-size-opt], [data-tone-opt]");
      if (!b) return;
      var f = b.getAttribute("data-font"), t = b.getAttribute("data-theme-opt");
      var z = b.getAttribute("data-size-opt"), tone = b.getAttribute("data-tone-opt");
      if (f) {
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
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
    return true;
  }
  function closeSheet() {
    if (!sheet || !sheet.classList.contains("open")) return;
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
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
    viewer.classList.add("open");
    viewer.setAttribute("aria-hidden", "false");
    root.classList.add("l2m-noscroll");
    return true;
  }
  function closeViewer() {
    if (!viewerOpen()) return;
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
    viewer.querySelector('[data-act="vclose"]').addEventListener("click", closeViewer);
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
        setTimeout(function () { if (lastTap === now) closeViewer(); }, 330);
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

  // ---------------------------------------------------------------- clicks and keys
  on(document, "click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest("a[href^='#']") : null;
    if (a && a.closest(".fnref") && openSheet(a)) {
      e.preventDefault();
      return;
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
    if (sheet && sheet.classList.contains("open") && !sheet.contains(e.target)) closeSheet();
  });
  on(document, "keydown", function (e) {
    if (e.key === "Escape") { closeViewer(); closeMenu(); closeSheet(); }
  });
  backBtn.addEventListener("click", function () {
    if (panel) closeMenu(); else goBack();
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
    sheet.querySelector('[data-act="fnclose"]').addEventListener("click", closeSheet);
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

  function update() {
    var show = ALWAYS || (trigger ? trigger.getBoundingClientRect().bottom < 8 : window.pageYOffset > 240) || panel !== null;
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
    backBtn.disabled = !(panel || (useHistory ? idx > 0 : mem.length > 0));
  }

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
    update();
  });

  function start() {
    root.style.setProperty("--l2m-bar-h", barHeight() + "px");
    var st = state();
    if (typeof st.l2mY === "number" && st.l2mPaper === KEY) {
      scrollToY(st.l2mY);
    } else if (location.hash.length > 1) {
      var el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (el) { scrollToY(yOf(el)); flash(el); }
    }
    update();
  }
  // the saved place is found once the formulas and images are in (opts.ready)
  Promise.resolve(opts.ready).then(function () { if (!dead) start(); });
  update();

  return {
    destroy: function (save) {
      if (dead) return;
      if (save !== false) saveHere();
      dead = true;
      closeViewer();
      closeSheet();
      offs.forEach(function (o) { o[0].removeEventListener(o[1], o[2], o[3]); });
      offs = [];
      clearTimeout(fadeTimer);
      clearTimeout(saveTimer);
      root.classList.remove("l2m-noscroll", "l2m-settings-open");
    }
  };
};
