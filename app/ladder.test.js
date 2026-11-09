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

const me70 = { sex: "M", bodyweight: 70, squat: 120, bench: 100, deadlift: 150, weightClass: null, formula: "dots", targetBw: null };

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

test("the profile's score follows its formula", () => {
  assert.equal(L.profileScore(me70).toFixed(1), "277.9");
  assert.equal(L.profileScore({ ...me70, formula: "gl" }).toFixed(2), "55.92");
});

test("a class that doesn't exist for the sex falls back to working it out from bodyweight", () => {
  assert.equal(L.validProfile({ ...me70, weightClass: "63" }).weightClass, null);
  assert.equal(L.validProfile({ ...me70, weightClass: 74 }).weightClass, null, "class labels are strings");
});

test("settings hold only the class, formula and target bodyweight: your numbers live in your records", () => {
  assert.deepEqual(L.settingsOf({ ...me70, weightClass: "66", formula: "gl", targetBw: 64 }), { weightClass: "66", formula: "gl", targetBw: 64 });
});

test("settings default when missing or invalid; a profile saved without a formula is DOTS", () => {
  assert.deepEqual(L.settingsOf(null), { weightClass: null, formula: "dots", targetBw: null });
  assert.deepEqual(L.settingsOf({ weightClass: 66, formula: "wilks", targetBw: 500 }), { weightClass: null, formula: "dots", targetBw: null });
  const { formula, ...old } = me70;
  assert.equal(L.settingsOf(old).formula, "dots");
});

test("a record without a sex borrows the old profile's, or another record's, rather than being dropped", () => {
  const { sex, ...older } = test1;
  assert.deepEqual(L.cleanTests([older, test2]).map((t) => t.sex), ["M", "M"]);
  assert.deepEqual(L.cleanTests([older], "F").map((t) => t.sex), ["F"], "the old profile's sex comes first");
});

test("a profile saved by an older version, numbers included, is read as legacy", () => {
  assert.deepEqual(L.legacyProfile({ ...me70, weightClass: "66" }), { ...me70, weightClass: "66" });
  assert.equal(L.legacyProfile({ weightClass: "66", formula: "dots", targetBw: null }), null, "settings alone aren't a legacy profile");
  assert.equal(L.legacyProfile(null), null);
});

test("your profile is your latest numbers from your records, with your settings", () => {
  const settings = { weightClass: "66", formula: "gl", targetBw: 64 };
  const tests = [test1, { id: "s", date: "2026-11-10", sex: "M", squat: 130 }];
  assert.deepEqual(L.currentProfile(settings, tests), { ...me70, squat: 130, weightClass: "66", formula: "gl", targetBw: 64 });
  assert.equal(L.currentProfile(settings, []), null, "no records yet: the first-visit form");
  assert.equal(L.currentProfile(settings, [{ ...test1, sex: "F" }]).weightClass, null, "a class that doesn't exist for the sex goes back to auto");
});

// --- Progress: weight-class lever and rung position ---------------------------------

test("the lever's default target is the top of the next lighter class", () => {
  assert.deepEqual([70, 66, 66.1, 59, 50, 130, 120].map((bw) => L.defaultTargetBw("M", bw)), [66, 59, 66, 59, 59, 120, 105]);
  assert.deepEqual([60, 47, 90].map((bw) => L.defaultTargetBw("F", bw)), [57, 47, 84]);
});

test("a target bodyweight is kept when it's a real bodyweight, otherwise it's the default (null)", () => {
  assert.equal(L.validProfile({ ...me70, targetBw: 66 }).targetBw, 66);
  for (const bad of [0, 251, "66", NaN, undefined]) assert.equal(L.validProfile({ ...me70, targetBw: bad }).targetBw, null, String(bad));
});

test("the lever's choices are the next lighter class, yours and the next heavier, at the top of each", () => {
  const kgs = (sex, bw) => L.leverClasses(sex, bw).map((c) => `${c.kg}${c.now ? " now" : ""}`);
  assert.deepEqual(kgs("M", 68), ["66", "74 now", "83"]);
  assert.deepEqual(kgs("M", 66), ["59", "66 now", "74"], "the top of a class is in it");
  assert.deepEqual(kgs("M", 50), ["59 now", "66"], "the lightest class has nothing lighter");
  assert.deepEqual(kgs("M", 115), ["105", "120 now"], "the open class has no top, so it's never a choice");
  assert.deepEqual(kgs("M", 130), ["120"], "in the open class, only the class below");
  assert.deepEqual(kgs("F", 60), ["57", "63 now", "69"]);
});

const me68 = { sex: "M", bodyweight: 68, squat: 110, bench: 120, deadlift: 160, weightClass: null, formula: "dots", targetBw: null };

test("the lever scores the same total in the chosen class, with the break-even total there", () => {
  const lighter = L.lever(me68);
  assert.equal(lighter.targetBw, 66, "the default is the next lighter class");
  assert.equal(lighter.now.toFixed(1), "299.0");
  assert.equal(lighter.then.toFixed(1), "305.6");
  assert.equal(lighter.delta.toFixed(1), "6.6");
  assert.equal(lighter.breakEven, 382.5, "381.6 rounded up to the next 2.5 kg");
  assert.equal(lighter.room, -7.5);

  const heavier = L.lever({ ...me68, targetBw: 74 });
  assert.equal(heavier.then.toFixed(1), "282.2");
  assert.equal(heavier.breakEven, 415, "413.2 rounded up");
  assert.equal(heavier.room, 25);

  const gl = (targetBw) => L.lever({ ...me68, formula: "gl", targetBw });
  assert.equal(gl(66).then.toFixed(2), "60.79");
  assert.equal(gl(66).breakEven, 385);
  assert.equal(gl(74).then.toFixed(2), "57.26");
  assert.equal(gl(74).breakEven, 410);
});

test("a saved target picks the class it falls in, or the default when that class isn't a choice", () => {
  assert.equal(L.lever({ ...me68, targetBw: 64 }).targetBw, 66, "an older bodyweight moves to its class");
  assert.equal(L.lever({ ...me68, targetBw: 83 }).targetBw, 83);
  assert.equal(L.lever({ ...me68, targetBw: 52 }).targetBw, 66, "two classes away isn't a choice");
  assert.equal(L.lever({ ...me68, targetBw: 130 }).targetBw, 66, "the open class isn't a choice");
  assert.equal(L.lever({ ...me68, bodyweight: 50 }).targetBw, 59, "in the lightest class, its own top");
});

test("the lever says where its score sits among the chosen class's rungs", () => {
  const rungs = { 66: [{ percentile: 25, score: 290 }, { percentile: 50, score: 338 }] };
  const asked = [];
  const result = L.lever(me68, (wclass) => (asked.push(wclass), rungs[wclass]));
  assert.deepEqual(asked, ["66"]);
  assert.equal(result.position, "between P25 and P50");
  assert.equal(L.lever({ ...me68, targetBw: 74 }, (wclass) => rungs[wclass]).position, "", "a class with no rungs has no position");
});

test("the lever's curve runs a few kilos past the choices, scoring your total at each", () => {
  const { curve } = L.lever(me68);
  assert.deepEqual([curve[0].bw, curve.at(-1).bw], [63, 86]);
  assert.equal(curve.find((p) => p.bw === 66).score.toFixed(1), "305.6");
  assert.ok(curve.every((p, i) => i === 0 || p.score < curve[i - 1].score), "a heavier bodyweight scores the same total lower");
});

test("rung position: between, below, above, or nothing without rungs", () => {
  const rungs = [{ percentile: 10, score: 266 }, { percentile: 25, score: 300 }];
  assert.equal(L.rungPosition(rungs, 277.9), "between P10 and P25");
  assert.equal(L.rungPosition(rungs, 300), "above P25", "reaching a rung clears it");
  assert.equal(L.rungPosition(rungs, 200), "below P10");
  assert.equal(L.rungPosition([], 277.9), "");
});

