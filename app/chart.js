// The Progress chart's layout: pure, so it runs under `node --test`. It turns dated scores and the rungs into
// positions in the SVG's viewBox; app/progress.js only draws them.

export const CHART = { width: 340, height: 170, left: 10, right: 46, top: 14, bottom: 26 };
export const DENSE_FROM = 10;

const DAY_MS = 86_400_000;
const MIN_SPAN_DAYS = 120; // a single test sits centred in four months, as do tests close together
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const time = (day) => Date.UTC(...day.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)));

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
 * ([{ percentile, score }], lowest first). Returns the points, the rung lines, the month ticks and whether it's dense.
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

  return {
    points: entries.map((e, i) => ({ ...e, x: x(times[i]), y: y(e.score) })),
    rungs: lines.map((r) => ({ ...r, y: y(r.score) })),
    ticks: monthTicks(fromMs, toMs, x),
    dense: entries.length >= DENSE_FROM,
  };
}

/** The point nearest a tap's x position (the whole plot is one touch area, as points can be closer than 44px). */
export function nearestPoint(points, x) {
  return points.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best));
}
