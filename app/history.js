// The "1RMs" list on Log test: every record, newest first (the latest few, or all of them), each editable. Its
// numbers come from derive.js and changes go through the store; logic lives in ladder.js. This file only renders.
import * as L from "./ladder.js";
import * as S from "./scoring.js";
import * as store from "./store.js";
import { derived } from "./derive.js";
import { $, el } from "./dom.js";
import { fmtDay } from "./events.js";
import { ask } from "./popup.js";

const LIFT_NAMES = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };
const SEX_WORDS = { M: "Men's", F: "Women's" };

const now = () => derived(store.getState());
const capital = (text) => text && text[0].toUpperCase() + text.slice(1);
let showAll = false; // the "Show all" button lists every record; opening the screen goes back to the latest few

// --- 1RMs: newest first, each editable ------------------------------------------------------
// Each row is one saved record: a 1RM test (all three lifts), a single 1RM ("Squat 1RM"), or a bodyweight.
// Opening it shows only the values it logged (the rest were carried from earlier records); valid changes
// save straight away, and closing it with invalid values undoes them.

const TEST_TEXT = {
  date: "Pick the day of the test (not a future one).",
  sex: "Choose men or women.",
  bodyweight: `Bodyweight must be ${L.LIMITS.bodyweight.join("–")} kg.`,
  ...Object.fromEntries(L.LIFTS.map((lift) => [lift, `${LIFT_NAMES[lift]} must be ${L.LIMITS.lift.join("–")} kg.`])),
};
const DELETE_TEXT = {
  only: "Your only record. To start over, use “Clear my numbers” on Log test.",
  earliest: "Your first record must hold bodyweight and all three lifts, and the next one doesn't.",
};

/** A record's name mid-sentence: "squat 1RM", "1RM test", "bodyweight". */
const lowerName = (record) => L.recordName(record).replace(/^(?!1RM)\w/, (c) => c.toLowerCase());

/** A form control inside its label. */
function labelled(text, control, className) {
  const label = el("label", className, text);
  label.append(control);
  return label;
}

function numberInput(name, [min, max]) {
  return Object.assign(el("input"), { name, type: "number", inputMode: "decimal", step: "any", min, max, required: true });
}

/** The closed row: the date, what was logged ("Squat 1RM · 150 kg"), a PR badge, and the score, filled in by refreshTestSummaries. */
function testSummary() {
  const summary = el("summary");
  const head = el("span", "test-head");
  head.append(el("span", "event-title"), el("span", "test-sub muted small"));
  summary.append(head, el("span", "event-score"));
  return summary;
}

/** The open row: date, sex and the values this record logged, a note on what it carried, a status line, and "Delete". */
function testForm(record) {
  const form = el("form", "fields");
  form.autocomplete = "off";
  const date = Object.assign(el("input"), { name: "date", type: "date", required: true, max: now().today, min: L.EARLIEST_DATE });
  const sex = el("select");
  sex.name = "sex";
  sex.append(new Option("Men", "M"), new Option("Women", "F"));
  const logged = L.loggedValues(record);
  const lifts = L.LIFTS.filter((lift) => logged.includes(lift));
  const fields = [labelled("Date", date), labelled("Sex", sex)];
  if (logged.includes("bodyweight")) fields.push(labelled("Bodyweight (kg)", numberInput("bodyweight", L.LIMITS.bodyweight), "wide"));
  if (lifts.length) {
    const row = el("div", lifts.length === 3 ? "trio wide" : "fields-lifts wide");
    row.append(...lifts.map((lift) => labelled(LIFT_NAMES[lift], numberInput(lift, L.LIMITS.lift))));
    fields.push(row);
  }
  const unlogged = L.VALUES.filter((name) => !logged.includes(name));
  if (unlogged.length) fields.push(el("p", "muted small wide", `${capital(unlogged.join(", ").replace(/, ([^,]*)$/, " and $1"))} carried from earlier records.`));
  const note = el("p", "event-note muted small wide");
  note.setAttribute("role", "status");
  const remove = el("button", "link-button wide", `Delete ${lowerName(record)}`);
  remove.type = "button";
  remove.addEventListener("click", () => deleteTest(record.id));
  form.append(...fields, note, remove);
  return form;
}

/** Closing a record with invalid values undoes them; either way the list goes back into date order. */
function onTestClosed(item, form) {
  if (item.open) return;
  if (item.dataset.invalid) {
    fillTest(form, now().tests.find((t) => t.id === item.dataset.id));
    form.querySelector(".event-note").textContent = "Invalid changes were undone.";
  }
  renderTests();
}

/** One row of the list: a summary that opens into the record's form. */
function testItem(record) {
  const item = el("details", "event test");
  item.dataset.id = record.id;
  const form = testForm(record);
  item.append(testSummary(), form);
  fillTest(form, record);
  form.addEventListener("input", () => onTestInput(item, form));
  item.addEventListener("toggle", () => onTestClosed(item, form));
  return item;
}

function fillTest(form, record) {
  const f = form.elements;
  for (const name of ["date", "sex", ...L.loggedValues(record)]) f[name].value = record[name];
  for (const input of form.querySelectorAll("input, select")) input.setCustomValidity("");
  form.closest("details").dataset.invalid = "";
}

