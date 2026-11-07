// "Progress" screen. A test here is a powerlifting 1RM test: your one-rep max on squat, bench and deadlift
// on a given day, at a given bodyweight. The screen shows the chart of your scores at those tests, the
// weight-class lever and your numbers (the editable list of tests is on Log test, in history.js). Its numbers come from derive.js, and
// changes go through the store; logic lives in ladder.js and chart.js. This file only renders.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import * as store from "./store.js";
import { derived } from "./derive.js";
import { CHART, TIP_GAP, TIP_LIFT, chartModel, nearestPoint, progressStats, tipSide } from "./chart.js";
import { $, choiceGroup, el, formulaChoice, setNumber } from "./dom.js";
import { fmtDay } from "./events.js";
import { renderYourData } from "./yourdata.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const LIFT_NAMES = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const SEX_WORDS = { M: "Men's", F: "Women's" };

const now = () => derived(store.getState());
let selectedId = null; // the 1RM test shown in the chart's tooltip; null means the latest
let tipShown = true; // tapping the selected test again hides its tooltip; selecting any test shows it

const capital = (text) => text && text[0].toUpperCase() + text.slice(1);
const signed = (formula, n) => `${n >= 0 ? "+" : "−"}${S.formatScore(formula, Math.abs(n))}`;
// "26 Oct", with the year when it isn't this year's.
const shortDay = (day) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(day.slice(0, 4) === now().today.slice(0, 4) ? {} : { year: "numeric" }),
  });

function svg(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text != null) node.textContent = text;
  return node;
}

/** What a day logged (every record that day, combined) and what it carried from earlier days. */
function dayParts(entry) {
  const logged = L.VALUES.filter((name) => entry.from[name] === entry.date);
  return { logged, carried: L.VALUES.filter((name) => !logged.includes(name)) };
}

// --- The chart: one point per day of 1RM testing ---------------------------------------

// The chart's points come from derive.js: one per day (the day's last-saved record), the days in range, and the
// days it plots (for a single lift, only the days that lift was logged).

// "+30 kg", "−2.1 kg", or "±0 kg" when nothing changed.
const kgChange = (n) => {
  const kg = Math.round(n * 10) / 10;
  return `${kg === 0 ? "±" : kg > 0 ? "+" : "−"}${Math.abs(kg)} kg`;
};
const kgValue = (n) => String(Math.round(n * 10) / 10);

/**
 * What the chart plots, and how to write it: your score in the chosen formula (with its rungs), your total or a
 * single lift (Lifts), or your bodyweight. Score draws the score rungs and a single lift its own rungs in kg
 * (same lifters); the total and bodyweight have none. A single lift also marks its PRs.
 */
function measure() {
  const { profile, view } = now();
  const { formula } = profile;
  const label = S.FORMULAS[formula].label;
  const scoreText = (n) => S.formatScore(formula, n);
  const measures = {
    score: { name: label, value: (e) => e.score, num: scoreText, text: scoreText, change: (n) => signed(formula, n), unit: `${label} now`, rungs: true, rungText: (n) => S.formatRung(formula, n) },
    total: { name: "Total", value: (e) => L.sumLifts(e.test), num: kgValue, text: (n) => `${kgValue(n)} kg`, change: kgChange, unit: "kg total now", rungs: false },
    bw: { name: "Bodyweight", value: (e) => e.test.bodyweight, num: kgValue, text: (n) => `${kgValue(n)} kg`, change: kgChange, unit: "kg bodyweight now", rungs: false },
    ...Object.fromEntries(
      L.LIFTS.map((lift) => [
        lift,
        { name: LIFT_NAMES[lift], value: (e) => e.test[lift], num: kgValue, text: (n) => `${kgValue(n)} kg`, change: kgChange, unit: `kg ${lift} now`, rungs: true, rungText: (n) => `${kgValue(n)} kg`, lift },
      ]),
    ),
  };
  return measures[view.metric === "lifts" ? view.lift : view.metric];
}

