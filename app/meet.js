// The Meet screen: a list of cards (attempt planner, ...). Each card is registered once in CARDS and drawn from
// derive.js values only; changes go through the store, and its subscriber refreshes the open screen. Cards can be
// reordered, or later shown elsewhere, by changing the list.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import * as store from "./store.js";
import { derived } from "./derive.js";
import { $, choiceGroup, el } from "./dom.js";
import { eventLabel } from "./events.js";
import { ATTEMPT_NAMES, BAR_KG, BAR_LIMITS, clockTime, COLLAR_KG, OPENER_PCTS, STEP_KG } from "./attempts.js";

const now = () => derived(store.getState());
const LIFT_NAMES = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const kg = (n) => String(n); // as entered: 100, 107.5

// --- Attempt planner -------------------------------------------------------------------

const planner = {
  id: "planner",
  title: "Attempt planner",
  /** The parts that stay: the table, the step rows and the opener choice. */
  setup(body) {
    const table = el("table", "plan-table");
    const head = el("tr");
    head.append(el("th", "", "Lift · 1RM"), el("th"), el("th", "", "2nd ~96%"), el("th", "plan-third", "3rd · PR"));
    for (const th of head.children) th.scope = "col";
    const rows = el("tbody");
    table.append(el("thead"), rows);
    table.tHead.append(head);
    const caption = el("p", "muted small");
    const steps = el("ol", "plan-steps");
    const choice = el("div", "plan-choice");
    const group = el("div", "view-group");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Opener percentage");
    choice.append(el("span", "muted small", "Opener %"), group);
    body.append(table, caption, steps, choice);
    return { head, rows, caption, steps, group };
  },
  render(d, parts) {
    const plan = d.attemptPlan;
    const { formula } = d.profile;
    parts.head.children[1].textContent = `1st ~${plan.pct}%`;
    parts.rows.replaceChildren(
      ...L.LIFTS.map((lift) => {
        const row = el("tr");
        const name = el("th", "", LIFT_NAMES[lift]);
        name.scope = "row";
        name.append(" ", el("span", "plan-1rm", kg(plan.lifts[lift])));
        row.append(name, ...plan.steps.map((step, i) => el("td", i === 2 ? "plan-third" : "", kg(step.lifts[lift]))));
        return row;
      }),
    );
    parts.caption.textContent = `If every attempt at that step lands, at ${plan.bodyweight.toFixed(1)} kg`;
    parts.steps.replaceChildren(
      ...plan.steps.map((step) => {
        const li = el("li", `plan-step${step.id === "thirds" ? " plan-goal" : ""}`);
        li.append(
          el("span", "plan-step-name", step.label),
          el("span", "", `${kg(step.total)} kg · ${S.formatScore(formula, step.score)}`),
          el("span", "plan-note", noteText(step.note, formula)),
        );
        return li;
      }),
    );
    choiceGroup(parts.group, "view-option", OPENER_PCTS.map((pct) => [pct, `${pct}%`]), plan.pct, (pct) =>
      store.update((s) => ({ settings: { ...s.settings, openerPct: pct } })),
    );
  },
};

/** "Clears P25", "1.9 short of P50", "Above every rung"; nothing without rungs. */
function noteText(note, formula) {
  if (!note) return "";
  if (note.kind === "clears") return `Clears P${note.rung.percentile}`;
  if (note.kind === "short") return `${S.formatScore(formula, note.by)} short of P${note.rung.percentile}`;
  return "Above every rung";
}

// --- Meet day ----------------------------------------------------------------------------

const RACK_FOR = { squat: [["squat", "rack"], ["safeties", "safeties"]], bench: [["bench", "rack"]], deadlift: [] };
const RACK_FIELDS = [["squat", "Squat rack"], ["safeties", "Squat safeties"], ["bench", "Bench rack"]];

