// Run with: npm test  (or: node --test app/*.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as L from "./ladder.js";
import { FORMULA_IDS } from "./scoring.js";

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));

// The formulas themselves are tested in scoring.test.js.

// --- Grouping ------------------------------------------------------------------

test("weight class boundaries match the pipeline", () => {
  assert.deepEqual(
    [66, 66.1, 74, 130].map((bw) => L.weightClass("M", bw)),
    ["66", "74", "74", "120+"],
  );
});

// --- Lifts and bodyweight --------------------------------------------------------

// --- Rungs ---------------------------------------------------------------------

const sample = {
  rungs: [
    {
      sex: "M", weightClassKg: "74", experience: "first meet", lifters: 30,
      dots: { p25: 300, p50: 338, p75: 368 },
      gl: { p75: 73.6, p25: 60.1, p50: 67.6 },
    },
    { sex: "F", weightClassKg: "57", experience: "first meet", lifters: 25, dots: { p25: 280, p50: 320, p75: 350 } },
  ],
};

test("rungsFor returns the group's percentiles in one formula, lowest first", () => {
  const group = L.rungsFor(sample, "dots", "M", "74", "first meet");
  assert.equal(group.lifters, 30);
  assert.deepEqual(group.rungs, [{ percentile: 25, score: 300 }, { percentile: 50, score: 338 }, { percentile: 75, score: 368 }]);
  assert.deepEqual(L.rungsFor(sample, "gl", "M", "74", "first meet").rungs.map((r) => r.score), [60.1, 67.6, 73.6]);
  assert.equal(L.rungsFor(sample, "dots", "F", "74", "first meet"), null);
});

test("rungsFor never mixes formulas: a group without that formula's percentiles has no rungs", () => {
  assert.equal(L.rungsFor(sample, "gl", "F", "57", "first meet"), null);
  assert.equal(L.rungsFor(sample, "wilks", "M", "74", "first meet"), null);
});

test("nextRung is the first rung strictly above the score", () => {
  const { rungs } = L.rungsFor(sample, "dots", "M", "74", "first meet");
  assert.equal(L.nextRung(rungs, 250).percentile, 25);
  assert.equal(L.nextRung(rungs, 300).percentile, 50);
  assert.equal(L.nextRung(rungs, 400), null);
});

// --- Editable profile ------------------------------------------------------------

const me70 = { sex: "M", bodyweight: 70, squat: 120, bench: 100, deadlift: 150, weightClass: null, formula: "dots" };

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

test("a first-time form only flags values that have been entered", () => {
  const empty = { sex: "M", bodyweight: NaN, squat: NaN, bench: NaN, deadlift: NaN };
  assert.deepEqual(L.enteredProblems(empty), []);
  assert.deepEqual(L.enteredProblems({ ...empty, bodyweight: 0, squat: 120 }), ["bodyweight"]);
  assert.deepEqual(L.enteredProblems({ ...empty, bench: 900 }), ["bench"]);
  assert.equal(L.validProfile({ ...empty, bodyweight: 70, squat: 120, bench: 100 }), null, "not complete until all five are in");
});

test("the formula defaults to DOTS when it's missing or unknown, and GL is kept", () => {
  const { formula, ...old } = me70; // a profile saved before the toggle existed
  assert.equal(L.validProfile(old).formula, "dots");
  assert.equal(L.validProfile({ ...me70, formula: "wilks" }).formula, "dots");
  assert.equal(L.validProfile({ ...me70, formula: "gl" }).formula, "gl");
});

test("a saved profile without a formula loads as DOTS; GL round-trips", () => {
  const { formula, ...old } = me70;
  assert.deepEqual(L.loadProfile(fakeStorage({ [L.PROFILE_KEY]: JSON.stringify(old) }), null), me70);
  const storage = fakeStorage();
  L.saveProfile(storage, { ...me70, formula: "gl" });
  assert.equal(L.loadProfile(storage, null).formula, "gl");
});

test("the profile's score follows its formula", () => {
  assert.equal(L.profileScore(me70).toFixed(1), "277.9");
  assert.equal(L.profileScore({ ...me70, formula: "gl" }).toFixed(2), "55.92");
});

