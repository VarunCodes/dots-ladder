// Page wiring: loads the two data files, then renders with the pure logic in ladder.js.
import * as L from "./ladder.js";

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const fmtDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Meets are stored to the month only ("YYYY-MM"), so the page never shows the day.
const fmtMonth = (yearMonth) =>
  new Date(`${yearMonth}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

const rungLabel = ({ percentile }) => (percentile === 50 ? "Median" : `Beats ${percentile}%`);

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

/** Scores to place on the ladder alongside the rungs: now, the meet plan, projections. */
function markers(me, profile) {
  const { sex, bodyweight: bw } = profile;
  const list = [{ label: "You now", dots: L.dots(sex, bw, L.sumLifts(profile)), kind: "now" }];

  const meet = me.meets.find((m) => m.result == null && m.plannedAttempts);
  if (meet) {
    const thirds = Object.fromEntries(L.LIFTS.map((lift) => [lift, meet.plannedAttempts[lift].at(-1)]));
    list.push({ label: `Meet plan, ${fmtMonth(meet.month)}`, dots: L.dots(sex, bw, L.sumLifts(thirds)), kind: "plan" });
  }

  for (const [name, projection] of Object.entries(me.projections ?? {})) {
    if (!projection.May2027) continue;
    list.push({ label: `May 2027, ${name}`, dots: L.dots(sex, bw, L.sumLifts(projection.May2027)), kind: "projection" });
  }
  return list;
}

function renderNow(profile) {
  const total = L.sumLifts(profile);
  const score = L.dots(profile.sex, profile.bodyweight, total);
  $("now-dots").textContent = score.toFixed(1);
  $("now-detail").textContent =
    `${total} kg total (S ${profile.squat} / B ${profile.bench} / D ${profile.deadlift}) at ${profile.bodyweight} kg bodyweight.`;
  return score;
}

function renderNext(profile, score, group, experience) {
  const { sex, bodyweight: bw } = profile;
  const target = $("next-rung");
  target.replaceChildren();
  const next = L.nextRung(group.rungs, score);
  if (!next) {
    target.textContent = `You're above every rung for ${experience} lifters. Try the next group up.`;
    return;
  }
  const kg = L.totalForDots(sex, bw, next.dots) - L.totalForDots(sex, bw, score);
  target.append(
    el("strong", null, `${rungLabel(next)} of ${experience} lifters: ${next.dots} DOTS`),
    el("span", "muted", ` · ${(next.dots - score).toFixed(1)} DOTS to go, about +${Math.ceil(kg * 2) / 2} kg on your total at ${bw} kg.`),
  );
}

function renderLadder(group, points, score) {
  const items = [
    ...group.rungs.map((r) => ({ ...r, label: rungLabel(r), kind: "rung" })),
    ...points,
  ].sort((x, y) => y.dots - x.dots || (x.kind === "rung") - (y.kind === "rung"));

  const ladder = $("ladder");
  ladder.replaceChildren(
    ...items.map((item) => {
      const reached = item.kind === "rung" && score >= item.dots;
      const li = el("li", `step ${item.kind}${reached ? " reached" : ""}`);
      const shown = item.kind === "rung" ? String(item.dots) : item.dots.toFixed(1);
      li.append(el("span", "step-label", item.label), el("span", "step-dots", shown));
      return li;
    }),
  );
}

/** Redraws everything except the form, for the current profile and experience tab. */
function render(rungsData, me, state) {
  const { profile, experience } = state;
  const wclass = L.effectiveClass(profile);
  const score = renderNow(profile);
  const group = L.rungsFor(rungsData, profile.sex, wclass, experience);
  const tabs = $("experience");

  tabs.replaceChildren(
    ...L.EXPERIENCE.map((name) => {
      const button = el("button", "tab", name);
      button.type = "button";
      button.setAttribute("aria-pressed", name === experience);
      button.addEventListener("click", () => render(rungsData, me, Object.assign(state, { experience: name })));
      return button;
    }),
  );

  const chosen = profile.weightClass ? " (chosen)" : "";
  $("subtitle").textContent = `${me.equipment} · ${wclass} kg class${chosen} · ${profile.bodyweight} kg bodyweight`;

  if (!group) {
    $("group-note").textContent = `Not enough ${experience} lifters in the ${wclass} kg class to publish rungs.`;
    $("ladder").replaceChildren();
    $("next-rung").textContent = "";
    return;
  }
  $("group-note").textContent =
    `${profile.sex === "M" ? "Men" : "Women"}, ${wclass} kg class, ${experience}: ${group.lifters} lifters.`;
  renderNext(profile, score, group, experience);
  renderLadder(group, markers(me, profile), score);
}

