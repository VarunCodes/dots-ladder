// "Progress" screen: the chart of your tests, the weight-class lever, the lift split and the editable list of
// tests. Logic lives in ladder.js and chart.js; this file only renders.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import { CHART, chartModel, nearestPoint } from "./chart.js";
import { $, el } from "./dom.js";
import { fmtDay } from "./events.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const LIFT_NAMES = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const SEX_WORDS = { M: "Men's", F: "Women's" };

let ctx; // { rungsData, state, storage, onChange }
let selectedId = null; // the test shown in the chart's detail row; null means the latest

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

/** Every test, oldest first, scored in its own sex and the chosen formula. */
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

// --- The chart ---------------------------------------------------------------------

function renderChart() {
  const { formula } = ctx.state.profile;
  const label = S.FORMULAS[formula].label;
  const list = entries();
  const rungs = groupRungs();
  const model = chartModel(list, rungs);
  const latest = list.at(-1);
  if (!list.some((e) => e.id === selectedId)) selectedId = null;
  const selected = list.find((e) => e.id === selectedId) ?? latest;

  $("chart-now").textContent = S.formatScore(formula, latest.score);
  $("chart-unit").textContent = `${label} now`;
  const change = latest.score - list[0].score;
  $("chart-change").textContent = list.length === 1 ? "Starting point" : `${signed(formula, change)} since ${shortDay(list[0].date)}`;
  $("chart-change").className = list.length > 1 && change > 0 ? "up" : "";

  const { width, height } = CHART;
  const plot = $("chart");
  plot.setAttribute("viewBox", `0 0 ${width} ${height}`);
  plot.setAttribute(
    "aria-label",
    list.length === 1
      ? `${label} over time: one test, ${S.formatScore(formula, latest.score)} on ${fmtDay(latest.date)}.`
      : `${label} over time: ${S.formatScore(formula, list[0].score)} on ${fmtDay(list[0].date)} to ${S.formatScore(formula, latest.score)} on ${fmtDay(latest.date)}, across ${list.length} tests.`,
  );
  const next = L.nextRung(rungs, latest.score);
  const nodes = [];
  for (const rung of model.rungs) {
    const isNext = rung.percentile === next?.percentile ? " next" : "";
    nodes.push(
      svg("line", { class: `chart-rung${isNext}`, x1: CHART.left, x2: width - CHART.right + 2, y1: rung.y, y2: rung.y }),
      svg("text", { class: `chart-rung-label${isNext}`, x: width - CHART.right + 8, y: rung.y + 4 }, `P${rung.percentile}`),
    );
  }
  for (const tick of model.ticks) nodes.push(svg("text", { class: "chart-tick", x: tick.x, y: height - 6, "text-anchor": "middle" }, tick.label));
  if (model.points.length > 1) {
    nodes.push(svg("polyline", { class: `chart-line${model.dense ? " dense" : ""}`, points: model.points.map((p) => `${p.x},${p.y}`).join(" ") }));
  }
  for (const point of model.points) {
    const ringed = point.id === selected.id;
    const r = ringed || !model.dense ? 5 : 3;
    if (ringed) nodes.push(svg("circle", { class: "chart-ring", cx: point.x, cy: point.y, r: 9.5 }));
    nodes.push(svg("circle", { class: `chart-dot${point.otherSex ? " other" : ""}`, cx: point.x, cy: point.y, r }));
  }
  plot.replaceChildren(...nodes);
  $("chart-hit").hidden = list.length < 2;
  renderDetail(list, selected, rungs);
}

