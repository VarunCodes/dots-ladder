// The first visit: four steps that teach DOTS with the visitor's own numbers, then save them as the first record.
//   1. sex and bodyweight; 2. the three lifts, totalled as you type; 3. your score, with the totals that score the
//   same 10 kg either side; 4. who you're compared with (first-meet powerlifters in your class) and the share of
//   them you're stronger than. What's typed is kept while you move between steps; nothing is saved until the end.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import * as store from "./store.js";
import { $, el, replay } from "./dom.js";
import { FIELD_TEXT } from "./log.js";

const kg = (value) => `${Number(value.toFixed(1))}`;

let step = 1;
let rungsData = null;
// Fields the visitor has finished with (left after changing): their problems show even with one digit.
const finished = new Set();

const form = () => $("onboarding");
const submit = () => form().querySelector('button[type="submit"]');

function read() {
  const f = form().elements;
  return {
    sex: f.sex.value,
    bodyweight: f.bodyweight.valueAsNumber,
    ...Object.fromEntries(L.LIFTS.map((lift) => [lift, f[lift].valueAsNumber])),
    weightClass: null,
  };
}

const NUMBER_FIELDS = ["bodyweight", ...L.LIFTS];

/** The current step's state (ladder.js firstStepState) from what's typed. */
function state() {
  const texts = Object.fromEntries(NUMBER_FIELDS.map((name) => [name, form().elements[name].value]));
  return L.firstStepState(step, read(), texts, finished);
}

/** Flags this step's problems (red border and message), sets Next, and updates step 2's running total. */
function check() {
  const { flagged, canGoOn } = state();
  for (const name of NUMBER_FIELDS) form().elements[name].closest(".onboard-unit").classList.toggle("flagged", flagged.includes(name));
  $("onboard-note").textContent = flagged.map((name) => FIELD_TEXT[name]).join(" ");
  submit().disabled = !canGoOn;
  $("onboard-total").textContent = `${kg(L.typedTotal(read()))} kg`;
}

const SVG = "http://www.w3.org/2000/svg";

/** A simple standing figure (head and body), scaled; decorative, as the chart's label names the bodyweights. */
function lifterFigure(scale) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "reveal-figure");
  svg.setAttribute("viewBox", "0 0 24 40");
  svg.setAttribute("aria-hidden", "true");
  svg.style.height = `${Math.round(48 * scale)}px`;
  const head = document.createElementNS(SVG, "circle");
  Object.entries({ cx: 12, cy: 6, r: 5 }).forEach(([k, v]) => head.setAttribute(k, v));
  const body = document.createElementNS(SVG, "rect");
  Object.entries({ x: 4, y: 13, width: 16, height: 27, rx: 6 }).forEach(([k, v]) => body.setAttribute(k, v));
  svg.append(head, body);
  return svg;
}

/** Step 3: the score, and the same score's totals at 10 kg lighter and heavier, as bars that grow once. */
function renderScore(profile) {
  const total = L.sumLifts(profile);
  const points = S.formatScore("dots", S.score("dots", { total, bw: profile.bodyweight, sex: profile.sex }));
  $("reveal-score").textContent = points;
  $("reveal-from").textContent = `From ${kg(total)} kg total at ${kg(profile.bodyweight)} kg bodyweight`;
  $("reveal-caption").textContent = `Each bar is the total that also scores ${points}`;

  const bars = L.sameScoreTotals(profile);
  const top = Math.max(...bars.map((b) => b.total));
  // The others grow first, yours last.
  const others = bars.filter((b) => !b.you);
  $("reveal-bars").replaceChildren(
    ...bars.map((b) => {
      const col = el("div", `reveal-col${b.you ? " you" : ""}`);
      const bar = el("span", "reveal-bar");
      bar.style.height = `${(120 * b.total) / top}px`;
      bar.style.setProperty("--order", b.you ? others.length : others.indexOf(b));
      // A lifter in each bar, drawn bigger the heavier they are: the bars differ because the people do.
      // The others say how far their total is from yours.
      if (!b.you) bar.append(el("span", "reveal-gap", L.totalGapWords(b.total, total)));
      bar.append(lifterFigure(Math.min(1.3, Math.max(0.7, b.bw / profile.bodyweight))));
      col.append(el("span", "reveal-kg", `${kg(b.total)} kg`), bar, el("span", "reveal-who", b.you ? `You · ${kg(b.bw)} kg` : `${kg(b.bw)} kg`));
      return col;
    }),
  );
  $("reveal-bars").setAttribute(
    "aria-label",
    `Bar chart: ${bars.map((b) => (b.you ? `you need ${kg(b.total)} kg at ${kg(b.bw)} kg` : `${L.articleFor(kg(b.bw))} ${kg(b.bw)} kg lifter needs ${kg(b.total)} kg`)).join(", ")}. All score ${points} DOTS.`,
  );
  replay($("reveal-bars"), "grow");

  $("reveal-same").textContent = L.sameScoreWords(bars);
}

