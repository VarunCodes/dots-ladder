// Run with: npm test  (or: node --test app/*.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as L from "./ladder.js";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));

const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);

// --- DOTS: same values as pipeline/test_build_rungs.py ----------------------

test("DOTS matches the pipeline for men and women", () => {
  near(L.dots("M", 70, 370), 277.93, 0.01);
  near(L.dots("F", 60, 300), 332.56, 0.01);
});

test("DOTS clamps bodyweight like the pipeline", () => {
  assert.equal(L.dots("M", 20, 300), L.dots("M", 40, 300));
  assert.equal(L.dots("M", 250, 300), L.dots("M", 210, 300));
});

test("totalForDots inverts dots", () => {
  near(L.totalForDots("M", 70, L.dots("M", 70, 412.5)), 412.5, 1e-9);
});

// --- Grouping ------------------------------------------------------------------

test("weight class boundaries match the pipeline", () => {
  assert.deepEqual(
    [66, 66.1, 74, 130].map((bw) => L.weightClass("M", bw)),
    ["66", "74", "74", "120+"],
  );
});

test("experience counts only meets with a result", () => {
  assert.equal(L.experienceBucket([]), "first meet");
  assert.equal(L.experienceBucket([{ result: null }]), "first meet");
  assert.equal(L.experienceBucket([{ result: {} }]), "second meet");
  assert.equal(L.experienceBucket([{ result: {} }, { result: {} }, { result: {} }]), "3+ meets");
});

// --- Lifts and bodyweight --------------------------------------------------------

test("latest bodyweight is the most recent entry, not the last listed", () => {
  const log = [{ date: "2026-11-01", kg: 71 }, { date: "2026-10-01", kg: 69 }];
  assert.equal(L.latestBodyweight(log), 71);
  assert.equal(L.latestBodyweight([]), null);
});

test("current lifts take the heaviest per lift", () => {
  const bests = [
    { lift: "squat", kg: 115 }, { lift: "squat", kg: 120 },
    { lift: "bench", kg: 100 }, { lift: "deadlift", kg: 150 },
  ];
  assert.deepEqual(L.currentLifts(bests), { squat: 120, bench: 100, deadlift: 150 });
  assert.equal(L.sumLifts(L.currentLifts(bests)), 370);
});

test("current lifts are null until all three are logged", () => {
  assert.equal(L.currentLifts([{ lift: "squat", kg: 120 }]), null);
});

// --- Rungs ---------------------------------------------------------------------

const sample = {
  rungs: [
    { sex: "M", weightClassKg: "74", experience: "first meet", lifters: 30, p25: 300, p50: 338, p75: 368 },
  ],
};

test("rungsFor returns the group's percentiles lowest first", () => {
  const group = L.rungsFor(sample, "M", "74", "first meet");
  assert.equal(group.lifters, 30);
  assert.deepEqual(group.rungs.map((r) => r.percentile), [25, 50, 75]);
  assert.equal(L.rungsFor(sample, "F", "74", "first meet"), null);
});

test("nextRung is the first rung strictly above the score", () => {
  const { rungs } = L.rungsFor(sample, "M", "74", "first meet");
  assert.equal(L.nextRung(rungs, 250).percentile, 25);
  assert.equal(L.nextRung(rungs, 300).percentile, 50);
  assert.equal(L.nextRung(rungs, 400), null);
});

// --- Editable profile ------------------------------------------------------------

const me70 = { sex: "M", bodyweight: 70, squat: 120, bench: 100, deadlift: 150, weightClass: null };

/** A stand-in for localStorage; `fail` makes every call throw, like blocked storage. */
function fakeStorage(initial = {}, { fail = false } = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => { if (fail) throw new Error("blocked"); return data.get(key) ?? null; },
    setItem: (key, value) => { if (fail) throw new Error("blocked"); data.set(key, value); },
  };
}

test("weight classes list every IPF class plus the open class, lightest first", () => {
  assert.deepEqual(L.weightClasses("M"), ["59", "66", "74", "83", "93", "105", "120", "120+"]);
  assert.deepEqual(L.weightClasses("F"), ["47", "52", "57", "63", "69", "76", "84", "84+"]);
});

