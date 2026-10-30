// "Progress" screen. A test here is a powerlifting 1RM test: your one-rep max on squat, bench and deadlift
// on a given day, at a given bodyweight. The screen shows the chart of your scores at those tests, the
// weight-class lever, the lift split and the editable list of tests. Logic lives in ladder.js and chart.js;
// this file only renders.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import { CHART, chartModel, nearestPoint, onePerDay, progressStats, tipPlacement } from "./chart.js";
import { $, el, formulaButtons } from "./dom.js";
import { fmtDay } from "./events.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const LIFT_NAMES = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const SEX_WORDS = { M: "Men's", F: "Women's" };

let ctx; // { rungsData, state, storage, onChange }
let selectedId = null; // the 1RM test shown in the chart's detail row; null means the latest

const capital = (text) => text && text[0].toUpperCase() + text.slice(1);
const signed = (formula, n) => `${n >= 0 ? "+" : "−"}${S.formatScore(formula, Math.abs(n))}`;
// "26 Oct", with the year when it isn't this year's.
const shortDay = (day) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(day.slice(0, 4) === ctx.state.today.slice(0, 4) ? {} : { year: "numeric" }),
  });

function svg(tag, attrs, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  if (text != null) node.textContent = text;
  return node;
}

/** The rungs for the group the Ladder is showing, in the chosen formula, so the chart and the Ladder agree. */
function groupRungs() {
  const { profile, experience } = ctx.state;
  return L.rungsFor(ctx.rungsData, profile.formula, profile.sex, L.effectiveClass(profile), experience)?.rungs ?? [];
}

/** Every 1RM test, oldest first, scored in its own sex and the chosen formula. */
function entries() {
  const { profile, tests } = ctx.state;
  return tests.map((test) => ({
    id: test.id,
    date: test.date,
    test,
    score: L.profileScore(L.withLatestTest(profile, [test])),
    otherSex: test.sex !== profile.sex,
  }));
}

// --- The chart: one point per day of 1RM testing ---------------------------------------

/** The chart's points: each day's last-saved test (several tests on one day would otherwise sit on top of each other). */
const days = () => onePerDay(entries());

function renderChart() {
  const list = days();
  const rungs = groupRungs();
  const model = chartModel(list, rungs);
  if (!list.some((e) => e.id === selectedId)) selectedId = null;
  const selected = model.points.find((p) => p.id === selectedId) ?? model.points.at(-1);

  renderHeader(list, model);
  drawPlot(model, selected, L.nextRung(rungs, list.at(-1).score));
  renderTip(list, model, selected, rungs);
  renderLegend(model);
  renderStats(list, rungs);
  $("chart-hit").hidden = list.length < 2;
}

/** Score now, the change since the first day ("Starting point" with one), and a rung too high to draw. */
function renderHeader(list, model) {
  const { formula } = ctx.state.profile;
  const latest = list.at(-1);
  $("chart-now").textContent = S.formatScore(formula, latest.score);
  $("chart-unit").textContent = `${S.FORMULAS[formula].label} now`;
  const change = latest.score - list[0].score;
  $("chart-change").textContent = list.length === 1 ? "Starting point" : `${signed(formula, change)} since ${shortDay(list[0].date)}`;
  $("chart-change").className = list.length > 1 && change > 0 ? "up" : "";
  const off = model.offChart;
  $("chart-offchart").hidden = !off;
  if (off) $("chart-offchart").textContent = `P${off.percentile} · ${S.formatRung(formula, off.score)} ↑ off chart`;
}

