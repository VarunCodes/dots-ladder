// Run with: npm test  (or: node --test app/*.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";

import * as A from "./attempts.js";
import { formatScore } from "./scoring.js";

// The meet pack's reference lifter: 390 kg = 110 / 120 / 160 at 68.0 kg, men, DOTS.
const lifts = { squat: 110, bench: 120, deadlift: 160 };
const lifter = { bodyweight: 68, sex: "M", formula: "dots" };

// --- Attempt planner ---------------------------------------------------------------------

test("attempts round down to 2.5 kg", () => {
  assert.equal(A.floorTo(100.1), 100);
  assert.equal(A.floorTo(109.2), 107.5);
  assert.equal(A.floorTo(152.5), 152.5, "an exact step stays");
});

test("openers at 91%, seconds at 96%, thirds at 1RM + 2.5 kg, each step totalled and scored", () => {
  const { steps } = A.attemptPlan(lifts, { pct: 91, ...lifter });
  const [openers, seconds, thirds] = steps;
  assert.deepEqual(openers.lifts, { squat: 100, bench: 107.5, deadlift: 145 });
  assert.equal(openers.total, 352.5);
  assert.equal(formatScore("dots", openers.score), "270.2");
  assert.deepEqual(seconds.lifts, { squat: 105, bench: 115, deadlift: 152.5 });
  assert.equal(seconds.total, 372.5);
  assert.equal(formatScore("dots", seconds.score), "285.6");
  assert.deepEqual(thirds.lifts, { squat: 112.5, bench: 122.5, deadlift: 162.5 });
  assert.equal(thirds.total, 397.5);
  assert.equal(formatScore("dots", thirds.score), "304.7");
});

test("the opener percentage changes only the openers", () => {
  const at88 = A.attemptPlan(lifts, { pct: 88, ...lifter });
  assert.deepEqual(at88.steps[0].lifts, { squat: 95, bench: 105, deadlift: 140 });
  assert.equal(at88.steps[1].total, 372.5);
});

test("each step's note: the highest rung it newly clears, else how far short of the next, else the top", () => {
  const rungs = [{ percentile: 10, score: 250 }, { percentile: 25, score: 280 }, { percentile: 50, score: 300 }];
  assert.deepEqual(A.stepNote(rungs, 260, 290), { kind: "clears", rung: rungs[1] });
  assert.deepEqual(A.stepNote(rungs, 285, 290), { kind: "short", rung: rungs[2], by: 10 }, "P25 was already cleared");
  assert.deepEqual(A.stepNote(rungs, 310, 320), { kind: "top" });
  assert.equal(A.stepNote([], 260, 290), null);
  const { steps } = A.attemptPlan(lifts, { pct: 91, ...lifter, rungs, now: 299 });
  assert.deepEqual(steps.map((s) => s.note.kind), ["short", "short", "clears"]);
});

// --- Plate loader --------------------------------------------------------------------------

test("plates per side on a 20 kg bar with 2.5 kg collars, largest first", () => {
  assert.deepEqual(A.platesPerSide(160), { plates: [25, 25, 15, 2.5], perSide: 67.5, exact: true });
  assert.deepEqual(A.platesPerSide(100), { plates: [25, 10, 2.5], perSide: 37.5, exact: true });
  assert.deepEqual(A.platesPerSide(27.5), { plates: [1.25], perSide: 1.25, exact: true }, "the smallest plate");
});

test("an empty bar has no plates; a weight the set can't make loads the nearest below", () => {
  assert.deepEqual(A.platesPerSide(25), { plates: [], perSide: 0, exact: true });
  assert.deepEqual(A.platesPerSide(20), { plates: [], perSide: 0, exact: false });
  assert.deepEqual(A.platesPerSide(101), { plates: [25, 10, 2.5], perSide: 37.5, exact: false });
});

// --- Meet day --------------------------------------------------------------------------------

const plan = A.attemptPlan(lifts, { pct: 91, ...lifter });

test("the next attempt follows the plan: squat, bench, deadlift, three each", () => {
  assert.deepEqual(A.nextAttempt({}, plan), { lift: "squat", number: 1, planned: 100, min: 25, kg: 100 });
  assert.deepEqual(A.nextAttempt({ squat: [{ kg: 100, good: true }] }, plan), { lift: "squat", number: 2, planned: 105, min: 102.5, kg: 105 });
  const squatsDone = { squat: [{ kg: 100, good: true }, { kg: 105, good: true }, { kg: 112.5, good: false }] };
  assert.deepEqual(A.nextAttempt(squatsDone, plan), { lift: "bench", number: 1, planned: 107.5, min: 25, kg: 107.5 });
});

test("after a miss the same weight is allowed; a plan below the last good lift is raised", () => {
  assert.equal(A.nextAttempt({ squat: [{ kg: 100, good: false }] }, plan).min, 100);
  const heavyOpener = A.nextAttempt({ squat: [{ kg: 107.5, good: true }] }, plan);
  assert.deepEqual([heavyOpener.planned, heavyOpener.min, heavyOpener.kg], [105, 110, 110]);
});

test("all nine taken: no next attempt; the strip marks good, miss, next and to do", () => {
  const three = [{ kg: 100, good: true }, { kg: 105, good: true }, { kg: 110, good: true }];
  assert.equal(A.nextAttempt({ squat: three, bench: three, deadlift: three }, plan), null);
  const attempts = { squat: [{ kg: 100, good: true }, { kg: 105, good: false }] };
  const states = A.attemptStates(attempts, A.nextAttempt(attempts, plan)).map((a) => a.state);
  assert.deepEqual(states, ["good", "miss", "next", "todo", "todo", "todo", "todo", "todo", "todo"]);
});
