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
const LIFT_WHAT = {
  squat: "Barbell back squat, with the bar on your back.",
  bench: "Barbell bench press, lying on a flat bench.",
  deadlift: "Barbell deadlift, from the floor. Conventional or sumo.",
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

const groupLine = (group) => {
  const p = el("p", "fv-group", "Compared with UK ");
  p.append(el("strong", "", L.groupWords(group)));
  return p;
};

const credit = () => {
  const p = el("p", "fv-credit", "Real results from ");
  const a = Object.assign(el("a", "", "OpenPowerlifting"), { href: "https://www.openpowerlifting.org/" });
  p.append(a, ", groups of 20+ lifters, no individual lifters.");
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
    const privacy = el("p", "fv-private", "Nothing you enter leaves this phone. ");
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
    const { wrap, input } = numberField("Bodyweight", { id: "fv-bw", value: d.bodyweight, placeholder: d.sex === "F" ? 63 : 80, enterKey: "go" });
    const problem = el("p", "fv-problem small");
    const out = el("div", "fv-out");
    const { box, button } = actions("Next", () => go("competed"), { disabled: true });
    const update = () => {
      const bw = input.valueAsNumber;
      const ok = bw >= L.LIMITS.bodyweight[0] && bw <= L.LIMITS.bodyweight[1];
      // Flagged only once two digits are typed, so one digit is never an error.
      problem.textContent = !ok && input.value.replace(/\D/g, "").length >= 2 ? `Enter a bodyweight from ${L.LIMITS.bodyweight.join(" to ")} kg.` : "";
      button.disabled = !ok;
      out.replaceChildren();
      if (!ok) return;
      answer(() => ({ bodyweight: bw }));
      const wclass = L.weightClass(d.sex, bw);
      out.append(card(`You're in the ${wclass.endsWith("+") ? `${wclass.slice(0, -1)}+` : wclass} kg class`, `Lifters from ${L.classRange(d.sex, wclass)}, like at a meet.`));
    };
    input.addEventListener("input", update);
    input.addEventListener("keydown", (e) => e.key === "Enter" && !button.disabled && go("competed"));
    update();
    return [heading("What do you weigh?"), el("p", "fv-lede", "Heavier lifters tend to lift more, so you're compared with people around your weight."), wrap, problem, out, box];
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
      choice("Once", "Compared with lifters at their second meet.", d.competed === "once", pick("once")),
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
      dd.append(el("span", "", `+${S.formatScore("dots", row.change)}`));
      div.append(el("dt", "", row.label), dd);
      sum.append(div);
    }
    return [
      heading("Your score"),
      head,
      el("p", "fv-lede", "DOTS turns your total and your bodyweight into one number. Heavier lifters need a bigger total to get the same score, so it measures how strong you are for your size."),
      el("p", "fv-subhead", "Two ways to raise it"),
      sum,
      el("p", "fv-note", words.gymGoer),
      actions("Next", () => go("target")).box,
    ];
  },

  target() {
    const d = draft();
    const profile = L.draftProfile(d);
    const group = L.draftGroup(rungsData, d);
    const next = actions("Next", () => go("next")).box;
    if (!group) return [heading("Your next target"), el("p", "fv-lede", "Without enough lifters in your class to compare, every test is about beating your own best."), next];
    const words = L.targetWords(profile, group);
    const sum = el("dl", "fv-sum");
    for (const row of words.lifts) {
      const div = el("div");
      const dd = el("dd", "", row.kg == null ? "Top rung" : kg(row.kg));
      if (row.kg != null) dd.append(el("span", "", `+${kg(row.add)} · ${row.words}`));
      div.append(el("dt", "", LIFT_TITLES[row.lift]), dd);
      sum.append(div);
    }
    if (!words.add) return [heading(words.title), el("p", "fv-lede", "From here, every test is about beating your own best. Each lift's next rung:"), sum, credit(), next];
    const number = el("p", "fv-number", `+${Number(words.add.toFixed(1))}`);
    number.append(el("small", "", "kg"));
    const statement = el("p", "fv-statement", words.title);
    return [
      heading("Your next target"),
      number,
      statement,
      el("p", "fv-lede", `${words.onLadder ? `That's a ${kg(words.total)} total.` : `That's the first rung: a ${kg(words.total)} total.`} Any mix of the three lifts counts. Or lift by lift:`),
      sum,
      credit(),
      next,
    ];
  },

  next() {
    // What's waiting inside, each a real feature: Lift balance on the Ladder, the Progress chart, Log test.
    const points = el("ul", "fv-points");
    for (const [title, text] of [
      ["Where to improve", "Your biggest opportunity among the three lifts, and the kilos to its next rung."],
      ["Your climb", "Every test on one chart (score, lifts or bodyweight), with each rung you pass marked."],
      ["Quick logging", "A new squat PR or a full test in seconds, with the rungs it climbs shown before you save."],
    ]) {
      const li = el("li");
      li.append(el("strong", "", title), text);
      points.append(li);
    }
    return [
      heading("When you beat it, log it here"),
      el("p", "fv-lede", "Your ladder is ready. Inside:"),
      points,
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
    const lifts = Object.fromEntries(L.LIFTS.map((lift) => [lift, numberField(lift === "bench" ? "Bench" : LIFT_TITLES[lift], { id: `fv-q-${lift}`, value: d.lifts[lift]?.mode === "max" ? d.lifts[lift].kg : null, unit: "" })]));
    const grid = el("div", "fv-quick-lifts");
    grid.append(...L.LIFTS.map((lift) => lifts[lift].wrap));
    const { box, button } = actions("See where I stand", () => go("standing"), { disabled: true });
    const update = () => {
      const values = Object.fromEntries(L.LIFTS.map((lift) => [lift, lifts[lift].input.valueAsNumber]));
      const weight = bw.input.valueAsNumber;
      const now = draft();
      const ok = now.sex && now.competed && weight >= L.LIMITS.bodyweight[0] && weight <= L.LIMITS.bodyweight[1] && L.LIFTS.every((lift) => !L.liftEntryProblem({ kg: values[lift], mode: "max" }));
      button.disabled = !ok;
      if (ok) answer(() => ({ via: "quick", mode: "max", bodyweight: weight, lifts: Object.fromEntries(L.LIFTS.map((lift) => [lift, { mode: "max", kg: values[lift], reps: null }])) }));
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
  const p = el("p", "fv-what");
  p.append(el("strong", "", LIFT_WHAT[lift]), " Dumbbell, Smith machine or leg press numbers aren't comparable.");
  return p;
}

/** One lift per screen: a max, or a set (kg × reps) and its estimate, then where it places you once it's in. */
function liftScreen(lift) {
  const d = draft();
  const entry = d.lifts[lift] ?? { mode: d.mode ?? "max", kg: null, reps: null };
  const setMode = entry.mode === "set";
  const nextScreen = L.FIRST_VISIT_STEPS[L.FIRST_VISIT_STEPS.indexOf(lift) + 1];
  const group = L.draftGroup(rungsData, d);
  const weight = numberField(setMode ? "Weight" : "Max", { id: "fv-kg", value: entry.kg, placeholder: PLACEHOLDER[lift], enterKey: setMode ? "next" : "go" });
  const fields = el("div", "fv-fields");
  fields.append(weight.wrap);
  let reps = null;
  if (setMode) {
    reps = numberField("Reps", { id: "fv-reps", value: entry.reps ?? 5, unit: "", inputMode: "numeric", enterKey: "go", className: "fv-reps" });
    const times = el("span", "fv-times", "×");
    times.setAttribute("aria-hidden", "true");
    fields.append(times, reps.wrap);
  }
  const problem = el("p", "fv-problem small");
  problem.setAttribute("role", "status");
  const out = el("div", "fv-out");
  const nextLabel = lift === "deadlift" ? "See where I stand" : `Next: ${LIFT_TITLES[nextScreen].toLowerCase()}`;
  const { box, button } = actions(nextLabel, () => go(nextScreen), { disabled: true });

  const update = () => {
    const now = { mode: entry.mode, kg: Number.isFinite(weight.input.valueAsNumber) ? weight.input.valueAsNumber : null, reps: reps ? (Number.isFinite(reps.input.valueAsNumber) ? reps.input.valueAsNumber : null) : null };
    answerLift(lift, now);
    const issue = L.liftEntryProblem(now);
    // A weight is flagged once it has two digits; reps as soon as they're wrong.
    const show = issue && (issue !== "kg" || weight.input.value.replace(/\D/g, "").length >= 2);
    problem.textContent = show ? L.LIFT_ENTRY_TEXT[issue] : "";
    button.disabled = Boolean(issue);
    out.replaceChildren();
    if (issue) return;
    const max = L.draftMax(draft(), lift);
    const est = L.draftEstimated(draft(), lift) ? `Estimated max: ${kg(max)}, from ${kg(now.kg)} × ${now.reps}` : "";
    const words = group?.lifts[lift]?.length ? L.liftPlaceWords(lift, max, group) : null;
    out.append(card(words?.title, words?.more, est));
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
    answerLift(lift, { mode: setMode ? "max" : "set", reps: entry.reps ?? 5 });
    show(current);
  });
  update();
  return [
    ...(group ? [groupLine(group)] : []),
    heading(`Your best ${LIFT_TITLES[lift].toLowerCase()}`),
    what(lift),
    el("p", "fv-lede small", setMode ? "Your heaviest recent set with good form: the weight, and how many reps." : "The heaviest single you've done recently, with good form."),
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
  const step = screen === "quick" ? L.FIRST_VISIT_STEPS.indexOf("deadlift") : L.FIRST_VISIT_STEPS.indexOf(screen);
  // Hidden by visibility, so the button keeps its place in the top bar's grid.
  $("onboard-back").style.visibility = screen === "welcome" ? "hidden" : "";
  $("onboard-bar").replaceChildren(...(screen === "welcome" ? [] : L.FIRST_VISIT_STEPS.map((_, i) => el("span", i <= step ? "done" : ""))));
  $("onboard-count").textContent = step >= 0 ? `Step ${step + 1} of ${L.FIRST_VISIT_STEPS.length}` : "";
  window.scrollTo(0, 0);
  const focus = body.querySelector("input") ?? body.querySelector("h2");
  focus?.focus({ preventScroll: true });
}

/** After "Clear my numbers": the welcome screen, as on a first visit. */
export function resetOnboarding() {
  current = "";
}

export function setupOnboarding(data) {
  rungsData = data;
  $("onboard-back").addEventListener("click", back);
  // Keep the pinned button above the on-screen keyboard: how much of the layout the keyboard covers.
  if (window.visualViewport) {
    const cover = () => document.documentElement.style.setProperty("--kb", `${Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop)}px`);
    visualViewport.addEventListener("resize", cover);
    visualViewport.addEventListener("scroll", cover);
  }
}
