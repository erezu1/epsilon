// Epsilon app: marks in a paper. A mark is a stretch of the paper's text marked as with a highlighter, in one of three
// colours, with a note if the reader writes one. Text selected in the paper (or in the peek) brings a bar up at the
// bottom (the three colours, Note, Find); a mark tapped opens its sheet (its colour, its note, a link to it, its
// removal), which takes a step in the history as the footnote's sheet does. The contents panel gets a second tab,
// Notes: the paper's marks in order under their sections, each a jump to it. On a wide screen a note stands in the
// margin beside its mark; on a narrow one, a small sign there.
//
// nav.js starts it on an open paper when the host (app.js) keeps marks: L2M_marks(host) returns {closeSheet,
// reveal, panelOpened, peekOpened, peekClosed, destroy}. host.store keeps them (on the device at once; in the
// library, merged mark by mark): all() -> {id: mark}, put(mark), place(mark), pull() -> Promise(changed),
// flush(keepalive), link(id), version, toast(html), toastAct(html, label, fn).
//
// Where a mark is. The paper's text as one string: its words (each run of spaces as one), each formula as its TeX
// between $ signs, a line between blocks. A mark keeps its place in that string, the words it marks and a few
// before and after: in the same conversion its place still has its words; in a new one (the paper converted again)
// the words are looked for, those before and after choosing between repeats. A mark not found stays kept, and
// listed under Notes as not found. The peek's copy of the paper has the same text: the same places, its own nodes.
window.L2M_marks = function (host) {
  "use strict";
  var store = host.store, I = host.icons || {}, main = document.querySelector("main");
  var dead = false, offs = [];
  function on(t, type, fn, o) { t.addEventListener(type, fn, o); offs.push([t, type, fn, o]); }
  var NAMES = ["Green", "Pink", "Violet", "Orange"];
  function esc(t) { return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

  // ---------------------------------------------------------------- the paper's text
  function isWS(c) { return c === 32 || c === 10 || c === 9 || c === 13 || c === 12 || c === 160 || c === 8201 || c === 8202 || c === 8239; }
  var SKIP = "svg, script, style, button, textarea, input, [hidden], .skel-paper, .l2m-mark, .l2m-mk-layer, details.toc, .l2m-libnav, .l2m-actions";
  var FORMULA = "mjx-container[data-n], l2m-math[n]";
  // A text: {root, M: {C, segs, at (node -> segment), heads}, job}. Read once (it stays as long as the paper, or the
  // peek's copy, is open): at once when a mark is made, else a little at a time in the page's idle moments (a long
  // paper takes some tens of milliseconds on a phone)
  function textOf(root) { return {root: root, M: null, job: null}; }
  var T = textOf(main), P = null;                  // the page's text; the peek's
  function begin(t) {
    return {C: "", segs: [], at: new Map(), heads: [], space: true, last: null,
      walk: document.createTreeWalker(t.root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {acceptNode: function (n) {
        if (n.nodeType === 1) {
          if (n.matches(FORMULA)) return NodeFilter.FILTER_ACCEPT;
          return n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }})};
  }
  function read(t, until) {                        // on from where it was, until a moment (0: to the end); done or not
    var j = t.job;
    for (var n = j.walk.nextNode(); n; n = j.walk.nextNode()) {
      var blk = n.parentNode.closest(host.block);
      if (blk !== j.last) {
        if (j.C && j.C.charCodeAt(j.C.length - 1) !== 10) j.C += "\n";
        j.space = true;
        j.last = blk;
        var hid = blk && /^H[2-5]$/.test(blk.tagName) && (blk.id || blk.getAttribute("data-pid"));
        if (hid) j.heads.push({a: j.C.length, id: hid, el: blk});
      }
      if (n.nodeType === 1) {                    // a formula: its TeX
        var k = n.getAttribute("data-n") || n.getAttribute("n");
        var tx = "$" + String(host.tex(k) || "").replace(/\s+/g, " ").trim() + "$";
        j.at.set(n, j.segs.length);
        j.segs.push({f: n, a: j.C.length, b: j.C.length + tx.length});
        j.C += tx;
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
    t.M = {C: j.C, segs: j.segs, at: j.at, heads: j.heads};
    t.job = null;
    return true;
  }
  function model(t) { if (!t.M) { t.job = t.job || begin(t); read(t, 0); } return t.M; }
  function idle(f) { (window.requestIdleCallback || function (g) { return setTimeout(g, 30); })(f, {timeout: 1500}); }
  function modelSoon(t) {
    return new Promise(function (res) {
      (function slice() {
        if (dead) return;
        if (t.M) { res(t.M); return; }
        t.job = t.job || begin(t);
        if (read(t, performance.now() + 6)) res(t.M); else idle(slice);
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
  // a point of the page (a range's start, or its end) as a place in a text
  function placeOf(t, node, off, end) {
    var M = t.M, el = node.nodeType === 1 ? node : node.parentNode, f = el && el.closest ? el.closest(FORMULA) : null;
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
  function firstSeg(M, s) {                        // the first segment that ends after s
    var lo = 0, hi = M.segs.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (M.segs[mid].b <= s) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function rangeOf(M, s, e) {                      // the page's range for a text's [s, e)
    var r = document.createRange(), g = M.segs[firstSeg(M, s)];
    if (!g) return null;
    if (g.f) r.setStartBefore(g.f); else r.setStart(g.t, srcIndex(g, Math.max(0, s - g.a)));
    var h = M.segs[firstSeg(M, e - 1)] || g;
    if (h.f) r.setEndAfter(h.f); else r.setEnd(h.t, e - h.a > 0 ? srcIndex(h, Math.min(e, h.b) - h.a - 1) + 1 : srcIndex(h, 0));
    return r;
  }
  function headAt(M, s) {                          // the section a place is in (its heading)
    var h = null;
    for (var i = 0; i < M.heads.length && M.heads[i].a <= s; i++) h = M.heads[i];
    return h;
  }
  // where a mark is in a text: its own place if its words are still there; else its words (the ones before and after
  // choosing between repeats, then the nearer); null if they are not in it
  function common(a, b, back) {
    var n = Math.min(a.length, b.length), k = 0;
    while (k < n && (back ? a[a.length - 1 - k] === b[b.length - 1 - k] : a[k] === b[k])) k++;
    return k;
  }
  function locate(M, m) {
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
    return best < 0 ? nearly(M, m) : [best, best + q.length];
  }
  // A mark whose words changed a little (the paper revised: a word changed, a typo mended, a formula touched):
  // where pieces of its words still stand as they were, each piece's place less its place in the words says where
  // the words would begin; around the likeliest beginnings the words are laid against the text, a character's
  // change, loss or gain each an edit. Found if at most a quarter of them changed (the words just before and after
  // choosing between near equals); its whole words, as a mark made by hand takes them. [start, end] or null
  function align(q, t) {                           // q against the stretch of t it fits best: [start, end, edits]
    var n = q.length, w = t.length, prev = new Int32Array(w + 1), cur = new Int32Array(w + 1);
    var ps = new Int32Array(w + 1), cs = new Int32Array(w + 1), j;
    for (j = 0; j <= w; j++) ps[j] = j;            // (the stretch may begin anywhere: no cost before it)
    for (var i = 1; i <= n; i++) {
      var qc = q.charCodeAt(i - 1);
      cur[0] = i; cs[0] = 0;
      for (j = 1; j <= w; j++) {
        var sub = prev[j - 1] + (qc === t.charCodeAt(j - 1) ? 0 : 1), del = prev[j] + 1, ins = cur[j - 1] + 1;
        if (sub <= del && sub <= ins) { cur[j] = sub; cs[j] = ps[j - 1]; }
        else if (del <= ins) { cur[j] = del; cs[j] = ps[j]; }
        else { cur[j] = ins; cs[j] = cs[j - 1]; }
      }
      var x = prev; prev = cur; cur = x; x = ps; ps = cs; cs = x;
    }
    var end = 0;
    for (j = 1; j <= w; j++) if (prev[j] < prev[end]) end = j;
    return [ps[end], end, prev[end]];
  }
  var wordy = /[\p{L}\p{N}\p{M}'\u2019]/u;
  function whole(C, s, e) {                        // a stretch of the text as whole words, without spaces at its ends
    while (s < e && isWS(C.charCodeAt(s))) s++;
    while (e > s && isWS(C.charCodeAt(e - 1))) e--;
    while (s > 0 && wordy.test(C[s - 1]) && wordy.test(C[s])) s--;
    while (e < C.length && wordy.test(C[e]) && wordy.test(C[e - 1])) e++;
    return [s, e];
  }
  function nearly(M, m) {
    var C = M.C, q = m.quote || "", n = q.length;
    if (n < 12) return null;                       // (too short to tell from its likes)
    var K = n < 60 ? 8 : 12, step = Math.max(1, Math.floor((n - K) / 20)), votes = {}, B = 16;
    for (var o = 0; o + K <= n; o += step) {
      var g = q.substr(o, K), hits = [], i = g.trim().length >= 6 ? C.indexOf(g) : -1;
      while (i >= 0 && hits.length <= 40) { hits.push(i); i = C.indexOf(g, i + 1); }
      if (!hits.length || hits.length > 40) continue;          // (nowhere, or everywhere: it says nothing)
      hits.forEach(function (p) { var b = Math.round((p - o) / B); votes[b] = (votes[b] || 0) + 1; });
    }
    function weight(b) { return (votes[b] || 0) + 0.5 * ((votes[b - 1] || 0) + (votes[b + 1] || 0)); }
    var best = null;
    Object.keys(votes).map(Number).filter(function (b) { return weight(b) >= 2; })
      .sort(function (a, b) { return weight(b) - weight(a); }).slice(0, 4).forEach(function (b) {
        var est = b * B, slack = Math.max(24, Math.round(n * 0.35)), w0 = Math.max(0, est - slack), w1 = Math.min(C.length, est + n + slack), s, e, sim;
        if (n <= 700) {
          var r = align(q, C.slice(w0, w1));
          s = w0 + r[0]; e = w0 + r[1]; sim = 1 - r[2] / n;
        } else {                                   // a long one: its first and last words, each laid against the text
          var H = 240, z0 = Math.max(0, est + n - H - slack), a = align(q.slice(0, H), C.slice(w0, Math.min(C.length, est + H + slack))), z = align(q.slice(-H), C.slice(z0, w1));
          s = w0 + a[0]; e = z0 + z[1]; sim = 1 - (a[2] + z[2]) / (2 * H);
          if (e - s < n * 0.5 || e - s > n * 1.6) return;
        }
        if (sim < 0.75 || e <= s) return;
        var score = sim + 0.003 * (common(C.slice(Math.max(0, s - 40), s), m.pre || "", true) + common(C.slice(e, e + 40), m.post || "", false));
        if (!best || score > best.score) best = {s: s, e: e, score: score};
      });
    return best ? whole(C, best.s, best.e) : null;
  }

  // ---------------------------------------------------------------- the marks found
  var placed = {}, lostIds = [], toldLost = false;  // placed: id -> {s, e} in the page's text; lostIds: those not found
  var peekPlaced = {};                             // the same in the peek's (its text the page's: the same places)
  function live(m) { return m && !m.gone && m.quote; }
  function any() { var all = store.all(); return Object.keys(all).some(function (id) { return live(all[id]); }); }
  function place() {                              // every mark found in the page's text (and the peek's, if open)
    var all = store.all(), ids = Object.keys(all).filter(function (id) { return live(all[id]); });
    placed = {};
    lostIds = [];
    if (ids.length || T.M) {
      var M = model(T);
      ids.forEach(function (id) {
        var m = all[id], r = locate(M, m);
        if (!r) { lostIds.push(id); return; }
        placed[id] = {s: r[0], e: r[1]};
        // found elsewhere (the paper converted again, or revised): its new place kept with it, on this device (no change
        // of its own); found in changed words, those words now its own, and the ones it had kept as what it read before
        var now = M.C.slice(r[0], r[1]), moved = r[0] !== m.start || r[1] !== m.end || m.ver !== store.version;
        if (now !== m.quote) { m.was = m.quote; m.quote = now; m.pre = M.C.slice(Math.max(0, r[0] - 40), r[0]); m.post = M.C.slice(r[1], r[1] + 40); moved = true; }
        if (moved) { m.start = r[0]; m.end = r[1]; m.ver = store.version; store.place(m); }
      });
    }
    placePeek();
    relay();
    listChanged();
    if (lostIds.length && !toldLost && store.toast) {
      toldLost = true;
      store.toast(lostIds.length === 1 ? "A mark couldn’t be placed in this version of the paper. It’s listed under Notes." :
                  lostIds.length + " marks couldn’t be placed in this version of the paper. They’re listed under Notes.", 6000);
    }
  }
  function placePeek() {
    peekPlaced = {};
    if (!P || !P.M || !T.M) return;
    if (P.M.C === T.M.C) { peekPlaced = placed; return; }
    var all = store.all();
    Object.keys(placed).forEach(function (id) { var r = locate(P.M, all[id]); if (r) peekPlaced[id] = {s: r[0], e: r[1]}; });
  }

  // ---------------------------------------------------------------- drawn on the page
  // A marker's stroke over each line of a mark, as the search's finds are drawn, laid over the page in a layer of its
  // own (the text left as it is); laid again whenever the page's layout changes. The peek's in a layer in its copy.
  function newLayer() { var l = document.createElement("div"); l.className = "l2m-mk-layer"; l.setAttribute("aria-hidden", "true"); return l; }
  var layer = newLayer(), peekLayer = newLayer();
  var side = document.createElement("div");       // the notes in the margin (not blended: they are text to read)
  side.className = "l2m-mk-side-layer";
  var boxes = [], peekBoxes = [], laying = 0, openId = null, flashId = null, hoverId = null, peekShown = false;
  function relay() { if (!dead && !laying) laying = requestAnimationFrame(layout); }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973; return h; }
  function rectsOf(M, s, e) {
    var out = [], i = firstSeg(M, s);
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
  var lines = host.lines;                         // a mark's boxes as one band per line (nav.js: the search's too)
  // the strokes of the marks of a text, at their places (x0, y0: the layer's offset from the window), and their boxes
  function strokes(M, where, x0, y0, frag, nb) {
    var all = store.all(), out = [];
    Object.keys(where).forEach(function (id) {
      var m = all[id];
      if (!live(m)) return;
      var p = where[id], ls = lines(rectsOf(M, p.s, p.e)), seed = hash(id), c = " c" + (m.c || 1);
      var lit = id === openId || id === flashId || id === hoverId ? " on" : "";
      ls.forEach(function (b, j) {
        var s = document.createElement("span");
        s.className = "l2m-mk" + c + lit;
        s.style.cssText = host.strokeCss(b.left + x0, b.top + y0, b.right - b.left, b.bottom - b.top, seed + j);
        frag.appendChild(s);
        nb.push({id: id, len: p.e - p.s, x0: b.left + x0 - 2, y0: b.top + y0 - 2, x1: b.right + x0 + 2, y1: b.bottom + y0 + 2});
      });
      if (ls.length) out.push({id: id, m: m, first: ls[0]});
    });
    return out;
  }
  function layout() {
    laying = 0;
    if (dead) return;
    var x0 = window.pageXOffset, y0 = window.pageYOffset, nb = [];
    if (T.M && Object.keys(placed).length) {
      if (!layer.parentNode) document.body.appendChild(layer);
      if (!side.parentNode) document.body.appendChild(side);
      var mr = main.getBoundingClientRect(), right = mr.right - (parseFloat(getComputedStyle(main).paddingRight) || 0);
      // every place first (one layout), then every stroke at once (one insertion)
      var frag = document.createDocumentFragment(), drawn = strokes(T.M, placed, x0, y0, frag, nb);
      // a note: in the margin, beside its mark, where there is room (stacked, never one over another); else a sign
      var room = document.documentElement.clientWidth - right - 12, wide = room >= 210 ? Math.min(270, room - 44) : 0;
      var notes = document.createDocumentFragment(), sideNotes = [];
      drawn.filter(function (d) { return d.m.note; }).sort(function (a, b) { return a.first.top - b.first.top; }).forEach(function (d) {
        var c = " c" + (d.m.c || 1);
        if (wide) {
          var n = document.createElement("div");
          n.className = "l2m-mk-side" + c + (d.id === openId || d.id === hoverId ? " on" : "");
          n.setAttribute("data-id", d.id);
          n.textContent = (d.m.by ? d.m.by + ": " : "") + d.m.note;
          n.style.left = (right + x0 + 28) + "px";
          n.style.width = wide + "px";
          n.style.top = (d.first.top + y0 - 2) + "px";
          notes.appendChild(n);
          sideNotes.push(n);
          return;
        }
        var f = d.first, cy = (f.top + f.bottom) / 2 + y0, cx = right + x0 + 9, badge = document.createElement("span");
        badge.className = "l2m-mk-note" + c;
        badge.innerHTML = I.noteMark || "";
        badge.style.left = (cx - 6) + "px";
        badge.style.top = (cy - 6) + "px";
        frag.appendChild(badge);
        nb.push({id: d.id, len: 0, x0: cx - 14, y0: cy - 14, x1: cx + 14, y1: cy + 14});
      });
      layer.textContent = "";
      layer.appendChild(frag);
      side.textContent = "";
      side.appendChild(notes);
      var below = -Infinity;                       // (heights read all at once, then moved down where they would meet)
      sideNotes.map(function (n) { return [n, n.offsetHeight, parseFloat(n.style.top)]; }).forEach(function (e) {
        var top = Math.max(e[2], below + 10);
        if (top !== e[2]) e[0].style.top = top + "px";
        below = top + e[1];
      });
    } else { layer.textContent = ""; side.textContent = ""; }
    boxes = nb;
    // the peek's, while it is open (its layer in its copy: the boxes against the copy's corner)
    var pb = [];
    if (peekShown && P && P.M && Object.keys(peekPlaced).length) {
      if (peekLayer.parentNode !== P.root) P.root.appendChild(peekLayer);
      var pr = P.root.getBoundingClientRect(), pf = document.createDocumentFragment();
      strokes(P.M, peekPlaced, -pr.left, -pr.top, pf, pb);
      peekLayer.textContent = "";
      peekLayer.appendChild(pf);
    } else peekLayer.textContent = "";
    peekBoxes = pb;
    drawOwn();
  }
  function hit(list, x, y) {                      // the mark under a point (the shortest, if they overlap)
    var best = null;
    list.forEach(function (b) {
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && (!best || b.len < best.len)) best = b;
    });
    return best ? best.id : null;
  }
  var ro = window.ResizeObserver ? new ResizeObserver(relay) : null;
  if (ro) ro.observe(main);
  on(window, "resize", relay);
  on(main, "scroll", relay, true);                 // (a wide formula scrolled sideways)
  side.addEventListener("mouseover", function (e) { var n = e.target.closest(".l2m-mk-side"); var id = n && n.getAttribute("data-id"); if (id !== hoverId) { hoverId = id; relay(); } });
  side.addEventListener("mouseleave", function () { if (hoverId) { hoverId = null; relay(); } });

  // ---------------------------------------------------------------- the bar for what is selected
  function colourOf() { var p = window.L2M_prefs ? L2M_prefs() : {}; return p.markColour >= 1 && p.markColour <= NAMES.length ? p.markColour : 1; }
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
  dock.tabIndex = -1;
  dock.innerHTML = '<div class="sheet-inner mb-row">' + dots("Mark ") + '<span class="mb-sep" aria-hidden="true"></span>' +
    '<button type="button" class="mb-btn" data-mb="note">' + (I.note || "") + "<span>Note</span></button>" +
    '<button type="button" class="mb-btn" data-mb="find">' + (I.search || "") + "<span>Find</span></button>" +
    '<button type="button" class="mb-btn mb-copy" data-mb="copy" hidden>' + (I.copy || "") + "<span>Copy</span></button></div>";
  document.body.appendChild(dock);
  var dockOpen = false, lastRange = null, selT = 0, mouseDown = false, pointer = "", tapT = 0;
  function textAt(node) {                          // the text a node is in: the page's, or the peek's copy's
    if (main.contains(node)) return T;
    if (P && peekShown && P.root.contains(node)) return P;
    return null;
  }
  function selected() {                           // what is selected in the paper (or the peek), if anything
    var sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var r = sel.getRangeAt(0);
    if (!textAt(r.commonAncestorContainer) || !String(sel).trim()) return null;
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
    if (dead || cur) return;                       // (the paper's own selection: the browser's has no say)
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
      if (cur) { var q = ownWords(); clearSel(); host.find(q); return; }
      var sel = window.getSelection();             // (the selection, as it was when the bar came)
      if (lastRange && (!sel.rangeCount || sel.isCollapsed)) { sel.removeAllRanges(); sel.addRange(lastRange); }
      hideDock();
      host.find();
    } else if (what === "copy" && cur) {
      var text = cur.t.M.C.slice(cur.s, cur.e), ok = function () { if (store.toast) store.toast("Copied."); };
      clearSel();
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () {});
    }
  });
  function clearSel() {
    var sel = window.getSelection && window.getSelection();
    if (sel && !cur) sel.removeAllRanges();
    lastRange = null;
    if (cur) { cur = null; drawOwn(); }
    hideDock();
  }
  function make(c) {                              // the selection marked: a new mark (its id)
    var t, M, s, e, C;
    if (cur) { t = cur.t; M = model(t); s = cur.s; e = cur.e; }
    else {
      var r = lastRange;
      t = r && textAt(r.commonAncestorContainer);
      if (!t) return null;
      M = model(t); s = placeOf(t, r.startContainer, r.startOffset, false); e = placeOf(t, r.endContainer, r.endOffset, true);
    }
    C = M.C;
    if (s < 0 || e < 0) return null;
    var w = whole(C, s, e);                        // (whole words: a selection begun or ended within one takes all of it)
    s = w[0]; e = w[1];
    if (e <= s) { clearSel(); return null; }
    var head = headAt(M, s), now = Date.now(), id = "m" + now.toString(36) + Math.random().toString(36).slice(2, 6);
    var m = {id: id, c: c, quote: C.slice(s, e), pre: C.slice(Math.max(0, s - 40), s), post: C.slice(e, e + 40),
             start: s, end: e, sec: head ? head.id : "", ver: store.version, made: now};
    store.put(m);
    keepColour(c);
    clearSel();
    place();                                       // (in the page's text and the peek's, wherever it was made)
    return id;
  }

  // ---------------------------------------------------------------- the paper's own selection (Android's Chrome)
  // Chrome for Android lays its search panel (Touch to Search) over the page's foot whenever text is selected by a
  // press and hold, and a page has no say in it but making its text unselectable (Chrome's own advice). There
  // (html.l2m-own-select, set by app.js) the paper's text is unselectable to the browser, and selected here: a press and
  // hold on a word selects it (a formula, all of it), its two handles stretch it, the bar does the rest
  var OWN = document.documentElement.classList.contains("l2m-own-select");
  var cur = null;                                  // {t (its text), s, e}: what is selected
  var ownEnds = null;
  var selLayer = document.createElement("div");
  selLayer.className = "l2m-own-sel-layer";
  selLayer.setAttribute("aria-hidden", "true");
  function grip(kind) { var h = document.createElement("span"); h.className = "mk-grip " + kind; h.setAttribute("aria-hidden", "true"); return h; }
  var gs = grip("start"), ge = grip("end");
  function ownWords() {                            // what is selected, as a search for it (a formula: its TeX)
    var q = cur.t.M.C.slice(cur.s, cur.e), f = /^\$([^$]*)\$$/.exec(q);
    return f ? f[1] : q.replace(/\$[^$]*\$/g, " ").replace(/\s+/g, " ").trim();
  }
  function drawOwn() {
    if (!cur || !cur.t.M) { selLayer.remove(); gs.remove(); ge.remove(); return; }
    var t = cur.t, box = t === T ? document.body : t.root, x0 = window.pageXOffset, y0 = window.pageYOffset;
    if (t !== T) { var rb = t.root.getBoundingClientRect(); x0 = -rb.left; y0 = -rb.top; }
    var ls = lines(rectsOf(t.M, cur.s, cur.e)), frag = document.createDocumentFragment();
    ls.forEach(function (b) {
      var d = document.createElement("span");
      d.className = "l2m-own-sel";
      d.style.cssText = "left:" + (b.left + x0) + "px;top:" + (b.top + y0) + "px;width:" + (b.right - b.left) + "px;height:" + (b.bottom - b.top) + "px";
      frag.appendChild(d);
    });
    selLayer.textContent = "";
    selLayer.appendChild(frag);
    if (selLayer.parentNode !== box) box.appendChild(selLayer);
    if (!ls.length) { gs.remove(); ge.remove(); return; }
    var f = ls[0], l = ls[ls.length - 1];
    ownEnds = {s: [f.left, (f.top + f.bottom) / 2], e: [l.right, (l.top + l.bottom) / 2]};   // (where each handle points)
    gs.style.left = (f.left + x0) + "px"; gs.style.top = (f.bottom + y0) + "px";
    ge.style.left = (l.right + x0) + "px"; ge.style.top = (l.bottom + y0) + "px";
    if (gs.parentNode !== box) box.appendChild(gs);
    if (ge.parentNode !== box) box.appendChild(ge);
  }
  // the place in a text under a point of the window: the character there (the nearest, between lines), or -1
  function offsetAt(t, x, y) {
    var el = document.elementFromPoint(x, y), M = t.M;
    if (!el || !t.root.contains(el)) return -1;
    var f = el.closest(FORMULA);
    if (f && M.at.has(f)) { var g = M.segs[M.at.get(f)], fr = f.getBoundingClientRect(); return x < (fr.left + fr.right) / 2 ? g.a : g.b; }
    var blk = el.closest(host.block) || el, walk = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT), best = null, bestD = Infinity;
    for (var n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!M.at.has(n)) continue;
      var rr = document.createRange();
      rr.selectNodeContents(n);
      var rs = rr.getClientRects();
      for (var i = 0; i < rs.length; i++) {
        var q = rs[i], dy = y < q.top ? q.top - y : y > q.bottom ? y - q.bottom : 0, dx = x < q.left ? q.left - x : x > q.right ? x - q.right : 0;
        if (dy * 4 + dx < bestD) { bestD = dy * 4 + dx; best = n; }
      }
    }
    if (!best) return -1;
    var lo = 0, hi = best.data.length, one = document.createRange();
    while (lo < hi) {                              // (by halving, in the order it reads: a line down, or right on it, is later)
      var mid = (lo + hi) >> 1;
      one.setStart(best, mid);
      one.setEnd(best, mid + 1);
      var c = one.getBoundingClientRect();
      if (c.bottom <= y || (c.top <= y && c.left + c.width / 2 < x)) lo = mid + 1; else hi = mid;
    }
    var sg = M.segs[M.at.get(best)];
    return sg.a + given(sg, lo);
  }
  if (OWN) {
    var press = null, held = false, eatUntil = 0, dragging = null, sweep = null, grabAt = null;
    // as Android's own selection: words at a time, whichever way it goes (a place within a word takes it all)
    function wordStart(C, k) { return wordy.test(C[k] || "") ? whole(C, k, k + 1)[0] : k; }
    function wordEnd(C, k) { return wordy.test(C[k - 1] || "") ? whole(C, k - 1, k)[1] : k; }
    on(document, "touchstart", function (e) {
      if (e.touches.length !== 1 || dragging) { press = null; return; }
      var el = e.target.nodeType === 1 ? e.target : e.target.parentNode, t = el && textAt(el);
      if (!t || el.closest("a[href], button, input, textarea, select, .mk-grip")) { press = null; return; }
      var p = e.touches[0];
      press = {x: p.clientX, y: p.clientY, t: t, timer: setTimeout(function () { pressed(); }, 400)};
    }, {passive: true});
    on(document, "touchmove", function (e) {
      if (press && Math.abs(e.touches[0].clientX - press.x) + Math.abs(e.touches[0].clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
    }, {passive: true});
    // held, then moved without letting go: the selection stretches from that word to the one under the finger (the
    // page not scrolled meanwhile: a listener that may stop it, from the start of every touch)
    on(document, "touchmove", function (e) {
      if (!sweep || !cur || e.touches.length !== 1) return;
      e.preventDefault();
      var p = e.touches[0], C = cur.t.M.C, k = offsetAt(cur.t, p.clientX, p.clientY);
      if (cur.t === T) {
        var top = host.barHeight() + 40, foot = window.innerHeight - host.peekHeight() - 90;
        if (p.clientY < top) window.scrollBy(0, -14); else if (p.clientY > foot) window.scrollBy(0, 14);
      }
      if (k < 0) return;
      if (k >= sweep[1]) { cur.s = sweep[0]; cur.e = Math.max(sweep[1], wordEnd(C, k + 1)); }
      else if (k < sweep[0]) { cur.s = wordStart(C, k); cur.e = sweep[1]; }
      else { cur.s = sweep[0]; cur.e = sweep[1]; }
      drawOwn();
    }, {passive: false});
    on(document, "touchend", function () {
      sweep = null;
      if (press) { clearTimeout(press.timer); press = null; }
      if (held) { held = false; eatUntil = Date.now() + 400; }      // (the tap the hold ends in opens nothing)
    }, {passive: true});
    on(document, "touchcancel", function () { if (press) { clearTimeout(press.timer); press = null; } }, {passive: true});
    on(document, "contextmenu", function (e) { if (held || Date.now() < eatUntil) e.preventDefault(); });
    function pressed() {                           // held: the word there selected (a formula, all of it)
      var p = press;
      press = null;
      if (!p || dead) return;
      var t = p.t, M = model(t), el = document.elementFromPoint(p.x, p.y), f = el && el.closest(FORMULA), s, e;
      if (f && M.at.has(f)) { var g = M.segs[M.at.get(f)]; s = g.a; e = g.b; }
      else {
        var k = offsetAt(t, p.x, p.y), C = M.C;
        if (k < 0) return;
        if (!wordy.test(C[k] || "") && wordy.test(C[k - 1] || "")) k--;
        if (!wordy.test(C[k] || "")) return;       // (between words: nothing)
        var w = whole(C, k, k + 1); s = w[0]; e = w[1];
      }
      if (window.getSelection) window.getSelection().removeAllRanges();
      cur = {t: t, s: s, e: e};
      sweep = [s, e];
      held = true;
      if (navigator.vibrate) try { navigator.vibrate(8); } catch (x) {}
      drawOwn();
      if (!sheetOpen) showDock();
    }
    // a handle dragged: the selection's end moved to where the finger points (just above it: the finger hides the text)
    function grab(which) {
      return function (e) {
        if (!cur) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = which;
        drawOwn();                                 // (the finger keeps its distance from the place the handle points to)
        var p = e.touches[0], at = ownEnds && ownEnds[which];
        grabAt = at ? [at[0] - p.clientX, at[1] - p.clientY] : [0, -28];
        document.addEventListener("touchmove", drag, {passive: false});
        document.addEventListener("touchend", drop);
        document.addEventListener("touchcancel", drop);
      };
    }
    function drag(e) {
      if (!dragging || !cur) return;
      e.preventDefault();
      var p = e.touches[0], k = offsetAt(cur.t, p.clientX + grabAt[0], p.clientY + grabAt[1]), C = cur.t.M.C;
      if (cur.t === T) {                            // near the top or the foot: the page moves on under the finger
        var top = host.barHeight() + 40, foot = window.innerHeight - host.peekHeight() - 90;
        if (p.clientY < top) window.scrollBy(0, -14); else if (p.clientY > foot) window.scrollBy(0, 14);
      }
      if (k < 0) return;
      if (dragging === "s") { if (k >= cur.e) { cur.s = cur.e; cur.e = wordEnd(C, k); dragging = "e"; } else cur.s = wordStart(C, k); }
      else { if (k <= cur.s) { cur.e = cur.s; cur.s = wordStart(C, k); dragging = "s"; } else cur.e = wordEnd(C, k); }
      if (cur.e <= cur.s) cur.e = Math.min(C.length, cur.s + 1);
      drawOwn();
    }
    function drop() {
      document.removeEventListener("touchmove", drag, {passive: false});
      document.removeEventListener("touchend", drop);
      document.removeEventListener("touchcancel", drop);
      if (!dragging) return;
      dragging = null;
      if (!cur) return;
      var w = whole(cur.t.M.C, cur.s, cur.e);      // (whole words, as the browser's own handles leave them)
      if (w[1] > w[0]) { cur.s = w[0]; cur.e = w[1]; }
      drawOwn();
      if (!sheetOpen) showDock();
    }
    gs.addEventListener("touchstart", grab("s"), {passive: false});
    ge.addEventListener("touchstart", grab("e"), {passive: false});
    dock.querySelector(".mb-copy").hidden = false;
  }

  // ---------------------------------------------------------------- a mark's sheet
  var sheet = document.createElement("div");
  sheet.className = "l2m-fnsheet l2m-marksheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "Mark");
  sheet.setAttribute("aria-hidden", "true");
  sheet.tabIndex = -1;
  sheet.innerHTML = '<div class="sheet-inner"><div class="sheet-head"><div class="mk-colors" role="group" aria-label="Colour">' +
    dots("") + '</div><div class="mk-acts">' +
    '<button type="button" class="bar-btn" data-mk="link" aria-label="Copy a link to this mark">' + (I.link || "") + "</button>" +
    '<button type="button" class="bar-btn" data-mk="remove" aria-label="Remove the mark">' + (I.trash || "") + "</button>" +
    '<button type="button" class="bar-btn" data-mk="close" aria-label="Close">' + (I.close || "") + "</button></div></div>" +
    '<div class="mk-quote"></div><p class="mk-was" hidden></p><p class="mk-by" hidden></p>' +
    '<textarea class="mk-note" rows="2" placeholder="Add a note" aria-label="Note"></textarea></div>';
  document.body.appendChild(sheet);
  var quote = sheet.querySelector(".mk-quote"), note = sheet.querySelector(".mk-note"), was = sheet.querySelector(".mk-was");
  var by = sheet.querySelector(".mk-by");
  var sheetOpen = false, noteT = 0;
  // a mark's words as they stand in the paper (its formulas drawn first: one not drawn yet would be copied empty);
  // at most limit characters of them
  function wordsOf(id, limit) {
    var p = placed[id], m = store.all()[id];
    if (!p || !T.M) { var span = document.createElement("span"); span.textContent = (m && m.quote) || ""; return span; }
    var e = limit && p.e - p.s > limit ? p.s + limit : p.e, r = rangeOf(T.M, p.s, e);
    for (var i = firstSeg(T.M, p.s); i < T.M.segs.length && T.M.segs[i].a < e; i++) {
      var f = T.M.segs[i].f;
      if (f && f.hasAttribute("data-lazy") && window.L2M_math) L2M_math.draw(f);
    }
    var frag = r ? r.cloneContents() : document.createDocumentFragment();
    frag.querySelectorAll("[id]").forEach(function (x) { x.removeAttribute("id"); });
    if (e < p.e) frag.appendChild(document.createTextNode("…"));
    return frag;
  }
  // in the list, the words run on as one passage: paragraphs, list items and displayed formulas each in the line, after
  // a space (a display's formula drawn as in the text, its number left out), none on lines of its own
  function runOn(frag) {
    frag.querySelectorAll(".eqno").forEach(function (x) { x.remove(); });
    frag.querySelectorAll("mjx-container[display]").forEach(function (x) { x.removeAttribute("display"); });
    frag.querySelectorAll(host.block + ", div, ol, ul, table, tbody, thead, tr, dl, br").forEach(function (x) {
      var sp = document.createElement("span");
      while (x.firstChild) sp.appendChild(x.firstChild);
      if (x.previousSibling && !/\s$/.test(x.previousSibling.textContent)) x.before(" ");
      x.replaceWith(sp);
    });
    return frag;
  }
  function fill(m) {
    sheet.querySelectorAll(".mk-dot").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.getAttribute("data-c") === (m.c || 1))); });
    quote.textContent = "";
    quote.appendChild(wordsOf(m.id, 0));
    quote.classList.toggle("long", quote.scrollHeight > quote.clientHeight + 2);
    // found in words that changed (the paper revised): what they were
    was.hidden = !m.was;
    was.textContent = m.was ? "The words changed in this version. They read: \u201c" + m.was + "\u201d" : "";
    by.hidden = !m.by;                             // (a mark someone else made: Claude, through the library tool)
    by.textContent = m.by ? "Marked by " + m.by : "";
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
    listChanged();
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
  // with a keyboard (a mouse or trackpad beside it): Enter is done with the note, Shift+Enter a new line in it. Without
  // one (a phone's keys), Enter is a new line, as it is anywhere
  function keyboard() { return !!(window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches); }
  note.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && keyboard()) { e.preventDefault(); closeSheet("hand"); }
  });
  // and something selected, then typing, is a note being written: the selection marked, its note begun with the key
  on(document, "keydown", function (e) {
    if (dead || sheetOpen || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.key.length !== 1 || e.key === " ") return;
    var t = e.target;
    if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
    var r = selected();
    if (!r && !cur) return;
    e.preventDefault();
    if (r) lastRange = r.cloneRange();
    var id = make(colourOf());
    if (!id) return;
    openSheet(id, true);
    note.value = e.key;
    note.setSelectionRange(1, 1);
    grow();
  });
  note.addEventListener("blur", saveNote);
  function remove(id) {                            // a mark taken off (Undo puts it back)
    var m = store.all()[id];
    if (!m || m.gone) return;
    var keep = JSON.parse(JSON.stringify(m));
    store.put({id: id, gone: true});
    place();
    if (store.toastAct) store.toastAct("Mark removed.", "Undo", function () {
      delete keep.gone;
      store.put(keep);
      place();
    });
  }
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
      listChanged();
      return;
    }
    var what = b.getAttribute("data-mk");
    if (what === "close") closeSheet("hand");
    else if (what === "link") {
      var url = store.link(m.id), done = function () { if (store.toast) store.toast("Link copied."); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () {});
    } else if (what === "remove") {
      var id = m.id;
      closeSheet("hand");
      remove(id);
    }
  });

  // ---------------------------------------------------------------- Notes, beside the contents
  // The contents panel's title becomes two tabs, Contents and Notes; Notes lists the marks in the paper's order,
  // under their sections (each a jump to it, as a link is), and last the ones not found in this version
  var menuInner = host.menu && host.menu.querySelector(".menu-inner"), tocList = menuInner && menuInner.querySelector("ol");
  var menuHead = menuInner && menuInner.querySelector(".menu-head"), tabs = null, list = null, tab = "toc", listStale = true;
  var view = null, track = null, panes = null, sizer = null;
  if (menuInner && tocList && menuHead) {
    tabs = document.createElement("div");
    tabs.className = "mk-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Contents and notes");
    tabs.innerHTML = '<button type="button" class="mk-tab" role="tab" data-tab="toc" aria-selected="true">Contents</button>' +
      '<button type="button" class="mk-tab" role="tab" data-tab="notes" aria-selected="false">Notes<span class="mk-count"></span></button>' +
      '<span class="mk-tab-line" aria-hidden="true"></span>';
    // above the list, as the main tabs are above theirs: they stay where they are as the lists scroll
    menuHead.remove();
    menuInner.before(tabs);
    // the two lists side by side on a strip, as the settings' panes: it slides to the one shown (a swipe moves it with
    // the finger), and the underline and the panel's height go with it, all at once. Each list scrolls in its own box
    // (each stays where it was left, and the panel is only as tall as the one shown, either way)
    view = document.createElement("div");
    view.className = "mk-view";
    track = document.createElement("div");
    track.className = "mk-track";
    panes = [document.createElement("div"), document.createElement("div")];
    panes.forEach(function (p) {
      p.className = "mk-pane"; p.setAttribute("role", "tabpanel"); track.appendChild(p);
      p.addEventListener("scroll", function () { faded(p); }, {passive: true});
    });
    list = document.createElement("div");
    list.className = "mk-list";
    tocList.before(view);
    view.appendChild(track);
    panes[0].appendChild(tocList);
    panes[1].appendChild(list);
    menuInner.classList.add("mk-split");
    // a list changing its height (marks added or removed, its formulas drawn, the screen turned) takes the panel with it
    if (window.ResizeObserver) {
      sizer = new ResizeObserver(function () { if (!(sw && sw.dir === "x")) fit(true); faded(panes[0]); faded(panes[1]); });
      panes.forEach(function (p) { sizer.observe(p); });
    }
    tabs.addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (b) showTab(b.getAttribute("data-tab"), true); });
    var sw = null;
    view.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { sw = null; return; }
      sw = {x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), dir: null, w: view.clientWidth || 1, i: tab === "notes" ? 1 : 0};
    }, {passive: true});
    view.addEventListener("touchmove", function (e) {
      if (!sw) return;
      var dx = e.touches[0].clientX - sw.x, dy = e.touches[0].clientY - sw.y;
      if (!sw.dir && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
        sw.dir = Math.abs(dx) > 1.2 * Math.abs(dy) ? "x" : "y";
        if (sw.dir === "x") {
          if (tab !== "notes" && listStale) renderList();
          sw.h = [panes[0].offsetHeight, panes[1].offsetHeight];
        }
      }
      if (sw.dir !== "x") return;
      e.preventDefault();
      var next = sw.i - Math.sign(dx);
      if (next < 0 || next > 1) dx *= 0.25;        // (nothing that way: it gives only a little)
      track.style.transition = "none";
      track.style.transform = "translateX(" + (-sw.i * sw.w + dx) + "px)";
      var f = Math.max(0, Math.min(1, sw.i - dx / sw.w));
      lineUnder(f, true);
      view.style.transition = "none";              // (the panel's height with them, between the two lists')
      view.style.height = sw.h[0] + (sw.h[1] - sw.h[0]) * f + "px";
    }, {passive: false});
    function swEnd(e) {
      if (!sw || sw.dir !== "x") { sw = null; return; }
      var dx = (e.changedTouches ? e.changedTouches[0].clientX : sw.x) - sw.x, fast = Date.now() - sw.t < 300, to = sw.i - Math.sign(dx), s0 = sw;
      sw = null;
      if (to >= 0 && to <= 1 && (Math.abs(dx) > s0.w * 0.25 || (fast && Math.abs(dx) > 30))) showTab(to ? "notes" : "toc", true);
      else showTab(tab, true);
    }
    view.addEventListener("touchend", swEnd);
    view.addEventListener("touchcancel", swEnd);
    list.addEventListener("click", function (e) {
      var x = e.target.closest("[data-mk-drop]");
      if (x) { e.preventDefault(); remove(x.getAttribute("data-mk-drop")); return; }
      var a = e.target.closest("[data-mk-go]");
      if (!a) return;
      e.preventDefault();
      jumpTo(a.getAttribute("data-mk-go"));
    });
  }
  // the underline: under the tab shown, or (f, a swipe on its way: 0 Contents, 1 Notes) between the two, with the finger
  function lineUnder(f, now) {
    var bs = tabs && tabs.querySelectorAll("[data-tab]"), ln = tabs && tabs.querySelector(".mk-tab-line");
    if (!bs || !ln || !bs[0].offsetWidth) return;
    if (f == null) f = tab === "notes" ? 1 : 0;
    var x = bs[0].offsetLeft + (bs[1].offsetLeft - bs[0].offsetLeft) * f, w = bs[0].offsetWidth + (bs[1].offsetWidth - bs[0].offsetWidth) * f;
    ln.style.transition = now ? "none" : "";
    ln.style.width = w + "px";
    ln.style.transform = "translateX(" + x + "px)";
  }
  // the panel as tall as the list shown (a list at most as tall as the panel can be, and scrolled within it)
  function fit(animate) {
    if (!view) return;
    view.style.transition = animate ? "" : "none";
    view.style.height = panes[tab === "notes" ? 1 : 0].offsetHeight + "px";
    if (!animate) { void view.offsetWidth; view.style.transition = ""; }
  }
  function faded(p) {                              // a list fades out at an edge where there is more of it to scroll to
    p.classList.toggle("fade-top", p.scrollTop > 2);
    p.classList.toggle("fade-bottom", p.scrollTop + p.clientHeight < p.scrollHeight - 2);
  }
  function showTab(name, animate) {
    if (!tabs) return;
    var i = name === "notes" ? 1 : 0;
    tab = name;
    tabs.querySelectorAll("[data-tab]").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === name)); });
    if (name === "notes" && listStale) renderList();
    panes.forEach(function (p, k) { p.setAttribute("aria-hidden", String(k !== i)); if (k === i) p.removeAttribute("inert"); else p.setAttribute("inert", ""); });
    // all at once, as the settings' tabs: the strip slides to it, the underline with it, the panel takes its height
    track.style.transition = animate ? "" : "none";
    track.style.transform = "translateX(" + (-50 * i) + "%)";
    if (!animate) { void track.offsetWidth; track.style.transition = ""; }
    lineUnder(i, !animate);
    fit(animate);
    faded(panes[i]);
  }
  function counted() { var all = store.all(); return Object.keys(all).filter(function (id) { return live(all[id]); }).length; }
  function listChanged() {
    listStale = true;
    var c = tabs && tabs.querySelector(".mk-count"), n = counted();
    if (c) c.textContent = n ? " · " + n : "";
    if (tabs && host.menu.classList.contains("open") && tab === "notes") renderList();
    lineUnder();
  }
  function renderList() {
    if (!list) return;
    listStale = false;
    var all = store.all(), ids = Object.keys(placed).filter(function (id) { return live(all[id]); })
      .sort(function (a, b) { return placed[a].s - placed[b].s; });
    list.textContent = "";
    if (!ids.length && !lostIds.length) {
      list.innerHTML = '<p class="mk-empty">Your marks and notes appear here. Select text in the paper to mark it.</p>';
      return;
    }
    var frag = document.createDocumentFragment(), lastHead = null;
    function sec(label) { var p = document.createElement("p"); p.className = "mk-sec"; p.textContent = label; frag.appendChild(p); }
    ids.forEach(function (id) {
      var m = all[id], h = T.M ? headAt(T.M, placed[id].s) : null;
      if (h && h !== lastHead) { sec(h.el.textContent.replace(/\s+/g, " ").trim()); lastHead = h; }
      var a = document.createElement("a");
      a.className = "mk-item c" + (m.c || 1);
      a.href = "#mark-" + encodeURIComponent(id);
      a.setAttribute("data-mk-go", id);
      var q = document.createElement("span");
      q.className = "mk-item-q";
      q.appendChild(runOn(wordsOf(id, 220)));
      a.appendChild(q);
      if (m.note || m.by) { var n = document.createElement("span"); n.className = "mk-item-n"; n.textContent = m.note ? (m.by ? m.by + ": " : "") + m.note : "Marked by " + m.by; a.appendChild(n); }
      frag.appendChild(a);
    });
    if (lostIds.length) {
      sec("Not found in this version");
      lostIds.forEach(function (id) {
        var m = all[id], d = document.createElement("div");
        d.className = "mk-item mk-lost c" + (m.c || 1);
        d.innerHTML = '<span class="mk-item-q">' + esc(m.quote) + "</span>" + (m.note ? '<span class="mk-item-n">' + esc(m.note) + "</span>" : "") +
          '<button type="button" class="bar-btn mk-item-x" data-mk-drop="' + esc(id) + '" aria-label="Remove this mark">' + (I.close || "&times;") + "</button>";
        frag.appendChild(d);
      });
    }
    list.appendChild(frag);
    fit(true);                                     // (the panel with it, if it is shown)
  }
  function jumpTo(id) {                           // from the list: to the mark, as a link goes (back returns)
    var p = placed[id], r = p && rangeOf(T.M, p.s, p.e), box = r && (r.getClientRects()[0] || r.getBoundingClientRect());
    if (!box) return;
    host.closeMenu("jump");
    host.jump(Math.max(0, window.pageYOffset + box.top - host.barHeight() - Math.round(window.innerHeight * 0.18)), "mark-" + id);
    pulse(id);
  }
  function pulse(id) {
    flashId = id;
    relay();
    setTimeout(function () { if (flashId === id) { flashId = null; relay(); } }, 1600);
  }

  // ---------------------------------------------------------------- taps
  // A tap on a mark opens its sheet (not on a link or a button: those keep their own), and so does one on a note in
  // the margin. Caught before the paper's own taps, so that a footnote's sheet open is closed as this one opens, not
  // by a step back of its own
  on(document, "click", function (e) {
    if (dead || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var el = e.target.nodeType === 1 ? e.target : e.target.parentNode;
    if (!el || !el.closest || sheet.contains(el) || dock.contains(el)) return;
    if (OWN && Date.now() < eatUntil) { eatUntil = 0; e.preventDefault(); e.stopPropagation(); return; }
    if (cur && !el.closest(".mk-grip")) {           // (selected: a tap elsewhere lets it go, and does nothing else)
      clearSel();
      if (!el.closest("a[href], button, input, textarea, select, summary, label, [role='button']")) { e.preventDefault(); e.stopPropagation(); return; }
    }
    var aside = el.closest(".l2m-mk-side");
    if (aside) { e.preventDefault(); e.stopPropagation(); openSheet(aside.getAttribute("data-id")); return; }
    var own = el.closest("a[href], button, input, textarea, select, summary, label, [role='button'], img, .fig-open");
    var sel = window.getSelection && window.getSelection(), id = null;
    if (!own && !e.defaultPrevented && !(sel && !sel.isCollapsed)) {
      if (P && peekShown && P.root.contains(el)) {
        var pr = P.root.getBoundingClientRect();
        id = hit(peekBoxes, e.clientX - pr.left, e.clientY - pr.top);
      } else if (!el.closest(".l2m-bar, .l2m-menu, .l2m-fnsheet, .l2m-peek, .l2m-viewer, .app-toast")) {
        id = hit(boxes, e.clientX + window.pageXOffset, e.clientY + window.pageYOffset);
      }
    }
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
    var id = wanted, r = rangeOf(T.M, p.s, p.e), box = r && (r.getClientRects()[0] || r.getBoundingClientRect());
    wanted = null;
    if (!box) return;
    window.scrollTo(0, Math.max(0, window.pageYOffset + box.top - host.barHeight() - Math.round(window.innerHeight * 0.18)));
    pulse(id);
  }

  // ---------------------------------------------------------------- the marks come, and go back
  var started = Promise.resolve(host.ready).then(function () {
    if (dead) return;
    listChanged();
    // the ones on this device first (the text read in idle moments), then the library's (another device's, since)
    return (any() || OWN ? modelSoon(T).then(function () { if (!dead) { place(); go(); } }) : Promise.resolve())
      .then(function () { return new Promise(function (res) { idle(res); }); })
      .then(function () { return dead ? false : store.pull(); })
      .then(function (changed) { if (!dead && changed) return modelSoon(T).then(function () { if (!dead) { place(); go(); } }); });
  });
  on(window, "online", function () { store.pull(); });       // (what was changed offline: written now)
  on(document, "visibilitychange", function () {
    if (document.visibilityState === "hidden") { saveNote(); store.flush(true); }
    else store.pull().then(function (changed) { if (!dead && changed) modelSoon(T).then(function () { if (!dead) place(); }); });
  });

  return {
    closeSheet: closeSheet,
    reveal: function (id) { wanted = id; started.then(go); },
    panelOpened: function () {                     // nav.js: the contents panel open (its tabs as left)
      if (!tabs) return;
      if (listStale) renderList();                 // (ready to slide in)
      // the current section in the middle of the contents (their own box scrolls here, not the panel's)
      var cur = tocList.querySelector("a.current"), p = panes[0];
      if (cur) p.scrollTop = Math.max(0, p.scrollTop + cur.getBoundingClientRect().top - p.getBoundingClientRect().top - p.clientHeight / 2);
      showTab(tab, false);
      requestAnimationFrame(function () { lineUnder(null, true); faded(panes[0]); faded(panes[1]); });
    },
    peekOpened: function (box, gen) {               // nav.js: the peek open, its copy of the paper in box (gen: which copy)
      if (!P || P.root !== box || P.gen !== gen) { P = textOf(box); P.gen = gen; peekPlaced = {}; }
      peekShown = true;
      if (ro) ro.observe(box);
      if (!any()) return;
      modelSoon(P).then(function () { if (!dead && peekShown && P && P.root === box) { placePeek(); relay(); } });
    },
    peekClosed: function () {
      peekShown = false;
      if (P && ro) ro.unobserve(P.root);
      peekLayer.textContent = "";
      peekBoxes = [];
    },
    destroy: function () {
      if (dead) return;
      saveNote();
      dead = true;
      clearTimeout(selT); clearTimeout(tapT); clearTimeout(noteT);
      if (laying) cancelAnimationFrame(laying);
      if (ro) ro.disconnect();
      if (sizer) sizer.disconnect();
      offs.forEach(function (o) { o[0].removeEventListener(o[1], o[2], o[3]); });
      offs = [];
      store.flush(true);
      layer.remove(); peekLayer.remove(); side.remove(); dock.remove(); sheet.remove(); selLayer.remove(); gs.remove(); ge.remove();
      if (tabs && menuHead) { tabs.remove(); menuInner.classList.remove("mk-split"); menuInner.prepend(menuHead); view.replaceWith(tocList); }
    }
  };
};
