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
  // the loading screen: the app's icon and a progress bar (a fraction, or null while it is not known)
  var SPIN = '<span class="app-spin" aria-hidden="true"></span>';
  // ---------------------------------------------------------------- stand-ins while things load
  // grey, gently pulsing shapes where the text will be: paper rows in the lists, a page in the viewer
  function skelLine(w, cls) { return '<span class="skel' + (cls ? " " + cls : "") + '" style="width:' + w + '%"></span>'; }
  function skelRows(n, seed) {
    var out = "", r = seed || 3;
    function rnd(lo, hi) { r = (r * 9301 + 49297) % 233280; return lo + (hi - lo) * r / 233280; }   // the same shapes every time
    for (var i = 0; i < n; i++) {
      out += '<li class="skel-row">' + skelLine(rnd(78, 96), "skel-title") + (rnd(0, 1) > 0.45 ? skelLine(rnd(35, 70), "skel-title") : "") +
        skelLine(rnd(40, 65), "skel-small") + skelLine(rnd(22, 34), "skel-small") +
        skelLine(100) + skelLine(100) + skelLine(rnd(55, 85)) + "</li>";
    }
    return '<ol class="l2m-library skel-list" aria-hidden="true">' + out + "</ol>";
  }
  function skelPaper() {                      // text in general: the same wherever the paper opens
    var p = function (lines, last) { var h = ""; for (var i = 0; i < lines; i++) h += skelLine(i === lines - 1 ? last : 100); return '<p class="skel-par">' + h + "</p>"; };
    return '<div class="skel-paper" aria-hidden="true">' + p(4, 64) + p(6, 80) + skelLine(44, "skel-h2") + p(5, 52) + p(6, 75) + p(4, 40) + "</div>";
  }
  function skelBar() {                        // the paper's bar as the viewer will draw it, until it does
    dropSkelBar();
    var I = theme.icons || {}, h = document.createElement("div");
    h.innerHTML = '<header class="l2m-bar show skel-bar" id="l2m-skel-bar" aria-hidden="true"><div class="bar-inner">' +
      '<button type="button" class="bar-btn swap" tabindex="-1"><span class="ico ico-back">' + (I.back || "") + '</span><span class="ico ico-close">' +
      (I.close || "") + '</span></button><button type="button" class="bar-title" tabindex="-1"><span class="bar-title-inner"><span class="skel skel-bar-title"></span>' +
      '</span></button><button type="button" class="bar-btn" tabindex="-1">' + (I.settings || "") + "</button></div></header>";
    var bar = h.firstChild;
    document.body.insertBefore(bar, main);
    root.style.setProperty("--l2m-bar-h", bar.getBoundingClientRect().height + "px");   // the page starts where it will
  }
  function dropSkelBar() { var b = document.getElementById("l2m-skel-bar"); if (b) b.remove(); }
  function dropBoot() {                        // the page's own stand-ins (in index.html), shown until the app starts
    ["boot-chrome", "boot-paper-bar"].forEach(function (id) { var b = document.getElementById(id); if (b) b.remove(); });
    root.classList.remove("l2m-boot-paper");
  }
  // INSPIRE (the high-energy physics literature database) knows papers from these archives
  function inspire(id, cats) {
    var hep = (cats || []).some(function (c) { return /^(hep-|gr-qc|nucl-|astro-ph|math-ph)/.test(c || ""); });
    return hep ? "https://inspirehep.net/arxiv/" + encodeURIComponent(String(id).replace(/v\d+$/, "")) : null;
  }
  function inspireLink(id, cats) {
    var u = inspire(id, cats);
    return u ? ' &middot; <a class="app-ext" href="' + u + '" target="_blank" rel="noopener">INSPIRE</a>' : "";
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
      readWithSha: function (path) {
        return call("/contents/" + path).then(function (r) { return r.json(); }).then(function (j) {
          return {data: JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\s/g, ""))))), sha: j.sha};
        });
      },
      putJSON: function (path, data, sha, message, keepalive) {
        return call("/contents/" + path, {method: "PUT", keepalive: !!keepalive, headers: {"Content-Type": "application/json"},
          body: JSON.stringify({message: message, content: b64(JSON.stringify(data) + "\n"), sha: sha || undefined})})
          .then(function (r) { return r.json(); }).then(function (j) { return j.content && j.content.sha; });
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
  var PAPER_CACHE = "l2m-papers-v1", KEEP_PAPERS = 30;
  function paperFile(key, entry, name) {
    var base = entry.path || "papers/" + key, path = base + "/" + name, ver = entry.converted || "";
    if (isOffline(key)) return fromCache(path).then(function (r) { return r.blob(); }, function () { return src.blob(path); });
    if (!window.caches || !ver || src.kind === "site") return src.blob(path);
    var ck = new URL("__papers/" + path + "?v=" + encodeURIComponent(ver), location.href).href;
    return caches.open(PAPER_CACHE).then(function (c) {
      return c.match(ck).then(function (hit) {
        if (hit) return hit.blob();
        return src.blob(path).then(function (b) {
          c.put(ck, new Response(b)).then(function () { notePaper(c, key, base, ver); }, function () {});
          return b;
        });
      });
    }, function () { return src.blob(path); });
  }
  // the papers kept: the last ones opened; an older conversion of a paper goes when a newer one comes
  function notePaper(c, key, base, ver) {
    var kept = store("kept") || {}, was = kept[key];
    kept[key] = {t: Date.now(), base: base, ver: ver};
    var drop = [];
    if (was && was.ver !== ver) drop.push({base: was.base, ver: was.ver});
    var keys = Object.keys(kept).sort(function (a, b) { return kept[b].t - kept[a].t; });
    keys.slice(KEEP_PAPERS).forEach(function (k) { drop.push({base: kept[k].base}); delete kept[k]; });
    store("kept", kept);
    if (!drop.length) return;
    c.keys().then(function (reqs) {
      reqs.forEach(function (r) {
        var u = decodeURIComponent(r.url);
        drop.forEach(function (d) {
          if (u.indexOf("/__papers/" + d.base + "/") >= 0 && (!d.ver || u.indexOf("?v=" + d.ver) >= 0)) c.delete(r);
        });
      });
    });
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

  // ---------------------------------------------------------------- where each paper was left, on all devices
  // A place is kept as "this far into this block": the paragraph, heading or figure at the top of the screen
  // (its number in the paper), and how far into it. The same place on any width and font.
  // Kept on the device, and in reading.json in the library repo for the other devices.
  var reading = store("reading") || {}, readingSha = null, readingDirty = false, readingTimer = null;
  // pinned papers stay at the top of the library: {key: {on, at}}, the latest change winning across devices
  var pins = store("pins") || {};
  function isPinned(k) { return !!(pins[k] && pins[k].on); }
  function togglePin(k) {
    pins[k] = {on: !isPinned(k), at: Date.now()};
    store("pins", pins);
    readingDirty = true;
    clearTimeout(readingTimer);
    readingTimer = setTimeout(pushReading, 1500);
    if (isPage(current)) renderLibrary();
  }
  function mergePins(remote) {
    Object.keys(remote || {}).forEach(function (k) {
      if (!pins[k] || (remote[k].at || 0) > (pins[k].at || 0)) pins[k] = remote[k];
    });
    store("pins", pins);
  }
  function listState() { return JSON.stringify(store("opened") || {}) + JSON.stringify(pins); }
  function barBottom() { var b = document.getElementById("l2m-bar"); return b ? b.getBoundingClientRect().bottom : 0; }
  // the paper's blocks (paragraphs, list items, headings, figures, tables) in the order of its text: the same on
  // every device and at any moment, whatever is laid out yet
  function anchors() {
    return Array.prototype.filter.call(main.querySelectorAll("p, li, h1, h2, h3, h4, h5, figure, table"), function (e) {
      return !e.closest(".l2m-chrome, .l2m-bar, .l2m-panel, .skel-paper");
    });
  }
  function shown(e) { return e.getClientRects().length > 0; }
  function span(list, k) {                  // from a block's top to the next shown one's (or its own bottom)
    var r = list[k].getBoundingClientRect(), n = r.bottom;
    for (var i = k + 1; i < list.length; i++) if (shown(list[i])) { n = list[i].getBoundingClientRect().top; break; }
    return Math.max(n, r.top + 1) - r.top;
  }
  function capturePlace() {
    var p = spot();
    p.progress = window.L2M_progress ? Math.round(L2M_progress() * 1000) / 1000 : 0;   // how far through, for Library
    return p;
  }
  function spot() {                         // the block at the top of the screen, and how far into it
    var top = barBottom() + 4, list = anchors(), k = -1;
    if (window.pageYOffset < 40 || !list.length) return {n: -1, frac: 0};
    for (var i = 0; i < list.length; i++) {
      if (!shown(list[i])) continue;
      if (list[i].getBoundingClientRect().top <= top) k = i; else break;
    }
    if (k < 0) return {n: -1, frac: 0};
    var a = list[k].getBoundingClientRect().top, h = span(list, k);
    return {n: k, frac: h > 0 ? Math.max(0, Math.min(1, (top - a) / h)) : 0};
  }
  function restorePlace(p) {
    var list = anchors();
    if (!p || !(p.n >= 0) || p.of || !list[p.n]) return;     // (a place kept by the earlier count, "of", is not this one)
    window.scrollTo(0, window.pageYOffset + list[p.n].getBoundingClientRect().top + span(list, p.n) * (p.frac || 0) - barBottom() - 4);
  }
  function savePlace(key, leaving) {
    if (!key || isPage(key) || !view) return;
    var p = capturePlace();
    p.at = Date.now();
    reading[key] = p;
    store("reading", reading);
    readingDirty = true;
    clearTimeout(readingTimer);
    if (leaving) pushReading(true); else readingTimer = setTimeout(pushReading, 4000);
  }
  function mergeReading(remote) {
    Object.keys(remote || {}).forEach(function (k) {
      if (!reading[k] || (remote[k].at || 0) > (reading[k].at || 0)) reading[k] = remote[k];
    });
    store("reading", reading);
    var opened = store("opened") || {};                 // the library's reading order follows too
    Object.keys(reading).forEach(function (k) { opened[k] = Math.max(opened[k] || 0, reading[k].at || 0); });
    store("opened", opened);
  }
  function pullReading() {
    if (!src || !src.readWithSha) return Promise.resolve();
    return src.readWithSha("reading.json").then(function (r) { readingSha = r.sha; mergeReading((r.data || {}).papers); mergePins((r.data || {}).pins); },
                                                function () {});
  }
  function pushReading(keepalive) {
    if (!readingDirty || !src || !src.putJSON) return;
    readingDirty = false;
    src.putJSON("reading.json", {papers: reading, pins: pins}, readingSha, "Reading places", keepalive).then(function (sha) {
      readingSha = sha || readingSha;
    }, function () {
      // someone else (another device) wrote it meanwhile: take theirs in, then write ours again
      readingDirty = true;
      if (document.visibilityState !== "hidden") pullReading().then(function () { pushReading(false); });
    });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") savePlace(current, true);
    else {
      var order = listState();
      pullReading().then(function () { if (isPage(current) && listState() !== order) refresh(); });
    }
  });
  window.addEventListener("pagehide", function () { savePlace(current, true); });

  // ---------------------------------------------------------------- conversions started here
  function pending() { return store("pending") || {}; }
  function convert(ids) {
    ids = ids.map(function (i) { return i.trim().replace(/^(https?:\/\/)?(www\.)?arxiv\.org\/(abs|pdf|html)\//, "").replace(/\.pdf$/, ""); })
      .filter(function (i) { return /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/.test(i); });
    if (!ids.length) { toast("That is not an arXiv id or link."); return Promise.resolve(); }
    if (!src.run) { toast("Converting needs the GitHub library (Settings)."); return Promise.resolve(); }
    // the papers still waiting go along: GitHub keeps one run waiting behind the running one, and drops the others
    var p0 = pending(), have = {};
    ((lib && lib.papers) || []).forEach(function (x) { have[keyOf(x)] = x; });
    ids.forEach(function (i) { have[arxivKey(i)] = null; });
    Object.keys(p0).forEach(function (k) {
      var x = have[k];
      if (x === null || (x && x.converted && Date.parse(x.converted) >= p0[k].since - 60000)) return;
      if (p0[k].id) ids.push(p0[k].id);
    });
    return src.run("convert.yml", {ids: ids.join(" ")}).then(function () {
      var p = pending();
      ids.forEach(function (i) { if (!p[arxivKey(i)]) p[arxivKey(i)] = {id: i, since: Date.now()}; });
      store("pending", p);
      toast("Converting " + esc(ids.join(", ")) + ". It takes a few minutes; it will appear in your library.", 6000);
      watch();
      refresh();
    }, function (e) { toast("Could not start the conversion: " + esc(e.message), 7000); });
  }
  function removing() { return store("removing") || {}; }
  function removePaper(key, button) {
    button.disabled = true;
    button.innerHTML = SPIN + "Removing";
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
            if (e.status === "ok") toast('Ready: <a href="?p=' + encodeURIComponent(k) + '" data-p="' + esc(k) + '">' + esc(e.title) + "</a>", 8000);
            else tellFailures();                     // with the converter's reason
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
      '<span class="app-lead"><svg class="app-logo" viewBox="119 117 290 290" width="28" height="28" aria-hidden="true"><path d="M 331.1 173.7 A 76 56 0 1 0 250.8 255.1 L 248.7 253.0 A 88 64 0 1 0 337.0 351.8" fill="none" stroke="currentColor" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<button type="button" class="bar-btn app-close" id="app-close" aria-label="Close the settings" tabindex="-1">' + (I.close || "&times;") + "</button></span>" +
      '<span class="app-tabswap"><div class="seg app-tabs" role="tablist" aria-label="Sections"><span class="sel-ind" aria-hidden="true"></span>' +
      '<button type="button" class="seg-btn" role="tab" data-go="library" aria-checked="false"><span>Library</span></button>' +
      '<button type="button" class="seg-btn" role="tab" data-go="new" aria-checked="false"><span>Explore</span></button></div>' +
      '<div class="seg app-tabs set-tabs" id="set-tabs" role="tablist" aria-label="Settings" aria-hidden="true"><span class="sel-ind" aria-hidden="true"></span>' +
      '<button type="button" class="seg-btn" role="tab" data-set-tab="system" aria-checked="true" tabindex="-1"><span>System</span></button>' +
      '<button type="button" class="seg-btn" role="tab" data-set-tab="view" aria-checked="false" tabindex="-1"><span>View</span></button></div></span>' +
      '<span class="app-spacer"></span>' +
      '<div class="app-searchbar"><input class="app-field" id="lib-q" type="search" placeholder="Search your library" aria-label="Search your library" ' +
      'autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" class="bar-btn" id="search-close" aria-label="Close the search">' +
      (I.close || "&times;") + "</button></div>" +
      '<button type="button" class="bar-btn" id="app-search" aria-label="Search your library">' + (I.search || "?") + "</button>" +
      '<button type="button" class="bar-btn" id="app-plus" aria-label="Add a paper" aria-expanded="false" aria-controls="app-addp">' + (I.add || "+") + "</button>" +
      '<button type="button" class="bar-btn" id="app-gear" aria-label="Settings" aria-expanded="false" aria-controls="app-settings">' +
      (I.gear || I.settings || "") + '</button></div><div class="app-bar-day" aria-hidden="true"></div></header>' +
      '<div class="l2m-menu l2m-settings app-settings" id="app-settings" role="dialog" aria-label="Settings" aria-hidden="true">' +
      '<div class="menu-inner"></div></div>' +
      '<div class="l2m-menu l2m-settings app-settings" id="app-addp" role="dialog" aria-label="Add a paper" aria-hidden="true">' +
      '<div class="menu-inner"></div></div>';
    dropBoot();
    main.parentNode.insertBefore(holder, main);
    root.classList.add("l2m-bar-always");
    shell = holder;
    setBarH();
    var ind0 = holder.querySelector(".app-tabs .sel-ind");
    ind0.classList.add("no-anim");
    setTimeout(function () { ind0.classList.remove("no-anim"); }, 60);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (shell) slide(shell.querySelector(".app-tabs")); });
    holder.querySelector("#app-gear").addEventListener("click", function (e) { e.stopPropagation(); panelOpen === "settings" ? closePanel() : openPanel("settings"); });
    holder.querySelector("#app-plus").addEventListener("click", function (e) { e.stopPropagation(); panelOpen === "add" ? closePanel() : openPanel("add"); });
    holder.querySelector("#app-search").addEventListener("click", function () { searching(true); });
    holder.querySelector("#app-close").addEventListener("click", function (e) { e.stopPropagation(); closePanel(); });
    // the app's icon: to the top of the library, and the lists fetched afresh
    var logo = holder.querySelector(".app-logo");
    logo.setAttribute("role", "button"); logo.setAttribute("tabindex", "0"); logo.setAttribute("aria-label", "Library, from the top");
    logo.addEventListener("click", home);
    logo.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); home(); } });
    holder.querySelector("#search-close").addEventListener("click", function () { searching(false); });
    holder.querySelector("#lib-q").addEventListener("input", filterLibrary);
    return holder;
  }
  // the bar's own height, without a pinned date it may have taken in (lists and panels start below it)
  function setBarH() {
    var bar = shell && shell.querySelector("#app-bar"), row = bar && bar.querySelector(".app-bar-day");
    if (!bar) return;
    root.style.setProperty("--l2m-bar-h", (bar.getBoundingClientRect().height - (row ? row.getBoundingClientRect().height : 0)) + "px");
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
    Array.prototype.forEach.call(document.querySelectorAll(".lib-rows li"), function (li) {
      li.hidden = !!q && (li.getAttribute("data-hay") || "").indexOf(q) < 0;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".lib-head"), function (h) {
      var list = h.nextElementSibling;
      h.hidden = !!list && !list.querySelector("li:not([hidden])");
    });
    if (shell && current === "app:library") joinBar("app:library");
  }
  function searching(on, how) {        // how: "pop" (closed by back)
    if (!shell) return;
    if (!on && !shell.querySelector("#app-bar").classList.contains("searching")) return;
    closePanel();
    shell.querySelector("#app-bar").classList.toggle("searching", on);
    var f = shell.querySelector("#lib-q"), bar = shell.querySelector("#app-bar");
    bar.classList.remove("search-in", "search-out");
    void bar.offsetWidth;
    if (on) {
      try { if (!(history.state || {}).l2mSearch) history.pushState(Object.assign({}, history.state || {}, {l2mSearch: true}), ""); } catch (x) {}
      bar.classList.add("search-in");
      if (current !== "app:library") go("library");
      setTimeout(function () { f.focus(); }, 60);
    } else {
      if (how !== "pop") {
        try { if ((history.state || {}).l2mSearch) { skipPop = true; history.back(); } } catch (x) {}
      }
      f.value = ""; filterLibrary(); f.blur();
      bar.classList.add("search-out");
    }
    setTimeout(function () { bar.classList.remove("search-in", "search-out"); if (shell) slide(shell.querySelector(".app-tabs")); }, 320);
  }
  function setTab(name) {
    shell.querySelector("#app-plus").hidden = !(src && src.run);
    shell.querySelector("#app-search").classList.toggle("app-away", name !== "library");   // fades, keeps its place
    var dd = document.querySelector('[data-pane="app:' + name + '"] .app-day.stuck');
    shell.querySelector("#app-bar").classList.toggle("joined", !!dd);
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
      // two tabs: System (the library, the feed, this device) and View (how papers and lists look)
      var tab = store("setTab") === "view" ? "view" : "system";
      inner.innerHTML = '<div class="set-view"><div class="set-track"><div class="set-pane" data-set="system">' + panelHTML() + "</div>" +
        '<div class="set-pane l2m-settings" data-set="view">' + (window.L2M_readingSettings ? L2M_readingSettings(theme) : "") + "</div></div></div>";
      bindPanel(inner);
      bindSetTabs(inner, tab);
    }
    el.classList.add("open");
    el.setAttribute("aria-hidden", "false");
    shell.querySelector("#app-bar").classList.add("menu-open");
    setMode(which === "settings");
    shell.querySelector(which === "add" ? "#app-plus" : "#app-gear").setAttribute("aria-expanded", "true");
    panelOpen = which;
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(inner.querySelectorAll(".seg, .opt-list"), slide);
      var f = inner.querySelector("#add-id");
      if (f) f.focus();
    });
  }
  // settings open: the bar is the settings' bar (the icon a close button, the tabs the settings' tabs; search and
  // add step aside), and back again as they close
  function setMode(on) {
    if (!shell) return;
    var bar = shell.querySelector("#app-bar");
    bar.classList.toggle("set-mode", on);
    shell.querySelector("#set-tabs").setAttribute("aria-hidden", on ? "false" : "true");
    shell.querySelector(".app-tabs:not(.set-tabs)").setAttribute("aria-hidden", on ? "true" : "false");
    Array.prototype.forEach.call(shell.querySelectorAll("#set-tabs .seg-btn, #app-close"), function (b) { b.tabIndex = on ? 0 : -1; });
    Array.prototype.forEach.call(shell.querySelectorAll(".app-tabs:not(.set-tabs) .seg-btn, #app-search, #app-plus"), function (b) { b.tabIndex = on ? -1 : 0; });
  }
  function closePanel(how) {        // how: "pop" (closed by back), "jump" (something else follows at once)
    if (shell) setMode(false);
    if (!panelOpen || !shell) { panelOpen = false; return; }
    // the keyboard goes down with the panel, not after it (a text field in it keeps focus otherwise)
    if (document.activeElement && shell.contains(document.activeElement) && document.activeElement.blur) document.activeElement.blur();
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
  // the settings' tabs: the underline slides, the panes slide sideways (a swipe too), the panel takes each one's height
  function bindSetTabs(inner, tab) {
    var tabs = shell.querySelector("#set-tabs"), view = inner.querySelector(".set-view"), track = inner.querySelector(".set-track");
    var panes = Array.prototype.slice.call(inner.querySelectorAll(".set-pane")), names = ["system", "view"];
    function fit(animate) {
      var h = panes[names.indexOf(tab)].offsetHeight;
      if (!animate) view.style.transition = "none";
      view.style.height = h + "px";
      if (!animate) { void view.offsetWidth; view.style.transition = ""; }
    }
    function show(name, animate) {
      tab = name;
      store("setTab", name);
      Array.prototype.forEach.call(tabs.querySelectorAll("[data-set-tab]"), function (b) { b.setAttribute("aria-checked", b.getAttribute("data-set-tab") === name ? "true" : "false"); });
      slide(tabs);
      track.style.transition = animate ? "" : "none";
      track.style.transform = "translateX(" + (-50 * names.indexOf(name)) + "%)";
      panes.forEach(function (p, i) { p.setAttribute("aria-hidden", i === names.indexOf(name) ? "false" : "true"); });
      fit(animate);
      requestAnimationFrame(function () { Array.prototype.forEach.call(inner.querySelectorAll(".seg, .opt-list"), slide); });
    }
    tabs.onclick = function (e) {
      var b = e.target.closest("[data-set-tab]");
      if (b) show(b.getAttribute("data-set-tab"), true);
    };
    // a pane changing its own height (the font list unfolding, the category picker) resizes the panel with it
    if (window.ResizeObserver) new ResizeObserver(function () { fit(true); }).observe(panes[0]), new ResizeObserver(function () { fit(true); }).observe(panes[1]);
    var sw0 = null;
    view.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) return;
      sw0 = {x: e.touches[0].clientX, y: e.touches[0].clientY, dir: null, w: view.clientWidth, i: names.indexOf(tab)};
    }, {passive: true});
    view.addEventListener("touchmove", function (e) {
      if (!sw0) return;
      var dx = e.touches[0].clientX - sw0.x, dy = e.touches[0].clientY - sw0.y;
      if (!sw0.dir && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) sw0.dir = Math.abs(dx) > 1.2 * Math.abs(dy) ? "x" : "y";
      if (sw0.dir !== "x") return;
      e.preventDefault();
      var next = sw0.i - Math.sign(dx);
      if (next < 0 || next > 1) dx *= 0.25;
      track.style.transition = "none";
      track.style.transform = "translateX(" + (-sw0.i * sw0.w + dx) + "px)";
    }, {passive: false});
    function end(e) {
      if (!sw0 || sw0.dir !== "x") { sw0 = null; return; }
      var dx = (e.changedTouches ? e.changedTouches[0].clientX : sw0.x) - sw0.x, to = sw0.i - Math.sign(dx), s0 = sw0;
      sw0 = null;
      if (to >= 0 && to <= 1 && Math.abs(dx) > s0.w * 0.2) show(names[to], true); else show(names[s0.i], true);
    }
    view.addEventListener("touchend", end);
    view.addEventListener("touchcancel", end);
    requestAnimationFrame(function () { show(tab, false); });
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
    var fonts = {};
    (theme.fonts || []).forEach(function (f) { fonts[f.key] = f; });
    function showFont(key) {
      var cur = inner.querySelector(".font-current"), f = fonts[key];
      if (!cur || !f) return;
      var nm = cur.querySelector(".opt-name");
      nm.textContent = f.name; nm.style.fontFamily = f.stack;
      cur.querySelector(".opt-note").textContent = f.note || "";
    }
    showFont(want["data-font"]);
    inner.addEventListener("click", function (e) {
      var t = e.target.closest("[data-font-toggle]");
      if (t) {
        var pick = t.closest(".font-pick"), on = !pick.classList.contains("open");
        pick.classList.toggle("open", on);
        t.setAttribute("aria-expanded", on ? "true" : "false");
        requestAnimationFrame(function () { Array.prototype.forEach.call(inner.querySelectorAll(".seg, .opt-list"), slide); });
        return;
      }
      var b = e.target.closest("[data-font], [data-size-opt], [data-theme-opt], [data-tone-opt], [data-cross]");
      if (!b) return;
      if (b.hasAttribute("data-font")) {
        showFont(b.getAttribute("data-font"));
        var fp = b.closest(".font-pick");
        setTimeout(function () { fp.classList.remove("open"); fp.querySelector(".font-current").setAttribute("aria-expanded", "false"); }, 260);
      }
      var group = b.closest(".seg, .opt-list");
      Array.prototype.forEach.call(group.querySelectorAll('[role="radio"]'), function (x) { x.setAttribute("aria-checked", x === b ? "true" : "false"); });
      slide(group);
      if (b.hasAttribute("data-cross")) return;
      var p = window.L2M_prefs ? L2M_prefs() : {};
      if (b.hasAttribute("data-font")) { p.font = b.getAttribute("data-font"); L2M_applyFont(p.font); }
      if (b.hasAttribute("data-size-opt")) { p.size = b.getAttribute("data-size-opt"); L2M_applySize(p.size); }
      var fade = function (f) {
        var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (document.startViewTransition && !reduced) { try { document.startViewTransition(f); return; } catch (x) {} }
        f();
      };
      if (b.hasAttribute("data-theme-opt")) { p.theme = b.getAttribute("data-theme-opt"); fade(function () { L2M_applyTheme(p.theme); }); }
      if (b.hasAttribute("data-tone-opt")) { p.tone = b.getAttribute("data-tone-opt"); fade(function () { L2M_applyTone(p.tone); }); }
      if (window.L2M_savePrefs) L2M_savePrefs(p);
      setBarH();
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

  var mathIn = false, libMathIn = null;
  function addMath(m) {                  // the glyphs and styles of formulas drawn into feed.json or library.json
    if (!m || !m.cache) return;
    var st = document.createElement("style");
    st.textContent = m.css || "";
    document.head.appendChild(st);
    var d = document.createElement("div");
    d.innerHTML = m.cache;
    if (d.firstChild) document.body.appendChild(d.firstChild);
  }
  function feedMath() {
    if (!mathIn && feed && feed.math && feed.math.cache) { mathIn = true; addMath(feed.math); }
    if (lib && lib.math && libMathIn !== lib.math.cache) { libMathIn = lib.math.cache; addMath(lib.math); }
  }
  // abstracts: the first lines, fading out; "More" (or a tap on the text) slides the rest open
  var CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6.5 9.5 12 15l5.5-5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function foldAbstracts(box) {
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
      b.addEventListener("click", function (e) { e.stopPropagation(); toggle(); });
      p.l2mToggle = toggle;
      p.addEventListener("click", function (e) {
        e.stopPropagation();                                   // not a tap on the paper's row
        if (window.getSelection && String(window.getSelection()).length) return;   // selecting text, not tapping
        toggle();
      });
      p.parentNode.insertBefore(b, p.nextSibling);
    });
  }

  var ORDER = ["app:library", "app:new"];
  function track() {
    var t = main.querySelector(".app-track");
    if (!t || !t.querySelector("[data-pane]")) {        // (the page's own stand-in track has no panes to fill)
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
    var had = !!main.querySelector(".app-track [data-pane]");
    buildShell();
    root.classList.add("l2m-app-lists");
    setTab(k.slice(4));
    document.title = k === "app:new" ? "Explore" : (lib && lib.name) || "Papers";
    if (!had || !animate) {
      if (src) { renderLibrary(); renderNew(); } else showConnect();
    }
    place(k, animate && had);
    if (animate && had) follow(340);        // the pinned date comes and goes with the slide
    else pinned.apply();
  }
  // where each paper sat in the library list, so a new order can slide into place (not jump)
  var libTops = null;
  // where each row sat (by its key, relative to its list's top): a new order then slides into place, and rows new to
  // the list fade in where they belong (the same in Library and in New)
  function measureRows(box) {
    if (!box) return null;
    var top = box.getBoundingClientRect().top, m = {}, n = 0;
    Array.prototype.forEach.call(box.querySelectorAll("[data-k]"), function (el) { m[el.getAttribute("data-k")] = el.getBoundingClientRect().top - top; n++; });
    return n ? m : null;
  }
  function measureLibrary() { return measureRows(main.querySelector('[data-pane="app:library"] .app-pane-in')); }
  function slideRows(box, before, scroller) {
    if (!before || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    var top = box.getBoundingClientRect().top, rows = [];
    Array.prototype.forEach.call(box.querySelectorAll("[data-k]"), function (el) {
      rows.push({el: el, was: before[el.getAttribute("data-k")], now: el.getBoundingClientRect().top - top});
    });
    // scrolled down a list: what is on the screen stays there (rows arriving above come in out of sight)
    var shift = 0;
    if (scroller && scroller.scrollTop > 40) {
      var y = scroller.scrollTop, anchor = null;
      rows.forEach(function (r) { if (r.was !== undefined && r.was >= y - 1 && (!anchor || r.was < anchor.was)) anchor = r; });
      if (anchor) { shift = anchor.now - anchor.was; scroller.scrollTop = y + shift; }
    }
    var moved = [], fresh = [];
    rows.forEach(function (r) {
      if (r.was === undefined) {
        r.el.style.transition = "none"; r.el.style.opacity = "0"; r.el.style.transform = "translateY(-14px)";
        fresh.push(r.el);
        return;
      }
      var d = r.was - r.now + shift;
      if (Math.abs(d) < 1) return;
      r.el.style.transition = "none";
      r.el.style.transform = "translateY(" + d + "px)";
      if (getComputedStyle(r.el).position === "static") r.el.style.position = "relative";
      r.el.style.zIndex = d > 0 ? "1" : "";          // one rising passes over the others
      moved.push(r.el);
    });
    if (!moved.length && !fresh.length) return;
    void box.offsetWidth;
    // coming back from a paper: wait for the page to have slid in, then let the order move
    var wait = root.classList.contains("l2m-in-back") || root.classList.contains("l2m-vt-back") ? 380 : 30;
    setTimeout(function () {
      moved.forEach(function (el) {
        el.style.transition = "transform 520ms cubic-bezier(0.2, 0.8, 0.2, 1)";
        el.style.transform = "";
      });
      fresh.forEach(function (el, i) {             // the new ones come in one after another, as the others make room
        var delay = 140 + Math.min(i, 8) * 45;
        el.style.transition = "opacity 380ms ease " + delay + "ms, transform 520ms cubic-bezier(0.2, 0.8, 0.2, 1) " + delay + "ms";
        el.style.opacity = ""; el.style.transform = "";
      });
      setTimeout(function () {
        moved.concat(fresh).forEach(function (el) { el.style.transition = el.style.position = el.style.zIndex = ""; });
      }, 1100);
    }, wait);
  }
  // each paper's reading line (the bottom rule of its row, filled as far as it is read) grows to a new length
  var shownRead = null;
  function growReading(box) {
    var was = shownRead;
    shownRead = {};
    Array.prototype.forEach.call(box.querySelectorAll("li[data-k]"), function (li) {
      var k = li.getAttribute("data-k"), now = parseFloat(li.style.getPropertyValue("--read")) || 0;
      shownRead[k] = now;
      if (!was || Math.abs((was[k] || 0) - now) < 0.002) return;
      li.setAttribute("data-read", "");
      li.style.setProperty("--read", String(was[k] || 0));
      li.classList.add("read-still");
      void li.offsetWidth;
      li.classList.remove("read-still");
      setTimeout(function () { li.style.setProperty("--read", String(now)); if (!now) li.removeAttribute("data-read"); },
                 root.classList.contains("l2m-in-back") || root.classList.contains("l2m-vt-back") ? 420 : 40);
    });
  }
  var NEW_DAYS = 30;
  function isNewPaper(x, read) {
    var k = keyOf(x), t = Date.parse(x.added || "");
    return x.status === "ok" && !read[k] && !(reading[k] && reading[k].at) && t > Date.now() - NEW_DAYS * 864e5;
  }
  function confirmOpen(c, on) {
    c.classList.toggle("open", on);
    c.setAttribute("aria-hidden", on ? "false" : "true");
    Array.prototype.forEach.call(c.querySelectorAll("button"), function (x) { x.tabIndex = on ? 0 : -1; });
  }
  // 1. papers the converter could not read: said once, as soon as the app learns of it (whichever device added them)
  function tellFailures() {
    if (!lib || !lib.papers) return;
    var told = store("told") || {}, fresh = [], first = !store("toldInit");
    lib.papers.forEach(function (x) {
      var k = keyOf(x), mark = x.converted || x.added || "";
      if (x.status !== "failed" || told[k] === mark) return;
      told[k] = mark;
      if (!first) fresh.push(x);
    });
    store("told", told);
    store("toldInit", true);
    fresh.forEach(function (x, i) {
      setTimeout(function () {
        toast("Could not convert <em>" + esc(x.title || keyOf(x)) + "</em>: " + esc(x.error || "the converter failed") + ".", 9000);
      }, i * 9500);
    });
  }
  function renderLibrary() {
    var box = pane("app:library");
    var before = measureLibrary() || libTops;
    libTops = null;
    feedMath();
    var rm = removing(), I = theme.icons || {};
    var read = store("opened") || {};
    var papers = ((lib && lib.papers) || []).filter(function (x) { return !rm[keyOf(x)]; }), p = pending(), off = offlineSet();
    // papers added and not opened yet (on any device) come first, newest first, marked new; then the papers read
    // last; then the others, newest added first (the index's own order)
    var fresh = function (x) { return isNewPaper(x, read); };
    papers = papers.map(function (x, i) { return [x, i]; }).sort(function (a, b) {
      var na = fresh(a[0]), nb = fresh(b[0]);
      if (na !== nb) return na ? -1 : 1;
      if (na) return (Date.parse(b[0].added) || 0) - (Date.parse(a[0].added) || 0) || a[1] - b[1];
      return (read[keyOf(b[0])] || 0) - (read[keyOf(a[0])] || 0) || a[1] - b[1];
    }).map(function (a) { return a[0]; });
    var waiting = Object.keys(p).filter(function (k) {
      return !papers.some(function (x) { return keyOf(x) === k && x.converted && Date.parse(x.converted) >= p[k].since - 60000; });
    });
    function row(x) {
      var k = keyOf(x), meta = [];
      if (x.arxiv) meta.push(esc(x.arxiv.id) + (x.arxiv.primary ? " &middot; " + esc(x.arxiv.primary) : "") +
                             inspireLink(x.arxiv.id, x.arxiv.categories || [x.arxiv.primary]).replace(" &middot; ", " &middot; "));
      else if (x.kind === "draft") meta.push("your draft");
      if (x.status === "failed") meta.push('<span class="app-bad">could not be converted</span>');
      var hay = (x.title + " " + (x.authors || []).join(" ") + " " + (x.arxiv ? x.arxiv.id : "")).toLowerCase();
      var got = reading[k] && reading[k].progress > 0.005 ? reading[k].progress : 0;
      return '<li data-k="' + esc(k) + '" data-hay="' + esc(hay) + '"' + (got ? ' data-read style="--read: ' + got + '"' : "") + '><div class="app-lib-row"><div class="app-lib-text" data-p="' + esc(k) + '">' +
        '<a class="lib-title" href="?p=' + encodeURIComponent(k) + '" data-p="' + esc(k) + '">' + (x.titleHtml || esc(x.title || k)) + "</a>" +
        '<span class="lib-authors">' + esc(authorsLine(x.authors)) + "</span>" +
        (meta.length || fresh(x) ? '<span class="lib-meta">' + (fresh(x) ? '<span class="app-new-tag">New</span>' : "") + meta.join(" &middot; ") + "</span>" : "") + "</div>" +
        (x.status !== "failed" ? '<button type="button" class="bar-btn app-pin" data-pin="' + esc(k) + '" aria-pressed="' + isPinned(k) +
          '" aria-label="' + (isPinned(k) ? "Pinned; tap to unpin" : "Pin to the top") + '">' + (isPinned(k) ? I.pinned || I.pin || "&#9733;" : I.pin || "&#9734;") + "</button>" : "") +
        (window.caches && x.status !== "failed" ? '<button type="button" class="bar-btn app-offline" data-offline="' + esc(k) + '" aria-pressed="' + !!off[k] +
          '" aria-label="' + (off[k] ? "Saved on this device; tap to remove the copy" : "Keep offline") + '">' + (off[k] ? I.offlineDone || "&#10003;" : I.offline || "&darr;") + "</button>" : "") +
        (src && src.run ? '<button type="button" class="bar-btn app-trash" data-remove="' + esc(k) + '" aria-label="Remove from the library">' + (I.trash || "Remove") + "</button>" : "") +
        "</div>" + (x.abstractHtml ? '<p class="app-abs">' + x.abstractHtml + "</p>" : "") +
        '<div class="app-confirm" aria-hidden="true"><div class="app-confirm-in"><span class="app-confirm-q">Remove it from the library?</span>' +
        '<span class="app-confirm-acts"><button type="button" class="app-pill" data-remove-no tabindex="-1">Keep</button>' +
        '<button type="button" class="app-pill app-danger" data-remove-yes="' + esc(k) + '" tabindex="-1">Remove</button></span></div></div></li>';
    }
    var pinnedRows = papers.filter(function (x) { return isPinned(keyOf(x)); }).map(row).join("");
    var items = papers.filter(function (x) { return !isPinned(keyOf(x)); }).map(row).join("");
    var known = {};
    ((feed && feed.items) || []).forEach(function (i) { known[arxivKey(i.id)] = i; });
    var converting = waiting.map(function (k) {
      var f = known[k], mins = Math.max(0, Math.round((Date.now() - p[k].since) / 60000));
      return '<li class="app-pending"><span class="lib-title">' + (f ? f.titleHtml || esc(f.title) : "arXiv:" + esc(p[k].id)) + "</span>" +
        (f ? '<span class="lib-authors">' + esc(authorsLine(f.authors)) + "</span>" : "") +
        '<span class="lib-meta">Converting on GitHub &middot; ' + (mins < 1 ? "just started" : mins + " min so far") + ", usually 2&ndash;4 minutes</span>" +
        '<div class="app-progress indet"><span></span></div></li>';
    }).join("");
    // pinned papers first, under their own header; the rest under theirs (headers only once something is pinned)
    var rest = converting + items;
    var lists = pinnedRows ?
      '<p class="app-day lib-head" data-k="h:pinned">Pinned</p><ol class="l2m-library lib-rows" id="lib-pinned">' + pinnedRows + "</ol>" +
      (rest ? '<p class="app-day lib-head" data-k="h:rest">Recent</p><ol class="l2m-library lib-rows" id="lib-list">' + rest + "</ol>" : "") :
      '<ol class="l2m-library lib-rows" id="lib-list">' + rest + "</ol>";
    box.innerHTML = (papers.length || converting ? lists :
                       '<p class="app-note">No papers yet.' + (src && src.run ? ' Find some in <a href="?v=new" data-go="new">New</a>.' : "") + "</p>");
    slideRows(box, before, box.parentNode);
    growReading(box);
    Array.prototype.forEach.call(box.querySelectorAll("[data-pin]"), function (b) {
      b.addEventListener("click", function () { togglePin(b.getAttribute("data-pin")); });
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-remove]"), function (b) {
      b.addEventListener("click", function () {
        confirmOpen(b.closest("li").querySelector(".app-confirm"), !b.closest("li").querySelector(".app-confirm").classList.contains("open"));
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-offline]"), function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-offline"), on = b.getAttribute("aria-pressed") !== "true";
        var entry = ((lib && lib.papers) || []).filter(function (x) { return keyOf(x) === k; })[0];
        b.disabled = true;
        b.classList.add("app-busy-btn");
        b.innerHTML = SPIN;
        keepOffline(entry, on).then(function () {
          toast(on ? "Saved <em>" + esc(entry.title) + "</em> for reading offline." : "The offline copy is removed.");
        }, function (e) { toast("Could not save it: " + esc(e.message), 7000); }).then(function () {
          if (isPage(current)) renderLibrary();
        });
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-remove-no]"), function (b) {
      b.addEventListener("click", function () { confirmOpen(b.closest(".app-confirm"), false); });
    });
    Array.prototype.forEach.call(box.querySelectorAll("[data-remove-yes]"), function (b) {
      b.addEventListener("click", function () { removePaper(b.getAttribute("data-remove-yes"), b); });
    });
    foldAbstracts(box);
    filterLibrary();
    listenJoin("app:library");
  }

  var daysShown = 1, fetchingDay = null;      // New shows the latest day, and more on request
  // a list's section header (a day in New; Pinned / Recent in Library) passing under the bar joins it: the bar
  // draws it, as one glass block with the shadow under it
  function listenJoin(k) {
    var paneEl = pane(k).parentNode;
    if (!paneEl.l2mJoin) { paneEl.l2mJoin = true; paneEl.addEventListener("scroll", function () { requestAnimationFrame(function () { joinBar(k); }); }, {passive: true}); }
    joinBar(k);
  }
  function joinBar(k) {
    if (!shell || !isPage(current)) return;
    var box = pane(k), paneEl = box.parentNode;
    // a header is pinned while its rows pass under the bar: judged from its list (the header's own position is
    // not exact on every phone: the bar's height there includes the notch, in fractions of pixels)
    var barH = parseFloat(getComputedStyle(root).getPropertyValue("--l2m-bar-h")) || shell.querySelector("#app-bar").getBoundingClientRect().height;
    var days = Array.prototype.slice.call(box.querySelectorAll(".app-day")).filter(function (d) { return !d.hidden; }), cur = -1, nat = [];
    days.forEach(function (d, i) {
      var list = d.nextElementSibling;
      nat[i] = list ? list.getBoundingClientRect().top - d.offsetHeight : Infinity;
      var passed = paneEl.scrollTop > 0 && nat[i] <= barH + 0.5;
      d.classList.toggle("stuck", passed);            // passed headers are drawn by the bar, not the list
      if (passed) cur = i;
    });
    var bar = shell.querySelector("#app-bar"), row = bar.querySelector(".app-bar-day"), on = cur >= 0 && current === k;
    pinned.days[k] = cur >= 0 ? {h: days[cur].offsetHeight, text: days[cur].textContent, op: 1} : null;
    if (current !== k || (sw && sw.dir === "x") || pinned.following) return;   // a move between the tabs draws it meanwhile
    bar.classList.toggle("joined", on);
    if (on) {
      var d = days[cur], h = d.offsetHeight;
      row.style.height = h + "px";              // the bar grows down to take the header in (animated)
      if (row.textContent !== d.textContent) row.innerHTML = "<span>" + esc(d.textContent) + "</span>";
      // the words exactly over where they stood in the list (whatever the phone's insets and widths)
      var rg = document.createRange(); rg.selectNodeContents(d);
      var dx = rg.getBoundingClientRect().left - row.getBoundingClientRect().left;
      if (dx >= 0 && dx < 200) row.style.paddingLeft = dx.toFixed(2) + "px";
      // scroll-linked crossfade: the header fades out as the next one comes up under it, and a new one fades in
      var span = h, out = 1, inn = 1;
      if (cur + 1 < days.length) out = Math.max(0, Math.min(1, (nat[cur + 1] - barH) / span));   // the next header coming up
      if (cur > 0) inn = Math.max(0, Math.min(1, (barH - nat[cur]) / span));                      // this header just arrived
      var op = Math.min(out, inn);
      pinned.days[k].op = op;
      row.style.opacity = String(op);
      // it drifts up as it leaves and rises into place as it arrives, as if the next one pushes it out
      row.style.transform = "translateY(" + (out < 1 ? -(1 - out) * 6 : (1 - inn) * 6) + "px)";
      if (!bar.classList.contains("settled")) { clearTimeout(joinBar.t); joinBar.t = setTimeout(function () { if (bar.classList.contains("joined")) bar.classList.add("settled"); }, 230); }
    } else {
      clearTimeout(joinBar.t);
      bar.classList.remove("settled");
      row.style.height = "";                   // back to the bar alone; the header fades as it goes
      row.style.paddingLeft = "";
      row.style.opacity = "";
      row.style.transform = "";
    }
  }
  function renderNew() {
    var box = pane("app:new");
    var before = measureRows(box);
    feedMath();
    var have = {}, p = pending(), rm = removing();
    ((lib && lib.papers) || []).forEach(function (x) { if (x.arxiv && !rm[keyOf(x)]) have[arxivKey(x.arxiv.id)] = x; });
    var cats = (feed && feed.categories) || (config && config.categories) || ["hep-th"];
    var byDay = {};
    ((feed && feed.items) || []).forEach(function (i) { (byDay[i.announced] = byDay[i.announced] || []).push(i); });
    var order = Object.keys(byDay).sort().reverse();
    var shown = Math.max(1, Math.min(daysShown, order.length));
    var days = order.slice(0, shown).map(function (d) {
      var label = new Date(d + "T12:00:00Z").toLocaleDateString(undefined, {weekday: "long", day: "numeric", month: "long"});
      return '<p class="app-day" data-k="d:' + esc(d) + '">' + esc(label) + '</p><ol class="l2m-library app-feed">' + byDay[d].map(function (i) {
        var k = arxivKey(i.id), got = have[k] && have[k].status === "ok", act;
        var Ic = theme.icons || {};
        if (got) act = '<a class="bar-btn app-act" href="?p=' + encodeURIComponent(k) + '" data-p="' + esc(k) + '" aria-label="Open">' + (Ic.open || "&rsaquo;") + "</a>";
        else if (p[k]) act = '<span class="bar-btn app-act app-busy-btn" role="img" aria-label="Converting">' + SPIN + "</span>";
        else if (src && src.run) act = '<button type="button" class="bar-btn app-act app-add-btn" data-convert="' + esc(i.id) + '" aria-label="Add to the library">' + (Ic.add || "+") + "</button>";
        else act = '<a class="bar-btn app-act" href="https://arxiv.org/abs/' + esc(i.id) + '" target="_blank" rel="noopener" aria-label="On arXiv">' + (Ic.external || "&nearr;") + "</a>";
        var t = i.titleHtml || esc(i.title);
        return '<li class="app-paper" data-k="p:' + esc(k) + '"><div class="app-paper-head"><div class="app-paper-text">' +
          '<span class="lib-title app-abs-title">' + t + "</span>" +
          '<span class="lib-authors">' + esc(authorsLine(i.authors)) + '</span><span class="lib-meta">' + esc(i.id) +
          (i.type === "cross" ? " &middot; cross-list from " : " &middot; ") + esc(i.category) + inspireLink(i.id, [i.category]) + "</span></div>" +
          '<div class="app-paper-act">' + act + "</div></div>" +
          '<p class="app-abs">' + (i.abstractHtml || esc(i.abstract)) + "</p></li>";
      }).join("") + "</ol>";
    }).join("");
    var meta = esc(cats.join(", ")) + (feed && feed.crossLists ? ", with cross-lists" : "") +
      (feedCheck ? " &middot; checking arXiv&hellip;" :
        feed && feed.updated ? " &middot; updated " + esc(new Date(feed.updated).toLocaleString(undefined, {weekday: "short", hour: "2-digit", minute: "2-digit"})) : "");
    var refreshBtn = src && src.run ? '<button type="button" class="bar-btn app-refresh' + (feedCheck ? " spinning" : "") + '" id="feed-now" ' +
      (feedCheck ? "disabled " : "") + 'aria-label="' + (feedCheck ? "Checking for new papers" : "Check for new papers") + '">' +
      ((theme.icons || {}).refresh || "&#8635;") + "</button>" : "";
    var older = "";
    if (order.length > shown) {
      older = '<p class="app-row app-older"><button type="button" class="app-pill" id="feed-older">' +
        esc(new Date(order[shown] + "T12:00:00Z").toLocaleDateString(undefined, {weekday: "long", day: "numeric", month: "long"})) + "</button></p>";
    } else if (order.length && src && src.run) {
      older = '<p class="app-row app-older">' + (fetchingDay ? '<span class="app-pill app-busy">' + SPIN + "Fetching the day before</span>" :
        '<button type="button" class="app-pill" id="feed-older">The day before</button>') + "</p>";
    }
    box.innerHTML = '<div class="app-feedbar"><p class="app-note app-small">' + meta + "</p>" + refreshBtn + "</div>" +
      (feedCheck ? '<div class="app-progress indet app-feed-progress" role="progressbar" aria-label="Checking arXiv"><span></span></div>' : "") +
      (days || '<p class="app-note">' + (feed ? "No new papers in the last few days." : "The new papers have not been fetched yet.") + "</p>") + older;
    var ob = box.querySelector("#feed-older");
    if (ob) ob.addEventListener("click", function () {
      if (order.length > shown) { daysShown = shown + 1; renderNew(); return; }
      var oldest = order[order.length - 1];
      src.run("feed.yml", {before: oldest}).then(function () {
        fetchingDay = oldest;
        renderNew();
        var tries = 0, t = setInterval(function () {
          getJSON("feed.json", true).then(function (f) {
            var got = (f.items || []).some(function (i) { return i.announced < oldest; });
            if (got || ++tries > 20) {
              clearInterval(t);
              fetchingDay = null;
              if (got) { feed = f; mathIn = false; feedMath(); daysShown = shown + 1; }
              else toast("The day before could not be fetched; try again later.");
              if (isPage(current)) renderNew();
            }
          }).catch(function () {});
        }, 15000);
      }, function (e) { toast("Could not fetch it: " + esc(e.message)); });
    });
    foldAbstracts(box);
    slideRows(box, before, box.parentNode);
    // in New a paper's title opens and closes its abstract (the round button opens the paper)
    Array.prototype.forEach.call(box.querySelectorAll(".app-abs-title"), function (t) {
      var abs = t.closest(".app-paper").querySelector(".app-abs");
      if (abs && abs.l2mToggle) { t.classList.add("app-tappable"); t.addEventListener("click", function () { abs.l2mToggle(); }); }
    });
    // a date pinned under the bar joins it: one glass block, the shadow under the date
    listenJoin("app:new");
    var r = document.getElementById("feed-now");
    if (r) r.addEventListener("click", checkFeed);
  }
  function home() {
    closePanel("jump");
    searching(false);
    if (current !== "app:library") go("library");
    var pe = pane("app:library").parentNode;
    if (pe.scrollTop > 0) pe.scrollTo({top: 0, behavior: "smooth"});
    if (!src) return;
    var before = listText.join("\u0000"), order = listState();
    freshLists().then(function (t) {
      var changed = t.join("\u0000") !== before;
      if (changed) { var oldFeed = feed; useLists(t); if (feed && oldFeed) { var f = feed; feed = oldFeed; adoptFeed(f); } }
      return pullReading().then(function () { if ((changed || listState() !== order) && isPage(current)) refresh(); });
    }, function () {});
  }
  // refresh: GitHub fetches the day's list from arXiv (a minute or two); the app watches for it and brings it in
  var feedCheck = null;
  function checkFeed() {
    if (feedCheck || !src || !src.run) return;
    var was = feed && feed.updated;
    feedCheck = {tries: 0};
    if (isPage(current)) renderNew();
    src.run("feed.yml", {}).then(function () {
      feedCheck.timer = setInterval(function () {
        getJSON("feed.json", true).then(function (f) {
          if (f && f.updated && f.updated !== was) {
            clearInterval(feedCheck.timer);
            var n = adoptFeed(f);
            feedCheck = null;
            if (isPage(current)) renderNew();
            toast(n ? n + (n === 1 ? " new paper." : " new papers.") : "No new papers since the last check.");
          } else if (++feedCheck.tries > 30) {
            clearInterval(feedCheck.timer);
            feedCheck = null;
            if (isPage(current)) renderNew();
            toast("It is still running on GitHub; the list comes in the next time you open the app.", 7000);
          }
        }).catch(function () {});
      }, 10000);
    }, function (e) {
      feedCheck = null;
      if (isPage(current)) renderNew();
      toast("Could not start it: " + esc(e.message));
    });
  }
  // a newer list: the days it adds on top are shown along with the ones already there (they arrive above them)
  function adoptFeed(f) {
    var old = {}, days = {};
    ((feed && feed.items) || []).forEach(function (i) { old[i.id] = 1; days[i.announced] = 1; });
    var newest = Object.keys(days).sort().pop(), added = {};
    var n = ((f && f.items) || []).filter(function (i) {
      if (newest && i.announced > newest) added[i.announced] = 1;
      return !old[i.id];
    }).length;
    if (newest) daysShown += Object.keys(added).length;
    feed = f; mathIn = false; feedMath();
    return n;
  }

  function showConnect() {
    pane("app:new").innerHTML = '<p class="app-note">New papers appear in Explore once the library is connected.</p>';
    pane("app:library").innerHTML = '<p class="app-note">Your papers are kept in a private GitHub repo. To read them here, open the settings ' +
      '(the button at the top right) and paste an access token under <em>Library</em>.</p>' +
      '<p class="app-row"><button type="button" class="app-pill" id="open-settings">Open settings</button></p>';
    document.getElementById("open-settings").addEventListener("click", function (e) { e.stopPropagation(); openPanel("settings"); });
  }

  function showPaper(key) {
    libTops = measureLibrary() || libTops;      // the order as it was, for the slide on the way back
    dropShell();
    var read = store("opened") || {};           // reading order, kept on this device
    read[key] = Date.now();
    store("opened", read);
    var entry = ((lib && lib.papers) || []).filter(function (x) { return keyOf(x) === key; })[0] || {key: key, path: "papers/" + key};
    if (entry.status === "failed") {
      buildShell(); setTab("library");
      main.innerHTML = '<p class="app-note"><strong>' + esc(entry.title || key) + "</strong> could not be converted.</p>" +
        '<pre class="app-log">' + esc(entry.error || "") + "</pre>" +
        (entry.arxiv ? '<p class="app-row"><a class="app-pill" href="https://arxiv.org/abs/' + esc(entry.arxiv.id) + '" target="_blank" rel="noopener">Open on arXiv</a></p>' : "");
      return;
    }
    dropBoot();
    root.classList.add("l2m-bar-always");
    var st0 = history.state || {}, fresh = !(st0.l2mPaper === key && typeof st0.l2mY === "number");
    skelBar();
    main.innerHTML = skelPaper();
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
          var ins = inspire(entry.arxiv.id, entry.arxiv.categories || [entry.arxiv.primary]);
          if (ins) actions.push({label: "INSPIRE", href: ins});
        }
        dropSkelBar();                        // the real bar takes its place in the same frame
        view = L2M_open({doc: doc, theme: Object.assign({}, theme, {titleblock: []}), cache: cache, key: key, kicker: null,
          base: src.kind === "site" ? (entry.path || "papers/" + key) + "/" : "",
          image: src.kind === "site" && !isOffline(key) ? null : function (name) {
            return paperFile(key, entry, "images/" + name).then(function (b) { var u = URL.createObjectURL(b); urls.push(u); return u; });
          },
          mathjax: lib && lib.mathjax, onLibrary: backToLists, libraryHref: "./", actions: actions,
          leaving: function () { return leavingPaper === key; }});
        var v = view;
        main.classList.remove("l2m-arrive"); void main.offsetWidth; main.classList.add("l2m-arrive");
        // opened afresh (not by back or forward): the place it was left, on this device or another
        if (fresh && reading[key] && !location.hash) v.ready.then(function () {
          setTimeout(function () { if (view === v) restorePlace(reading[key]); }, 60);
        });
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
    dropSkelBar();
    if (view && current && !isPage(current)) savePlace(current, true);
    if (view) { view.close(save); view = null; }
    urls.forEach(function (u) { URL.revokeObjectURL(u); });
    urls = [];
  }
  // into a paper the page moves in from the right; back out to the lists it comes from the left
  function enter(dir) {
    root.classList.remove("l2m-in-fwd", "l2m-in-back");
    void root.offsetWidth;
    root.classList.add(dir > 0 ? "l2m-in-fwd" : "l2m-in-back");
    clearTimeout(enter.t);
    enter.t = setTimeout(function () { root.classList.remove("l2m-in-fwd", "l2m-in-back"); }, 420);
  }
  // into a paper and back out: the old page slides away as the new one slides in, and the bar changes in place
  // (the browser's page transitions; where it has none, the new page alone slides in)
  function show(k, save) {
    var cross = current !== null && current !== undefined && isPage(current) !== isPage(k);
    var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (cross && document.startViewTransition && !reduced) {
      root.classList.add("l2m-vt");
      root.classList.toggle("l2m-vt-back", isPage(k));
      try {
        var vt = document.startViewTransition(function () { showNow(k, save, false); });
        vt.finished.then(done, done);
      } catch (e) { done(); showNow(k, save, true); }
      return;
    }
    showNow(k, save, cross);
    function done() { root.classList.remove("l2m-vt", "l2m-vt-back"); }
  }
  function showNow(k, save, slideIn) {
    var was = current;
    close(save);
    current = k;
    if (slideIn) enter(isPage(k) ? -1 : 1);
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
  var fromList = false;                     // the open paper was opened from Library or New
  var newAboveLibrary = false;
  var toLibrary = false;                    // the bar's back button is on its way down to Library
  var leavingPaper = null;                  // ... stepping back past this paper's entries              // the history has Library right below the New entry
  function backToLists(steps) {             // steps: the jumps made inside the paper, stepped over too
    // the list's own history entry, where it was left; opened from New, on down to Library (one step below it)
    if (fromList) {
      // on down past every entry the paper made (a jump from its contents leaves one more than it counts)
      leavingPaper = current;
      toLibrary = current !== null && newAboveLibrary;
      history.go(-1 - (steps || 0));
      return;
    }
    close();                                // opened from a link: the library takes the paper's place
    try { history.replaceState({l2mPaper: "app:library"}, "", location.pathname); } catch (e) {}
    show("app:library");
  }
  function go(pageName, key) {
    fromList = !!key && isPage(current);
    closePanel("jump");
    close();                                // saves the reading place in the entry being left
    var k = key || "app:" + pageName;
    if (k === current) return;
    listMove = isPage(current) && isPage(k);
    if (k === "app:library" && current === "app:new" && newAboveLibrary) {
      newAboveLibrary = false;
      history.back();                       // New was one step above Library: step back down to it
      return;
    }
    if (listMove) newAboveLibrary = k === "app:new";
    var url = key ? "?p=" + encodeURIComponent(key) : pageName === "new" ? "?v=new" : location.pathname;
    try { history.pushState({l2mPaper: k}, "", url); } catch (e) {}
    show(k);
  }
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.target.closest && e.target.closest("a.app-ext")) return;      // INSPIRE and the like open as links
    var a = e.target.closest && e.target.closest("[data-p], [data-go], [data-convert]");
    if (!a) return;
    e.preventDefault();
    if (a.hasAttribute("data-convert")) { a.disabled = true; a.classList.add("app-busy-btn"); a.innerHTML = SPIN; convert([a.getAttribute("data-convert")]); return; }
    if (a.hasAttribute("data-p")) go(null, a.getAttribute("data-p"));
    else go(a.getAttribute("data-go"));
  });
  window.addEventListener("popstate", function (e) {
    if (skipPop) { skipPop = false; return; }
    if (panelOpen) { closePanel("pop"); return; }       // back closes the open panel, nothing else
    if (shell && shell.querySelector("#app-bar").classList.contains("searching")) { searching(false, "pop"); return; }
    var k = (e.state && e.state.l2mPaper) || wanted();
    if (leavingPaper) {
      if (k === leavingPaper) { history.back(); return; }   // still one of the paper's own entries
      leavingPaper = null;
    }
    if (toLibrary) {
      toLibrary = false;
      if (k === "app:new") { newAboveLibrary = false; history.back(); return; }   // passing New on the way
    }
    if (k === current) return;              // a step inside the open paper: nav.js handles it
    listMove = isPage(current) && isPage(k);
    if (k === "app:library") newAboveLibrary = false;
    else if (k === "app:new") newAboveLibrary = true;
    show(k, false);                         // the entry has already changed: nothing to save into it
  });
  // swiping sideways on Library / New: the strip with both lists follows the finger
  var sw = null;
  // New's pinned date, while a swipe moves between the tabs: the bar grows and shrinks with the finger
  // each list's pinned header, known while the other list shows, so a swipe can bring it in bit by bit
  var pinned = {days: {}, apply: function () { if (isPage(current)) joinBar(current); }};
  function pinnedMix(pageAt) {                // pageAt: where the track is, 0 = Library, 1 = New (in between while swiping)
    var dl = pinned.days["app:library"], dn = pinned.days["app:new"];
    if (!shell || !(dl || dn)) return;
    var wn = Math.max(0, Math.min(1, pageAt)), wl = 1 - wn;
    var bar = shell.querySelector("#app-bar"), row = bar.querySelector(".app-bar-day");
    var h = wl * (dl ? dl.h : 0) + wn * (dn ? dn.h : 0), pad = 19 * (wl * (dl ? 1 : 0) + wn * (dn ? 1 : 0));
    // the words: the nearer list's header; where both lists have one, it fades out and the other's in at the middle
    var near = wn >= wl ? dn : dl, far = wn >= wl ? dl : dn, w = Math.max(wn, wl), d = near || far;
    var op = near ? (near.op === undefined ? 1 : near.op) * (far ? 2 * w - 1 : w) : (far.op === undefined ? 1 : far.op) * (1 - w);
    if (row.textContent !== d.text) row.innerHTML = "<span>" + esc(d.text) + "</span>";
    bar.classList.add("joined");
    bar.classList.remove("settled");
    row.style.transition = "none";
    row.style.height = h + "px";
    row.style.paddingTop = pad + "px";
    row.style.opacity = String(op);
    row.style.transform = "";
  }
  function follow(ms) {                     // the track is sliding by itself: the bar follows it frame by frame
    var t = main.querySelector(".app-track"), end = Date.now() + ms;
    if (!t || !(pinned.days["app:library"] || pinned.days["app:new"])) { pinnedSettle(); return; }
    pinned.following = true;
    (function frame() {
      var m = new DOMMatrix(getComputedStyle(t).transform), w = main.clientWidth || 1;
      pinnedMix(Math.max(0, Math.min(ORDER.length - 1, -m.m41 / w)));
      if (Date.now() < end) requestAnimationFrame(frame);
      else { pinned.following = false; pinnedSettle(); }
    })();
  }
  function pinnedSettle() {                   // the swipe is over: the bar eases to where the tab it lands on has it
    if (!shell) return;
    var row = shell.querySelector(".app-bar-day");
    row.style.transition = row.style.paddingTop = "";
    pinned.apply();
  }
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
    pinnedMix(Math.max(0, Math.min(ORDER.length - 1, sw.i - dx / sw.w)));
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
    follow(320);
  }
  main.addEventListener("touchend", endSwipe);
  main.addEventListener("touchcancel", endSwipe);

  window.addEventListener("resize", function () {
    if (shell) { setBarH(); slide(shell.querySelector(".app-tabs")); }
  });

  // ---------------------------------------------------------------- start
  // The lists come at once from the copies kept on this device; the fresh ones follow from the network, and
  // the lists are drawn again only if they changed. With nothing kept yet, stand-ins show while they come.
  var LISTS = ["library.json", "feed.json", "config.json"], listText = [null, null, null];
  function useLists(t) {
    lib = t[0] ? JSON.parse(t[0]) : {papers: []};
    setTimeout(tellFailures, 800);
    feed = t[1] ? JSON.parse(t[1]) : null;
    config = t[2] ? JSON.parse(t[2]) : null;
    listText = t;
  }
  function savedLists() {
    return Promise.all(LISTS.map(function (p) {
      return fromCache(p).then(function (r) { return r.text(); }, function () { return null; });
    }));
  }
  function freshLists() {
    return Promise.all(LISTS.map(function (p, i) {
      return src.blob(p).then(function (b) { remember(p, b); return b.text(); }, function () { return listText[i]; });
    }));
  }
  function load() {                          // (also used when the settings change the library)
    if (!src) return Promise.resolve();
    return freshLists().then(function (t) { useLists(t); return pullReading(); });
  }
  function standIns(k) {
    buildShell();
    root.classList.add("l2m-app-lists");
    setTab(k.slice(4));
    pane("app:library").innerHTML = skelRows(5, 3);
    pane("app:new").innerHTML = skelRows(5, 11);
    place(k, false);
  }
  // this release's files are asked for by name and release, so the app's offline copy can answer at once
  var REL = (function () {
    try { var v = new URL(document.currentScript.src).searchParams.get("v"); return v && v !== "__RELEASE__" ? v : ""; } catch (e) { return ""; }
  })();
  var themeP = theme ? Promise.resolve(theme) : fetch("theme.json" + (REL ? "?v=" + REL : "")).then(function (r) { return r.json(); });
  // a site with its own library.json next to the page; not asked when a GitHub library is set up here
  var ghSet = store("site") !== location.pathname && store("repo") && store("token");
  var siteP = ghSet ? Promise.resolve(false) : fetch("library.json", {cache: "no-cache"}).then(function (r) { return r.ok; }, function () { return false; });
  Promise.all([themeP, siteP]).then(function (r) {
    theme = r[0];
    if (window.L2M_initPrefs) L2M_initPrefs(theme);
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    if (r[1]) store("site", location.pathname);
    // offline, a site is still a site: its lists and saved papers come from this device
    if (r[1] || store("site") === location.pathname) src = staticSource();
    else if (store("repo") && store("token")) src = githubSource(store("repo"), store("token"));
    if (!src) return;
    return savedLists().then(function (t) {
      if (t[0]) { useLists(t); return; }
      var k0 = wanted();
      if (isPage(k0)) standIns(k0);
      return freshLists().then(useLists);
    });
  }).then(function () {
    var k = wanted();
    try {
      if (k !== "app:library" && !(history.state || {}).l2mPaper) {
        // opened straight on New or on a paper: the library goes underneath, so back leads to it
        history.replaceState({l2mPaper: "app:library"}, "", location.pathname);
        history.pushState({l2mPaper: k}, "", k === "app:new" ? "?v=new" : "?p=" + encodeURIComponent(k));
        if (k === "app:new") newAboveLibrary = true; else fromList = true;
      } else {
        history.replaceState(Object.assign({}, history.state || {}, {l2mPaper: k}), "");
      }
    } catch (e) {}
    show(k);
    watch();
    if (!src) return;
    // then, quietly: the fresh lists and the reading places from the other devices
    var before = listText.join("\u0000"), order = listState();
    freshLists().then(function (t) {
      var changed = t.join("\u0000") !== before;
      if (changed) {
        var oldFeed = feed;
        useLists(t);
        if (feed && oldFeed) { var f = feed; feed = oldFeed; adoptFeed(f); }
      }
      return pullReading().then(function () {
        if ((changed || listState() !== order) && isPage(current)) refresh();
      });
    });
  }).catch(function (e) {
    main.innerHTML = '<p class="app-note">Cannot start: ' + esc(e.message || e) + "</p>";
  });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
