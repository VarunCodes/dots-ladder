// "What total do I need?" on the Ladder: pick a rung (or type a score) and a bodyweight, and see the total that
// gets you there, how many rungs it climbs, and the same target at the next lighter class. What you type is kept
// in the session (this visit only, never saved). Values come from derive.js; logic lives in ladder.js.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import * as store from "./store.js";
import { derived } from "./derive.js";
import { $, el } from "./dom.js";

const now = () => derived(store.getState());
const plural = (n) => `${n} rung${n === 1 ? "" : "s"}`;

/**
 * Keeps only what you typed or tapped for this visit, with the formula it was typed in (and, for a target, the
 * experience tab), so typing a bodyweight doesn't pin the default target and a new tab starts at its next rung.
 */
function keep(change) {
  store.update((s) => {
    const { formula } = derived(s).profile;
    const prev = s.session.calc?.formula === formula ? s.session.calc : {};
    const tab = "target" in change ? { experience: s.session.experience } : {};
    return { session: { ...s.session, calc: { ...prev, formula, ...change, ...tab } } };
  });
}

/** A field's text from the derived value, unless it's being typed in (rewriting it would eat a trailing "." or "0"). */
function fill(input, text) {
  if (document.activeElement !== input) input.value = text;
}

export function setupCalculator() {
  $("calc-target").addEventListener("input", (e) => keep({ target: e.target.valueAsNumber }));
  $("calc-bw").addEventListener("input", (e) => keep({ bw: e.target.valueAsNumber }));
}

/** "Clears 2 rungs (up to P25).", "Clears every rung.", or where a target at or below your score sits. */
function landsText(c, rungs, formula) {
  if (!rungs.length) return "";
  if (c.climbs > 0) return c.clearsAll ? `Clears ${plural(c.climbs)}: every rung in this group.` : `Clears ${plural(c.climbs)} (up to P${c.reaches.percentile}).`;
  if (c.climbs < 0) return `Below your score now: drops ${plural(-c.climbs)}.`;
  const next = L.nextRung(rungs, c.target);
  return next ? `No new rung. The next is P${next.percentile} · ${S.formatScore(formula, next.score)}.` : "You've already cleared every rung.";
}

/** Redraws the card from the derived values; called with the rest of the Ladder. */
export function renderCalculator(d) {
  const c = d.calculator;
  const { formula } = d.profile;
  const unit = S.FORMULAS[formula].label;
  const rungs = d.group?.rungs ?? [];

  // Quick targets: the next rungs above you, rebuilt only when they change (so a pressed one keeps focus); the one
  // matching the target is pressed.
  $("calc-quick").hidden = !c.targets.length;
  const group = $("calc-targets");
  const key = c.targets.map((r) => `${r.percentile}:${r.score}`).join("|") + formula;
  if (group.dataset.key !== key) {
    group.dataset.key = key;
    group.replaceChildren(
      ...c.targets.map((rung) => {
        const button = el("button", "calc-target", `P${rung.percentile} · ${S.formatScore(formula, rung.score)}`);
        button.type = "button";
        button.setAttribute("aria-label", `P${rung.percentile}, ${S.formatScore(formula, rung.score)} ${unit}`);
        button.addEventListener("click", () => keep({ target: rung.score }));
        return button;
      }),
    );
  }
  c.targets.forEach((rung, i) => group.children[i].setAttribute("aria-pressed", String(Math.abs(rung.score - c.target) < 1e-9)));

  $("calc-target-label").textContent = `Target ${unit}`;
  fill($("calc-target"), Number.isFinite(c.target) ? S.formatScore(formula, c.target) : "");
  fill($("calc-bw"), Number.isFinite(c.bw) ? c.bw.toFixed(1) : "");
  const [low, high] = L.CALC_SCORE_LIMITS;
  const [lowBw, highBw] = L.LIMITS.bodyweight;
  const problemText = { target: `Target must be ${low}–${high}.`, bw: `Bodyweight must be ${lowBw}–${highBw} kg.` };
  $("calc-target").setCustomValidity(c.problems.includes("target") ? problemText.target : "");
  $("calc-bw").setCustomValidity(c.problems.includes("bw") ? problemText.bw : "");

  if (c.problems.length) {
    $("calc-total").textContent = "–";
    $("calc-gap").textContent = "";
    $("calc-lands").textContent = "";
    $("calc-note").textContent = c.problems.map((name) => problemText[name]).join(" ");
    return;
  }
  $("calc-total").textContent = `${c.needed} kg`;
  $("calc-gap").textContent = c.gap > 0 ? `+${c.gap} kg` : "Your total holds it";
  $("calc-lands").textContent = landsText(c, rungs, formula);
  const lighter = c.lighter ? ` At ${c.lighter.kg}\u00a0kg you'd need ${c.lighter.needed}\u00a0kg instead.` : "";
  $("calc-note").textContent = `Rounded up to 2.5 kg.${lighter}`;
}
