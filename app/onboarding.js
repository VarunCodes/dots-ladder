// The first visit: one question per screen, then where you stand. Each screen asks one thing and every few give
// something back (your class, where each lift places you, the 100, your score, your next target). The rules and
// words are in ladder.js; the answers are a draft in the store, so a half-finished visit picks up where it stopped,
// and the first record is saved at the end. The screen is in the URL ("#/start/squat"), so the phone's back
// gesture goes back a screen.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import * as store from "./store.js";
import { $, el, replay } from "./dom.js";
import { track } from "./track.js";
import { chooseBackup } from "./yourdata.js";

let rungsData = null;
let current = "welcome";

const draft = () => store.getState().draft ?? L.emptyDraft();
const kg = (n) => `${Number(n.toFixed(1))} kg`;
const LIFT_TITLES = { squat: "Squat", bench: "Bench press", deadlift: "Deadlift" };
// What counts for each lift, in one line: the barbell version (the rungs are meet lifts), and what doesn't count.
const LIFT_WHAT = {
  squat: ["Barbell back squat, bar on your back.", "Not a Smith machine or leg press."],
  bench: ["Barbell bench press, on a flat bench.", "Not dumbbells or a machine."],
  deadlift: ["Barbell deadlift from the floor, conventional or sumo.", "Not a trap bar."],
};
const PLACEHOLDER = { squat: 80, bench: 50, deadlift: 100 };

/** The first-visit screen named in a URL hash ("#/start/bench" → "bench"), or the welcome screen. */
export const screenFrom = (hash) => /^#\/start\/([\w-]+)/.exec(hash ?? "")?.[1] ?? "welcome";

/** Changes the draft through the store (which saves it); the screen updates its own parts, so typing keeps focus. */
function answer(change) {
  store.update((s) => ({ draft: { ...(s.draft ?? L.emptyDraft()), ...change(s.draft ?? L.emptyDraft()) } }));
}
const answerLift = (lift, change) => answer((d) => ({ lifts: { ...d.lifts, [lift]: { ...(d.lifts[lift] ?? { mode: d.mode ?? "max", kg: null, reps: null }), ...change } } }));

const go = (screen) => {
  location.hash = `#/start/${screen}`;
};

/**
 * Back: the browser's own history when its previous entry is the screen before this one (so the back gesture and
 * this button agree), else straight to that screen. The browser can drop entries (made while the page loads, or
 * without a tap), so going back blindly could leave the app.
 */
function back() {
  const previous = L.previousScreen(draft(), current);
  const nav = window.navigation;
  const entry = nav?.entries?.()[nav.currentEntry.index - 1];
  const url = entry?.url && new URL(entry.url);
  if (url && url.origin === location.origin && url.pathname === location.pathname && screenFrom(url.hash) === previous) history.back();
  else location.replace(`#/start/${previous}`);
}

// --- Building blocks -------------------------------------------------------------------------

function heading(text, className = "") {
  const h = el("h2", className, text);
  h.tabIndex = -1;
  return h;
}

/** A tap-to-answer choice, which moves straight on. */
function choice(title, sub, pressed, onPick) {
  const button = el("button", "fv-choice", title);
  button.type = "button";
  button.setAttribute("aria-pressed", String(pressed));
  if (sub) button.append(el("span", "", sub));
  button.addEventListener("click", onPick);
  return button;
}

/** A number field with its unit, sized so iOS doesn't zoom in, opening the right keypad. */
function numberField(label, { id, value, placeholder, unit = "kg", inputMode = "decimal", enterKey = "next", className = "" }) {
  const wrap = el("label", `fv-field ${className}`, label);
  const box = el("span", "fv-unit");
  const input = Object.assign(el("input"), { id, type: "number", inputMode, step: "any", placeholder: String(placeholder ?? ""), value: value ?? "", autocomplete: "off" });
  input.enterKeyHint = enterKey;
  box.append(input);
  if (unit) box.append(el("span", "", unit));
  wrap.append(box);
  return { wrap, input };
}

