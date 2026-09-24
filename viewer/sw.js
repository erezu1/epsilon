// latex2mobile app: keeps the app itself available offline (papers saved for offline reading are kept
// by app.js in their own cache). Network first, so a new version of the app is picked up at once.
var SHELL = "l2m-shell-v4";
var FILES = ["./", "index.html", "theme.css", "theme.json", "prefs.js", "nav.js", "viewer.js", "app.js",
             "manifest.webmanifest", "icon-192.png", "apple-touch-icon.png", "favicon.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.indexOf("/__offline/") >= 0) return;
  var shell = FILES.some(function (f) { return new URL(f, self.registration.scope).pathname === url.pathname; });
  if (!shell) return;                                   // papers and lists: app.js decides
  if (/\.png$/.test(url.pathname)) {        // icons: the saved copy at once, refreshed in the background
    e.respondWith(caches.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (r) { var c = r.clone(); caches.open(SHELL).then(function (s) { s.put(e.request, c); }); return r; });
      return hit || net;
    }));
    return;
  }
  // always ask the server (not the browser's cache), so a new version of the app is picked up at once
  e.respondWith(fetch(new Request(url.href, {cache: "no-cache", credentials: "same-origin"})).then(function (r) {
    var copy = r.clone();
    caches.open(SHELL).then(function (c) { c.put(e.request, copy); });
    return r;
  }, function () {
    return caches.match(e.request, {ignoreSearch: true});
  }));
});