/** The row under the chart: the selected test (the latest by default), its change from the one before, and where it sat. */
function renderDetail(list, selected, rungs) {
  const { formula } = ctx.state.profile;
  const i = list.indexOf(selected);
  const { test } = selected;
  const prefix = selected === list.at(-1) ? "Latest · " : "";
  $("chart-selected").textContent = `${prefix}${shortDay(test.date)} · ${L.sumLifts(test)} kg @ ${test.bodyweight}`;
  const delta = i > 0 ? selected.score - list[i - 1].score : null;
  $("chart-delta").textContent = delta == null ? "First entry" : `${signed(formula, delta)} vs previous`;
  $("chart-delta").className = delta > 0 ? "up" : "";
  $("chart-note").textContent =
    list.length === 1
      ? "One test so far. Log another to see your progress."
      : [selected.otherSex ? `${SEX_WORDS[test.sex]} test` : "", capital(L.rungPosition(rungs, selected.score))].filter(Boolean).join(" · ");
}

function setupChartTouch() {
  const select = (id) => {
    selectedId = id;
    renderChart();
  };
  // One touch area over the plot: a tap picks the test nearest it by date, since dots can sit closer than 44px.
  $("chart-hit").addEventListener("click", (event) => {
    const box = $("chart").getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * CHART.width;
    select(nearestPoint(chartModel(entries(), groupRungs()).points, x).id);
  });
  $("chart-hit").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const list = entries();
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

// --- Tests: newest first, each editable ---------------------------------------------------

const TEST_TEXT = {
  date: "Pick the day of the test (not a future one).",
  sex: "Choose men or women.",
  bodyweight: `Bodyweight must be ${L.LIMITS.bodyweight.join("–")} kg.`,
  ...Object.fromEntries(L.LIFTS.map((lift) => [lift, `${LIFT_NAMES[lift]} must be ${L.LIMITS.lift.join("–")} kg.`])),
};

function numberField(name, label, [min, max]) {
  const input = Object.assign(el("input"), { name, type: "number", inputMode: "decimal", step: "any", min, max, required: true });
  const wrap = el("label", null, label);
  wrap.append(input);
  return wrap;
}

function testItem(test) {
  const item = el("details", "event test");
  item.dataset.id = test.id;
  const summary = el("summary");
  const head = el("span", "test-head");
  head.append(el("span", "event-title"), el("span", "test-sub muted small"));
  summary.append(head, el("span", "event-score"));

  const form = el("form", "fields");
  form.autocomplete = "off";
  const date = Object.assign(el("input"), { name: "date", type: "date", required: true, max: ctx.state.today, min: L.EARLIEST_DATE });
  const dateLabel = el("label", null, "Date");
  dateLabel.append(date);
  const sex = el("select");
  sex.name = "sex";
  sex.append(new Option("Men", "M"), new Option("Women", "F"));
  const sexLabel = el("label", null, "Sex");
  sexLabel.append(sex);
  const trio = el("div", "trio wide");
  trio.append(...L.LIFTS.map((lift) => numberField(lift, LIFT_NAMES[lift], L.LIMITS.lift)));
  const bodyweight = numberField("bodyweight", "Bodyweight (kg)", L.LIMITS.bodyweight);
  bodyweight.classList.add("wide");
  const note = el("p", "event-note muted small wide");
  note.setAttribute("role", "status");
  const remove = el("button", "link-button wide", "Delete test");
  remove.type = "button";
  remove.addEventListener("click", () => deleteTest(test.id));
  form.append(dateLabel, sexLabel, bodyweight, trio, note, remove);

  item.append(summary, form);
  fillTest(form, test);
  form.addEventListener("input", () => onTestInput(item, form));
  // Closing a test with invalid values undoes them, and puts the list back in date order.
  item.addEventListener("toggle", () => {
    if (item.open) return;
    if (item.dataset.invalid) {
      fillTest(form, ctx.state.tests.find((t) => t.id === test.id));
      form.querySelector(".event-note").textContent = "Invalid changes were undone.";
    }
    renderTests();
  });
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

/** Saves the tests, and the profile's latest numbers from them; returns whether both were saved. */
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

/** Rebuilds the list newest first, keeping open whichever test was open. */
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

/** Draws the whole screen; called each time it opens, and after a test is deleted. */
export function openProgress() {
  renderChart();
  renderLever();
  renderSplit();
  renderTests();
}
