// Page wiring: loads the rungs, routes between the three screens, and renders the Ladder with the pure logic in ladder.js.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import { $, el, formulaButtons } from "./dom.js";
import { eventLabel, refreshEvents, setupEvents } from "./events.js";
import { FIELD_TEXT, openLog, setupLog } from "./log.js";

const fmtDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// "+22.1" or "−77.9" (a real minus sign), for gaps from your score, at the formula's precision.
const signed = (n, formula) => `${n >= 0 ? "+" : "−"}${S.formatScore(formula, Math.abs(n))}`;

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

/** Rows to place among the rungs: you, the gym-goer estimate (DOTS only), and each upcoming event's scenarios (named only when there are two). */
function markers(state, points) {
  const { profile, events, thisMonth } = state;
  const reference = L.referenceMarker(profile.sex, profile.formula);
  const list = [{ kind: "you", label: "You", score: points }, ...(reference ? [{ kind: "reference", ...reference }] : [])];
  for (const event of L.ladderEvents(events, thisMonth)) {
    const scores = L.eventScores(event, profile.sex, profile.formula);
    for (const { scenario, score } of scores) {
      list.push({ kind: "event", label: eventLabel(event), scenario: scores.length > 1 ? scenario : null, score });
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

/** "Meet in N days" for the soonest event with an exact date, today or later; hidden without one. */
function renderMeetPill(state) {
  const next = L.nextMeet(state.events, state.today);
  $("meet-pill").hidden = !next;
  if (!next) return;
  const { days, event } = next;
  $("meet-pill").textContent = days === 0 ? "Meet today" : `Meet in ${days} day${days === 1 ? "" : "s"}`;
  $("meet-pill").title = eventLabel(event);
}

const SCENARIO_SHORT = { conservative: "cons.", optimistic: "opt." };

/** " (conservative)", shortened to " (cons.)" on narrow screens; the stylesheet picks, and screen readers get the full word. */
function scenarioWords(scenario) {
  const words = el("span", "scenario-name");
  const short = el("span", "scenario-short", SCENARIO_SHORT[scenario]);
  short.setAttribute("aria-hidden", "true");
  words.append(" (", el("span", "scenario-full", scenario), short, ")");
  return words;
}

function renderHero(profile, points, rows) {
  $("now-score").textContent = S.formatScore(profile.formula, points);
  $("now-unit").textContent = `your ${S.FORMULAS[profile.formula].label}`;
  $("now-caption").textContent = [`${L.sumLifts(profile)} kg total`, `${profile.bodyweight} kg bodyweight`, position(rows)]
    .filter(Boolean)
    .join(" · ");
}

function renderNext(profile, points, group, missing) {
  const { formula } = profile;
  const next = group && L.nextRung(group.rungs, points);
  const kg = next && S.kgToNextRung(formula, { total: L.sumLifts(profile), bw: profile.bodyweight, sex: profile.sex }, next.score);
  $("next-label").textContent = next ? `Next rung · P${next.percentile}` : "Next rung";
  $("next-value").textContent = missing
    ? missing
    : !group
      ? "Not enough lifters in this group to publish rungs."
      : next
        ? `+${S.formatScore(formula, next.score - points)} ${S.FORMULAS[formula].label} ≈ +${kg} kg on your total`
        : "Top rung reached";
}

function renderRow(row, profile) {
  const { formula } = profile;
  const unit = S.FORMULAS[formula].label;
  const li = el("li", `row row-${row.kind}${row.state ? ` row-${row.state}` : ""}`);
  const key = el("span", "row-key");
  const main = el("span", "row-main");
  const end = el("span", "row-end");

  if (row.kind === "rung") {
    key.textContent = `P${row.percentile}`;
    const title = row.state === "next" ? "Next rung" : row.state === "cleared" ? "Cleared" : L.RUNG_NAMES[row.percentile];
    main.append(el("span", "row-title", title), el("span", "row-sub", `${S.formatRung(formula, row.score)} ${unit}`));
    if (row.state === "cleared") end.append(icon("icon-check", "Cleared"));
    else end.textContent = signed(row.gap, formula);
  } else if (row.kind === "you") {
    key.textContent = "You";
    main.append(
      el("span", "row-title", `${S.formatScore(formula, row.score)} ${unit}`),
      el("span", "row-sub", `${L.sumLifts(profile)} kg @ ${profile.bodyweight} kg`),
    );
    end.append(icon("icon-person"));
  } else if (row.kind === "event") {
    key.append(icon("icon-flag"));
    const title = el("span", "row-title", row.label);
    if (row.scenario) title.append(scenarioWords(row.scenario));
    main.append(title, el("span", "row-sub", `${S.formatScore(formula, row.score)} ${unit}`));
    end.textContent = signed(row.gap, formula);
  } else {
    key.textContent = "≈";
    main.append(el("span", "row-title", row.label), el("span", "row-sub", `~${row.score} ${unit}`));
    end.textContent = signed(row.gap, formula);
  }
  li.append(key, main, end);
  return li;
}

/** Redraws the Ladder for the current profile, formula and experience group. */
function render(rungsData, state, storage) {
  const { profile, experience } = state;
  const { formula } = profile;
  const wclass = L.effectiveClass(profile);
  const points = L.profileScore(profile);
  const group = L.rungsFor(rungsData, formula, profile.sex, wclass, experience);
  const rows = L.ladderRows(group?.rungs ?? [], points, markers(state, points));
  // Rungs built before this formula was added have none of its percentiles; say so rather than show nothing.
  const missing = rungsData.rungs.some((r) => r[formula]) ? "" : `${S.FORMULAS[formula].label} rungs coming soon.`;

  $("formula").replaceChildren(
    ...formulaButtons(formula, (id) => {
      state.profile = { ...profile, formula: id };
      L.saveProfile(storage, state.profile);
      render(rungsData, state, storage);
    }),
  );

  $("experience").replaceChildren(
    ...L.EXPERIENCE.map((name) => {
      const button = el("button", "tab", name);
      button.type = "button";
      button.setAttribute("aria-pressed", name === experience);
      button.addEventListener("click", () => render(rungsData, Object.assign(state, { experience: name }), storage));
      return button;
    }),
  );

  // The class chip says who you're compared with; the symbol is hidden, so the label carries "Men" or "Women".
  const sexWord = profile.sex === "M" ? "Men" : "Women";
  $("sex-icon").setAttribute("href", profile.sex === "M" ? "#icon-male" : "#icon-female");
  $("class-chip-text").textContent = `${sexWord} ${wclass} kg`;
  $("class-chip").setAttribute("aria-label", `${sexWord}, ${wclass} kg class${profile.weightClass ? " (chosen)" : ""}. Change weight class`);

  refreshEvents(state, group, experience);
  $("group-note").textContent = missing
    ? missing
    : group
      ? `${group.lifters} lifters in this group.`
      : `Not enough ${experience} lifters in the ${wclass} kg class to publish rungs.`;
  renderHero(profile, points, rows);
  renderMeetPill(state);
  renderNext(profile, points, group, missing);
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

  // The first numbers are the first test in the history, dated today.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const profile = L.validProfile(read());
    if (!profile) return;
    state.profile = profile;
    state.tests = [L.testFrom(profile, state.today, L.newId("test"))];
    onDone(L.saveProfile(storage, profile) && L.saveTests(storage, state.tests));
  });
}

try {
  const rungsData = await loadJson("data/rungs.json");
  const storage = deviceStorage();
  const thisMonth = L.monthOf(new Date());
  const today = L.dayOf(new Date());
  // New visitors start blank: no saved numbers means the onboarding form, and events and tests start empty.
  const saved = L.loadProfile(storage, null);
  const tests = L.loadTests(storage, saved, today, []);
  // Numbers saved before the history existed become its first test; saving now keeps that test's date.
  if (saved && tests.length) L.saveTests(storage, tests);
  const state = {
    profile: saved && L.withLatestTest(saved, tests),
    tests,
    events: L.loadEvents(storage, []),
    thisMonth,
    today,
    experience: L.EXPERIENCE[0],
  };
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
    else render(rungsData, state, storage);
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
  setupEvents({ state, storage, thisMonth, onChange: () => render(rungsData, state, storage) });
  window.addEventListener("hashchange", route);
  route();
} catch (error) {
  $("error").hidden = false;
  $("error").textContent = `Couldn't load the data (${error.message}). If you opened the file directly, serve the folder instead: python3 -m http.server`;
  $("now-caption").textContent = "";
}