/** Saves (or clears) a meet-day field on the event: today, its flight. */
function saveDay(eventId, change) {
  store.update((s) => ({ events: s.events.map((e) => (e.id === eventId ? { ...e, day: change(e.day ?? {}) } : e)) }));
}

/** Records the next attempt as good or not, and forgets the weight chosen for it. */
function record(day, good) {
  const { event, next } = day;
  store.update((s) => ({
    events: s.events.map((e) => {
      if (e.id !== event.id) return e;
      const attempts = { ...e.day?.attempts, [next.lift]: [...(e.day?.attempts?.[next.lift] ?? []), { kg: next.kg, good }] };
      return { ...e, day: { ...e.day, attempts } };
    }),
    session: { ...s.session, attemptKg: null },
  }));
}

/** Takes back the last attempt recorded (a mistap). */
function undo(day) {
  const lift = [...L.LIFTS].reverse().find((l) => day.attempts[l]?.length);
  saveDay(day.event.id, (d) => ({ ...d, attempts: { ...d.attempts, [lift]: d.attempts[lift].slice(0, -1) } }));
}

const meetDayCard = {
  id: "meet-day",
  title: "Meet day",
  setup(body) {
    const empty = el("p", "muted meet-empty", "Add a meet with an exact date (Progress → Upcoming) to run your attempts from here.");
    const live = el("div", "day-live");
    const top = el("div", "day-top");
    const flight = el("span", "eyebrow");
    const wait = el("span", "pill day-wait");
    wait.setAttribute("role", "status");
    top.append(flight, wait);
    const strip = el("div", "day-strip");
    strip.setAttribute("role", "img");
    const current = el("div", "day-now");
    const what = el("p", "day-what");
    const stepper = el("div", "day-stepper");
    const weight = el("output", "day-kg");
    const step = (direction, label, text) => {
      const button = el("button", "step-btn", text);
      button.type = "button";
      button.setAttribute("aria-label", label);
      button.addEventListener("click", () => {
        const { next } = now().meetDay;
        const kgNow = L.stepValue(next.kg, STEP_KG, direction, [next.min, L.LIMITS.lift[1]]);
        store.update((s) => ({ session: { ...s.session, attemptKg: { key: `${next.lift}:${next.number}`, kg: kgNow } } }));
      });
      return button;
    };
    stepper.append(step(-1, `${STEP_KG} kg lighter`, "−"), weight, step(1, `${STEP_KG} kg heavier`, "+"));
    const rack = el("p", "muted day-rack");
    current.append(what, stepper, rack);
    const plates = el("p", "day-plates");
    const actions = el("div", "day-actions");
    const good = el("button", "day-good");
    good.type = "button";
    good.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>Good lift';
    const bad = el("button", "day-bad");
    bad.type = "button";
    bad.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>No lift';
    good.addEventListener("click", () => record(now().meetDay, true));
    bad.addEventListener("click", () => record(now().meetDay, false));
    actions.append(good, bad);
    const after = el("p", "muted small day-after");
    const undoButton = el("button", "link-button", "Undo last");
    undoButton.type = "button";
    undoButton.addEventListener("click", () => undo(now().meetDay));
    // The flight and your rack heights: typed once, saved as you leave each field.
    const setup = el("details", "day-setup");
    const summary = el("summary", "", "Flight and rack heights");
    const fields = el("div", "fields");
    const field = (labelText, name, save) => {
      const label = el("label", "", labelText);
      const input = el("input");
      input.name = name;
      input.maxLength = L.MAX_LABEL;
      input.autocomplete = "off";
      input.addEventListener("change", () => save(input.value));
      label.append(input);
      fields.append(label);
      return input;
    };
    const flightInput = field("Flight", "flight", (value) => saveDay(now().meetDay.event.id, (d) => ({ ...d, flight: value })));
    const rackInputs = RACK_FIELDS.map(([key, text]) =>
      field(text, key, (value) => store.update((s) => ({ settings: { ...s.settings, rack: { ...s.settings.rack, [key]: value } } }))),
    );
    setup.append(summary, fields);
    live.append(top, strip, current, plates, actions, after, undoButton);
    body.append(empty, live, setup);
    return { empty, live, setup, flight, wait, strip, what, stepper, weight, rack, plates, actions, after, undoButton, flightInput, rackInputs };
  },
  render(d, parts) {
    const day = d.meetDay;
    parts.empty.hidden = Boolean(day);
    parts.live.hidden = parts.setup.hidden = !day;
    if (!day) return;
    const { next, event } = day;
    parts.flight.textContent = event.day?.flight ?? "";
    parts.flight.hidden = !event.day?.flight;
    // Before your first attempt of a lift, how long until you're on.
    const waiting = next?.number === 1 && event.day?.before != null;
    parts.wait.hidden = !waiting;
    if (waiting) parts.wait.textContent = `${event.day.before} lifters · ~${event.day.before} min`;
    parts.strip.replaceChildren(
      ...day.states.map(({ state, number }) => el("span", `day-seg seg-${state}${number === 1 ? " seg-first" : ""}`)),
    );
    parts.strip.setAttribute("aria-label", `${day.taken} of 9 attempts taken, ${day.states.filter((a) => a.state === "good").length} good`);
    parts.actions.hidden = parts.plates.hidden = !next;
    parts.stepper.hidden = parts.rack.hidden = !next;
    if (next) {
      parts.what.textContent = `${LIFT_NAMES[next.lift]} · ${ATTEMPT_NAMES[next.number - 1]}`;
      parts.weight.textContent = kg(next.kg);
      const rack = RACK_FOR[next.lift].map(([key, word]) => d.settings.rack?.[key] && `${word} ${d.settings.rack[key]}`).filter(Boolean);
      parts.rack.textContent = ["kg", ...rack].join(" · ");
      parts.plates.replaceChildren(
        el("span", "muted small", "Each side"),
        el("strong", "", next.plates.plates.length ? `${listed(next.plates.plates)} + collar` : "Collars only"),
      );
      parts.after.textContent =
        next.kg === next.planned ? `On plan: ${kg(next.planned)} kg.` : `Plan said ${kg(next.planned)} kg; you've set ${kg(next.kg)}.`;
    } else {
      parts.what.textContent = "All nine attempts in";
      parts.after.textContent = "Your results are under Meet attempts.";
    }
    parts.undoButton.hidden = !day.taken;
    // Fill the setup fields from what's saved, except one being typed in.
    const fill = (input, value) => {
      if (document.activeElement !== input) input.value = value ?? "";
    };
    fill(parts.flightInput, event.day?.flight);
    RACK_FIELDS.forEach(([key], i) => fill(parts.rackInputs[i], d.settings.rack?.[key]));
  },
};