/** The SVG: value gridlines and labels, rung lines with their values, month labels, the line, and the points. */
function drawPlot(model, selected, next) {
  const { formula } = ctx.state.profile;
  const label = S.FORMULAS[formula].label;
  const { width, height, left, right, bottom } = CHART;
  const [first, latest] = [model.points[0], model.points.at(-1)];
  const plot = $("chart");
  plot.setAttribute("viewBox", `0 0 ${width} ${height}`);
  plot.setAttribute(
    "aria-label",
    model.points.length === 1
      ? `${label} over time: one test, ${S.formatScore(formula, latest.score)} on ${fmtDay(latest.date)}.`
      : `${label} over time: ${S.formatScore(formula, first.score)} on ${fmtDay(first.date)} to ${S.formatScore(formula, latest.score)} on ${fmtDay(latest.date)}, across ${model.points.length} days of tests.`,
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
    const value = `P${rung.percentile} · ${S.formatRung(formula, rung.score)}`;
    nodes.push(
      svg("line", { class: `chart-rung${isNext ? " next" : ""}`, x1: left, x2: width - right, y1: rung.y, y2: rung.y }),
      // The next rung is named above its line; others sit just below theirs.
      svg("text", { class: `chart-rung-label${isNext ? " next" : ""}`, x: width - right, y: isNext ? rung.y - 5 : rung.y + 12, "text-anchor": "end" }, isNext ? `Next rung · ${value}` : value),
    );
  }
  for (const tick of model.ticks) nodes.push(svg("text", { class: "chart-tick", x: tick.x, y: height - 6, "text-anchor": "middle" }, tick.label));
  if (model.points.length > 1) {
    nodes.push(svg("line", { class: "chart-guide", x1: selected.x, x2: selected.x, y1: selected.y, y2: height - bottom }));
    nodes.push(svg("polyline", { class: `chart-line${model.dense ? " dense" : ""}`, points: model.points.map((p) => `${p.x},${p.y}`).join(" ") }));
  }
  for (const point of model.points) nodes.push(...pointMarks(point, point.id === selected.id, model.dense));
  plot.replaceChildren(...nodes);
}

/** A test's dot: hollow where it first cleared a rung, muted for your other sex category, ringed when selected, smaller when dense. */
function pointMarks(point, selected, dense) {
  const marks = [];
  if (selected) marks.push(svg("circle", { class: "chart-ring", cx: point.x, cy: point.y, r: 9.5 }));
  const kind = point.cleared ? " cleared" : point.otherSex ? " other" : "";
  const r = point.cleared ? 6 : selected || !dense ? 5 : 3;
  marks.push(svg("circle", { class: `chart-dot${kind}`, cx: point.x, cy: point.y, r }));
  return marks;
}

/** The tooltip by the selected point, and the same words for screen readers. */
function renderTip(list, model, selected, rungs) {
  const { formula } = ctx.state.profile;
  const i = list.findIndex((e) => e.id === selected.id);
  const { test } = list[i];
  const delta = i > 0 ? selected.score - list[i - 1].score : null;
  const extras = [
    selected.otherSex ? `${SEX_WORDS[test.sex]} test` : "",
    selected.sameDay ? `${selected.sameDay} more that day` : "",
  ].filter(Boolean);
  const score = S.formatScore(formula, selected.score);

  $("tip-title").textContent = `${shortDay(test.date)} · 1RM test`;
  $("tip-score").textContent = `${score} · ${delta == null ? "first test" : signed(formula, delta)}`;
  $("tip-sub").textContent =
    ctx.state.tests.length === 1 ? "Log another to see your progress." : [`${L.sumLifts(test)} kg @ ${test.bodyweight}`, ...extras].join(" · ");
  const { side, level, room } = tipPlacement(selected);
  const tip = $("chart-tip");
  tip.dataset.side = side;
  tip.dataset.level = level;
  tip.style.left = `${(selected.x / CHART.width) * 100}%`;
  // As wide as the room on its side of the point allows (it wraps beyond that), with a floor for very narrow charts.
  tip.style.maxWidth = `${Math.max(120, room * $("chart").getBoundingClientRect().width - 20)}px`;
  tip.style.top = `${(selected.y / CHART.height) * 100}%`;

  $("chart-live").textContent = [
    `${fmtDay(test.date)}: ${score} ${S.FORMULAS[formula].label}`,
    delta == null ? "your first test" : `${signed(formula, delta)} on the test before`,
    `${L.sumLifts(test)} kg at ${test.bodyweight} kg`,
    capital(L.rungPosition(rungs, selected.score)),
    ...extras,
  ].filter(Boolean).join(". ");
}

