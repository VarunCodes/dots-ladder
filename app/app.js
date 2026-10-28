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
function markers(me, bw) {
  const list = [];
  const lifts = L.currentLifts(me.bests);
  if (lifts) list.push({ label: "You now", dots: L.dots(me.sex, bw, L.sumLifts(lifts)), kind: "now" });

  const meet = me.meets.find((m) => m.result == null && m.plannedAttempts);
  if (meet) {
    const thirds = Object.fromEntries(L.LIFTS.map((lift) => [lift, meet.plannedAttempts[lift].at(-1)]));
    list.push({ label: `Meet plan, ${fmtMonth(meet.month)}`, dots: L.dots(me.sex, bw, L.sumLifts(thirds)), kind: "plan" });
  }

  for (const [name, projection] of Object.entries(me.projections ?? {})) {
    if (!projection.May2027) continue;
    list.push({ label: `May 2027, ${name}`, dots: L.dots(me.sex, bw, L.sumLifts(projection.May2027)), kind: "projection" });
  }
  return list;
}

function renderNow(me, bw) {
  const lifts = L.currentLifts(me.bests);
  if (!lifts) {
    $("now-detail").textContent = "Log a squat, bench and deadlift to see your DOTS.";
    return null;
  }
  const total = L.sumLifts(lifts);
  const score = L.dots(me.sex, bw, total);
  $("now-dots").textContent = score.toFixed(1);
  $("now-detail").textContent =
    `${total} kg total (S ${lifts.squat} / B ${lifts.bench} / D ${lifts.deadlift}) at ${bw} kg bodyweight, from gym bests.`;
  return score;
}

function renderNext(me, bw, score, group, experience) {
  const target = $("next-rung");
  target.replaceChildren();
  if (score == null) return;
  const next = L.nextRung(group.rungs, score);
  if (!next) {
    target.textContent = `You're above every rung for ${experience} lifters. Try the next group up.`;
    return;
  }
  const kg = L.totalForDots(me.sex, bw, next.dots) - L.totalForDots(me.sex, bw, score);
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
      const reached = item.kind === "rung" && score != null && score >= item.dots;
      const li = el("li", `step ${item.kind}${reached ? " reached" : ""}`);
      const shown = item.kind === "rung" ? String(item.dots) : item.dots.toFixed(1);
      li.append(el("span", "step-label", item.label), el("span", "step-dots", shown));
      return li;
    }),
  );
}

function render(rungsData, me) {
  const bw = L.latestBodyweight(me.bodyweightLog);
  const wclass = L.weightClass(me.sex, bw);
  const points = markers(me, bw);
  const score = renderNow(me, bw);
  const tabs = $("experience");

  const show = (experience) => {
    const group = L.rungsFor(rungsData, me.sex, wclass, experience);
    for (const button of tabs.children) button.setAttribute("aria-pressed", button.dataset.experience === experience);
    if (!group) {
      $("group-note").textContent = `Not enough ${experience} lifters in this class to publish rungs.`;
      $("ladder").replaceChildren();
      $("next-rung").textContent = "";
      return;
    }
    $("group-note").textContent =
      `${me.sex === "M" ? "Men" : "Women"}, ${wclass} kg class, ${experience}: ${group.lifters} lifters.`;
    renderNext(me, bw, score, group, experience);
    renderLadder(group, points, score);
  };

  tabs.replaceChildren(
    ...L.EXPERIENCE.map((experience) => {
      const button = el("button", "tab", experience);
      button.type = "button";
      button.dataset.experience = experience;
      button.addEventListener("click", () => show(experience));
      return button;
    }),
  );

  $("subtitle").textContent = `${me.equipment} · ${wclass} kg class · ${bw} kg bodyweight`;
  if (rungsData.snapshot) $("snapshot").textContent = `, snapshot ${fmtDate(rungsData.snapshot)}`;
  show(L.experienceBucket(me.meets));
}

try {
  const [rungsData, me] = await Promise.all([loadJson("data/rungs.json"), loadJson("data/my-lifts.json")]);
  render(rungsData, me);
} catch (error) {
  $("error").hidden = false;
  $("error").textContent = `Couldn't load the data (${error.message}). If you opened the file directly, serve the folder instead: python3 -m http.server`;
  $("subtitle").textContent = "";
}