function renderChart() {
  const m = measure();
  const d = now();
  const list = d.chartDays;
  const scoreRungs = d.group?.rungs ?? [];
  const rungs = m.lift ? d.liftRungs(m.lift) : m.rungs ? scoreRungs : [];
  // A single lift marks the days it set a PR.
  const prDays = m.lift ? d.prDays(m.lift) : new Set();
  // The plotted value is the chosen measure; the tiles below always work on the score.
  const plotted = list.map((e) => ({ ...e, score: m.value(e), pr: prDays.has(e.date) }));
  const model = chartModel(plotted, rungs);
  if (!list.some((e) => e.id === selectedId)) selectedId = null;
  const selected = model.points.find((p) => p.id === selectedId) ?? model.points.at(-1);

  renderControls();
  renderHeader(plotted, model, m);
  // With the tooltip hidden there's no selection to mark: the latest test keeps its ring, and there's no guide line.
  drawPlot(model, tipShown ? selected : null, L.nextRung(rungs, plotted.at(-1).score), m);
  renderTip(plotted, tipShown ? selected : null, m, scoreRungs, list);
  renderLegend(model, m);
  renderStats(d.rangeDays, scoreRungs);
  $("chart-hit").hidden = list.length < 2;
}

/** "men 83 kg, first meet": the group the rungs come from (the Ladder's class and experience). */
function groupName() {
  const { profile, experience } = now();
  return `${profile.sex === "M" ? "men" : "women"} ${L.effectiveClass(profile)} kg, ${experience}`;
}

/** Score | Total | BW and 3M | All: pressed buttons, saved on this device. */
function renderControls() {
  // Saved through the store; its subscriber redraws the chart.
  const group = (id, options, key) =>
    choiceGroup($(id), "view-option", options, now().view[key], (value) => store.update((s) => ({ view: { ...s.view, [key]: value } })));
  group("chart-metric", [["score", "Score"], ["lifts", "Lifts"], ["bw", "BW"]], "metric");
  // Lifts has a second choice: the total or one lift.
  $("chart-lift").hidden = now().view.metric !== "lifts";
  group("chart-lift", [["total", "Total"], ...L.LIFTS.map((lift) => [lift, LIFT_NAMES[lift]])], "lift");
  group("chart-range", [["3m", "3M"], ["all", "All"]], "range");
}

/** The value now, the change since the first day in range ("Starting point" with one), and a rung too high to draw. */
function renderHeader(list, model, m) {
  const latest = list.at(-1);
  setNumber($("chart-now"), m.num(latest.score));
  $("chart-unit").textContent = m.unit;
  const change = latest.score - list[0].score;
  $("chart-change").textContent = list.length === 1 ? "Starting point" : `${m.change(change)} since ${shortDay(list[0].date)}`;
  // Up is good for the score and the total; a bodyweight change is neither, so it stays muted.
  $("chart-change").className = list.length > 1 && change > 0 && now().view.metric !== "bw" ? "up" : "";
  const off = model.offChart;
  $("chart-offchart").hidden = !off;
  if (off) $("chart-offchart").textContent = `P${off.percentile} · ${m.rungText(off.score)} ↑ off chart`;
  // Which lifters the rung lines come from: they follow your class now, so earlier points at another weight are
  // compared with this class too.
  const rungsFor = $("chart-rungs-for");
  rungsFor.hidden = !model.rungs.length;
  rungsFor.textContent = `${m.lift ? `${LIFT_NAMES[m.lift]} rungs` : "Rungs"}: ${groupName()}`;
}