test("a class that doesn't exist for the sex falls back to working it out from bodyweight", () => {
  assert.equal(L.validProfile({ ...me70, weightClass: "63" }).weightClass, null);
  assert.equal(L.validProfile({ ...me70, weightClass: 74 }).weightClass, null, "class labels are strings");
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

test("event scores use the event's bodyweight and the chosen formula, one per scenario given", () => {
  const scores = L.eventScores(may, "M", "dots");
  assert.deepEqual(scores.map((s) => [s.scenario, s.total]), [["conservative", 413], ["optimistic", 449]]);
  assert.equal(scores[0].score.toFixed(1), "310.2");
  const lighter = L.eventScores({ ...may, bodyweight: 66, optimistic: null }, "M", "dots");
  assert.equal(lighter.length, 1);
  assert.ok(lighter[0].score > scores[0].score, "the same total at a lighter bodyweight scores higher");
  const inGl = L.eventScores(may, "M", "gl");
  assert.ok(inGl[0].score > 50 && inGl[0].score < 80, `GL, not DOTS: ${inGl[0].score}`);
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
  const { rungs } = L.rungsFor(sample, "dots", "M", "74", "first meet");
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

// --- Reference marker ------------------------------------------------------------

test("the reference marker is the gym-goer estimate for the selected sex, named by sex and labelled as an estimate", () => {
  assert.deepEqual(L.referenceMarker("M", "dots"), { label: "Male gym-goer (estimate)", score: 200 });
  assert.deepEqual(L.referenceMarker("F", "dots"), { label: "Female gym-goer (estimate)", score: 160 });
});

test("the gym-goer estimate is DOTS only: GL gets no marker rather than a second estimate", () => {
  assert.equal(L.referenceMarker("M", "gl"), null);
  assert.equal(L.referenceMarker("F", "gl"), null);
});

test("the gym-goer estimates stay below every published DOTS rung, so they never pass for one", () => {
  for (const rung of readJson("../data/rungs.json").rungs) {
    assert.ok(L.GYM_GOER_ESTIMATE[rung.sex] < (rung.dots.p10 ?? rung.dots.p25), `${rung.sex} ${rung.weightClassKg} ${rung.experience}`);
  }
});

// --- Ladder rows and the design spec's required cases --------------------------------

test("ladder rows: highest first, the next rung marked, cleared rungs below you, gaps from your score", () => {
  const rungs = [{ percentile: 10, score: 266 }, { percentile: 25, score: 300 }, { percentile: 50, score: 338 }];
  const rows = L.ladderRows(rungs, 277.9, [
    { kind: "you", label: "You", score: 277.9 },
    { kind: "reference", label: "Male gym-goer (estimate)", score: 200 },
  ]);
  assert.deepEqual(rows.map((r) => r.percentile ?? r.kind), [50, 25, "you", 10, "reference"]);
  assert.deepEqual(rows.filter((r) => r.kind === "rung").map((r) => r.state), ["above", "next", "cleared"]);
  assert.equal(rows[1].gap.toFixed(1), "22.1");
  assert.equal(rows.at(-1).gap.toFixed(1), "-77.9");
});

test("ladder rows: above every rung there is no next rung; a tie puts the rung above the marker", () => {
  const rungs = [{ percentile: 50, score: 300 }];
  assert.equal(L.ladderRows(rungs, 400, []).find((r) => r.state === "next"), undefined);
  const tie = L.ladderRows(rungs, 300, [{ kind: "you", label: "You", score: 300 }]);
  assert.deepEqual(tie.map((r) => r.kind), ["rung", "you"]);
  assert.equal(tie[0].state, "cleared", "reaching a rung's score clears it");
});

test("every published percentile has a name", () => {
  for (const rung of readJson("../data/rungs.json").rungs) {
    for (const formula of FORMULA_IDS) {
      for (const key of Object.keys(rung[formula])) assert.ok(L.RUNG_NAMES[Number(key.slice(1))], `no name for ${formula} ${key}`);
    }
  }
});

// --- Screens and steppers -------------------------------------------------------

test("routes come from the hash; anything unknown is the Ladder", () => {
  assert.equal(L.routeFrom("#/log"), "log");
  assert.equal(L.routeFrom("#/progress"), "progress");
  assert.equal(L.routeFrom("#/ladder"), "ladder");
  assert.equal(L.routeFrom("#/log?class"), "log", "a query after the route is ignored");
  for (const hash of ["", "#", "#/", "#/nope", undefined]) assert.equal(L.routeFrom(hash), "ladder", String(hash));
});

test("a stepper press moves by its step, keeps one decimal place and stays in range", () => {
  assert.equal(L.stepValue(70, 0.1, 1, L.LIMITS.bodyweight), 70.1);
  assert.equal(L.stepValue(70.1, 0.1, -1, L.LIMITS.bodyweight), 70, "no 70.00000001");
  assert.equal(L.stepValue(120, 2.5, 1, L.LIMITS.lift), 122.5);
  assert.equal(L.stepValue(1, 2.5, -1, L.LIMITS.lift), 1, "never below the minimum");
  assert.equal(L.stepValue(599, 2.5, 1, L.LIMITS.lift), 600, "never above the maximum");
  assert.equal(L.stepValue(NaN, 2.5, 1, L.LIMITS.lift), 1, "an empty field starts at the minimum");
});

test("rungs climbed counts rungs passed, positive up and negative down", () => {
  const rungs = [{ percentile: 10, score: 266 }, { percentile: 25, score: 300 }, { percentile: 50, score: 338 }];
  assert.equal(L.rungsClimbed(rungs, 277.9, 310), 1);
  assert.equal(L.rungsClimbed(rungs, 250, 340), 3);
  assert.equal(L.rungsClimbed(rungs, 277.9, 300), 1, "reaching a rung's score clears it");
  assert.equal(L.rungsClimbed(rungs, 310, 270), -1);
  assert.equal(L.rungsClimbed(rungs, 277.9, 280), 0);
});

// --- Contract: the committed JSON files work with the page ------------------------

test("every committed rung is aggregate only, with the same percentiles in every formula", () => {
  const allowed = new Set(["sex", "weightClassKg", "experience", "lifters", ...FORMULA_IDS]);
  const percentiles = new Set(["p10", "p25", "p50", "p75", "p90"]);
  for (const rung of readJson("../data/rungs.json").rungs) {
    const where = `${rung.sex} ${rung.weightClassKg} ${rung.experience}`;
    for (const key of Object.keys(rung)) assert.ok(allowed.has(key), `unexpected field ${key}`);
    assert.ok(rung.lifters >= 20, "group under 20 lifters");
    const keys = Object.keys(rung.dots);
    for (const formula of FORMULA_IDS) {
      assert.deepEqual(Object.keys(rung[formula]).sort(), [...keys].sort(), `${where}: ${formula} has different percentiles`);
    }
    for (const key of keys) assert.ok(percentiles.has(key), `${where}: unexpected percentile ${key}`);
    if ("p10" in rung.dots || "p90" in rung.dots) assert.ok(rung.lifters >= 50, "p10/p90 on a group under 50");
  }
});

test("committed rungs are rounded: DOTS to whole points, GL to 1 decimal place, rising with the percentile", () => {
  for (const rung of readJson("../data/rungs.json").rungs) {
    const where = `${rung.sex} ${rung.weightClassKg} ${rung.experience}`;
    for (const value of Object.values(rung.dots)) assert.ok(Number.isInteger(value), `${where}: DOTS ${value}`);
    for (const value of Object.values(rung.gl)) assert.equal(Math.round(value * 10) / 10, value, `${where}: GL ${value}`);
    for (const formula of FORMULA_IDS) {
      const scores = L.rungsFor({ rungs: [rung] }, formula, rung.sex, rung.weightClassKg, rung.experience).rungs.map((r) => r.score);
      assert.deepEqual(scores, [...scores].sort((x, y) => x - y), `${where}: ${formula} percentiles out of order`);
    }
  }
});

test("every class in the rungs can be chosen in the class dropdown", () => {
  for (const { sex, weightClassKg } of readJson("../data/rungs.json").rungs) {
    assert.ok(L.weightClasses(sex).includes(weightClassKg), `${sex} ${weightClassKg} kg can't be chosen`);
  }
});
