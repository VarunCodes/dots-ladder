// Your data (on Progress): back up everything to a file, restore one, and clear your numbers by holding a button.
// Nothing leaves the phone unless you move the file yourself. The first visit's welcome screen has a "Restore from
// a backup" link too (onboarding.js calls chooseBackup), so a new phone can start from a backup. The store reads
// and checks the file; this is the page wiring.
import * as L from "./ladder.js";
import * as store from "./store.js";
import { derived } from "./derive.js";
import { $ } from "./dom.js";
import { fmtDay } from "./events.js";
import { holdFill, holdTimer } from "./hold.js";
import { ask, toast } from "./popup.js";

const now = () => derived(store.getState());
let kept = null; // whether the browser keeps this site's storage when space runs low; null until asked
let askedToKeep = false;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Asks the browser, once you have records, to keep the app's storage rather than clear it when the phone runs low
 * on space. Chrome decides by itself (installed apps usually get it); some browsers ask you.
 */
async function askToKeep() {
  if (askedToKeep || !now().profile) return;
  askedToKeep = true;
  try {
    kept = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    kept = false; // no storage API, or it refused
  }
  if (now().profile) renderYourData();
}

/** The card: when you last backed up (asking for one when it's due), and whether the browser keeps the data. */
export function renderYourData() {
  const s = store.getState();
  const status = L.backupStatus(s.settings, s.entries, s.session.today);
  $("data-backup").textContent = status.text;
  $("data-backup").classList.toggle("due", status.due);
  $("data-kept").textContent = kept
    ? "Your browser keeps this data, even when the phone is low on space."
    : "Your browser may clear this data if the phone runs low on space, so keep a backup.";
}

// --- Back up ------------------------------------------------------------------------

/** Saves the file through the browser's download, for where the share sheet can't take files. */
function download(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The phone's share sheet where it can take a file (save to Drive, send by email), otherwise a download. Closing
 * the share sheet saves nothing and isn't counted as a backup.
 */
async function backUp() {
  const s = store.getState();
  const { name, text } = store.backupFile(s, s.session.today);
  const file = new File([text], name, { type: "application/json" });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: "DOTS Ladder backup" });
    else download(file);
  } catch (error) {
    if (error.name === "AbortError") return;
    download(file);
  }
  store.update((state) => ({ settings: { ...state.settings, lastBackup: state.session.today } }));
  $("data-note").textContent = "";
  toast(`Backed up · ${plural(s.entries.length, "record")}`);
}

// --- Restore ------------------------------------------------------------------------

let noteFor = null; // where a problem with the chosen file is shown: Your data's note, or the first visit's

/** Opens the file picker; the chosen file is read, checked and confirmed before anything changes. */
export function chooseBackup(note) {
  noteFor = note;
  note.textContent = "";
  $("data-file").value = "";
  $("data-file").click();
}

async function restore(file) {
  if (!file) return;
  const { data, summary, problem } = store.readBackup(await file.text(), now().today);
  if (problem) {
    noteFor.textContent = problem;
    return;
  }
  const had = Boolean(now().profile);
  const what = [plural(summary.records, "record"), ...(summary.events ? [plural(summary.events, "event")] : [])].join(" and ");
  const text =
    `Backed up ${fmtDay(summary.exported)}: ${what}, the latest from ${fmtDay(summary.latest)}.` +
    (had ? " It replaces everything on this phone." : "");
  if (!(await ask({ title: "Restore this backup?", text, action: "Restore" }))) return;
  const { ok, saved } = store.update(() => data);
  if (!ok) {
    noteFor.textContent = "This backup has been changed or damaged, so it can't be restored. Your numbers haven't changed.";
    return;
  }
  // Leaving the first visit re-routes by itself; from Progress, the restored Ladder is the place to land.
  if (location.hash !== "#/ladder") location.hash = "#/ladder";
  toast(saved ? `Restored · ${plural(summary.records, "record")}` : "Restored, but it couldn't be saved on this phone");
}

// --- Hold to clear --------------------------------------------------------------------

/** "Hold to clear my numbers": 3 seconds of touch, mouse, Space or Enter; letting go early clears nothing. */
function setupHoldToClear() {
  const button = $("clear-numbers");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const timer = holdTimer({
    onProgress: (progress) => {
      button.style.setProperty("--hold", holdFill(progress, reduced.matches));
      button.classList.toggle("holding", progress > 0);
    },
    onDone: () => {
      button.style.setProperty("--hold", 0);
      button.classList.remove("holding");
      if (!now().profile) return; // already cleared
      // The store forgets your records and settings; its subscriber goes back to the first-visit form.
      store.clearNumbers();
      toast("Your numbers were cleared from this phone");
    },
    clock: () => performance.now(),
    frame: (tick) => requestAnimationFrame(tick),
    cancelFrame: (id) => cancelAnimationFrame(id),
  });

  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    button.setPointerCapture(event.pointerId);
    timer.start();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(type, () => timer.cancel());
  button.addEventListener("contextmenu", (event) => event.preventDefault()); // a long press opens no menu
  button.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault(); // no click: only a held key counts
    if (!event.repeat) timer.start();
  });
  button.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Enter") timer.cancel();
  });
  button.addEventListener("blur", () => timer.cancel());
}

export function setupYourData() {
  $("data-export").addEventListener("click", backUp);
  $("data-import").addEventListener("click", () => chooseBackup($("data-note")));
  $("data-file").addEventListener("change", () => restore($("data-file").files[0]));
  setupHoldToClear();
  askToKeep();
  store.subscribe(askToKeep); // after the first record is saved, or a backup restored
}
