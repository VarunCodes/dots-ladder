// Run with: npm test  (or: node --test app/*.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";

import { CHART, DENSE_FROM, chartModel, monthTicks, nearestPoint, onePerDay, rungLines } from "./chart.js";

const rungs = [{ percentile: 10, score: 266 }, { percentile: 25, score: 300 }, { percentile: 50, score: 338 }];
const entry = (id, date, score) => ({ id, date, score, otherSex: false });
const inPlot = (p) => p.x >= CHART.left && p.x <= CHART.width - CHART.right && p.y >= 0 && p.y <= CHART.height - CHART.bottom;

test("one point per day: the day's last-saved test, counting the others", () => {
  const list = [entry("a", "2026-10-15", 277), entry("b", "2026-10-29", 283), entry("c", "2026-10-29", 283), entry("d", "2026-10-29", 324), entry("e", "2026-10-30", 300)];
  const days = onePerDay(list);
  assert.deepEqual(days.map((d) => [d.id, d.sameDay]), [["a", 0], ["d", 2], ["e", 0]]);
  assert.deepEqual(onePerDay([entry("a", "2026-10-15", 277)]).map((d) => d.sameDay), [0]);
  const xs = chartModel(days, rungs).points.map((p) => p.x);
  assert.equal(new Set(xs).size, xs.length, "no two points share an x");
});

test("rung lines: those inside your range, plus the next one above your latest score", () => {
  assert.deepEqual(rungLines(rungs, [277.9]).map((r) => r.percentile), [25], "one test: just the next rung");
  assert.deepEqual(rungLines(rungs, [250, 270, 290]).map((r) => r.percentile), [10, 25]);
  assert.deepEqual(rungLines(rungs, [250, 340]).map((r) => r.percentile), [10, 25, 50], "above every rung: no next, all in range");
  assert.deepEqual(rungLines([], [277.9]), []);
});

test("one test sits centred, with the next rung above it", () => {
  const model = chartModel([entry("a", "2026-10-26", 277.9)], rungs);
  const [point] = model.points;
  const plotMid = (CHART.left + CHART.width - CHART.right) / 2;
  assert.ok(Math.abs(point.x - plotMid) < 1, `x ${point.x}`);
  assert.equal(model.rungs.length, 1);
  assert.ok(model.rungs[0].y < point.y, "P25 is drawn above the test");
  assert.ok(model.ticks.length >= 3 && model.ticks.length <= 5, "about four months of labels");
  assert.equal(model.dense, false);
});

test("tests run left to right in date order, higher scores higher up, all inside the plot", () => {
  const list = [entry("a", "2026-11-02", 270), entry("b", "2026-12-10", 282), entry("c", "2027-01-15", 276), entry("d", "2027-03-20", 311)];
  const { points, rungs: lines } = chartModel(list, rungs);
  for (let i = 1; i < points.length; i++) assert.ok(points[i].x > points[i - 1].x);
  assert.ok(points[3].y < points[1].y && points[1].y < points[2].y && points[2].y < points[0].y);
  assert.ok(points.every(inPlot), JSON.stringify(points.map((p) => [p.x, p.y])));
  assert.ok(lines.every((r) => r.y >= 0 && r.y <= CHART.height - CHART.bottom));
});

test("a flat history and same-day tests still get a usable chart, with no NaN", () => {
  for (const list of [
    [entry("a", "2026-10-26", 277.9), entry("b", "2026-10-26", 277.9)],
    [entry("a", "2026-10-01", 300), entry("b", "2026-10-29", 300)],
  ]) {
    const { points } = chartModel(list, []);
    assert.ok(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && inPlot(p)));
  }
});

test(`dense from ${DENSE_FROM} tests`, () => {
  const list = Array.from({ length: DENSE_FROM }, (_, i) => entry(`t${i}`, `2026-${String(i + 1).padStart(2, "0")}-15`, 260 + i * 3));
  assert.equal(chartModel(list.slice(1), rungs).dense, false);
  assert.equal(chartModel(list, rungs).dense, true);
});

test("month labels: every month up to 7 months, every 2nd beyond; January shows the year", () => {
  const x = () => 0;
  const short = monthTicks(Date.UTC(2026, 10, 10), Date.UTC(2027, 3, 20), x).map((t) => t.label);
  assert.deepEqual(short, ["Dec", "Jan ’27", "Feb", "Mar", "Apr"]);
  const long = monthTicks(Date.UTC(2025, 10, 10), Date.UTC(2026, 10, 20), x).map((t) => t.label);
  assert.deepEqual(long, ["Dec", "Feb", "Apr", "Jun", "Aug", "Oct"]);
  assert.deepEqual(monthTicks(Date.UTC(2026, 11, 5), Date.UTC(2027, 1, 2), x).map((t) => t.label), ["Jan ’27", "Feb"], "December rolls into the next year");
});

test("a tap selects the nearest test by x", () => {
  const points = [{ id: "a", x: 20 }, { id: "b", x: 60 }, { id: "c", x: 64 }];
  assert.equal(nearestPoint(points, 0).id, "a");
  assert.equal(nearestPoint(points, 41).id, "b");
  assert.equal(nearestPoint(points, 63).id, "c");
  assert.equal(nearestPoint(points, 300).id, "c");
});
