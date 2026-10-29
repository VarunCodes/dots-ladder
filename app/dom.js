// Small DOM helpers shared by app.js, log.js and events.js.
import { FORMULAS, FORMULA_IDS } from "./scoring.js";

export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The DOTS / GL buttons for a score toggle; picking the one not shown calls onPick with its id. */
export function formulaButtons(current, onPick) {
  return FORMULA_IDS.map((id) => {
    const button = el("button", "formula-option", FORMULAS[id].label);
    button.type = "button";
    button.setAttribute("aria-pressed", id === current);
    button.addEventListener("click", () => {
      if (id !== current) onPick(id);
    });
    return button;
  });
}
