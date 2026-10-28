// Page wiring: loads the two data files, then renders with the pure logic in ladder.js.
import * as L from "./ladder.js";
import { $, el } from "./dom.js";
import { eventLabel, refreshEvents, setupEvents } from "./events.js";

const fmtDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// "+22.1" or "−77.9" (a real minus sign), for gaps from your score.
const signed = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

/** An inline icon from the sprite in index.html; decorative unless given a label. */
function icon(id, label) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${id}`);
  svg.append(use);
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  return svg;
}

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

/** Rows to place among the rungs: you, the gym-goer estimate, and each upcoming event's scenarios. */
function markers(state, score) {
  const { profile, events, thisMonth } = state;
  const list = [
    { kind: "you", label: "You", dots: score },
    { kind: "reference", ...L.referenceMarker(profile.sex) },
  ];
  for (const event of L.ladderEvents(events, thisMonth)) {
    const scores = L.eventScores(event, profile.sex);
    for (const { scenario, dots } of scores) {
      list.push({ kind: "event", label: eventLabel(event, scores.length > 1 ? scenario : null), dots });
    }
  }
  return list;
}

/** "between P10 and P25", "below P10" or "above P90", from the rungs' states. */
function position(rows) {
  const rungs = rows.filter((r) => r.kind === "rung");
  const cleared = rungs.find((r) => r.state === "cleared"); // rows are highest first
  const next = rungs.find((r) => r.state === "next");
  if (cleared && next) return `between P${cleared.percentile} and P${next.percentile}`;
  if (next) return `below P${next.percentile}`;
  return cleared ? `above P${cleared.percentile}` : "";
}

function renderHero(profile, score, rows) {
  $("now-dots").textContent = score.toFixed(1);
  $("now-caption").textContent = [`${L.sumLifts(profile)} kg total`, `${profile.bodyweight} kg bodyweight`, position(rows)]
    .filter(Boolean)
    .join(" · ");
}

function renderNext(profile, score, group) {
  const next = group && L.nextRung(group.rungs, score);
  $("next-label").textContent = next ? `Next rung · P${next.percentile}` : "Next rung";
  $("next-value").textContent = !group
    ? "Not enough lifters in this group to publish rungs."
    : next
      ? `+${(next.dots - score).toFixed(1)} DOTS ≈ +${L.kgToReach(profile.sex, profile.bodyweight, L.sumLifts(profile), next.dots)} kg on your total`
      : "Top rung reached";
}

function renderRow(row, profile) {
  const li = el("li", `row row-${row.kind}${row.state ? ` row-${row.state}` : ""}`);
  const key = el("span", "row-key");
  const main = el("span", "row-main");
  const end = el("span", "row-end");

  if (row.kind === "rung") {
    key.textContent = `P${row.percentile}`;
    const title = row.state === "next" ? "Next rung" : row.state === "cleared" ? "Cleared" : L.RUNG_NAMES[row.percentile];
    main.append(el("span", "row-title", title), el("span", "row-sub", `${row.dots} DOTS`));
    if (row.state === "cleared") end.append(icon("icon-check", "Cleared"));
    else end.textContent = signed(row.gap);
  } else if (row.kind === "you") {
    key.textContent = "You";
    main.append(
      el("span", "row-title", `${row.dots.toFixed(1)} DOTS`),
      el("span", "row-sub", `${L.sumLifts(profile)} kg @ ${profile.bodyweight} kg`),
    );
    end.append(icon("icon-person"));
  } else if (row.kind === "event") {
    key.append(icon("icon-flag"));
    main.append(el("span", "row-title", row.label), el("span", "row-sub", `${row.dots.toFixed(1)} DOTS`));
    end.textContent = signed(row.gap);
  } else {
    key.textContent = "≈";
    main.append(el("span", "row-title", row.label), el("span", "row-sub", `~${row.dots} DOTS`));
    end.textContent = signed(row.gap);
  }
  li.append(key, main, end);
  return li;
}

/** Redraws the Ladder for the current profile and experience group. */
function render(rungsData, state) {
  const { profile, experience } = state;
  const wclass = L.effectiveClass(profile);
  const score = L.dots(profile.sex, profile.bodyweight, L.sumLifts(profile));
  const group = L.rungsFor(rungsData, profile.sex, wclass, experience);
  const rows = L.ladderRows(group?.rungs ?? [], score, markers(state, score));

  $("experience").replaceChildren(
    ...L.EXPERIENCE.map((name) => {
      const button = el("button", "tab", name);
      button.type = "button";
      button.setAttribute("aria-pressed", name === experience);
      button.addEventListener("click", () => render(rungsData, Object.assign(state, { experience: name })));
      return button;
    }),
  );

  // The class chip says who you're compared with; the symbol is hidden, so the label carries "Men" or "Women".
  const sexWord = profile.sex === "M" ? "Men" : "Women";
  $("sex-icon").setAttribute("href", profile.sex === "M" ? "#icon-male" : "#icon-female");
  $("class-chip-text").textContent = `${sexWord} ${wclass} kg`;
  $("class-chip").setAttribute("aria-label", `${sexWord}, ${wclass} kg class${profile.weightClass ? " (chosen)" : ""}. Change weight class`);

  refreshEvents(state, group, experience);
  $("group-note").textContent = group
    ? `${group.lifters} lifters in this group.`
    : `Not enough ${experience} lifters in the ${wclass} kg class to publish rungs.`;
  renderHero(profile, score, rows);
  renderNext(profile, score, group);
  $("ladder").replaceChildren(...rows.map((row) => renderRow(row, profile)));
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
  $("class-chip").addEventListener("click", () => {
    const panel = $("numbers-panel");
    panel.open = true;
    panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    $("profile-form").elements.weightClass.focus({ preventScroll: true });
  });
  setupEvents({ state, storage, thisMonth, onChange: () => render(rungsData, state) });
  if (state.profile) showStanding();
  else askForNumbers();
} catch (error) {
  $("error").hidden = false;
  $("error").textContent = `Couldn't load the data (${error.message}). If you opened the file directly, serve the folder instead: python3 -m http.server`;
  $("now-caption").textContent = "";
}
