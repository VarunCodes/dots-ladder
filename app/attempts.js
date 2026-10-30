// Meet maths: attempts, plates, warm-ups and results. Pure functions only (no DOM, no storage); derive.js builds
// the Meet screen's values from them, and meet.js only draws those values.
import { LIFTS } from "./ladder.js";
import { score } from "./scoring.js";

// --- Attempt planner ---------------------------------------------------------------------

export { OPENER_PCTS } from "./ladder.js"; // saved with your settings, so ladder.js checks it
export const DEFAULT_OPENER = 91;
export const SECOND_PCT = 96;
export const THIRD_ADD = 2.5; // a third is a 2.5 kg PR attempt
export const STEP_KG = 2.5; // attempts go up in 2.5 kg

/** Rounds down to the nearest step (2.5 kg), so a planned attempt is never heavier than its percentage. */
export function floorTo(kg, step = STEP_KG) {
  return Math.floor(kg / step + 1e-9) * step;
}

/**
 * The three attempts per lift from your 1RMs: openers at `pct` and seconds at 96%, both rounded down to 2.5 kg,
 * thirds at 1RM + 2.5 kg. Each step (all openers, all seconds, all thirds) has its total and score at
 * `bodyweight`, and a note on the rungs: the highest one it would newly clear, else how far short of the next.
 */
export function attemptPlan(lifts, { pct = DEFAULT_OPENER, bodyweight, sex, formula, rungs = [], now = 0 }) {
  const at = (fn) => Object.fromEntries(LIFTS.map((lift) => [lift, fn(lifts[lift])]));
  const steps = [
    { id: "openers", label: "Openers", lifts: at((kg) => floorTo((kg * pct) / 100)) },
    { id: "seconds", label: "Seconds", lifts: at((kg) => floorTo((kg * SECOND_PCT) / 100)) },
    { id: "thirds", label: "All thirds", lifts: at((kg) => kg + THIRD_ADD) },
  ].map((step) => {
    const total = LIFTS.reduce((sum, lift) => sum + step.lifts[lift], 0);
    const points = score(formula, { total, bw: bodyweight, sex });
    return { ...step, total, score: points, note: stepNote(rungs, now, points) };
  });
  return { pct, bodyweight, lifts: at((kg) => kg), steps };
}

/**
 * Where a planned score lands among the rungs, for its note: { kind: "clears", rung } for the highest rung above
 * your score now that it reaches, else { kind: "short", rung, by } for the next rung above it, else { kind: "top" }.
 * Null without rungs.
 */
export function stepNote(rungs, now, points) {
  if (!rungs.length) return null;
  const cleared = rungs.findLast((r) => r.score <= points && r.score > now);
  if (cleared) return { kind: "clears", rung: cleared };
  const next = rungs.find((r) => r.score > points);
  return next ? { kind: "short", rung: next, by: next.score - points } : { kind: "top" };
}

// --- Plate loader --------------------------------------------------------------------------

export const BAR_KG = 20;
export const COLLAR_KG = 2.5; // each, as at a meet
export const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25]; // a full calibrated set, largest first
export const BAR_LIMITS = [BAR_KG + 2 * COLLAR_KG, 500]; // the loader's range: an empty bar with collars, up to 500

/**
 * The plates for one side of the bar, inside to outside, largest first: { plates, perSide, exact }. perSide is
 * what those plates weigh; exact is false when the weight can't be made from the set (then it's the nearest
 * below). Below an empty bar with collars there are no plates.
 */
export function platesPerSide(total) {
  const wanted = Math.max(0, (total - BAR_KG - 2 * COLLAR_KG) / 2);
  // Work in quarter kilos, so 1.25 kg plates add up without rounding errors.
  let left = Math.round(wanted * 4);
  const plates = [];
  for (const plate of PLATES_KG) {
    const units = plate * 4;
    while (left >= units) {
      plates.push(plate);
      left -= units;
    }
  }
  const perSide = plates.reduce((sum, plate) => sum + plate, 0);
  return { plates, perSide, exact: BAR_KG + 2 * (COLLAR_KG + perSide) === total };
}

// --- Meet day --------------------------------------------------------------------------------

export const ATTEMPT_NAMES = ["Opener", "Second attempt", "Third attempt"];

/**
 * Your next attempt from what's been taken so far ({ squat: [{ kg, good }], ... }) and the plan: squat, then bench,
 * then deadlift, three each. { lift, number (1–3), planned, min, kg }: min is the lightest allowed (the same weight
 * again after a miss, 2.5 kg more after a good lift), and kg is the plan's weight, raised to min if needed.
 * Null once all nine are taken.
 */
export function nextAttempt(attempts, plan) {
  const lift = LIFTS.find((l) => (attempts?.[l]?.length ?? 0) < 3);
  if (!lift) return null;
  const done = attempts?.[lift] ?? [];
  const planned = plan.steps[done.length].lifts[lift];
  const last = done.at(-1);
  const min = last ? last.kg + (last.good ? STEP_KG : 0) : BAR_KG + 2 * COLLAR_KG;
  return { lift, number: done.length + 1, planned, min, kg: Math.max(planned, min) };
}

/** All nine attempts in order, each "good", "miss", "next" or "todo", for the progress strip. */
export function attemptStates(attempts, next) {
  return LIFTS.flatMap((lift) =>
    [0, 1, 2].map((i) => {
      const taken = attempts?.[lift]?.[i];
      const state = taken ? (taken.good ? "good" : "miss") : next?.lift === lift && next.number === i + 1 ? "next" : "todo";
      return { lift, number: i + 1, state };
    }),
  );
}
