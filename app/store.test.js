// Run with: npm test  (or: node --test app/*.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import * as store from "./store.js";
import * as L from "./ladder.js";
import { derived } from "./derive.js";

/** A stand-in for localStorage; `fail` makes every call throw, like blocked storage. */
function fakeStorage(initial = {}, { fail = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => { if (fail) throw new Error("blocked"); return data.get(key) ?? null; },
    setItem: (key, value) => { if (fail) throw new Error("blocked"); data.set(key, value); },
    removeItem: (key) => { if (fail) throw new Error("blocked"); data.delete(key); },
  };
}

const json = (value) => JSON.stringify(value);
const today = "2026-10-30";
const settings = { weightClass: "66", formula: "gl", targetBw: 64 };
const first = { id: "a", date: "2026-08-01", sex: "M", bodyweight: 70, squat: 120, bench: 100, deadlift: 150 };
const squatPr = { id: "b", date: "2026-10-01", sex: "M", squat: 130 };
const event = { id: "e", name: "Spring meet", month: "2027-04", date: "2027-04-10", bodyweight: 70, conservative: { squat: 135, bench: 105, deadlift: 160 }, optimistic: null };
const view = { metric: "lifts", lift: "bench", range: "3m" };

// What a phone running the version before this one has saved: four keys.
const v1 = (overrides = {}) =>
  fakeStorage({
    [store.V1_KEYS.profile]: json(settings),
    [store.V1_KEYS.tests]: json([squatPr, first]),
    [store.V1_KEYS.events]: json([event]),
    [store.V1_KEYS.view]: json(view),
    ...overrides,
  });

// --- Migration: version 1's four keys → one key -------------------------------------------

test("a version 1 save migrates with nothing lost", () => {
  const { data, from } = store.readSaved(v1(), today);
  assert.equal(from, "v1");
  assert.deepEqual(data, { settings, entries: [first, squatPr], events: [event], view });
});

test("an older profile with numbers and no records becomes the first record, dated today", () => {
  const storage = fakeStorage({ [store.V1_KEYS.profile]: json({ ...first, weightClass: null, formula: "dots" }) });
  const { data } = store.readSaved(storage, today);
  assert.deepEqual(data.entries, [L.testFrom(first, today, "first")]);
  assert.deepEqual(data.settings, { weightClass: null, formula: "dots", targetBw: null }, "only the settings stay in settings");
});

test("records saved before records kept a sex take the older profile's", () => {
  const { sex, ...older } = first;
  const storage = v1({ [store.V1_KEYS.profile]: json({ ...first, sex: "M", weightClass: null }), [store.V1_KEYS.tests]: json([older]) });
  assert.equal(store.readSaved(storage, today).data.entries[0].sex, "M");
});

test("starting the store saves the migration under one key, and leaves version 1's keys in place", () => {
  const storage = v1();
  store.start({ today }, storage);
  const saved = JSON.parse(storage.data.get(store.DATA_KEY));
  assert.deepEqual(saved, { version: 2, settings, entries: [first, squatPr], events: [event], view });
  for (const key of Object.values(store.V1_KEYS)) assert.ok(storage.data.has(key), `${key} kept for an older cached app`);
  assert.equal(store.readSaved(storage, today).from, "v2", "next time, version 2 is read");
});

test("version 2 wins over version 1's keys once it exists", () => {
  const storage = v1({ [store.DATA_KEY]: json({ version: 2, settings: { formula: "dots" }, entries: [first], events: [], view: null }) });
  const { data, from } = store.readSaved(storage, today);
  assert.equal(from, "v2");
  assert.deepEqual(data.entries, [first]);
  assert.deepEqual(data.events, []);
});

test("nothing saved, corrupt JSON or blocked storage gives empty data, never an error", () => {
  const empty = store.emptyData();
  assert.deepEqual(store.readSaved(fakeStorage(), today), { data: empty, from: "none" });
  assert.deepEqual(store.readSaved(null, today), { data: empty, from: "none" });
  assert.deepEqual(store.readSaved(fakeStorage({}, { fail: true }), today), { data: empty, from: "none" });
  const corrupt = store.readSaved(fakeStorage({ [store.DATA_KEY]: "{not json", [store.V1_KEYS.tests]: "{not json" }), today);
  assert.deepEqual(corrupt.data, empty);
  assert.deepEqual(store.readSaved(fakeStorage({ [store.DATA_KEY]: json({ version: 3 }) }), today).data, empty, "an unknown version isn't read as version 2");
});

test("saving refuses invalid data, and reports full or blocked storage", () => {
  const data = { ...store.emptyData(), entries: [first] };
  assert.equal(store.writeSaved(fakeStorage(), data), true);
  assert.equal(store.writeSaved(fakeStorage(), { ...data, entries: [squatPr] }), false, "a history can't start without all four values");
  assert.equal(store.writeSaved(fakeStorage(), { ...data, events: [{ ...event, bodyweight: -1 }] }), false);
  assert.equal(store.writeSaved(fakeStorage({}, { fail: true }), data), false);
  assert.equal(store.writeSaved(null, data), false);
});

// --- The live store --------------------------------------------------------------------

