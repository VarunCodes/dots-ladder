// "Log test" screen: log a new 1RM, a full 1RM test, or a bodyweight. Every field starts from your numbers as of
// the chosen date; only what you change is saved, and the button says what that is ("Save squat 1RM"). Unchanged
// fields stay usable but muted, with when they were last logged. A live result compares the draft with your
// numbers before it. Logic lives in ladder.js; this file only renders.
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
const STALE_BODYWEIGHT_DAYS = 7; // older than this, the bodyweight hint asks for a fresh weigh-in

let ctx; // { rungsData, state, storage, onSaved, onCleared }; state has profile, tests and today
let changed = new Set(); // the values touched since the screen opened: only these are saved
const hints = {}; // each stepper's own hint ("kg · 2.5 steps"), shown once its value is changed

const form = () => $("log-form");
const capital = (word) => word[0].toUpperCase() + word.slice(1);
const shortDay = (day) => new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

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

/** Your numbers as of the chosen date, or the earliest record's for a date before it (then everything is saved). */
function base(date) {
  const at = L.isDay(date) ? L.valuesAt(ctx.state.tests, date) : null;
  return at ?? { ...L.carried(ctx.state.tests)[0], before: true };
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

/** Under the date: a date before your first record saves all four values; one before your latest leaves the Ladder alone. */
function renderDateNote(date, before) {
  const latest = L.latestTest(ctx.state.tests);
  $("date-note").textContent = !L.isDay(date)
    ? ""
    : before
      ? "Before your first record, so all four values are saved with this one."
      : latest && date < latest.date
        ? `Earlier than your latest record (${fmtDay(latest.date)}), so it goes into your history and the Ladder keeps showing the latest.`
        : "";
}

/** Fills the fields you haven't changed with your numbers as of the date. */
function fillUnchanged(at) {
  const f = form().elements;
  for (const name of L.VALUES) if (!changed.has(name)) f[name].value = at.values[name];
}

/** Changed fields look as normal; unchanged ones are muted, with when they were last logged (bodyweight asks for an update after a week). */
function renderSteppers(at, date) {
  for (const name of L.VALUES) {
    const stepper = form().elements[name].closest(".stepper");
    const hint = stepper.querySelector(".stepper-hint");
    const kept = !changed.has(name) && !at.before;
    const stale = kept && name === "bodyweight" && L.isDay(date) && L.daysBetween(at.from.bodyweight, date) > STALE_BODYWEIGHT_DAYS;
    stepper.classList.toggle("carried", kept);
    stepper.classList.toggle("stale", stale);
    hint.textContent = !kept ? hints[name] : stale ? `From ${shortDay(at.from[name])} · update it?` : `Last logged ${shortDay(at.from[name])}`;
  }
}

/** The live result card and the Save button, for the draft against your numbers before it. */
function renderResult() {
  const raw = read();
  const at = base(raw.date);
  const toSave = at.before ? L.VALUES : L.VALUES.filter((name) => changed.has(name));
  const dateOk = !L.testProblems(raw, ctx.state.today).includes("date");
  const draft = dateOk ? L.validProfile(raw) : null;
  const problems = [...(dateOk ? [] : ["date"]), ...L.invalidFields(raw)];
  const label = L.saveLabel(toSave);
  $("log-note").textContent = problems.map((name) => FIELD_TEXT[name]).join(" ");
  $("save-test").textContent = label ?? "No changes yet";
  $("save-test").disabled = !draft || !label;
  renderDateNote(raw.date, at.before);
  renderSteppers(at, raw.date);
  renderClassNote(draft);
  const { formula } = ctx.state.profile;
  const unit = S.FORMULAS[formula].label;
  $("result-unit").textContent = unit;
  // The toggle changes only the saved formula, never the draft's numbers.
  $("log-formula").replaceChildren(
    ...formulaButtons(formula, (id) => {
      ctx.state.profile = { ...ctx.state.profile, formula: id };
      L.saveSettings(ctx.storage, ctx.state.profile);
      renderResult();
    }),
  );
  if (!draft) {
    $("result-stale").textContent = "";
    $("result-total").textContent = "Total –";
    $("result-delta").textContent = "";
    $("result-delta").className = "";
    $("result-score").textContent = "–";
    $("result-rungs").textContent = "Fix the highlighted values to see your result.";
    return;
  }

  // Your numbers before this record, scored in their own sex and the chosen formula.
  const before = at.before ? null : { ...draft, ...at.values };
  const score = L.profileScore(draft);
  const lastScore = before ? L.profileScore(before) : score;
  const delta = score - lastScore;
  const lifts = L.LIFTS.filter((lift) => toSave.includes(lift));
  const kg = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n * 10) / 10)} kg`;
  // One lift: its new 1RM and the change; otherwise the total.
  $("result-total").textContent =
    lifts.length === 1 && before ? `${capital(lifts[0])} ${draft[lifts[0]]} kg · ${kg(draft[lifts[0]] - before[lifts[0]])}` : `Total ${L.sumLifts(draft)} kg`;
  $("result-delta").textContent = before ? `${delta >= 0 ? "+" : "−"}${S.formatScore(formula, Math.abs(delta))} vs last` : "First record";
  $("result-delta").className = before && delta > 0 ? "up" : "";
  $("result-score").textContent = S.formatScore(formula, score);
  // Lifts carried from a bodyweight more than 5 kg away make the score treat them as done at today's weight.
  const stale = L.staleLifts(ctx.state.tests, raw.date, draft.bodyweight, toSave);
  $("result-stale").textContent = stale.length
    ? `${capital(L.staleText(stale))}; you're ${draft.bodyweight} kg now. Retest ${stale.length === 1 ? "it" : "them"} for an accurate score.`
    : "";

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

