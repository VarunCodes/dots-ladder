// Run with: npm test  (or: node --test app/*.test.js)
import { test } from "node:test";
import assert from "node:assert/strict";

import { CHART, DENSE_FROM, chartModel, edgeBands, inRange, monthTicks, windowStart, nearestPoint, onePerDay, progressStats, rungCrossings, rungLines, tipPlacement, valueTicks } from "./chart.js";

const rungs = [{ percentile: 10, score: 266 }, { percentile: 25, score: 300 }, { percentile: 50, score: 338 }];
const entry = (id, date, score) => ({ id, date, score, otherSex: false });
// Inside the plot, and clear of the right-hand gutter where the rung labels sit.
const inPlot = (p) => p.x >= CHART.left && p.x <= CHART.width - CHART.right - CHART.gutter && p.y >= 0 && p.y <= CHART.height - CHART.bottom;

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
  const plotMid = (CHART.left + CHART.width - CHART.right - CHART.gutter) / 2;
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

test("value labels: about three round numbers inside the range", () => {
  assert.deepEqual(valueTicks(262, 318), [280, 300]);
  assert.deepEqual(valueTicks(52.1, 61.3), [55, 60], "GL scale");
  for (const [low, high] of [[262, 318], [52.1, 61.3], [299.5, 300.5], [100, 900]]) {
    const ticks = valueTicks(low, high);
    assert.ok(ticks.length >= 2 && ticks.length <= 5 && ticks.every((t) => t >= low && t <= high), `${low}–${high}: ${ticks}`);
  }
});

test("a rung is cleared on the first day at or above it, after a day below it", () => {
  const list = [entry("a", "2026-05-01", 270), entry("b", "2026-06-01", 299), entry("c", "2026-07-01", 305), entry("d", "2026-08-01", 290), entry("e", "2026-09-01", 340)];
  assert.deepEqual(rungCrossings(list, rungs).map((c) => [c.percentile, c.id]), [[25, "c"], [50, "e"]]);
  assert.deepEqual(rungCrossings([entry("a", "2026-05-01", 280), entry("b", "2026-06-01", 290)], rungs), [], "P10 was cleared from the start");
  const model = chartModel(list, rungs);
  assert.deepEqual(model.points.filter((p) => p.cleared).map((p) => p.id), ["c", "e"]);
});

test("the first rung above the plot is named as off the chart", () => {
  const model = chartModel([entry("a", "2026-05-01", 270), entry("b", "2026-06-01", 280)], rungs);
  assert.equal(model.offChart.percentile, 50, "P25 is drawn as the next rung; P50 is above the plot");
  assert.equal(chartModel([entry("a", "2026-05-01", 330), entry("b", "2026-06-01", 340)], rungs).offChart, null);
});

test("the tooltip sits on the side of its point with more room, inside the data area, nudged in near the top and bottom", () => {
  const dataRight = CHART.width - CHART.right - CHART.gutter;
  assert.deepEqual(tipPlacement({ x: 60, y: 150 }), { side: "right", level: "bottom", room: (dataRight - 60) / CHART.width });
  assert.equal(tipPlacement({ x: dataRight - 10, y: 90 }).side, "left", "the latest test: left, away from the rung labels");
  assert.equal(tipPlacement({ x: 120, y: 30 }).level, "top");
  const centred = (CHART.left + dataRight) / 2;
  assert.equal(tipPlacement({ x: centred, y: 90 }).side, "right", "a single centred test: right");
});

test("tiles: total and bodyweight change, average per month, rungs cleared", () => {
  const day = (id, date, score, bodyweight, squat) => ({ ...entry(id, date, score), test: { bodyweight, squat, bench: 100, deadlift: 150 } });
  const list = [day("a", "2026-01-01", 270, 70, 120), day("b", "2026-03-02", 290, 69, 130), day("c", "2026-07-01", 310, 67.9, 150)];
  const stats = progressStats(list, rungs);
  assert.deepEqual(stats.total, { now: 400, change: 30 });
  assert.equal(stats.bodyweight.now, 67.9);
  assert.equal(stats.bodyweight.change.toFixed(1), "-2.1");
  assert.equal(stats.perMonth.toFixed(1), "6.7", "40 points over about 6 months");
  assert.deepEqual(stats.cleared.map((c) => c.percentile), [25]);
  assert.equal(progressStats([list[0], { ...list[1], date: "2026-01-20" }], rungs).perMonth, null, "under 4 weeks: no average");
  assert.equal(progressStats([list[0]], rungs).perMonth, null);
});