// --- Warm-ups --------------------------------------------------------------------------------
// Often read by a handler holding the phone mid-warm-up: big times and weights, one tap to tick a set off.

const warmupsCard = {
  id: "warmups",
  title: "Warm-up timeline",
  setup(body) {
    const empty = el("p", "muted meet-empty", "Add a meet with an exact date to plan your warm-ups.");
    const live = el("div", "warm-live");
    const lifts = el("div", "view-group");
    lifts.setAttribute("role", "group");
    lifts.setAttribute("aria-label", "Warm-ups for");
    const fields = el("div", "fields");
    const field = (labelText, attrs, save) => {
      const label = el("label", "", labelText);
      const input = el("input");
      Object.assign(input, attrs);
      input.addEventListener("change", () => save(input));
      label.append(input);
      fields.append(label);
      return input;
    };
    const start = field("Flight starts", { type: "time", name: "start" }, (input) => {
      const { lift } = now().warmups;
      saveDay(now().meetDay.event.id, (d) => ({ ...d, start: { ...d.start, [lift]: input.value } }));
    });
    const before = field("Lifters before you", { type: "number", name: "before", inputMode: "numeric", min: 0, max: L.MAX_BEFORE, step: 1 }, (input) =>
      saveDay(now().meetDay.event.id, (d) => ({ ...d, before: Number.isInteger(input.valueAsNumber) ? input.valueAsNumber : null })),
    );
    const list = el("ol", "warm-list");
    const note = el("p", "muted small", "Times move when you change the lifters before you; each lifter is about a minute. Tap a set when it's done.");
    live.append(lifts, fields, list, note);
    body.append(empty, live);
    return { empty, live, lifts, start, before, list };
  },
  render(d, parts) {
    const w = d.warmups;
    parts.empty.hidden = Boolean(w);
    parts.live.hidden = !w;
    if (!w) return;
    choiceGroup(parts.lifts, "view-option", L.LIFTS.map((lift) => [lift, LIFT_NAMES[lift]]), w.lift, (lift) =>
      store.update((s) => ({ session: { ...s.session, warmupLift: lift } })),
    );
    if (document.activeElement !== parts.start) parts.start.value = w.start ?? "";
    if (document.activeElement !== parts.before) parts.before.value = w.before ?? "";
    const time = (at) => (at == null ? "" : clockTime(at));
    parts.list.replaceChildren(
      ...w.sets.map((set, i) => {
        const li = el("li");
        const button = el("button", `warm-set${set.due ? " warm-due" : ""}${set.ticked ? " warm-done" : ""}`);
        button.type = "button";
        button.setAttribute("aria-pressed", String(set.ticked));
        const weight = set.kg === BAR_KG ? "Bar" : `${kg(set.kg)} kg`;
        button.setAttribute("aria-label", `${time(set.at)} ${weight} for ${set.reps}${set.due ? ", now" : ""}${set.ticked ? ", done" : ""}`);
        button.append(
          el("span", "warm-time", time(set.at)),
          el("span", "warm-mark"),
          el("span", "warm-kg", set.due ? `${weight} · now` : weight),
          el("span", "warm-reps", `× ${set.reps}`),
        );
        button.addEventListener("click", () =>
          store.update((s) => {
            const ticks = s.session.warmupTicks?.[w.lift] ?? [];
            const next = ticks.includes(i) ? ticks.filter((t) => t !== i) : [...ticks, i];
            return { session: { ...s.session, warmupTicks: { ...s.session.warmupTicks, [w.lift]: next } } };
          }),
        );
        li.append(button);
        return li;
      }),
      (() => {
        const li = el("li", "warm-opener");
        li.append(
          el("span", "warm-time", w.openerAt == null ? "" : `~${clockTime(w.openerAt)}`),
          el("span", "warm-mark"),
          el("span", "warm-kg", `Opener · ${kg(w.opener)} kg`),
          el("span", "warm-reps", "platform"),
        );
        return li;
      })(),
    );
  },
};