/** The key: only what this chart shows. */
function renderLegend(model) {
  const items = [["dot", "1RM test"], ["rung", "Rung"]];
  if (model.points.some((p) => p.cleared)) items.push(["cleared", "Rung cleared"]);
  const other = model.points.find((p) => p.otherSex && !p.cleared);
  if (other) items.push(["other", `${SEX_WORDS[other.test.sex]} test`]);
  $("chart-legend").replaceChildren(
    ...items.map(([kind, text]) => {
      const li = el("li", null, text);
      li.prepend(el("span", `key key-${kind}`));
      li.firstChild.setAttribute("aria-hidden", "true");
      return li;
    }),
  );
}

/** The four tiles: total and bodyweight with their change, the average per month, and the rungs cleared. */
function renderStats(list, rungs) {
  const { formula } = ctx.state.profile;
  const stats = progressStats(list, rungs);
  const one = list.length === 1;
  const kg = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n * 10) / 10)} kg`;
  const tile = (id, value, sub, up = false) => {
    $(id).textContent = value;
    $(`${id}-sub`).textContent = sub;
    $(`${id}-sub`).className = `tile-sub${up ? " up" : ""}`;
  };
  tile("stat-total", `${stats.total.now} kg`, one ? "First test" : kg(stats.total.change), !one && stats.total.change > 0);
  tile("stat-bw", `${stats.bodyweight.now} kg`, one ? "First test" : kg(stats.bodyweight.change));
  tile(
    "stat-month",
    stats.perMonth == null ? "—" : signed(formula, stats.perMonth),
    stats.perMonth == null ? "Needs 4 weeks of tests" : S.FORMULAS[formula].label,
    stats.perMonth > 0,
  );
  const top = stats.cleared.at(-1);
  const next = L.nextRung(rungs, list.at(-1).score);
  tile("stat-rungs", String(stats.cleared.length), top ? `P${top.percentile} · ${shortDay(top.date)}` : next ? `Next: P${next.percentile}` : "Top rung reached");
}

function setupChartTouch() {
  const select = (id) => {
    selectedId = id;
    renderChart();
  };
  // One touch area over the plot: a tap picks the day nearest it, since dots can sit closer than 44px.
  $("chart-hit").addEventListener("click", (event) => {
    const box = $("chart").getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * CHART.width;
    select(nearestPoint(chartModel(days(), groupRungs()).points, x).id);
  });
  $("chart-hit").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const list = days();
    const i = Math.max(0, list.findIndex((e) => e.id === selectedId));
    const at = selectedId == null ? list.length - 1 : i;
    const next = Math.min(list.length - 1, Math.max(0, at + (event.key === "ArrowRight" ? 1 : -1)));
    select(list[next].id);
  });
}

// --- Weight-class lever and lift split -------------------------------------------------

function renderLever() {
  const { profile } = ctx.state;
  const { formula } = profile;
  const result = L.lever(profile, groupRungs());
  const input = $("target-bw");
  if (document.activeElement !== input) input.value = result.targetBw;
  const strong = el("strong", "lever-score", `${S.formatScore(formula, result.then)} ${S.FORMULAS[formula].label}`);
  $("lever-text").replaceChildren(`Same ${L.sumLifts(profile)} kg total at ${result.targetBw} kg = `, strong);
  $("lever-caption").textContent =
    result.targetBw === profile.bodyweight
      ? "That's your bodyweight now. Pick a lighter target to see what a cut is worth."
      : `${signed(formula, result.delta)} from bodyweight alone${result.cleared ? `, enough to clear P${result.cleared.percentile}` : ""}.`;
}

function renderSplit() {
  const { profile } = ctx.state;
  const best = Math.max(...L.LIFTS.map((lift) => profile[lift]));
  $("lift-split").replaceChildren(
    ...L.LIFTS.map((lift) => {
      const li = el("li", "split-row");
      const icon = document.createElementNS(SVG_NS, "svg");
      icon.setAttribute("class", "split-icon");
      icon.setAttribute("aria-hidden", "true");
      icon.append(svg("use", { href: `#icon-${lift}` }));
      const track = el("span", "split-track");
      const fill = el("span", "split-fill");
      fill.style.width = `${(profile[lift] / best) * 100}%`;
      track.append(fill);
      li.append(icon, el("span", "split-name", LIFT_NAMES[lift]), track, el("span", "split-kg", `${profile[lift]} kg`));
      return li;
    }),
  );
}