/** The pinned footer: the main button, plus anything under it. */
function actions(label, onClick, { disabled = false, extra = [] } = {}) {
  const box = el("div", "fv-actions");
  const button = el("button", "primary", label);
  button.type = "button";
  button.disabled = disabled;
  button.addEventListener("click", () => !button.disabled && onClick());
  box.append(button, ...extra);
  return { box, button };
}

const card = (title, more, est) => {
  const box = el("div", "fv-reward");
  if (est) box.append(el("p", "fv-est", est));
  if (title) box.append(el("p", "fv-big", title));
  if (more) box.append(el("p", "small muted", more));
  return box;
};

// --- Telling screen readers, and keeping the result in view --------------------------------

let announceTimer = null;

/** Says a result to screen readers once typing pauses, so they hear the card, not every digit. */
function announce(text) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    $("onboard-live").textContent = text;
  }, 700);
}

/**
 * Shows what a value gives back under its field: replaced only when the words change, animated only when it first
 * appears (not on every keystroke), announced after a pause, and scrolled into view above the keyboard.
 */
function showResult(out, node) {
  const text = node ? [...node.children].map((line) => line.textContent.trim()).join(" ") : "";
  if (out.dataset.text === text) return;
  const appearing = !out.dataset.text;
  out.dataset.text = text;
  if (!node) {
    out.replaceChildren();
    clearTimeout(announceTimer);
    return;
  }
  if (!appearing) node.classList.add("still");
  out.replaceChildren(node);
  announce(text);
  keepAboveKeyboard(out);
}

/**
 * Scrolls just enough to lift `node` above the on-screen keyboard (--kb, from visualViewport), if it's open. Done by
 * measurement rather than scrollIntoView, which can't see the keyboard on every phone.
 */
function keepAboveKeyboard(node) {
  const root = document.documentElement;
  if (!root.classList.contains("kb-open")) return;
  const kb = parseFloat(getComputedStyle(root).getPropertyValue("--kb")) || 0;
  const over = node.getBoundingClientRect().bottom - (innerHeight - kb - 12);
  // At once, not smoothly: a short move that can't race the keyboard's own animation.
  if (over > 0) window.scrollBy({ top: over, behavior: "instant" });
}

/** Ties a field to the screen's question and its problem line, so a screen reader hears both with the field. */
function describe(input, question, problem) {
  question.id ||= `fv-q-${Math.random().toString(36).slice(2, 8)}`;
  problem.id ||= `${input.id}-problem`;
  problem.setAttribute("role", "status");
  input.setAttribute("aria-describedby", `${question.id} ${problem.id}`);
}

/** Marks a field as wrong for assistive tech when its problem line is showing. */
const flag = (input, wrong) => input.setAttribute("aria-invalid", String(Boolean(wrong)));

const groupLine = (group) => {
  const p = el("p", "fv-group", "Compared with UK powerlifters: ");
  p.append(el("strong", "", L.groupWords(group)));
  return p;
};

const credit = () => {
  const p = el("p", "fv-credit", "Real results from ");
  const a = Object.assign(el("a", "", "OpenPowerlifting"), { href: "https://www.openpowerlifting.org/" });
  p.append(a, ", groups of 20 or more UK powerlifters, no individuals named.");
  return p;
};

// --- Screens -----------------------------------------------------------------------------------

