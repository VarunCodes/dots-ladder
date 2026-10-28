// Page wiring: loads the two data files, then renders with the pure logic in ladder.js.
import * as L from "./ladder.js";
import { $, el } from "./dom.js";
import { eventLabel, refreshEvents, setupEvents } from "./events.js";

// The rungs are raw full-power results only (see pipeline/build_rungs.py), so everyone here is compared as raw.
const EQUIPMENT = "Raw";

const fmtDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const rungLabel = ({ percentile }) => (percentile === 50 ? "Median" : `Beats ${percentile}%`);

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

/** Scores to place on the ladder alongside the rungs: you now, each upcoming event's scenarios, and the gym-goer estimate. */
function markers(state) {
  const { profile, events, thisMonth } = state;
  const list = [
    { label: "You now", dots: L.dots(profile.sex, profile.bodyweight, L.sumLifts(profile)), kind: "now" },
    { ...L.referenceMarker(profile.sex), kind: "reference" },
  ];
  for (const event of L.ladderEvents(events, thisMonth)) {
    const scores = L.eventScores(event, profile.sex);
    for (const { scenario, dots } of scores) {
      list.push({ label: eventLabel(event, scores.length > 1 ? scenario : null), dots, kind: "projection" });
    }
  }
  return list;
}

function renderNow(profile) {
  const total = L.sumLifts(profile);
  const score = L.dots(profile.sex, profile.bodyweight, total);
  $("now-dots").textContent = score.toFixed(1);
  for (const lift of L.LIFTS) $(`lift-${lift}`).textContent = profile[lift];
  $("now-detail").textContent = `${total} kg total`;
  return score;
}

function renderNext(profile, score, group, experience) {
  const { sex, bodyweight: bw } = profile;
  const target = $("next-rung");
  target.replaceChildren();
  const next = L.nextRung(group.rungs, score);
  if (!next) {
    target.textContent = `You're above every rung for ${experience} lifters. Try the next group up.`;
    return;
  }
  const kg = L.totalForDots(sex, bw, next.dots) - L.totalForDots(sex, bw, score);
  target.append(
    el("strong", null, `Next rung: ${rungLabel(next).toLowerCase()} of ${experience} lifters, at ${next.dots}`),
    el("span", null, `${(next.dots - score).toFixed(1)} to go, about ${Math.ceil(kg * 2) / 2} kg more on your total.`),
  );
}

function renderLadder(group, points, score) {
  const items = [
    ...group.rungs.map((r) => ({ ...r, label: rungLabel(r), kind: "rung" })),
    ...points,
  ].sort((x, y) => y.dots - x.dots || (x.kind === "rung") - (y.kind === "rung"));

  const ladder = $("ladder");
  ladder.replaceChildren(
    ...items.map((item) => {
      const reached = item.kind === "rung" && score >= item.dots;
      const li = el("li", `step ${item.kind}${reached ? " reached" : ""}`);
      const shown = item.kind === "rung" ? String(item.dots) : item.kind === "reference" ? `~${item.dots}` : item.dots.toFixed(1);
      const label = el("span", "step-label", item.label);
      if (reached) label.append(el("span", "visually-hidden", " (reached)"));
      li.append(label, el("span", "step-dots", shown));
      return li;
    }),
  );
}