function setupLever() {
  $("target-bw").addEventListener("input", () => {
    const input = $("target-bw");
    const value = input.valueAsNumber;
    // An empty field goes back to the default target; anything else must be a real bodyweight.
    const ok = input.value === "" || (value >= L.LIMITS.bodyweight[0] && value <= L.LIMITS.bodyweight[1]);
    input.setCustomValidity(ok ? "" : "invalid");
    $("lever-note").textContent = ok ? "" : `Target bodyweight must be ${L.LIMITS.bodyweight.join("–")} kg.`;
    if (!ok) return;
    ctx.state.profile = { ...ctx.state.profile, targetBw: input.value === "" ? null : value };
    L.saveProfile(ctx.storage, ctx.state.profile);
    renderLever();
  });
}

// --- 1RM tests: newest first, each editable -------------------------------------------------
// Each row is one saved 1RM test (squat, bench and deadlift maxes on one day). Opening it shows its fields;
// valid changes save straight away, and closing it with invalid values undoes them.

const TEST_TEXT = {
  date: "Pick the day of the test (not a future one).",
  sex: "Choose men or women.",
  bodyweight: `Bodyweight must be ${L.LIMITS.bodyweight.join("–")} kg.`,
  ...Object.fromEntries(L.LIFTS.map((lift) => [lift, `${LIFT_NAMES[lift]} must be ${L.LIMITS.lift.join("–")} kg.`])),
};

/** A form control inside its label. */
function labelled(text, control, className) {
  const label = el("label", className, text);
  label.append(control);
  return label;
}

function numberInput(name, [min, max]) {
  return Object.assign(el("input"), { name, type: "number", inputMode: "decimal", step: "any", min, max, required: true });
}

/** The closed row: the test's date, "{total} kg @ {bw} kg" and its score, filled in by refreshTestSummaries. */
function testSummary() {
  const summary = el("summary");
  const head = el("span", "test-head");
  head.append(el("span", "event-title"), el("span", "test-sub muted small"));
  summary.append(head, el("span", "event-score"));
  return summary;
}

/** The open row: date, sex, bodyweight and the three 1RMs, a status line, and "Delete test". */
function testForm(id) {
  const form = el("form", "fields");
  form.autocomplete = "off";
  const date = Object.assign(el("input"), { name: "date", type: "date", required: true, max: ctx.state.today, min: L.EARLIEST_DATE });
  const sex = el("select");
  sex.name = "sex";
  sex.append(new Option("Men", "M"), new Option("Women", "F"));
  const lifts = el("div", "trio wide");
  lifts.append(...L.LIFTS.map((lift) => labelled(LIFT_NAMES[lift], numberInput(lift, L.LIMITS.lift))));
  const note = el("p", "event-note muted small wide");
  note.setAttribute("role", "status");
  const remove = el("button", "link-button wide", "Delete test");
  remove.type = "button";
  remove.addEventListener("click", () => deleteTest(id));
  form.append(
    labelled("Date", date),
    labelled("Sex", sex),
    labelled("Bodyweight (kg)", numberInput("bodyweight", L.LIMITS.bodyweight), "wide"),
    lifts,
    note,
    remove,
  );
  return form;
}

/** Closing a test with invalid values undoes them; either way the list goes back into date order. */
function onTestClosed(item, form) {
  if (item.open) return;
  if (item.dataset.invalid) {
    fillTest(form, ctx.state.tests.find((t) => t.id === item.dataset.id));
    form.querySelector(".event-note").textContent = "Invalid changes were undone.";
  }
  renderTests();
}

/** One row of the list: a summary that opens into the test's form. */
function testItem(test) {
  const item = el("details", "event test");
  item.dataset.id = test.id;
  const form = testForm(test.id);
  item.append(testSummary(), form);
  fillTest(form, test);
  form.addEventListener("input", () => onTestInput(item, form));
  item.addEventListener("toggle", () => onTestClosed(item, form));
  return item;
}

function fillTest(form, test) {
  const f = form.elements;
  for (const name of ["date", "sex", "bodyweight", ...L.LIFTS]) f[name].value = test[name];
  for (const input of form.querySelectorAll("input, select")) input.setCustomValidity("");
  form.closest("details").dataset.invalid = "";
}

