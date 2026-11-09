// Page wiring: loads the rungs, starts the store, routes between the four screens, and renders the Ladder.
// Every screen reads derive.js and changes things only through the store; one subscriber refreshes the screen
// that's showing after each change.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import * as store from "./store.js";
import { derived } from "./derive.js";
import { $, choiceGroup, el, formulaChoice, replay, setNumber } from "./dom.js";
import { renderCalculator, setupCalculator } from "./calculator.js";
import { eventLabel, refreshEvents, setupEvents } from "./events.js";
import { openLog, refreshLog, setupLog } from "./log.js";
import { resetOnboarding, screenFrom, setupOnboarding, show as showFirstVisit } from "./onboarding.js";
import { openMeet, refreshMeet, setupMeet } from "./meet.js";
import { toast } from "./popup.js";
import { openProgress, refreshProgress, setupProgress } from "./progress.js";
import { track } from "./track.js";
import { setupYourData } from "./yourdata.js";

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

/** "Meet in N days" for your next event when it has an exact date; hidden without one. */
function renderMeetPill(d) {
  const next = d.nextMeet;
  $("meet-pill").hidden = next?.days == null;
  if (next?.days == null) return;
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
  $("now-caption").textContent = [`${L.sumLifts(profile)} kg total`, `${profile.bodyweight} kg bodyweight`, L.plainPosition(rungs, points)]
    .filter(Boolean)
    .join(" · ");
}

function renderNext(profile, points, group, missing) {
  const { formula } = profile;
  const next = group && L.nextRung(group.rungs, points);
  const kg = next && S.kgToNextRung(formula, { total: L.sumLifts(profile), bw: profile.bodyweight, sex: profile.sex }, next.score);
  $("next-label").textContent = next ? `Next rung · ${L.RUNG_NAMES[next.percentile].toLowerCase()}` : "Next rung";
  $("next-value").textContent = missing
    ? missing
    : !group
      ? "Not enough powerlifters in this group to publish rungs."
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

const SHORT = { squat: "SQ", bench: "BP", deadlift: "DL" };

/** A share-of-total bar: one segment per lift, labelled while there's room (the bar's label says it all anyway). */
function shareBar(bar, shares, who, { opportunity = [], short = true, minLabel = 15 } = {}) {
  const pct = (lift) => `${Math.round(shares[lift])}%`;
  bar.setAttribute("aria-label", `${who}: ${L.LIFTS.map((lift) => `${L.LIFT_NAMES[lift].toLowerCase()} ${pct(lift)}`).join(", ")}`);
  bar.replaceChildren(
    ...L.LIFTS.map((lift) => {
      const seg = el("span", `balance-seg ${lift}${opportunity.includes(lift) ? " opportunity" : ""}`);
      seg.style.flex = `${shares[lift]} 1 0`;
      if (shares[lift] >= minLabel) seg.textContent = short ? `${SHORT[lift]} ${pct(lift)}` : pct(lift);
      return seg;
    }),
  );
}

/** Lift balance: your split against the typical one, each lift among its own rungs, and what stands out. */
// The lift whose detail Lift balance shows: picked by tapping its row, kept for this visit only (null = the default).
let balanceLift = null;

function renderBalance(d, group) {
  const { shares, typical, rows, lines, hero, selected } = d.liftBalance;
  const opportunity = rows.filter((r) => r.opportunity).map((r) => r.lift);
  $("balance-against").textContent = `Your three lifts against UK powerlifters: ${group}.`;
  shareBar($("balance-you"), shares, "You", { opportunity });
  $("balance-typical-label").hidden = $("balance-typical").hidden = !typical;
  if (typical) shareBar($("balance-typical"), typical, "Typical", { short: false, minLabel: 9 });
  $("balance-for").textContent = typical
    ? `Typical: the middle powerlifter's split, from ${typical.lifters} UK powerlifters (OpenPowerlifting).${typical.scaled ? " Scaled to 100%." : ""}`
    : `No typical split for ${group} yet.`;

  // The lead gets the big number when there's one lift to point at; the other lines follow as a short list.
  $("balance-hero").hidden = !hero;
  if (hero) {
    $("balance-hero-title").textContent = hero.title;
    $("balance-hero-add").textContent = hero.add;
    $("balance-hero-caption").textContent = hero.caption;
    $("balance-hero-note").textContent = hero.note;
  }
  $("balance-lines").replaceChildren(...(hero ? lines.slice(1) : lines).map((line) => {
    const li = el("li");
    if (line.lead) li.append(el("strong", "", line.lead), " ");
    li.append(line.text);
    return li;
  }));
  $("balance-lines").hidden = !(hero ? lines.length - 1 : lines.length);

  // Only a lift with rungs can be opened; tapping the open one closes it ("none"), and a pick that no longer has
  // rungs falls back to the default (the lift with most room to grow).
  const pickable = rows.filter((r) => r.band);
  const shown = balanceLift === "none" ? null : pickable.find((r) => r.lift === balanceLift) ?? pickable.find((r) => r.lift === selected) ?? null;
  $("balance-rows").replaceChildren(
    ...rows.map((row) => {
      const open = row === shown;
      const button = el("button", "balance-row");
      button.type = "button";
      button.disabled = !row.band;
      button.setAttribute("aria-expanded", String(open));
      const name = el("span", "balance-name-kg");
      name.append(el("span", "balance-name", L.LIFT_NAMES[row.lift]), el("span", "balance-kg", `${row.kg} kg`));
      button.append(name, el("span", `balance-band${row.opportunity ? " opportunity" : ""}`, row.band || "No rungs"));
      if (row.band) button.append(chevron());
      button.addEventListener("click", () => {
        balanceLift = open ? "none" : row.lift;
        renderBalance(d, group);
        $("balance-rows").querySelectorAll("button")[rows.indexOf(row)].focus();
      });
      const li = el("li", open ? "open" : "");
      li.append(button);
      // The picked lift's detail opens right under its row.
      if (row === shown) {
        const detail = el("div", "balance-detail");
        detail.id = "balance-detail";
        button.setAttribute("aria-controls", detail.id);
        detail.append(...row.detail.map(balanceLine));
        if (row.steps.length) detail.append(stepsTable(row));
        li.append(detail);
      }
      return li;
    }),
  );
  $("balance-pick").hidden = !shown;
}

/** The chevron on a Lift balance row: down when closed, turned up when open (by CSS, from aria-expanded). */
function chevron() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "balance-chevron");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M6 8l4 4 4-4");
  svg.append(path);
  return svg;
}

