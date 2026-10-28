// Page wiring: loads the rungs, routes between the three screens, and renders the Ladder with the pure logic in ladder.js.
import * as L from "./ladder.js";
import { $, el } from "./dom.js";
import { eventLabel, refreshEvents, setupEvents } from "./events.js";
import { FIELD_TEXT, openLog, setupLog } from "./log.js";

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

/** Shows one screen. With nothing saved, only the Ladder's first-visit form is reachable, and the tab bar stays hidden. */
function showScreen(screen) {
  for (const name of L.ROUTES) $(`screen-${name}`).hidden = name !== screen;
  for (const tab of $("tabbar").querySelectorAll("a")) {
    if (tab.dataset.route === screen) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  window.scrollTo(0, 0);
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

try {
  const rungsData = await loadJson("data/rungs.json");
  const storage = deviceStorage();
  const thisMonth = L.monthOf(new Date());
  // New visitors start blank: no saved numbers means the onboarding form, and events start empty.
  const state = { profile: L.loadProfile(storage, null), events: L.loadEvents(storage, []), thisMonth, experience: L.EXPERIENCE[0] };
  if (rungsData.snapshot) $("snapshot").textContent = `, snapshot ${fmtDate(rungsData.snapshot)}`;

  // Routing: "#/ladder" (default), "#/log" and "#/progress". Without saved numbers, everything is the first-visit form.
  const route = () => {
    const hasNumbers = Boolean(state.profile);
    $("onboarding").hidden = hasNumbers;
    $("standing").hidden = !hasNumbers;
    $("tabbar").hidden = !hasNumbers;
    const screen = hasNumbers ? L.routeFrom(location.hash) : "ladder";
    showScreen(screen);
    if (!hasNumbers) return;
    if (screen === "log") openLog({ focusClass: location.hash.endsWith("?class") });
    else render(rungsData, state);
  };
  const askForNumbers = () => {
    $("onboarding").reset();
    $("onboarding").querySelector('button[type="submit"]').disabled = true;
    $("onboard-note").textContent = "";
    if (location.hash !== "#/ladder") location.hash = "#/ladder";
    else route();
  };

  setupOnboarding(state, storage, () => {
    if (location.hash !== "#/ladder") location.hash = "#/ladder";
    else route();
  });
  setupLog({ rungsData, state, storage, onSaved: () => { location.hash = "#/ladder"; }, onCleared: askForNumbers });
  setupEvents({ state, storage, thisMonth, onChange: () => render(rungsData, state) });
  window.addEventListener("hashchange", route);
  route();
} catch (error) {
  $("error").hidden = false;
  $("error").textContent = `Couldn't load the data (${error.message}). If you opened the file directly, serve the folder instead: python3 -m http.server`;
  $("now-caption").textContent = "";
}
