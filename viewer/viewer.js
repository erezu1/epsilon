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
        '<span class="opt-name" style="font-family:' + esc(f.stack) + '">' + esc(f.name) + '</span><span class="opt-note">' + esc(f.note) +
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
      '<span class="opt-name" style="font-family:' + esc(cur.stack) + '">' + esc(cur.name) + '</span><span class="opt-note">' + esc(cur.note) + "</span>" +
      '<span class="opt-chev">' + (I.chevron || "&#9662;") + "</span></button>" +
      '<div class="font-drop"><div class="opt-list" role="radiogroup" aria-label="Font"><span class="sel-ind" aria-hidden="true"></span>' + fonts + "</div></div></div>" : "";
    var full = window.L2M_canFull && L2M_canFull() ?
      ['on', 'off'].map(function (k) {
        return '<button type="button" class="seg-btn" role="radio" aria-checked="' + checked(k, "on") + '" data-full-opt="' + k + '"><span>' +
          (k === "on" ? "On" : "Off") + "</span></button>";
      }).join("") : "";
    return group("Appearance", "seg", looks) + group("Tone", "seg", tones) + group("Text size", "seg", sizes) + fontPick +
      group("Full screen while reading", "seg", full);
  }
  window.L2M_readingSettings = readingSettings;

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
      library: o.onLibrary ? '<button type="button" class="bar-btn" data-act="library" aria-label="All papers">' + (I.library || "") + "</button>" : ""
    };
    var always = theme.barShows !== "afterTitle";
    var bar = '<header class="l2m-bar' + (always ? ' show" aria-hidden="false"' : '" aria-hidden="true"') + ' id="l2m-bar"><div class="bar-inner">' +
      (theme.bar || ["back", "title", "top", "settings"]).map(function (b) { return buttons[b] || ""; }).join("") + "</div></header>\n";
    var menu = '<nav class="l2m-menu" id="l2m-menu" aria-label="Contents" aria-hidden="true"><div class="menu-inner">' +
      '<p class="menu-head">Contents</p><ol></ol></div></nav>\n';
    var settings = '<div class="l2m-menu l2m-settings" id="l2m-settings" role="dialog" aria-label="Reading settings" aria-hidden="true">' +
      '<div class="menu-inner">' + readingSettings(theme) + "</div></div>\n";
    var sheet = hasNotes ? '<div class="l2m-fnsheet" id="l2m-fnsheet" role="dialog" aria-label="Footnote" aria-hidden="true">' +
      '<div class="sheet-inner"><div class="sheet-head"><span class="sheet-title">Note <span class="sheet-num"></span></span>' +
      '<button type="button" class="bar-btn" data-act="fnclose" aria-label="Close note">' + (I.close || "") + "</button></div>" +
      '<div class="sheet-body"></div></div></div>\n' : "";
    var viewer = '<div class="l2m-viewer" id="l2m-viewer" role="dialog" aria-modal="true" aria-label="Figure" aria-hidden="true">' +
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
    function fill(h) {
      h = mathMarkers(h);
      return svg ? h.replace(/<l2m-math n="(\d+)"><\/l2m-math>/g, function (x, k) { return svg[+k]; }) : h;
    }
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
    main.innerHTML = '<span id="l2m-top"></span>\n' + lib + fill(body);
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

    if (/[\u1f00-\u1fff]/.test(doc.body) && theme.greekFont && !document.getElementById("l2m-font-greek")) {
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
    nav = window.L2M_nav({key: o.key || doc.source || "", theme: theme, onLibrary: o.onLibrary, leaving: o.leaving,
                          ready: Promise.all([ready, imagesIn])});
    if (svg) done();
    else drawMath(m, o.mathjax || theme.mathjax, main, add, done, function () { return closed; });

    var view = {
      ready: ready,
      close: function (save) {           // save === false: the history entry has already moved on
        if (closed) return;
        closed = true;
        if (nav) nav.destroy(save);
        added.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
        root.classList.remove("l2m-bar-always");
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
