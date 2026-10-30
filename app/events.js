// "Your events" card: upcoming meets or test days with conservative and optimistic lifts.
// Logic lives in ladder.js; this file only builds and updates the card.
import * as L from "./ladder.js";
import * as store from "./store.js";
import { derived } from "./derive.js";
import * as S from "./scoring.js";
import { $, el } from "./dom.js";

const LIFT_NAMES = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const capital = (word) => word[0].toUpperCase() + word.slice(1);

export const fmtMonth = (yearMonth) =>
  new Date(`${yearMonth}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
export const fmtDay = (day) =>
  new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "Meet plan, Nov 2026", or "Meet plan, 14 Nov 2026" once the exact date is set. */
export function eventLabel(event) {
  return [event.name, event.date ? fmtDay(event.date) : fmtMonth(event.month)].filter(Boolean).join(", ");
}

function problemText(name) {
  if (name === "name") return `Keep the name to ${L.MAX_NAME} characters.`;
  if (name === "month") return "Pick a month.";
  if (name === "date") return "The exact date must be a real day.";
  if (name === "bodyweight") return `Bodyweight must be ${L.LIMITS.bodyweight.join("–")} kg.`;
  if (name === "scenarios") return "Fill in at least one scenario.";
  const [scenario, lift] = name.split(".");
  return `${capital(scenario)} ${LIFT_NAMES[lift].toLowerCase()} must be ${L.LIMITS.lift.join("–")} kg.`;
}

const now = () => derived(store.getState());

export function setupEvents() {
  $("add-event").addEventListener("click", addEvent);
  renderList();
}

/** Saves the events through the store (whose subscriber redraws the Ladder and this card); says if storage refused. */
function persist(events) {
  const { saved } = store.update(() => ({ events }));
  $("events-note").textContent = saved ? "" : "Couldn't save events on this device; changes last until you close the page.";
}

/** Rebuilds the list, soonest first. Only on add, delete and reset, so no field is rewritten while being typed in. */
function renderList(openId) {
  const events = [...now().events].sort((x, y) => x.month.localeCompare(y.month));
  $("event-list").replaceChildren(
    ...(events.length
      ? events.map((event) => eventItem(event, event.id === openId))
      : [el("p", "muted small", "Planning a meet or a 1RM test? Add it to see where your targets land on the ladder.")]),
  );
}

/** Puts the existing rows in date order. Moving them keeps whatever is typed in other open events. */
function sortList() {
  const list = $("event-list");
  const month = (item) => now().events.find((e) => e.id === item.dataset.id).month;
  const items = [...list.querySelectorAll("details.event")];
  const sorted = [...items].sort((x, y) => month(x).localeCompare(month(y)));
  if (sorted.some((item, i) => item !== items[i])) list.append(...sorted);
}

function numberInput(name, [min, max], placeholder) {
  const input = el("input");
  Object.assign(input, { name, type: "number", inputMode: "decimal", step: "any", min, max, placeholder });
  return input;
}

function labelled(text, input, className) {
  const label = el("label", className, text);
  label.append(input);
  return label;
}

function eventItem(event, open) {
  const item = el("details", "event");
  item.dataset.id = event.id;
  item.open = open;

  const summary = el("summary");
  summary.append(el("span", "event-title"), el("span", "event-score"));

  const form = el("form", "fields");
  form.autocomplete = "off";
  const name = Object.assign(el("input"), { name: "name", type: "text", maxLength: L.MAX_NAME, placeholder: "e.g. First meet" });
  const month = Object.assign(el("input"), { name: "month", type: "month", required: true });
  const date = Object.assign(el("input"), { name: "date", type: "date" });
  const bodyweight = numberInput("bodyweight", L.LIMITS.bodyweight, "kg");
  bodyweight.required = true;

  const scenarios = L.SCENARIOS.map((scenario) => {
    const fieldset = el("fieldset", "scenario wide");
    fieldset.append(el("legend", null, capital(scenario)));
    const trio = el("div", "trio");
    trio.append(...L.LIFTS.map((lift) => labelled(LIFT_NAMES[lift], numberInput(`${scenario}.${lift}`, L.LIMITS.lift, "kg"))));
    fieldset.append(trio);
    return fieldset;
  });

  const remove = el("button", "link-button wide", "Delete event");
  remove.type = "button";
  remove.addEventListener("click", () => deleteEvent(event.id));

  form.append(
    labelled("Name (optional)", name, "wide"),
    labelled("Month", month),
    labelled("Exact date (optional)", date),
    labelled("Bodyweight (kg)", bodyweight, "wide"),
    ...scenarios,
    el("p", "event-preview small wide"),
    el("p", "event-info muted small wide"),
    el("p", "event-note muted small wide"),
    remove,
  );
  form.querySelector(".event-note").setAttribute("role", "status");
  item.append(summary, form);
  fillEvent(form, event);

  form.addEventListener("input", (input) => onInput(item, form, input));
  // Closing an event puts it back in date order, and undoes invalid values as the edit form does.
  item.addEventListener("toggle", () => {
    if (item.open) return;
    if (item.dataset.invalid) {
      fillEvent(form, now().events.find((e) => e.id === item.dataset.id));
      form.querySelector(".event-note").textContent = "Invalid changes were undone.";
      refreshEvents(now());
    }
    sortList();
  });
  return item;
}

function fillEvent(form, event) {
  const f = form.elements;
  f.name.value = event.name;
  f.month.value = event.month;
  f.date.value = event.date ?? "";
  f.bodyweight.value = event.bodyweight;
  for (const scenario of L.SCENARIOS) {
    for (const lift of L.LIFTS) f[`${scenario}.${lift}`].value = event[scenario]?.[lift] ?? "";
  }
  for (const input of form.querySelectorAll("input")) input.setCustomValidity("");
  form.closest("details").dataset.invalid = "";
}

function readEvent(form, id) {
  const f = form.elements;
  return {
    id,
    name: f.name.value,
    month: f.month.value,
    date: f.date.value,
    bodyweight: f.bodyweight.valueAsNumber,
    ...Object.fromEntries(L.SCENARIOS.map((scenario) => [
      scenario,
      Object.fromEntries(L.LIFTS.map((lift) => [lift, f[`${scenario}.${lift}`].valueAsNumber])),
    ])),
  };
}

function onInput(item, form, input) {
  // The exact date decides the month, so the two can't disagree; changing the month clears a date outside it.
  const f = form.elements;
  if (input?.target === f.date && f.date.value) f.month.value = f.date.value.slice(0, 7);
  if (input?.target === f.month && f.date.value && !f.date.value.startsWith(`${f.month.value}-`)) f.date.value = "";
  const raw = readEvent(form, item.dataset.id);
  const problems = L.eventProblems(raw);
  // Custom validity drives the same :invalid highlight as the edit form. With no scenario, highlight the first one.
  for (const input of form.querySelectorAll("input")) {
    const flagged = problems.includes(input.name) || (problems.includes("scenarios") && input.name.startsWith(`${L.SCENARIOS[0]}.`));
    input.setCustomValidity(flagged ? problemText(input.name) : "");
  }
  item.dataset.invalid = problems.length ? "true" : "";
  if (problems.length) {
    form.querySelector(".event-note").textContent = `Not saved: ${problems.map(problemText).join(" ")}`;
    refreshEvents(now()); // nothing saved, so the store doesn't redraw: show "not saved" here
    return;
  }
  const event = L.validEvent(raw);
  persist(now().events.map((e) => (e.id === event.id ? event : e)));
  form.querySelector(".event-note").textContent = "Saved on this device only.";
}

function addEvent() {
  const { profile, thisMonth } = now();
  const event = {
    id: L.newId("event"),
    name: "",
    month: L.nextMonth(thisMonth),
    date: null,
    bodyweight: profile.bodyweight,
    conservative: Object.fromEntries(L.LIFTS.map((lift) => [lift, profile[lift]])),
    optimistic: null,
  };
  persist([...now().events, event]);
  renderList(event.id);
  refreshEvents(now());
  $("event-list").querySelector(`[data-id="${event.id}"] input[name="name"]`)?.focus();
}

function deleteEvent(id) {
  const event = now().events.find((e) => e.id === id);
  if (!window.confirm(`Delete "${eventLabel(event)}"?`)) return;
  persist(now().events.filter((e) => e.id !== id));
  renderList();
  refreshEvents(now());
}

/** Updates each event's title, scores and notes for the current profile, formula and ladder group, without touching its fields. */
export function refreshEvents(d) {
  const { profile, group, experience, thisMonth } = d;
  if (!profile) return;
  const { formula } = profile;
  const onLadder = new Set(d.ladderEvents.map((e) => e.id));
  for (const item of $("event-list").querySelectorAll("details.event")) {
    const event = d.events.find((e) => e.id === item.dataset.id);
    const scores = d.eventScores(event.id);
    item.querySelector(".event-title").textContent = eventLabel(event);
    // Two scores read as "276.0 to 293.0": a plain "to" keeps them apart in the condensed face.
    const values = scores.map((s) => el("span", null, S.formatScore(formula, s.score)));
    item.querySelector(".event-score").replaceChildren(
      ...(item.dataset.invalid ? ["not saved"] : values.flatMap((v, i) => (i ? [el("span", "to", " to "), v] : [v]))),
    );

    // While the fields hold invalid values, the saved scores would look current, so only the "Not saved" note shows.
    item.querySelector(".event-preview").replaceChildren(
      ...(item.dataset.invalid ? [] : scores).map(({ scenario, total, score }) => {
        const beaten = group && L.rungBeaten(group.rungs, score);
        const place = !group ? "" : beaten ? `, beats ${beaten.percentile}% of ${experience} lifters` : ", below every rung";
        return el("span", null, `${capital(scenario)}: ${total} kg total, ${S.formatScore(formula, score)} ${S.FORMULAS[formula].label}${place}`);
      }),
    );

    const notes = [];
    if (event.month < thisMonth) notes.push("This month has passed, so it's not on the ladder.");
    else if (!onLadder.has(event.id)) notes.push(`Only the next ${L.MAX_LADDER_EVENTS} events appear on the ladder.`);
    const wclass = L.eventClass(event, profile);
    if (wclass) notes.push(`At ${event.bodyweight} kg that's the ${wclass} kg class; your ladder shows ${L.effectiveClass(profile)} kg.`);
    item.querySelector(".event-info").textContent = notes.join(" ");
  }
}
