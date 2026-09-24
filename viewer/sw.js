// latex2mobile app: keeps the app itself available offline (papers are kept by app.js in their own caches).
// The page asks for its files by release (name?v=release): those never change, so the saved copy answers at
// once. The page itself is asked of the network first (a new release shows at once), with the saved copy
// after a short wait on a slow network, or offline.
var SHELL = "l2m-shell-v5";
var FILES = ["./", "index.html", "theme.css", "theme.json", "prefs.js", "nav.js", "viewer.js", "app.js",
             "manifest.webmanifest", "icon-192.png", "apple-touch-icon.png", "favicon.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return /^l2m-shell-/.test(k) && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
function save(req, r) {
  if (!r || !r.ok) return r;
  var copy = r.clone();
  caches.open(SHELL).then(function (c) { c.put(req, copy); });
  return r;
}
function dropOtherReleases(url) {            // a file's earlier releases, once a newer one is saved
  caches.open(SHELL).then(function (c) {
    c.keys().then(function (ks) {
      ks.forEach(function (k) {
        var u = new URL(k.url);
        if (u.pathname === url.pathname && u.searchParams.has("v") && u.search !== url.search) c.delete(k);
      });
    });
  });
}
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.indexOf("/__") >= 0) return;
  var shell = FILES.some(function (f) { return new URL(f, self.registration.scope).pathname === url.pathname; });
  if (!shell) return;                                   // papers and lists: app.js decides
  if (url.searchParams.has("v") || /\.png$/.test(url.pathname)) {
    // a release's file (or an icon): the saved copy, else the network (and saved for next time)
    e.respondWith(caches.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (r) {
        if (r.ok && url.searchParams.has("v")) dropOtherReleases(url);
        return save(e.request, r);
      });
      if (hit && /\.png$/.test(url.pathname)) net.catch(function () {});   // icons refresh in the background
      return hit || net;
    }));
    return;
  }
  // the page (and anything asked for without a release): the network, not the browser's cache; the saved
  // copy if the network is slow or away
  var net = fetch(new Request(url.href, {cache: "no-cache", credentials: "same-origin"})).then(function (r) { return save(e.request, r); });
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function give(r) { if (!done && r) { done = true; resolve(r); } }
    var timer = setTimeout(function () { caches.match(e.request, {ignoreSearch: true}).then(give); }, 2500);
    net.then(function (r) { clearTimeout(timer); give(r); }, function () {
      clearTimeout(timer);
      caches.match(e.request, {ignoreSearch: true}).then(function (r) { give(r || Response.error()); });
    });
  }));
});