test("update changes, saves and announces; invalid changes change nothing", () => {
  const storage = fakeStorage();
  store.start({ today, experience: "first meet" }, storage);
  const heard = [];
  const stop = store.subscribe((state) => heard.push(state.entries.length));
  assert.deepEqual(store.update(() => ({ entries: [first] })), { ok: true, saved: true });
  assert.deepEqual(JSON.parse(storage.data.get(store.DATA_KEY)).entries, [first]);
  assert.deepEqual(store.update((s) => ({ entries: [...s.entries, { ...squatPr, squat: -1 }] })), { ok: false, saved: false });
  assert.deepEqual(store.getState().entries, [first], "nothing changed");
  store.update((s) => ({ session: { ...s.session, experience: "3+ meets" } }));
  assert.equal(store.getState().session.experience, "3+ meets");
  assert.equal(JSON.parse(storage.data.get(store.DATA_KEY)).session, undefined, "the session is never saved");
  stop();
  store.update((s) => ({ entries: [...s.entries, squatPr] }));
  assert.deepEqual(heard, [1, 1], "heard both changes before stopping, not the one after");
});

test("entries are kept in date order, same-day ones in the order they were saved", () => {
  store.start({ today }, fakeStorage());
  const sameDay = { ...squatPr, id: "c", bench: 105 };
  store.update(() => ({ entries: [squatPr, first, sameDay] }));
  assert.deepEqual(store.getState().entries.map((e) => e.id), ["a", "b", "c"]);
});

test("settings and the view are cleaned on update", () => {
  store.start({ today }, fakeStorage());
  store.update(() => ({ settings: { formula: "wilks", targetBw: 64, squat: 120 }, view: { metric: "total" } }));
  assert.deepEqual(store.getState().settings, { weightClass: null, formula: "dots", targetBw: 64 });
  assert.deepEqual(store.getState().view, { metric: "lifts", lift: "total", range: "all" });
});

test("a refused save still changes the page (it lasts until the page closes) and says so", () => {
  store.start({ today }, fakeStorage({}, { fail: true }));
  assert.deepEqual(store.update(() => ({ entries: [first] })), { ok: true, saved: false });
  assert.deepEqual(store.getState().entries, [first]);
});

test("clearing your numbers forgets records and settings, keeps events and the view, and removes version 1's numbers", () => {
  const storage = v1();
  store.start({ today }, storage);
  store.clearNumbers();
  const state = store.getState();
  assert.deepEqual([state.entries, state.settings, state.events, state.view], [[], store.emptyData().settings, [event], view]);
  assert.ok(!storage.data.has(store.V1_KEYS.profile) && !storage.data.has(store.V1_KEYS.tests), "version 1's numbers can't be migrated back");
  assert.equal(store.readSaved(storage, today).data.entries.length, 0, "a reload stays cleared");
});

// --- Derived values ----------------------------------------------------------------------

const rungsData = JSON.parse(readFileSync(new URL("../data/rungs.json", import.meta.url)));

test("derived values match the pure functions the screens used before", () => {
  store.start({ today, thisMonth: "2026-10", experience: "first meet", rungs: rungsData }, fakeStorage());
  store.update(() => ({ entries: [first, squatPr], events: [event], settings: { formula: "dots" } }));
  const d = derived(store.getState());
  assert.deepEqual(d.profile, { sex: "M", bodyweight: 70, squat: 130, bench: 100, deadlift: 150, weightClass: null, formula: "dots", targetBw: null });
  assert.equal(d.score.toFixed(1), L.profileScore(d.profile).toFixed(1));
  assert.deepEqual(d.group, L.rungsFor(rungsData, "dots", "M", "74", "first meet"));
  assert.deepEqual(d.points.map((p) => [p.id, p.test.squat]), [["a", 120], ["b", 130]], "carried forward");
  assert.deepEqual([...d.prDays("squat")], ["2026-10-01"]);
  assert.deepEqual(d.liftRungs("bench"), L.liftRungsFor(rungsData, "bench", "M", "74", "first meet").rungs);
  assert.deepEqual(d.eventScores("e").map((s) => s.total), [400]);
  assert.equal(d.nextMeet.event.id, "e");
  assert.equal(derived(store.getState()), d, "worked out once per state");
  store.update((s) => ({ settings: { ...s.settings, formula: "gl" } }));
  assert.notEqual(derived(store.getState()), d, "a change gives new values");
  assert.equal(derived(store.getState()).score.toFixed(2), L.profileScore({ ...d.profile, formula: "gl" }).toFixed(2));
});

test("no records: no profile, and nothing that needs one", () => {
  store.start({ today, rungs: rungsData }, fakeStorage());
  const d = derived(store.getState());
  assert.equal(d.profile, null);
  assert.equal(d.score, null);
  assert.deepEqual(d.points, []);
});

// --- Guardrails: the architecture rules, enforced ------------------------------------------

const appFiles = readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"));
const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

test("only the store touches the browser's storage", () => {
  for (const file of appFiles.filter((f) => f !== "store.js")) {
    assert.doesNotMatch(source(file), /localStorage|sessionStorage|\.getItem\(|\.setItem\(|\.removeItem\(/, `${file} touches storage`);
  }
});

test("only the scoring module holds formula coefficients", () => {
  // DOTS's men's "a" and GL's men's classic "A": either appearing elsewhere means a copied formula.
  for (const file of appFiles.filter((f) => f !== "scoring.js")) {
    assert.doesNotMatch(source(file), /0\.0000010930?|1199\.72839/, `${file} holds formula coefficients`);
  }
});
