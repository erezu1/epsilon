// latex2mobile app: your library, new papers in your arXiv categories, reading, settings, offline copies.
//
// Where papers come from:
//   - a static site built by l2m_viewer.py (library.json next to this page), or
//   - the private GitHub repo made for the library (erezu1/l2m-library), read through GitHub's API with a
//     token the reader types into Settings; it is stored on this device only. Converting a paper starts
//     the repo's "convert" workflow; the paper appears in the library a few minutes later.
// Addresses: ./ (library), ?v=new (new papers), ?v=settings, ?p=<key> (a paper, #id for a place in it).
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
  var watching = null;
  function watch() {
    if (watching || !Object.keys(pending()).length) return;
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
        if (changed && current === null) refresh();
        if (!Object.keys(p).length) { clearInterval(watching); watching = null; }
      }).catch(function () {});
    }, 20000);
  }

  // ---------------------------------------------------------------- pages of the app
  function head(active) {
    var tabs = [["library", "Library", "./"], ["new", "New", "?v=new"]].map(function (t) {
      return '<a class="app-tab" href="' + t[2] + '" data-go="' + t[0] + '"' + (active === t[0] ? ' aria-current="page"' : "") + ">" + t[1] + "</a>";
    }).join("");
    var I = (theme && theme.icons) || {};
    return '<header class="app-head"><nav class="app-tabs" aria-label="Sections">' + tabs + "</nav>" +
      '<a class="bar-btn app-gear" href="?v=settings" data-go="settings" aria-label="Settings"' +
      (active === "settings" ? ' aria-current="page"' : "") + ">" + (I.settings || "Settings") + "</a></header>";
  }

  function showLibrary() {
    document.title = (lib && lib.name) || "Papers";
    var papers = (lib && lib.papers) || [];
    var p = pending(), off = offlineSet();
    var waiting = Object.keys(p).filter(function (k) { return !papers.some(function (x) { return keyOf(x) === k && x.converted && Date.parse(x.converted) >= p[k].since - 60000; }); });
    var items = papers.map(function (x) {
      var k = keyOf(x), meta = [];
      if (x.arxiv) meta.push("arXiv:" + esc(x.arxiv.id) + (x.arxiv.primary ? " &middot; " + esc(x.arxiv.primary) : ""));
      else if (x.kind === "draft") meta.push("Draft");
      if (off[k]) meta.push('<span class="app-badge">Saved</span>');
      if (x.status === "failed") meta.push('<span class="app-badge app-bad">Conversion failed</span>');
      var hay = (x.title + " " + (x.authors || []).join(" ") + " " + (x.arxiv ? x.arxiv.id : "")).toLowerCase();
      return '<li data-hay="' + esc(hay) + '"><a href="?p=' + encodeURIComponent(k) + '" data-p="' + esc(k) + '"><span class="lib-title">' +
        esc(x.title || k) + '</span><span class="lib-authors">' + esc(authorsLine(x.authors)) + '</span><span class="lib-meta">' + meta.join(" ") + "</span></a></li>";
    }).join("");
    main.innerHTML = head("library") +
      (waiting.length ? '<p class="app-note">Converting ' + waiting.map(function (k) { return esc(p[k].id); }).join(", ") + "&hellip;</p>" : "") +
      (papers.length ? '<input class="app-input" id="lib-q" type="search" placeholder="Search your papers" aria-label="Search your papers" autocomplete="off">' +
        '<ol class="l2m-library" id="lib-list">' + items + "</ol>" :
        '<p class="app-note">No papers yet. ' + (src.run ? 'Add one from <a href="?v=new" data-go="new">New</a>.' : "") + "</p>");
    var q = document.getElementById("lib-q");
    if (q) q.addEventListener("input", function () {
      var s = q.value.trim().toLowerCase();
      Array.prototype.forEach.call(document.querySelectorAll("#lib-list li"), function (li) {
        li.hidden = !!s && li.getAttribute("data-hay").indexOf(s) < 0;
      });
    });
  }

  function showNew() {
    document.title = "New papers";
    var have = {};
    ((lib && lib.papers) || []).forEach(function (x) { if (x.arxiv) have[arxivKey(x.arxiv.id)] = x; });
    var p = pending();
    var add = '<form class="app-add" id="app-add"><input class="app-input" id="add-id" placeholder="arXiv id or link, e.g. 2609.28331" ' +
      'aria-label="arXiv id or link" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="app-btn" type="submit">Convert</button></form>';
    var body = "";
    if (!feed || !(feed.items || []).length) {
      body = '<p class="app-note">' + (feed ? "No new papers in the last days." : "The feed has not been made yet.") + "</p>";
    } else {
      var byDay = {};
      feed.items.forEach(function (i) { (byDay[i.announced] = byDay[i.announced] || []).push(i); });
      body = Object.keys(byDay).sort().reverse().map(function (d) {
        return '<h2 class="app-day">' + esc(day(d)) + "</h2><ol class=\"app-feed\">" + byDay[d].map(function (i) {
          var k = arxivKey(i.id), got = have[k], btn;
          if (got && got.status === "ok") btn = '<a class="app-btn" href="?p=' + encodeURIComponent(k) + '" data-p="' + esc(k) + '">Open</a>';
          else if (p[k]) btn = '<span class="app-btn app-busy">Converting&hellip;</span>';
          else if (src.run) btn = '<button class="app-btn" type="button" data-convert="' + esc(i.id) + '">Convert</button>';
          else btn = '<a class="app-btn" href="https://arxiv.org/abs/' + esc(i.id) + '" target="_blank" rel="noopener">arXiv</a>';
          return '<li class="app-paper"><div class="app-paper-text"><span class="lib-title">' + esc(i.title) + '</span><span class="lib-authors">' +
            esc(authorsLine(i.authors)) + '</span><span class="lib-meta">' + esc(i.id) + (i.type === "cross" ? " &middot; cross-list from " + esc(i.category) : " &middot; " + esc(i.category)) +
            '</span><details class="app-abs"><summary>Abstract</summary><p>' + esc(i.abstract) + "</p></details></div>" + btn + "</li>";
        }).join("") + "</ol>";
      }).join("");
    }
    main.innerHTML = head("new") + (src.run ? add : "") +
      '<p class="app-note">' + esc(((feed && feed.categories) || (config && config.categories) || ["hep-th"]).join(", ")) +
      (feed && feed.crossLists ? ", with cross-lists" : "") + (feed && feed.updated ? " &middot; updated " + esc(new Date(feed.updated).toLocaleString()) : "") +
      (src.run ? ' &middot; <button class="app-link" type="button" id="feed-now">Refresh now</button>' : "") + "</p>" + body;
    var f = document.getElementById("app-add");
    if (f) f.addEventListener("submit", function (e) { e.preventDefault(); convert(document.getElementById("add-id").value.split(/[\s,]+/)); });
    var r = document.getElementById("feed-now");
    if (r) r.addEventListener("click", function () {
      src.run("feed.yml", {}).then(function () { toast("Fetching the new papers; reload in a minute."); },
                                   function (e) { toast("Could not start it: " + esc(e.message)); });
    });
  }

  function showSettings() {
    document.title = "Settings";
    var off = offlineSet(), n = Object.keys(off).length, mb = 0;
    Object.keys(off).forEach(function (k) { mb += off[k].bytes || 0; });
    var cfg = config || {categories: ["hep-th"], crossLists: false};
    main.innerHTML = head("settings") +
      '<section class="app-section"><h2 class="app-h">Library</h2>' +
      '<p class="app-note">' + (src && src.kind === "github" ? "Reading " + esc(src.repo) + " on GitHub." : src && src.kind === "site" ? "Reading the papers of this site." : "Not connected.") + "</p>" +
      '<form id="gh-form" class="app-form"><label for="gh-repo">GitHub repo</label><input class="app-input" id="gh-repo" autocomplete="off" autocapitalize="off" spellcheck="false" value="' +
      esc(store("repo") || "erezu1/l2m-library") + '"><label for="gh-token">Access token</label><input class="app-input" id="gh-token" type="password" autocomplete="off" placeholder="' +
      (store("token") ? "saved on this device" : "github_pat_...") + '"><p class="app-help">A fine-grained token for this one repo, with <em>Contents: read and write</em> and <em>Actions: read and write</em>. It is kept on this device only.</p>' +
      '<div class="app-row"><button class="app-btn" type="submit">Save and connect</button>' + (store("token") ? '<button class="app-link" type="button" id="gh-forget">Forget the token</button>' : "") + "</div></form></section>" +
      (src && src.writeJSON ? '<section class="app-section"><h2 class="app-h">New papers</h2><form id="feed-form" class="app-form">' +
        '<label for="feed-cats">arXiv categories</label><input class="app-input" id="feed-cats" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(cfg.categories.join(", ")) + '">' +
        '<label class="app-check"><input type="checkbox" id="feed-cross"' + (cfg.crossLists ? " checked" : "") + '> Include cross-lists</label>' +
        '<p class="app-help">The feed is refreshed every weekday after arXiv\'s announcement.</p><div class="app-row"><button class="app-btn" type="submit">Save</button></div></form></section>' : "") +
      '<section class="app-section"><h2 class="app-h">On this device</h2><p class="app-note">' + (n ? n + " paper" + (n > 1 ? "s" : "") + " saved for reading offline, " + (mb / 1e6).toFixed(1) + " MB." : "No papers saved for offline reading. Open a paper and tap <em>Keep offline</em>.") + "</p>" +
      (n ? '<div class="app-row"><button class="app-link" type="button" id="off-clear">Remove all offline copies</button></div>' : "") + "</section>";

    document.getElementById("gh-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var repo = document.getElementById("gh-repo").value.trim(), tok = document.getElementById("gh-token").value.trim() || store("token");
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast("The repo is owner/name, e.g. erezu1/l2m-library."); return; }
      if (!tok) { toast("Paste the access token first."); return; }
      var s = githubSource(repo, tok);
      s.json("library.json").catch(function (err) { if (/not found/.test(err.message)) return {papers: []}; throw err; }).then(function () {
        store("repo", repo); store("token", tok);
        src = s;
        toast("Connected to " + esc(repo) + ".");
        load().then(function () { go("library"); });
      }, function (err) { toast("Could not connect: " + esc(err.message), 7000); });
    });
    var fg = document.getElementById("gh-forget");
    if (fg) fg.addEventListener("click", function () { store("token", null); toast("The token is removed from this device."); src = null; showSettings(); });
    var ff = document.getElementById("feed-form");
    if (ff) ff.addEventListener("submit", function (e) {
      e.preventDefault();
      var cats = document.getElementById("feed-cats").value.split(/[\s,]+/).filter(Boolean);
      if (!cats.length || cats.some(function (c) { return !/^[a-z-]+(\.[A-Za-z-]+)?$/.test(c); })) { toast("Categories look like hep-th, math-ph, cond-mat.str-el."); return; }
      var next = {categories: cats, crossLists: document.getElementById("feed-cross").checked};
      src.writeJSON("config.json", next, "Feed: " + cats.join(", ") + (next.crossLists ? " with cross-lists" : "")).then(function () {
        config = next;
        return src.run("feed.yml", {});
      }).then(function () { toast("Saved. The feed is being refreshed; it takes a minute."); },
              function (err) { toast("Could not save: " + esc(err.message), 7000); });
    });
    var oc = document.getElementById("off-clear");
    if (oc) oc.addEventListener("click", function () {
      (window.caches ? caches.delete(OFFLINE_CACHE) : Promise.resolve()).then(function () { store("offline", {}); showSettings(); });
    });
  }

  function showConnect() {
    document.title = "Papers";
    main.innerHTML = head("library") + '<p class="app-note">This app reads your papers from the private GitHub repo made for them. ' +
      'Open <a href="?v=settings" data-go="settings">Settings</a> and paste an access token for it.</p>';
  }

  function showPaper(key) {
    var entry = ((lib && lib.papers) || []).filter(function (x) { return keyOf(x) === key; })[0] || {key: key, path: "papers/" + key};
    if (entry.status === "failed") {
      main.innerHTML = head("library") + '<section class="app-section"><h2 class="app-h">' + esc(entry.title || key) + "</h2>" +
        '<p class="app-note">This paper could not be converted.</p><pre class="app-log">' + esc(entry.error || "") + "</pre>" +
        (entry.arxiv ? '<p><a class="app-btn" href="https://arxiv.org/abs/' + esc(entry.arxiv.id) + '" target="_blank" rel="noopener">Open on arXiv</a></p>' : "") + "</section>";
      return;
    }
    main.innerHTML = '<p class="app-note">Loading&hellip;</p>';
    var docP = paperFile(key, entry, "paper.json").then(function (b) { return b.text(); }).then(JSON.parse);
    var mathP = paperFile(key, entry, "math.json").then(function (b) { return b.text(); }).then(JSON.parse).catch(function () { return null; });
    docP.then(function (doc) {
      return mathP.then(function (cache) {
        if (current !== key) return;
        var actions = [];
        if (entry.arxiv) {
          actions.push({label: "arXiv", href: "https://arxiv.org/abs/" + entry.arxiv.id});
          actions.push({label: "PDF", href: "https://arxiv.org/pdf/" + entry.arxiv.id});
        }
        if (window.caches) actions.push({label: isOffline(key) ? "Saved offline" : "Keep offline", pressed: isOffline(key), onClick: function (b) {
          var on = !isOffline(key);
          b.disabled = true;
          b.textContent = on ? "Saving\u2026" : "Removing\u2026";
          keepOffline(entry, on).then(function () {
            b.textContent = on ? "Saved offline" : "Keep offline";
            b.setAttribute("aria-pressed", on ? "true" : "false");
          }, function (e) { toast("Could not save it: " + esc(e.message)); b.textContent = "Keep offline"; })
            .then(function () { b.disabled = false; });
        }});
        view = L2M_open({doc: doc, theme: theme, cache: cache, key: key, kicker: null,
          base: src.kind === "site" ? (entry.path || "papers/" + key) + "/" : "",
          image: src.kind === "site" && !isOffline(key) ? null : function (name) {
            return paperFile(key, entry, "images/" + name).then(function (b) { var u = URL.createObjectURL(b); urls.push(u); return u; });
          },
          mathjax: lib && lib.mathjax, onLibrary: function () { go("library"); }, libraryHref: "./", actions: actions});
      });
    }).catch(function (e) {
      main.innerHTML = head("library") + '<p class="app-note">Cannot open this paper: ' + esc(e.message) + "</p>";
    });
  }

  // ---------------------------------------------------------------- moving around
  function wanted() {
    var q = new URLSearchParams(location.search);
    var p = q.get("p") || (q.get("doc") || "").replace(/^papers\//, "").replace(/\/(paper\.json)?$/, "");
    if (p) return {paper: p};
    var st = history.state || {};
    if (st.l2mPaper) return {paper: st.l2mPaper};         // an artifact's address cannot carry ?p
    return {page: q.get("v") || st.l2mPage || "library"};
  }
  function show(w) {
    if (view) { view.close(); view = null; }
    urls.forEach(function (u) { URL.revokeObjectURL(u); });
    urls = [];
    current = w.paper || null;
    if (w.paper) {
      if (!/^[\w.~-]+$/.test(w.paper)) { main.innerHTML = head("library") + '<p class="app-note">That is not a paper in this library.</p>'; return; }
      if (!src) { showConnect(); return; }
      showPaper(w.paper);
      return;
    }
    window.scrollTo(0, (history.state || {}).l2mY || 0);
    if (w.page === "settings") showSettings();
    else if (!src) showConnect();
    else if (w.page === "new") showNew();
    else showLibrary();
  }
  function refresh() { if (current === null) show(wanted()); }
  function go(page, key) {
    try { history.replaceState(Object.assign({}, history.state || {}, {l2mY: window.pageYOffset}), ""); } catch (e) {}
    var url = key ? "?p=" + encodeURIComponent(key) : page === "library" ? location.pathname : "?v=" + page;
    try { history.pushState(key ? {l2mPaper: key} : {l2mPage: page}, "", url); } catch (e) {}
    window.scrollTo(0, 0);
    show(key ? {paper: key} : {page: page});
  }
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("[data-p], [data-go], [data-convert]");
    if (!a) return;
    e.preventDefault();
    if (a.hasAttribute("data-convert")) { a.disabled = true; a.textContent = "Starting\u2026"; convert([a.getAttribute("data-convert")]); return; }
    if (a.hasAttribute("data-p")) go(null, a.getAttribute("data-p"));
    else go(a.getAttribute("data-go"));
  });
  window.addEventListener("popstate", function (e) {
    var st = e.state || {};
    var w = st.l2mPaper ? {paper: st.l2mPaper} : st.l2mPage ? {page: st.l2mPage} : wanted();
    if (w.paper && w.paper === current) return;       // a step inside the open paper: nav.js handles it
    show(w);
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
    show(wanted());
    watch();
  }).catch(function (e) {
    main.innerHTML = '<p class="app-note">Cannot start: ' + esc(e.message || e) + "</p>";
  });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
