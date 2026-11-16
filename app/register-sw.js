// Registers the service worker (sw.js), so the app opens offline. A file of its own, not inline in index.html,
// because the Content-Security-Policy allows no inline scripts. Paths resolve against the page, so "sw.js" is the
// one at the site root.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