const SCREENS = {
  welcome() {
    const started = L.draftStarted(store.getState().draft);
    const nodes = [
      heading("See how your lifts compare with real UK powerlifters"),
      el("p", "fv-lede", "A few quick questions, about a minute. You'll see where your squat, bench press and deadlift stand, and what to aim for next."),
      el("p", "fv-note", "The comparisons come from real results at UK powerlifting meets, not from gym apps or guesses."),
    ];
    if (started) {
      const resume = el("div", "fv-resume");
      const row = el("div", "fv-resume-row");
      const restart = el("button", "button", "Start again");
      const carry = el("button", "primary", "Continue");
      restart.type = carry.type = "button";
      restart.addEventListener("click", () => {
        store.update(() => ({ draft: null }));
        go("sex");
      });
      carry.addEventListener("click", () => go(L.firstMissing(draft())));
      row.append(restart, carry);
      resume.append(el("p", "", "Pick up where you left off?"), el("p", "small muted", "Your answers so far are saved on this phone."), row);
      nodes.push(resume);
    }
    const quick = el("button", "link-button fv-link", "I know my numbers: quick setup");
    quick.type = "button";
    quick.addEventListener("click", () => go("quick"));
    const restore = el("button", "link-button fv-link", "Restore from a backup");
    restore.type = "button";
    const note = el("p", "fv-problem small");
    note.id = "onboard-note";
    note.setAttribute("role", "status");
    restore.addEventListener("click", () => chooseBackup(note));
    // With answers saved, the resume card has the buttons; otherwise Start does.
    const box = started ? el("div", "fv-actions") : actions("Start", () => go("sex")).box;
    // Counting is on by default, so the first screen says so (what's counted, and that numbers never are).
    const privacy = el("p", "fv-private", "Nothing you enter leaves this phone. The app counts which screens are used, anonymously, to improve it. ");
    privacy.append(Object.assign(el("a", "", "Privacy"), { href: "privacy.html" }));
    box.append(quick, restore, note, privacy);
    return [...nodes, box];
  },

  sex() {
    const d = draft();
    const pick = (sex) => () => {
      answer(() => ({ sex }));
      go("bodyweight");
    };
    const list = el("div", "fv-choices");
    list.append(choice("Women", "", d.sex === "F", pick("F")), choice("Men", "", d.sex === "M", pick("M")));
    return [heading("Women's or men's?"), el("p", "fv-lede", "Powerlifting meets have separate categories, so you're compared with lifters in yours."), list];
  },

  bodyweight() {
    const d = draft();
    const question = heading("What do you weigh?");
    const { wrap, input } = numberField("Bodyweight", { id: "fv-bw", value: d.bodyweight, placeholder: d.sex === "F" ? 63 : 80, enterKey: "go" });
    const problem = el("p", "fv-problem small");
    describe(input, question, problem);
    const out = el("div", "fv-out");
    const { box, button } = actions("Next", () => go("competed"), { disabled: true });
    const update = () => {
      const bw = input.valueAsNumber;
      const ok = bw >= L.LIMITS.bodyweight[0] && bw <= L.LIMITS.bodyweight[1];
      // Flagged only once two digits are typed, so one digit is never an error.
      const wrong = !ok && input.value.replace(/\D/g, "").length >= 2;
      problem.textContent = wrong ? `Enter a bodyweight from ${L.LIMITS.bodyweight.join(" to ")} kg.` : "";
      flag(input, wrong);
      button.disabled = !ok;
      if (!ok) return showResult(out, null);
      answer(() => ({ bodyweight: bw }));
      const wclass = L.weightClass(d.sex, bw);
      showResult(out, card(`You're in the ${wclass} kg class`, `Lifters from ${L.classRange(d.sex, wclass)}, like at a meet.`));
    };
    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => e.key === "Enter" && !button.disabled && go("competed"));
    update();
    return [question, el("p", "fv-lede", "Heavier lifters tend to lift more, so you're compared with people around your weight."), wrap, problem, out, box];
  },

  competed() {
    const d = draft();
    const pick = (competed) => () => {
      answer(() => ({ competed }));
      go("max-known");
    };
    const list = el("div", "fv-choices");
    list.append(
      choice("No, never", "You'll be compared with lifters at their first meet: the closest group to you.", d.competed === "never", pick("never")),
      choice("Once", "Your next meet would be your second, so you're compared with lifters at theirs.", d.competed === "once", pick("once")),
      choice("Twice or more", "Compared with lifters with 3 or more meets.", d.competed === "more", pick("more")),
    );
    return [heading("Have you ever competed in powerlifting?"), el("p", "fv-lede", "A powerlifting meet is a competition in squat, bench press and deadlift, with judges."), list];
  },

  "max-known"() {
    const d = draft();
    const pick = (mode) => () => {
      // Lifts not typed yet follow the answer; one already entered keeps its own way.
      answer((now) => ({ mode, lifts: Object.fromEntries(Object.entries(now.lifts).map(([lift, e]) => [lift, e.kg == null ? { ...e, mode } : e])) }));
      go("squat");
    };
    const list = el("div", "fv-choices");
    list.append(
      choice("Yes, I've tested it", "You'll enter the weight for each lift.", d.mode === "max", pick("max")),
      choice("No, I lift sets", "Enter a recent set, like 60 kg for 5 reps, and we'll estimate your max.", d.mode === "set", pick("set")),
    );
    return [heading("Do you know your one-rep max?"), el("p", "fv-lede", "Your one-rep max is the heaviest weight you can lift once, with good form."), list];
  },

  squat: () => liftScreen("squat"),
  bench: () => liftScreen("bench"),
  deadlift: () => liftScreen("deadlift"),

  standing() {
    const d = draft();
    const profile = L.draftProfile(d);
    const group = L.draftGroup(rungsData, d);
    if (!group) {
      const { box } = actions("Next", () => go("score"));
      return [heading("Not enough lifters to compare yet"), el("p", "fv-lede", "There aren't enough UK powerlifters in your class for a fair comparison. You'll still see your score, and how it changes."), box];
    }
    const words = L.standingWords(profile, group);
    const crowd = el("div", "fv-crowd");
    crowd.setAttribute("role", "img");
    crowd.setAttribute("aria-label", words.label);
    crowd.append(...Array.from({ length: 100 }, (_, i) => {
      const dot = el("span", i < words.filled ? "on" : i < words.outlined ? "target" : "");
      dot.style.setProperty("--i", i);
      return dot;
    }));
    replay(crowd, "fill");
    const key = el("p", "fv-key");
    key.setAttribute("aria-hidden", "true");
    words.key.forEach((text, i) => key.append(el("span", i === 0 && words.filled ? "k-on" : "k-target", text)));
    const sum = el("dl", "fv-sum");
    for (const lift of L.LIFTS) {
      const row = el("div");
      const dd = el("dd", "", kg(profile[lift]));
      if (L.draftEstimated(d, lift)) dd.append(el("span", "", `est. from ${kg(d.lifts[lift].kg)} × ${d.lifts[lift].reps}`));
      row.append(el("dt", "", LIFT_TITLES[lift]), dd);
      sum.append(row);
    }
    const totalRow = el("div");
    totalRow.append(el("dt", "", "Total"), el("dd", "", kg(L.sumLifts(profile))));
    sum.append(totalRow);
    const nodes = [el("p", "fv-lede", `Picture 100 UK powerlifters: ${L.groupWords(group)}.`), heading(words.title, "fv-statement"), el("p", "small muted", words.more), crowd, key, sum];
    if (L.LIFTS.some((lift) => L.draftEstimated(d, lift))) nodes.push(el("p", "fv-note", "Lifts marked est. are estimated from a set. A tested max, at a meet especially, may come out lower."));
    if (group.fellBack) nodes.push(el("p", "small muted", "Too few lifters at that many meets in your class, so this uses first-meet lifters."));
    nodes.push(credit(), actions("Next", () => go("score")).box);
    return nodes;
  },

  score() {
    const words = L.scoreWords(L.draftProfile(draft()));
    const number = el("p", "fv-number", S.formatScore("dots", words.points));
    number.append(el("small", "", "DOTS"));
    const head = el("div");
    head.append(number, el("p", "small muted", words.from));
    const sum = el("dl", "fv-sum");
    for (const row of words.rows) {
      const div = el("div");
      const dd = el("dd", "", S.formatScore("dots", row.points));
      dd.append(el("span", "", `${row.change > 0 ? "+" : "−"}${S.formatScore("dots", Math.abs(row.change))}`));
      div.append(el("dt", "", row.label), dd);
      sum.append(div);
    }
    return [
      heading("Your score"),
      head,
      el("p", "fv-lede", "DOTS turns your total and your bodyweight into one number. Heavier lifters need a bigger total to get the same score, so it measures how strong you are for your size."),
      el("h3", "fv-subhead", "How your score moves"),
      sum,
      ...(words.gymGoer ? [el("p", "fv-note", words.gymGoer)] : []),
      actions("Next", () => go("target")).box,
    ];
  },

  target() {
    const d = draft();
    const profile = L.draftProfile(d);
    const group = L.draftGroup(rungsData, d);
    const next = actions("Next", () => go("next")).box;
    if (!group) return [heading("Your next step"), el("p", "fv-lede", "Without enough powerlifters in your class to compare, every test is about beating your own best."), next];
    // Each lift's next step, nearest first. The total's target is on the 100 screen; these are separate goals
    // (each lift's rungs come from its own lifters), so they aren't shown as adding up to it.
    const words = L.targetWords(profile, group);
    if (words.allTop) return [heading("Past every rung"), el("p", "fv-lede", "Every lift is as high as these numbers go. From here, each test is about beating your own best."), credit(), next];
    const sum = el("dl", "fv-sum");
    for (const row of words.lifts) {
      const div = el("div");
      const dd = el("dd", "", row.kg == null ? row.words : kg(row.kg));
      if (row.kg != null) dd.append(el("span", "", `+${kg(row.add)} · ${row.words}`));
      div.append(el("dt", "", LIFT_TITLES[row.lift]), dd);
      sum.append(div);
    }
    return [heading("Your next steps"), el("p", "fv-lede", "Each lift on its own, nearest first. Beat one and log it."), sum, credit(), next];
  },

  next() {
    return [
      heading("Your ladder is ready"),
      el("p", "fv-lede", "When you lift more, log it on Log test: one lift or all three. Your score and your place on the ladder update straight away."),
      el("p", "small muted", "Your numbers stay on this phone. Back them up any time from Progress."),
      actions("Show my ladder", finish).box,
    ];
  },

  quick() {
    const d = draft();
    const pickRow = (label, options, key) => {
      const row = el("div", "fv-chips");
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", label);
      for (const [value, text] of options) {
        const chip = el("button", "fv-chip", text);
        chip.type = "button";
        chip.setAttribute("aria-pressed", String(d[key] === value));
        chip.addEventListener("click", () => {
          answer(() => ({ [key]: value }));
          row.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === chip)));
          update();
        });
        row.append(chip);
      }
      return row;
    };
    const bw = numberField("Bodyweight", { id: "fv-q-bw", value: d.bodyweight, placeholder: 70 });
    const lifts = Object.fromEntries(L.LIFTS.map((lift) => [lift, numberField(lift === "bench" ? "Bench" : LIFT_TITLES[lift], { id: `fv-q-${lift}`, value: d.lifts[lift]?.mode === "max" ? d.lifts[lift].kg : null, unit: "kg" })]));
    const grid = el("div", "fv-quick-lifts");
    grid.append(...L.LIFTS.map((lift) => lifts[lift].wrap));
    // What's still needed, said rather than left as a silent disabled button.
    const needs = el("p", "fv-needs small");
    needs.id = "fv-q-needs";
    needs.setAttribute("role", "status");
    const { box, button } = actions("See where I stand", () => go("standing"), { disabled: true });
    button.setAttribute("aria-describedby", needs.id);
    box.prepend(needs);
    const update = () => {
      const values = Object.fromEntries(L.LIFTS.map((lift) => [lift, lifts[lift].input.valueAsNumber]));
      const weight = bw.input.valueAsNumber;
      const now = draft();
      const missing = [
        !now.sex && "women's or men's",
        !(weight >= L.LIMITS.bodyweight[0] && weight <= L.LIMITS.bodyweight[1]) && `bodyweight (${L.LIMITS.bodyweight.join(" to ")} kg)`,
        ...L.LIFTS.filter((lift) => L.liftEntryProblem({ kg: values[lift], mode: "max" })).map((lift) => `${LIFT_TITLES[lift].toLowerCase()} (${L.LIMITS.lift.join(" to ")} kg)`),
        !now.competed && "meets so far",
      ].filter(Boolean);
      for (const [input, wrong] of [[bw.input, bw.input.value !== "" && missing.some((m) => m.startsWith("bodyweight"))], ...L.LIFTS.map((lift) => [lifts[lift].input, lifts[lift].input.value !== "" && missing.some((m) => m.startsWith(LIFT_TITLES[lift].toLowerCase()))])]) flag(input, wrong);
      needs.textContent = missing.length ? `Still needed: ${missing.join(", ")}.` : "";
      button.disabled = missing.length > 0;
      if (!missing.length) answer(() => ({ via: "quick", mode: "max", bodyweight: weight, lifts: Object.fromEntries(L.LIFTS.map((lift) => [lift, { mode: "max", kg: values[lift], reps: null }])) }));
    };
    for (const input of [bw.input, ...L.LIFTS.map((lift) => lifts[lift].input)]) input.addEventListener("input", update);
    const form = el("div", "fv-quick");
    form.append(
      pickRow("Category", [["F", "Women"], ["M", "Men"]], "sex"),
      bw.wrap,
      grid,
      pickRow("Meets so far", [["never", "No meets yet"], ["once", "1 meet"], ["more", "2+ meets"]], "competed"),
    );
    queueMicrotask(update);
    return [heading("Quick setup"), el("p", "fv-lede", "Your tested maxes, in kg."), form, box];
  },
};