/** Redraws everything except the form, for the current profile and experience tab. */
function render(rungsData, state) {
  const { profile, experience } = state;
  const wclass = L.effectiveClass(profile);
  const score = renderNow(profile);
  const group = L.rungsFor(rungsData, profile.sex, wclass, experience);
  const tabs = $("experience");

  tabs.replaceChildren(
    ...L.EXPERIENCE.map((name) => {
      const button = el("button", "tab", name);
      button.type = "button";
      button.setAttribute("aria-pressed", name === experience);
      button.addEventListener("click", () => render(rungsData, Object.assign(state, { experience: name })));
      return button;
    }),
  );

  // The one place the page says who the numbers are for: the sex symbol, then equipment, class and bodyweight.
  // The symbol is hidden from screen readers, so the text carries "Men" or "Women" for them.
  const chosen = profile.weightClass ? " (chosen)" : "";
  $("sex-icon").setAttribute("href", profile.sex === "M" ? "#icon-male" : "#icon-female");
  $("now-context").replaceChildren(
    el("span", "visually-hidden", `${profile.sex === "M" ? "Men" : "Women"}, `),
    `${EQUIPMENT}, ${wclass} kg class${chosen}, ${profile.bodyweight} kg bodyweight`,
  );

  refreshEvents(state, group, experience);
  if (!group) {
    $("group-note").textContent = `Not enough ${experience} lifters in the ${wclass} kg class to publish rungs.`;
    $("ladder").replaceChildren();
    $("next-rung").textContent = "";
    return;
  }
  $("group-note").textContent = `${group.lifters} lifters in this group.`;
  renderNext(profile, score, group, experience);
  renderLadder(group, markers(state), score);
}

/** localStorage, or null where the browser blocks it; the ladder.js helpers treat null as "nothing saved". */
function deviceStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function fillForm(form, profile) {
  for (const name of ["sex", "bodyweight", ...L.LIFTS]) form.elements[name].value = profile[name];
  fillClassSelect(form, profile);
}

/** Rebuilds the class dropdown for the sex; its "auto" option shows the class the bodyweight gives. */
function fillClassSelect(form, profile) {
  const auto = L.weightClass(profile.sex, profile.bodyweight);
  form.elements.weightClass.replaceChildren(
    new Option(`Auto (${auto} kg)`, ""),
    ...L.weightClasses(profile.sex).map((c) => new Option(`${c} kg`, c)),
  );
  form.elements.weightClass.value = profile.weightClass ?? "";
  renderClassNote(profile);
}

function renderClassNote(profile) {
  const limit = L.overClassLimit(profile);
  $("class-note").textContent = limit
    ? `To lift in this class you'd need to weigh in at ${limit} kg or under (you're ${profile.bodyweight} kg).`
    : profile.weightClass
      ? `Comparing against the ${profile.weightClass} kg class.`
      : "Worked out from your bodyweight. Pick a class to compare against a different one.";
}

const FIELD_TEXT = {
  sex: "Choose men or women.",
  bodyweight: `Bodyweight must be ${L.LIMITS.bodyweight.join("–")} kg.`,
  ...Object.fromEntries(L.LIFTS.map((lift) => [lift, `${lift[0].toUpperCase()}${lift.slice(1)} must be ${L.LIMITS.lift.join("–")} kg.`])),
};

/** Flags the Current DOTS card while the form holds values that aren't used, so a stale score is never shown as current. */
function renderStale(invalid) {
  const warning = $("now-warning");
  warning.hidden = invalid.length === 0;
  warning.textContent = "Not updated: fix the highlighted values in Your numbers. This is your last saved DOTS.";
  $("now-dots").classList.toggle("stale", invalid.length > 0);
}

/** Onboarding (nothing saved yet) or the scoreboard with Your numbers and Your events. */
function showOnboarding(on) {
  $("onboarding").hidden = !on;
  for (const id of ["standing", "numbers-panel", "events-panel"]) $(id).hidden = on;
}

/** The first-visit form: the button stays disabled until all five values are valid, and only entered values are flagged. */
function setupOnboarding(state, storage, onDone) {
  const form = $("onboarding");
  const button = form.querySelector('button[type="submit"]');
  const read = () => ({
    sex: form.elements.sex.value,
    bodyweight: form.elements.bodyweight.valueAsNumber,
    ...Object.fromEntries(L.LIFTS.map((lift) => [lift, form.elements[lift].valueAsNumber])),
    weightClass: null,
  });

  form.addEventListener("input", () => {
    const raw = read();
    $("onboard-note").textContent = L.enteredProblems(raw).map((name) => FIELD_TEXT[name]).join(" ");
    button.disabled = !L.validProfile(raw);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const profile = L.validProfile(read());
    if (!profile) return;
    state.profile = profile;
    onDone(L.saveProfile(storage, profile));
  });
}

