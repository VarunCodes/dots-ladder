// Small DOM helpers shared by app.js, log.js and events.js.
import { FORMULAS, FORMULA_IDS } from "./scoring.js";

export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const picks = new WeakMap();

/**
 * A row of choices shown as pressed buttons ("DOTS | GL", the experience tabs, the chart views). The buttons are
 * built once and then updated in place, so their transitions play; the chosen one is marked by an indicator (the
 * group's ::before) that slides to it. `options` are [value, label] pairs; picking one not chosen calls onPick.
 */
export function choiceGroup(group, className, options, current, onPick) {
  picks.set(group, onPick);
  const key = options.map(([value]) => value).join("|");
  if (group.dataset.options !== key) {
    group.dataset.options = key;
    group.classList.add("slide");
    group.replaceChildren(
      ...options.map(([value]) => {
        const button = el("button", className);
        button.type = "button";
        button.addEventListener("click", () => {
          if (button.getAttribute("aria-pressed") !== "true") picks.get(group)(value);
        });
        return button;
      }),
    );
    // Its buttons change width with the screen (and from nothing when a hidden screen opens): re-place, unanimated.
    new ResizeObserver(() => placeIndicator(group, false)).observe(group);
  }
  options.forEach(([value, label], i) => {
    const button = group.children[i];
    button.textContent = label;
    button.setAttribute("aria-pressed", String(value === current));
  });
  placeIndicator(group, true);
}

/** Moves a group's indicator under its chosen button; the first placement (and `animate` false) doesn't slide. */
function placeIndicator(group, animate) {
  const chosen = group.querySelector('[aria-pressed="true"]');
  if (!chosen?.offsetWidth) return; // hidden: placed when it's shown
  const still = !animate || !group.classList.contains("slide-ready");
  group.classList.toggle("slide-still", still);
  group.style.setProperty("--ind-x", `${chosen.offsetLeft}px`);
  group.style.setProperty("--ind-y", `${chosen.offsetTop}px`);
  group.style.setProperty("--ind-w", `${chosen.offsetWidth}px`);
  group.style.setProperty("--ind-h", `${chosen.offsetHeight}px`);
  if (still) {
    void group.offsetWidth; // apply the position before transitions come back on
    group.classList.add("slide-ready");
    group.classList.remove("slide-still");
  }
}

/** The DOTS / GL toggle in a group; picking the one not shown calls onPick with its id. */
export function formulaChoice(group, current, onPick) {
  choiceGroup(group, "formula-option", FORMULA_IDS.map((id) => [id, FORMULAS[id].label]), current, onPick);
}

/** Plays a one-off CSS animation class again from the start (e.g. "enter" on a screen), removing it when done. */
export function replay(node, className) {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
  node.addEventListener("animationend", () => node.classList.remove(className), { once: true });
}

/** Sets a headline number; a change from one value to another fades the new one in ("swap"). */
export function setNumber(node, text) {
  const before = node.textContent;
  node.textContent = text;
  if (before !== text && before !== "–" && before !== "") replay(node, "swap");
}