/** The SVG: bands, value gridlines and labels, rung lines with their values, month labels, the line, and the points. */
function drawPlot(model, selected, next, m) {
  const { width, height, left, right, bottom } = CHART;
  const [first, latest] = [model.points[0], model.points.at(-1)];
  const plot = $("chart");
  plot.setAttribute("viewBox", `0 0 ${width} ${height}`);
  plot.setAttribute(
    "aria-label",
    model.points.length === 1
      ? `${m.name} over time: one test, ${m.text(latest.score)} on ${fmtDay(latest.date)}.`
      : `${m.name} over time: ${m.text(first.score)} on ${fmtDay(first.date)} to ${m.text(latest.score)} on ${fmtDay(latest.date)}, across ${model.points.length} days of tests.`,
  );

  const nodes = [];
  // Beyond the top or lowest rung: a faint band, named in the label gutter ("Top 10%" above its line, "Bottom 10%" at the foot).
  for (const band of model.bands) {
    nodes.push(
      svg("rect", { class: "chart-band", x: left, y: band.y1, width: width - right - left, height: Math.max(0, band.y2 - band.y1) }),
      svg("text", { class: "chart-band-label", x: width - right, y: band.edge === "top" ? band.y2 - 5 : band.y2 - 4, "text-anchor": "end" }, band.label),
    );
  }
  for (const { value, y } of model.values) {
    nodes.push(
      svg("line", { class: "chart-grid", x1: left, x2: width - right, y1: y, y2: y }),
      svg("text", { class: "chart-value", x: left - 6, y: y + 4, "text-anchor": "end" }, String(value)),
    );
  }
  for (const rung of model.rungs) {
    const isNext = rung.percentile === next?.percentile;
    const value = `P${rung.percentile} · ${m.rungText(rung.score)}`;
    nodes.push(
      svg("line", { class: `chart-rung${isNext ? " next" : ""}`, x1: left, x2: width - right, y1: rung.y, y2: rung.y }),
      // The next rung is named above its line; others sit just below theirs.
      svg("text", { class: `chart-rung-label${isNext ? " next" : ""}`, x: width - right, y: isNext ? rung.y - 5 : rung.y + 12, "text-anchor": "end" }, isNext ? `Next rung · ${value}` : value),
    );
  }
  for (const tick of model.ticks) nodes.push(svg("text", { class: "chart-tick", x: tick.x, y: height - 6, "text-anchor": "middle" }, tick.label));
  const ringed = selected ?? latest;
  const upTo = model.points.findIndex((p) => p.id === ringed.id);
  if (model.points.length > 1) {
    if (selected) nodes.push(svg("line", { class: "chart-guide", x1: selected.x, x2: selected.x, y1: selected.y, y2: height - bottom }));
    const line = (points) => points.map((p) => `${p.x},${p.y}`).join(" ");
    nodes.push(svg("polyline", { class: `chart-line${model.dense ? " dense" : ""}`, points: line(model.points) }));
    // A soft glint that runs along the line to the ringed entry (your latest, or the one selected); decorative,
    // animated by CSS. The first entry has no line before it, so it only gets the wrap below.
    if (upTo > 0) nodes.push(svg("polyline", { class: "chart-pulse", points: line(model.points.slice(0, upTo + 1)), pathLength: 1, "aria-hidden": "true" }));
  }
  for (const point of model.points) nodes.push(...pointMarks(point, point.id === ringed.id, model.dense));
  // As the glint arrives it wraps the ringed entry's ring both ways, over and under, meeting on the far side.
  const end = model.points[upTo];
  if (model.points.length > 1 && end) {
    const ring = { class: "chart-arrive", cx: end.x, cy: end.y, r: 9.5, pathLength: 1, "aria-hidden": "true" };
    nodes.push(svg("circle", { ...ring, transform: `rotate(180 ${end.x} ${end.y})` }), svg("circle", { ...ring, transform: `matrix(-1 0 0 1 ${2 * end.x} 0)` }));
  }
  plot.replaceChildren(...nodes);
  // A PR label that would touch a rung or band label goes below its point instead.
  const labels = [...plot.querySelectorAll(".chart-rung-label, .chart-band-label")].map((t) => t.getBBox());
  const touches = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const pr of plot.querySelectorAll(".chart-pr")) {
    if (labels.some((label) => touches(pr.getBBox(), label))) pr.setAttribute("y", Number(pr.getAttribute("y")) + 32);
  }
}

