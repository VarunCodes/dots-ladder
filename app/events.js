// "Your events" card: upcoming meets or test days with conservative and optimistic lifts.
// Logic lives in ladder.js; this file only builds and updates the card.
import * as L from "./ladder.js";
import { $, el } from "./dom.js";

const LIFT_NAMES = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const capital = (word) => word[0].toUpperCase() + word.slice(1);

// Meets are stored to the month only ("YYYY-MM"), so the page never shows the day.
export const fmtMonth = (yearMonth) =>
  new Date(`${yearMonth}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

/** "Meet plan, Nov 2026", or "May 2027 (optimistic)" when the event has both scenarios. */
export function eventLabel(event, scenario) {
  const base = [event.name, fmtMonth(event.month)].filter(Boolean).join(", ");
  return scenario ? `${base} (${scenario})` : base;
}

function problemText(name) {
  if (name === "name") return `Keep the name to ${L.MAX_NAME} characters.`;
  if (name === "month") return "Pick a month.";
  if (name === "bodyweight") return `Bodyweight must be ${L.LIMITS.bodyweight.join("–")} kg.`;
  if (name === "scenarios") return "Fill in at least one scenario.";
  const [scenario, lift] = name.split(".");
  return `${capital(scenario)} ${LIFT_NAMES[lift].toLowerCase()} must be ${L.LIMITS.lift.join("–")} kg.`;
}

let ctx; // { state, storage, defaults, thisMonth, onChange }

export function setupEvents(context) {
  ctx = context;
  $("add-event").addEventListener("click", addEvent);
  $("events-reset").addEventListener("click", resetEvents);
  renderList();
}

function persist() {
  const ok = L.saveEvents(ctx.storage, ctx.state.events);
  $("events-note").textContent = ok ? "" : "Couldn't save events on this device; changes last until you close the page.";
}

/** Rebuilds the list, soonest first. Only on add, delete and reset, so no field is rewritten while being typed in. */
function renderList(openId) {
  const events = [...ctx.state.events].sort((x, y) => x.month.localeCompare(y.month));
  $("event-list").replaceChildren(
    ...(events.length
      ? events.map((event) => eventItem(event, event.id === openId))
      : [el("p", "muted small", "No events yet. Add a meet or test day to see it on the ladder.")]),
  );
}

/** Puts the existing rows in date order. Moving them keeps whatever is typed in other open events. */
function sortList() {
  const list = $("event-list");
  const month = (item) => ctx.state.events.find((e) => e.id === item.dataset.id).month;
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
  summary.append(el("span", "event-title"), el("span", "event-dots"));

  const form = el("form", "fields");
  form.autocomplete = "off";
  const name = Object.assign(el("input"), { name: "name", type: "text", maxLength: L.MAX_NAME, placeholder: "e.g. First meet" });
  const month = Object.assign(el("input"), { name: "month", type: "month", required: true });
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
    labelled("Bodyweight (kg)", bodyweight),
    ...scenarios,
    el("p", "event-preview small wide"),
    el("p", "event-info muted small wide"),
    el("p", "event-note muted small wide"),
    remove,
  );
  form.querySelector(".event-note").setAttribute("role", "status");
  item.append(summary, form);
  fillEvent(form, event);

  form.addEventListener("input", () => onInput(item, form));
  // Closing an event puts it back in date order, and undoes invalid values as the edit form does.
  item.addEventListener("toggle", () => {
    if (item.open) return;
    if (item.dataset.invalid) {
      fillEvent(form, ctx.state.events.find((e) => e.id === item.dataset.id));
      form.querySelector(".event-note").textContent = "Invalid changes were undone.";
      ctx.onChange();
    }
    sortList();
  });
  return item;
}

function fillEvent(form, event) {
  const f = form.elements;
  f.name.value = event.name;
  f.month.value = event.month;
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
    bodyweight: f.bodyweight.valueAsNumber,
    ...Object.fromEntries(L.SCENARIOS.map((scenario) => [
      scenario,
      Object.fromEntries(L.LIFTS.map((lift) => [lift, f[`${scenario}.${lift}`].valueAsNumber])),
    ])),
  };
}

function onInput(item, form) {
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
    ctx.onChange();
    return;
  }
  const event = L.validEvent(raw);
  ctx.state.events = ctx.state.events.map((e) => (e.id === event.id ? event : e));
  persist();
  form.querySelector(".event-note").textContent = "Saved on this device only.";
  ctx.onChange();
}

function addEvent() {
  const { profile } = ctx.state;
  const event = {
    id: globalThis.crypto?.randomUUID?.() ?? `event-${Date.now()}`,
    name: "",
    month: L.nextMonth(ctx.thisMonth),
    bodyweight: profile.bodyweight,
    conservative: Object.fromEntries(L.LIFTS.map((lift) => [lift, profile[lift]])),
    optimistic: null,
  };
  ctx.state.events = [...ctx.state.events, event];
  persist();
  renderList(event.id);
  ctx.onChange();
  $("event-list").querySelector(`[data-id="${event.id}"] input[name="name"]`)?.focus();
}

function deleteEvent(id) {
  const event = ctx.state.events.find((e) => e.id === id);
  if (!window.confirm(`Delete "${eventLabel(event)}"?`)) return;
  ctx.state.events = ctx.state.events.filter((e) => e.id !== id);
  persist();
  renderList();
  ctx.onChange();
}

function resetEvents() {
  if (!window.confirm("Reset events to the defaults? Events you've added or changed on this device will be replaced.")) return;
  try {
    ctx.storage?.removeItem(L.EVENTS_KEY);
  } catch {
    // Nothing saved to clear.
  }
  ctx.state.events = ctx.defaults;
  renderList();
  $("events-note").textContent = "Back to the default events from my-lifts.json.";
  ctx.onChange();
}

/** Updates each event's title, DOTS and notes for the current profile and ladder group, without touching its fields. */
export function refreshEvents(state, group, experience) {
  const onLadder = new Set(L.ladderEvents(state.events, ctx.thisMonth).map((e) => e.id));
  for (const item of $("event-list").querySelectorAll("details.event")) {
    const event = state.events.find((e) => e.id === item.dataset.id);
    const scores = L.eventScores(event, state.profile.sex);
    item.querySelector(".event-title").textContent = eventLabel(event);
    // Two scores read as "276.0 to 293.0": a plain "to" keeps them apart in the condensed face.
    const values = scores.map((s) => el("span", null, s.dots.toFixed(1)));
    item.querySelector(".event-dots").replaceChildren(
      ...(item.dataset.invalid ? ["not saved"] : values.flatMap((v, i) => (i ? [el("span", "to", " to "), v] : [v]))),
    );

    // While the fields hold invalid values, the saved scores would look current, so only the "Not saved" note shows.
    item.querySelector(".event-preview").replaceChildren(
      ...(item.dataset.invalid ? [] : scores).map(({ scenario, total, dots }) => {
        const beaten = group && L.rungBeaten(group.rungs, dots);
        const place = !group ? "" : beaten ? `, beats ${beaten.percentile}% of ${experience} lifters` : ", below every rung";
        return el("span", null, `${capital(scenario)}: ${total} kg total, ${dots.toFixed(1)} DOTS${place}`);
      }),
    );

    const notes = [];
    if (event.month < ctx.thisMonth) notes.push("This month has passed, so it's not on the ladder.");
    else if (!onLadder.has(event.id)) notes.push(`Only the next ${L.MAX_LADDER_EVENTS} events appear on the ladder.`);
    const wclass = L.eventClass(event, state.profile);
    if (wclass) notes.push(`At ${event.bodyweight} kg that's the ${wclass} kg class; your ladder shows ${L.effectiveClass(state.profile)} kg.`);
    item.querySelector(".event-info").textContent = notes.join(" ");
  }
}
