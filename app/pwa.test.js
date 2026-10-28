// Contract tests for the installable app: the manifest, its icons and the service worker's file list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const manifest = JSON.parse(read("manifest.webmanifest"));
const indexHtml = read("index.html").toString();

// Relative paths only: Pages serves the site under /dots-ladder/, not the domain root.
const isRelative = (path) => !/^(\/|[a-z]+:)/i.test(path);

/** PNG width and height, from the IHDR chunk. */
function pngSize(path) {
  const bytes = read(path);
  assert.equal(bytes.toString("latin1", 1, 4), "PNG", `${path} isn't a PNG`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

/** The PRECACHE list from sw.js, run with a stub `self` so nothing registers. */
function precacheList() {
  const context = vm.createContext({ self: { addEventListener() {} } });
  return vm.runInContext(`${read("sw.js")}\nPRECACHE`, context);
}

test("manifest has what Chrome needs to offer install", () => {
  for (const field of ["name", "short_name", "start_url", "scope", "display", "theme_color", "background_color"]) {
    assert.ok(manifest[field], `manifest needs ${field}`);
  }
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
});

test("manifest icons exist, match their declared sizes and include a maskable one", () => {
  for (const icon of manifest.icons) {
    assert.ok(isRelative(icon.src), `${icon.src} must be a relative path`);
    assert.ok(existsSync(new URL(icon.src, root)), `${icon.src} is missing`);
    assert.equal(pngSize(icon.src), icon.sizes, `${icon.src} size`);
  }
  const any = manifest.icons.filter((icon) => (icon.purpose ?? "any").split(" ").includes("any"));
  assert.deepEqual(new Set(any.map((icon) => icon.sizes)), new Set(["192x192", "512x512"]));
  assert.ok(manifest.icons.some((icon) => icon.purpose?.split(" ").includes("maskable")), "no maskable icon");
});

test("index.html links the manifest and registers the service worker", () => {
  assert.match(indexHtml, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(indexHtml, /serviceWorker\.register\("sw\.js"\)/);
});

test("every file the service worker caches exists", () => {
  for (const path of precacheList()) {
    assert.ok(isRelative(path), `${path} must be a relative path`);
    assert.ok(existsSync(new URL(path === "./" ? "index.html" : path, root)), `${path} is missing`);
  }
});

test("the service worker caches every file the page loads, so it opens offline", () => {
  const cached = new Set(precacheList());
  // In-page references like href="#icon-squat" (the SVG sprite) aren't files.
  const htmlRefs = [...indexHtml.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((ref) => isRelative(ref) && !ref.startsWith("#"));
  const appJs = read("app/app.js").toString();
  const dataFiles = [...appJs.matchAll(/loadJson\("([^"]+)"\)/g)].map((m) => m[1]);
  // Every module app.js pulls in, following imports through each module (all live in app/).
  const imports = new Set();
  const follow = (path) => {
    for (const [, file] of read(path).toString().matchAll(/from "\.\/([^"]+)"/g)) {
      const module = `app/${file}`;
      if (imports.has(module)) continue;
      imports.add(module);
      follow(module);
    }
  };
  follow("app/app.js");
  const cssRefs = [...read("app/style.css").toString().matchAll(/url\("\.\.\/([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(cssRefs.length > 0, "found no files in style.css");
  assert.ok(dataFiles.length > 0, "found no data files in app.js");
  for (const path of [...htmlRefs, ...dataFiles, ...imports, ...cssRefs, ...manifest.icons.map((icon) => icon.src)]) {
    assert.ok(cached.has(path), `sw.js doesn't cache ${path}`);
  }
});

// --- Offline behaviour: sw.js's fetch handler, with a stub network and cache --------

const BASE = "https://example.test/dots-ladder/";

/** Runs sw.js against a fake network (online or not) and a cache seeded with `cached` (path -> body). */
function serviceWorker({ online, cached = {} }) {
  const store = new Map(Object.entries(cached).map(([path, body]) => [new URL(path, BASE).href, body]));
  const handlers = {};
  const fetches = [];
  const cache = {
    async match(request, options) {
      const url = new URL(typeof request === "string" ? request : request.url, BASE);
      if (options?.ignoreSearch) url.search = "";
      return store.has(url.href) ? new Response(store.get(url.href)) : undefined;
    },
    async put(request, response) {
      store.set(request.url, await response.text());
    },
  };
  const context = vm.createContext({
    URL,
    self: { addEventListener: (type, handler) => (handlers[type] = handler), location: { origin: new URL(BASE).origin } },
    caches: { open: async () => cache },
    fetch: async (request, init) => {
      fetches.push({ url: request.url, init });
      if (!online) throw new TypeError("Failed to fetch");
      return new Response(`fresh ${new URL(request.url).pathname}`);
    },
  });
  vm.runInContext(read("sw.js").toString(), context);

  /** Dispatches a fetch event; returns the response promise (or undefined if the worker passed) and its waitUntil promises. */
  function request(path, { mode = "cors", method = "GET" } = {}) {
    let response;
    const pending = [];
    handlers.fetch({
      request: { url: new URL(path, BASE).href, mode, method },
      respondWith: (promise) => (response = promise),
      waitUntil: (promise) => pending.push(promise),
    });
    return { response, settled: async () => Promise.all(pending) };
  }
  return { request, store, fetches };
}

test("online, the service worker serves the network copy and saves it for offline", async () => {
  const sw = serviceWorker({ online: true, cached: { "data/rungs.json": "old" } });
  const { response, settled } = sw.request("data/rungs.json");
  assert.equal(await (await response).text(), "fresh /dots-ladder/data/rungs.json");
  await settled();
  assert.equal(sw.store.get(`${BASE}data/rungs.json`), "fresh /dots-ladder/data/rungs.json");
  assert.equal(sw.fetches[0].init.cache, "no-cache", "must revalidate, not trust the HTTP cache");
});

test("offline, the service worker serves the saved copy", async () => {
  const sw = serviceWorker({ online: false, cached: { "data/rungs.json": "saved" } });
  const { response } = sw.request("data/rungs.json?v=2");
  assert.equal(await (await response).text(), "saved");
});

test("offline, opening any page in the app falls back to the saved start page", async () => {
  const sw = serviceWorker({ online: false, cached: { "./": "start page" } });
  const { response } = sw.request("index.html", { mode: "navigate" });
  assert.equal(await (await response).text(), "start page");
});

test("offline with nothing saved, the request fails instead of hanging", async () => {
  const sw = serviceWorker({ online: false });
  await assert.rejects(sw.request("app/app.js").response, TypeError);
});

test("the service worker leaves other sites and non-GET requests alone", () => {
  const sw = serviceWorker({ online: true });
  assert.equal(sw.request("https://www.openpowerlifting.org/").response, undefined);
  assert.equal(sw.request("data/rungs.json", { method: "POST" }).response, undefined);
});