/** A test's dot: hollow where it first cleared a rung, muted for your other sex category, ringed when selected, smaller when dense; a single lift's PR gets a small "PR" above it. */
function pointMarks(point, selected, dense) {
  const marks = [];
  if (selected) marks.push(svg("circle", { class: "chart-ring", cx: point.x, cy: point.y, r: 9.5 }));
  const kind = point.cleared ? " cleared" : point.otherSex ? " other" : "";
  const r = point.cleared ? 6 : selected || !dense ? 5 : 3;
  marks.push(svg("circle", { class: `chart-dot${kind}`, cx: point.x, cy: point.y, r }));
  if (point.pr) marks.push(svg("text", { class: "chart-pr", x: point.x, y: point.y - 13, "text-anchor": "middle" }, "PR"));
  return marks;
}

/** The tooltip by the selected point (hidden with no selection), and the same words for screen readers (with where its score sat among the rungs). */
function renderTip(list, selected, m, scoreRungs, scored) {
  const tip = $("chart-tip");
  tip.hidden = !selected;
  if (!selected) {
    $("chart-live").textContent = "Tooltip hidden. Tap the chart or use the arrow keys to see a test.";
    return;
  }
  const i = list.findIndex((e) => e.id === selected.id);
  const { test } = list[i];
  const delta = i > 0 ? selected.score - list[i - 1].score : null;
  const extras = [
    selected.otherSex ? `${SEX_WORDS[test.sex]} test` : "",
    selected.sameDay ? `${selected.sameDay} more that day` : "",
  ].filter(Boolean);
  const value = m.text(selected.score);

  const { logged, carried } = dayParts(list[i]);
  const pr = now().prDays().has(test.date) ? " · PR" : "";
  $("tip-title").textContent = `${shortDay(test.date)} · ${L.recordName(Object.fromEntries(logged.map((n) => [n, true])))}${pr}`;
  // Lifts carried from earlier days count towards the score; say so, briefly, and flag any from a bodyweight
  // more than 5 kg away (the score treats them as done at this day's weight).
  const carriedLifts = L.LIFTS.filter((lift) => carried.includes(lift));
  const stale = L.staleLifts(now().tests, test.date, test.bodyweight, logged);
  if (stale.length) extras.unshift(`${stale.map((s) => s.lift).join(" & ")} from ${stale[0].bodyweight} kg`);
  else if (carriedLifts.length && carriedLifts.length < L.LIFTS.length) extras.unshift(`${carriedLifts.join(" & ")} carried`);
  $("tip-score").textContent = `${value} · ${delta == null ? "first test" : m.change(delta)}`;
  $("tip-sub").textContent =
    now().tests.length === 1 ? "Log another to see your progress." : [`${L.sumLifts(test)} kg @ ${test.bodyweight}`, ...extras].join(" · ");
  placeTip(tip, selected);

  $("chart-live").textContent = [
    `${fmtDay(test.date)}${pr ? ", a PR" : ""}: ${now().view.metric === "score" ? `${value} ${m.name}` : `${m.name} ${value}`}`,
    carried.length ? carried.map((name) => `${name} from ${fmtDay(list[i].from[name])}`).join(", ") : "",
    stale.length ? `${capital(L.staleText(stale))}, at ${test.bodyweight} kg now; a retest would make this score accurate` : "",
    delta == null ? "your first test" : `${m.change(delta)} on the test before`,
    `${L.sumLifts(test)} kg at ${test.bodyweight} kg`,
    capital(L.rungPosition(scoreRungs, scored[i].score)),
    ...extras,
  ].filter(Boolean).join(". ");
}

