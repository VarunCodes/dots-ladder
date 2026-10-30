// The Meet screen: a list of cards (attempt planner, ...). Each card is registered once in CARDS and drawn from
// derive.js values only; changes go through the store, and its subscriber refreshes the open screen. Cards can be
// reordered, or later shown elsewhere, by changing the list.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import * as store from "./store.js";
import { derived } from "./derive.js";
import { $, choiceGroup, el } from "./dom.js";
import { eventLabel } from "./events.js";
import { BAR_KG, BAR_LIMITS, COLLAR_KG, OPENER_PCTS, STEP_KG } from "./attempts.js";

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
export const CARDS = [planner, plateLoader];

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

export const openMeet = refreshMeet;
