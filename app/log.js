// "Log test" screen: steppers for bodyweight and the three lifts, sex and weight class, and a live
// result. Edits are a draft until "Save test". Logic lives in ladder.js; this file only renders.
import * as L from "./ladder.js";
import { $ } from "./dom.js";

export const FIELD_TEXT = {
  sex: "Choose men or women.",
  bodyweight: `Bodyweight must be ${L.LIMITS.bodyweight.join("–")} kg.`,
  ...Object.fromEntries(L.LIFTS.map((lift) => [lift, `${lift[0].toUpperCase()}${lift.slice(1)} must be ${L.LIMITS.lift.join("–")} kg.`])),
};

const LIMITS_FOR = { bodyweight: L.LIMITS.bodyweight, squat: L.LIMITS.lift, bench: L.LIMITS.lift, deadlift: L.LIMITS.lift };

let ctx; // { rungsData, state, storage, onSaved, onCleared }

const form = () => $("log-form");

/** The draft in the form, in the same shape as a saved profile. */
function read() {
  const f = form().elements;
  return {
    sex: f.sex.value,
    bodyweight: f.bodyweight.valueAsNumber,
    ...Object.fromEntries(L.LIFTS.map((lift) => [lift, f[lift].valueAsNumber])),
    weightClass: f.weightClass.value || null,
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

/** The live result card and the Save button, for the current draft against the saved numbers. */
function renderResult() {
  const raw = read();
  const draft = L.validProfile(raw);
  const problems = L.invalidFields(raw);
  $("log-note").textContent = problems.map((name) => FIELD_TEXT[name]).join(" ");
  $("save-test").disabled = !draft;
  renderClassNote(draft);
  if (!draft) {
    $("result-total").textContent = "Total –";
    $("result-delta").textContent = "";
    $("result-delta").className = "";
    $("result-dots").textContent = "–";
    $("result-rungs").textContent = "Fix the highlighted values to see your result.";
    return;
  }

  const saved = ctx.state.profile;
  const total = L.sumLifts(draft);
  const score = L.dots(draft.sex, draft.bodyweight, total);
  const savedScore = L.dots(saved.sex, saved.bodyweight, L.sumLifts(saved));
  const delta = score - savedScore;
  $("result-total").textContent = `Total ${total} kg`;
  $("result-delta").textContent = `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} vs saved`;
  $("result-delta").className = delta > 0 ? "up" : "";
  $("result-dots").textContent = score.toFixed(1);

  const group = L.rungsFor(ctx.rungsData, draft.sex, L.effectiveClass(draft), ctx.state.experience);
  if (!group) {
    $("result-rungs").textContent = "Not enough lifters in this group to publish rungs.";
    return;
  }
  const moved = L.rungsClimbed(group.rungs, savedScore, score);
  const next = L.nextRung(group.rungs, score);
  const plural = (n) => `${n} rung${n === 1 ? "" : "s"}`;
  $("result-rungs").textContent = [
    moved > 0 ? `Climbs ${plural(moved)}.` : moved < 0 ? `Drops ${plural(-moved)}.` : "",
    next ? `Next rung needs ${(next.dots - score).toFixed(1)} more DOTS.` : "Clears every rung.",
  ].filter(Boolean).join(" ");
}

/** Fills the form from the saved numbers; called each time the screen opens, so an unsaved draft is dropped. */
export function openLog({ focusClass = false } = {}) {
  const profile = ctx.state.profile;
  const f = form().elements;
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

  form().addEventListener("submit", (event) => {
    event.preventDefault();
    const profile = L.validProfile(read());
    if (!profile) return;
    ctx.state.profile = profile;
    ctx.onSaved(L.saveProfile(ctx.storage, profile));
  });

  // Clearing goes back to the first-visit form; there are no default numbers to fall back to.
  $("clear-numbers").addEventListener("click", () => {
    if (!window.confirm("Clear your numbers from this phone? You'll be asked for them again.")) return;
    try {
      ctx.storage?.removeItem(L.PROFILE_KEY);
    } catch {
      // Nothing saved to clear.
    }
    ctx.state.profile = null;
    ctx.onCleared();
  });
}