test("class comes from bodyweight unless one is chosen", () => {
  assert.equal(L.effectiveClass(me70), "74");
  assert.equal(L.effectiveClass({ ...me70, weightClass: "66" }), "66");
  assert.equal(L.effectiveClass({ ...me70, bodyweight: 74.01 }), "83");
});

test("choosing a lighter class flags the weight to make; heavier or open classes don't", () => {
  assert.equal(L.overClassLimit({ ...me70, weightClass: "66" }), 66);
  assert.equal(L.overClassLimit(me70), null);
  assert.equal(L.overClassLimit({ ...me70, weightClass: "83" }), null);
  assert.equal(L.overClassLimit({ ...me70, bodyweight: 130, weightClass: "120+" }), null);
});

test("a valid profile is kept, with only the known fields", () => {
  assert.deepEqual(L.validProfile({ ...me70, weightClass: "66", extra: "dropped" }), { ...me70, weightClass: "66" });
});

test("profiles with a missing or out-of-range value are rejected", () => {
  for (const bad of [
    null, "text", { ...me70, sex: "X" },
    { ...me70, bodyweight: 0 }, { ...me70, bodyweight: 251 }, { ...me70, bodyweight: "70" },
    { ...me70, squat: 0 }, { ...me70, bench: -100 }, { ...me70, deadlift: 601 }, { ...me70, squat: NaN },
    { sex: "M", bodyweight: 70, squat: 120, bench: 100 },
  ]) {
    assert.equal(L.validProfile(bad), null, JSON.stringify(bad));
  }
});

test("invalid fields are named, so the page can say what to fix", () => {
  assert.deepEqual(L.invalidFields(me70), []);
  assert.deepEqual(L.invalidFields({ ...me70, bodyweight: -58, deadlift: 0 }), ["bodyweight", "deadlift"]);
  assert.deepEqual(L.invalidFields({ ...me70, sex: "X", bench: NaN }), ["sex", "bench"]);
  assert.deepEqual(L.invalidFields(null), ["sex", "bodyweight", "squat", "bench", "deadlift"]);
});

test("a class that doesn't exist for the sex falls back to working it out from bodyweight", () => {
  assert.equal(L.validProfile({ ...me70, weightClass: "63" }).weightClass, null);
  assert.equal(L.validProfile({ ...me70, weightClass: 74 }).weightClass, null, "class labels are strings");
});

test("the default profile comes from the logged bodyweight and best lifts", () => {
  const me = {
    sex: "M",
    bodyweightLog: [{ date: "2026-10-27", kg: 70 }, { date: "2026-09-01", kg: 72 }],
    bests: [{ lift: "squat", kg: 115 }, { lift: "squat", kg: 120 }, { lift: "bench", kg: 100 }, { lift: "deadlift", kg: 150 }],
  };
  assert.deepEqual(L.defaultProfile(me), me70);
});

test("saved profile round-trips through storage", () => {
  const storage = fakeStorage();
  assert.equal(L.saveProfile(storage, { ...me70, weightClass: "66" }), true);
  assert.deepEqual(L.loadProfile(storage, me70), { ...me70, weightClass: "66" });
});

test("loading falls back when nothing is saved, the JSON is corrupt, the values are invalid or storage is blocked", () => {
  const fallback = { ...me70 };
  assert.equal(L.loadProfile(fakeStorage(), fallback), fallback);
  assert.equal(L.loadProfile(fakeStorage({ [L.PROFILE_KEY]: "{not json" }), fallback), fallback);
  assert.equal(L.loadProfile(fakeStorage({ [L.PROFILE_KEY]: JSON.stringify({ ...me70, squat: -1 }) }), fallback), fallback);
  assert.equal(L.loadProfile(fakeStorage({}, { fail: true }), fallback), fallback);
});