// The clock the warm-ups read: kept in the session, updated each minute while the Meet screen is open.
let clockTimer = null;
function tickClock() {
  const date = new Date();
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (store.getState().session.clock !== minutes) store.update((s) => ({ session: { ...s.session, clock: minutes } }));
}

// --- Plate loader ------------------------------------------------------------------------

// Each plate drawn by weight: bigger plates are taller and thicker; greyscale, heaviest brightest.
const PLATE_LOOK = {
  25: [124, 22, "var(--text)"],
  20: [124, 20, "var(--text-2)"],
  15: [106, 18, "var(--text-2)"],
  10: [88, 14, "var(--muted)"],
  5: [60, 10, "var(--muted)"],
  2.5: [46, 8, "var(--muted)"],
  1.25: [36, 6, "var(--muted)"],
};
const listed = (plates) => plates.join(" · ");

const plateLoader = {
  id: "plates",
  title: "Plate loader",
  eyebrow: () => `${BAR_KG} kg bar + ${COLLAR_KG} kg collars`,
  setup(body) {
    const stepper = el("div", "plate-stepper");
    const total = el("output", "plate-total");
    const step = (direction, label, text) => {
      const button = el("button", "step-btn", text);
      button.type = "button";
      button.setAttribute("aria-label", label);
      button.addEventListener("click", () =>
        store.update((s) => ({
          session: { ...s.session, plateKg: L.stepValue(now().plates.total, STEP_KG, direction, BAR_LIMITS) },
        })),
      );
      return button;
    };
    stepper.append(step(-1, `Decrease by ${STEP_KG} kg`, "−"), total, step(1, `Increase by ${STEP_KG} kg`, "+"));
    const bar = el("div", "plate-bar");
    bar.setAttribute("role", "img");
    const summary = el("p", "plate-summary");
    const side = el("span", "plate-side");
    const each = el("span", "muted small");
    summary.append(side, each);
    body.append(stepper, bar, summary);
    return { total, bar, side, each };
  },
  render(d, parts) {
    const { total, plates, perSide, exact } = d.plates;
    parts.total.textContent = `${total} kg`;
    const sleeve = el("span", "plate-sleeve");
    const collar = el("span", "plate-collar");
    parts.bar.replaceChildren(
      sleeve,
      ...plates.map((plate) => {
        const [height, width, colour] = PLATE_LOOK[plate];
        const span = el("span", "plate");
        span.style.cssText = `height: ${height}px; width: ${width}px; background: ${colour}`;
        return span;
      }),
      collar,
    );
    parts.bar.setAttribute(
      "aria-label",
      plates.length ? `One side of the bar, inside to outside: ${listed(plates)} kg plates, then the collar` : "An empty bar with collars",
    );
    parts.side.replaceChildren(el("span", "muted small", "Each side"), el("strong", "", plates.length ? listed(plates) : "No plates"));
    parts.each.textContent = exact ? `${perSide} kg / side` : `${perSide} kg / side · can't make ${total} exactly`;
  },
};