test("the chart view is cleaned, with anything unknown back to Score, Total and All", () => {
  const fallback = { metric: "score", lift: "total", range: "all" };
  assert.deepEqual(L.cleanView(null), fallback, "nothing saved");
  assert.deepEqual(L.cleanView({ metric: "lifts", lift: "squat", range: "3m", extra: 1 }), { metric: "lifts", lift: "squat", range: "3m" });
  assert.deepEqual(L.cleanView({ metric: "wilks", lift: "curl", range: "1y" }), fallback);
  assert.deepEqual(L.cleanView({ metric: "total", range: "3m" }), { metric: "lifts", lift: "total", range: "3m" }, "the old Total tab opens as Lifts → Total");
});

// --- Test history ----------------------------------------------------------------

const test1 = { id: "a", date: "2026-10-25", sex: "M", bodyweight: 70, squat: 120, bench: 100, deadlift: 150 };
const test2 = { id: "b", date: "2026-12-01", sex: "M", bodyweight: 69.5, squat: 130, bench: 102.5, deadlift: 160 };

test("days: local date, real calendar days only", () => {
  assert.equal(L.dayOf(new Date(2026, 0, 5)), "2026-01-05");
  assert.ok(L.isDay("2028-02-29"));
  for (const bad of ["2026-02-29", "2026-13-01", "2026-1-05", "", null, "yesterday"]) assert.ok(!L.isDay(bad), String(bad));
});

test("a test needs a real day between 1990 and today, and valid numbers", () => {
  assert.deepEqual(L.testProblems(test1, "2026-10-29"), []);
  assert.deepEqual(L.testProblems(test1, "2026-10-25"), [], "today is fine");
  assert.deepEqual(L.testProblems(test1, "2026-10-24"), ["date"], "no future dates");
  assert.deepEqual(L.testProblems({ ...test1, date: "" }, "2026-10-29"), ["date"]);
  assert.deepEqual(L.testProblems({ ...test1, date: "1989-12-31" }, "2026-10-29"), ["date"]);
  assert.deepEqual(L.testProblems({ ...test1, bench: 0 }, "2026-10-29"), ["bench"]);
});

test("a record keeps only what it logged: one lift, a bodyweight, or all four", () => {
  assert.deepEqual(L.validTest({ id: "s", date: "2026-11-10", sex: "M", squat: 130, bench: NaN, extra: 1 }), { id: "s", date: "2026-11-10", sex: "M", squat: 130 });
  assert.deepEqual(L.loggedValues({ bodyweight: 69.2 }), ["bodyweight"]);
  assert.ok(L.isComplete(test1) && !L.isComplete({ squat: 130 }));
  assert.deepEqual(L.testProblems({ date: "2026-11-10", squat: 130 }, "2026-11-10"), []);
  assert.deepEqual(L.testProblems({ date: "2026-11-10" }, "2026-11-10"), ["values"], "nothing logged");
  assert.deepEqual(L.testProblems({ date: "2026-11-10", squat: 700 }, "2026-11-10"), ["squat"]);
  assert.equal(L.validTest({ id: "x", date: "2026-11-10", sex: "M" }), null);
});

test("the Save button says what will be saved", () => {
  assert.equal(L.saveLabel(["squat"]), "Save squat 1RM");
  assert.equal(L.saveLabel(["bodyweight", "squat"]), "Save squat 1RM", "bodyweight goes along with a lift");
  assert.equal(L.saveLabel(["bench", "squat"]), "Save squat & bench");
  assert.equal(L.saveLabel(["squat", "bench", "deadlift"]), "Save test");
  assert.equal(L.saveLabel(["bodyweight"]), "Save bodyweight");
  assert.equal(L.saveLabel([]), null, "nothing changed");
});

test("records are named for what they logged", () => {
  assert.equal(L.recordName(test1), "1RM test");
  assert.equal(L.recordName({ squat: 130 }), "Squat 1RM");
  assert.equal(L.recordName({ squat: 130, bench: 105, bodyweight: 70 }), "Squat & bench 1RM");
  assert.equal(L.recordName({ bodyweight: 69 }), "Bodyweight");
});

test("a PR beats every earlier value of that lift; a first value isn't one", () => {
  const tests = [test1, { id: "s1", date: "2026-11-01", sex: "M", squat: 125 }, { id: "s2", date: "2026-11-08", sex: "M", squat: 122.5 }, { id: "t", date: "2026-12-01", sex: "M", squat: 125, bench: 102.5, deadlift: 160 }];
  const result = L.prs(tests);
  assert.deepEqual([...result.entries()], [["s1", ["squat"]], ["t", ["bench", "deadlift"]]], "s2 is below the best; t's squat only equals it");
});

test("lifts carried from a bodyweight more than 5 kg away are flagged for a retest", () => {
  const october = { id: "o", date: "2026-10-01", sex: "M", bodyweight: 60, squat: 120, bench: 80, deadlift: 150 };
  const december = { id: "d", date: "2026-12-01", sex: "M", bodyweight: 80, bench: 90 };
  const tests = [october, december];
  assert.deepEqual(L.staleLifts(tests, "2026-12-01", 80), [{ lift: "squat", bodyweight: 60 }, { lift: "deadlift", bodyweight: 60 }], "bench was logged that day");
  assert.deepEqual(L.staleLifts(tests, "2026-12-01", 80, ["squat"]), [{ lift: "deadlift", bodyweight: 60 }], "a squat being logged now isn't carried");
  assert.deepEqual(L.staleLifts(tests, "2026-12-01", 64), [], "within 5 kg: fine");
  assert.deepEqual(L.staleLifts(tests, "2026-09-01", 80), [], "before any record");
  assert.equal(L.staleText([{ lift: "squat", bodyweight: 60 }, { lift: "deadlift", bodyweight: 60 }]), "squat and deadlift logged at 60 kg");
  assert.equal(L.staleText([{ lift: "squat", bodyweight: 60 }, { lift: "deadlift", bodyweight: 62 }]), "squat logged at 60 kg and deadlift at 62 kg");
});

test("the first record must hold all four values, so it can't be deleted while the next one doesn't", () => {
  const squatPr = { id: "s", date: "2026-11-10", sex: "M", squat: 130 };
  assert.equal(L.deleteProblem([test1], "a"), "only");
  assert.equal(L.deleteProblem([test1, squatPr], "a"), "earliest");
  assert.equal(L.deleteProblem([test1, squatPr], "s"), null);
  assert.equal(L.deleteProblem([test1, test2], "a"), null, "the next one is a full test");
  assert.equal(L.canSaveTests([squatPr]), false, "a history can't start without all four");
  assert.equal(L.canSaveTests([test1, squatPr]), true);
});

test("a stored test keeps only its fields; one dated after today still loads (the clock may have changed)", () => {
  assert.deepEqual(L.validTest({ ...test1, extra: 1 }), test1);
  assert.deepEqual(L.validTest({ ...test1, date: "2099-01-01" }).date, "2099-01-01");
  assert.equal(L.validTest({ ...test1, id: "" }), null);
  assert.equal(L.validTest({ ...test1, date: "2026-02-30" }), null);
});

test("each test keeps its sex; one saved before tests recorded it takes the profile's", () => {
  const { sex, ...older } = test1;
  assert.deepEqual(L.validTest(older, "M"), test1);
  assert.equal(L.validTest(older), null, "no sex and no fallback");
  assert.equal(L.validTest({ ...test1, sex: "X" }), null);
  assert.equal(L.validTest({ ...test1, sex: "F" }, "M").sex, "F", "a recorded sex wins over the fallback");
  assert.deepEqual(L.cleanTests([older], "M"), [test1]);
  assert.equal(L.canSaveTests([older]), false, "new saves must have a sex");
});

test("the profile's sex follows the latest test, so a backfill in another category doesn't flip the Ladder", () => {
  const older = { ...test1, id: "w", date: "2026-01-01", sex: "F", bodyweight: 60 };
  assert.equal(L.withLatestTest({ ...me70, sex: "F" }, [older, test2]).sex, "M");
  assert.equal(L.withLatestTest(me70, [{ ...test2, sex: "F" }]).sex, "F");
});