/** Puts the tooltip right of its point when it fits clear of the labels (so the line up to the point stays visible), else left. */
function placeTip(tip, selected) {
  const plot = $("chart").getBoundingClientRect();
  const scale = plot.width / CHART.width;
  tip.style.left = `${(selected.x / CHART.width) * 100}%`;
  tip.style.top = `${(selected.y / CHART.height) * 100}%`;
  tip.style.maxWidth = `${Math.round(plot.width * 0.62)}px`;
  const relative = (r) => ({ left: r.left - plot.left, right: r.right - plot.left, top: r.top - plot.top, bottom: r.bottom - plot.top });
  const labels = [...$("chart").querySelectorAll(".chart-rung-label, .chart-band-label")].map((t) => relative(t.getBoundingClientRect()));
  const bounds = { left: CHART.left * scale, right: plot.width, height: plot.height };
  const point = { x: selected.x * scale, y: selected.y * scale };
  const { side, level, room } = tipSide(point, { width: tip.offsetWidth, height: tip.offsetHeight }, bounds, labels);
  // Fits neither side at full width: narrow it to the room it has, and let the text wrap.
  if (room != null) tip.style.maxWidth = `${Math.max(110, Math.floor(room))}px`;
  tip.dataset.side = side;
  tip.style.setProperty("--tip-x", side === "right" ? `${TIP_GAP}px` : `calc(-100% - ${TIP_GAP}px)`);
  tip.style.setProperty("--tip-y", `${-TIP_LIFT[level] * 100}%`);
}

/** The key: only what this chart shows. */
function renderLegend(model, m) {
  const items = [["dot", "1RM"]];
  if (m.rungs) items.push(["rung", "Rung"]);
  if (model.points.some((p) => p.cleared)) items.push(["cleared", "Rung cleared"]);
  if (model.points.some((p) => p.pr)) items.push(["pr", "Personal record"]); // the key itself reads "PR"
  const other = model.points.find((p) => p.otherSex && !p.cleared);
  if (other) items.push(["other", `${SEX_WORDS[other.test.sex]} test`]);
  $("chart-legend").replaceChildren(
    ...items.map(([kind, text]) => {
      const li = el("li", null, text);
      li.prepend(el("span", `key key-${kind}`, kind === "pr" ? "PR" : null));
      li.firstChild.setAttribute("aria-hidden", "true");
      return li;
    }),
  );
}

/** The four tiles, over the same range as the chart: total and bodyweight with their change, the average per month, and the rungs cleared. */
function renderStats(list, rungs) {
  const { formula } = now().profile;
  const stats = progressStats(list, rungs);
  const one = list.length === 1;
  const tile = (id, value, sub, up = false) => {
    $(id).textContent = value;
    $(`${id}-sub`).textContent = sub;
    $(`${id}-sub`).className = `tile-sub${up ? " up" : ""}`;
  };
  tile("stat-total", `${stats.total.now} kg`, one ? "First test" : kgChange(stats.total.change), !one && stats.total.change > 0);
  tile("stat-bw", `${stats.bodyweight.now} kg`, one ? "First test" : kgChange(stats.bodyweight.change));
  tile(
    "stat-month",
    stats.perMonth == null ? "—" : signed(formula, stats.perMonth),
    stats.perMonth == null ? "Needs 4 weeks of tests" : S.FORMULAS[formula].label,
    stats.perMonth > 0,
  );
  const top = stats.cleared.at(-1);
  const next = L.nextRung(rungs, list.at(-1).score);
  // A rung you cleared and have since fallen back below still counts, but says so.
  const dropped = top && list.at(-1).score < top.score ? " · since dropped" : "";
  tile("stat-rungs", String(stats.cleared.length), top ? `P${top.percentile} · ${shortDay(top.date)}${dropped}` : next ? `Next: P${next.percentile}` : "Top rung reached");
  $("stat-tiles").setAttribute("aria-label", now().view.range === "all" ? "Since your first test" : "Over the last 3 months");
}

function setupChartTouch() {
  const select = (id) => {
    selectedId = id;
    tipShown = true;
    renderChart();
  };
  // One touch area over the plot: a tap picks the day nearest it, since dots can sit closer than 44px.
  $("chart-hit").addEventListener("click", (event) => {
    const box = $("chart").getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * CHART.width;
    // Points sit by date, whatever is plotted, so the days in view are enough to find the nearest.
    const { points } = chartModel(now().chartDays, []);
    const nearest = nearestPoint(points, x);
    // Tapping the test that's already showing hides its tooltip (it can cover a neighbouring test).
    const showing = tipShown && nearest.id === (points.find((p) => p.id === selectedId) ?? points.at(-1)).id;
    if (showing) {
      tipShown = false;
      renderChart();
    } else select(nearest.id);
  });
  $("chart-hit").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const list = now().chartDays;
    const i = Math.max(0, list.findIndex((e) => e.id === selectedId));
    const at = selectedId == null ? list.length - 1 : i;
    const next = Math.min(list.length - 1, Math.max(0, at + (event.key === "ArrowRight" ? 1 : -1)));
    select(list[next].id);
  });
}