/**
 * A lift's next steps as a table: the weight, where the lift would be, and what it does for your total. The
 * total's column names a step only when it changes, so the lift's step and the total's can't be confused.
 */
function stepsTable(row) {
  const table = el("table", "balance-steps");
  const caption = el("caption", "", "Its next steps, and what each does for your total");
  const head = el("thead");
  const headRow = el("tr");
  for (const [text, cls] of [[L.LIFT_NAMES[row.lift], ""], ["The lift", ""], ["Your total", "end"]]) {
    const th = el("th", cls, text);
    th.scope = "col";
    headRow.append(th);
  }
  head.append(headRow);
  const body = el("tbody");
  for (const step of row.steps) {
    const tr = el("tr");
    const kg = el("td");
    kg.append(el("strong", "", `${Number(step.kg.toFixed(1))} kg`), el("span", "balance-add", `+${Number(step.add.toFixed(1))}`));
    const total = el("td", "end");
    if (step.total) total.append(el("span", "balance-total-step", step.total));
    total.append(el("span", "muted", step.points));
    tr.append(kg, el("td", "", step.lift), total);
    body.append(tr);
  }
  table.append(caption, head, body);
  return table;
}

/** A line of Lift balance's text: an optional bold lead, then the rest. */
function balanceLine(line) {
  const p = el("p");
  if (line.lead) p.append(el("strong", "", line.lead), " ");
  p.append(line.text);
  return p;
}

