// Epsilon app: marks in a paper. A mark is a stretch of the paper's text marked as with a highlighter, in one of three
// colours, with a note if the reader writes one. Text selected in the paper brings a bar up at the bottom (the
// three colours, Note, Find); a mark tapped opens its sheet (its colour, its note, a link to it, its removal), which
// takes a step in the history as the footnote's sheet does.
//
// nav.js starts it on an open paper when the host (app.js) keeps marks: L2M_marks(host) returns {closeSheet,
// reveal, destroy}. host.store keeps them (on the device at once; in the library, merged mark by mark):
// all() -> {id: mark}, put(mark), place(mark), pull() -> Promise(changed), flush(keepalive), link(id), version,
// toast(html), toastAct(html, label, fn).
//
// Where a mark is. The paper's text as one string: its words (each run of spaces as one), each formula as its TeX
// between $ signs, a line between blocks. A mark keeps its place in that string, the words it marks and a few
// before and after: in the same conversion its place still has its words; in a new one (the paper converted again)
// the words are looked for, those before and after choosing between repeats. A mark not found stays kept, unseen.
window.L2M_marks = function (host) {
  "use strict";
  var store = host.store, I = host.icons || {}, main = document.querySelector("main");
  var dead = false, offs = [];
  function on(t, type, fn, o) { t.addEventListener(type, fn, o); offs.push([t, type, fn, o]); }
  var NAMES = ["Green", "Pink", "Violet"];

  // ---------------------------------------------------------------- the paper's text
  var M = null, job = null;             // M: {C, segs, at (node -> segment), heads}, made once (the paper's text stays)
  function isWS(c) { return c === 32 || c === 10 || c === 9 || c === 13 || c === 12 || c === 160 || c === 8201 || c === 8202 || c === 8239; }
  var SKIP = "svg, script, style, button, textarea, input, [hidden], .skel-paper, .l2m-mark, details.toc, .l2m-libnav";
  var FORMULA = "mjx-container[data-n], l2m-math[n]";
  // The text is read once (it stays as long as the paper is open): at once when a mark is made, else a little at a
  // time in the page's idle moments (a long paper takes some tens of milliseconds on a phone)
  function begin() {
    return {C: "", segs: [], at: new Map(), heads: [], space: true, last: null,
      walk: document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {acceptNode: function (n) {
        if (n.nodeType === 1) {
          if (n.matches(FORMULA)) return NodeFilter.FILTER_ACCEPT;
          return n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }})};
  }
  function read(j, until) {                        // on from where it was, until a moment (0: to the end); done or not
    for (var n = j.walk.nextNode(); n; n = j.walk.nextNode()) {
      var blk = n.parentNode.closest(host.block);
      if (blk !== j.last) {
        if (j.C && j.C.charCodeAt(j.C.length - 1) !== 10) j.C += "\n";
        j.space = true;
        j.last = blk;
        if (blk && /^H[2-5]$/.test(blk.tagName) && blk.id) j.heads.push({a: j.C.length, id: blk.id});
      }
      if (n.nodeType === 1) {                    // a formula: its TeX
        var k = n.getAttribute("data-n") || n.getAttribute("n");
        var t = "$" + String(host.tex(k) || "").replace(/\s+/g, " ").trim() + "$";
        j.at.set(n, j.segs.length);
        j.segs.push({f: n, a: j.C.length, b: j.C.length + t.length});
        j.C += t;
        j.space = false;
      } else {
        var d = n.data, pre = j.space, out = "", space = j.space;
        for (var i = 0; i < d.length; i++) {
          var w = isWS(d.charCodeAt(i));
          if (w) { if (!space) { out += " "; space = true; } } else { out += d[i]; space = false; }
        }
        j.space = space;
        if (out) {
          j.at.set(n, j.segs.length);
          j.segs.push({t: n, a: j.C.length, b: j.C.length + out.length, pre: pre});
          j.C += out;
        }
      }
      if (until && performance.now() > until) return false;
    }
    M = {C: j.C, segs: j.segs, at: j.at, heads: j.heads};
    job = null;
    return true;
  }
  function model() { if (!M) { job = job || begin(); read(job, 0); } return M; }
  function idle(f) { (window.requestIdleCallback || function (g) { return setTimeout(g, 30); })(f, {timeout: 1500}); }
  function modelSoon() {
    return new Promise(function (res) {
      (function slice() {
        if (dead) return;
        if (M) { res(M); return; }
        job = job || begin();
        if (read(job, performance.now() + 6)) res(M); else idle(slice);
      })();
    });
  }
  // within a text segment: the node offset of the j-th character it gives the text; how many it gives up to an offset
  function srcIndex(s, j) {
    var d = s.t.data, space = s.pre, c = 0;
    for (var i = 0; i < d.length; i++) {
      var w = isWS(d.charCodeAt(i));
      if (w && space) continue;
      if (c === j) return i;
      c++; space = w;
    }
    return d.length;
  }
  function given(s, off) {
    var d = s.t.data, space = s.pre, c = 0;
    for (var i = 0; i < off && i < d.length; i++) {
      var w = isWS(d.charCodeAt(i));
      if (w && space) continue;
      c++; space = w;
    }
    return Math.min(c, s.b - s.a);
  }
  // a point of the page (a range's start, or its end) as a place in the text
  function placeOf(node, off, end) {
    var el = node.nodeType === 1 ? node : node.parentNode, f = el && el.closest ? el.closest(FORMULA) : null;
    if (f && M.at.has(f)) { var g = M.segs[M.at.get(f)]; return end ? g.b : g.a; }     // (in a formula: all of it)
    if (node.nodeType === 3 && M.at.has(node)) { var s = M.segs[M.at.get(node)]; return s.a + given(s, off); }
    var r = document.createRange();                 // between pieces of text: the next one (or, for an end, the last)
    try { r.setStart(node, off); } catch (e) { return -1; }
    var lo = 0, hi = M.segs.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1, x = M.segs[mid].t || M.segs[mid].f;
      if (r.comparePoint(x, 0) < 0) lo = mid + 1; else hi = mid;
    }
    if (end) return lo > 0 ? M.segs[lo - 1].b : 0;
    return lo < M.segs.length ? M.segs[lo].a : M.C.length;
  }
  function firstSeg(s) {                          // the first segment that ends after s
    var lo = 0, hi = M.segs.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (M.segs[mid].b <= s) lo = mid + 1; else hi = mid; }
    return lo;
  }
  // the page's range for the text's [s, e)
  function rangeOf(s, e) {
    var r = document.createRange(), i = firstSeg(s), g = M.segs[i];
    if (!g) return null;
    if (g.f) r.setStartBefore(g.f); else r.setStart(g.t, srcIndex(g, Math.max(0, s - g.a)));
    var j = firstSeg(e - 1), h = M.segs[j] || g;
    if (h.f) r.setEndAfter(h.f); else r.setEnd(h.t, e - h.a > 0 ? srcIndex(h, Math.min(e, h.b) - h.a - 1) + 1 : srcIndex(h, 0));
    return r;
  }
  function secAt(s) {                             // the section a place is in (its heading's id)
    var id = "";
    M.heads.forEach(function (h) { if (h.a <= s) id = h.id; });
    return id;
  }
  // where a mark is now: its own place if its words are still there; else its words (the ones before and after
  // choosing between repeats, then the nearer); null if they are not in the paper
  function common(a, b, back) {
    var n = Math.min(a.length, b.length), k = 0;
    while (k < n && (back ? a[a.length - 1 - k] === b[b.length - 1 - k] : a[k] === b[k])) k++;
    return k;
  }
  function locate(m) {
    var C = M.C, q = m.quote || "";
    if (!q) return null;
    if (C.slice(m.start, m.end) === q) return [m.start, m.end];
    var best = -1, bestScore = -Infinity, i = C.indexOf(q), seen = 0;
    while (i >= 0 && seen++ < 300) {
      var score = common(C.slice(Math.max(0, i - (m.pre || "").length), i), m.pre || "", true) +
                  common(C.slice(i + q.length, i + q.length + (m.post || "").length), m.post || "", false) -
                  Math.abs(i - (m.start || 0)) / (C.length + 1);
      if (score > bestScore) { bestScore = score; best = i; }
      i = C.indexOf(q, i + 1);
    }
    return best < 0 ? null : [best, best + q.length];
  }

  // ---------------------------------------------------------------- the marks on the page
  var placed = {};                      // id -> {s, e}: where each mark is in the text (only those found)
  var lost = 0, toldLost = false;
  function live(m) { return m && !m.gone && m.quote; }
  function place() {                    // every mark found in the text
    var all = store.all(), ids = Object.keys(all).filter(function (id) { return live(all[id]); });
    if (!ids.length && !M) { placed = {}; relay(); return; }
    model();
    placed = {};
    lost = 0;
    ids.forEach(function (id) {
      var m = all[id], r = locate(m);
      if (!r) { lost++; return; }
      placed[id] = {s: r[0], e: r[1]};
      // found elsewhere (the paper converted again): its new place kept with it, on this device (no change of its own)
      if (r[0] !== m.start || r[1] !== m.end || m.ver !== store.version) { m.start = r[0]; m.end = r[1]; m.ver = store.version; store.place(m); }
    });
    relay();
    if (lost && !toldLost && store.toast) {
      toldLost = true;
      store.toast(lost === 1 ? "A mark couldn’t be placed in this version of the paper." :
                  lost + " marks couldn’t be placed in this version of the paper.", 6000);
    }
  }
  // drawn as the search's finds are: a marker's stroke over each line of a mark, laid over the page in a layer of its
  // own (the text left as it is); laid again whenever the page's layout changes
  var layer = document.createElement("div");
  layer.className = "l2m-mk-layer";
  layer.setAttribute("aria-hidden", "true");
  var boxes = [], laying = 0, openId = null, flashId = null;
  function relay() { if (!dead && !laying) laying = requestAnimationFrame(layout); }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973; return h; }
  function rectsOf(s, e) {
    var out = [], i = firstSeg(s);
    for (; i < M.segs.length && M.segs[i].a < e; i++) {
      var g = M.segs[i];
      if (g.f) {                                  // a formula: its picture's box (a displayed one: within its frame)
        var pic = g.f.firstElementChild || g.f, fr = pic.getBoundingClientRect(), eq = g.f.closest(".eqbody");
        if (eq) {
          var er = eq.getBoundingClientRect(), l = Math.max(fr.left, er.left), rr = Math.min(fr.right, er.right);
          if (rr > l) out.push({left: l, right: rr, top: fr.top, bottom: fr.bottom});
        } else out.push(fr);
        continue;
      }
      var a = Math.max(s, g.a), b = Math.min(e, g.b);
      if (b <= a) continue;
      var r = document.createRange();
      r.setStart(g.t, srcIndex(g, a - g.a));
      r.setEnd(g.t, srcIndex(g, b - g.a - 1) + 1);
      Array.prototype.push.apply(out, Array.prototype.slice.call(r.getClientRects()));
    }
    return out;
  }
  function lines(rects) {                         // a mark's boxes as one band per line
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
  function layout() {
    laying = 0;
    if (dead) return;
    var all = store.all(), ids = Object.keys(placed).filter(function (id) { return live(all[id]); });
    if (!ids.length) { layer.textContent = ""; boxes = []; return; }
    if (!layer.parentNode) document.body.appendChild(layer);
    var x0 = window.pageXOffset, y0 = window.pageYOffset, mr = main.getBoundingClientRect();
    var right = mr.right - (parseFloat(getComputedStyle(main).paddingRight) || 0);
    // every place first (one layout), then every stroke at once (one insertion)
    var each = ids.map(function (id) { return {id: id, m: all[id], len: placed[id].e - placed[id].s, lines: lines(rectsOf(placed[id].s, placed[id].e))}; });
    var frag = document.createDocumentFragment(), nb = [];
    each.forEach(function (d) {
      var seed = hash(d.id), c = " c" + (d.m.c || 1), lit = d.id === openId || d.id === flashId ? " on" : "";
      d.lines.forEach(function (b, j) {
        var s = document.createElement("span");
        s.className = "l2m-mk" + c + lit;
        s.style.cssText = host.strokeCss(b.left + x0, b.top + y0, b.right - b.left, b.bottom - b.top, seed + j);
        frag.appendChild(s);
        nb.push({id: d.id, len: d.len, x0: b.left + x0 - 2, y0: b.top + y0 - 2, x1: b.right + x0 + 2, y1: b.bottom + y0 + 2});
      });
      if (d.m.note && d.lines.length) {          // a note: a small sign in the margin, by the mark's first line
        var f = d.lines[0], cy = (f.top + f.bottom) / 2 + y0, cx = right + x0 + 9, badge = document.createElement("span");
        badge.className = "l2m-mk-note" + c;
        badge.innerHTML = I.noteMark || "";
        badge.style.left = (cx - 6) + "px";
        badge.style.top = (cy - 6) + "px";
        frag.appendChild(badge);
        nb.push({id: d.id, len: d.len, x0: cx - 14, y0: cy - 14, x1: cx + 14, y1: cy + 14});
      }
    });
    layer.textContent = "";
    layer.appendChild(frag);
    boxes = nb;
  }
  function markAt(x, y) {                         // the mark under a point of the page (the shortest, if they overlap)
    var best = null;
    boxes.forEach(function (b) {
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && (!best || b.len < best.len)) best = b;
    });
    return best ? best.id : null;
  }
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(relay);
    ro.observe(main);
    offs.push([{removeEventListener: function () { ro.disconnect(); }}, "", null]);
  }
  on(window, "resize", relay);
  on(main, "scroll", relay, true);                 // (a wide formula scrolled sideways)

  // ---------------------------------------------------------------- the bar for what is selected
  function colourOf() { var p = window.L2M_prefs ? L2M_prefs() : {}; return p.markColour >= 1 && p.markColour <= 3 ? p.markColour : 1; }
  function keepColour(c) { if (window.L2M_prefs) { var p = L2M_prefs(); p.markColour = c; L2M_savePrefs(p); } }
  function dots(label) {
    return NAMES.map(function (n, i) {
      return '<button type="button" class="mk-dot" data-c="' + (i + 1) + '" aria-label="' + (label ? label + n.toLowerCase() : n) + '"><i></i></button>';
    }).join("");
  }
  var dock = document.createElement("div");
  dock.className = "l2m-fnsheet l2m-markbar";
  dock.setAttribute("role", "toolbar");
  dock.setAttribute("aria-label", "Mark the selection");
  dock.setAttribute("aria-hidden", "true");
  dock.innerHTML = '<div class="sheet-inner mb-row">' + dots("Mark ") + '<span class="mb-sep" aria-hidden="true"></span>' +
    '<button type="button" class="mb-btn" data-mb="note">' + (I.note || "") + "<span>Note</span></button>" +
    '<button type="button" class="mb-btn" data-mb="find">' + (I.search || "") + "<span>Find</span></button></div>";
  document.body.appendChild(dock);
  var dockOpen = false, lastRange = null, selT = 0, mouseDown = false, pointer = "", tapT = 0;
  function selected() {                           // what is selected in the paper, if anything
    var sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var r = sel.getRangeAt(0);
    if (!main.contains(r.commonAncestorContainer) || !String(sel).trim()) return null;
    return r;
  }
  function showDock() {
    var lift = host.peekHeight();                  // (above the peek, if it is open)
    dock.style.bottom = lift ? lift + "px" : "";
    dock.querySelectorAll(".mk-dot").forEach(function (b) { b.classList.toggle("last", +b.getAttribute("data-c") === colourOf()); });
    if (dockOpen) return;
    dockOpen = true;
    dock.classList.add("open");
    dock.setAttribute("aria-hidden", "false");
    if (window.L2M_pinFilm) L2M_pinFilm(dock, 360);
  }
  function hideDock() {
    if (!dockOpen) return;
    dockOpen = false;
    dock.classList.remove("open");
    dock.setAttribute("aria-hidden", "true");
    if (window.L2M_pinFilm) L2M_pinFilm(dock, 360);
  }
  function checkSel() {
    if (dead) return;
    var r = selected();
    if (r) { lastRange = r.cloneRange(); if (!sheetOpen && !mouseDown) showDock(); }
    else hideDock();
  }
  on(document, "selectionchange", function () { clearTimeout(selT); selT = setTimeout(checkSel, 160); });
  // with a mouse, the bar comes once the button is let go (not while the selection is still being drawn)
  on(document, "pointerdown", function (e) { pointer = e.pointerType; if (e.pointerType === "mouse" && !dock.contains(e.target)) mouseDown = true; }, true);
  on(document, "pointerup", function (e) { if (e.pointerType === "mouse" && mouseDown) { mouseDown = false; clearTimeout(selT); selT = setTimeout(checkSel, 30); } }, true);
  // a press on the bar leaves the selection as it is (its click then reads it)
  dock.addEventListener("pointerdown", function (e) { e.preventDefault(); });
  dock.addEventListener("mousedown", function (e) { e.preventDefault(); });
  dock.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    if (b.hasAttribute("data-c")) { make(+b.getAttribute("data-c")); return; }
    var what = b.getAttribute("data-mb");
    if (what === "note") { var id = make(colourOf()); if (id) openSheet(id, true); }
    else if (what === "find") {
      var sel = window.getSelection();             // (the selection, as it was when the bar came)
      if (lastRange && (!sel.rangeCount || sel.isCollapsed)) { sel.removeAllRanges(); sel.addRange(lastRange); }
      hideDock();
      host.find();
    }
  });
  function clearSel() { var sel = window.getSelection && window.getSelection(); if (sel) sel.removeAllRanges(); lastRange = null; hideDock(); }
  function make(c) {                              // the selection marked: a new mark (its id)
    var r = lastRange;
    if (!r) return null;
    model();
    var s = placeOf(r.startContainer, r.startOffset, false), e = placeOf(r.endContainer, r.endOffset, true), C = M.C;
    if (s < 0 || e < 0) return null;
    while (s < e && isWS(C.charCodeAt(s))) s++;
    while (e > s && isWS(C.charCodeAt(e - 1))) e--;
    // whole words: a selection begun or ended within one takes all of it
    var wordy = /[\p{L}\p{N}\p{M}'\u2019]/u;
    while (s > 0 && wordy.test(C[s - 1]) && wordy.test(C[s])) s--;
    while (e < C.length && wordy.test(C[e]) && wordy.test(C[e - 1])) e++;
    if (e <= s) { clearSel(); return null; }
    var now = Date.now(), id = "m" + now.toString(36) + Math.random().toString(36).slice(2, 6);
    store.put({id: id, c: c, quote: C.slice(s, e), pre: C.slice(Math.max(0, s - 40), s), post: C.slice(e, e + 40),
               start: s, end: e, sec: secAt(s), ver: store.version, made: now});
    placed[id] = {s: s, e: e};
    keepColour(c);
    clearSel();
    relay();
    return id;
  }

  // ---------------------------------------------------------------- a mark's sheet
  var sheet = document.createElement("div");
  sheet.className = "l2m-fnsheet l2m-marksheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "Mark");
  sheet.setAttribute("aria-hidden", "true");
  sheet.innerHTML = '<div class="sheet-inner"><div class="sheet-head"><div class="mk-colors" role="group" aria-label="Colour">' +
    dots("") + '</div><div class="mk-acts">' +
    '<button type="button" class="bar-btn" data-mk="link" aria-label="Copy a link to this mark">' + (I.link || "") + "</button>" +
    '<button type="button" class="bar-btn" data-mk="remove" aria-label="Remove the mark">' + (I.trash || "") + "</button>" +
    '<button type="button" class="bar-btn" data-mk="close" aria-label="Close">' + (I.close || "") + "</button></div></div>" +
    '<div class="mk-quote"></div><textarea class="mk-note" rows="2" placeholder="Add a note" aria-label="Note"></textarea></div>';
  document.body.appendChild(sheet);
  var quote = sheet.querySelector(".mk-quote"), note = sheet.querySelector(".mk-note");
  var sheetOpen = false, noteT = 0;
  function fill(m) {
    sheet.querySelectorAll(".mk-dot").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.getAttribute("data-c") === (m.c || 1))); });
    quote.textContent = "";
    var p = placed[m.id], r = p ? rangeOf(p.s, p.e) : null;
    if (r) {
      // the marked words as they stand in the paper (their formulas drawn first: one not drawn yet would come empty)
      for (var i = firstSeg(p.s); i < M.segs.length && M.segs[i].a < p.e; i++) {
        var f = M.segs[i].f;
        if (f && f.hasAttribute("data-lazy") && window.L2M_math) L2M_math.draw(f);
      }
      var frag = r.cloneContents();
      frag.querySelectorAll("[id]").forEach(function (x) { x.removeAttribute("id"); });
      quote.appendChild(frag);
    } else quote.textContent = m.quote || "";
    quote.classList.toggle("long", quote.scrollHeight > quote.clientHeight + 2);
    note.value = m.note || "";
    grow();
  }
  function grow() { note.style.height = "auto"; note.style.height = Math.min(note.scrollHeight + 2, Math.round(window.innerHeight * 0.4)) + "px"; }
  function saveNote() {
    clearTimeout(noteT);
    var m = openId && store.all()[openId];
    if (!live(m)) return;
    var v = note.value.replace(/\s+$/, "");
    if (v === (m.note || "")) return;
    if (v) m.note = v; else delete m.note;
    store.put(m);
    relay();
  }
  function openSheet(id, write) {
    var m = store.all()[id];
    if (!live(m)) return;
    if (sheetOpen && openId !== id) saveNote();
    openId = id;
    fill(m);
    if (!sheetOpen) {
      host.closeOthers();                          // (the contents or settings, a footnote's sheet)
      host.overlayIn("l2mMark");
      sheetOpen = true;
      sheet.classList.add("open");
      sheet.setAttribute("aria-hidden", "false");
      if (window.L2M_pinFilm) L2M_pinFilm(sheet, 360);
      fitKeyboard();
    }
    hideDock();
    relay();
    if (write) note.focus();                       // (Note: straight to writing; in the tap itself, so the keyboard comes)
  }
  function closeSheet(how) {                      // how: as nav.js's overlayOut ("pop", "hand", else something follows)
    if (!sheetOpen) return;
    saveNote();
    sheetOpen = false;
    host.overlayOut("l2mMark", how);
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    if (window.L2M_pinFilm) L2M_pinFilm(sheet, 360);
    if (document.activeElement && sheet.contains(document.activeElement)) document.activeElement.blur();
    sheet.style.bottom = "";
    openId = null;
    relay();
  }
  // above the keyboard while one is up (a phone's keyboard covers the page's bottom, where the sheet is)
  function fitKeyboard() {
    var vv = window.visualViewport;
    if (!sheetOpen || !vv) return;
    var under = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    sheet.style.bottom = under > 40 ? under + "px" : "";
  }
  if (window.visualViewport) { on(window.visualViewport, "resize", fitKeyboard); on(window.visualViewport, "scroll", fitKeyboard); }
  note.addEventListener("input", function () { grow(); clearTimeout(noteT); noteT = setTimeout(saveNote, 700); });
  note.addEventListener("blur", saveNote);
  sheet.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    var m = openId && store.all()[openId];
    if (!b || !live(m)) return;
    if (b.hasAttribute("data-c")) {
      m.c = +b.getAttribute("data-c");
      keepColour(m.c);
      store.put(m);
      fill(m);
      relay();
      return;
    }
    var what = b.getAttribute("data-mk");
    if (what === "close") closeSheet("hand");
    else if (what === "link") {
      var url = store.link(m.id), done = function () { if (store.toast) store.toast("Link copied."); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () {});
    } else if (what === "remove") {
      var keep = JSON.parse(JSON.stringify(m));
      closeSheet("hand");
      store.put({id: m.id, gone: true});
      delete placed[m.id];
      relay();
      if (store.toastAct) store.toastAct("Mark removed.", "Undo", function () {
        delete keep.gone;
        store.put(keep);
        place();
      });
    }
  });

  // ---------------------------------------------------------------- taps
  // A tap on a mark opens its sheet (not on a link or a button: those keep their own). It is caught before the
  // paper's own taps, so that a footnote's sheet open is closed as this one opens, not by a step back of its own
  on(document, "click", function (e) {
    if (dead || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var t = e.target;
    if (sheet.contains(t) || dock.contains(t)) return;
    var el = t.nodeType === 1 ? t : t.parentNode;
    var own = el && el.closest && el.closest("a[href], button, input, textarea, select, summary, label, [role='button'], img, .fig-open, " +
      ".l2m-bar, .l2m-menu, .l2m-fnsheet, .l2m-peek, .l2m-viewer, .app-toast");
    var sel = window.getSelection && window.getSelection();
    var id = !own && !e.defaultPrevented && !(sel && !sel.isCollapsed) ? markAt(e.clientX + window.pageXOffset, e.clientY + window.pageYOffset) : null;
    if (id) {
      e.preventDefault();
      e.stopPropagation();
      // with a mouse, a moment's wait: a double click selects a word in the mark (and opens nothing)
      clearTimeout(tapT);
      if (pointer !== "mouse") openSheet(id);
      else if (e.detail < 2) tapT = setTimeout(function () { var s2 = window.getSelection(); if (!s2 || s2.isCollapsed) openSheet(id); }, 280);
      return;
    }
    // elsewhere: the sheet closes (by a step back; before what a link or a button does, without one)
    if (sheetOpen) closeSheet(own ? "jump" : "hand");
  }, true);

  // ---------------------------------------------------------------- a link to a mark (#mark-<id>)
  var wanted = null;
  function go() {
    var p = wanted && placed[wanted];
    if (!p || dead) return;
    var id = wanted, r = rangeOf(p.s, p.e), box = r && (r.getClientRects()[0] || r.getBoundingClientRect());
    wanted = null;
    if (!box) return;
    window.scrollTo(0, Math.max(0, window.pageYOffset + box.top - host.barHeight() - Math.round(window.innerHeight * 0.18)));
    flashId = id;
    relay();
    setTimeout(function () { if (flashId === id) { flashId = null; relay(); } }, 1600);
  }

  // ---------------------------------------------------------------- the marks come, and go back
  function any() { var all = store.all(); return Object.keys(all).some(function (id) { return live(all[id]); }); }
  var started = Promise.resolve(host.ready).then(function () {
    if (dead) return;
    // the ones on this device first (the text read in idle moments), then the library's (another device's, since)
    return (any() ? modelSoon().then(function () { if (!dead) { place(); go(); } }) : Promise.resolve())
      .then(function () { return new Promise(function (res) { idle(res); }); })
      .then(function () { return dead ? false : store.pull(); })
      .then(function (changed) { if (!dead && changed) return modelSoon().then(function () { if (!dead) { place(); go(); } }); });
  });
  on(window, "online", function () { store.pull(); });       // (what was changed offline: written now)
  on(document, "visibilitychange", function () {
    if (document.visibilityState === "hidden") { saveNote(); store.flush(true); }
    else store.pull().then(function (changed) { if (!dead && changed) modelSoon().then(function () { if (!dead) place(); }); });
  });

  return {
    closeSheet: closeSheet,
    reveal: function (id) { wanted = id; started.then(go); },
    destroy: function () {
      if (dead) return;
      saveNote();
      dead = true;
      clearTimeout(selT); clearTimeout(tapT); clearTimeout(noteT);
      if (laying) cancelAnimationFrame(laying);
      offs.forEach(function (o) { o[0].removeEventListener(o[1], o[2], o[3]); });
      offs = [];
      store.flush(true);
      layer.remove(); dock.remove(); sheet.remove();
    }
  };
};
