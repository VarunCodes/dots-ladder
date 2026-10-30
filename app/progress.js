// "Progress" screen. A test here is a powerlifting 1RM test: your one-rep max on squat, bench and deadlift
// on a given day, at a given bodyweight. The screen shows the chart of your scores at those tests, the
// weight-class lever, the lift split and the editable list of tests. Logic lives in ladder.js and chart.js;
// this file only renders.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import { CHART, TIP_GAP, TIP_LIFT, chartModel, inRange, liftDays, nearestPoint, onePerDay, progressStats, tipSide } from "./chart.js";
import { $, el, formulaButtons } from "./dom.js";
import { fmtDay } from "./events.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const LIFT_NAMES = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const SEX_WORDS = { M: "Men's", F: "Women's" };

let ctx; // { rungsData, state, storage, onChange }
let selectedId = null; // the 1RM test shown in the chart's tooltip; null means the latest
let tipShown = true; // tapping the selected test again hides its tooltip; selecting any test shows it
let view; // { metric, range }: what the chart plots and over which range, remembered on this device

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

/**
 * Every record, oldest first, with your full numbers as of it (`test`: what it logged plus the rest carried
 * forward, with `from`, when each was last logged), scored in its own sex and the chosen formula.
 */
function entries() {
  const { profile, tests } = ctx.state;
  return L.carried(tests).map(({ record, values, from }) => ({
    id: record.id,
    date: record.date,
    record,
    test: { ...values, date: record.date },
    from,
    score: L.profileScore({ ...profile, ...values }),
    otherSex: values.sex !== profile.sex,
  }));
}

/** What a day logged (every record that day, combined) and what it carried from earlier days. */
function dayParts(entry) {
  const logged = L.VALUES.filter((name) => entry.from[name] === entry.date);
  return { logged, carried: L.VALUES.filter((name) => !logged.includes(name)) };
}

// --- The chart: one point per day of 1RM testing ---------------------------------------

/** The chart's points: each day's last-saved test (several tests on one day would otherwise sit on top of each other). */
const days = () => onePerDay(entries());

/** The days in range: all, or the last 3 months' (the tiles and "since" follow the same range). */
const rangeDays = () => inRange(days(), view.range, ctx.state.today);

/** The days the chart plots: in range, and for a single lift only the days that lift was logged. */
const chartDays = () => {
  const lift = view.metric === "lifts" && view.lift !== "total" ? view.lift : null;
  return lift ? inRange(liftDays(days(), lift), view.range, ctx.state.today) : rangeDays();
};

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
  const { formula } = ctx.state.profile;
  const label = S.FORMULAS[formula].label;
  const scoreText = (n) => S.formatScore(formula, n);
  return {
    score: { name: label, value: (e) => e.score, num: scoreText, text: scoreText, change: (n) => signed(formula, n), unit: `${label} now`, rungs: true, rungText: (n) => S.formatRung(formula, n) },
    total: { name: "Total", value: (e) => L.sumLifts(e.test), num: kgValue, text: (n) => `${kgValue(n)} kg`, change: kgChange, unit: "kg total now", rungs: false },
    bw: { name: "Bodyweight", value: (e) => e.test.bodyweight, num: kgValue, text: (n) => `${kgValue(n)} kg`, change: kgChange, unit: "kg bodyweight now", rungs: false },
    ...Object.fromEntries(
      L.LIFTS.map((lift) => [
        lift,
        { name: LIFT_NAMES[lift], value: (e) => e.test[lift], num: kgValue, text: (n) => `${kgValue(n)} kg`, change: kgChange, unit: `kg ${lift} now`, rungs: true, rungText: (n) => `${kgValue(n)} kg`, lift },
      ]),
    ),
  }[view.metric === "lifts" ? view.lift : view.metric];
}

function renderChart() {
  const m = measure();
  const list = chartDays();
  const scoreRungs = groupRungs();
  const rungs = m.lift ? liftRungs(m.lift) : m.rungs ? scoreRungs : [];
  // A single lift marks the days it set a PR.
  const prDays = m.lift ? liftPrDays(m.lift) : new Set();
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
  renderStats(rangeDays(), scoreRungs);
  $("chart-hit").hidden = list.length < 2;
}

/** "men 83 kg, first meet": the group the rungs come from (the Ladder's class and experience). */
function groupName() {
  const { profile, experience } = ctx.state;
  return `${profile.sex === "M" ? "men" : "women"} ${L.effectiveClass(profile)} kg, ${experience}`;
}

/** One lift's rungs in kg for the group the Ladder is showing (empty if the group has none for that lift). */
function liftRungs(lift) {
  const { profile, experience } = ctx.state;
  return L.liftRungsFor(ctx.rungsData, lift, profile.sex, L.effectiveClass(profile), experience)?.rungs ?? [];
}