test("an invalid profile isn't saved, and blocked storage reports failure", () => {
  const storage = fakeStorage();
  assert.equal(L.saveProfile(storage, { ...me70, bench: 0 }), false);
  assert.equal(storage.data.size, 0);
  assert.equal(L.saveProfile(fakeStorage({}, { fail: true }), me70), false);
});

// --- Events --------------------------------------------------------------------

const lifts = (squat, bench, deadlift) => ({ squat, bench, deadlift });
const may = { id: "may", name: "", month: "2027-05", bodyweight: 70, conservative: lifts(138, 107, 168), optimistic: lifts(154, 111, 184) };
const empty = lifts(NaN, NaN, NaN); // what an untouched form scenario reads as

test("months: this month in local time, and the month after", () => {
  assert.equal(L.monthOf(new Date(2026, 9, 28)), "2026-10");
  assert.equal(L.nextMonth("2026-10"), "2026-11");
  assert.equal(L.nextMonth("2026-12"), "2027-01");
});

test("a valid event is kept with only the known fields, and an empty scenario becomes null", () => {
  assert.deepEqual(L.validEvent({ ...may, extra: 1 }), may);
  assert.deepEqual(L.validEvent({ ...may, name: "  Spring test  ", optimistic: empty }), { ...may, name: "Spring test", optimistic: null });
  assert.deepEqual(L.validEvent({ ...may, name: undefined }), may, "the name is optional");
});

test("event problems name each wrong value", () => {
  assert.deepEqual(L.eventProblems(may), []);
  assert.deepEqual(L.eventProblems({ ...may, month: "2027-13" }), ["month"]);
  assert.deepEqual(L.eventProblems({ ...may, month: "" }), ["month"]);
  assert.deepEqual(L.eventProblems({ ...may, bodyweight: 0 }), ["bodyweight"]);
  assert.deepEqual(L.eventProblems({ ...may, name: "x".repeat(41) }), ["name"]);
  assert.deepEqual(L.eventProblems({ ...may, optimistic: lifts(154, NaN, 0) }), ["optimistic.bench", "optimistic.deadlift"]);
});

test("an event needs at least one scenario", () => {
  assert.deepEqual(L.eventProblems({ ...may, conservative: null, optimistic: empty }), ["scenarios"]);
  assert.deepEqual(L.eventProblems({ ...may, conservative: null }), [], "optimistic alone is fine");
  assert.equal(L.validEvent({ ...may, conservative: empty, optimistic: empty }), null);
});

test("an event without an id isn't valid", () => {
  assert.equal(L.validEvent({ ...may, id: "" }), null);
  assert.equal(L.validEvent({ ...may, id: undefined }), null);
});

test("event scores use the event's bodyweight, one per scenario given", () => {
  const scores = L.eventScores(may, "M");
  assert.deepEqual(scores.map((s) => [s.scenario, s.total]), [["conservative", 413], ["optimistic", 449]]);
  assert.equal(scores[0].dots.toFixed(1), "310.2");
  const lighter = L.eventScores({ ...may, bodyweight: 66, optimistic: null }, "M");
  assert.equal(lighter.length, 1);
  assert.ok(lighter[0].dots > scores[0].dots, "the same total at a lighter bodyweight scores higher");
});

test("the ladder shows the next three events from this month on, soonest first", () => {
  const at = (id, month) => ({ ...may, id, month });
  const events = [at("e", "2027-09"), at("past", "2026-09"), at("b", "2026-11"), at("now", "2026-10"), at("d", "2027-05"), at("c", "2027-01")];
  assert.deepEqual(L.ladderEvents(events, "2026-10").map((e) => e.id), ["now", "b", "c"]);
  assert.deepEqual(L.ladderEvents([at("past", "2026-09")], "2026-10"), []);
});

test("an event in a different class from the ladder is flagged", () => {
  assert.equal(L.eventClass(may, me70), null);
  assert.equal(L.eventClass({ ...may, bodyweight: 66 }, me70), "66");
  assert.equal(L.eventClass({ ...may, bodyweight: 66 }, { ...me70, weightClass: "66" }), null);
});