function setupForm(rungsData, state, storage, onCleared) {
  const form = $("profile-form");
  const saved = (ok) => {
    $("save-note").textContent = ok ? "Saved on this device only." : "Couldn't save on this device; changes last until you close the page.";
  };
  let invalid = [];
  for (const name of ["bodyweight", ...L.LIFTS]) form.elements[name].placeholder = "kg";

  form.addEventListener("input", (event) => {
    const f = form.elements;
    // Classes differ by sex, so a sex change goes back to working the class out from bodyweight.
    if (event.target === f.sex) f.weightClass.value = "";
    const raw = {
      sex: f.sex.value,
      bodyweight: f.bodyweight.valueAsNumber,
      ...Object.fromEntries(L.LIFTS.map((lift) => [lift, f[lift].valueAsNumber])),
      weightClass: f.weightClass.value || null,
    };
    invalid = L.invalidFields(raw);
    renderStale(invalid);
    if (invalid.length) {
      $("save-note").textContent = `Not saved: ${invalid.map((name) => FIELD_TEXT[name]).join(" ")}`;
      return;
    }
    const profile = L.validProfile(raw);
    state.profile = profile;
    // Only the dropdown is refilled: rewriting an input while it's being typed in would eat a trailing "." or "0".
    fillClassSelect(form, profile);
    saved(L.saveProfile(storage, profile));
    render(rungsData, state);
  });

  // Closing the card with invalid values puts the saved numbers back, so the closed card never hides a mismatch.
  form.closest("details").addEventListener("toggle", (event) => {
    if (event.target.open || !invalid.length) return;
    invalid = [];
    renderStale(invalid);
    fillForm(form, state.profile);
    $("save-note").textContent = "Invalid changes were undone; showing your saved numbers.";
  });

  // Clearing goes back to the first-visit form; there are no default numbers to fall back to.
  $("reset").addEventListener("click", () => {
    if (!window.confirm("Clear your numbers from this phone? You'll be asked for them again.")) return;
    try {
      storage?.removeItem(L.PROFILE_KEY);
    } catch {
      // Nothing saved to clear.
    }
    state.profile = null;
    invalid = [];
    renderStale(invalid);
    $("save-note").textContent = "";
    form.closest("details").open = false;
    onCleared();
  });
}

try {
  const rungsData = await loadJson("data/rungs.json");
  const storage = deviceStorage();
  const thisMonth = L.monthOf(new Date());
  // New visitors start blank: no saved numbers means the onboarding form, and events start empty.
  const state = { profile: L.loadProfile(storage, null), events: L.loadEvents(storage, []), thisMonth, experience: L.EXPERIENCE[0] };
  if (rungsData.snapshot) $("snapshot").textContent = `, snapshot ${fmtDate(rungsData.snapshot)}`;

  const showStanding = () => {
    fillForm($("profile-form"), state.profile);
    showOnboarding(false);
    render(rungsData, state);
  };
  const askForNumbers = () => {
    $("onboarding").reset();
    $("onboarding").querySelector('button[type="submit"]').disabled = true;
    $("onboard-note").textContent = "";
    showOnboarding(true);
  };

  setupOnboarding(state, storage, (saved) => {
    showStanding();
    $("save-note").textContent = saved ? "" : "Couldn't save on this device; your numbers last until you close the page.";
  });
  setupForm(rungsData, state, storage, askForNumbers);
  setupEvents({ state, storage, thisMonth, onChange: () => render(rungsData, state) });
  if (state.profile) showStanding();
  else askForNumbers();
} catch (error) {
  $("error").hidden = false;
  $("error").textContent = `Couldn't load the data (${error.message}). If you opened the file directly, serve the folder instead: python3 -m http.server`;
  $("now-context").textContent = "";
}
