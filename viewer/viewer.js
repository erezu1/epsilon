// Epsilon paper renderer: draws one stored document (paper.json, see DOCUMENT.md) with a theme
// (theme.json + theme.css). The reading bar, contents panel, settings, footnote sheet and figure viewer
// are built here from the theme; the paper's own HTML comes from the document; formulas come from the
// pre-drawn math.json when it matches the document, and are otherwise drawn here with MathJax (text
// first, nearest formulas first, reading position held still). nav.js then runs the page.
//
//   var view = L2M_open({doc, theme, cache, base, key, onLibrary, libraryHref, kicker, mathjax,
//                        image, actions});
//     image(name) -> Promise of a URL, for figures that need fetching (a private library);
//     actions: [{label, href} or {label, onClick(button), pressed}] shown by the title;
//     menuItems, menuHead: a host's own entries at the top of the contents panel (HTML <li>s).
//   view.ready.then(...);   // formulas and images are in
//   view.close();            // back to an empty <main>, ready for the next paper
(function () {
  "use strict";
  var root = document.documentElement;

  function esc(t) {
    return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function mathMarkers(h) {
    // an opening bracket or quote before a formula, and punctuation after it, stay on its line
    return h.replace(/([(\[\u201c\u2018]?)(<l2m-math n="\d+"><\/l2m-math>)([.,;:)\]!?\u2019\u201d]*)/g,
      function (m, pre, f, post) { return pre || post ? '<span class="mw">' + pre + f + post + "</span>" : f; });
  }

  // the reading settings (font, text size, appearance, tone), also used by the app's own settings panel
  function readingSettings(theme) {
    var I = theme.icons || {};
    var D = theme.defaults || {};
    function checked(v, d) { return v === d ? "true" : "false"; }
    var fonts = (theme.fonts || []).map(function (f) {
      return '<button type="button" class="opt" role="radio" aria-checked="' + checked(f.key, D.font) + '" data-font="' + esc(f.key) + '">' +
        '<span class="opt-name" style="font-family:' + esc('"l2m-pv-' + f.key + '", ' + f.stack) + '">' + esc(f.name) + '</span><span class="opt-note">' + esc(f.note) +
        '</span><span class="opt-check">' + (I.check || "") + "</span></button>";
    }).join("");
    var sizes = (theme.sizes || []).map(function (z) {
      return '<button type="button" class="seg-btn" role="radio" aria-checked="' + checked(z.key, D.size) + '" data-size-opt="' + esc(z.key) +
        '" aria-label="' + esc(z.label) + ' text"><span class="size-a" style="font-size:' + esc(z.sample) + '">A</span><span>' + esc(z.label) + "</span></button>";
    }).join("");
    var looks = (theme.appearance || []).map(function (a) {
      return '<button type="button" class="seg-btn" role="radio" aria-checked="' + checked(a.key, D.appearance) + '" data-theme-opt="' + esc(a.key) + '">' +
        (I[a.icon] || "") + "<span>" + esc(a.label) + "</span></button>";
    }).join("");
    var tones = (theme.tones || []).map(function (t) {
      return '<button type="button" class="seg-btn" role="radio" aria-checked="' + checked(t.key, D.tone) + '" data-tone-opt="' + esc(t.key) + '">' +
        "<span>" + esc(t.label) + "</span></button>";
    }).join("");
    function group(head, cls, inner) {
      return inner ? '<p class="menu-head">' + head + '</p><div class="' + cls + '" role="radiogroup" aria-label="' + head + '">' +
        '<span class="sel-ind" aria-hidden="true"></span>' + inner + "</div>" : "";
    }
    // the font: the chosen one on its own; tapped, the list of fonts opens under it
    var cur = (theme.fonts || []).filter(function (f) { return f.key === D.font; })[0] || (theme.fonts || [])[0];
    var fontPick = fonts && cur ? '<p class="menu-head">Font</p><div class="font-pick">' +
      '<button type="button" class="opt font-current" data-font-toggle aria-expanded="false" aria-label="Font: ' + esc(cur.name) + ', tap to choose another">' +
      '<span class="opt-name" style="font-family:' + esc('"l2m-pv-' + cur.key + '", ' + cur.stack) + '">' + esc(cur.name) + '</span><span class="opt-note">' + esc(cur.note) + "</span>" +
      '<span class="opt-chev">' + (I.chevron || "&#9662;") + "</span></button>" +
      '<div class="font-drop"><div class="opt-list" role="radiogroup" aria-label="Font"><span class="sel-ind" aria-hidden="true"></span>' + fonts + "</div></div></div>" : "";
    var full = window.L2M_canFull && L2M_canFull() ?
      ['on', 'off'].map(function (k) {
        return '<button type="button" class="seg-btn" role="radio" aria-checked="' + checked(k, "off") + '" data-full-opt="' + k + '"><span>' +
          (k === "on" ? "On" : "Off") + "</span></button>";
      }).join("") : "";
    // the page's width on a wide screen: narrow (the text a comfortable measure, the default), medium or wide
    var widths = [["narrow", "Narrow", "widthNarrow"], ["medium", "Medium", "widthMedium"], ["wide", "Wide", "widthWide"]].map(function (m) {
      return '<button type="button" class="seg-btn" role="radio" aria-checked="' + checked(m[0], "narrow") + '" data-width-opt="' + m[0] + '">' +
        (I[m[2]] || "") + "<span>" + m[1] + "</span></button>";
    }).join("");
    return group("Appearance", "seg", looks) + group("Tone", "seg", tones) + group("Text size", "seg", sizes) + fontPick +
      '<div class="set-wide-only">' + group("Page width", "seg", widths) + "</div>" + group("Full screen while reading", "seg", full);
  }
  window.L2M_readingSettings = readingSettings;

  // Line art on a dark page (theme.css). The pictures LaTeX drew are line art; so is a figure drawn in ink on a white or
  // clear ground (a plot, a diagram), which inkTest marks l2m-ink. A photograph or a colour map, mostly neither white
  // nor clear, is left as it is.
  function inkTest(img) {
    try {
      var n = 40, c = document.createElement("canvas");
      c.width = c.height = n;
      var g = c.getContext("2d", {willReadFrequently: true});
      g.drawImage(img, 0, 0, n, n);
      var d = g.getImageData(0, 0, n, n).data, ground = 0;
      for (var k = 0; k < d.length; k += 4)
        if (d[k + 3] < 32 || (d[k] > 230 && d[k + 1] > 230 && d[k + 2] > 230)) ground++;
      if (ground > 0.5 * n * n) img.classList.add("l2m-ink");
    } catch (e) {}                      // (an image the page may not read is left as it is)
  }
  // The pictures inside formulas are SVG images, which take the theme's filters (invert, then hue-rotate(180deg), then
  // for the warm tone sepia) written as SVG filters.
  function artFilters() {
    if (document.getElementById("l2m-art")) return;
    var inv = function (a) {
      return "<feComponentTransfer>" + ["R", "G", "B"].map(function (ch) {
        return '<feFunc' + ch + ' type="table" tableValues="' + a + " " + (1 - a).toFixed(2) + '"/>';
      }).join("") + '</feComponentTransfer><feColorMatrix type="hueRotate" values="180"/>';
    };
    var sepia = '<feColorMatrix type="matrix" values="0.8786 0.1538 0.0378 0 0 0.0698 0.9372 0.0336 0 0 ' +
      '0.0544 0.1068 0.8262 0 0 0 0 0 1 0"/>';                                        // sepia(0.2)
    var box = document.createElement("div");
    box.innerHTML = '<svg id="l2m-art" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">' +
      '<filter id="l2m-art-dark" color-interpolation-filters="sRGB">' + inv(0.92) + "</filter>" +
      '<filter id="l2m-art-warm" color-interpolation-filters="sRGB">' + inv(0.88) + sepia + "</filter></svg>";
    document.body.appendChild(box.firstChild);
  }

  // ------------------------------------------------------------------ the chrome, from the theme
  function chrome(theme, title, hasNotes, o) {
    var I = theme.icons || {};
    var buttons = {
      back: '<button type="button" class="bar-btn swap" data-act="back" aria-label="Back to where you were" disabled>' +
        '<span class="ico ico-back">' + (I.back || "") + '</span><span class="ico ico-close">' + (I.close || "") + "</span></button>",
      title: '<button type="button" class="bar-title" aria-label="Show contents" aria-expanded="false" aria-controls="l2m-menu">' +
        '<span class="bar-title-inner">' + esc(title) + "</span></button>",
      top: '<button type="button" class="bar-btn" data-act="top" aria-label="Go to the top">' + (I.top || "") + "</button>",
      settings: '<button type="button" class="bar-btn" data-act="settings" aria-label="Reading settings" aria-controls="l2m-settings">' +
        (I.settings || "") + "</button>",
      search: '<button type="button" class="bar-btn" data-act="find" aria-label="Search this paper">' + (I.search || "") + "</button>",
      library: o.onLibrary ? '<button type="button" class="bar-btn" data-act="library" aria-label="All papers">' + (I.library || "") + "</button>" : ""
    };
    var always = theme.barShows !== "afterTitle";
    var bar = '<header class="l2m-bar glass glass-top' + (always ? ' show" aria-hidden="false"' : '" aria-hidden="true"') + ' id="l2m-bar"><div class="bar-inner">' +
      (theme.bar || ["back", "title", "top", "settings"]).map(function (b) { return buttons[b] || ""; }).join("") +
      ((theme.bar || []).indexOf("search") >= 0 ?
        '<div class="bar-find" role="search"><span class="find-box"><input class="app-field" type="search" enterkeyhint="search" placeholder="Search, \\phi, or x_?" ' +
        'aria-label="Search this paper, words or TeX" autocomplete="off" autocapitalize="off" spellcheck="false"></span>' +
        '<span class="find-count" aria-live="polite"></span>' +
        '<button type="button" class="bar-btn find-prev" data-act="find-prev" aria-label="Previous match">' + (I.chevron || "") + "</button>" +
        '<button type="button" class="bar-btn find-next" data-act="find-next" aria-label="Next match">' + (I.chevron || "") + "</button>" +
        '<button type="button" class="bar-btn" data-act="find-close" aria-label="Close the search">' + (I.close || "") + "</button></div>" : "") +
      "</div></header>\n";
    var menu = '<nav class="l2m-menu glass glass-top" id="l2m-menu" aria-label="Contents" aria-hidden="true"><div class="menu-inner">' +
      '<p class="menu-head">Contents</p><ol></ol></div></nav>\n';
    var settings = '<div class="l2m-menu l2m-settings glass glass-top" id="l2m-settings" role="dialog" aria-label="Reading settings" aria-hidden="true">' +
      '<div class="menu-inner">' + readingSettings(theme) + "</div></div>\n";
    var sheet = hasNotes ? '<div class="l2m-fnsheet glass glass-bottom" id="l2m-fnsheet" role="dialog" aria-label="Footnote" aria-hidden="true" tabindex="-1">' +
      '<div class="sheet-inner"><div class="sheet-head"><span class="sheet-title">Note <span class="sheet-num"></span></span>' +
      '<button type="button" class="bar-btn" data-act="fnclose" aria-label="Close note">' + (I.close || "") + "</button></div>" +
      '<div class="sheet-body"></div></div></div>\n' : "";
    var viewer = '<div class="l2m-viewer glass-cover" id="l2m-viewer" role="dialog" aria-modal="true" aria-label="Figure" aria-hidden="true" tabindex="-1">' +
      '<div class="viewer-top"><span class="viewer-title"></span><button type="button" class="viewer-goto" data-act="goto">Show in text</button>' +
      '<button type="button" class="bar-btn" data-act="vclose" aria-label="Close">' + (I.close || "") + "</button></div>" +
      '<div class="viewer-stage"><div class="viewer-content"></div></div><div class="viewer-cap"></div></div>\n';
    return bar + menu + settings + sheet + viewer;
  }

  // ------------------------------------------------------------------ one paper
  window.L2M_open = function (o) {
    var doc = o.doc, theme = o.theme || {}, I = theme.icons || {};
    if (!doc || doc.format !== "l2m-doc") throw new Error("not an Epsilon document");
    if ((doc.version || 0) > 1) throw new Error("document version " + doc.version + " is newer than this viewer");
    var main = document.querySelector("main");
    var added = [];                    // everything this paper put on the page, removed again by close()
    function add(node, where) { (where || document.body).appendChild(node); added.push(node); return node; }
    var nav = null, closed = false, done;
    var ready = new Promise(function (r) { done = r; });

    document.title = doc.title || "Paper";
    root.lang = doc.lang || "en";
    var m = doc.math || {items: []};
    var cache = o.cache;
    // use the drawn formulas only if they were drawn from exactly these formulas
    var svg = cache && cache.format === "l2m-math" && m.key && cache.key === m.key &&
      cache.svg && cache.svg.length === m.items.length ? cache.svg : null;
    // A formula's picture in the running text starts empty, at its exact size (the text is laid out just as it will
    // be), and is drawn in as it comes near the screen: a paper's formulas are nine elements in ten of its page, and
    // a page that small is quick to open, restyle and search. Drawing one in moves nothing (its size is set).
    var inner = [];
    // Under each formula, a picture as wide as its drawing and unseen (an empty one; theme.css .mjx-hl): a selection
    // that takes the formula in is shaded there by the browser itself, at its line's whole height, as the words round
    // it are (the drawing it would leave unshaded). A picture, not a letter: it shrinks with a drawing too wide for its
    // line (no letter can); made one by the theme, so what reads the paper's pictures or text passes it by
    var HL = '<span class="mjx-hl" aria-hidden="true"></span>';
    function hl(s) {
      var w = /<svg[^>]*?\swidth="([\d.]+ex)"/.exec(s), a = s.indexOf(">");
      if (!w || a < 0 || s.lastIndexOf("<mjx-container", 0) !== 0) return s;
      return s.slice(0, a) + ' style="--w:' + w[1] + '">' + HL + s.slice(a + 1);
    }
    function drawn(k) { return hl(svg[+k].replace(/^<mjx-container/, '<mjx-container data-n="' + k + '"')); }
    function shell(k) {
      var s = svg[+k], a = s.indexOf(">", s.indexOf("<svg")) + 1, b = s.lastIndexOf("</svg>");
      if (a <= 0 || b - a < 300) return drawn(k);          // (a small one: as it is)
      inner[+k] = s.slice(a, b);
      return hl(s.slice(0, a).replace(/^<mjx-container/, '<mjx-container data-n="' + k + '" data-lazy=""') + s.slice(b));
    }
    function picOf(el) { return el.querySelector(":scope > svg"); }    // (a formula's drawing: its svg)
    function fill(h, lazy) {
      h = mathMarkers(h);
      return svg ? h.replace(/<l2m-math n="(\d+)"><\/l2m-math>/g, function (x, k) { return lazy ? shell(k) : drawn(k); }) : h;
    }
    var drawnSet = new Set();            // the pictures drawn in (the ones a watch may let go)
    function drawIn(el) {
      if (!el.hasAttribute("data-lazy")) return;
      drawnSet.add(el);
      var k = +el.getAttribute("data-n"), pic = picOf(el);
      if (pic && inner[k] != null) pic.innerHTML = inner[k];
      el.removeAttribute("data-lazy");
      if (mathApi.onDraw) mathApi.onDraw(el);      // (the search marks what it found in it)
    }
    var codeCache = [];
    function codesOf(k) {                // the glyphs of a formula not drawn yet, in the order its drawing has them
      if (codeCache[k]) return codeCache[k];
      var out = [], re = /data-c="([0-9A-F]+)"/g, m;
      while ((m = re.exec(inner[k] || ""))) out.push(m[1]);
      return (codeCache[k] = out);
    }
    var ios = [], queue = [], pumping = false;
    // drawn in the browser's idle moments, a few milliseconds at a time (scrolling stays smooth), well before they come
    // in sight; one already in sight is drawn at once
    function pump(dl) {
      pumping = false;
      var t0 = performance.now(), budget = dl && dl.timeRemaining ? Math.min(4, dl.timeRemaining() - 1) : 4;
      // never more than a few milliseconds before the next frame
      while (queue.length && performance.now() - t0 < budget) drawIn(queue.shift());
      if (queue.length) later();
    }
    function later() {
      if (pumping || closed) return;
      pumping = true;
      if (window.requestIdleCallback) requestIdleCallback(pump, {timeout: 150}); else setTimeout(pump, 30);
    }
    // Which pictures are near the view: their places on the page, measured once (and again only when the page's layout
    // changes: an image in, another text size, the window turned), in page order; a scroll looks up the ones within
    // reach by halving (a few steps, not one test per formula at every frame).
    var EAGER = ".titleblock, h1, h2, h3, h4, h5, h6, .footnotes, .thm-name";
    function undraw(el) {                // back to its empty picture (far from the view: the page stays small)
      if (el.hasAttribute("data-lazy")) return;
      drawnSet.delete(el);
      var pic = picOf(el);
      if (pic) pic.textContent = "";
      el.setAttribute("data-lazy", "");
      if (mathApi.onUndraw) mathApi.onUndraw(el);
    }
    // The block a formula is in that the browser may skip while far from the view (theme.css: content-visibility):
    // one of the page's own blocks, or an entry of its notes or references. Asking where a formula inside a skipped
    // block is would have the block laid out; where the block is, is known without
    function blockOf(el, box) {
      var b = el, li = null;
      while (b.parentNode && b.parentNode !== box) {
        if (b.tagName === "LI" && b.parentNode.parentNode && b.parentNode.parentNode.parentNode === box) li = b;
        b = b.parentNode;
      }
      return li || b;
    }
    function watch(box, scroller) {       // the pictures in box drawn in within three screens, let go past eight
      var all = [], tops = [], bots = [], reach = [], pos = new Map(), dirty = true, tick = 0, later2 = 0;
      function measure() {                // (each by its block: its top and bottom)
        all = Array.prototype.filter.call(box.querySelectorAll("mjx-container[data-n]"), function (el) {
          return inner[+el.getAttribute("data-n")] != null && !el.closest(EAGER);
        });
        var base = scroller ? scroller.getBoundingClientRect().top - scroller.scrollTop : -window.pageYOffset, seen = new Map();
        tops = []; bots = []; reach = []; pos = new Map();
        all.forEach(function (el, i) {
          var b = blockOf(el, box), r = seen.get(b);
          if (!r) { r = b.getBoundingClientRect(); seen.set(b, r); }
          tops.push(r.top - base); bots.push(r.bottom - base);
          reach.push(Math.max(i ? reach[i - 1] : -Infinity, r.bottom - base));   // (in page order, never less)
          pos.set(el, i);
        });
        dirty = false;
      }
      function look() {
        tick = 0;
        if (closed) return;
        if (dirty) measure();
        if (!all.length) return;
        var y = scroller ? scroller.scrollTop : window.pageYOffset, h = scroller ? scroller.clientHeight : window.innerHeight;
        var from = y - 3 * h, to = y + 4 * h, lo = 0, hi = reach.length;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (reach[mid] < from) lo = mid + 1; else hi = mid; }
        for (var i = lo; i < all.length && tops[i] <= to; i++) {
          var el = all[i];
          if (!el.hasAttribute("data-lazy")) continue;
          if (bots[i] > y - 200 && tops[i] < y + h + 200) drawIn(el); else if (queue.indexOf(el) < 0) queue.push(el);
        }
        // far away (its block wholly past eight screens), unless marked by a search: let go
        drawnSet.forEach(function (el) {
          var k = pos.get(el);
          if (k != null && (bots[k] < y - 8 * h || tops[k] > y + 9 * h) && !el.querySelector(".l2m-find-g")) undraw(el);
        });
        if (queue.length) later();
      }
      function soon() { if (!tick) tick = requestAnimationFrame(look); }
      var target = scroller || window;
      // (measured again a moment after the page's layout changes: blocks the browser lays out as they come near, or
      // as the page settles, change it often at first)
      function resized() { dirty = true; if (!later2) later2 = setTimeout(function () { later2 = 0; soon(); }, 150); }
      target.addEventListener("scroll", soon, {passive: true});
      window.addEventListener("resize", resized);
      var ro = window.ResizeObserver ? new ResizeObserver(resized) : null;
      if (ro) ro.observe(box);
      unclip(box, scroller);
      ios.push({disconnect: function () {
        target.removeEventListener("scroll", soon); window.removeEventListener("resize", resized);
        if (ro) ro.disconnect(); if (tick) cancelAnimationFrame(tick); clearTimeout(later2);
      }});
      soon();
    }
    // A long paper is laid out and drawn only near the view: the browser skips each of its blocks while far from it
    // (theme.css: content-visibility), and skipping one clips what reaches outside it. So each block is looked at
    // once, as it first comes in sight: one whose contents reach outside it is left whole (.l2m-cv-off)
    function unclip(box, scroller) {
      if (!window.IntersectionObserver) return;
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          var b = e.target;
          io.unobserve(b);
          if (b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1) b.classList.add("l2m-cv-off");
        });
      }, {root: scroller || null});
      Array.prototype.forEach.call(box.querySelectorAll(":scope > *, :scope > section > ol > li"), function (b) {
        if (!b.classList.contains("l2m-cv-off")) io.observe(b);
      });
      ios.push(io);
    }
    // for the reading view's own use (its second view, its search): draw one, look into one before drawing it
    var mathApi = {draw: drawIn, undraw: undraw, watch: watch, codes: codesOf, onDraw: null, onUndraw: null,
                   lazy: function (k) { return inner[+k] != null; }, eager: EAGER,
                   has: function (k, code) { return inner[+k] != null && inner[+k].indexOf('data-c="' + code + '"') >= 0; }};
    if (svg) {
      var st = document.createElement("style");
      st.textContent = cache.css || "";
      add(st, document.head);
      var defs = document.createElement("div");
      defs.innerHTML = cache.cache || "";
      if (defs.firstChild) add(defs.firstChild);
    }

    // the paper
    var tb = theme.titleblock || ["settings"];
    var kicker = o.kicker || doc.kicker;
    var body = doc.body
      .replace(/src="images\/([^"]+)"/g, o.image ? 'data-l2m-img="$1" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="' :
               'src="' + (o.base || "") + 'images/$1"')
      .replace('<l2m-slot name="settings"></l2m-slot>', tb.indexOf("settings") >= 0 ?
        '<button type="button" class="bar-btn tb-settings" data-act="settings" aria-label="Reading settings" aria-controls="l2m-settings">' +
        (I.settings || "") + "</button>" : "")
      .replace('<l2m-slot name="kicker"></l2m-slot>', kicker ? '<p class="kicker">' + esc(kicker) + "</p>" : "");
    var lib = o.onLibrary && tb.indexOf("library") >= 0 ?
      '<p class="l2m-libnav"><a href="' + esc(o.libraryHref || "./") + '" data-act="library">All papers</a></p>\n' : "";
    main.innerHTML = '<span id="l2m-top"></span>\n' + lib + fill(body, true);
    // drawn at once where a part of the page is copied elsewhere as it is (headings to the bar, notes to their sheet) or
    // is first seen. (Figures and tables, copied to the viewer, are drawn by it as it opens: drawn here, the many in a
    // paper's figures and tables would be restyled at every change of colours, near or far, figures never being skipped)
    Array.prototype.forEach.call(main.querySelectorAll(".titleblock mjx-container[data-lazy], h1 mjx-container[data-lazy], h2 mjx-container[data-lazy], " +
      "h3 mjx-container[data-lazy], h4 mjx-container[data-lazy], h5 mjx-container[data-lazy], h6 mjx-container[data-lazy], " +
      ".footnotes mjx-container[data-lazy], .thm-name mjx-container[data-lazy]"), drawIn);
    watch(main);
    window.L2M_math = mathApi;
    Array.prototype.forEach.call(main.querySelectorAll("details.toc"), function (t) { t.remove(); });
    // a document's links go to places, never run code
    Array.prototype.forEach.call(main.querySelectorAll("a[href]"), function (a) {
      if (/^\s*(javascript|data|vbscript):/i.test(a.getAttribute("href"))) a.removeAttribute("href");
    });
    if (o.actions && o.actions.length) {
      var row = document.createElement("p");
      row.className = "l2m-actions";
      o.actions.forEach(function (x) {
        var el = document.createElement(x.href ? "a" : "button");
        el.className = "l2m-action";
        el.textContent = x.label;
        if (x.href) { el.href = x.href; el.target = "_blank"; el.rel = "noopener"; }
        else {
          el.type = "button";
          if (x.pressed !== undefined) el.setAttribute("aria-pressed", x.pressed ? "true" : "false");
          el.addEventListener("click", function () { x.onClick(el); });
        }
        row.appendChild(el);
      });
      var tbEl = main.querySelector(".titleblock");
      if (tbEl) tbEl.appendChild(row); else main.insertBefore(row, main.firstChild.nextSibling);
    }
    var fetched = [];
    if (o.image) {
      Array.prototype.forEach.call(main.querySelectorAll("img[data-l2m-img]"), function (img) {
        fetched.push(o.image(img.getAttribute("data-l2m-img")).then(function (url) {
          return new Promise(function (r) {
            img.addEventListener("load", r); img.addEventListener("error", r);
            img.src = url;
          });
        }, function () { img.alt = "(figure not available offline)"; }));
      });
    }

    // the chrome, in front of <main>
    var holder = document.createElement("div");
    holder.className = "l2m-chrome";
    holder.innerHTML = chrome(theme, doc.title || "", !!document.getElementById("notes-h"), o);
    main.parentNode.insertBefore(holder, main);
    added.push(holder);
    root.classList.toggle("l2m-bar-always", theme.barShows !== "afterTitle");
    var heads = doc.headings || [];
    var top = heads.reduce(function (a, h) { return Math.min(a, h.level); }, 99);
    var items = heads.map(function (h) {
      return '<li class="' + (h.level === top ? "lvl1" : "lvl2") + '"><a href="#' + h.id + '"><span class="tocnum">' +
        h.number + "</span><span>" + h.html + "</span></a></li>";
    });
    if ((theme.bar || []).indexOf("top") < 0)          // no top button in the bar: the contents start with it
      items.unshift('<li class="lvl1 l2m-to-top"><a href="#l2m-top"><span class="tocnum"></span><span>Top of the paper</span></a></li>');
    if (document.getElementById("notes-h")) items.push('<li class="lvl1"><a href="#notes-h"><span class="tocnum"></span><span>Notes</span></a></li>');
    if (document.getElementById("refs-h")) items.push('<li class="lvl1"><a href="#refs-h"><span class="tocnum"></span><span>References</span></a></li>');
    if (o.menuItems) {
      // a host's own entries (the app's pages) above the sections of this page
      holder.querySelector("#l2m-menu .menu-inner").innerHTML = '<p class="menu-head">' + esc(o.menuHead || "Go to") + "</p><ol>" +
        o.menuItems + "</ol>" + (items.length ? '<p class="menu-head">On this page</p><ol>' + fill(items.join("")) + "</ol>" : "");
    } else {
      holder.querySelector("#l2m-menu ol").innerHTML = fill(items.join(""));
    }

    // polytonic Greek: its font (the app's own fonts, or a one-file page carrying it, have it already)
    if (/[\u1f00-\u1fff]/.test(doc.body) && theme.greekFont && !document.getElementById("l2m-font-greek") &&
        !document.getElementById("l2m-fonts") && !(window.L2M_FONTS_INLINE && window.L2M_FONTS_INLINE.greek)) {
      var l = document.createElement("link");
      l.id = "l2m-font-greek";
      l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=" + theme.greekFont + "&display=swap";
      document.head.appendChild(l);
    }

    // the saved place is restored once formulas and images are in
    var imagesIn = Promise.all(fetched.concat(Array.prototype.map.call(main.querySelectorAll("img:not([data-l2m-img])"), function (img) {
      return img.complete ? null : new Promise(function (r) { img.addEventListener("load", r); img.addEventListener("error", r); });
    })));
    artFilters();
    imagesIn.then(function () {            // the figures looked at in idle moments, one at a time
      var imgs = Array.prototype.filter.call(main.querySelectorAll("img"), function (img) { return !img.closest(".l2m-pic"); });
      (function next() {
        if (closed || !imgs.length) return;
        var img = imgs.shift();
        if (img.naturalWidth) inkTest(img);
        setTimeout(next, 0);
      })();
    });
    nav = window.L2M_nav({key: o.key || doc.source || "", theme: theme, onLibrary: o.onLibrary, leaving: o.leaving,
                          tex: function (n) { var it = m.items[+n]; return it ? it.tex : ""; }, macros: m.macros || {},
                          ready: Promise.all([ready, imagesIn]), textReady: ready, marks: o.marks});
    if (svg) done();
    else drawMath(m, o.mathjax || theme.mathjax, main, add, done, function () { return closed; });

    var view = {
      ready: ready,
      land: function (where) { if (nav && nav.land) nav.land(where); },   // (a place the host scrolls to, held as it lands)
      close: function (save) {           // save === false: the history entry has already moved on
        if (closed) return;
        closed = true;
        if (nav) nav.destroy(save);
        added.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
        root.classList.remove("l2m-bar-always");
        ios.forEach(function (io) { io.disconnect(); });
        if (window.L2M_math === mathApi) window.L2M_math = null;
        main.innerHTML = "";
        if (window.L2M_current === view) window.L2M_current = null;
      }
    };
    window.L2M_current = view;       // the open paper (tests wait on L2M_current.ready)
    return view;
  };

  // ------------------------------------------------------------------ formulas drawn in the browser
  var mjLoading = null;
  function mathJax(url, m) {
    // MathJax is loaded once per page; each paper's macros are set before its formulas are drawn
    if (!mjLoading) {
      mjLoading = new Promise(function (resolve, reject) {
        window.MathJax = {
          loader: {load: []},
          // a formula MathJax cannot read shows its TeX
          tex: {packages: m.packages, macros: m.macros, tags: "ams", formatError: function (jax, err) { throw err; }},
          svg: {fontCache: "local"},
          // no MathJax menu, and no hidden MathML copy (it can stick out past the screen)
          options: {enableMenu: false, menuOptions: {settings: {assistiveMml: false}}},
          startup: {typeset: false, ready: function () {
            MathJax.startup.defaultReady();
            document.head.appendChild(MathJax.svgStylesheet());
            resolve();
          }}
        };
        var s = document.createElement("script");
        s.src = url;
        s.async = true;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      return mjLoading;
    }
    return mjLoading.then(function () {
      // a later paper: its own macros and packages
      MathJax.config.tex.macros = m.macros;
      MathJax.config.tex.packages = m.packages;
      MathJax.startup.getComponents();
    });
  }

  function drawMath(m, url, main, add, done, isClosed) {
    var marks = Array.prototype.slice.call(document.querySelectorAll("l2m-math"));
    if (!marks.length) { done(); return; }
    var progress = add(document.createElement("div"));
    progress.className = "l2m-progress";
    progress.setAttribute("aria-hidden", "true");
    mathJax(url, m).then(run, function () {
      // no MathJax (offline?): show the TeX itself
      marks.forEach(function (el) {
        var it = m.items[+el.getAttribute("n")];
        var c = document.createElement("code");
        c.className = "math-error";
        c.textContent = it ? it.tex : "";
        el.replaceWith(c);
      });
      progress.classList.add("done");
      done();
    });

    function run() {
      if (isClosed()) return;
      // nearest first: what is on screen (the bar title and panel included), then the rest in order
      var h = innerHeight, now = [], later = [];
      marks.forEach(function (el) {
        var r = el.getBoundingClientRect();
        (!el.closest("main") || (r.bottom > -h && r.top < 2 * h) ? now : later).push(el);
      });
      var queue = now.concat(later), k = 0, total = queue.length;
      function draw(el) {
        var it = m.items[+el.getAttribute("n")], node;
        try {
          node = MathJax.tex2svg(it.tex, {display: it.display});
        } catch (e) {
          node = document.createElement("code");
          node.className = "math-error";
          node.title = e.message;
          node.textContent = it.tex;
        }
        if (node.setAttribute) node.setAttribute("data-n", el.getAttribute("n"));
        el.replaceWith(node);
      }
      function chunk() {
        if (isClosed()) return;
        var a = anchor(), t0 = performance.now();
        while (k < total && performance.now() - t0 < 14) draw(queue[k++]);
        hold(a);
        progress.style.transform = "scaleX(" + (k / total) + ")";
        if (k < total) setTimeout(chunk, 0);
        else { progress.classList.add("done"); done(); }
      }
      chunk();
    }
  }

  // keep what the reader is looking at in place while formulas above it change height
  function anchor() {
    if (scrollY < 1) return null;
    var y = (parseFloat(getComputedStyle(root).getPropertyValue("--l2m-bar-h")) || 56) + 16;
    var el = document.elementFromPoint(innerWidth / 2, y);
    el = el && el.closest && el.closest("main p, main li, main h2, main h3, main h4, main .display, main figure, main table, main .thm, main blockquote");
    return el ? {el: el, top: el.getBoundingClientRect().top} : null;
  }
  function hold(a) {
    if (!a || !a.el.isConnected) return;
    var d = a.el.getBoundingClientRect().top - a.top;
    if (Math.abs(d) > 0.5) window.scrollBy(0, d);
  }
})();