/** Step 4: who you're compared with, and how many of every 100 of them you're stronger than. */
function renderStanding(profile) {
  const standing = rungsData && L.firstStanding(rungsData, profile);
  $("standing-who").textContent = `${L.firstGroupWords(profile.sex, L.weightClass(profile.sex, profile.bodyweight))} Real results from OpenPowerlifting.`;
  const dots = $("standing-dots");
  dots.hidden = $("standing-key").hidden = !standing;
  $("standing-scale").hidden = true;
  if (!standing) {
    $("onboard-h4").textContent = "Not enough powerlifters in this group to compare yet";
    $("standing-more").textContent = "Your ladder still shows your score and how it changes.";
    return;
  }
  // Below every rung, the labelled gym-goer estimate gives a familiar reference point, apart from the dots.
  $("standing-scale").hidden = Boolean(standing.passed);
  $("standing-scale").textContent = L.gymGoerWords(profile.sex, S.score("dots", { total: L.sumLifts(profile), bw: profile.bodyweight, sex: profile.sex }));
  const words = L.standingWords(standing);
  $("onboard-h4").textContent = words.title;
  $("standing-more").textContent = words.more ?? "";
  $("standing-key").textContent = L.dotKeyWords(profile.sex, standing.wclass, standing.passed);
  dots.setAttribute(
    "aria-label",
    standing.passed
      ? `100 dots, ${standing.passed} filled in: you are stronger than ${standing.passed} of every 100 of these powerlifters.`
      : `100 dots, ${standing.next.percentile} outlined: your first target is to be stronger than ${standing.next.percentile} of every 100 of these powerlifters.`,
  );
  dots.replaceChildren(
    ...Array.from({ length: 100 }, (_, i) => {
      // Below every rung, the first rung's dots are outlined as the target.
      const dot = el("span", i < standing.passed ? "on" : !standing.passed && i < standing.next.percentile ? "target" : "");
      dot.style.setProperty("--i", i);
      return dot;
    }),
  );
  replay(dots, "fill");
}

/** Shows a step: its panel (rising in, unless it's the first one shown), the progress bar and the buttons. */
function show(next, animate = true) {
  step = next;
  for (const panel of form().querySelectorAll(".onboard-step")) panel.hidden = Number(panel.dataset.step) !== step;
  const { count, back, privateNote, next: label } = state();
  $("onboard-count").textContent = count;
  form().querySelectorAll(".onboard-bar span").forEach((bar, i) => bar.classList.toggle("done", i < step));
  form().querySelector(".onboard-back").hidden = !back;
  form().querySelector(".onboard-private").hidden = !privateNote;
  $("onboard-restore").hidden = step !== 1; // a new phone can start from a backup instead (yourdata.js)
  submit().textContent = label;
  const profile = L.validProfile(read());
  if (step === 3 && profile) renderScore(profile);
  if (step === 4 && profile) renderStanding(profile);
  check();
  if (!animate) return;
  const panel = form().querySelector(`.onboard-step[data-step="${step}"]`);
  replay(panel, "enter");
  window.scrollTo(0, 0);
  panel.querySelector("h2").focus({ preventScroll: true });
}

/** Back to an empty step 1, e.g. after "Clear my numbers". */
export function resetOnboarding() {
  form().reset();
  finished.clear();
  show(1, false);
}

export function setupOnboarding(data) {
  rungsData = data;
  form().addEventListener("input", check);
  form().addEventListener("change", (event) => {
    if (event.target.type === "number") finished.add(event.target.name);
    check();
  });
  form().querySelector(".onboard-back").addEventListener("click", () => show(step - 1));
  // Next (or Enter in a field) moves on once the step's values are valid; the last step saves them as the first
  // record, dated today, and the store's subscriber leaves the first visit for the Ladder.
  form().addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit().disabled) return;
    if (step < L.FIRST_VISIT_STEPS) return show(step + 1);
    const profile = L.validProfile(read());
    if (!profile) return;
    store.update((s) => ({ entries: [L.testFrom(profile, s.session.today, L.newId("test"))] }));
  });
  show(1, false);
}
