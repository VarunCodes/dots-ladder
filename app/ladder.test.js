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

test("committed meets are month-only, never an exact date", () => {
  for (const meet of readJson("../data/my-lifts.json").meets) {
    assert.match(meet.month, /^\d{4}-\d{2}$/);
    assert.ok(!("date" in meet), "meets must not carry an exact date");
  }
});

test("every committed rung is aggregate only", () => {
  const allowed = new Set(["sex", "weightClassKg", "experience", "lifters", "p10", "p25", "p50", "p75", "p90"]);
  for (const rung of readJson("../data/rungs.json").rungs) {
    for (const key of Object.keys(rung)) assert.ok(allowed.has(key), `unexpected field ${key}`);
    assert.ok(rung.lifters >= 20, "group under 20 lifters");
    if ("p10" in rung || "p90" in rung) assert.ok(rung.lifters >= 50, "p10/p90 on a group under 50");
  }
});
