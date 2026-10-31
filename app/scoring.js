// Scoring formulas as data: no DOM, so it runs in the browser and under `node --test`.
// Each formula is a coefficient table plus a factor, and score = total × factor; adding one
// (Wilks, say) is one more entry in FORMULAS. DOTS mirrors pipeline/build_rungs.py, and so does GL.

const DOTS = {
  M: { a: -0.000001093, b: 0.0007391293, c: -0.1918759221, d: 24.0900756, e: -307.75076, minBw: 40, maxBw: 210 },
  F: { a: -0.0000010706, b: 0.0005158568, c: -0.1126655495, d: 13.6175032, e: -57.96288, minBw: 40, maxBw: 150 },
};

// IPF GL points (A, B, C) by sex, equipment and event. Men's classic C is 0.00921: some copies of
// the IPF's PDF misprint it as 0.09210, which scores a 370 kg total at 70 kg about 30.9.
const GL = {
  M: {
    minBw: 40,
    classic: { full: [1199.72839, 1025.18162, 0.00921], bench: [320.98041, 281.40258, 0.01008] },
    equipped: { full: [1236.25115, 1449.21864, 0.01644], bench: [381.22073, 733.79378, 0.02398] },
  },
  F: {
    minBw: 35,
    classic: { full: [610.32796, 1045.59282, 0.03048], bench: [142.40398, 442.52671, 0.04724] },
    equipped: { full: [758.63878, 949.31382, 0.02435], bench: [221.82209, 357.00377, 0.02937] },
  },
};

export const FORMULAS = {
  dots: {
    label: "DOTS",
    decimals: 1,
    rungDecimals: 0, // rungs.json rounds DOTS percentiles to whole points
    lightest: (sex) => DOTS[sex].minBw, // below this, bodyweight is clamped
    // DOTS ignores equipment and event.
    factor({ sex, bw }) {
      const { a, b, c, d, e, minBw, maxBw } = DOTS[sex];
      const x = Math.min(Math.max(bw, minBw), maxBw);
      return 500 / (a * x ** 4 + b * x ** 3 + c * x ** 2 + d * x + e);
    },
  },
  gl: {
    label: "GL",
    decimals: 2,
    rungDecimals: 1, // GL is about a fifth of the DOTS scale, so its percentiles keep one decimal place
    lightest: (sex) => GL[sex].minBw,
    factor({ sex, bw, equipment, event }) {
      const [A, B, C] = GL[sex][equipment][event];
      return 100 / (A - B * Math.exp(-C * Math.max(bw, GL[sex].minBw)));
    },
  },
};

export const FORMULA_IDS = Object.keys(FORMULAS);
export const DEFAULT_FORMULA = "dots";

/** The formula's points for a total ("total" is the bench result when event is "bench"); 0 for a total of 0. */
export function score(formula, { total, bw, sex, equipment = "classic", event = "full" }) {
  return total ? total * FORMULAS[formula].factor({ sex, bw, equipment, event }) : 0;
}

/** Total (kg) that scores the given points at a bodyweight. */
export function totalForScore(formula, { points, bw, sex, equipment = "classic", event = "full" }) {
  return points / FORMULAS[formula].factor({ sex, bw, equipment, event });
}

/** Kg to add to the total to reach the next rung's score, rounded up to 2.5 kg because attempts go up in 2.5 kg steps; 0 if already there. */
export function kgToNextRung(formula, { total, bw, sex, equipment, event }, rungScore) {
  const raw = totalForScore(formula, { points: rungScore, bw, sex, equipment, event }) - total;
  return raw > 0 ? Math.ceil(raw / 2.5 - 1e-9) * 2.5 : 0;
}

/** The same total scored at another bodyweight, e.g. the class you're cutting to. */
export function scoreAtBodyweight(formula, total, targetBw, sex) {
  return score(formula, { total, bw: targetBw, sex });
}

/**
 * What a kilo of bodyweight is worth at your total and bodyweight: { perKgBw (points for 1 kg lighter), perBarStep
 * (points for 2.5 kg more on the total), kgOnBarPerKgBw (the kg on the total that 1 kg lighter is worth) }. Losing a
 * kilo is null when it doesn't raise the score: under the formula's lightest bodyweight, or past DOTS's heaviest.
 */
export function exchangeRate(formula, { total, bw, sex }) {
  const now = score(formula, { total, bw, sex });
  const perBarStep = score(formula, { total: total + 2.5, bw, sex }) - now;
  const gain = score(formula, { total, bw: bw - 1, sex }) - now;
  if (bw - 1 < FORMULAS[formula].lightest(sex) || !(gain > 1e-9)) return { perKgBw: null, perBarStep, kgOnBarPerKgBw: null };
  return { perKgBw: gain, perBarStep, kgOnBarPerKgBw: totalForScore(formula, { points: now + gain, bw, sex }) - total };
}

/** A score at the formula's display precision: DOTS "277.9", GL "55.92". */
export function formatScore(formula, value) {
  return value.toFixed(FORMULAS[formula].decimals);
}

/** A rung's score at the precision rungs.json stores it: DOTS "300", GL "72.4". */
export function formatRung(formula, value) {
  return value.toFixed(FORMULAS[formula].rungDecimals);
}