/** What counts for a lift: the barbell version, since the rungs are meet lifts. */
function what(lift) {
  const [counts, doesnt] = LIFT_WHAT[lift];
  const p = el("p", "fv-what");
  p.append(el("strong", "", counts), ` ${doesnt}`);
  return p;
}

/** One lift per screen: a max, or a set (kg × reps) and its estimate, then where it places you once it's in. */
function liftScreen(lift) {
  const d = draft();
  const entry = d.lifts[lift] ?? { mode: d.mode ?? "max", kg: null, reps: null };
  const setMode = entry.mode === "set";
  const nextScreen = L.FIRST_VISIT_STEPS[L.FIRST_VISIT_STEPS.indexOf(lift) + 1];
  const group = L.draftGroup(rungsData, d);
  const question = heading(`Your best ${LIFT_TITLES[lift].toLowerCase()}`);
  const weight = numberField(setMode ? "Heaviest recent set" : "One-rep max", { id: "fv-kg", value: entry.kg, placeholder: PLACEHOLDER[lift], enterKey: setMode ? "next" : "go" });
  const fields = el("div", "fv-fields");
  fields.append(weight.wrap);
  let reps = null;
  if (setMode) {
    // Left empty (with an example), so a set is never saved with reps nobody typed.
    reps = numberField("Reps", { id: "fv-reps", value: entry.reps, placeholder: 5, unit: "", inputMode: "numeric", enterKey: "go", className: "fv-reps" });
    const times = el("span", "fv-times", "×");
    times.setAttribute("aria-hidden", "true");
    fields.append(times, reps.wrap);
  }
  const problem = el("p", "fv-problem small");
  describe(weight.input, question, problem);
  if (reps) describe(reps.input, question, problem);
  const out = el("div", "fv-out");
  const nextLabel = lift === "deadlift" ? "See where I stand" : `Next: ${LIFT_TITLES[nextScreen].toLowerCase()}`;
  const { box, button } = actions(nextLabel, () => go(nextScreen), { disabled: true });

  const update = () => {
    const now = { mode: entry.mode, kg: Number.isFinite(weight.input.valueAsNumber) ? weight.input.valueAsNumber : null, reps: reps ? (Number.isFinite(reps.input.valueAsNumber) ? reps.input.valueAsNumber : null) : null };
    answerLift(lift, now);
    const issue = L.liftEntryProblem(now);
    // A weight is flagged once it has two digits; reps as soon as they're wrong.
    // Empty reps aren't wrong yet, just not done.
    const typedReps = reps && reps.input.value !== "";
    const show = issue && (issue === "kg" ? weight.input.value.replace(/\D/g, "").length >= 2 : issue !== "reps" || typedReps);
    problem.textContent = show ? L.LIFT_ENTRY_TEXT[issue] : "";
    flag(weight.input, show && (issue === "kg" || issue === "estimate"));
    if (reps) flag(reps.input, show && (issue === "reps" || issue === "too-many-reps"));
    button.disabled = Boolean(issue);
    if (issue) return showResult(out, null);
    const max = L.draftMax(draft(), lift);
    const est = L.draftEstimated(draft(), lift) ? `Estimated max: ${kg(max)}, from ${kg(now.kg)} × ${now.reps}` : "";
    const words = group?.lifts[lift]?.length ? L.liftPlaceWords(lift, max, group) : null;
    showResult(out, card(words?.title, words?.more, est));
  };
  weight.input.addEventListener("input", update);
  reps?.input.addEventListener("input", update);
  // Enter on the weight moves to reps when there are reps; Enter on the last field moves on.
  weight.input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (reps) reps.input.focus();
    else if (!button.disabled) go(nextScreen);
  });
  reps?.input.addEventListener("keydown", (e) => e.key === "Enter" && !button.disabled && go(nextScreen));
  const toggle = el("button", "link-button fv-link", setMode ? "I know my max" : "Don't know your max? Use a set");
  toggle.type = "button";
  toggle.addEventListener("click", () => {
    answerLift(lift, { mode: setMode ? "max" : "set", reps: entry.reps ?? null });
    show(current);
  });
  update();
  // Kept short above the field, so the field and what it gives back stay above the keyboard.
  return [
    ...(group ? [groupLine(group)] : []),
    question,
    what(lift),
    fields,
    problem,
    out,
    toggle,
    box,
  ];
}