test("a test is scored in its own sex, not the profile's", () => {
  const women = { ...test1, sex: "F", bodyweight: 60 };
  const asTested = L.profileScore(L.withLatestTest(me70, [women]));
  assert.equal(asTested.toFixed(1), L.profileScore({ ...me70, sex: "F", bodyweight: 60 }).toFixed(1));
  assert.notEqual(asTested, L.profileScore({ ...me70, bodyweight: 60 }), "men's DOTS for the same numbers differs");
});

test("tests sort by date; same-day tests keep the order they were saved in", () => {
  const sameDay = { ...test1, id: "a2", squat: 125 };
  assert.deepEqual(L.sortTests([test2, test1, sameDay]).map((t) => t.id), ["a", "a2", "b"]);
  assert.equal(L.latestTest([test2, test1]).id, "b");
  assert.equal(L.latestTest([]), null);
});

test("your numbers on a date carry each value forward from when it was last logged", () => {
  const squatPr = { id: "s", date: "2026-11-10", sex: "M", squat: 130 };
  const weighIn = { id: "w", date: "2026-11-12", sex: "M", bodyweight: 69.2 };
  const tests = [weighIn, test1, squatPr];
  const rows = L.carried(tests);
  assert.deepEqual(rows.map((r) => r.record.id), ["a", "s", "w"]);
  assert.deepEqual(rows[1].values, { sex: "M", bodyweight: 70, squat: 130, bench: 100, deadlift: 150 });
  assert.deepEqual(rows[2].from, { bodyweight: "2026-11-12", squat: "2026-11-10", bench: "2026-10-25", deadlift: "2026-10-25" });
  assert.equal(L.valuesAt(tests, "2026-11-11").values.squat, 130);
  assert.equal(L.valuesAt(tests, "2026-11-09").values.squat, 120, "before the PR: the old squat");
  assert.equal(L.valuesAt(tests, "2026-01-01"), null, "before your first record");
});

test("the profile's numbers come from the latest test by date, not the last one saved", () => {
  const profile = { ...me70, weightClass: "66", formula: "gl" };
  assert.deepEqual(L.withLatestTest(profile, [test2, test1]), { ...profile, bodyweight: 69.5, squat: 130, bench: 102.5, deadlift: 160 });
  assert.equal(L.withLatestTest(profile, []), profile);
  assert.deepEqual(L.testFrom(profile, "2026-10-29", "x"), { id: "x", date: "2026-10-29", sex: "M", bodyweight: 70, squat: 120, bench: 100, deadlift: 150 });
  assert.deepEqual(L.testFrom(profile, "2026-10-29", "y", ["squat"]), { id: "y", date: "2026-10-29", sex: "M", squat: 120 }, "just the squat");
  assert.deepEqual(L.withLatestTest(profile, [test1, { id: "s", date: "2026-11-10", sex: "M", squat: 130 }]).squat, 130, "the latest values, carried");
});

test("saved records are cleaned: sorted, invalid ones dropped, and not a list → null", () => {
  assert.deepEqual(L.cleanTests([test2, test1]), [test1, test2]);
  assert.deepEqual(L.cleanTests([test1, { ...test2, squat: -5 }]), [test1]);
  assert.equal(L.cleanTests({}), null);
  assert.equal(L.cleanTests(null), null);
  assert.equal(L.canSaveTests([{ ...test1, date: "nope" }]), false);
  assert.equal(L.canSaveTests([test2, test1]), true);
});

test("ids are unique", () => {
  assert.notEqual(L.newId("test"), L.newId("test"));
});

// --- Events --------------------------------------------------------------------

const lifts = (squat, bench, deadlift) => ({ squat, bench, deadlift });
const may = { id: "may", name: "", month: "2027-05", date: null, bodyweight: 70, conservative: lifts(138, 107, 168), optimistic: lifts(154, 111, 184) };
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

test("an event's exact date is optional, must be a real day, and must fall in its month", () => {
  assert.deepEqual(L.validEvent({ ...may, date: "2027-05-15" }), { ...may, date: "2027-05-15" });
  assert.deepEqual(L.validEvent({ ...may, date: "" }), may, "an empty date field is no date");
  assert.deepEqual(L.eventProblems({ ...may, date: "2027-06-15" }), ["date"]);
  assert.deepEqual(L.eventProblems({ ...may, date: "2027-05-32" }), ["date"]);
  const { date, ...older } = may; // saved before exact dates existed
  assert.deepEqual(L.validEvent(older), may);
});

test("the next meet is the soonest dated event, today included, with the days to go", () => {
  const at = (id, date) => ({ ...may, id, month: date.slice(0, 7), date });
  const events = [at("later", "2027-05-01"), at("past", "2026-10-01"), { ...may, id: "undated", month: "2026-12" }, at("soon", "2026-11-14")];
  assert.deepEqual(L.nextMeet(events, "2026-10-29"), { event: events[3], days: 16 });
  assert.equal(L.nextMeet(events, "2026-11-14").days, 0);
  assert.equal(L.nextMeet(events, "2027-05-02"), null);
  assert.equal(L.nextMeet([], "2026-10-29"), null);
});

test("a month-only event is the next meet for its whole month, after a dated one in it, with no days to go", () => {
  const undated = { ...may, id: "undated", month: "2026-11" };
  const dated = { ...may, id: "dated", month: "2026-11", date: "2026-11-28" };
  assert.deepEqual(L.nextMeet([undated], "2026-11-30"), { event: undated, days: null }, "still this month");
  assert.equal(L.nextMeet([undated], "2026-12-01"), null, "its month is over");
  assert.equal(L.nextMeet([undated, dated], "2026-11-02").event.id, "dated");
  assert.equal(L.nextMeet([undated, dated], "2026-11-29").event.id, "undated", "the dated one has passed");
});

test("the 1RMs list shows the newest 5 records, or all of them", () => {
  const tests = ["a", "b", "c", "d", "e", "f", "g"].map((id) => ({ id }));
  assert.deepEqual(L.shownRecords(tests, false).map((t) => t.id), ["g", "f", "e", "d", "c"]);
  assert.deepEqual(L.shownRecords(tests, true).map((t) => t.id), ["g", "f", "e", "d", "c", "b", "a"]);
  assert.deepEqual(L.shownRecords(tests.slice(0, 2), false).map((t) => t.id), ["b", "a"]);
  assert.equal(tests[0].id, "a", "the records aren't reordered");
});

