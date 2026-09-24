// latex2mobile app: your library, new papers in your arXiv categories, reading, settings, offline copies.
//
// Where papers come from:
//   - a static site built by l2m_viewer.py (library.json next to this page), or
//   - the private GitHub repo made for the library (erezu1/l2m-library), read through GitHub's API with a
//     token the reader types into Settings; it is stored on this device only. Converting a paper starts
//     the repo's "convert" workflow; the paper appears in the library a few minutes later.
// Addresses: ./ (library), ?v=new (new papers), ?p=<key> (a paper, #id for a place in it).
(function () {
  "use strict";
  var main = document.querySelector("main");
  var root = document.documentElement;
  var theme = window.L2M_THEME || null;
  var src = null;              // where papers come from (see staticSource / githubSource)
  var lib = null, feed = null, config = null;
  var view = null, current = null, urls = [];
  var PREFS = "l2m-app";
  var OFFLINE_CACHE = "l2m-offline-v1";

  // ---------------------------------------------------------------- small helpers
  function esc(t) {
    return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function store(k, v) {
    try {
      var all = JSON.parse(localStorage.getItem(PREFS) || "{}") || {};
      if (v === undefined) return all[k];
      all[k] = v;
      localStorage.setItem(PREFS, JSON.stringify(all));
    } catch (e) { return undefined; }
  }
  function toast(html, ms) {
    var t = document.getElementById("app-toast");
    if (!t) { t = document.createElement("div"); t.id = "app-toast"; t.className = "app-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.innerHTML = html;
    t.classList.add("on");
    clearTimeout(t.l2mTimer);
    t.l2mTimer = setTimeout(function () { t.classList.remove("on"); }, ms || 4000);
  }
  function arxivKey(id) { return String(id).replace(/v\d+$/, "").replace("/", "_"); }
  function keyOf(p) { return p.key || String(p.path || "").replace(/^papers\//, ""); }
  function day(iso) {
    var d = new Date(iso + "T12:00:00Z");
    return isNaN(d) ? iso : d.toLocaleDateString(undefined, {weekday: "short", day: "numeric", month: "short"});
  }
  function authorsLine(a) {
    a = a || [];
    return a.length > 4 ? a.slice(0, 3).join(", ") + " et al." : a.join(", ");
  }

  // ---------------------------------------------------------------- where papers come from
  function staticSource() {
    function get(path) {
      return fetch(path, {cache: "no-cache"}).then(function (r) { if (!r.ok) throw new Error(path + ": " + r.status); return r; });
    }
    return {
      kind: "site",
      json: function (p) { return get(p).then(function (r) { return r.json(); }); },
      blob: function (p) { return get(p).then(function (r) { return r.blob(); }); },
      base: function (p) { return p; }
    };
  }
  function githubSource(repo, token) {
    var api = (store("api") || "https://api.github.com") + "/repos/" + repo;   // "api": a stand-in for tests
    function call(path, opts) {
      opts = opts || {};
      opts.headers = Object.assign({"Authorization": "Bearer " + token, "X-GitHub-Api-Version": "2022-11-28",
                                    "Accept": "application/vnd.github+json"}, opts.headers || {});
      opts.cache = "no-store";
      return fetch(api + path, opts).then(function (r) {
        if (!r.ok) {
          var why = r.status === 401 ? "the token was not accepted" : r.status === 404 ? "not found (check the repo name and the token's access)" :
            r.status === 403 ? "not allowed (the token lacks a permission, or GitHub's rate limit)" : "error " + r.status;
          throw new Error(why);
        }
        return r;
      });
    }
    function raw(path) {
      return call("/contents/" + path.split("/").map(encodeURIComponent).join("/"), {headers: {"Accept": "application/vnd.github.raw+json"}});
    }
    function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
    return {
      kind: "github", repo: repo,
      json: function (p) { return raw(p).then(function (r) { return r.json(); }); },
      blob: function (p) { return raw(p).then(function (r) { return r.blob(); }); },
      run: function (workflow, inputs) {
        return call("/actions/workflows/" + workflow + "/dispatches", {method: "POST",
          headers: {"Content-Type": "application/json"}, body: JSON.stringify({ref: "main", inputs: inputs || {}})});
      },
      writeJSON: function (path, data, message) {
        var url = "/contents/" + path;
        return call(url).then(function (r) { return r.json(); }, function () { return {}; }).then(function (old) {
          return call(url, {method: "PUT", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({message: message, content: b64(JSON.stringify(data, null, 1) + "\n"), sha: old.sha})});
        });
      }
    };
  }

  // ---------------------------------------------------------------- offline copies (Cache Storage)
  function cacheKey(path) { return new URL("__offline/" + path, location.href).href; }
  function cacheOpen() { return window.caches ? caches.open(OFFLINE_CACHE) : Promise.reject(new Error("no offline storage here")); }
  function remember(path, blob) {
    return cacheOpen().then(function (c) { return c.put(cacheKey(path), new Response(blob)); }).catch(function () {});
  }
  function fromCache(path) {
    return cacheOpen().then(function (c) { return c.match(cacheKey(path)); }).then(function (r) {
      if (!r) throw new Error("not saved on this device");
      return r;
    });
  }
  // network first, the saved copy when offline; lists are remembered for next time
  function getJSON(path, keep) {
    return src.blob(path).then(function (b) {
      if (keep) remember(path, b);
      return b.text().then(JSON.parse);
    }, function (e) {
      return fromCache(path).then(function (r) { return r.json(); }, function () { throw e; });
    });
  }
  function offlineSet() { return store("offline") || {}; }
  function isOffline(key) { return !!offlineSet()[key]; }
  function paperFile(key, entry, name) {
    var path = (entry.path || "papers/" + key) + "/" + name;
    if (isOffline(key)) return fromCache(path).then(function (r) { return r.blob(); }, function () { return src.blob(path); });
    return src.blob(path);
  }
  function keepOffline(entry, on) {
    var key = keyOf(entry), base = entry.path || "papers/" + key, set = offlineSet();
    if (!on) {
      return cacheOpen().then(function (c) {
        return c.keys().then(function (ks) {
          return Promise.all(ks.filter(function (k) { return k.url.indexOf(cacheKey(base + "/")) === 0; }).map(function (k) { return c.delete(k); }));
        });
      }).then(function () { delete set[key]; store("offline", set); });
    }
    var bytes = 0;
    function grab(name) {
      return src.blob(base + "/" + name).then(function (b) { bytes += b.size; return remember(base + "/" + name, b).then(function () { return b; }); });
    }
    return grab("paper.json").then(function (b) { return b.text(); }).then(function (t) {
      var names = {};
      t.replace(/src=\\?"images\/([^"\\]+)\\?"/g, function (m, n) { names[n] = 1; });
      return Promise.all([grab("math.json").catch(function () {})].concat(Object.keys(names).map(function (n) { return grab("images/" + n); })));
    }).then(function () {
      set[key] = {bytes: bytes, saved: new Date().toISOString()};
      store("offline", set);
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    });
  }

  // ---------------------------------------------------------------- conversions started here
  function pending() { return store("pending") || {}; }
  function convert(ids) {
    ids = ids.map(function (i) { return i.trim().replace(/^(https?:\/\/)?(www\.)?arxiv\.org\/(abs|pdf|html)\//, "").replace(/\.pdf$/, ""); })
      .filter(function (i) { return /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/.test(i); });
    if (!ids.length) { toast("That is not an arXiv id or link."); return Promise.resolve(); }
    if (!src.run) { toast("Converting needs the GitHub library (Settings)."); return Promise.resolve(); }
    return src.run("convert.yml", {ids: ids.join(" ")}).then(function () {
      var p = pending();
      ids.forEach(function (i) { p[arxivKey(i)] = {id: i, since: Date.now()}; });
      store("pending", p);
      toast("Converting " + esc(ids.join(", ")) + ". It takes a few minutes; it will appear in your library.", 6000);
      watch();
      refresh();
    }, function (e) { toast("Could not start the conversion: " + esc(e.message), 7000); });
  }
  function removing() { return store("removing") || {}; }
  function removePaper(key, button) {
    button.disabled = true;
    button.textContent = "Removing\u2026";
    var entry = ((lib && lib.papers) || []).filter(function (x) { return keyOf(x) === key; })[0];
    src.run("remove.yml", {keys: key}).then(function () {
      var r = removing();
      r[key] = Date.now();
      store("removing", r);
      if (entry && isOffline(key)) keepOffline(entry, false);
      toast("Removed <em>" + esc(entry ? entry.title : key) + "</em>.");
      watch();
      refresh();
    }, function (e) {
      button.disabled = false;
      button.textContent = "Remove";
      toast("Could not remove it: " + esc(e.message), 7000);
    });
  }
  var watching = null;
  function watch() {
    if (watching || !(Object.keys(pending()).length || Object.keys(removing()).length)) return;
    watching = setInterval(function () {
      getJSON("library.json", true).then(function (l) {
        lib = l;
        var p = pending(), changed = false;
        Object.keys(p).forEach(function (k) {
          var e = (l.papers || []).filter(function (x) { return keyOf(x) === k; })[0];
          if (e && e.converted && Date.parse(e.converted) >= p[k].since - 60000) {
            delete p[k];
            changed = true;
            toast(e.status === "ok" ? 'Ready: <a href="?p=' + encodeURIComponent(k) + '" data-p="' + esc(k) + '">' + esc(e.title) + "</a>" :
              "Conversion failed: " + esc(e.title || k), 8000);
          } else if (Date.now() - p[k].since > 30 * 60000) {
            delete p[k];
            changed = true;
            toast("Converting " + esc(p[k] ? p[k].id : k) + " is taking long; see the repo's Actions tab.", 8000);
          }
        });
        store("pending", p);
        var r = removing();
        Object.keys(r).forEach(function (k) {         // gone from the library, or given up on after half an hour
          if (!(l.papers || []).some(function (x) { return keyOf(x) === k; }) || Date.now() - r[k] > 30 * 60000) delete r[k];
        });
        store("removing", r);
        if (changed && isPage(current)) refresh();
        if (!Object.keys(p).length && !Object.keys(r).length) { clearInterval(watching); watching = null; }
      }).catch(function () {});
    }, 20000);
  }

  // ---------------------------------------------------------------- the app's own pages
  // Not papers: a bar of their own (Library / New, search, add, settings) built from the viewer's parts,
  // a panel with the app's settings (reading settings are in the papers), and the two lists side by side.
  var shell = null, panelOpen = false;
  function buildShell() {
    if (shell) return shell;
    var I = theme.icons || {};
    var holder = document.createElement("div");
    holder.className = "l2m-chrome app-chrome";
    holder.innerHTML =
      '<header class="l2m-bar show app-bar" id="app-bar"><div class="bar-inner">' +
      '<img class="app-logo" src="favicon.png" alt="" width="28" height="28">' +
      '<div class="seg app-tabs" role="tablist" aria-label="Sections"><span class="sel-ind" aria-hidden="true"></span>' +
      '<button type="button" class="seg-btn" role="tab" data-go="library" aria-checked="false"><span>Library</span></button>' +
      '<button type="button" class="seg-btn" role="tab" data-go="new" aria-checked="false"><span>New</span></button></div>' +
      '<span class="app-spacer"></span>' +
      '<div class="app-searchbar"><input class="app-field" id="lib-q" type="search" placeholder="Search your library" aria-label="Search your library" ' +
      'autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" class="bar-btn" id="search-close" aria-label="Close the search">' +
      (I.close || "&times;") + "</button></div>" +
      '<button type="button" class="bar-btn" id="app-search" aria-label="Search your library">' + (I.search || "?") + "</button>" +
      '<button type="button" class="bar-btn" id="app-plus" aria-label="Add a paper" aria-expanded="false" aria-controls="app-addp">' + (I.add || "+") + "</button>" +
      '<button type="button" class="bar-btn" id="app-gear" aria-label="Settings" aria-expanded="false" aria-controls="app-settings">' +
      (I.gear || I.settings || "") + "</button></div></header>" +
      '<div class="l2m-menu l2m-settings app-settings" id="app-settings" role="dialog" aria-label="Settings" aria-hidden="true">' +
      '<div class="menu-inner"></div></div>' +
      '<div class="l2m-menu l2m-settings app-settings" id="app-addp" role="dialog" aria-label="Add a paper" aria-hidden="true">' +
      '<div class="menu-inner"></div></div>';
    main.parentNode.insertBefore(holder, main);
    root.classList.add("l2m-bar-always");
    root.style.setProperty("--l2m-bar-h", holder.querySelector("#app-bar").getBoundingClientRect().height + "px");
    shell = holder;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (shell) slide(shell.querySelector(".app-tabs")); });
    holder.querySelector("#app-gear").addEventListener("click", function (e) { e.stopPropagation(); panelOpen === "settings" ? closePanel() : openPanel("settings"); });
    holder.querySelector("#app-plus").addEventListener("click", function (e) { e.stopPropagation(); panelOpen === "add" ? closePanel() : openPanel("add"); });
    holder.querySelector("#app-search").addEventListener("click", function () { searching(true); });
    holder.querySelector("#search-close").addEventListener("click", function () { searching(false); });
    holder.querySelector("#lib-q").addEventListener("input", filterLibrary);
    return holder;
  }
  function dropShell() {
    closePanel();
    if (shell) { shell.remove(); shell = null; }
    root.classList.remove("l2m-bar-always", "l2m-app-lists");
  }
  function slide(group) {                  // the highlight of a segmented control or option list
    var ind = group.querySelector(".sel-ind"), on = group.querySelector('[aria-checked="true"]');
    if (!ind || !on) return;
    ind.style.width = on.offsetWidth + "px";
    if (group.classList.contains("app-tabs")) {      // the bar's tabs: a line under the current one
      ind.style.transform = "translateX(" + on.offsetLeft + "px)";
      return;
    }
    ind.style.height = on.offsetHeight + "px";
    ind.style.transform = "translate(" + on.offsetLeft + "px," + on.offsetTop + "px)";
  }
  // search: the field takes the whole bar; it filters the library as you type
  function filterLibrary() {
    var q = shell ? shell.querySelector("#lib-q").value.trim().toLowerCase() : "";
    Array.prototype.forEach.call(document.querySelectorAll("#lib-list li"), function (li) {
      li.hidden = !!q && li.getAttribute("data-hay").indexOf(q) < 0;
    });
  }
  function searching(on) {
    if (!shell) return;
    closePanel();
    shell.querySelector("#app-bar").classList.toggle("searching", on);
    var f = shell.querySelector("#lib-q");
    if (on) { if (current !== "app:library") go("library"); setTimeout(function () { f.focus(); }, 50); }
    else { f.value = ""; filterLibrary(); f.blur(); }
  }
  function setTab(name) {
    shell.querySelector("#app-plus").hidden = !(src && src.run);
    shell.querySelector("#app-search").hidden = name !== "library";
    if (name !== "library" && shell.querySelector("#app-bar").classList.contains("searching")) searching(false);
    var tabs = shell.querySelector(".app-tabs");
    Array.prototype.forEach.call(tabs.querySelectorAll(".seg-btn"), function (b) {
      b.setAttribute("aria-checked", b.getAttribute("data-go") === name ? "true" : "false");
    });
    slide(tabs);
  }

  // the arXiv categories, by archive (for the category picker)
  var CATEGORIES = [["Physics",[["hep-th","High energy physics, theory"],["hep-ph","High energy physics, phenomenology"],["hep-lat","High energy physics, lattice"],["hep-ex","High energy physics, experiment"],["gr-qc","General relativity and quantum cosmology"],["quant-ph","Quantum physics"],["math-ph","Mathematical physics"],["nucl-th","Nuclear theory"],["nucl-ex","Nuclear experiment"],["astro-ph.CO","Cosmology and nongalactic astrophysics"],["astro-ph.EP","Earth and planetary astrophysics"],["astro-ph.GA","Astrophysics of galaxies"],["astro-ph.HE","High energy astrophysical phenomena"],["astro-ph.IM","Instrumentation and methods for astrophysics"],["astro-ph.SR","Solar and stellar astrophysics"],["cond-mat.dis-nn","Disordered systems and neural networks"],["cond-mat.mes-hall","Mesoscale and nanoscale physics"],["cond-mat.mtrl-sci","Materials science"],["cond-mat.other","Other condensed matter"],["cond-mat.quant-gas","Quantum gases"],["cond-mat.soft","Soft condensed matter"],["cond-mat.stat-mech","Statistical mechanics"],["cond-mat.str-el","Strongly correlated electrons"],["cond-mat.supr-con","Superconductivity"],["nlin.AO","Adaptation and self-organizing systems"],["nlin.CD","Chaotic dynamics"],["nlin.CG","Cellular automata and lattice gases"],["nlin.PS","Pattern formation and solitons"],["nlin.SI","Exactly solvable and integrable systems"],["physics.acc-ph","Accelerator physics"],["physics.ao-ph","Atmospheric and oceanic physics"],["physics.app-ph","Applied physics"],["physics.atm-clus","Atomic and molecular clusters"],["physics.atom-ph","Atomic physics"],["physics.bio-ph","Biological physics"],["physics.chem-ph","Chemical physics"],["physics.class-ph","Classical physics"],["physics.comp-ph","Computational physics"],["physics.data-an","Data analysis, statistics and probability"],["physics.ed-ph","Physics education"],["physics.flu-dyn","Fluid dynamics"],["physics.gen-ph","General physics"],["physics.geo-ph","Geophysics"],["physics.hist-ph","History and philosophy of physics"],["physics.ins-det","Instrumentation and detectors"],["physics.med-ph","Medical physics"],["physics.optics","Optics"],["physics.plasm-ph","Plasma physics"],["physics.pop-ph","Popular physics"],["physics.soc-ph","Physics and society"],["physics.space-ph","Space physics"]]],["Mathematics",[["math.AC","Commutative algebra"],["math.AG","Algebraic geometry"],["math.AP","Analysis of PDEs"],["math.AT","Algebraic topology"],["math.CA","Classical analysis and ODEs"],["math.CO","Combinatorics"],["math.CT","Category theory"],["math.CV","Complex variables"],["math.DG","Differential geometry"],["math.DS","Dynamical systems"],["math.FA","Functional analysis"],["math.GM","General mathematics"],["math.GN","General topology"],["math.GR","Group theory"],["math.GT","Geometric topology"],["math.HO","History and overview"],["math.IT","Information theory"],["math.KT","K-theory and homology"],["math.LO","Logic"],["math.MG","Metric geometry"],["math.NA","Numerical analysis"],["math.NT","Number theory"],["math.OA","Operator algebras"],["math.OC","Optimization and control"],["math.PR","Probability"],["math.QA","Quantum algebra"],["math.RA","Rings and algebras"],["math.RT","Representation theory"],["math.SG","Symplectic geometry"],["math.SP","Spectral theory"],["math.ST","Statistics theory"]]],["Computer science",[["cs.AI","Artificial intelligence"],["cs.AR","Hardware architecture"],["cs.CC","Computational complexity"],["cs.CE","Computational engineering, finance and science"],["cs.CG","Computational geometry"],["cs.CL","Computation and language"],["cs.CR","Cryptography and security"],["cs.CV","Computer vision and pattern recognition"],["cs.CY","Computers and society"],["cs.DB","Databases"],["cs.DC","Distributed, parallel and cluster computing"],["cs.DL","Digital libraries"],["cs.DM","Discrete mathematics"],["cs.DS","Data structures and algorithms"],["cs.ET","Emerging technologies"],["cs.FL","Formal languages and automata theory"],["cs.GL","General literature"],["cs.GR","Graphics"],["cs.GT","Computer science and game theory"],["cs.HC","Human-computer interaction"],["cs.IR","Information retrieval"],["cs.IT","Information theory"],["cs.LG","Machine learning"],["cs.LO","Logic in computer science"],["cs.MA","Multiagent systems"],["cs.MM","Multimedia"],["cs.MS","Mathematical software"],["cs.NA","Numerical analysis"],["cs.NE","Neural and evolutionary computing"],["cs.NI","Networking and internet architecture"],["cs.OH","Other computer science"],["cs.OS","Operating systems"],["cs.PF","Performance"],["cs.PL","Programming languages"],["cs.RO","Robotics"],["cs.SC","Symbolic computation"],["cs.SD","Sound"],["cs.SE","Software engineering"],["cs.SI","Social and information networks"],["cs.SY","Systems and control"]]],["Quantitative biology",[["q-bio.BM","Biomolecules"],["q-bio.CB","Cell behavior"],["q-bio.GN","Genomics"],["q-bio.MN","Molecular networks"],["q-bio.NC","Neurons and cognition"],["q-bio.OT","Other quantitative biology"],["q-bio.PE","Populations and evolution"],["q-bio.QM","Quantitative methods"],["q-bio.SC","Subcellular processes"],["q-bio.TO","Tissues and organs"]]],["Quantitative finance",[["q-fin.CP","Computational finance"],["q-fin.EC","Economics"],["q-fin.GN","General finance"],["q-fin.MF","Mathematical finance"],["q-fin.PM","Portfolio management"],["q-fin.PR","Pricing of securities"],["q-fin.RM","Risk management"],["q-fin.ST","Statistical finance"],["q-fin.TR","Trading and market microstructure"]]],["Statistics",[["stat.AP","Applications"],["stat.CO","Computation"],["stat.ME","Methodology"],["stat.ML","Machine learning"],["stat.OT","Other statistics"],["stat.TH","Statistics theory"]]],["Electrical engineering and systems science",[["eess.AS","Audio and speech processing"],["eess.IV","Image and video processing"],["eess.SP","Signal processing"],["eess.SY","Systems and control"]]],["Economics",[["econ.EM","Econometrics"],["econ.GN","General economics"],["econ.TH","Theoretical economics"]]]];
  var CATNAME = {};
  CATEGORIES.forEach(function (g) { g[1].forEach(function (c) { CATNAME[c[0]] = c[1]; }); });
  function panelHTML() {
    var off = offlineSet(), n = Object.keys(off).length, mb = 0;
    Object.keys(off).forEach(function (k) { mb += off[k].bytes || 0; });
    var cfg = config || {categories: ["hep-th"], crossLists: false};
    var h = "";
    if (src && src.writeJSON) {
      var chosen = {};
      cfg.categories.forEach(function (c) { chosen[c] = 1; });
      var check = (theme.icons || {}).check || "";
      h += '<p class="menu-head">New papers</p><div class="app-chips" id="cat-chips"></div>' +
        '<div class="app-picker" id="cat-picker" aria-hidden="true"><input class="app-field" id="cat-q" type="search" placeholder="Search arXiv categories" ' +
        'aria-label="Search arXiv categories" autocomplete="off" autocapitalize="off" spellcheck="false"><div class="app-picker-list" role="group" aria-label="arXiv categories">' +
        CATEGORIES.map(function (g) {
          return '<p class="app-group">' + esc(g[0]) + "</p>" + g[1].map(function (c) {
            return '<button type="button" class="opt" role="checkbox" data-cat="' + esc(c[0]) + '" aria-checked="' + !!chosen[c[0]] +
              '" data-hay="' + esc((c[0] + " " + c[1]).toLowerCase()) + '"><span class="opt-name">' + esc(c[0]) + '</span><span class="opt-note">' +
              esc(c[1]) + '</span><span class="opt-check">' + check + "</span></button>";
          }).join("");
        }).join("") + "</div></div>" +
        '<div class="seg" role="radiogroup" aria-label="Cross-lists"><span class="sel-ind" aria-hidden="true"></span>' +
        '<button type="button" class="seg-btn" role="radio" data-cross="0" aria-checked="' + !cfg.crossLists + '"><span>Primary only</span></button>' +
        '<button type="button" class="seg-btn" role="radio" data-cross="1" aria-checked="' + !!cfg.crossLists + '"><span>With cross-lists</span></button></div>' +
        '<p class="app-help app-pad" id="feed-status">Changes are saved as you make them; new papers come every weekday after arXiv&rsquo;s announcement.</p>';
    }
    h += '<p class="menu-head">Library</p><form class="app-form" id="gh-form"><p class="app-help">' +
      (src && src.kind === "github" ? "Reading " + esc(src.repo) + " on GitHub." : src && src.kind === "site" ? "Reading the papers of this site." : "Not connected yet.") + "</p>" +
      '<input class="app-field" id="gh-repo" aria-label="GitHub repo" autocomplete="off" autocapitalize="off" spellcheck="false" value="' +
      esc(store("repo") || "erezu1/l2m-library") + '">' +
      '<input class="app-field" id="gh-token" type="password" aria-label="Access token" autocomplete="off" placeholder="' +
      (store("token") ? "Access token: saved on this device" : "Access token (github_pat_&hellip;)") + '">' +
      '<p class="app-row"><button type="submit" class="app-pill">Connect</button>' +
      (store("token") ? '<button type="button" class="app-link" id="gh-forget">Forget the token</button>' : "") + "</p></form>" +
      '<p class="menu-head">On this device</p><p class="app-help app-pad">' +
      (n ? n + " paper" + (n > 1 ? "s" : "") + " saved for reading offline, " + (mb / 1e6).toFixed(1) + " MB." :
           "No papers saved offline yet. In the library, tap the download button next to a paper.") + "</p>" +
      (n ? '<p class="app-row app-pad"><button type="button" class="app-pill" id="off-clear">Remove offline copies</button></p>' : "");
    return h;
  }
  var skipPop = false;       // the history step of a panel closed by hand: already handled
  function openPanel(which) {
    var had = panelOpen;
    closePanel(had ? "pop" : "jump");            // from one panel to the other: the same history step
    if (!had) try { if (!(history.state || {}).l2mPanel) history.pushState(Object.assign({}, history.state || {}, {l2mPanel: true}), ""); } catch (e) {}
    var el = shell.querySelector(which === "add" ? "#app-addp" : "#app-settings"), inner = el.querySelector(".menu-inner");
    if (which === "add") {
      inner.innerHTML = '<p class="menu-head">Add a paper</p><form class="app-form" id="add-form">' +
        '<input class="app-field" id="add-id" inputmode="url" placeholder="arXiv number or link, e.g. 2609.28331" aria-label="arXiv number or link" ' +
        'autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<p class="app-help">It is converted on GitHub and appears in your library in a few minutes. Several numbers at once are fine.</p>' +
        '<p class="app-row"><button type="submit" class="app-pill">Add</button></p></form>';
      inner.querySelector("#add-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var ids = inner.querySelector("#add-id").value.split(/[\s,]+/).filter(Boolean);
        if (!ids.length) return;
        closePanel("jump");
        convert(ids);
      });
    } else {
      inner.innerHTML = panelHTML();
      bindPanel(inner);
    }
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
    shell.querySelector("#app-bar").classList.add("menu-open");
    shell.querySelector(which === "add" ? "#app-plus" : "#app-gear").setAttribute("aria-expanded", "true");
    panelOpen = which;
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(inner.querySelectorAll(".seg, .opt-list"), slide);
      var f = inner.querySelector("#add-id");
      if (f) f.focus();
    });
  }
  function closePanel(how) {        // how: "pop" (closed by back), "jump" (something else follows at once)
    if (!panelOpen || !shell) { panelOpen = false; return; }
    try {
      if (how !== "pop" && (history.state || {}).l2mPanel) {
        if (how === "jump") { var st = Object.assign({}, history.state); delete st.l2mPanel; history.replaceState(st, ""); }
        else { skipPop = true; history.back(); }
      }
    } catch (e) {}
    ["#app-settings", "#app-addp"].forEach(function (id) {
      var el = shell.querySelector(id);
      el.classList.remove("open");
      el.setAttribute("aria-hidden", "true");
    });
    shell.querySelector("#app-bar").classList.remove("menu-open");
    shell.querySelector("#app-gear").setAttribute("aria-expanded", "false");
    shell.querySelector("#app-plus").setAttribute("aria-expanded", "false");
    root.classList.remove("l2m-settings-open");
    panelOpen = false;
  }
  function bindPanel(inner) {
    var prefs = window.L2M_prefs ? L2M_prefs() : {};
    var D = theme.defaults || {};
    var want = {"data-font": prefs.font || D.font, "data-size-opt": prefs.size || D.size,
                "data-theme-opt": prefs.theme || D.appearance, "data-tone-opt": prefs.tone || D.tone};
    Object.keys(want).forEach(function (attr) {
      Array.prototype.forEach.call(inner.querySelectorAll("[" + attr + "]"), function (b) {
        b.setAttribute("aria-checked", b.getAttribute(attr) === want[attr] ? "true" : "false");
      });
    });
    inner.addEventListener("click", function (e) {
      var b = e.target.closest("[data-font], [data-size-opt], [data-theme-opt], [data-tone-opt], [data-cross]");
      if (!b) return;
      var group = b.closest(".seg, .opt-list");
      Array.prototype.forEach.call(group.querySelectorAll('[role="radio"]'), function (x) { x.setAttribute("aria-checked", x === b ? "true" : "false"); });
      slide(group);
      if (b.hasAttribute("data-cross")) return;
      var p = window.L2M_prefs ? L2M_prefs() : {};
      if (b.hasAttribute("data-font")) { p.font = b.getAttribute("data-font"); L2M_applyFont(p.font); }
      if (b.hasAttribute("data-size-opt")) { p.size = b.getAttribute("data-size-opt"); L2M_applySize(p.size); }
      if (b.hasAttribute("data-theme-opt")) { p.theme = b.getAttribute("data-theme-opt"); L2M_applyTheme(p.theme); }
      if (b.hasAttribute("data-tone-opt")) { p.tone = b.getAttribute("data-tone-opt"); L2M_applyTone(p.tone); }
      if (window.L2M_savePrefs) L2M_savePrefs(p);
      root.style.setProperty("--l2m-bar-h", shell.querySelector("#app-bar").getBoundingClientRect().height + "px");
      requestAnimationFrame(function () { Array.prototype.forEach.call(inner.querySelectorAll(".seg, .opt-list"), slide); });
    });
    var saveTimer = null;
    function feedChoice() {
      return {categories: Array.prototype.map.call(inner.querySelectorAll('.app-picker [data-cat][aria-checked="true"]'), function (b) { return b.getAttribute("data-cat"); }),
              crossLists: !!inner.querySelector('[data-cross="1"][aria-checked="true"]')};
    }
    function saveFeedSoon() {
      var status = inner.querySelector("#feed-status");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        var next = feedChoice(), cfg = config || {categories: ["hep-th"], crossLists: false};
        if (next.categories.join(",") === cfg.categories.join(",") && next.crossLists === !!cfg.crossLists) return;
        status.textContent = "Saving\u2026";
        src.writeJSON("config.json", next, "Feed: " + next.categories.join(", ") + (next.crossLists ? " with cross-lists" : "")).then(function () {
          config = next;
          return src.run("feed.yml", {});
        }).then(function () { status.textContent = "Saved. The new papers are being fetched again; it takes a minute."; },
                function (err) { status.textContent = "Could not save: " + err.message; });
      }, 1200);
    }
    var chips = inner.querySelector("#cat-chips"), picker = inner.querySelector("#cat-picker");
    function drawChips() {
      if (!chips) return;
      var on = Array.prototype.map.call(inner.querySelectorAll('.app-picker [data-cat][aria-checked="true"]'), function (b) { return b.getAttribute("data-cat"); });
      chips.innerHTML = on.map(function (c) {
        return '<button type="button" class="app-chip" data-chip="' + esc(c) + '" title="' + esc(CATNAME[c] || c) + '" aria-label="Remove ' + esc(c) + '">' +
          esc(c) + '<span aria-hidden="true">&times;</span></button>';
      }).join("") + '<button type="button" class="app-chip app-chip-add" id="cat-add" aria-expanded="' + picker.classList.contains("open") + '">' +
        (picker.classList.contains("open") ? "Done" : "+ Add") + "</button>";
    }
    function pickerOpen(open) {
      picker.classList.toggle("open", open);
      picker.setAttribute("aria-hidden", open ? "false" : "true");
      drawChips();
      if (open) setTimeout(function () { inner.querySelector("#cat-q").focus({preventScroll: true}); }, 280);
    }
    if (chips) {
      drawChips();
      chips.addEventListener("click", function (e) {
        var add = e.target.closest("#cat-add"), chip = e.target.closest("[data-chip]");
        if (add) { pickerOpen(!picker.classList.contains("open")); return; }
        if (!chip) return;
        if (inner.querySelectorAll('.app-picker [data-cat][aria-checked="true"]').length === 1) { toast("Keep at least one category."); return; }
        var b = inner.querySelector('.app-picker [data-cat="' + chip.getAttribute("data-chip") + '"]');
        if (b) b.setAttribute("aria-checked", "false");
        drawChips();
        saveFeedSoon();
      });
      inner.querySelector("#cat-q").addEventListener("input", function (e) {
        var q = e.target.value.trim().toLowerCase();
        Array.prototype.forEach.call(picker.querySelectorAll("[data-cat]"), function (b) { b.hidden = !!q && b.getAttribute("data-hay").indexOf(q) < 0; });
        Array.prototype.forEach.call(picker.querySelectorAll(".app-group"), function (g) {
          var n = g.nextElementSibling, any = false;
          while (n && !n.classList.contains("app-group")) { if (!n.hidden) any = true; n = n.nextElementSibling; }
          g.hidden = !any;
        });
      });
    }
    Array.prototype.forEach.call(inner.querySelectorAll(".app-picker [data-cat]"), function (b) {
      b.addEventListener("click", function () {
        var on = b.getAttribute("aria-checked") !== "true";
        if (!on && inner.querySelectorAll('.app-picker [data-cat][aria-checked="true"]').length === 1) { toast("Keep at least one category."); return; }
        b.setAttribute("aria-checked", on ? "true" : "false");
        drawChips();
        saveFeedSoon();
      });
    });
    Array.prototype.forEach.call(inner.querySelectorAll("[data-cross]"), function (b) { b.addEventListener("click", saveFeedSoon); });
    inner.querySelector("#gh-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var repo = inner.querySelector("#gh-repo").value.trim(), tok = inner.querySelector("#gh-token").value.trim() || store("token");
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast("The repo is owner/name, for example erezu1/l2m-library."); return; }
      if (!tok) { toast("Paste the access token first."); return; }
      var s = githubSource(repo, tok);
      s.json("library.json").catch(function (err) { if (/not found/.test(err.message)) return {papers: []}; throw err; }).then(function () {
        store("repo", repo); store("token", tok);
        src = s;
        toast("Connected to " + esc(repo) + ".");
        closePanel("jump");
        load().then(function () { go("library"); });
      }, function (err) { toast("Could not connect: " + esc(err.message), 7000); });
    });
    var fg = inner.querySelector("#gh-forget");
    if (fg) fg.addEventListener("click", function () {
      store("token", null);
      if (src && src.kind === "github") src = null;
      toast("The token is removed from this device.");
      closePanel();
      show(current);
    });
    var oc = inner.querySelector("#off-clear");
    if (oc) oc.addEventListener("click", function () {
      (window.caches ? caches.delete(OFFLINE_CACHE) : Promise.resolve()).then(function () {
        store("offline", {}); closePanel(); toast("Offline copies removed."); show(current);
      });
    });
  }
  document.addEventListener("click", function (e) {
    // a tap outside the open panel closes it (a control that was just redrawn is not "outside")
    if (panelOpen && shell && e.target.isConnected && !shell.contains(e.target)) closePanel();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanel(); });

  var mathIn = false;
  function feedMath() {                   // the glyphs and styles of the formulas drawn into feed.json
    if (mathIn || !feed || !feed.math || !feed.math.cache) return;
    mathIn = true;
    var st = document.createElement("style");
    st.textContent = feed.math.css || "";
    document.head.appendChild(st);
    var d = document.createElement("div");
    d.innerHTML = feed.math.cache;
    if (d.firstChild) document.body.appendChild(d.firstChild);
  }

  var ORDER = ["app:library", "app:new"];
  function track() {
    var t = main.querySelector(".app-track");
    if (!t) {
      main.innerHTML = '<div class="app-track">' + ORDER.map(function (k) {
        return '<section class="app-pane" data-pane="' + k + '"><div class="app-pane-in"></div></section>';
      }).join("") + "</div>";
      t = main.querySelector(".app-track");
    }
    return t;
  }
  function pane(k) { return track().querySelector('[data-pane="' + k + '"] .app-pane-in'); }
  function place(k, animate) {
    var t = track();
    t.style.transition = animate ? "transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)" : "none";
    t.style.transform = "translateX(" + (-50 * Math.max(0, ORDER.indexOf(k))) + "%)";
  }
  function showLists(k, animate) {
    var had = !!main.querySelector(".app-track");
    buildShell();
    root.classList.add("l2m-app-lists");
    setTab(k.slice(4));
    document.title = k === "app:new" ? "New papers" : (lib && lib.name) || "Papers";
    if (!had || !animate) {
      if (src) { renderLibrary(); renderNew(); } else showConnect();
    }
    place(k, animate && had);
  }
  function renderLibrary() {
    var box = pane("app:library");
    feedMath();
    var rm = removing(), I = theme.icons || {};
    var papers = ((lib && lib.papers) || []).filter(function (x) { return !rm[keyOf(x)]; }), p = pending(), off = offlineSet();
    var waiting = Object.keys(p).filter(function (k) {
      return !papers.some(function (x) { return keyOf(x) === k && x.converted && Date.parse(x.converted) >= p[k].since - 60000; });
    });
    var items = papers.map(function (x) {
      var k = keyOf(x), meta = [];
      if (x.arxiv) meta.push(esc(x.arxiv.id) + (x.arxiv.primary ? " &middot; " + esc(x.arxiv.primary) : ""));
      else if (x.kind === "draft") meta.push("your draft");
      if (x.status === "failed") meta.push('<span class="app-bad">could not be converted</span>');
      var hay = (x.title + " " + (x.authors || []).join(" ") + " " + (x.arxiv ? x.arxiv.id : "")).toLowerCase();
      return '<li data-hay="' + esc(hay) + '"><div class="app-lib-row"><a href="?p=' + encodeURIComponent(k) + '" data-p="' + esc(k) + '"><span class="lib-title">' +
        (x.titleHtml || esc(x.title || k)) + '</span><span class="lib-authors">' + esc(authorsLine(x.authors)) + "</span>" +
        (meta.length ? '<span class="lib-meta">' + meta.join(" &middot; ") + "</span>" : "") + "</a>" +
        (window.caches && x.status !== "failed" ? '<button type="button" class="bar-btn app-offline" data-offline="' + esc(k) + '" aria-pressed="' + !!off[k] +
          '" aria-label="' + (off[k] ? "Saved on this device; tap to remove the copy" : "Keep offline") + '">' + (off[k] ? I.offlineDone || "&#10003;" : I.offline || "&darr;") + "</button>" : "") +
        (src && src.run ? '<button type="button" class="bar-btn app-trash" data-remove="' + esc(k) + '" aria-label="Remove from the library">' + (I.trash || "Remove") + "</button>" : "") +
        '</div><p class="app-confirm" hidden>Remove it from the library?<button type="button" class="app-pill" data-remove-yes="' + esc(k) + '">Remove</button>' +
        '<button type="button" class="app-link" data-remove-no>Keep</button></p></li>';
    }).join("");
    box.innerHTML = (waiting.length ? '<p class="app-note">Converting ' + waiting.map(function (k) { return esc(p[k].id); }).join(", ") + "&hellip;</p>" : "") +
      (papers.length ? '<ol class="l2m-library" id="lib-list">' + items + "</ol>" :
                       '<p class="app-note">No papers yet.' + (src && src.run ? ' Find some in <a href="?v=new" data-go="new">New</a>.' : "") + "</p>");
    Array.prototype.forEach.call(box.querySelectorAll("[data-remove]"), function (b) {
      b.addEventListener("click", function () {
        var c = b.closest("li").querySelector(".app-confirm");
        c.hidden = !c.hidden;
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-offline]"), function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-offline"), on = b.getAttribute("aria-pressed") !== "true";
        var entry = ((lib && lib.papers) || []).filter(function (x) { return keyOf(x) === k; })[0];
        b.disabled = true;
        b.classList.add("app-working");
        keepOffline(entry, on).then(function () {
          toast(on ? "Saved <em>" + esc(entry.title) + "</em> for reading offline." : "The offline copy is removed.");
        }, function (e) { toast("Could not save it: " + esc(e.message), 7000); }).then(function () {
          if (isPage(current)) renderLibrary();
        });
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-remove-no]"), function (b) {
      b.addEventListener("click", function () { b.closest(".app-confirm").hidden = true; });
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-remove-yes]"), function (b) {
      b.addEventListener("click", function () { removePaper(b.getAttribute("data-remove-yes"), b); });
    });
    filterLibrary();
  }

  function renderNew() {
    var box = pane("app:new");
    feedMath();
    var have = {}, p = pending();
    ((lib && lib.papers) || []).forEach(function (x) { if (x.arxiv) have[arxivKey(x.arxiv.id)] = x; });
    var cats = (feed && feed.categories) || (config && config.categories) || ["hep-th"];
    var byDay = {};
    ((feed && feed.items) || []).forEach(function (i) { (byDay[i.announced] = byDay[i.announced] || []).push(i); });
    var days = Object.keys(byDay).sort().reverse().map(function (d) {
      var label = new Date(d + "T12:00:00Z").toLocaleDateString(undefined, {weekday: "long", day: "numeric", month: "long"});
      return '<p class="app-day">' + esc(label) + '</p><ol class="l2m-library app-feed">' + byDay[d].map(function (i) {
        var k = arxivKey(i.id), got = have[k] && have[k].status === "ok", act;
        var Ic = theme.icons || {};
        if (got) act = '<a class="bar-btn app-act" href="?p=' + encodeURIComponent(k) + '" data-p="' + esc(k) + '" aria-label="Open">' + (Ic.open || "&rsaquo;") + "</a>";
        else if (p[k]) act = '<span class="bar-btn app-act app-working" role="img" aria-label="Converting">' + (Ic.add || "+") + "</span>";
        else if (src && src.run) act = '<button type="button" class="bar-btn app-act app-add-btn" data-convert="' + esc(i.id) + '" aria-label="Add to the library">' + (Ic.add || "+") + "</button>";
        else act = '<a class="bar-btn app-act" href="https://arxiv.org/abs/' + esc(i.id) + '" target="_blank" rel="noopener" aria-label="On arXiv">' + (Ic.external || "&nearr;") + "</a>";
        var t = i.titleHtml || esc(i.title);
        return '<li class="app-paper"><div class="app-paper-head"><div class="app-paper-text">' +
          (got ? '<a class="lib-title" href="?p=' + encodeURIComponent(k) + '" data-p="' + esc(k) + '">' + t + "</a>" : '<span class="lib-title">' + t + "</span>") +
          '<span class="lib-authors">' + esc(authorsLine(i.authors)) + '</span><span class="lib-meta">' + esc(i.id) +
          (i.type === "cross" ? " &middot; cross-list from " : " &middot; ") + esc(i.category) + "</span></div>" +
          '<div class="app-paper-act">' + act + "</div></div>" +
          '<p class="app-abs">' + (i.abstractHtml || esc(i.abstract)) + "</p></li>";
      }).join("") + "</ol>";
    }).join("");
    var meta = esc(cats.join(", ")) + (feed && feed.crossLists ? ", with cross-lists" : "") +
      (feed && feed.updated ? " &middot; updated " + esc(new Date(feed.updated).toLocaleString(undefined, {weekday: "short", hour: "2-digit", minute: "2-digit"})) : "") +
      (src && src.run ? ' &middot; <button type="button" class="app-link" id="feed-now">refresh</button>' : "");
    box.innerHTML = '<p class="app-note app-small">' + meta + "</p>" +
      (days || '<p class="app-note">' + (feed ? "No new papers in the last few days." : "The new papers have not been fetched yet.") + "</p>");
    // abstracts: the first lines, fading out; "More" slides the rest open
    var CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6.5 9.5 12 15l5.5-5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    Array.prototype.forEach.call(box.querySelectorAll(".app-abs"), function (p) {
      if (p.scrollHeight <= p.clientHeight + 2) { p.classList.add("short"); return; }
      var b = document.createElement("button");
      b.type = "button";
      b.className = "app-toggle";
      b.setAttribute("aria-expanded", "false");
      b.innerHTML = "<span>More</span>" + CHEVRON;
      function toggle() {
        var open = !p.classList.contains("open");
        p.style.maxHeight = p.scrollHeight + "px";            // from the height it has now...
        if (open) {
          p.classList.add("open");
          p.addEventListener("transitionend", function done(e) {
            if (e.propertyName !== "max-height") return;
            p.removeEventListener("transitionend", done);
            if (p.classList.contains("open")) p.style.maxHeight = "none";
          });
        } else {
          void p.offsetHeight;                                 // ...back to its first lines
          p.classList.remove("open");
          p.style.maxHeight = "";
        }
        b.setAttribute("aria-expanded", open ? "true" : "false");
        b.firstChild.textContent = open ? "Less" : "More";
      }
      b.addEventListener("click", toggle);
      p.addEventListener("click", function () {
        if (window.getSelection && String(window.getSelection()).length) return;   // selecting text, not tapping
        toggle();
      });
      p.parentNode.insertBefore(b, p.nextSibling);
    });
    var r = document.getElementById("feed-now");
    if (r) r.addEventListener("click", function () {
      src.run("feed.yml", {}).then(function () { toast("Fetching the new papers. Come back in a minute."); },
                                   function (e) { toast("Could not start it: " + esc(e.message)); });
    });
  }

  function showConnect() {
    pane("app:new").innerHTML = '<p class="app-note">New papers appear here once the library is connected.</p>';
    pane("app:library").innerHTML = '<p class="app-note">Your papers are kept in a private GitHub repo. To read them here, open the settings ' +
      '(the button at the top right) and paste an access token under <em>Library</em>.</p>' +
      '<p class="app-row"><button type="button" class="app-pill" id="open-settings">Open settings</button></p>';
    document.getElementById("open-settings").addEventListener("click", function (e) { e.stopPropagation(); openPanel("settings"); });
  }

  function showPaper(key) {
    dropShell();
    var entry = ((lib && lib.papers) || []).filter(function (x) { return keyOf(x) === key; })[0] || {key: key, path: "papers/" + key};
    if (entry.status === "failed") {
      buildShell(); setTab("library");
      main.innerHTML = '<p class="app-note"><strong>' + esc(entry.title || key) + "</strong> could not be converted.</p>" +
        '<pre class="app-log">' + esc(entry.error || "") + "</pre>" +
        (entry.arxiv ? '<p class="app-row"><a class="app-pill" href="https://arxiv.org/abs/' + esc(entry.arxiv.id) + '" target="_blank" rel="noopener">Open on arXiv</a></p>' : "");
      return;
    }
    main.innerHTML = '<p class="app-note">Loading&hellip;</p>';
    var docP = paperFile(key, entry, "paper.json").then(function (b) { return b.text(); }).then(JSON.parse);
    var mathP = paperFile(key, entry, "math.json").then(function (b) { return b.text(); }).then(JSON.parse).catch(function () { return null; });
    docP.then(function (doc) {
      return mathP.then(function (cache) {
        if (current !== key) return;
        doc.kicker = null;                  // no label above the title in the app
        var actions = [];
        if (entry.arxiv) {
          actions.push({label: "arXiv", href: "https://arxiv.org/abs/" + entry.arxiv.id});
          actions.push({label: "PDF", href: "https://arxiv.org/pdf/" + entry.arxiv.id});
        }
        view = L2M_open({doc: doc, theme: Object.assign({}, theme, {titleblock: []}), cache: cache, key: key, kicker: null,
          base: src.kind === "site" ? (entry.path || "papers/" + key) + "/" : "",
          image: src.kind === "site" && !isOffline(key) ? null : function (name) {
            return paperFile(key, entry, "images/" + name).then(function (b) { var u = URL.createObjectURL(b); urls.push(u); return u; });
          },
          mathjax: lib && lib.mathjax, onLibrary: function () { go("library"); }, libraryHref: "./", actions: actions});
      });
    }).catch(function (e) {
      buildShell(); setTab("library");
      main.innerHTML = '<p class="app-note">Cannot open this paper: ' + esc(e.message) + "</p>";
    });
  }

  // ---------------------------------------------------------------- moving around
  // A history entry names what it shows: a paper's key, or "app:library" / "app:new".
  function isPage(k) { return !k || String(k).indexOf("app:") === 0; }
  function wanted() {
    var q = new URLSearchParams(location.search);
    var p = q.get("p") || (q.get("doc") || "").replace(/^papers\//, "").replace(/\/(paper\.json)?$/, "");
    if (p) return p;
    if (q.get("v") === "new") return "app:new";
    return (history.state || {}).l2mPaper || "app:library";     // an artifact's address cannot carry ?p
  }
  function close(save) {
    if (view) { view.close(save); view = null; }
    urls.forEach(function (u) { URL.revokeObjectURL(u); });
    urls = [];
  }
  function show(k, save) {
    close(save);
    current = k;
    if (!isPage(k)) root.classList.remove("l2m-app-lists");
    if (isPage(k)) {
      showLists(k === "app:new" ? k : "app:library", listMove);
      listMove = false;
      return;
    }
    window.scrollTo(0, 0);                  // the viewer puts a paper back where it was left
    if (!/^[\w.~-]+$/.test(k)) { buildShell(); setTab("library"); main.innerHTML = '<p class="app-note">That is not a paper in this library.</p>'; return; }
    if (!src) { current = "app:library"; showLists(current, false); return; }
    showPaper(k);
  }
  var listMove = false;                      // the next show() moves between the two lists
  function refresh() { if (isPage(current)) showLists(current === "app:new" ? current : "app:library", false); }
  function go(pageName, key) {
    closePanel("jump");
    close();                                // saves the reading place in the entry being left
    var k = key || "app:" + pageName;
    if (k === current) return;
    listMove = isPage(current) && isPage(k);
    var url = key ? "?p=" + encodeURIComponent(key) : pageName === "new" ? "?v=new" : location.pathname;
    try { history.pushState({l2mPaper: k}, "", url); } catch (e) {}
    show(k);
  }
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("[data-p], [data-go], [data-convert]");
    if (!a) return;
    e.preventDefault();
    if (a.hasAttribute("data-convert")) { a.disabled = true; a.classList.add("app-working"); convert([a.getAttribute("data-convert")]); return; }
    if (a.hasAttribute("data-p")) go(null, a.getAttribute("data-p"));
    else go(a.getAttribute("data-go"));
  });
  window.addEventListener("popstate", function (e) {
    if (skipPop) { skipPop = false; return; }
    if (panelOpen) { closePanel("pop"); return; }       // back closes the open panel, nothing else
    var k = (e.state && e.state.l2mPaper) || wanted();
    if (k === current) return;              // a step inside the open paper: nav.js handles it
    listMove = isPage(current) && isPage(k);
    show(k, false);                         // the entry has already changed: nothing to save into it
  });
  // swiping sideways on Library / New: the strip with both lists follows the finger
  var sw = null;
  main.addEventListener("touchstart", function (e) {
    var t = main.querySelector(".app-track");
    if (!t || !isPage(current) || panelOpen || e.touches.length !== 1) { sw = null; return; }
    sw = {x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), dir: null, track: t,
          i: Math.max(0, ORDER.indexOf(current)), w: main.clientWidth};
  }, {passive: true});
  main.addEventListener("touchmove", function (e) {
    if (!sw) return;
    var dx = e.touches[0].clientX - sw.x, dy = e.touches[0].clientY - sw.y;
    if (!sw.dir && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) sw.dir = Math.abs(dx) > 1.2 * Math.abs(dy) ? "x" : "y";
    if (sw.dir !== "x") return;
    e.preventDefault();
    var next = sw.i - Math.sign(dx);
    if (next < 0 || next >= ORDER.length) dx *= 0.25;   // nothing that way: it only gives a little
    sw.track.style.transition = "none";
    sw.track.style.transform = "translateX(" + (-sw.i * sw.w + dx) + "px)";
  }, {passive: false});
  function endSwipe(e) {
    if (!sw || sw.dir !== "x") { sw = null; return; }
    var dx = (e && e.changedTouches ? e.changedTouches[0].clientX : sw.x) - sw.x, fast = Date.now() - sw.t < 300;
    var to = sw.i - Math.sign(dx), s0 = sw;
    sw = null;
    if (to >= 0 && to < ORDER.length && (Math.abs(dx) > s0.w * 0.25 || (fast && Math.abs(dx) > 30))) {
      s0.track.style.transition = "transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      s0.track.style.transform = "translateX(" + (-to * s0.w) + "px)";
      go(ORDER[to].slice(4));
    } else {
      place(current, true);
    }
  }
  main.addEventListener("touchend", endSwipe);
  main.addEventListener("touchcancel", endSwipe);

  window.addEventListener("resize", function () {
    if (shell) { root.style.setProperty("--l2m-bar-h", shell.querySelector("#app-bar").getBoundingClientRect().height + "px"); slide(shell.querySelector(".app-tabs")); }
  });

  // ---------------------------------------------------------------- start
  function load() {
    if (!src) return Promise.resolve();
    return Promise.all([
      getJSON("library.json", true).catch(function () { return {papers: []}; }),
      getJSON("feed.json", true).catch(function () { return null; }),
      getJSON("config.json", true).catch(function () { return null; })
    ]).then(function (r) { lib = r[0]; feed = r[1]; config = r[2]; });
  }
  var themeP = theme ? Promise.resolve(theme) : fetch("theme.json").then(function (r) { return r.json(); });
  var siteP = fetch("library.json", {cache: "no-cache"}).then(function (r) { return r.ok; }, function () { return false; });
  Promise.all([themeP, siteP]).then(function (r) {
    theme = r[0];
    if (window.L2M_initPrefs) L2M_initPrefs(theme);
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    if (r[1]) store("site", location.pathname);
    // offline, a site is still a site: its lists and saved papers come from this device
    if (r[1] || store("site") === location.pathname) src = staticSource();
    else if (store("repo") && store("token")) src = githubSource(store("repo"), store("token"));
    return load();
  }).then(function () {
    var k = wanted();
    try { history.replaceState(Object.assign({}, history.state || {}, {l2mPaper: k}), ""); } catch (e) {}
    show(k);
    watch();
  }).catch(function (e) {
    main.innerHTML = '<p class="app-note">Cannot start: ' + esc(e.message || e) + "</p>";
  });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
