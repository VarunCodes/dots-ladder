// "Log test" screen: the test date, steppers for bodyweight and the three lifts, sex and weight class, and a
// live result against your last test. Edits are a draft until "Save test", which adds the test to your
// history. Logic lives in ladder.js; this file only renders.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import { $, formulaButtons } from "./dom.js";
import { fmtDay } from "./events.js";

export const FIELD_TEXT = {
  date: "Pick the day of the test (not a future one).",
  sex: "Choose men or women.",
  bodyweight: `Bodyweight must be ${L.LIMITS.bodyweight.join("–")} kg.`,
  ...Object.fromEntries(L.LIFTS.map((lift) => [lift, `${lift[0].toUpperCase()}${lift.slice(1)} must be ${L.LIMITS.lift.join("–")} kg.`])),
};

const LIMITS_FOR = { bodyweight: L.LIMITS.bodyweight, squat: L.LIMITS.lift, bench: L.LIMITS.lift, deadlift: L.LIMITS.lift };

let ctx; // { rungsData, state, storage, onSaved, onCleared }; state has profile, tests and today

const form = () => $("log-form");

/** The draft in the form, in the same shape as a saved profile; the formula isn't on this screen, so it's kept. */
function read() {
  const f = form().elements;
  return {
    sex: f.sex.value,
    bodyweight: f.bodyweight.valueAsNumber,
    ...Object.fromEntries(L.LIFTS.map((lift) => [lift, f[lift].valueAsNumber])),
    weightClass: f.weightClass.value || null,
    formula: ctx.state.profile.formula,
    date: f.date.value,
  };
}

/** Rebuilds the class dropdown for the sex; its "auto" option shows the class the bodyweight gives. */
function fillClassSelect(draft) {
  const select = form().elements.weightClass;
  const auto = Number.isFinite(draft.bodyweight) ? `Auto (${L.weightClass(draft.sex, draft.bodyweight)} kg)` : "Auto";
  select.replaceChildren(new Option(auto, ""), ...L.weightClasses(draft.sex).map((c) => new Option(`${c} kg`, c)));
  select.value = L.weightClasses(draft.sex).includes(draft.weightClass) ? draft.weightClass : "";
}

function renderClassNote(profile) {
  const limit = profile && L.overClassLimit(profile);
  $("class-note").textContent = !profile
    ? ""
    : limit
      ? `To lift in this class you'd need to weigh in at ${limit} kg or under (you're ${profile.bodyweight} kg).`
      : profile.weightClass
        ? `Comparing against the ${profile.weightClass} kg class.`
        : "Worked out from your bodyweight. Pick a class to compare against a different one.";
}

/** Under the date: what happens to a test dated before your latest one. */
function renderDateNote(date) {
  const latest = L.latestTest(ctx.state.tests);
  $("date-note").textContent = latest && L.isDay(date) && date < latest.date
    ? `Earlier than your latest test (${fmtDay(latest.date)}), so it goes into your history and the Ladder keeps showing the latest.`
    : "";
}