test("days between dates count calendar days, across month ends and clock changes", () => {
  assert.equal(L.daysBetween("2026-10-24", "2026-10-26"), 2, "UK clocks go back on 25 Oct 2026");
  assert.equal(L.daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.equal(L.daysBetween("2028-02-28", "2028-03-01"), 2, "leap year");
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

test("saved events are cleaned: invalid ones dropped, an empty list kept, not a list → null", () => {
  assert.deepEqual(L.cleanEvents([may, { ...may, id: "bad", month: "nope" }]), [may]);
  assert.deepEqual(L.cleanEvents([]), [], "deleting every event is kept, not reset");
  assert.equal(L.cleanEvents({}), null);
  assert.equal(L.canSaveEvents([may]), true);
  assert.equal(L.canSaveEvents([{ ...may, bodyweight: -1 }]), false);
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
  const allowed = new Set(["sex", "weightClassKg", "experience", "lifters", "lifts", "split", ...FORMULA_IDS]);
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

test("committed typical splits are aggregate only: 20+ lifters, a median share per lift, close to 100 in all", () => {
  for (const rung of readJson("../data/rungs.json").rungs) {
    if (!rung.split) continue;
    const where = `${rung.sex} ${rung.weightClassKg} ${rung.experience} split`;
    assert.deepEqual(Object.keys(rung.split).sort(), ["bench", "deadlift", "lifters", "squat"], where);
    assert.ok(rung.split.lifters >= 20 && rung.split.lifters <= rung.lifters, `${where}: ${rung.split.lifters} lifters`);
    const sum = L.LIFTS.reduce((total, lift) => total + rung.split[lift], 0);
    assert.ok(Math.abs(sum - 100) < 5, `${where}: sums to ${sum}`);
  }
});

test("committed per-lift rungs are aggregate only: 20+ lifters, p10/p90 at 50+, in kg on a 2.5 kg step, rising", () => {
  for (const rung of readJson("../data/rungs.json").rungs) {
    for (const [lift, set] of Object.entries(rung.lifts ?? {})) {
      const where = `${rung.sex} ${rung.weightClassKg} ${rung.experience} ${lift}`;
      assert.ok(L.LIFTS.includes(lift), `${where}: unknown lift`);
      assert.ok(set.lifters >= 20 && set.lifters <= rung.lifters, `${where}: ${set.lifters} lifters`);
      const keys = Object.keys(set).filter((k) => k !== "lifters");
      assert.ok(keys.every((k) => ["p10", "p25", "p50", "p75", "p90"].includes(k)), `${where}: ${keys}`);
      if (keys.includes("p10") || keys.includes("p90")) assert.ok(set.lifters >= 50, `${where}: p10/p90 under 50`);
      const scores = L.liftRungsFor({ rungs: [rung] }, lift, rung.sex, rung.weightClassKg, rung.experience).rungs.map((r) => r.score);
      assert.ok(scores.every((kg) => kg % 2.5 === 0 && kg > 0), `${where}: ${scores}`);
      assert.deepEqual(scores, [...scores].sort((a, b) => a - b), `${where}: out of order`);
    }
  }
});

test("liftRungsFor gives one lift's rungs in kg, lowest first, or null without them", () => {
  const data = { rungs: [{ sex: "M", weightClassKg: "74", experience: "first meet", lifters: 30, dots: {}, gl: {}, lifts: { squat: { lifters: 30, p75: 177.5, p25: 140, p50: 155 } } }] };
  assert.deepEqual(L.liftRungsFor(data, "squat", "M", "74", "first meet"), { lifters: 30, rungs: [{ percentile: 25, score: 140 }, { percentile: 50, score: 155 }, { percentile: 75, score: 177.5 }] });
  assert.equal(L.liftRungsFor(data, "bench", "M", "74", "first meet"), null);
  assert.equal(L.liftRungsFor(data, "squat", "F", "74", "first meet"), null);
});

test("every class in the rungs can be chosen in the class dropdown", () => {
  for (const { sex, weightClassKg } of readJson("../data/rungs.json").rungs) {
    assert.ok(L.weightClasses(sex).includes(weightClassKg), `${sex} ${weightClassKg} kg can't be chosen`);
  }
});

// --- What a save achieved ---------------------------------------------------------------

const atClass = (score, extra = {}) => ({ score, profile: { sex: "M", bodyweight: 68, weightClass: null, formula: "dots", ...extra } });
const someRungs = [{ percentile: 10, score: 250 }, { percentile: 25, score: 280 }, { percentile: 50, score: 300 }];

test("a save that climbs past rungs names the highest one cleared", () => {
  const outcome = L.saveOutcome({ before: atClass(270), after: atClass(305), rungs: someRungs });
  assert.equal(outcome.cleared.percentile, 50);
  assert.equal(L.savedText(outcome), "Saved · Cleared P50");
});

test("no rung is cleared by staying put, dropping, or changing group", () => {
  assert.equal(L.saveOutcome({ before: atClass(285), after: atClass(290), rungs: someRungs }).cleared, null);
  assert.equal(L.saveOutcome({ before: atClass(305), after: atClass(270), rungs: someRungs }).cleared, null);
  assert.equal(L.saveOutcome({ before: atClass(270), after: atClass(305, { weightClass: "83" }), rungs: someRungs }).cleared, null, "another class");
  assert.equal(L.saveOutcome({ before: atClass(270), after: atClass(305, { formula: "gl" }), rungs: someRungs }).cleared, null, "another formula");
  assert.equal(L.saveOutcome({ before: atClass(280), after: atClass(281), rungs: someRungs }).cleared, null, "already on the rung");
});

test("the saved note lists PRs, then the rung", () => {
  assert.equal(L.savedText({ prLifts: [], cleared: null }), "Saved");
  assert.equal(L.savedText({ prLifts: ["squat"], cleared: null }), "Saved · PR on squat");
  assert.equal(L.savedText({ prLifts: ["squat", "bench", "deadlift"], cleared: { percentile: 25 } }), "Saved · PR on squat, bench and deadlift · Cleared P25");
});

// --- Meet day: an event's day part, and rack settings ---------------------------------------

const planned = { id: "m", name: "Open", month: "2026-11", date: "2026-11-14", bodyweight: 68, conservative: { squat: 110, bench: 120, deadlift: 160 }, optimistic: null };

test("an event keeps its meet day, cleaned", () => {
  const day = { flight: " Flight B ", attempts: { squat: [{ kg: 100, good: true }, { kg: 105, good: false }], bench: [] } };
  assert.deepEqual(L.validEvent({ ...planned, day }).day, { flight: "Flight B", attempts: { squat: [{ kg: 100, good: true }, { kg: 105, good: false }] } });
  assert.equal("day" in L.validEvent(planned), false, "no day part unless there is one");
});

test("invalid meet-day parts are dropped, not the event: attempts stop at the first bad one", () => {
  const day = { flight: "x".repeat(L.MAX_LABEL + 1), attempts: { squat: [{ kg: 100, good: true }, { kg: -5, good: true }, { kg: 110, good: true }], deadlift: [1, 2, 3, 4] } };
  assert.deepEqual(L.validEvent({ ...planned, day }).day, { attempts: { squat: [{ kg: 100, good: true }] } });
  const four = Array.from({ length: 4 }, (_, i) => ({ kg: 100 + i, good: true }));
  assert.equal(L.cleanDay({ attempts: { bench: four } }).attempts.bench.length, 3, "at most three");
  assert.equal(L.cleanDay({ flight: "  " }), null);
});

test("a meet day keeps each lift's start time and the lifters before you, when valid", () => {
  assert.deepEqual(L.cleanDay({ start: { squat: "11:30", bench: "25:00", deadlift: "" }, before: 6 }), { start: { squat: "11:30" }, before: 6 });
  assert.equal(L.cleanDay({ before: -1 }), null);
  assert.equal(L.cleanDay({ before: 2.5 }), null);
});

test("rack settings are kept only when set, trimmed and short", () => {
  assert.equal("rack" in L.settingsOf({ formula: "dots" }), false);
  assert.deepEqual(L.settingsOf({ rack: { squat: " 9 ", safeties: "", bench: "6 / 3", other: "x" } }).rack, { squat: "9", bench: "6 / 3" });
  assert.equal("rack" in L.settingsOf({ rack: { squat: "far too long a value" } }), false);
});

// --- Your numbers: how current each number behind your score is ---

test("your numbers: tested or carried, how long ago, PRs and the last-tested note", () => {
  const tests = [
    { id: "a", date: "2026-08-01", sex: "M", bodyweight: 69, squat: 115, bench: 110, deadlift: 150 },
    { id: "b", date: "2026-09-17", sex: "M", squat: 110 },
    { id: "c", date: "2026-10-15", sex: "M", deadlift: 160 },
    { id: "d", date: "2026-10-30", sex: "M", bodyweight: 68, bench: 120 },
  ];
  const { rows, stale } = L.yourNumbers(tests, "2026-10-31");
  const by = Object.fromEntries(rows.map((row) => [row.name, row]));
  assert.deepEqual(rows.map((row) => row.name), ["bodyweight", "squat", "bench", "deadlift"]);
  assert.deepEqual(by.bodyweight, { name: "bodyweight", kg: 68, date: "2026-10-30", days: 1, tested: true });
  assert.deepEqual(by.bench, { name: "bench", kg: 120, date: "2026-10-30", days: 1, tested: true, best: 120, pr: true, estimate: "" });
  assert.deepEqual(by.squat, { name: "squat", kg: 110, date: "2026-09-17", days: 44, tested: false, best: 115, pr: false, estimate: "" }, "below an earlier best");
  assert.deepEqual(by.deadlift, { name: "deadlift", kg: 160, date: "2026-10-15", days: 16, tested: false, best: 160, pr: true, estimate: "" });
  assert.equal(L.yourNumbers([tests[0]], "2026-08-01").rows.some((row) => row.pr), false, "a first value isn't a PR");
  assert.deepEqual(stale, [{ lift: "squat", weeks: 6 }]);
});

test("your numbers: the note starts at six weeks, oldest lift first", () => {
  const tests = [
    { id: "a", date: "2026-08-01", sex: "M", bodyweight: 69, squat: 115, bench: 110, deadlift: 150 },
    { id: "b", date: "2026-08-10", sex: "M", deadlift: 155 },
  ];
  assert.deepEqual(L.yourNumbers(tests, "2026-09-11").stale, [], "41 days since the deadlift, 6 weeks less a day since squat");
  assert.deepEqual(L.yourNumbers(tests, "2026-09-12").stale, [{ lift: "squat", weeks: 6 }, { lift: "bench", weeks: 6 }]);
  assert.deepEqual(L.yourNumbers(tests, "2026-09-21").stale.map((s) => s.lift), ["squat", "bench", "deadlift"]);
});

test("your numbers: null with no records", () => {
  assert.equal(L.yourNumbers([], "2026-10-31"), null);
});

test("Meet unlocks with an upcoming event or a meet result", () => {
  assert.equal(L.meetLocked(null, null), true);
  assert.equal(L.meetLocked({ event: may, days: null }, null), false, "a month is enough");
  assert.equal(L.meetLocked(null, { event: may }), false, "a past meet's result still shows");
});

test("a month-only meet takes today as its day with its first attempt, only within its month", () => {
  const undated = { ...may, month: "2026-11", date: null };
  assert.deepEqual(L.meetDate(undated, "2026-11-14"), { date: "2026-11-14" });
  assert.deepEqual(L.meetDate(undated, "2026-10-31"), {}, "before its month, the date would fall outside it");
  assert.deepEqual(L.meetDate({ ...undated, date: "2026-11-21" }, "2026-11-14"), {}, "a set date is kept");
  assert.deepEqual(L.validEvent({ ...undated, ...L.meetDate(undated, "2026-11-14") }).date, "2026-11-14");
});

const calcRungs = [{ percentile: 10, score: 287.5 }, { percentile: 25, score: 312 }, { percentile: 50, score: 338.5 }, { percentile: 75, score: 360 }];

test("the calculator's quick targets are the next 3 rungs above your score", () => {
  assert.deepEqual(L.quickTargets(calcRungs, 280).map((r) => r.percentile), [10, 25, 50]);
  assert.deepEqual(L.quickTargets(calcRungs, 300).map((r) => r.percentile), [25, 50, 75]);
  assert.deepEqual(L.quickTargets(calcRungs, 312).map((r) => r.percentile), [50, 75], "a rung you're on isn't ahead");
  assert.deepEqual(L.quickTargets(calcRungs, 400), [], "above the top rung");
  assert.deepEqual(L.quickTargets([], 300), []);
});

test("the lighter class is the next class top below a bodyweight", () => {
  assert.equal(L.lighterClassTop("M", 68), 66);
  assert.equal(L.lighterClassTop("M", 74), 66, "the top of a class is in it");
  assert.equal(L.lighterClassTop("M", 59), null);
  assert.equal(L.lighterClassTop("M", 130), 120);
  assert.equal(L.lighterClassTop("F", 60), 57);
});

test("the calculator turns a target score and bodyweight into the total needed, rounded up to 2.5 kg", () => {
  // me68 scores 299.0 DOTS on 390 kg; the lever's break-even sums check the same maths.
  const same = L.totalNeeded(me68, calcRungs, { target: L.profileScore(me68), bw: 66 });
  assert.equal(same.needed, 382.5, "the lever's break-even total at 66 kg");
  const p25 = L.totalNeeded(me68, calcRungs, { target: 312, bw: 68 });
  assert.equal(p25.needed, 407.5);
  assert.equal(p25.gap, 17.5);
  assert.deepEqual([p25.climbs, p25.reaches.percentile, p25.clearsAll], [1, 25, false]);
  assert.deepEqual(p25.lighter, { kg: 66, needed: 400 });
  const gl = L.totalNeeded({ ...me68, formula: "gl" }, [], { target: L.profileScore({ ...me68, formula: "gl" }), bw: 74 });
  assert.equal(gl.needed, 410, "the lever's GL break-even at 74 kg");
  assert.equal(gl.climbs, 0);
  assert.equal(gl.reaches, null);
  assert.equal(gl.clearsAll, false, "no rungs, nothing cleared");
});

test("the calculator says how far a target climbs, including past every rung or below your score", () => {
  const all = L.totalNeeded(me68, calcRungs, { target: 365, bw: 68 });
  assert.deepEqual([all.climbs, all.reaches.percentile, all.clearsAll], [3, 75, true]);
  const below = L.totalNeeded(me68, calcRungs, { target: 280, bw: 68 });
  assert.equal(below.climbs, -1, "drops below P10");
  assert.ok(below.gap < 0);
  assert.equal(L.totalNeeded(me68, calcRungs, { target: 312, bw: 55 }).lighter, null, "nothing lighter than 59 kg");
});

test("the calculator says which values it can't use", () => {
  assert.deepEqual(L.totalNeeded(me68, calcRungs, { target: NaN, bw: 68 }).problems, ["target"]);
  assert.deepEqual(L.totalNeeded(me68, calcRungs, { target: 0, bw: 68 }).problems, ["target"]);
  assert.deepEqual(L.totalNeeded(me68, calcRungs, { target: 312, bw: 20 }).problems, ["bw"]);
  assert.deepEqual(L.totalNeeded(me68, calcRungs, { target: 2000, bw: NaN }).problems, ["target", "bw"]);
  assert.equal(L.totalNeeded(me68, calcRungs, { target: 2000, bw: NaN }).needed, undefined);
});

// --- Lift balance ------------------------------------------------------------------

// Made-up rungs in kg, for a made-up 110 / 120 / 160 kg lifter at 70 kg.
const balanceRungs = {
  squat: [{ percentile: 10, score: 120 }, { percentile: 25, score: 140 }, { percentile: 50, score: 155 }],
  bench: [{ percentile: 10, score: 80 }, { percentile: 25, score: 90 }, { percentile: 50, score: 105 }, { percentile: 75, score: 117.5 }, { percentile: 90, score: 130 }],
  deadlift: [{ percentile: 10, score: 152.5 }, { percentile: 25, score: 172.5 }, { percentile: 50, score: 195 }],
};
const scoreRungs = [{ percentile: 10, score: 266 }, { percentile: 25, score: 300 }, { percentile: 50, score: 338 }];
const lifter = { sex: "M", bodyweight: 70, squat: 110, bench: 120, deadlift: 160, formula: "dots", weightClass: null };
const typical = { lifters: 396, squat: 35, bench: 24, deadlift: 41, scaled: false };
const balance = (profile, rungs = balanceRungs, split = typical) => L.liftBalance(profile, (lift) => rungs[lift], split, scoreRungs);
const texts = (b) => b.lines.map((l) => [l.lead, l.text].filter(Boolean).join(" "));

test("lift shares are each lift's part of your total", () => {
  const shares = L.liftShares(lifter);
  assert.deepEqual(L.LIFTS.map((lift) => Math.round(shares[lift])), [28, 31, 41]);
});

test("the typical split is scaled to 100 and says so, or is null without one", () => {
  const data = { rungs: [{ sex: "M", weightClassKg: "74", experience: "first meet", split: { lifters: 30, squat: 34, bench: 23, deadlift: 41 } }] };
  const split = L.typicalSplit(data, "M", "74", "first meet");
  assert.equal(split.lifters, 30);
  assert.ok(split.scaled, "the medians summed to 98");
  assert.equal(Math.round((split.squat + split.bench + split.deadlift) * 1e9) / 1e9, 100);
  assert.equal(split.squat.toFixed(1), (3400 / 98).toFixed(1));
  assert.equal(L.typicalSplit(data, "M", "83", "first meet"), null);
  assert.equal(L.typicalSplit({ rungs: [{ ...data.rungs[0], split: undefined }] }, "M", "74", "first meet"), null, "an older rungs.json");
});

test("a rung band is compact: below the lowest, between two, above the top", () => {
  assert.equal(L.rungBand(balanceRungs.squat, 110), "Below P10");
  assert.equal(L.rungBand(balanceRungs.squat, 120), "P10–P25", "reaching a rung clears it");
  assert.equal(L.rungBand([], 100), "");
});

test("a row's badge says where the lift is in plain words, never a P-code", () => {
  assert.equal(L.ladderBand(balanceRungs.squat, 110), "Not on the ladder");
  assert.equal(L.ladderBand(balanceRungs.bench, 120), "Ahead of 75");
  assert.equal(L.ladderBand(balanceRungs.squat, 155), "Ahead of 50", "past the top rung");
  assert.equal(L.ladderBand(balanceRungs.squat, 120), "Ahead of 10", "reaching a rung passes it");
  assert.equal(L.ladderBand([], 100), "");
});

test("lift balance leads with the lift with most room to grow, then the strongest, then all three at their next step", () => {
  const b = balance(lifter);
  assert.deepEqual(b.rows.map((r) => [r.lift, r.band, r.opportunity]), [["squat", "Not on the ladder", true], ["bench", "Ahead of 75", false], ["deadlift", "Ahead of 10", false]]);
  assert.deepEqual(texts(b), [
    "Squat has the most room to grow. It isn't on the ladder yet: 120 kg (+10 kg) puts it ahead of 10 in 100. It's 28% of your total; powerlifters like you average 35%.",
    "Bench press is your strongest lift: ahead of at least 75 in 100, and 10 kg from ahead of 90 in 100.",
    "All three at their next step (+10, +10 and +12.5 kg) would put your total ahead of 25 in 100: +24.4 DOTS.",
  ]);
  assert.ok(!texts(b).join(" ").match(/\bP\d/), "no P-codes");
  assert.equal(b.selected, "squat", "the opportunity is shown first");
});

test("lift balance gives the lead as parts for the card's big number, only when one lift has a step ahead", () => {
  assert.deepEqual(balance(lifter).hero, {
    lift: "squat",
    title: "Squat has the most room to grow",
    add: "+10 kg",
    caption: "puts it ahead of 10 in 100 (120 kg)",
    note: "It isn't on the ladder yet. It's 28% of your total; powerlifters like you average 35%.",
  });
  assert.equal(balance({ ...lifter, squat: 145, bench: 95, deadlift: 187.5 }).hero, null, "evenly matched");
  const tied = { ...lifter, squat: 115, deadlift: 145 };
  assert.equal(balance(tied, balanceRungs, { lifters: 30, ...L.liftShares(tied), scaled: false }).hero, null, "two lifts named");
});

test("each lift's drawer: its share line, then its next two steps as table rows, the total's step named only when it changes", () => {
  const b = balance(lifter);
  const row = (lift) => b.rows.find((r) => r.lift === lift);
  assert.equal(row("squat").detail[0].text, "Your biggest opportunity. Squat is 28% of your total; powerlifters like you average 35%.");
  assert.deepEqual(row("squat").steps.map((s) => [s.kg, s.add, s.lift, s.total, s.points]), [
    [120, 10, "Ahead of 10 in 100", "Ahead of 25 in 100", "+7.5 DOTS"],
    [140, 30, "Ahead of 25 in 100", null, "+22.5 DOTS"], // still the same step for the total: not named again
  ]);
  assert.equal(row("bench").detail[0].text, "Your strongest lift. Bench press is 31% of your total; powerlifters like you average 24%.");
  assert.equal(row("deadlift").detail[0].text, "Deadlift is ahead of at least 10 in 100.", "within a point of typical: no share line");
  assert.deepEqual(balance({ ...lifter, squat: 160 }).rows[0].steps, [], "past its top rung: no steps");
  assert.deepEqual(balance(lifter, { ...balanceRungs, bench: [] }).rows[1].detail, [{ text: "No bench press rungs for this group yet." }]);
  assert.equal(balance(lifter, balanceRungs, null).rows[0].detail[0].text, "Your biggest opportunity. Squat isn't on the ladder yet.", "no share without a typical split");
});

test("lift balance can name any lift, and only adds points when the total doesn't reach a new step", () => {
  const b = balance({ ...lifter, squat: 125, bench: 100, deadlift: 150 });
  assert.equal(b.lines[0].lead, "Deadlift has the most room to grow.");
  assert.equal(texts(b)[1], "Bench press is your strongest lift: ahead of at least 25 in 100, and 5 kg from ahead of half.");
  assert.match(texts(b)[2], /^All three at their next step \(\+15, \+5 and \+2\.5 kg\) would add \d+\.\d DOTS\.$/);
  const onLadder = balance({ ...lifter, squat: 160 });
  assert.equal(texts(onLadder)[0], "Deadlift has the most room to grow. It's ahead of at least 10 in 100; 172.5 kg (+12.5 kg) puts it ahead of 25 in 100. It's 36% of your total; powerlifters like you average 41%.");
});

test("lift balance: a lower share than typical breaks a tie, else both are named", () => {
  const tied = { ...lifter, squat: 115, deadlift: 145 }; // both off the ladder
  assert.equal(balance(tied).lines[0].lead, "Squat has the most room to grow.", "squat's share is further under typical");
  const even = { lifters: 30, ...L.liftShares(tied), scaled: false };
  assert.deepEqual(balance(tied, balanceRungs, even).lines[0], { lead: "Squat and deadlift have the most room to grow.", text: "Neither is on the ladder yet." });
  assert.deepEqual(balance(tied, balanceRungs, null).lines[0], { lead: "Squat and deadlift have the most room to grow.", text: "Neither is on the ladder yet." }, "no typical split");
  assert.equal(balance(lifter, balanceRungs, null).lines[0].text, "It isn't on the ladder yet: 120 kg (+10 kg) puts it ahead of 10 in 100.", "no share without one");
});

test("lift balance: lifts in the same band are evenly matched, and the closest to its next step is named", () => {
  const b = balance({ ...lifter, squat: 145, bench: 95, deadlift: 187.5 });
  assert.equal(texts(b)[0], "Your lifts are evenly matched. All three are ahead of at least 25 in 100.");
  assert.ok(b.rows.every((r) => !r.opportunity));
  assert.ok(!texts(b).some((t) => /strongest/.test(t)));
  assert.equal(texts(b)[1], "Deadlift is closest to its next step: 7.5 kg to ahead of half.");
  assert.equal(b.selected, "deadlift", "the nearest lift is shown first, with no opportunity");
});

test("lift balance skips lifts past their top rung or without rungs, and says nothing with one lift to compare", () => {
  const top = balance({ ...lifter, squat: 160, bench: 135, deadlift: 200 });
  assert.ok(!texts(top).some((t) => /next step \(/.test(t)), "every lift past its top rung: no all-three line");
  const one = balance(lifter, { squat: balanceRungs.squat, bench: [], deadlift: [] });
  assert.deepEqual(one.lines, []);
  assert.equal(one.selected, "squat", "the only lift with rungs");
  assert.deepEqual(one.rows.map((r) => r.band), ["Not on the ladder", "", ""]);
});

// --- First visit -------------------------------------------------------------------

// Made-up rungs: women 63 kg at their first meet, and men 74 kg at their first and second meet.
const fvData = {
  rungs: [
    { sex: "F", weightClassKg: "63", experience: "first meet", lifters: 300,
      dots: { p10: 237, p25: 264, p50: 302, p75: 333, p90: 358 },
      lifts: { squat: { lifters: 300, p10: 70, p25: 85, p50: 97.5, p75: 112.5, p90: 122.5 }, bench: { lifters: 300, p10: 40, p25: 45, p50: 52.5, p75: 60, p90: 65 }, deadlift: { lifters: 300, p10: 97.5, p25: 110, p50: 122.5, p75: 135, p90: 145 } } },
    { sex: "M", weightClassKg: "74", experience: "first meet", lifters: 400,
      dots: { p10: 266, p25: 300, p50: 340, p75: 380, p90: 410 },
      lifts: { squat: { lifters: 400, p10: 120, p25: 140, p50: 160, p75: 180, p90: 195 }, bench: { lifters: 400, p10: 80, p25: 95, p50: 110, p75: 125, p90: 135 }, deadlift: { lifters: 400, p10: 150, p25: 175, p50: 195, p75: 215, p90: 230 } } },
    { sex: "M", weightClassKg: "74", experience: "second meet", lifters: 60,
      dots: { p25: 320, p50: 355, p75: 390 },
      lifts: { squat: { lifters: 60, p25: 150, p50: 170, p75: 185 }, bench: { lifters: 60, p25: 100, p50: 115, p75: 130 }, deadlift: { lifters: 60, p25: 185, p50: 205, p75: 220 } } },
  ],
};
const lift = (kg, mode = "max", reps = null) => ({ kg, mode, reps });
const finished = { sex: "F", bodyweight: 63, competed: "never", mode: "set", via: "steps", lifts: { squat: lift(60, "set", 5), bench: lift(35, "set", 8), deadlift: lift(80, "set", 5) } };

test("first visit: a saved draft is cleaned, and anything unknown is left unanswered", () => {
  assert.equal(L.cleanDraft(null), null);
  assert.deepEqual(L.cleanDraft(finished), finished);
  const odd = L.cleanDraft({ sex: "X", bodyweight: 20, competed: "often", mode: "guess", via: "?", lifts: { squat: { kg: 900, mode: "set", reps: 2.5 }, curl: { kg: 20 } } });
  assert.deepEqual(odd, { sex: null, bodyweight: null, competed: null, mode: null, via: "steps", lifts: { squat: { mode: "set", kg: null, reps: null } } });
  assert.equal(L.draftStarted(L.emptyDraft()), false);
  assert.equal(L.draftStarted({ ...L.emptyDraft(), sex: "M" }), true);
});

test("first visit: a lift is a max, or a set of up to 10 reps whose estimate rounds down to 2.5 kg", () => {
  assert.equal(L.liftEntryProblem(lift(100)), null);
  assert.equal(L.liftEntryProblem(lift(null)), "kg");
  assert.equal(L.liftEntryProblem(lift(601)), "kg");
  assert.equal(L.liftEntryProblem(lift(60, "set", null)), "reps");
  assert.equal(L.liftEntryProblem(lift(60, "set", 11)), "too-many-reps");
  assert.equal(L.liftEntryProblem(lift(580, "set", 10)), "estimate", "a max over 600 kg");
  assert.equal(L.draftMax(finished, "squat"), 70, "60 × 5 → 70");
  assert.equal(L.draftMax(finished, "bench"), 42.5, "35 × 8 → 44.33, down to 42.5");
  assert.equal(L.draftMax({ lifts: { squat: lift(60, "set", 1) } }, "squat"), 60, "one rep is the weight itself");
  assert.equal(L.draftEstimated({ lifts: { squat: lift(60, "set", 1) } }, "squat"), false, "and isn't an estimate");
  assert.equal(L.draftEstimated(finished, "squat"), true);
  assert.equal(L.draftMax({ lifts: {} }, "squat"), null);
});

test("first visit: a screen shows only once its answers are in, and a draft picks up at the first one missing", () => {
  const draft = { ...L.emptyDraft(), sex: "F", bodyweight: 63 };
  assert.equal(L.canShow(draft, "competed"), true);
  assert.equal(L.canShow(draft, "max-known"), false, "meets not answered yet");
  assert.equal(L.canShow(finished, "standing"), true);
  assert.equal(L.canShow(finished, "settings"), false, "not a screen");
  assert.equal(L.canShow({}, "welcome"), true);
  assert.equal(L.firstMissing(L.emptyDraft()), "sex");
  assert.equal(L.firstMissing(draft), "competed");
  assert.equal(L.firstMissing({ ...draft, competed: "never" }), "max-known");
  assert.equal(L.firstMissing({ ...finished, lifts: { ...finished.lifts, bench: lift(null, "set", 8) } }), "bench");
  assert.equal(L.firstMissing(finished), "standing");
});

test("first visit: Back goes one screen back, and from the results to quick setup when that's how they came", () => {
  assert.equal(L.previousScreen(finished, "sex"), "welcome");
  assert.equal(L.previousScreen(finished, "squat"), "max-known");
  assert.equal(L.previousScreen(finished, "standing"), "deadlift");
  assert.equal(L.previousScreen({ ...finished, via: "quick" }, "standing"), "quick");
  assert.equal(L.previousScreen(finished, "quick"), "welcome");
  assert.deepEqual(L.FIRST_VISIT_STEPS, ["sex", "bodyweight", "competed", "max-known", "squat", "bench", "deadlift", "standing", "score", "target", "next"]);
});

test("first visit: the first record holds all four values, with the sets behind any estimates", () => {
  const record = L.draftRecord(finished, "2026-11-07", "r1");
  assert.deepEqual(record, { id: "r1", date: "2026-11-07", sex: "F", bodyweight: 63, squat: 70, bench: 42.5, deadlift: 92.5, sets: { squat: { kg: 60, reps: 5 }, bench: { kg: 35, reps: 8 }, deadlift: { kg: 80, reps: 5 } } });
  const maxes = { ...finished, lifts: { squat: lift(90), bench: lift(50), deadlift: lift(115) } };
  assert.equal("sets" in L.draftRecord(maxes, "2026-11-07", "r2"), false, "tested maxes keep no sets");
  assert.equal(L.draftRecord({ ...finished, bodyweight: null }, "2026-11-07", "r3"), null, "not finished");
  assert.ok(L.canSaveTests([record]), "it saves as a first record");
});

test("first visit: compared with the group for your meets so far, or first-meet lifters when that group is too small", () => {
  const man = { ...finished, sex: "M", bodyweight: 74 };
  assert.equal(L.draftGroup(fvData, { ...man, competed: "once" }).experience, "second meet");
  const fell = L.draftGroup(fvData, { ...man, competed: "more" });
  assert.deepEqual([fell.experience, fell.fellBack], ["first meet", true]);
  assert.equal(L.draftGroup(fvData, { ...finished, bodyweight: 90 }), null, "no rungs for the class");
  assert.equal(L.groupWords({ sex: "F", wclass: "63", experience: "first meet" }), "women, 63 kg, at their first meet");
  assert.equal(L.groupWords({ sex: "M", wclass: "120+", experience: "3+ meets" }), "men, over 120 kg, with 3 or more meets");
  assert.deepEqual([L.classRange("F", "63"), L.classRange("F", "47"), L.classRange("F", "84+")], ["57.1 to 63 kg", "up to 47 kg", "over 84 kg"]);
});

test("first visit: each lift's card says where it is as a share of the group, never in rungs (the ladder isn't shown yet)", () => {
  const group = L.draftGroup(fvData, finished);
  assert.deepEqual(L.liftPlaceWords("deadlift", 92.5, group), { title: "+5 kg puts your deadlift ahead of 10 in 100", more: "That's a 97.5 kg deadlift." });
  assert.deepEqual(L.liftPlaceWords("bench", 47.5, group), { title: "Your bench press is ahead of at least 25 in 100", more: "52.5 kg puts it ahead of 50." });
  assert.equal(L.liftPlaceWords("squat", 130, group).more, "That's as high as these numbers go.");
  for (const max of [60, 85, 130]) assert.doesNotMatch(Object.values(L.liftPlaceWords("squat", max, group)).join(" "), /rung|ladder/, `${max} kg`);
  assert.deepEqual(L.placeOn(group.lifts.squat, 85), { passed: 25, next: { percentile: 50, score: 97.5 } }, "reaching a rung passes it");
});

test("first visit: below the ladder, the 100 leads with the best news among the lifts, then the total", () => {
  const group = L.draftGroup(fvData, finished);
  // 70 / 42.5 / 92.5 (205 kg): bench and squat are ahead of 10 in 100 already; squat's 70 kg is exactly its first rung.
  const below = L.standingWords(L.draftProfile(finished), group);
  assert.equal(below.title, "Your squat is already ahead of at least 10 in 100.");
  assert.equal(below.more, "On your total, +17.5 kg puts you on the ladder: a 222.5 kg total. The 10 outlined dots are the lifters you'd pass.");
  assert.deepEqual([below.filled, below.outlined, below.key], [0, 10, ["The first rung"]]);
  // Nothing on the ladder yet: the closest lift leads.
  const low = { ...L.draftProfile(finished), squat: 40, bench: 30, deadlift: 60 };
  assert.deepEqual(L.bestLift(low, group), { lift: "bench", passed: 0, add: 10 });
  assert.equal(L.standingWords(low, group).title, "Your bench press is closest: +10 kg puts it on the ladder.");
  const on = L.standingWords({ ...L.draftProfile(finished), squat: 100, bench: 55, deadlift: 125 }, group);
  assert.match(on.title, /^At a meet, you'd place ahead of at least \d+ of these 100 lifters\.$/);
  assert.match(on.more, /^\+\d+(\.5)? kg on your total puts you ahead of \d+\.$/);
  assert.deepEqual(on.key, ["You're ahead", "Your next rung"]);
  const top = L.standingWords({ ...L.draftProfile(finished), squat: 200, bench: 120, deadlift: 220 }, group);
  assert.deepEqual([top.more, top.filled, top.outlined], ["That's the top rung.", 90, 90]);
});

test("first visit: the score moves up with the total and down with bodyweight, never as advice to cut", () => {
  const profile = { ...L.draftProfile(finished), squat: 90, bench: 50, deadlift: 115 }; // 255 kg at 63 kg, 274.3
  const words = L.scoreWords(profile);
  assert.equal(words.from, "From a 255 kg total at 63 kg bodyweight.");
  assert.deepEqual(words.rows.map((r) => r.label), ["5 kg more on your total", "The same total at 65 kg bodyweight"]);
  assert.deepEqual(words.rows.map((r) => Math.sign(r.change)), [1, -1]);
  assert.doesNotMatch(words.rows.map((r) => r.label).join(" "), /lighter|lose|cut/);
  assert.match(words.gymGoer, /^You're above a woman who trains at the gym regularly, who scores about 160\./);
  assert.match(L.scoreWords({ ...profile, sex: "M", squat: 150, bench: 100, deadlift: 190 }).gymGoer, /a man who trains at the gym regularly, who scores about 200\./);
  assert.equal(L.scoreWords({ ...profile, squat: 40, bench: 30, deadlift: 60 }).gymGoer, null, "below the estimate it isn't shown: scale, not a verdict");
});

test("first visit: the targets are each lift's next step, nearest first, not a share of the total", () => {
  const group = L.draftGroup(fvData, finished);
  const words = L.targetWords(L.draftProfile(finished), group); // 70 / 42.5 / 92.5
  assert.deepEqual(words.lifts.map((l) => [l.lift, l.kg, l.add, l.words]), [
    ["bench", 45, 2.5, "ahead of 25 in 100"],
    ["deadlift", 97.5, 5, "onto the ladder"],
    ["squat", 85, 15, "ahead of 25 in 100"],
  ]);
  assert.equal(words.allTop, false);
  const top = L.targetWords({ ...L.draftProfile(finished), squat: 200, bench: 120, deadlift: 220 }, group);
  assert.equal(top.allTop, true);
});

test("first visit: the Ladder's headline and rungs keep the first visit's plain words", () => {
  const rungs = [{ percentile: 10, score: 237 }, { percentile: 25, score: 264 }];
  assert.equal(L.plainPosition(rungs, 250), "ahead of at least 10 in 100");
  assert.equal(L.plainPosition(rungs, 264), "ahead of at least 25 in 100", "reaching a rung passes it");
  assert.equal(L.plainPosition(rungs, 200), "not on the ladder yet");
  assert.equal(L.plainPosition([], 300), "");
  assert.deepEqual(Object.values(L.RUNG_NAMES), ["Ahead of 10 in 100", "Ahead of 25 in 100", "Ahead of half", "Ahead of 75 in 100", "Ahead of 90 in 100"]);
});

test("first visit: the answer about meets is kept as the Ladder's experience", () => {
  assert.equal(L.settingsOf({ experience: "second meet" }).experience, "second meet");
  assert.equal("experience" in L.settingsOf({ experience: "lots" }), false);
  assert.deepEqual(L.COMPETED, { never: "first meet", once: "second meet", more: "3+ meets" });
});

// --- Lifts estimated from a set --------------------------------------------------------

test("estimated lifts: a record keeps the set, and the lift is worked out from it whenever it's read", () => {
  const raw = { id: "a", date: "2026-11-07", sex: "F", bodyweight: 63, squat: 999, bench: 50, deadlift: 115, sets: { squat: { kg: 60, reps: 5 } } };
  const clean = L.validTest(raw);
  assert.equal(clean.squat, 70, "the set wins over a stale saved value");
  assert.deepEqual(clean.sets, { squat: { kg: 60, reps: 5 } });
  assert.equal(L.validTest({ ...raw, squat: undefined }).squat, 70, "a set alone is enough");
  assert.deepEqual(L.cleanSets({ squat: { kg: 60, reps: 1 }, bench: { kg: 60, reps: 12 }, deadlift: { kg: -5, reps: 5 }, curl: { kg: 20, reps: 5 } }), {}, "1 rep, past 10, out of range or not a lift");
  assert.equal("sets" in L.validTest({ ...raw, sets: { squat: { kg: 60, reps: 11 } }, squat: 100 }), false, "a bad set is dropped and the value kept");
  assert.equal(L.estimateText(clean, "squat"), "est. from 60 kg × 5");
  assert.equal(L.estimateText(clean, "bench"), "");
  assert.deepEqual([L.isEstimated(clean, "squat"), L.isEstimated(clean, "bench")], [true, false]);
});

test("estimated lifts: changing an estimated lift by hand makes it a tested max; leaving it keeps the set", () => {
  const before = { id: "a", date: "2026-11-07", sex: "F", bodyweight: 63, squat: 70, bench: 42.5, deadlift: 115, sets: { squat: { kg: 60, reps: 5 }, bench: { kg: 35, reps: 8 } } };
  const read = ({ sets, ...rest }) => rest; // what the 1RMs form reads back: no sets
  assert.deepEqual(L.editedSets(before, { ...read(before), squat: 75 }).sets, { bench: { kg: 35, reps: 8 } });
  assert.deepEqual(L.editedSets(before, { ...read(before), date: "2026-11-06" }).sets, before.sets, "a new date keeps both");
  assert.equal("sets" in L.editedSets(before, { ...read(before), squat: 75, bench: 45 }), false);
  assert.equal(L.yourNumbers([L.validTest(before)], "2026-11-07").rows.find((r) => r.name === "squat").estimate, "est. from 60 kg × 5");
});


test("your data: the last backup's day is a setting, kept only when it's a real day", () => {
  assert.equal(L.settingsOf({ lastBackup: "2026-11-01" }).lastBackup, "2026-11-01");
  for (const lastBackup of [undefined, null, "2026-02-30", "yesterday", 20261101]) {
    assert.equal("lastBackup" in L.settingsOf({ lastBackup }), false, `${lastBackup} isn't kept`);
  }
});

test("your data: how long ago, in days then weeks", () => {
  assert.equal(L.agoText(0), "today");
  assert.equal(L.agoText(-2), "today", "a clock set back doesn't read as the future");
  assert.equal(L.agoText(1), "yesterday");
  assert.equal(L.agoText(13), "13 days ago");
  assert.equal(L.agoText(14), "2 weeks ago");
  assert.equal(L.agoText(27), "3 weeks ago");
});

test("your data: a backup is due 2 weeks after the last one, or after your first record if there's none", () => {
  const tests = [{ id: "a", date: "2026-10-01" }];
  assert.deepEqual(L.backupStatus({ lastBackup: "2026-11-01" }, tests, "2026-11-07"), { text: "Last backup 6 days ago.", due: false });
  assert.deepEqual(L.backupStatus({ lastBackup: "2026-10-24" }, tests, "2026-11-07"), {
    text: "Last backup 2 weeks ago. Back up to keep your latest records safe.",
    due: true,
  });
  assert.deepEqual(L.backupStatus({}, [{ id: "a", date: "2026-11-01" }], "2026-11-07"), { text: "Not backed up yet.", due: false });
  assert.equal(L.backupStatus({}, tests, "2026-11-07").due, true, "never backed up, first record 5 weeks ago");
  assert.equal(L.backupStatus({}, [], "2026-11-07").due, false, "nothing to back up");
});