function renderRow(row, profile) {
  const { formula } = profile;
  const unit = S.FORMULAS[formula].label;
  const li = el("li", `row row-${row.kind}${row.state ? ` row-${row.state}` : ""}`);
  const key = el("span", "row-key");
  const main = el("span", "row-main");
  const end = el("span", "row-end");

  if (row.kind === "rung") {
    // The rung keeps its name in every state (what reaching it means); its state is in the line under it and the end.
    key.textContent = String(row.percentile);
    key.setAttribute("aria-hidden", "true");
    const state = row.state === "next" ? " · your next rung" : row.state === "cleared" ? " · passed" : "";
    main.append(el("span", "row-title", L.RUNG_NAMES[row.percentile]), el("span", "row-sub", `${S.formatRung(formula, row.score)} ${unit}${state}`));
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
      ? `${group.lifters} UK powerlifters in this group.`
      : `Not enough powerlifters ${experience === L.EXPERIENCE[2] ? "with 3 or more meets" : `at their ${experience}`} in the ${wclass} kg class to publish rungs.`;
  renderHero(profile, points, group?.rungs ?? []);
  renderMeetPill(d);
  renderNext(profile, points, group, missing);
  renderCalculator(d);
  renderExchange(d);
  renderBalance(d, `${sexWord.toLowerCase()} ${wclass} kg, ${experience}`);
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
  document.querySelector("body > footer").hidden = false; // Meet hides it while locked
  if (shownScreen && shownScreen !== screen) replay($(`screen-${screen}`), "enter");
  shownScreen = screen;
  for (const tab of $("tabbar").querySelectorAll("a")) {
    if (tab.dataset.route === screen) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  window.scrollTo(0, 0);
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
  // The Ladder opens on the meet experience given on the first visit (its tabs change it for the visit only).
  const experience = store.getState().settings.experience;
  if (experience) store.update((s) => ({ session: { ...s.session, experience } }));
  if (rungsData.snapshot) $("snapshot").textContent = `, snapshot ${fmtDate(rungsData.snapshot)}`;
  const hasNumbers = () => Boolean(derived(store.getState()).profile);

  // Routing: "#/ladder" (default), "#/log", "#/progress" and "#/meet". Without saved numbers, everything is the
  // first visit, one screen per step ("#/start/bodyweight"), with no tab bar or footer to scroll past.
  const route = () => {
    const numbers = hasNumbers();
    $("onboarding").hidden = numbers;
    $("standing").hidden = !numbers;
    $("tabbar").hidden = !numbers;
    const screen = numbers ? L.routeFrom(location.hash) : "ladder";
    showScreen(screen);
    document.querySelector("body > footer").hidden = !numbers;
    if (!numbers) {
      showFirstVisit(screenFrom(location.hash));
      return;
    }
    track(`tab/${screen}`);
    if (screen === "log") openLog({ focusClass: location.hash.endsWith("?class") });
    else render();
    if (screen === "progress") openProgress();
    if (screen === "meet") openMeet();
  };

  // After every change: gaining or losing your numbers re-routes (into or out of the first-visit form); otherwise
  // the Ladder redraws (the events panel is on it) and the open screen refreshes in place, keeping what's typed.
  store.subscribe(() => {
    if (hasNumbers() === $("onboarding").hidden) {
      if (!hasNumbers()) return; // a first visit's answer: its screen updates itself
      render();
      const screen = L.routeFrom(location.hash);
      if (screen === "log") refreshLog();
      if (screen === "progress") refreshProgress();
      if (screen === "meet") refreshMeet();
      return;
    }
    if (!hasNumbers()) resetOnboarding();
    if (location.hash !== "#/ladder") location.hash = "#/ladder";
    else route();
  });

  setupOnboarding(rungsData);
  // After a save: the Ladder, a toast of what it achieved (a PR, a rung cleared) and the score fading in.
  setupLog({
    onSaved: (before, id) => {
      track("log/saved");
      const d = derived(store.getState());
      const outcome = L.savedText(L.saveOutcome({ before, after: d, rungs: d.group?.rungs ?? [], prLifts: d.prs.get(id) ?? [] }));
      location.hash = "#/ladder";
      toast(outcome);
      if (before.score !== d.score) replay($("now-score"), "swap");
    },
  });
  setupEvents();
  setupCalculator();
  setupProgress();
  setupYourData();
  setupMeet();
  window.addEventListener("hashchange", route);
  route();
} catch (error) {
  track("error/data-load");
  $("error").hidden = false;
  $("error").textContent = `Couldn't load the data (${error.message}). If you opened the file directly, serve the folder instead: python3 -m http.server`;
  $("now-caption").textContent = "";
}