// --- Your numbers ---------------------------------------------------------------------------

const VALUE_NAMES = { bodyweight: "Bodyweight", ...LIFT_NAMES };

/** Each value behind your score: tested in your latest record or carried from an earlier one, how long ago, and PRs. */
function renderNumbers() {
  const { rows, stale } = now().yourNumbers;
  const latest = rows.find((row) => row.tested).date;
  $("numbers-for").textContent = `Behind your score · ${shortDay(latest)}`;
  $("numbers-list").replaceChildren(
    ...rows.map((row) => {
      const li = el("li");
      const name = el("span", "numbers-name", VALUE_NAMES[row.name]);
      if (row.pr) name.append(" ", el("span", "pr-badge", "PR"));
      const verb = row.name === "bodyweight" ? "Weighed" : "Tested";
      const when = row.tested ? `${verb} ${shortDay(row.date)}` : `Carried from ${shortDay(row.date)}`;
      const isStale = stale.some((s) => s.lift === row.name);
      const kg = el("span", "numbers-kg", `${row.kg} kg`);
      if (row.best != null && row.kg < row.best) kg.append(el("span", "numbers-best", `best ${row.best} kg`));
      li.append(name, kg, el("span", `numbers-when${isStale ? " stale" : ""}`, `${when} · ${L.agoText(row.days)}`));
      return li;
    }),
  );
  // A fact, not training advice: which lifts are overdue a test.
  $("numbers-note").textContent = stale.map((s) => `${LIFT_NAMES[s.lift]} last tested ${s.weeks} weeks ago.`).join(" ");
}

// --- Weight-class lever -------------------------------------------------------------

const LEVER = { width: 320, height: 132, left: 8, right: 8, top: 22, bottom: 22 }; // the curve's viewBox and margins

function renderLever() {
  const { profile, lever: result, experience } = now();
  const { formula } = profile;
  const label = S.FORMULAS[formula].label;
  const total = L.sumLifts(profile);
  const { target } = result;
  $("lever-eyebrow").textContent = `${total} kg total · now ${profile.bodyweight} kg`;
  // Saved through the store; its subscriber redraws the lever. One choice (the class below the open class) needs no picker.
  $("lever-classes").hidden = result.classes.length < 2;
  choiceGroup($("lever-classes"), "view-option", result.classes.map((c) => [c.kg, c.now ? `${c.label} · now` : c.label]), target.kg, (kg) =>
    store.update((s) => ({ settings: { ...s.settings, targetBw: kg } })),
  );

  $("lever-same-label").textContent = `Same ${total} kg at ${target.kg} kg`;
  $("lever-same").textContent = `${S.formatScore(formula, result.then)} ${label}`;
  const same = Math.abs(result.delta) < 0.05;
  $("lever-same-sub").textContent = same ? "Your bodyweight now" : `${signed(formula, result.delta)} from bodyweight alone`;
  $("lever-same-sub").className = `tile-sub${result.delta >= 0.05 ? " up" : ""}`;

  $("lever-even-label").textContent = `Break-even total at ${target.kg} kg`;
  $("lever-even").textContent = `${result.breakEven} kg`;
  $("lever-even-sub").textContent =
    result.room < 0 ? `${-result.room} kg of room to lose` : result.room > 0 ? `+${result.room} kg needed to stay level` : "Your total holds it";

  // Cutting a class also changes who you're compared with: that class's rungs, for the Ladder's experience group.
  const position = $("lever-position");
  position.hidden = !result.position;
  position.textContent = `Against ${profile.sex === "M" ? "men" : "women"} ${target.label} kg, ${experience}: ${result.position}.`;

  $("lever-curve-label").textContent = `${label} for ${total} kg at each bodyweight`;
  drawLeverCurve(result, profile, (n) => S.formatScore(formula, n), label);
}