/** localStorage, or null where the browser blocks it; the ladder.js helpers treat null as "nothing saved". */
function deviceStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function fillForm(form, profile) {
  for (const name of ["sex", "bodyweight", ...L.LIFTS]) form.elements[name].value = profile[name];
  fillClassSelect(form, profile);
}

/** Rebuilds the class dropdown for the sex; its "auto" option shows the class the bodyweight gives. */
function fillClassSelect(form, profile) {
  const auto = L.weightClass(profile.sex, profile.bodyweight);
  form.elements.weightClass.replaceChildren(
    new Option(`Auto from bodyweight: ${auto} kg`, ""),
    ...L.weightClasses(profile.sex).map((c) => new Option(`${c} kg`, c)),
  );
  form.elements.weightClass.value = profile.weightClass ?? "";
  renderClassNote(profile);
}

function renderClassNote(profile) {
  const limit = L.overClassLimit(profile);
  $("class-note").textContent = limit
    ? `To lift in this class you'd need to weigh in at ${limit} kg or under (you're ${profile.bodyweight} kg).`
    : profile.weightClass
      ? `Comparing against the ${profile.weightClass} kg class.`
      : "Worked out from your bodyweight. Pick a class to compare against a different one.";
}

function setupForm(rungsData, me, state, defaults, storage) {
  const form = $("profile-form");
  const saved = (ok) => {
    $("save-note").textContent = ok ? "Saved on this device only." : "Couldn't save on this device; changes last until you close the page.";
  };
  fillForm(form, state.profile);

  form.addEventListener("input", (event) => {
    const f = form.elements;
    // Classes differ by sex, so a sex change goes back to working the class out from bodyweight.
    if (event.target === f.sex) f.weightClass.value = "";
    const profile = L.validProfile({
      sex: f.sex.value,
      bodyweight: f.bodyweight.valueAsNumber,
      ...Object.fromEntries(L.LIFTS.map((lift) => [lift, f[lift].valueAsNumber])),
      weightClass: f.weightClass.value || null,
    });
    if (!profile) {
      $("save-note").textContent = "Check the highlighted values; nothing is saved until they're valid.";
      return;
    }
    state.profile = profile;
    // Only the dropdown is refilled: rewriting an input while it's being typed in would eat a trailing "." or "0".
    fillClassSelect(form, profile);
    saved(L.saveProfile(storage, profile));
    render(rungsData, me, state);
  });

  $("reset").addEventListener("click", () => {
    try {
      storage?.removeItem(L.PROFILE_KEY);
    } catch {
      // Nothing saved to clear.
    }
    state.profile = defaults;
    fillForm(form, defaults);
    $("save-note").textContent = "Back to the defaults from my-lifts.json.";
    render(rungsData, me, state);
  });
}

try {
  const [rungsData, me] = await Promise.all([loadJson("data/rungs.json"), loadJson("data/my-lifts.json")]);
  const storage = deviceStorage();
  const defaults = L.defaultProfile(me);
  const profile = L.loadProfile(storage, defaults);
  if (!profile) throw new Error("my-lifts.json needs a sex, bodyweight, squat, bench and deadlift");
  const state = { profile, experience: L.experienceBucket(me.meets) };
  if (rungsData.snapshot) $("snapshot").textContent = `, snapshot ${fmtDate(rungsData.snapshot)}`;
  setupForm(rungsData, me, state, defaults, storage);
  render(rungsData, me, state);
} catch (error) {
  $("error").hidden = false;
  $("error").textContent = `Couldn't load the data (${error.message}). If you opened the file directly, serve the folder instead: python3 -m http.server`;
  $("subtitle").textContent = "";
}
