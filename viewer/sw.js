// Epsilon app: keeps the app itself available offline (papers are kept by app.js in their own caches).
// The page asks for its files by release (name?v=release): those never change, so the saved copy answers at
// once. The page itself is asked of the network first (a new release shows at once), with the saved copy
// after a short wait on a slow network, or offline. It is saved under one name, whatever its address (?p=…,
// ?v=new), and the files of the release it asks for are kept as long as it is the saved one: the app always
// starts offline, even right after a new release was fetched and not yet taken on ("Not now").
var SHELL = "l2m-shell-v8";
var PAGE = "./";
var RELEASED = ["fonts/fonts.css", "theme.css", "theme.json", "prefs.js", "nav.js", "viewer.js", "app.js"];   // name?v=release
var OTHERS = ["offline.html", "manifest.webmanifest", "icon-192.png", "apple-touch-icon.png", "favicon.png", "film.webp"];
var FILES = [PAGE, "index.html"].concat(RELEASED, OTHERS);
// what a page asked for offline, with no copy of it, shows instead of the browser's error
function offlinePage() {
  return caches.open(SHELL).then(function (c) { return c.match("offline.html"); }).then(function (r) { return r || Response.error(); });
}
function releaseOf(html) { return (/app\.js\?v=([\w.-]+)/.exec(html || "") || [])[1] || ""; }
// The fonts' files (fonts/, named by their content, so never changed) are kept in a cache of their own, across releases:
// the ones the app opens in (the reading font and the bar's, Latin letters) and the font list's names from the start,
// any other the first time a page shows it. Files no longer named by fonts.css are let go.
var FONTS = "l2m-fonts";
function fontFaces() {                    // [[script, family, file]] of fonts.css
  return caches.open(SHELL).then(function (c) { return c.match("fonts/fonts.css", {ignoreSearch: true}); }).then(function (r) { return r ? r.text() : ""; }).then(function (css) {
    var out = [], re = /\/\* ([\w-]+) \*\/\s*@font-face \{([^}]*)\}/g, m;
    while ((m = re.exec(css))) {
      var fam = /font-family: '([^']+)'/.exec(m[2]), url = /url\(([^)]+)\)/.exec(m[2]);
      if (fam && url) out.push([m[1], fam[1], new URL("fonts/" + url[1], self.registration.scope).href]);
    }
    return out;
  });
}
function keepFonts() {
  return Promise.all([fontFaces(), caches.open(SHELL).then(function (c) { return c.match("theme.json", {ignoreSearch: true}); }).then(function (r) { return r ? r.json() : {}; })]).then(function (a) {
    var theme = a[1], main = (theme.fonts || []).filter(function (f) { return f.key === (theme.defaults || {}).font; })[0];
    var fams = [main && (/"([^"]+)"/.exec(main.stack || "") || [])[1], theme.uiFont && theme.uiFont.split(":")[0].replace(/\+/g, " ")];
    var want = a[0].filter(function (f) { return f[0] === "preview" || (f[0] === "latin" && fams.indexOf(f[1]) >= 0); });
    return caches.open(FONTS).then(function (c) {
      return Promise.all(want.map(function (f) {
        return c.match(f[2]).then(function (hit) { return hit || c.add(f[2]); });
      }));
    });
  }).catch(function () {});                // (the app installs without them; they come when shown)
}
function dropOldFonts() {
  return fontFaces().then(function (faces) {
    if (!faces.length) return;
    var now = faces.map(function (f) { return f[2]; });
    return caches.open(FONTS).then(function (c) {
      return c.keys().then(function (ks) {
        return Promise.all(ks.filter(function (k) { return now.indexOf(k.url) < 0; }).map(function (k) { return c.delete(k); }));
      });
    });
  }).catch(function () {});
}
// the files of releases neither the saved page asks for nor just fetched (a new release, waiting to be taken on)
function dropOldReleases(fetched) {
  return caches.open(SHELL).then(function (c) {
    return c.match(PAGE).then(function (r) { return r ? r.text() : ""; }).then(function (html) {
      var keep = [releaseOf(html), fetched];
      return c.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) {
          var v = new URL(k.url).searchParams.get("v");
          if (v && keep.indexOf(v) < 0) return c.delete(k);
        }));
      });
    });
  }).catch(function () {});
}
self.addEventListener("install", function (e) {
  // the page as it is now and the files of its release, by the names it asks for them
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return fetch(new Request(PAGE, {cache: "no-cache"})).then(function (r) {
      if (!r.ok) throw new Error("page: " + r.status);
      return r.clone().text().then(function (html) {
        var rel = releaseOf(html);
        return Promise.all([c.put(PAGE, r), c.addAll(RELEASED.map(function (f) { return rel ? f + "?v=" + rel : f; }).concat(OTHERS))]);
      });
    });
  }).then(keepFonts).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return /^l2m-shell-/.test(k) && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(dropOldFonts).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.indexOf("/__") >= 0) return;
  if (/\/fonts\/[^/]+\.woff2$/.test(url.pathname)) {      // a font's file: the kept copy, else fetched once and kept
    e.respondWith(caches.open(FONTS).then(function (c) {
      return c.match(e.request).then(function (hit) {
        if (hit) return hit;
        return fetch(e.request).then(function (r) {
          if (r.ok) e.waitUntil(c.put(e.request, r.clone()));
          return r;
        });
      });
    }));
    return;
  }
  var scope = new URL(self.registration.scope).pathname;
  var page = url.pathname === scope || url.pathname === scope + "index.html";
  if (page && e.request.mode !== "navigate") return;       // (the app looking for a new release: the network's answer, kept nowhere)
  var shell = page || FILES.some(function (f) { return new URL(f, self.registration.scope).pathname === url.pathname; });
  if (!shell) {                                             // papers and lists: app.js decides
    if (e.request.mode === "navigate") e.respondWith(fetch(e.request).catch(offlinePage));   // (another page of the site)
    return;
  }
  var saved = caches.open(SHELL);
  if (page) {
    // the page: the network, not the browser's cache, saved as the page; the saved one if the network is slow, away
    // or failing (and with none saved, the offline page)
    var keeping = Promise.resolve();
    var net = fetch(new Request(url.href, {cache: "no-cache", credentials: "same-origin"})).then(function (r) {
      if (r.ok) { var copy = r.clone(); keeping = saved.then(function (c) { return c.put(PAGE, copy); }); }
      return r;
    });
    e.waitUntil(net.then(function () { return keeping; }, function () {}));
    e.respondWith(new Promise(function (resolve) {
      var done = false;
      function give(r) { if (!done && r) { done = true; resolve(r); } }
      function fallback() { return saved.then(function (c) { return c.match(PAGE); }); }
      var timer = setTimeout(function () { fallback().then(give); }, 2500);
      net.then(function (r) {
        clearTimeout(timer);
        if (r.ok) give(r); else fallback().then(function (s) { give(s || r); });
      }, function () {
        clearTimeout(timer);
        fallback().then(function (r) { return r || offlinePage(); }).then(give);
      });
    }));
    return;
  }
  var v = url.searchParams.get("v");
  if (v || /\.(png|webp)$/.test(url.pathname)) {
    // a release's file (or an image): the saved copy, else the network (and saved for next time); [answer, saving]
    var answer = saved.then(function (c) { return c.match(e.request); }).then(function (hit) {
      // a release's file never changes: a saved one is not asked for again (images do refresh, in the background)
      if (hit && v) return [hit];
      var net = fetch(e.request).then(function (r) {
        return [r, r.ok && saved.then(function (c) { return c.put(e.request, r.clone()); }).then(function () { return v && dropOldReleases(v); })];
      });
      if (hit) return [hit, net.then(function (a) { return a[1]; }, function () {})];
      return net;
    });
    e.respondWith(answer.then(function (a) { return a[0]; }));
    e.waitUntil(answer.then(function (a) { return a[1]; }, function () {}));
    return;
  }
  // anything else of the app asked for without a release: the network, the saved copy if it is slow or away
  var kept = Promise.resolve();
  var fresh = fetch(new Request(url.href, {cache: "no-cache", credentials: "same-origin"})).then(function (r) {
    if (r.ok) { var copy = r.clone(); kept = saved.then(function (c) { return c.put(e.request, copy); }); }
    return r;
  });
  e.waitUntil(fresh.then(function () { return kept; }, function () {}));
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function give(r) { if (!done && r) { done = true; resolve(r); } }
    function fallback() { return saved.then(function (c) { return c.match(e.request, {ignoreSearch: true}); }); }
    var timer = setTimeout(function () { fallback().then(give); }, 2500);
    fresh.then(function (r) { clearTimeout(timer); give(r); }, function () {
      clearTimeout(timer);
      fallback().then(function (r) { give(r || Response.error()); });
    });
  }));
});
