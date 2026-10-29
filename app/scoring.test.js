// Run with: npm test  (or: node --test app/*.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";

import * as S from "./scoring.js";

const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} not within ${tolerance} of ${expected}`);

const dots = (total, bw, sex) => S.score("dots", { total, bw, sex });
const gl = (total, bw, sex, options = {}) => S.score("gl", { total, bw, sex, ...options });
const shown = (formula, value) => S.formatScore(formula, value);

// --- DOTS: the design spec's section 7, and the same values as pipeline/test_build_rungs.py ---

test("DOTS matches the design spec's required cases", () => {
  assert.equal(shown("dots", dots(370, 70.0, "M")), "277.9");
  assert.equal(shown("dots", dots(370, 66.0, "M")), "289.9");
  assert.equal(shown("dots", dots(500, 93.0, "M")), "318.1");
  assert.equal(shown("dots", dots(300, 60.0, "F")), "332.6");
  assert.equal(shown("dots", dots(0, 70, "M")), "0.0");
});

test("DOTS matches the pipeline for men and women", () => {
  near(dots(370, 70, "M"), 277.93, 0.01);
  near(dots(300, 60, "F"), 332.56, 0.01);
});

test("DOTS clamps bodyweight like the pipeline, with no NaN or Infinity", () => {
  assert.equal(dots(300, 20, "M"), dots(300, 40, "M"));
  assert.equal(dots(300, 250, "M"), dots(300, 210, "M"));
  assert.equal(dots(300, 200, "F"), dots(300, 150, "F"));
  for (const bw of [0, 10, 39, 250, 1000]) {
    for (const sex of ["M", "F"]) assert.ok(Number.isFinite(dots(370, bw, sex)), `${sex} at ${bw} kg`);
  }
});

test("DOTS ignores equipment and event", () => {
  const plain = dots(370, 70, "M");
  assert.equal(S.score("dots", { total: 370, bw: 70, sex: "M", equipment: "equipped", event: "bench" }), plain);
});

// --- GL: IPF GL points --------------------------------------------------------------

test("GL, men's classic full power, 370 kg total", () => {
  assert.deepEqual([66, 70, 74, 83].map((bw) => shown("gl", gl(370, bw, "M"))), ["57.68", "55.92", "54.32", "51.22"]);
});

test("GL, women's classic full power: 300 kg at 60 kg", () => {
  assert.equal(shown("gl", gl(300, 60, "F")), "67.81");
});

test("GL uses men's classic C = 0.00921, not the misprinted 0.09210 (which gives about 30.9)", () => {
  const value = gl(370, 70, "M");
  assert.ok(Math.abs(value - 30.9) > 10, `${value} looks like the misprinted constant`);
  near(value, 55.92, 0.005);
});

test("GL: a total of 0 is 0, and bodyweight below the minimum is clamped, with no NaN or Infinity", () => {
  assert.equal(gl(0, 70, "M"), 0);
  assert.equal(gl(0, 0, "F"), 0);
  assert.equal(gl(370, 20, "M"), gl(370, 40, "M"), "men's minimum is 40 kg");
  assert.equal(gl(300, 20, "F"), gl(300, 35, "F"), "women's minimum is 35 kg");
  assert.notEqual(gl(300, 36, "F"), gl(300, 35, "F"), "women aren't clamped at 40 kg");
  for (const sex of ["M", "F"]) {
    for (const equipment of ["classic", "equipped"]) {
      for (const event of ["full", "bench"]) {
        for (const bw of [0, 10, 35, 40, 150, 300]) {
          const value = gl(200, bw, sex, { equipment, event });
          assert.ok(Number.isFinite(value) && value > 0, `${sex} ${equipment} ${event} at ${bw} kg: ${value}`);
        }
      }
    }
  }
});

// One result per sex, equipment and event, checked against OpenPowerlifting's own GL score (its Goodlift column,
// from its separate implementation), so a wrong or swapped coefficient set fails here. Numbers only: each
// bodyweight and total is shared by 2+ lifters near that combination's median bodyweight (Oct 2026 snapshot).
const OPENPOWERLIFTING_GL = [
  { sex: "M", equipment: "classic", event: "full", bw: 87.72, total: 545, expected: "73.38" },
  { sex: "M", equipment: "classic", event: "bench", bw: 88.7, total: 140, expected: "68.00" },
  { sex: "M", equipment: "equipped", event: "full", bw: 82.5, total: 570, expected: "66.06" },
  { sex: "M", equipment: "equipped", event: "bench", bw: 89.75, total: 167.5, expected: "56.60" },
  { sex: "F", equipment: "classic", event: "full", bw: 66.9, total: 347.5, expected: "73.27" },
  { sex: "F", equipment: "classic", event: "bench", bw: 63.3, total: 52.5, expected: "43.69" },
  { sex: "F", equipment: "equipped", event: "full", bw: 62.4, total: 270, expected: "49.01" },
  { sex: "F", equipment: "equipped", event: "bench", bw: 62.46, total: 110, expected: "66.74" },
];

test("GL matches OpenPowerlifting's independent scores for every sex, equipment and event", () => {
  for (const { sex, equipment, event, bw, total, expected } of OPENPOWERLIFTING_GL) {
    assert.equal(shown("gl", gl(total, bw, sex, { equipment, event })), expected, `${sex} ${equipment} ${event}`);
  }
});

test("GL picks the coefficients for equipment and event", () => {
  const classicFull = gl(370, 70, "M");
  assert.notEqual(gl(370, 70, "M", { equipment: "equipped" }), classicFull);
  assert.notEqual(gl(150, 70, "M", { event: "bench" }), gl(150, 70, "M"));
  assert.ok(gl(370, 70, "M", { equipment: "equipped" }) < classicFull, "the same total is worth less equipped");
});

// --- Helpers that take a formula --------------------------------------------------------

test("totalForScore inverts score for both formulas", () => {
  for (const formula of S.FORMULA_IDS) {
    const points = S.score(formula, { total: 412.5, bw: 70, sex: "M" });
    near(S.totalForScore(formula, { points, bw: 70, sex: "M" }), 412.5, 1e-9);
  }
});

test("kg to the next rung rounds up to 2.5 kg (DOTS: raw 6.35 kg shows +7.5 kg)", () => {
  const me = { total: 370, bw: 70, sex: "M" };
  assert.equal(S.kgToNextRung("dots", me, 282.7), 7.5);
  assert.equal(S.kgToNextRung("dots", me, dots(375, 70, "M")), 5, "exactly 5 kg stays 5");
  assert.equal(S.kgToNextRung("dots", me, 270), 0, "already above");
  assert.equal(S.kgToNextRung("gl", me, gl(375, 70, "M")), 5);
  assert.equal(S.kgToNextRung("gl", me, gl(375.1, 70, "M")), 7.5);
  assert.equal(S.kgToNextRung("gl", me, 50), 0, "already above");
});

test("kg to the next rung is a multiple of 2.5 for both formulas", () => {
  for (const formula of S.FORMULA_IDS) {
    for (const sex of ["M", "F"]) {
      for (const bw of [52, 66, 74.3, 93, 130]) {
        const now = S.score(formula, { total: 350, bw, sex });
        for (const extra of [0.01, 0.3, 1, 3.7, 12.34]) {
          const kg = S.kgToNextRung(formula, { total: 350, bw, sex }, now * (1 + extra / 100));
          assert.ok(kg > 0 && Number.isInteger(kg / 2.5), `${formula} ${sex} ${bw} kg +${extra}%: ${kg}`);
        }
      }
    }
  }
});

test("the same total scores higher at a lighter bodyweight, in both formulas", () => {
  assert.equal(shown("dots", S.scoreAtBodyweight("dots", 370, 66, "M")), "289.9");
  assert.equal(shown("gl", S.scoreAtBodyweight("gl", 370, 66, "M")), "57.68");
  for (const formula of S.FORMULA_IDS) {
    assert.ok(S.scoreAtBodyweight(formula, 370, 66, "M") > S.score(formula, { total: 370, bw: 70, sex: "M" }), formula);
  }
});

test("display precision: DOTS to 1 decimal place, GL to 2; rungs DOTS whole, GL to 1", () => {
  assert.equal(S.formatScore("dots", 277.93), "277.9");
  assert.equal(S.formatScore("gl", 55.9234), "55.92");
  assert.equal(S.formatRung("dots", 300), "300");
  assert.equal(S.formatRung("gl", 72), "72.0");
  assert.deepEqual(S.FORMULA_IDS, ["dots", "gl"]);
  assert.equal(S.DEFAULT_FORMULA, "dots");
});
