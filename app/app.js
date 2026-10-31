// Page wiring: loads the rungs, starts the store, routes between the four screens, and renders the Ladder.
// Every screen reads derive.js and changes things only through the store; one subscriber refreshes the screen
// that's showing after each change.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import * as store from "./store.js";
import { derived } from "./derive.js";
import { $, choiceGroup, el, formulaChoice, replay, setNumber } from "./dom.js";
import { eventLabel, refreshEvents, setupEvents } from "./events.js";
import { FIELD_TEXT, openLog, refreshLog, setupLog } from "./log.js";
import { openMeet, refreshMeet, setupMeet } from "./meet.js";
import { toast } from "./popup.js";
import { openProgress, refreshProgress, setupProgress } from "./progress.js";

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
function markers(d) {
  const { profile } = d;
  const reference = L.referenceMarker(profile.sex, profile.formula);
  const list = [{ kind: "you", label: "You", score: d.score }, ...(reference ? [{ kind: "reference", ...reference }] : [])];
  for (const event of d.ladderEvents) {
    const scores = d.eventScores(event.id);
    for (const { scenario, score } of scores) {
      list.push({ kind: "event", label: eventLabel(event), scenario: scores.length > 1 ? scenario : null, score });
    }
  }
  return list;
}

/** "Meet in N days" for the soonest event with an exact date, today or later; hidden without one. */
function renderMeetPill(d) {
  const next = d.nextMeet;
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

function renderHero(profile, points, rungs) {
  setNumber($("now-score"), S.formatScore(profile.formula, points));
  $("now-unit").textContent = `your ${S.FORMULAS[profile.formula].label}`;
  $("now-caption").textContent = [`${L.sumLifts(profile)} kg total`, `${profile.bodyweight} kg bodyweight`, L.rungPosition(rungs, points)]
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

/** What a kilo of bodyweight is worth on the bar at your total and bodyweight, in the chosen formula and the other. */
function renderExchange(d) {
  const { profile, exchange: rate } = d;
  const { formula } = profile;
  const unit = S.FORMULAS[formula].label;
  const kg = (n) => `${n.toFixed(1)} kg`;
  $("exchange-for").textContent = `At ${profile.bodyweight} kg · ${unit}`;
  // At the formula's limits a lighter bodyweight scores nothing extra, so only the bar's row is left.
  const swaps = rate.kgOnBarPerKgBw != null;
  $("exchange-swap").hidden = !swaps;
  if (swaps) $("exchange-bar").textContent = `+${kg(rate.kgOnBarPerKgBw)}`;
  const rows = [
    ...(swaps ? [["−1 kg bodyweight", `+${S.formatScore(formula, rate.perKgBw)} ${unit}`]] : []),
    ["+2.5 kg on any lift", `+${S.formatScore(formula, rate.perBarStep)} ${unit}`],
    ...(rate.otherKgOnBar != null ? [[`Same swap in ${S.FORMULAS[rate.other].label}`, `1 kg ≈ ${kg(rate.otherKgOnBar)}`]] : []),
  ];
  $("exchange-rows").replaceChildren(
    ...rows.map(([what, worth]) => {
      const li = el("li");
      li.append(el("span", "", what), el("span", "", worth));
      return li;
    }),
  );
  // Name the formula that rewards a cut more, when the two differ by half a kilo or more on the bar.
  const gap = swaps && rate.otherKgOnBar != null ? rate.kgOnBarPerKgBw - rate.otherKgOnBar : 0;
  const [more, less] = gap > 0 ? [unit, S.FORMULAS[rate.other].label] : [S.FORMULAS[rate.other].label, unit];
  $("exchange-note").textContent = !swaps
    ? `At ${profile.bodyweight} kg, ${unit} doesn't score a lighter bodyweight any higher, so only the bar counts.`
    : `${Math.abs(gap) >= 0.5 ? `At your size, a kilo off is worth more in ${more} than in ${less}. ` : ""}Rates change as your total and bodyweight change.`;
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
function render() {
  const d = derived(store.getState());
  const { profile, experience, group } = d;
  const { formula } = profile;
  const wclass = L.effectiveClass(profile);
  const points = d.score;
  const rows = L.ladderRows(group?.rungs ?? [], points, markers(d));
  // Rungs built before this formula was added have none of its percentiles; say so rather than show nothing.
  const missing = d.rungsData.rungs.some((r) => r[formula]) ? "" : `${S.FORMULAS[formula].label} rungs coming soon.`;

  // Both choices go through the store, and its subscriber redraws.
  formulaChoice($("formula"), formula, (id) => store.update((s) => ({ settings: { ...s.settings, formula: id } })));
  choiceGroup($("experience"), "tab", L.EXPERIENCE.map((name) => [name, name]), experience, (name) =>
    store.update((s) => ({ session: { ...s.session, experience: name } })),
  );

  // The class chip says who you're compared with; the symbol is hidden, so the label carries "Men" or "Women".
  const sexWord = profile.sex === "M" ? "Men" : "Women";
  $("sex-icon").setAttribute("href", profile.sex === "M" ? "#icon-male" : "#icon-female");
  $("class-chip-text").textContent = `${sexWord} ${wclass} kg`;
  $("class-chip").setAttribute("aria-label", `${sexWord}, ${wclass} kg class${profile.weightClass ? " (chosen)" : ""}. Change weight class`);

  refreshEvents(d);
  $("group-note").textContent = missing
    ? missing
    : group
      ? `${group.lifters} lifters in this group.`
      : `Not enough ${experience} lifters in the ${wclass} kg class to publish rungs.`;
  renderHero(profile, points, group?.rungs ?? []);
  renderMeetPill(d);
  renderNext(profile, points, group, missing);
  renderExchange(d);
  $("ladder").replaceChildren(...rows.map((row) => renderRow(row, profile)));
}

let shownScreen = null;

/**
 * Shows one screen; switching to another fades it in (not on first load). With nothing saved, only the Ladder's
 * first-visit form is reachable, and the tab bar stays hidden.
 */
function showScreen(screen) {
  if (shownScreen) $("tabbar").classList.add("animate"); // the tab icons cross-fade, but not on first load
  for (const name of L.ROUTES) $(`screen-${name}`).hidden = name !== screen;
  if (shownScreen && shownScreen !== screen) replay($(`screen-${screen}`), "enter");
  shownScreen = screen;
  for (const tab of $("tabbar").querySelectorAll("a")) {
    if (tab.dataset.route === screen) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  window.scrollTo(0, 0);
}

/** The first-visit form: the button stays disabled until all five values are valid, and only entered values are flagged. */
function setupOnboarding() {
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

  // The first numbers are the first record in the history, dated today; the store's subscriber leaves this form.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const profile = L.validProfile(read());
    if (!profile) return;
    store.update((s) => ({ entries: [L.testFrom(profile, s.session.today, L.newId("test"))] }));
  });
}

try {
  const rungsData = await loadJson("data/rungs.json");
  // New visitors start blank: no records means the first-visit form, and events and records start empty. A
  // version 1 save is migrated once, as the store starts.
  store.start({
    rungs: rungsData,
    today: L.dayOf(new Date()),
    thisMonth: L.monthOf(new Date()),
    experience: L.EXPERIENCE[0],
  });
  if (rungsData.snapshot) $("snapshot").textContent = `, snapshot ${fmtDate(rungsData.snapshot)}`;
  const hasNumbers = () => Boolean(derived(store.getState()).profile);

  // Routing: "#/ladder" (default), "#/log", "#/progress" and "#/meet". Without saved numbers, everything is the first-visit form.
  const route = () => {
    const numbers = hasNumbers();
    $("onboarding").hidden = numbers;
    $("standing").hidden = !numbers;
    $("tabbar").hidden = !numbers;
    const screen = numbers ? L.routeFrom(location.hash) : "ladder";
    showScreen(screen);
    if (!numbers) return;
    if (screen === "log") openLog({ focusClass: location.hash.endsWith("?class") });
    else render();
    if (screen === "progress") openProgress();
    if (screen === "meet") openMeet();
  };

  // After every change: gaining or losing your numbers re-routes (into or out of the first-visit form); otherwise
  // the Ladder redraws (the events panel is on it) and the open screen refreshes in place, keeping what's typed.
  store.subscribe(() => {
    if (hasNumbers() === $("onboarding").hidden) {
      render();
      const screen = L.routeFrom(location.hash);
      if (screen === "log") refreshLog();
      if (screen === "progress") refreshProgress();
      if (screen === "meet") refreshMeet();
      return;
    }
    if (!hasNumbers()) {
      $("onboarding").reset();
      $("onboarding").querySelector('button[type="submit"]').disabled = true;
      $("onboard-note").textContent = "";
    }
    if (location.hash !== "#/ladder") location.hash = "#/ladder";
    else route();
  });

  setupOnboarding();
  // After a save: the Ladder, a toast of what it achieved (a PR, a rung cleared) and the score fading in.
  setupLog({
    onSaved: (before, id) => {
      const d = derived(store.getState());
      const outcome = L.savedText(L.saveOutcome({ before, after: d, rungs: d.group?.rungs ?? [], prLifts: d.prs.get(id) ?? [] }));
      location.hash = "#/ladder";
      toast(outcome);
      if (before.score !== d.score) replay($("now-score"), "swap");
    },
  });
  setupEvents();
  setupProgress();
  setupMeet();
  window.addEventListener("hashchange", route);
  route();
} catch (error) {
  $("error").hidden = false;
  $("error").textContent = `Couldn't load the data (${error.message}). If you opened the file directly, serve the folder instead: python3 -m http.server`;
  $("now-caption").textContent = "";
}