/** The days a record set a PR on this lift. */
function liftPrDays(lift) {
  const prs = L.prs(ctx.state.tests);
  return new Set(ctx.state.tests.filter((t) => prs.get(t.id)?.includes(lift)).map((t) => t.date));
}

/** Score | Total | BW and 3M | All: pressed buttons, saved on this device. */
function renderControls() {
  const group = (id, options, key) =>
    $(id).replaceChildren(
      ...options.map(([value, text]) => {
        const button = el("button", "view-option", text);
        button.type = "button";
        button.setAttribute("aria-pressed", view[key] === value);
        button.addEventListener("click", () => {
          if (view[key] === value) return;
          view = { ...view, [key]: value };
          L.saveView(ctx.storage, view);
          renderChart();
        });
        return button;
      }),
    );
  group("chart-metric", [["score", "Score"], ["lifts", "Lifts"], ["bw", "BW"]], "metric");
  // Lifts has a second choice: the total or one lift.
  $("chart-lift").hidden = view.metric !== "lifts";
  group("chart-lift", [["total", "Total"], ...L.LIFTS.map((lift) => [lift, LIFT_NAMES[lift]])], "lift");
  group("chart-range", [["3m", "3M"], ["all", "All"]], "range");
}

/** The value now, the change since the first day in range ("Starting point" with one), and a rung too high to draw. */
function renderHeader(list, model, m) {
  const latest = list.at(-1);
  $("chart-now").textContent = m.num(latest.score);
  $("chart-unit").textContent = m.unit;
  const change = latest.score - list[0].score;
  $("chart-change").textContent = list.length === 1 ? "Starting point" : `${m.change(change)} since ${shortDay(list[0].date)}`;
  // Up is good for the score and the total; a bodyweight change is neither, so it stays muted.
  $("chart-change").className = list.length > 1 && change > 0 && view.metric !== "bw" ? "up" : "";
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
  if (model.points.length > 1) {
    if (selected) nodes.push(svg("line", { class: "chart-guide", x1: selected.x, x2: selected.x, y1: selected.y, y2: height - bottom }));
    nodes.push(svg("polyline", { class: `chart-line${model.dense ? " dense" : ""}`, points: model.points.map((p) => `${p.x},${p.y}`).join(" ") }));
  }
  const ringed = selected ?? latest;
  for (const point of model.points) nodes.push(...pointMarks(point, point.id === ringed.id, model.dense));
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
  const pr = dayPrs().has(test.date) ? " · PR" : "";
  $("tip-title").textContent = `${shortDay(test.date)} · ${L.recordName(Object.fromEntries(logged.map((n) => [n, true])))}${pr}`;
  // Lifts carried from earlier days count towards the score; say so, briefly, and flag any from a bodyweight
  // more than 5 kg away (the score treats them as done at this day's weight).
  const carriedLifts = L.LIFTS.filter((lift) => carried.includes(lift));
  const stale = L.staleLifts(ctx.state.tests, test.date, test.bodyweight, logged);
  if (stale.length) extras.unshift(`${stale.map((s) => s.lift).join(" & ")} from ${stale[0].bodyweight} kg`);
  else if (carriedLifts.length && carriedLifts.length < L.LIFTS.length) extras.unshift(`${carriedLifts.join(" & ")} carried`);
  $("tip-score").textContent = `${value} · ${delta == null ? "first test" : m.change(delta)}`;
  $("tip-sub").textContent =
    ctx.state.tests.length === 1 ? "Log another to see your progress." : [`${L.sumLifts(test)} kg @ ${test.bodyweight}`, ...extras].join(" · ");
  placeTip(tip, selected);

  $("chart-live").textContent = [
    `${fmtDay(test.date)}${pr ? ", a PR" : ""}: ${view.metric === "score" ? `${value} ${m.name}` : `${m.name} ${value}`}`,
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

/** The days with a PR on any lift (from records that day). */
function dayPrs() {
  const ids = L.prs(ctx.state.tests);
  return new Set(ctx.state.tests.filter((t) => ids.has(t.id)).map((t) => t.date));
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
  const { formula } = ctx.state.profile;
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
  $("stat-tiles").setAttribute("aria-label", view.range === "all" ? "Since your first test" : "Over the last 3 months");
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
    const { points } = chartModel(chartDays(), []);
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
    const list = chartDays();
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

/** Each lift's bar, its kg, and where it sits among that lift's rungs ("Between P50 and P75"), when the group has them. */
function renderSplit() {
  const { profile } = ctx.state;
  const best = Math.max(...L.LIFTS.map((lift) => profile[lift]));
  $("split-for").textContent = `Against UK meet lifters: ${groupName()}.`;
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
      const where = L.rungPosition(liftRungs(lift), profile[lift]);
      if (where) li.append(el("span", "split-pos muted small", capital(where)));
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
    L.saveSettings(ctx.storage, ctx.state.profile);
    renderLever();
  });
}

// --- 1RMs: newest first, each editable ------------------------------------------------------
// Each row is one saved record: a 1RM test (all three lifts), a single 1RM ("Squat 1RM"), or a bodyweight.
// Opening it shows only the values it logged (the rest were carried from earlier records); valid changes
// save straight away, and closing it with invalid values undoes them.

const TEST_TEXT = {
  date: "Pick the day of the test (not a future one).",
  sex: "Choose men or women.",
  bodyweight: `Bodyweight must be ${L.LIMITS.bodyweight.join("–")} kg.`,
  ...Object.fromEntries(L.LIFTS.map((lift) => [lift, `${LIFT_NAMES[lift]} must be ${L.LIMITS.lift.join("–")} kg.`])),
};
const DELETE_TEXT = {
  only: "Your only record. To start over, use “Clear my numbers” on Log test.",
  earliest: "Your first record must hold bodyweight and all three lifts, and the next one doesn't.",
};

/** A record's name mid-sentence: "squat 1RM", "1RM test", "bodyweight". */
const lowerName = (record) => L.recordName(record).replace(/^(?!1RM)\w/, (c) => c.toLowerCase());

/** A form control inside its label. */
function labelled(text, control, className) {
  const label = el("label", className, text);
  label.append(control);
  return label;
}

function numberInput(name, [min, max]) {
  return Object.assign(el("input"), { name, type: "number", inputMode: "decimal", step: "any", min, max, required: true });
}

/** The closed row: the date, what was logged ("Squat 1RM · 150 kg"), a PR badge, and the score, filled in by refreshTestSummaries. */
function testSummary() {
  const summary = el("summary");
  const head = el("span", "test-head");
  head.append(el("span", "event-title"), el("span", "test-sub muted small"));
  summary.append(head, el("span", "event-score"));
  return summary;
}

/** The open row: date, sex and the values this record logged, a note on what it carried, a status line, and "Delete". */
function testForm(record) {
  const form = el("form", "fields");
  form.autocomplete = "off";
  const date = Object.assign(el("input"), { name: "date", type: "date", required: true, max: ctx.state.today, min: L.EARLIEST_DATE });
  const sex = el("select");
  sex.name = "sex";
  sex.append(new Option("Men", "M"), new Option("Women", "F"));
  const logged = L.loggedValues(record);
  const lifts = L.LIFTS.filter((lift) => logged.includes(lift));
  const fields = [labelled("Date", date), labelled("Sex", sex)];
  if (logged.includes("bodyweight")) fields.push(labelled("Bodyweight (kg)", numberInput("bodyweight", L.LIMITS.bodyweight), "wide"));
  if (lifts.length) {
    const row = el("div", lifts.length === 3 ? "trio wide" : "fields-lifts wide");
    row.append(...lifts.map((lift) => labelled(LIFT_NAMES[lift], numberInput(lift, L.LIMITS.lift))));
    fields.push(row);
  }
  const unlogged = L.VALUES.filter((name) => !logged.includes(name));
  if (unlogged.length) fields.push(el("p", "muted small wide", `${capital(unlogged.join(", ").replace(/, ([^,]*)$/, " and $1"))} carried from earlier records.`));
  const note = el("p", "event-note muted small wide");
  note.setAttribute("role", "status");
  const remove = el("button", "link-button wide", `Delete ${lowerName(record)}`);
  remove.type = "button";
  remove.addEventListener("click", () => deleteTest(record.id));
  form.append(...fields, note, remove);
  return form;
}

/** Closing a record with invalid values undoes them; either way the list goes back into date order. */
function onTestClosed(item, form) {
  if (item.open) return;
  if (item.dataset.invalid) {
    fillTest(form, ctx.state.tests.find((t) => t.id === item.dataset.id));
    form.querySelector(".event-note").textContent = "Invalid changes were undone.";
  }
  renderTests();
}

/** One row of the list: a summary that opens into the record's form. */
function testItem(record) {
  const item = el("details", "event test");
  item.dataset.id = record.id;
  const form = testForm(record);
  item.append(testSummary(), form);
  fillTest(form, record);
  form.addEventListener("input", () => onTestInput(item, form));
  item.addEventListener("toggle", () => onTestClosed(item, form));
  return item;
}

function fillTest(form, record) {
  const f = form.elements;
  for (const name of ["date", "sex", ...L.loggedValues(record)]) f[name].value = record[name];
  for (const input of form.querySelectorAll("input, select")) input.setCustomValidity("");
  form.closest("details").dataset.invalid = "";
}

/** The record as edited: its date, sex and the values it logged. */
function readTest(form, id) {
  const f = form.elements;
  const logged = L.VALUES.filter((name) => f[name]);
  return { id, date: f.date.value, sex: f.sex.value, ...Object.fromEntries(logged.map((name) => [name, f[name].valueAsNumber])) };
}

/** Saves the records, and the settings; the profile takes its latest numbers from the records. Returns whether both were saved. */
function persistTests(tests) {
  ctx.state.tests = L.sortTests(tests);
  ctx.state.profile = L.withLatestTest(ctx.state.profile, ctx.state.tests);
  const ok = L.saveTests(ctx.storage, ctx.state.tests) && L.saveSettings(ctx.storage, ctx.state.profile);
  $("tests-note").textContent = ok ? "" : "Couldn't save on this device; changes last until you close the page.";
  return ok;
}

function onTestInput(item, form) {
  const raw = readTest(form, item.dataset.id);
  const problems = L.testProblems(raw, ctx.state.today);
  // Moving the record before the first one would leave the history starting without all four values.
  const next = ctx.state.tests.map((t) => (t.id === raw.id ? raw : t));
  if (!problems.length && !L.isComplete(L.sortTests(next)[0])) problems.push("date");
  for (const input of form.querySelectorAll("input, select")) input.setCustomValidity(problems.includes(input.name) ? TEST_TEXT[input.name] : "");
  item.dataset.invalid = problems.length ? "true" : "";
  const note = form.querySelector(".event-note");
  if (problems.length) {
    const firstRule = problems.includes("date") && L.isDay(raw.date) && raw.date <= ctx.state.today ? "Your first record must hold bodyweight and all three lifts." : "";
    note.textContent = `Not saved: ${firstRule || problems.map((name) => TEST_TEXT[name]).join(" ")}`;
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
  if (L.deleteProblem(ctx.state.tests, id)) return;
  const record = ctx.state.tests.find((t) => t.id === id);
  if (!window.confirm(`Delete the ${lowerName(record)} from ${fmtDay(record.date)}?`)) return;
  persistTests(ctx.state.tests.filter((t) => t.id !== id));
  openProgress();
  ctx.onChange();
}

/** "150 kg" for one value, "150 / 105 kg" for two lifts, "370 kg @ 70 kg" for a test, with bodyweight when it was logged too. */
function loggedText(record) {
  const lifts = L.LIFTS.filter((lift) => lift in record);
  const bw = "bodyweight" in record ? `${record.bodyweight} kg` : "";
  if (lifts.length === 3) return `${L.sumLifts(record)} kg${bw ? ` @ ${bw}` : ""}`;
  if (!lifts.length) return bw;
  const kg = `${lifts.map((lift) => record[lift]).join(" / ")} kg`;
  return bw ? `${kg} @ ${bw}` : kg;
}

/** Each record's date, what it logged, a PR badge and the score at it, without touching its fields. */
function refreshTestSummaries() {
  const { formula } = ctx.state.profile;
  const records = L.prs(ctx.state.tests);
  for (const { id, record, score, otherSex } of entries()) {
    const item = $("test-list").querySelector(`[data-id="${id}"]`);
    if (!item) continue;
    const title = item.querySelector(".event-title");
    title.textContent = fmtDay(record.date);
    if (records.has(id)) title.append(" ", el("span", "pr-badge", "PR"));
    item.querySelector(".test-sub").textContent = [L.recordName(record), loggedText(record), otherSex ? SEX_WORDS[record.sex] : ""].filter(Boolean).join(" · ");
    item.querySelector(".event-score").textContent = item.dataset.invalid ? "not saved" : S.formatScore(formula, score);
    const problem = L.deleteProblem(ctx.state.tests, id);
    const remove = item.querySelector(".link-button");
    remove.disabled = Boolean(problem);
    remove.title = problem ? DELETE_TEXT[problem] : "";
  }
}

/** Rebuilds the list of records newest first, keeping open whichever was open. */
function renderTests() {
  const open = $("test-list").querySelector("details[open]")?.dataset.id;
  const items = [...ctx.state.tests].reverse().map((record) => {
    const item = testItem(record);
    item.open = record.id === open;
    return item;
  });
  $("test-list").replaceChildren(...items);
  refreshTestSummaries();
}

// --- Wiring -------------------------------------------------------------------------

export function setupProgress(context) {
  ctx = context;
  view = L.loadView(ctx.storage);
  setupChartTouch();
  setupLever();
}

/** The same DOTS / GL toggle as the Ladder's: switching redraws this screen and saves the choice for every screen. */
function renderFormula() {
  $("progress-formula").replaceChildren(
    ...formulaButtons(ctx.state.profile.formula, (id) => {
      ctx.state.profile = { ...ctx.state.profile, formula: id };
      L.saveSettings(ctx.storage, ctx.state.profile);
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