/** The record as edited: its date, sex and the values it logged. */
function readTest(form, id) {
  const f = form.elements;
  const logged = L.VALUES.filter((name) => f[name]);
  return { id, date: f.date.value, sex: f.sex.value, ...Object.fromEntries(logged.map((name) => [name, f[name].valueAsNumber])) };
}

/** Saves the records through the store (whose subscriber redraws every screen); says if storage refused. */
function persistTests(tests) {
  const { saved } = store.update(() => ({ entries: tests }));
  $("tests-note").textContent = saved ? "" : "Couldn't save on this device; changes last until you close the page.";
}

function onTestInput(item, form) {
  const raw = readTest(form, item.dataset.id);
  const { tests, today } = now();
  const problems = L.testProblems(raw, today);
  // Moving the record before the first one would leave the history starting without all four values.
  const next = tests.map((t) => (t.id === raw.id ? raw : t));
  if (!problems.length && !L.isComplete(L.sortTests(next)[0])) problems.push("date");
  for (const input of form.querySelectorAll("input, select")) input.setCustomValidity(problems.includes(input.name) ? TEST_TEXT[input.name] : "");
  item.dataset.invalid = problems.length ? "true" : "";
  const note = form.querySelector(".event-note");
  if (problems.length) {
    const firstRule = problems.includes("date") && L.isDay(raw.date) && raw.date <= today ? "Your first record must hold bodyweight and all three lifts." : "";
    note.textContent = `Not saved: ${firstRule || problems.map((name) => TEST_TEXT[name]).join(" ")}`;
    return;
  }
  persistTests(tests.map((t) => (t.id === raw.id ? L.validTest(raw) : t)));
  note.textContent = "Saved on this device only.";
}

async function deleteTest(id) {
  const { tests } = now();
  if (L.deleteProblem(tests, id)) return;
  const record = tests.find((t) => t.id === id);
  const text = `Your ${lowerName(record)} from ${fmtDay(record.date)} goes from this phone.`;
  if (!(await ask({ title: "Delete this record?", text, action: "Delete" }))) return;
  if (!now().tests.some((t) => t.id === id)) return; // already gone (deleted twice)
  persistTests(tests.filter((t) => t.id !== id));
  renderTests(); // the store's refresh leaves the list alone, so the deleted row goes here
}

/** "150 kg" for one value, "150 / 105 kg" for two lifts, "370 kg @ 70 kg" for a test, with bodyweight when it was logged too. */
function loggedText(record) {
  const lifts = L.LIFTS.filter((lift) => lift in record);
  const bw = "bodyweight" in record ? `${record.bodyweight} kg` : "";
  if (lifts.length === 3) return `${L.sumLifts(record)} kg${bw ? ` @ ${bw}` : ""}`;
  if (!lifts.length) return bw;
  const kg = `${lifts.map((lift) => record[lift]).join(" / ")} kg`;
  return bw ? `${kg} @ ${bw}` : kg;
}

/** Each record's date, what it logged, a PR badge and the score at it, without touching its fields. */
function refreshTestSummaries() {
  const { formula } = now().profile;
  const { prs: records, tests, points } = now();
  for (const { id, record, score, otherSex } of points) {
    const item = $("test-list").querySelector(`[data-id="${id}"]`);
    if (!item) continue;
    const title = item.querySelector(".event-title");
    title.textContent = fmtDay(record.date);
    if (records.has(id)) title.append(" ", el("span", "pr-badge", "PR"));
    item.querySelector(".test-sub").textContent = [L.recordName(record), loggedText(record), otherSex ? SEX_WORDS[record.sex] : ""].filter(Boolean).join(" · ");
    item.querySelector(".event-score").textContent = item.dataset.invalid ? "not saved" : S.formatScore(formula, score);
    const problem = L.deleteProblem(tests, id);
    const remove = item.querySelector(".link-button");
    remove.disabled = Boolean(problem);
    remove.title = problem ? DELETE_TEXT[problem] : "";
  }
}

/** Rebuilds the list newest first (the latest few unless "Show all" was pressed), keeping open whichever was open. */
function renderTests() {
  const open = $("test-list").querySelector("details[open]")?.dataset.id;
  const { tests } = now();
  const items = L.shownRecords(tests, showAll).map((record) => {
    const item = testItem(record);
    item.open = record.id === open;
    return item;
  });
  $("test-list").replaceChildren(...items);
  $("tests-all").hidden = showAll || tests.length <= L.RECENT_RECORDS;
  $("tests-all").textContent = `Show all ${tests.length}`;
  refreshTestSummaries();
}

export function setupHistory() {
  $("tests-all").addEventListener("click", () => {
    showAll = true;
    // The button goes, so focus moves to the first record it revealed rather than falling to the page.
    const first = $("test-list").children.length;
    renderTests();
    $("test-list").children[first]?.querySelector("summary")?.focus();
  });
}

/** Draws the list with the latest few records; called each time Log test opens. */
export function openHistory() {
  showAll = false;
  renderTests();
}

/**
 * After a change (from the store's subscriber): the list is rebuilt when records were added or removed, else only
 * each row's summary, so a record being edited keeps what's typed.
 */
export function refreshHistory() {
  const shown = $("test-list").querySelectorAll("details.event").length;
  if (shown !== L.shownRecords(now().tests, showAll).length) renderTests();
  else refreshTestSummaries();
}