/** Your total's score across bodyweights: the curve, a dashed line and dot at you and at the chosen class, and kg labels. */
function drawLeverCurve(result, profile, fmt, label) {
  const { width, height, left, right, top, bottom } = LEVER;
  const { curve, target } = result;
  const [first, last] = [curve[0], curve.at(-1)];
  const scores = curve.map((p) => p.score);
  const [lo, hi] = [Math.min(...scores), Math.max(...scores)];
  const x = (bw) => left + ((bw - first.bw) / (last.bw - first.bw)) * (width - left - right);
  const y = (s) => top + (hi === lo ? 0.5 : (hi - s) / (hi - lo)) * (height - top - bottom);
  const plot = $("lever-chart");
  plot.setAttribute("viewBox", `0 0 ${width} ${height}`);
  plot.setAttribute(
    "aria-label",
    `${label} for a ${L.sumLifts(profile)} kg total goes from ${fmt(first.score)} at ${first.bw} kg to ${fmt(last.score)} at ${last.bw} kg. ` +
      `${target.kg} kg gives ${fmt(result.then)}; your ${profile.bodyweight} kg gives ${fmt(result.now)}.`,
  );

  const you = { x: x(profile.bodyweight), y: y(result.now) };
  const goal = { x: x(target.kg), y: y(result.then) };
  // The curve falls to the right, so the chosen class's label goes above and to the right of its dot (left near the
  // edge) and yours is centred under your dot (over it when it's low), both clear of the line and the kg labels.
  const goalRight = goal.x < width - 90;
  const youX = Math.min(Math.max(you.x, left + 34), width - right - 34);
  const youY = you.y + 22 > height - bottom ? you.y - 12 : you.y + 20;
  const axis = height - 6;
  const ticks = [first.bw, last.bw].filter((bw) => Math.abs(x(bw) - goal.x) > 28);
  plot.replaceChildren(
    svg("line", { class: "lever-mark you", x1: you.x, x2: you.x, y1: top - 14, y2: height - bottom }),
    svg("line", { class: "lever-mark goal", x1: goal.x, x2: goal.x, y1: top - 14, y2: height - bottom }),
    svg("polyline", { class: "lever-line", points: curve.map((p) => `${x(p.bw)},${y(p.score)}`).join(" ") }),
    svg("circle", { class: "lever-dot you", cx: you.x, cy: you.y, r: 4.5 }),
    svg("circle", { class: "lever-dot goal", cx: goal.x, cy: goal.y, r: 5.5 }),
    svg("text", { class: "lever-label goal", x: goal.x + (goalRight ? 8 : -8), y: goal.y - 8, "text-anchor": goalRight ? "start" : "end" }, `${target.kg} · ${fmt(result.then)}`),
    svg("text", { class: "lever-label", x: youX, y: youY, "text-anchor": "middle" }, `you · ${fmt(result.now)}`),
    ...ticks.map((bw) => svg("text", { class: "chart-tick", x: x(bw), y: axis, "text-anchor": bw === first.bw ? "start" : "end" }, `${bw} kg`)),
    svg("text", { class: "chart-tick goal", x: goal.x, y: axis, "text-anchor": "middle" }, `${target.kg}`),
  );
}

// --- Wiring -------------------------------------------------------------------------

export function setupProgress() {
  setupChartTouch();
}

/** The same DOTS / GL toggle as the Ladder's: switching redraws this screen and saves the choice for every screen. */
function renderFormula() {
  formulaChoice($("progress-formula"), now().profile.formula, (id) => store.update((s) => ({ settings: { ...s.settings, formula: id } })));
}

/** Draws the whole screen; called each time it opens. */
export function openProgress() {
  refreshProgress();
}

/** After a change (from the store's subscriber): redraws the screen. */
export function refreshProgress() {
  if (!now().profile) return;
  renderFormula();
  renderChart();
  renderLever();
  renderNumbers();
  renderYourData();
}
