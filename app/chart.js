// The Progress chart's layout: pure, so it runs under `node --test`. It turns the scores of your dated 1RM tests
// (squat, bench and deadlift maxes) and the rungs into positions in the SVG's viewBox; app/progress.js only draws them.

// Room on the left for the value labels, at the top for the next rung's label above its line, and a gutter on the
// right where rung labels ("P90 · 357") sit: points stop before it, so the latest test never covers a label.
export const CHART = { width: 340, height: 190, left: 34, right: 6, gutter: 62, top: 24, bottom: 26 };
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

/** The first day of the 3-month window ending today ("2026-07-30" for "2026-10-30"); a short month clamps (31 May → 28 Feb). */
export function windowStart(today) {
  const [y, m, d] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 4, 1));
  const last = new Date(Date.UTC(y, m - 3, 0)).getUTCDate(); // days in that month
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/** The days in view: all of them, or the last 3 months'. With nothing that recent, the latest day still shows. */
export function inRange(days, range, today) {
  if (range === "all") return days;
  const start = windowStart(today);
  const recent = days.filter((d) => d.date >= start);
  return recent.length ? recent : days.slice(-1);
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
 * Where the tooltip sits: beside the point, on the side with more room within the data area (so it never covers
 * the value labels on the left or the rung labels in the right gutter), level with it, nudged in near the top and
 * bottom. `room` is that side's share of the chart's width, for capping the tooltip's width.
 */
export function tipPlacement(point) {
  const { width, height, left, right, gutter } = CHART;
  const [roomLeft, roomRight] = [point.x - left, width - right - gutter - point.x];
  const side = roomLeft > roomRight ? "left" : "right";
  const level = point.y < height * 0.25 ? "top" : point.y > height * 0.6 ? "bottom" : "middle";
  return { side, level, room: Math.max(roomLeft, roomRight) / width };
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

/**
 * Bands for scores beyond the published rungs: "Top 10%" above the group's top rung and "Bottom 10%" below its
 * lowest, each only when a test sits in it. The extremes themselves (P0, P100) are single lifters' results, so
 * they're never shown; the band says how far out you are instead.
 */
export function edgeBands(rungs, scores) {
  if (!rungs.length) return [];
  const [lowest, top] = [rungs[0], rungs.at(-1)];
  const bands = [];
  if (scores.some((s) => s >= top.score)) bands.push({ edge: "top", rung: top, label: `Top ${100 - top.percentile}%` });
  if (scores.some((s) => s < lowest.score)) bands.push({ edge: "bottom", rung: lowest, label: `Bottom ${lowest.percentile}%` });
  return bands;
}

/** The rungs drawn as lines: those between your lowest and highest score, and the next one above your latest. */
export function rungLines(rungs, scores) {
  const low = Math.min(...scores);
  const high = Math.max(...scores);
  const next = rungs.find((r) => r.score > scores.at(-1));
  return rungs.filter((r) => (r.score >= low && r.score <= high) || r === next);
}

/**
 * Month labels from the first to the last day shown: every month, or every 2nd once the range passes 7 months
 * (`every` fixes the step); January shows the year. Each label has its time `at` and position `x`.
 */
export function monthTicks(fromMs, toMs, x, every = (toMs - fromMs) / DAY_MS / 30.44 > 7 ? 2 : 1) {
  const start = new Date(fromMs);
  const year = start.getUTCFullYear();
  let month = start.getUTCMonth() + 1; // the first whole month in view; Date.UTC rolls month 12 into the next year
  const ticks = [];
  for (let at = Date.UTC(year, month, 1); at <= toMs; at = Date.UTC(year, ++month, 1)) {
    const d = new Date(at);
    const m = d.getUTCMonth();
    ticks.push({ at, x: x(at), label: m === 0 ? `Jan ’${String(d.getUTCFullYear()).slice(2)}` : MONTHS[m] });
  }
  return ticks.filter((_, i) => i % every === 0);
}

/**
 * Everything the chart draws, for entries oldest first: [{ id, date, score, otherSex }] and the group's rungs
 * ([{ percentile, score }], lowest first). Returns the points (each marked if it first cleared a rung), the rung
 * lines, the month and value labels, the first rung above the plot, and whether it's dense.
 */
export function chartModel(entries, rungs) {
  const { width, height, left, right, gutter, top, bottom } = CHART;
  const times = entries.map((e) => time(e.date));
  const mid = (times[0] + times.at(-1)) / 2;
  const span = Math.max(times.at(-1) - times[0], MIN_SPAN_DAYS * DAY_MS);
  const pad = span * 0.06;
  const fromMs = mid - span / 2 - pad;
  // The range always reaches the next month label after your latest test, so the month ahead is in view.
  const every = (span + 2 * pad) / DAY_MS / 30.44 > 7 ? 2 : 1;
  const ahead = monthTicks(fromMs, times.at(-1) + 100 * DAY_MS, (at) => at, every).find((t) => t.at > times.at(-1));
  const toMs = Math.max(mid + span / 2 + pad, ahead.at + 6 * DAY_MS);

  const scores = entries.map((e) => e.score);
  const bands = edgeBands(rungs, scores);
  // A band's edge rung is always drawn, so the band has a line to sit against.
  const lines = [...new Set([...rungLines(rungs, scores), ...bands.map((b) => b.rung)])].sort((a, b) => a.score - b.score);
  const values = [...scores, ...lines.map((r) => r.score)];
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const ySpan = Math.max(highest - lowest, highest * 0.04); // a flat history still has some height
  const yMid = (lowest + highest) / 2;
  const [yLow, yHigh] = [yMid - ySpan * 0.56, yMid + ySpan * 0.56];
  // Room at the top only for the next rung's label; above the top rung, the plot uses that space.
  const roof = rungs.some((r) => r.score > scores.at(-1)) ? top : 10;

  const x = (ms) => left + ((ms - fromMs) / (toMs - fromMs)) * (width - left - right - gutter);
  const y = (value) => roof + ((yHigh - value) / (yHigh - yLow)) * (height - roof - bottom);

  const cleared = new Set(rungCrossings(entries, rungs).map((c) => c.id));
  return {
    points: entries.map((e, i) => ({ ...e, x: x(times[i]), y: y(e.score), cleared: cleared.has(e.id) })),
    rungs: lines.map((r) => ({ ...r, y: y(r.score) })),
    // From the edge rung's line to the top or bottom of the plot.
    bands: bands.map((b) => ({ ...b, y1: b.edge === "top" ? roof : y(b.rung.score), y2: b.edge === "top" ? y(b.rung.score) : height - bottom })),
    ticks: monthTicks(fromMs, toMs, x, every),
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