/** The live result card and the Save button, for the current draft against your last test on or before its date. */
function renderResult() {
  const raw = read();
  const dateOk = !L.testProblems(raw, ctx.state.today).includes("date");
  const draft = dateOk ? L.validProfile(raw) : null;
  const problems = [...(dateOk ? [] : ["date"]), ...L.invalidFields(raw)];
  $("log-note").textContent = problems.map((name) => FIELD_TEXT[name]).join(" ");
  $("save-test").disabled = !draft;
  renderDateNote(raw.date);
  renderClassNote(draft);
  const { formula } = ctx.state.profile;
  const unit = S.FORMULAS[formula].label;
  $("result-unit").textContent = unit;
  // The toggle changes only the saved formula, never the draft's numbers.
  $("log-formula").replaceChildren(
    ...formulaButtons(formula, (id) => {
      ctx.state.profile = { ...ctx.state.profile, formula: id };
      L.saveProfile(ctx.storage, ctx.state.profile);
      renderResult();
    }),
  );
  if (!draft) {
    $("result-total").textContent = "Total –";
    $("result-delta").textContent = "";
    $("result-delta").className = "";
    $("result-score").textContent = "–";
    $("result-rungs").textContent = "Fix the highlighted values to see your result.";
    return;
  }

  // The last test is scored in its own sex and the chosen formula.
  const last = L.previousTest(ctx.state.tests, raw.date);
  const total = L.sumLifts(draft);
  const score = L.profileScore(draft);
  const lastScore = last ? L.profileScore(L.withLatestTest(draft, [last])) : score;
  const delta = score - lastScore;
  $("result-total").textContent = `Total ${total} kg`;
  $("result-delta").textContent = last ? `${delta >= 0 ? "+" : "−"}${S.formatScore(formula, Math.abs(delta))} vs last test` : "First test";
  $("result-delta").className = last && delta > 0 ? "up" : "";
  $("result-score").textContent = S.formatScore(formula, score);

  const group = L.rungsFor(ctx.rungsData, formula, draft.sex, L.effectiveClass(draft), ctx.state.experience);
  if (!group) {
    $("result-rungs").textContent = "Not enough lifters in this group to publish rungs.";
    return;
  }
  const moved = L.rungsClimbed(group.rungs, lastScore, score);
  const next = L.nextRung(group.rungs, score);
  const plural = (n) => `${n} rung${n === 1 ? "" : "s"}`;
  $("result-rungs").textContent = [
    moved > 0 ? `Climbs ${plural(moved)}.` : moved < 0 ? `Drops ${plural(-moved)}.` : "",
    next ? `Next rung needs ${S.formatScore(formula, next.score - score)} more ${unit}.` : "Clears every rung.",
  ].filter(Boolean).join(" ");
}

/** Fills the form from your latest test, dated today; called each time the screen opens, so an unsaved draft is dropped. */
export function openLog({ focusClass = false } = {}) {
  const profile = ctx.state.profile;
  const f = form().elements;
  f.date.value = ctx.state.today;
  f.date.max = ctx.state.today;
  f.date.min = L.EARLIEST_DATE;
  f.sex.value = profile.sex;
  for (const name of ["bodyweight", ...L.LIFTS]) f[name].value = profile[name];
  fillClassSelect(profile);
  renderResult();
  if (focusClass) f.weightClass.focus();
}

export function setupLog(context) {
  ctx = context;
  const f = form().elements;

  form().addEventListener("click", (event) => {
    const button = event.target.closest(".step-btn");
    if (!button) return;
    const stepper = button.closest(".stepper");
    const input = stepper.querySelector("input");
    input.value = L.stepValue(input.valueAsNumber, Number(stepper.dataset.step), Number(button.dataset.dir), LIMITS_FOR[input.name]);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  form().addEventListener("input", (event) => {
    // Classes differ by sex, so a sex change goes back to working the class out from bodyweight.
    if (event.target.name === "sex") f.weightClass.value = "";
    // Only the dropdown is refilled: rewriting an input while it's being typed in would eat a trailing "." or "0".
    if (event.target.name === "sex" || event.target.name === "bodyweight") fillClassSelect(read());
    renderResult();
  });

  // Saving adds the test to the history; the profile keeps the sex, class and formula, and the latest test's numbers.
  form().addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = read();
    const draft = L.validProfile(raw);
    if (!draft || L.testProblems(raw, ctx.state.today).length) return;
    const tests = L.sortTests([...ctx.state.tests, L.testFrom(draft, raw.date, L.newId("test"))]);
    ctx.state.tests = tests;
    ctx.state.profile = L.withLatestTest(draft, tests);
    ctx.onSaved(L.saveTests(ctx.storage, tests) && L.saveProfile(ctx.storage, ctx.state.profile));
  });

  // Clearing goes back to the first-visit form; there are no default numbers to fall back to.
  $("clear-numbers").addEventListener("click", () => {
    if (!window.confirm("Clear your numbers and test history from this phone? You'll be asked for them again.")) return;
    try {
      ctx.storage?.removeItem(L.PROFILE_KEY);
      ctx.storage?.removeItem(L.TESTS_KEY);
    } catch {
      // Nothing saved to clear.
    }
    ctx.state.profile = null;
    ctx.state.tests = [];
    ctx.onCleared();
  });
}
