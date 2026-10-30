// The Progress chart's layout: pure, so it runs under `node --test`. It turns the scores of your dated 1RM tests
// (squat, bench and deadlift maxes) and the rungs into positions in the SVG's viewBox; app/progress.js only draws them.

// Room on the left for the value labels, and at the top for the next rung's label above its line.
export const CHART = { width: 340, height: 190, left: 34, right: 6, top: 24, bottom: 26 };
export const DENSE_FROM = 10;

const DAY_MS = 86_400_000;
const MIN_SPAN_DAYS = 120; // a single test sits centred in four months, as do tests close together
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const time = (day) => Date.UTC(...day.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)));

/**
 * One point per day: the day's last-saved 1RM test, the same one the Ladder treats as latest. Entries are oldest
 * first (same-day tests in save order); each kept entry gets `sameDay`, how many other tests that day it stands for.
 */
export function onePerDay(entries) {
  return entries.flatMap((entry, i) => {
    if (entries[i + 1]?.date === entry.date) return [];
    const sameDay = entries.filter((e) => e.date === entry.date).length - 1;
    return [{ ...entry, sameDay }];
  });
}

/** Round values for the y-axis labels: about three, on a 1, 2 or 5 step (270, 290, 310). */
export function valueTicks(low, high) {
  const span = high - low;
  const power = 10 ** Math.floor(Math.log10(span / 3));
  const steps = [1, 2, 5, 10].map((m) => m * power);
  const step = steps.reduce((best, s) => (Math.abs(span / s - 3) < Math.abs(span / best - 3) ? s : best)); // nearest to 3 labels
  const ticks = [];
  for (let v = Math.ceil(low / step) * step; v <= high; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** Where each rung was first cleared: the first day at or above it, after a day below it. A rung cleared from the start isn't counted. */
export function rungCrossings(days, rungs) {
  return rungs.flatMap((rung) => {
    const i = days.findIndex((d) => d.score >= rung.score);
    return i > 0 ? [{ ...rung, id: days[i].id, date: days[i].date }] : [];
  });
}

/**
 * Where the tooltip sits: beside the point, to its right (off the value labels on the left) unless the point is in
 * the right 40%, where it goes left (off the rung labels at the right edge); level with it, nudged in near the top
 * and bottom.
 */
export function tipPlacement(point) {
  const { width, height } = CHART;
  const side = point.x > width * 0.6 ? "left" : "right";
  const level = point.y < height * 0.25 ? "top" : point.y > height * 0.6 ? "bottom" : "middle";
  return { side, level };
}

/**
 * The tiles under the chart, for days oldest first ([{ score, test, date }]): the latest total and bodyweight
 * with their change since the first day, the average score change per month (null with under 4 weeks between
 * first and last), and the rungs cleared along the way.
 */
export function progressStats(days, rungs) {
  const [first, last] = [days[0], days.at(-1)];
  const total = (d) => d.test.squat + d.test.bench + d.test.deadlift;
  const months = (time(last.date) - time(first.date)) / DAY_MS / 30.44;
  return {
    total: { now: total(last), change: total(last) - total(first) },
    bodyweight: { now: last.test.bodyweight, change: last.test.bodyweight - first.test.bodyweight },
    perMonth: months * 30.44 >= 28 ? (last.score - first.score) / months : null,
    cleared: rungCrossings(days, rungs),
  };
}

/** The rungs drawn as lines: those between your lowest and highest score, and the next one above your latest. */
export function rungLines(rungs, scores) {
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  const next = rungs.find((r) => r.score > scores.at(-1));
  return rungs.filter((r) => (r.score >= low && r.score <= high) || r === next);
}

/** Month labels from the first to the last day shown: every month, or every 2nd once the range passes 7 months; January shows the year. */
export function monthTicks(fromMs, toMs, x) {
  const start = new Date(fromMs);
  const year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1; // the first whole month in view; Date.UTC rolls month 12 into the next year
  const ticks = [];
  for (let at = Date.UTC(year, month, 1); at <= toMs; at = Date.UTC(year, ++month, 1)) {
    const d = new Date(at);
    const m = d.getUTCMonth();
    ticks.push({ x: x(at), label: m === 0 ? `Jan ’${String(d.getUTCFullYear()).slice(2)}` : MONTHS[m] });
  }
  const span = (toMs - fromMs) / DAY_MS / 30.44;
  return span > 7 ? ticks.filter((_, i) => i % 2 === 0) : ticks;
}

/**
 * Everything the chart draws, for entries oldest first: [{ id, date, score, otherSex }] and the group's rungs
 * ([{ percentile, score }], lowest first). Returns the points (each marked if it first cleared a rung), the rung
 * lines, the month and value labels, the first rung above the plot, and whether it's dense.
 */
export function chartModel(entries, rungs) {
  const { width, height, left, right, top, bottom } = CHART;
  const times = entries.map((e) => time(e.date));
  const mid = (times[0] + times.at(-1)) / 2;
  const span = Math.max(times.at(-1) - times[0], MIN_SPAN_DAYS * DAY_MS);
  const pad = span * 0.06;
  const [fromMs, toMs] = [mid - span / 2 - pad, mid + span / 2 + pad];

  const scores = entries.map((e) => e.score);
  const lines = rungLines(rungs, scores);
  const values = [...scores, ...lines.map((r) => r.score)];
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const ySpan = Math.max(highest - lowest, highest * 0.04); // a flat history still has some height
  const yMid = (lowest + highest) / 2;
  const [yLow, yHigh] = [yMid - ySpan * 0.62, yMid + ySpan * 0.62];

  const x = (ms) => left + ((ms - fromMs) / (toMs - fromMs)) * (width - left - right);
  const y = (value) => top + ((yHigh - value) / (yHigh - yLow)) * (height - top - bottom);

  const cleared = new Set(rungCrossings(entries, rungs).map((c) => c.id));
  return {
    points: entries.map((e, i) => ({ ...e, x: x(times[i]), y: y(e.score), cleared: cleared.has(e.id) })),
    rungs: lines.map((r) => ({ ...r, y: y(r.score) })),
    ticks: monthTicks(fromMs, toMs, x),
    values: valueTicks(yLow, yHigh).map((value) => ({ value, y: y(value) })),
    // The first rung above the top of the plot, named under the header so it isn't forgotten.
    offChart: rungs.find((r) => r.score > yHigh) ?? null,
    dense: entries.length >= DENSE_FROM,
  };
}

/** The point nearest a tap's x position (the whole plot is one touch area, as points can be closer than 44px). */
export function nearestPoint(points, x) {
  return points.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best));
}