/** Fills the form with your latest numbers, dated today, nothing changed; called each time the screen opens, so a draft is dropped. */
export function openLog({ focusClass = false } = {}) {
  const profile = ctx.state.profile;
  const f = form().elements;
  changed = new Set();
  f.date.value = ctx.state.today;
  f.date.max = ctx.state.today;
  f.date.min = L.EARLIEST_DATE;
  f.sex.value = profile.sex;
  fillUnchanged(base(ctx.state.today));
  fillClassSelect(profile);
  renderResult();
  if (focusClass) f.weightClass.focus();
}

export function setupLog(context) {
  ctx = context;
  const f = form().elements;
  for (const name of L.VALUES) hints[name] = f[name].closest(".stepper").querySelector(".stepper-hint").textContent;

  form().addEventListener("click", (event) => {
    const button = event.target.closest(".step-btn");
    if (!button) return;
    const stepper = button.closest(".stepper");
    const input = stepper.querySelector("input");
    input.value = L.stepValue(input.valueAsNumber, Number(stepper.dataset.step), Number(button.dataset.dir), LIMITS_FOR[input.name]);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  form().addEventListener("input", (event) => {
    // With no records the first-visit form is showing, and this form has nothing to start from.
    if (!ctx.state.tests.length) return;
    const { name } = event.target;
    if (L.VALUES.includes(name)) changed.add(name);
    // A new date brings that day's numbers into the fields you haven't changed.
    if (name === "date" && L.isDay(f.date.value)) fillUnchanged(base(f.date.value));
    // Classes differ by sex, so a sex change goes back to working the class out from bodyweight.
    if (name === "sex") f.weightClass.value = "";
    // Only the dropdown is refilled: rewriting an input while it's being typed in would eat a trailing "." or "0".
    if (name === "sex" || name === "bodyweight" || name === "date") fillClassSelect(read());
    renderResult();
  });

  // Saving adds a record of only what changed (all four before your first record); the profile keeps the class
  // and formula (the only part saved with it), and takes your latest numbers from the records.
  form().addEventListener("submit", (event) => {
    event.preventDefault();
    const raw = read();
    const draft = L.validProfile(raw);
    const at = base(raw.date);
    const names = at.before ? L.VALUES : L.VALUES.filter((name) => changed.has(name));
    if (!draft || !names.length || L.testProblems(raw, ctx.state.today).length) return;
    const tests = L.sortTests([...ctx.state.tests, L.testFrom(draft, raw.date, L.newId("test"), names)]);
    ctx.state.tests = tests;
    ctx.state.profile = L.withLatestTest(draft, tests);
    ctx.onSaved(L.saveTests(ctx.storage, tests) && L.saveSettings(ctx.storage, ctx.state.profile));
  });

  // Clearing goes back to the first-visit form; there are no default numbers to fall back to.
  $("clear-numbers").addEventListener("click", () => {
    if (!window.confirm("Clear your numbers and 1RM history from this phone? You'll be asked for them again.")) return;
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