function readTest(form, id) {
  const f = form.elements;
  return {
    id,
    date: f.date.value,
    sex: f.sex.value,
    ...Object.fromEntries(["bodyweight", ...L.LIFTS].map((name) => [name, f[name].valueAsNumber])),
  };
}

/** Saves the 1RM tests, and the profile's latest numbers from them; returns whether both were saved. */
function persistTests(tests) {
  ctx.state.tests = L.sortTests(tests);
  ctx.state.profile = L.withLatestTest(ctx.state.profile, ctx.state.tests);
  const ok = L.saveTests(ctx.storage, ctx.state.tests) && L.saveProfile(ctx.storage, ctx.state.profile);
  $("tests-note").textContent = ok ? "" : "Couldn't save on this device; changes last until you close the page.";
  return ok;
}

function onTestInput(item, form) {
  const raw = readTest(form, item.dataset.id);
  const problems = L.testProblems(raw, ctx.state.today);
  for (const input of form.querySelectorAll("input, select")) input.setCustomValidity(problems.includes(input.name) ? TEST_TEXT[input.name] : "");
  item.dataset.invalid = problems.length ? "true" : "";
  const note = form.querySelector(".event-note");
  if (problems.length) {
    note.textContent = `Not saved: ${problems.map((name) => TEST_TEXT[name]).join(" ")}`;
    return;
  }
  persistTests(ctx.state.tests.map((t) => (t.id === raw.id ? L.validTest(raw) : t)));
  note.textContent = "Saved on this device only.";
  refreshTestSummaries();
  renderChart();
  renderLever();
  renderSplit();
  ctx.onChange();
}

function deleteTest(id) {
  if (ctx.state.tests.length < 2) return;
  const test = ctx.state.tests.find((t) => t.id === id);
  if (!window.confirm(`Delete the test from ${fmtDay(test.date)}?`)) return;
  persistTests(ctx.state.tests.filter((t) => t.id !== id));
  openProgress();
  ctx.onChange();
}

/** Each test's date, total @ bodyweight and score, without touching its fields. */
function refreshTestSummaries() {
  const { formula } = ctx.state.profile;
  const only = ctx.state.tests.length < 2;
  for (const { id, test, score, otherSex } of entries()) {
    const item = $("test-list").querySelector(`[data-id="${id}"]`);
    if (!item) continue;
    item.querySelector(".event-title").textContent = fmtDay(test.date);
    item.querySelector(".test-sub").textContent = [`${L.sumLifts(test)} kg @ ${test.bodyweight} kg`, otherSex ? SEX_WORDS[test.sex] : ""].filter(Boolean).join(" · ");
    item.querySelector(".event-score").textContent = item.dataset.invalid ? "not saved" : S.formatScore(formula, score);
    const remove = item.querySelector(".link-button");
    remove.disabled = only;
    remove.title = only ? "Your only test. To start over, use “Clear my numbers” on Log test." : "";
  }
}

/** Rebuilds the list of 1RM tests newest first, keeping open whichever test was open. */
function renderTests() {
  const open = $("test-list").querySelector("details[open]")?.dataset.id;
  const items = [...ctx.state.tests].reverse().map((test) => {
    const item = testItem(test);
    item.open = test.id === open;
    return item;
  });
  $("test-list").replaceChildren(...items);
  refreshTestSummaries();
}

// --- Wiring -------------------------------------------------------------------------

export function setupProgress(context) {
  ctx = context;
  setupChartTouch();
  setupLever();
}

/** The same DOTS / GL toggle as the Ladder's: switching redraws this screen and saves the choice for every screen. */
function renderFormula() {
  $("progress-formula").replaceChildren(
    ...formulaButtons(ctx.state.profile.formula, (id) => {
      ctx.state.profile = { ...ctx.state.profile, formula: id };
      L.saveProfile(ctx.storage, ctx.state.profile);
      openProgress();
      ctx.onChange();
    }),
  );
}

/** Draws the whole screen; called each time it opens, after a test is deleted, and when the formula changes. */
export function openProgress() {
  renderFormula();
  renderChart();
  renderLever();
  renderSplit();
  renderTests();
}
