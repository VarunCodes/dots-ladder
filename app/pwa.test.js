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
  const htmlRefs = [...indexHtml.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter(isRelative);
  const appJs = read("app/app.js").toString();
  const dataFiles = [...appJs.matchAll(/loadJson\("([^"]+)"\)/g)].map((m) => m[1]);
  const imports = [...appJs.matchAll(/from "\.\/([^"]+)"/g)].map((m) => `app/${m[1]}`);
  assert.ok(dataFiles.length > 0, "found no data files in app.js");
  for (const path of [...htmlRefs, ...dataFiles, ...imports, ...manifest.icons.map((icon) => icon.src)]) {
    assert.ok(cached.has(path), `sw.js doesn't cache ${path}`);
  }
});