// --- The list ------------------------------------------------------------------------------

/**
 * The cards, in the order they're shown. Each: { id, title, setup(body) → parts, render(derived, parts) }, and
 * optionally eyebrow(derived) for its own eyebrow (else your next meet).
 */
export const CARDS = [planner, plateLoader, meetDayCard, warmupsCard];

const built = new Map(); // card id → { eyebrow, parts }

/** The eyebrow over every card: your next meet ("Spring Open, 14 Nov"), or that there isn't one. */
function meetEyebrow(d) {
  const meet = d.nextMeet?.event;
  return meet ? eventLabel(meet) : "No meet with a date yet";
}

export function setupMeet() {
  for (const card of CARDS) {
    const section = el("section", "card meet-card");
    section.id = `card-${card.id}`;
    section.setAttribute("aria-labelledby", `card-${card.id}-title`);
    const head = el("header", "meet-card-head");
    const eyebrow = el("p", "eyebrow");
    const title = el("h2", "", card.title);
    title.id = `card-${card.id}-title`;
    head.append(eyebrow, title);
    const body = el("div", "meet-card-body");
    section.append(head, body);
    $("meet-cards").append(section);
    built.set(card.id, { eyebrow, parts: card.setup(body) });
  }
}

/** Redraws every card from the current derived values. */
export function refreshMeet() {
  const d = now();
  if (!d.profile) return;
  for (const card of CARDS) {
    const { eyebrow, parts } = built.get(card.id);
    eyebrow.textContent = card.eyebrow ? card.eyebrow(d) : meetEyebrow(d);
    card.render(d, parts);
  }
}

/** Opening the screen starts the clock (stopped when another screen opens) and draws the cards. */
export function openMeet() {
  tickClock();
  clockTimer ??= setInterval(() => (L.routeFrom(location.hash) === "meet" ? tickClock() : stopClock()), 20_000);
  refreshMeet();
}

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = null;
}