test("the month after your latest test is always labelled", () => {
  const list = [entry("a", "2026-02-13", 240), entry("b", "2026-06-18", 321), entry("c", "2026-08-13", 358), entry("d", "2026-10-29", 371)];
  const labels = chartModel(list, rungs).ticks.map((t) => t.label);
  assert.deepEqual(labels.slice(-2), ["Oct", "Dec"], "every 2nd month, so Dec is the next label after 29 Oct");
  const short = chartModel([entry("a", "2026-09-01", 270), entry("b", "2026-10-29", 280)], rungs).ticks.map((t) => t.label);
  assert.ok(short.includes("Nov"), `the month after 29 Oct is labelled: ${short}`);
  for (const model of [chartModel(list, rungs)]) assert.ok(model.ticks.at(-1).x <= CHART.width - CHART.right - CHART.gutter + 1, "the label stays in the data area");
});

test("above the top rung there's no next-rung label, so the plot uses the space at the top", () => {
  const highest = [entry("a", "2026-05-01", 345), entry("b", "2026-06-01", 360)];
  const below = [entry("a", "2026-05-01", 280), entry("b", "2026-06-01", 290)];
  const top = (list) => Math.min(...chartModel(list, rungs).points.map((p) => p.y));
  assert.ok(top(highest) < CHART.top, `${top(highest)}: the top point rises into the label room`);
  assert.ok(top(below) > CHART.top, "with a next rung, its label keeps that room");
});

test("edge bands: Top and Bottom beyond the published rungs, never P0 or P100", () => {
  assert.deepEqual(edgeBands(rungs, [280, 290]), [], "inside the rungs: no band");
  assert.deepEqual(edgeBands(rungs, [300, 345]).map((b) => [b.edge, b.label]), [["top", "Top 50%"]], "above the group's top rung (P50 here)");
  assert.deepEqual(edgeBands(rungs, [250, 290]).map((b) => [b.edge, b.label]), [["bottom", "Bottom 10%"]]);
  const full = [{ percentile: 10, score: 266 }, { percentile: 50, score: 338 }, { percentile: 90, score: 401 }];
  assert.deepEqual(edgeBands(full, [250, 410]).map((b) => b.label), ["Top 10%", "Bottom 10%"]);
  assert.deepEqual(edgeBands([], [300]), []);
  const model = chartModel([entry("a", "2026-05-01", 250), entry("b", "2026-06-01", 345)], rungs);
  const [top, bottom] = model.bands;
  assert.ok(top.y1 < top.y2 && bottom.y1 < bottom.y2, "each band spans from its rung to the plot's edge");
  assert.ok(model.rungs.some((r) => r.percentile === 50) && model.rungs.some((r) => r.percentile === 10), "the edge rungs are drawn");
  assert.ok(!JSON.stringify(model).includes("P100") && !JSON.stringify(model).includes("P0 "), "no extremes");
});

test("the 3-month window ends today; a short month clamps the day", () => {
  assert.equal(windowStart("2026-10-30"), "2026-07-30");
  assert.equal(windowStart("2026-05-31"), "2026-02-28");
  assert.equal(windowStart("2024-05-31"), "2024-02-29", "leap year");
  assert.equal(windowStart("2026-01-15"), "2025-10-15", "across the new year");
});

test("3M keeps the last 3 months' days, or just the latest when none are that recent; All keeps everything", () => {
  const list = [entry("a", "2026-02-13", 240), entry("b", "2026-06-18", 321), entry("c", "2026-08-13", 358), entry("d", "2026-10-29", 371)];
  assert.deepEqual(inRange(list, "all", "2026-10-30").map((d) => d.id), ["a", "b", "c", "d"]);
  assert.deepEqual(inRange(list, "3m", "2026-10-30").map((d) => d.id), ["c", "d"]);
  assert.deepEqual(inRange(list, "3m", "2027-06-01").map((d) => d.id), ["d"], "nothing recent: the latest still shows");
});

