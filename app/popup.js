// The app's two pop-ups, so every one looks and moves the same: a toast that slides in at the top and goes by
// itself, and a dialog that asks before something changes (in place of the browser's own confirm box).
import { $, el } from "./dom.js";

const TOAST_MS = 4000;
let toastTimer = null;

/** Shows a short note at the top of the screen ("Saved · PR on squat"), with the accent check; tapping it closes it early. */
export function toast(text) {
  const region = $("toasts");
  clearTimeout(toastTimer);
  const note = el("button", "toast");
  note.type = "button";
  note.innerHTML = '<svg class="saved-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" pathLength="1"/></svg>';
  note.append(el("span", "", text));
  note.addEventListener("click", () => closeToast(note));
  region.replaceChildren(note);
  toastTimer = setTimeout(() => closeToast(note), TOAST_MS);
}

/** Fades a toast out, then removes it (at once with no animation, e.g. reduced motion off the page). */
function closeToast(note) {
  if (!note.isConnected || note.classList.contains("leaving")) return;
  note.classList.add("leaving");
  const remove = () => note.remove();
  note.addEventListener("animationend", remove, { once: true });
  if (getComputedStyle(note).animationName === "none") remove();
}

/**
 * Asks before a change, in the app's own dialog: a title, a line of what happens, and the action named on its
 * button. Resolves true for the action, false for Cancel, Escape or a tap outside. Cancel has focus, so a stray
 * Enter keeps things as they are.
 */
export function ask({ title, text, action }) {
  const dialog = el("dialog", "dialog");
  const panel = el("div", "dialog-panel");
  const heading = el("h2", "dialog-title", title);
  heading.id = "dialog-title";
  const body = el("p", "dialog-text", text);
  body.id = "dialog-text";
  const cancel = el("button", "button", "Cancel");
  cancel.type = "button";
  cancel.autofocus = true;
  const confirm = el("button", "primary", action);
  confirm.type = "button";
  const actions = el("div", "dialog-actions");
  actions.append(cancel, confirm);
  panel.append(heading, body, actions);
  dialog.append(panel);
  dialog.setAttribute("aria-labelledby", heading.id);
  dialog.setAttribute("aria-describedby", body.id);
  document.body.append(dialog);

  return new Promise((resolve) => {
    const close = (answer) => {
      if (!dialog.open) return;
      dialog.close();
      resolve(answer);
      // Removed once its close transition has played (or straight away when there's none).
      const ms = parseFloat(getComputedStyle(dialog).transitionDuration) * 1000 || 0;
      setTimeout(() => dialog.remove(), ms);
    };
    cancel.addEventListener("click", () => close(false));
    confirm.addEventListener("click", () => close(true));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault(); // Escape: close through the same path, so it animates out too
      close(false);
    });
    // A tap on the dimmed backdrop lands on the dialog itself, outside its panel.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) close(false);
    });
    dialog.showModal();
  });
}
