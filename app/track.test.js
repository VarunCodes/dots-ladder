// Run with: npm test  (or: node --test app/*.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import * as T from "./track.js";
import * as L from "./ladder.js";

test("usage counts: only the live site, only when switched on, and never against GPC or Do Not Track", () => {
  const on = { host: "dotsladder.app", analytics: undefined, gpc: false, dnt: null };
  assert.equal(T.shouldSend(on), true, "on by default");
  assert.equal(T.shouldSend({ ...on, analytics: true }), true);
  assert.equal(T.shouldSend({ ...on, analytics: false }), false, "switched off in Your data");
  assert.equal(T.shouldSend({ ...on, gpc: true }), false, "Global Privacy Control");
  assert.equal(T.shouldSend({ ...on, dnt: "1" }), false, "Do Not Track");
  for (const host of ["localhost", "127.0.0.1", "varuncodes.github.io", "dotsladder.app.example.com"]) {
    assert.equal(T.shouldSend({ ...on, host }), false, host);
  }
});

test("usage counts: an event is a name from the fixed list, sent as an event with nothing else", () => {
  const url = new URL(T.countUrl("first-visit/bench", "abc"));
  assert.equal(`${url.origin}${url.pathname}`, T.COUNT_URL);
  assert.deepEqual(Object.fromEntries(url.searchParams), { p: "first-visit/bench", t: "first-visit/bench", e: "true", rnd: "abc" });
  assert.equal(T.countUrl("first-visit/bench/120kg", "abc"), null, "not on the list");
  assert.equal(T.countUrl("log/saved?squat=150", "abc"), null);
});

test("usage counts: every first-visit screen and tab has an event, and no event name holds a digit", () => {
  for (const screen of L.FIRST_VISIT_SCREENS) assert.ok(T.EVENTS.has(`first-visit/${screen}`), screen);
  for (const route of L.ROUTES) assert.ok(T.EVENTS.has(`tab/${route}`), route);
  for (const name of T.EVENTS) assert.doesNotMatch(name, /\d/, `${name} could carry a number`);
});

test("usage counts: only track.js contacts GoatCounter, and every event sent is on the list", () => {
  const files = readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
  const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
  for (const file of files.filter((f) => f !== "track.js")) {
    assert.doesNotMatch(source(file), /goatcounter|sendBeacon/i, `${file} sends counts itself`);
  }
  // Literal names passed to track() must be on the list (first-visit screens are built from the screen list).
  for (const file of files) {
    for (const [, name] of source(file).matchAll(/\btrack\("([^"]+)"\)/g)) assert.ok(T.EVENTS.has(name), `${file}: ${name}`);
  }
});

test("usage counts: the switch is a setting, kept only when it's true or false", () => {
  assert.equal(L.settingsOf({ analytics: false }).analytics, false);
  assert.equal(L.settingsOf({ analytics: true }).analytics, true);
  assert.equal("analytics" in L.settingsOf({ analytics: "no" }), false);
  assert.equal("analytics" in L.settingsOf(null), false, "on by default, so nothing saved");
});