/** "Show my ladder": the first record from the answers, the meets answer as the Ladder's tab, and the draft gone. */
function finish() {
  const d = draft();
  const { session } = store.getState();
  const record = L.draftRecord(d, session.today, L.newId("test"));
  if (!record) return;
  const experience = L.draftGroup(rungsData, d)?.experience ?? L.COMPETED[d.competed];
  // How it was finished, for the anonymous counts (never the numbers).
  track(d.via === "quick" ? "first-visit/done-quick" : "first-visit/done-steps");
  if (record.sets) track("first-visit/used-sets");
  // The store's subscriber leaves the first visit for the Ladder.
  store.update((s) => ({ entries: [record], settings: { ...s.settings, experience }, session: { ...s.session, experience }, draft: null }));
}

// --- Showing a screen ------------------------------------------------------------------------

/** Shows a first-visit screen (one opened before its answers are in goes to the first one missing). */
export function show(screen) {
  if (!L.canShow(draft(), screen)) {
    location.replace(`#/start/${L.firstMissing(draft())}`);
    return;
  }
  const moved = screen !== current;
  current = screen;
  const body = $("onboard-screen");
  body.replaceChildren(...SCREENS[screen]());
  if (moved) {
    replay(body, "enter");
    track(`first-visit/${screen}`); // once per screen reached, so the counts show where people stop
  }
  // The top bar: Back (not on the welcome screen), the progress bar and, for screen readers, the step.
  // Quick setup is one screen, not step 7 of 11: no bar, and it says what it is.
  const step = L.FIRST_VISIT_STEPS.indexOf(screen);
  // Hidden by visibility, so the button keeps its place in the top bar's grid.
  $("onboard-back").style.visibility = screen === "welcome" ? "hidden" : "";
  $("onboard-bar").replaceChildren(...(step < 0 ? [] : L.FIRST_VISIT_STEPS.map((_, i) => el("span", i <= step ? "done" : ""))));
  $("onboard-count").textContent = step >= 0 ? `Step ${step + 1} of ${L.FIRST_VISIT_STEPS.length}` : screen === "quick" ? "Quick setup, one screen" : "";
  window.scrollTo(0, 0);
  // The first field, so the keypad opens (described by the question, so a screen reader hears that too); on Quick
  // setup the heading, as its first choices come before any field.
  const focus = (screen !== "quick" && body.querySelector("input")) || body.querySelector("h2");
  focus?.focus({ preventScroll: true });
}

/** After "Clear my numbers": the welcome screen, as on a first visit. */
export function resetOnboarding() {
  current = "";
}

export function setupOnboarding(data) {
  rungsData = data;
  $("onboard-back").addEventListener("click", back);
  // How much of the layout the on-screen keyboard covers. While it's open (kb-open) the button stops pinning itself
  // over the content: it follows the field instead, so the field and what it gives back stay above the keyboard
  // (the keyboard's own Go key moves on).
  if (window.visualViewport) {
    const cover = () => {
      const covered = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop);
      document.documentElement.style.setProperty("--kb", `${covered}px`);
      document.documentElement.classList.toggle("kb-open", covered > 120);
    };
    visualViewport.addEventListener("resize", cover);
    visualViewport.addEventListener("scroll", cover);
  }
}