test("rungBeaten is the highest rung at or below the score", () => {
  const { rungs } = L.rungsFor(sample, "M", "74", "first meet");
  assert.equal(L.rungBeaten(rungs, 299), null);
  assert.equal(L.rungBeaten(rungs, 300).percentile, 25);
  assert.equal(L.rungBeaten(rungs, 400).percentile, 75);
});

test("saved events round-trip; invalid entries are dropped; an empty list stays empty", () => {
  const storage = fakeStorage();
  assert.equal(L.saveEvents(storage, [may]), true);
  assert.deepEqual(L.loadEvents(storage, []), [may]);
  storage.data.set(L.EVENTS_KEY, JSON.stringify([may, { ...may, id: "bad", month: "nope" }]));
  assert.deepEqual(L.loadEvents(storage, []), [may]);
  assert.equal(L.saveEvents(storage, []), true);
  assert.deepEqual(L.loadEvents(storage, [may]), [], "deleting every event is kept, not reset");
});

test("events fall back when nothing is saved, the JSON is corrupt or storage is blocked; invalid ones aren't saved", () => {
  const fallback = [may];
  assert.equal(L.loadEvents(fakeStorage(), fallback), fallback);
  assert.equal(L.loadEvents(fakeStorage({ [L.EVENTS_KEY]: "{not json" }), fallback), fallback);
  assert.equal(L.loadEvents(fakeStorage({ [L.EVENTS_KEY]: "{}" }), fallback), fallback);
  assert.equal(L.loadEvents(fakeStorage({}, { fail: true }), fallback), fallback);
  assert.equal(L.saveEvents(fakeStorage(), [{ ...may, bodyweight: -1 }]), false);
  assert.equal(L.saveEvents(fakeStorage({}, { fail: true }), [may]), false);
});

// --- Contract: the committed JSON files work with the page ------------------------

test("committed data files give the user a full ladder", () => {
  const rungs = readJson("../data/rungs.json");
  const me = readJson("../data/my-lifts.json");
  const bw = L.latestBodyweight(me.bodyweightLog);
  assert.ok(bw > 0, "my-lifts.json needs a bodyweight");
  assert.ok(L.currentLifts(me.bests), "my-lifts.json needs a squat, bench and deadlift");
  for (const experience of L.EXPERIENCE) {
    const group = L.rungsFor(rungs, me.sex, L.weightClass(me.sex, bw), experience);
    assert.ok(group?.rungs.some((r) => r.percentile === 50), `no median rung for ${experience}`);
  }
});

test("committed meets and events are month-only, never an exact date", () => {
  const me = readJson("../data/my-lifts.json");
  for (const item of [...me.meets, ...(me.events ?? [])]) {
    assert.match(item.month, /^\d{4}-\d{2}$/);
    assert.ok(!("date" in item), "meets and events must not carry an exact date");
  }
});

test("every committed event is valid, so none is silently dropped", () => {
  const me = readJson("../data/my-lifts.json");
  assert.equal(L.defaultEvents(me).length, (me.events ?? []).length);
});

test("every committed rung is aggregate only", () => {
  const allowed = new Set(["sex", "weightClassKg", "experience", "lifters", "p10", "p25", "p50", "p75", "p90"]);
  for (const rung of readJson("../data/rungs.json").rungs) {
    for (const key of Object.keys(rung)) assert.ok(allowed.has(key), `unexpected field ${key}`);
    assert.ok(rung.lifters >= 20, "group under 20 lifters");
    if ("p10" in rung || "p90" in rung) assert.ok(rung.lifters >= 50, "p10/p90 on a group under 50");
  }
});

test("every class in the rungs can be chosen in the class dropdown", () => {
  for (const { sex, weightClassKg } of readJson("../data/rungs.json").rungs) {
    assert.ok(L.weightClasses(sex).includes(weightClassKg), `${sex} ${weightClassKg} kg can't be chosen`);
  }
});

test("my-lifts.json gives a valid starting profile", () => {
  assert.ok(L.defaultProfile(readJson("../data/my-lifts.json")), "my-lifts.json doesn't make a valid profile");
});
