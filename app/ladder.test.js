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

test("the lever scores the same total at the target and names the rung that would clear", () => {
  const rungs = [{ percentile: 10, score: 266 }, { percentile: 25, score: 285 }, { percentile: 50, score: 338 }];
  const result = L.lever(me70, rungs);
  assert.equal(result.targetBw, 66);
  assert.equal(result.then.toFixed(1), "289.9");
  assert.equal(result.delta.toFixed(1), "12.0");
  assert.equal(result.cleared.percentile, 25);
  assert.equal(L.lever({ ...me70, targetBw: 69.5 }, rungs).cleared, null, "a small cut clears nothing");
  assert.ok(L.lever({ ...me70, targetBw: 74 }, rungs).delta < 0, "a heavier target scores lower");
  assert.equal(L.lever({ ...me70, formula: "gl" }, []).then.toFixed(2), "57.68");
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

test("the meet pill counts down to the soonest dated event, today included", () => {
  const at = (id, date) => ({ ...may, id, month: date.slice(0, 7), date });
  const events = [at("later", "2027-05-01"), at("past", "2026-10-01"), { ...may, id: "undated", month: "2026-11" }, at("soon", "2026-11-14")];
  assert.deepEqual(L.nextMeet(events, "2026-10-29"), { event: events[3], days: 16 });
  assert.equal(L.nextMeet(events, "2026-11-14").days, 0);
  assert.equal(L.nextMeet(events, "2027-05-02"), null);
  assert.equal(L.nextMeet([], "2026-10-29"), null);
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
  const allowed = new Set(["sex", "weightClassKg", "experience", "lifters", "lifts", ...FORMULA_IDS]);
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
