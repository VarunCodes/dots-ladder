// Pure logic for the DOTS ladder: no DOM, so it runs in the browser and under `node --test`.
// Weight classes mirror pipeline/build_rungs.py; the scoring formulas live in scoring.js.
import { DEFAULT_FORMULA, FORMULA_IDS, score } from "./scoring.js";

const CLASSES = {
  M: [59, 66, 74, 83, 93, 105, 120],
  F: [47, 52, 57, 63, 69, 76, 84],
};

export const EXPERIENCE = ["first meet", "second meet", "3+ meets"];
export const LIFTS = ["squat", "bench", "deadlift"];

export function weightClass(sex, bodyweight) {
  const limit = CLASSES[sex].find((l) => bodyweight <= l);
  return limit ? `${limit}` : `${CLASSES[sex].at(-1)}+`;
}

export function sumLifts(lifts) {
  return LIFTS.reduce((sum, lift) => sum + lifts[lift], 0);
}

/** The profile's score in its chosen formula (the rungs are raw full power, so always classic, full). */
export function profileScore(profile) {
  return score(profile.formula, { total: sumLifts(profile), bw: profile.bodyweight, sex: profile.sex });
}

/** The group's rungs in one formula, lowest first: [{ percentile: 25, score: 300 }, ...]; null if there's no such group. */
export function rungsFor(data, formula, sex, wclass, experience) {
  const group = data.rungs.find(
    (r) => r.sex === sex && r.weightClassKg === wclass && r.experience === experience,
  );
  if (!group?.[formula]) return null;
  const rungs = Object.entries(group[formula])
    .map(([key, value]) => ({ percentile: Number(key.slice(1)), score: value }))
    .sort((x, y) => x.percentile - y.percentile);
  return { lifters: group.lifters, rungs };
}

/** "between P10 and P25", "below P10", "above P90", or "" without rungs. Reaching a rung's score clears it. */
export function rungPosition(rungs, points) {
  const cleared = rungs.findLast((r) => r.score <= points);
  const next = rungs.find((r) => r.score > points);
  if (cleared && next) return `between P${cleared.percentile} and P${next.percentile}`;
  if (next) return `below P${next.percentile}`;
  return cleared ? `above P${cleared.percentile}` : "";
}

/** First rung strictly above the score, or null if every rung is beaten. */
export function nextRung(rungs, points) {
  return rungs.find((r) => r.score > points) ?? null;
}

// --- The lifter's editable numbers ---------------------------------------------------
// A profile is { sex, bodyweight, squat, bench, deadlift, weightClass, formula, targetBw }, all kg.
// weightClass null means "work it out from bodyweight"; formula is the score shown everywhere ("dots" or "gl");
// targetBw is the weight-class lever's bodyweight on Progress, null for the default.

export const PROFILE_KEY = "dots-ladder:profile";
export const LIMITS = { bodyweight: [30, 250], lift: [1, 600] };

/** Class labels for a sex, lightest first: ["59", "66", ..., "120+"]. */
export function weightClasses(sex) {
  return [...CLASSES[sex].map(String), `${CLASSES[sex].at(-1)}+`];
}

/** The class to compare against: the one chosen, or the one the bodyweight falls in. */
export function effectiveClass(profile) {
  return profile.weightClass ?? weightClass(profile.sex, profile.bodyweight);
}

/** The chosen class's upper limit if the bodyweight is over it (so the lifter would need to cut), else null. */
export function overClassLimit(profile) {
  const limit = Number(effectiveClass(profile));
  return Number.isFinite(limit) && profile.bodyweight > limit ? limit : null;
}

const inRange = (value, [min, max]) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

/** Names of the required values that are missing or out of range: "sex", "bodyweight", "squat", "bench", "deadlift". */
export function invalidFields(raw) {
  const bad = [];
  if (!(raw?.sex in CLASSES)) bad.push("sex");
  if (!inRange(raw?.bodyweight, LIMITS.bodyweight)) bad.push("bodyweight");
  for (const lift of LIFTS) if (!inRange(raw?.[lift], LIMITS.lift)) bad.push(lift);
  return bad;
}

/** Like invalidFields, but skips values not entered yet: a first-time form shouldn't flag fields the person hasn't reached. */
export function enteredProblems(raw) {
  return invalidFields(raw).filter((name) => !blank(raw?.[name]));
}

/** A clean copy of the profile, or null if a required value is missing or out of range. A class that doesn't exist for the sex falls back to auto; a missing or unknown formula is DOTS. */
export function validProfile(raw) {
  if (raw == null || typeof raw !== "object" || invalidFields(raw).length) return null;
  const weightClass = weightClasses(raw.sex).includes(raw.weightClass) ? raw.weightClass : null;
  const formula = FORMULA_IDS.includes(raw.formula) ? raw.formula : DEFAULT_FORMULA;
  const targetBw = inRange(raw.targetBw, LIMITS.bodyweight) ? raw.targetBw : null;
  return { sex: raw.sex, bodyweight: raw.bodyweight, ...Object.fromEntries(LIFTS.map((l) => [l, raw[l]])), weightClass, formula, targetBw };
}

/** The lever's default target: the top of the next lighter class (cutting one class), or of the lightest class if you're in it. */
export function defaultTargetBw(sex, bodyweight) {
  const limits = CLASSES[sex];
  const own = limits.find((limit) => bodyweight <= limit) ?? Infinity; // the open class has no limit
  return limits.filter((limit) => limit < own).at(-1) ?? limits[0];
}

/**
 * The weight-class lever: the same total scored at the target bodyweight, the change from bodyweight alone,
 * and the highest rung that change would clear (null if none).
 */
export function lever(profile, rungs) {
  const targetBw = profile.targetBw ?? defaultTargetBw(profile.sex, profile.bodyweight);
  const now = profileScore(profile);
  const then = profileScore({ ...profile, bodyweight: targetBw });
  const cleared = rungs.filter((r) => r.score > now && r.score <= then).at(-1) ?? null;
  return { targetBw, now, then, delta: then - now, cleared };
}

/** The saved profile from storage (e.g. localStorage), or the fallback if there's none, it's unreadable or it's invalid. */
export function loadProfile(storage, fallback) {
  try {
    return validProfile(JSON.parse(storage.getItem(PROFILE_KEY))) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Saves a valid profile; returns whether it was saved (storage can be full, blocked or missing). */
export function saveProfile(storage, profile) {
  const clean = validProfile(profile);
  if (!clean) return false;
  try {
    storage.setItem(PROFILE_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

// --- Test history: every saved 1RM test, dated --------------------------------------
// A test is { id, date: "YYYY-MM-DD", sex, bodyweight, squat, bench, deadlift }. Each test keeps its own sex, so
// it's always scored in the category it was done in. Class and formula are settings on the profile; the
// profile's sex and numbers mirror the latest test, so the Ladder reads one place.

export const TESTS_KEY = "dots-ladder:tests";
export const EARLIEST_DATE = "1990-01-01";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TEST_FIELDS = ["sex", "bodyweight", ...LIFTS];

/** "YYYY-MM-DD" for a date, in local time. */
export function dayOf(date) {
  return `${monthOf(date)}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Whether a string is a real calendar day ("2026-02-30" isn't). */
export function isDay(value) {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Names of the test's values that are wrong: "date" (missing, not a day, before 1990 or after today) and invalidFields' numbers. */
export function testProblems(raw, today) {
  const bad = invalidFields({ sex: "M", ...raw }).filter((name) => name !== "sex");
  const date = raw?.date;
  if (!isDay(date) || date < EARLIEST_DATE || date > today) bad.unshift("date");
  return bad;
}

/**
 * A clean copy of a stored test, or null. A test saved before tests recorded sex takes `fallbackSex` (the profile's,
 * which it was saved under). The future-date rule is for entry only, so a stored test survives a clock change.
 */
export function validTest(raw, fallbackSex) {
  if (raw == null || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
  const sex = raw.sex in CLASSES ? raw.sex : fallbackSex;
  if (!(sex in CLASSES) || testProblems(raw, "9999-12-31").length) return null;
  return { id: raw.id, date: raw.date, ...Object.fromEntries(TEST_FIELDS.map((name) => [name, raw[name]])), sex };
}

/** Tests oldest first by date; tests on the same day keep the order they were saved in. */
export function sortTests(tests) {
  return tests.map((test, i) => [test, i]).sort(([x, i], [y, j]) => x.date.localeCompare(y.date) || i - j).map(([test]) => test);
}

/** The test to compare a new one dated `date` with: the latest on or before that day, or null for the earliest test. */
export function previousTest(tests, date) {
  return sortTests(tests).findLast((test) => test.date <= date) ?? null;
}

/** The newest test by date, or null with none. */
export function latestTest(tests) {
  return sortTests(tests).at(-1) ?? null;
}

/** The profile with its sex and numbers taken from the latest test (unchanged if there are none). */
export function withLatestTest(profile, tests) {
  const latest = latestTest(tests);
  return latest ? { ...profile, ...Object.fromEntries(TEST_FIELDS.map((name) => [name, latest[name]])) } : profile;
}

/** A unique id for a saved test or event. */
export function newId(prefix) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** A new test from the profile's sex and numbers. */
export function testFrom(profile, date, id) {
  return { id, date, ...Object.fromEntries(TEST_FIELDS.map((name) => [name, profile[name]])) };
}

/**
 * The saved tests, oldest first. Numbers saved before the history existed become the first test, dated today
 * (their real date wasn't recorded). Unreadable or missing storage gives the fallback; invalid entries are dropped.
 */
export function loadTests(storage, profile, today, fallback) {
  try {
    const raw = JSON.parse(storage.getItem(TESTS_KEY));
    if (Array.isArray(raw)) return sortTests(raw.map((test) => validTest(test, profile?.sex)).filter(Boolean));
    return profile ? [testFrom(profile, today, "first")] : fallback;
  } catch {
    return fallback;
  }
}

/** Saves the tests if every one is valid; returns whether they were saved. */
export function saveTests(storage, tests) {
  const clean = tests.map((test) => validTest(test));
  if (clean.includes(null)) return false;
  try {
    storage.setItem(TESTS_KEY, JSON.stringify(sortTests(clean)));
    return true;
  } catch {
    return false;
  }
}

// --- Progress view: what the chart plots and over which range ---------------------------
// A per-device convenience (not part of your data): { metric: "score" | "total" | "bw", range: "all" | "3m" }.

export const VIEW_KEY = "dots-ladder:progress-view";
export const METRICS = ["score", "total", "bw"];
export const RANGES = ["3m", "all"];
const DEFAULT_VIEW = { metric: "score", range: "all" };

/** The saved chart view, with anything missing or unknown back to the default (Score, All). */
export function loadView(storage) {
  try {
    const raw = JSON.parse(storage.getItem(VIEW_KEY)) ?? {};
    return {
      metric: METRICS.includes(raw.metric) ? raw.metric : DEFAULT_VIEW.metric,
      range: RANGES.includes(raw.range) ? raw.range : DEFAULT_VIEW.range,
    };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}

/** Saves the chart view; returns whether it was saved. */
export function saveView(storage, view) {
  try {
    storage.setItem(VIEW_KEY, JSON.stringify({ metric: view.metric, range: view.range }));
    return true;
  } catch {
    return false;
  }
}

// --- Events: upcoming meets or test days, with conservative and optimistic lifts ---------
// An event is { id, name, month: "YYYY-MM", date: "YYYY-MM-DD" or null, bodyweight, conservative, optimistic };
// each scenario is { squat, bench, deadlift } or null, and at least one is given. The exact date is optional
// and stays on the device; when it's set, the month is the date's month.

export const EVENTS_KEY = "dots-ladder:events";
export const SCENARIOS = ["conservative", "optimistic"];
export const MAX_LADDER_EVENTS = 3;
export const MAX_NAME = 40;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// An empty form field reads as NaN; a stored scenario that wasn't given is null.
const blank = (value) => value == null || Number.isNaN(value);
const blankText = (value) => value == null || value === "";
const scenarioGiven = (lifts) => lifts != null && typeof lifts === "object" && !LIFTS.every((lift) => blank(lifts[lift]));

/** "YYYY-MM" for a date, in local time. */
export function monthOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** The month after a "YYYY-MM" month. */
export function nextMonth(month) {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
}

/** Names of the event's values that are wrong: "name", "month", "date", "bodyweight", "conservative.squat", ..., or "scenarios" if none is given. A scenario left fully empty is fine. */
export function eventProblems(raw) {
  const bad = [];
  if (raw?.name != null && (typeof raw.name !== "string" || raw.name.length > MAX_NAME)) bad.push("name");
  if (typeof raw?.month !== "string" || !MONTH.test(raw.month)) bad.push("month");
  if (!blankText(raw?.date) && !(isDay(raw.date) && raw.date.startsWith(`${raw.month}-`))) bad.push("date");
  if (!inRange(raw?.bodyweight, LIMITS.bodyweight)) bad.push("bodyweight");
  const given = SCENARIOS.filter((scenario) => scenarioGiven(raw?.[scenario]));
  for (const scenario of given) {
    for (const lift of LIFTS) if (!inRange(raw[scenario][lift], LIMITS.lift)) bad.push(`${scenario}.${lift}`);
  }
  if (!given.length) bad.push("scenarios");
  return bad;
}

/** A clean copy of the event, or null if it has no id or any problem. */
export function validEvent(raw) {
  if (raw == null || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id || eventProblems(raw).length) return null;
  const pick = (lifts) => (scenarioGiven(lifts) ? Object.fromEntries(LIFTS.map((lift) => [lift, lifts[lift]])) : null);
  return {
    id: raw.id,
    name: (raw.name ?? "").trim(),
    month: raw.month,
    date: blankText(raw.date) ? null : raw.date,
    bodyweight: raw.bodyweight,
    ...Object.fromEntries(SCENARIOS.map((scenario) => [scenario, pick(raw[scenario])])),
  };
}

/** Total and score for each scenario the event has, at the event's bodyweight. */
export function eventScores(event, sex, formula) {
  return SCENARIOS.filter((scenario) => event[scenario]).map((scenario) => {
    const total = sumLifts(event[scenario]);
    return { scenario, total, score: score(formula, { total, bw: event.bodyweight, sex }) };
  });
}

/** The events shown on the ladder: this month or later, soonest first, at most MAX_LADDER_EVENTS. */
export function ladderEvents(events, thisMonth) {
  return events
    .filter((event) => event.month >= thisMonth)
    .sort((x, y) => x.month.localeCompare(y.month))
    .slice(0, MAX_LADDER_EVENTS);
}

/** The soonest event with an exact date today or later, with the days to go, or null. */
export function nextMeet(events, today) {
  const event = events.filter((e) => e.date && e.date >= today).sort((x, y) => x.date.localeCompare(y.date))[0];
  return event ? { event, days: daysBetween(today, event.date) } : null;
}

/** Whole days from one "YYYY-MM-DD" to another (calendar days, so clock changes don't matter). */
export function daysBetween(from, to) {
  const utc = (day) => Date.UTC(...day.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** The class the event's bodyweight falls in, if it isn't the class the ladder shows; else null. */
export function eventClass(event, profile) {
  const wclass = weightClass(profile.sex, event.bodyweight);
  return wclass === effectiveClass(profile) ? null : wclass;
}

/** Highest rung at or below the score, or null if it's below every rung. */
export function rungBeaten(rungs, points) {
  return rungs.findLast((r) => r.score <= points) ?? null;
}

/** The saved events from storage, or the fallback if there are none or they're unreadable. Invalid entries are dropped; an empty saved list stays empty. */
export function loadEvents(storage, fallback) {
  try {
    const raw = JSON.parse(storage.getItem(EVENTS_KEY));
    return Array.isArray(raw) ? raw.map(validEvent).filter(Boolean) : fallback;
  } catch {
    return fallback;
  }
}

/** Saves the events if every one is valid; returns whether they were saved. */
export function saveEvents(storage, events) {
  const clean = events.map(validEvent);
  if (clean.includes(null)) return false;
  try {
    storage.setItem(EVENTS_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

// --- Reference marker: an estimate, not data ---------------------------------------
// The rungs are measured OpenPowerlifting percentiles. This single marker is an estimate of a
// regular gym-goer's DOTS, for scale only; see docs/population-estimates.md for the method.
// It exists in DOTS only: a GL figure would be a second estimate, so in GL there's no marker.

export const GYM_GOER_ESTIMATE = { M: 200, F: 160 };

/** The gym-goer reference marker for the selected sex, named by sex so it's clear which estimate it is; null outside DOTS. */
export function referenceMarker(sex, formula) {
  if (formula !== "dots") return null;
  return { label: `${sex === "M" ? "Male" : "Female"} gym-goer (estimate)`, score: GYM_GOER_ESTIMATE[sex] };
}

// --- The ladder as rows: rungs, you, your events and the gym-goer estimate -----------

export const RUNG_NAMES = { 10: "Bottom 10%", 25: "Lower quartile", 50: "Median lifter", 75: "Upper quartile", 90: "Top 10%" };

/**
 * Every row on the ladder, highest score first, all in one formula. Rungs carry their state: "next" (the first
 * one above you), "above" or "cleared". Markers (you, events, the gym-goer estimate) pass through with their kind.
 * Every row has gap = its score minus yours.
 */
export function ladderRows(rungs, points, markers) {
  const next = nextRung(rungs, points);
  const rows = [
    ...rungs.map((r) => ({
      kind: "rung",
      percentile: r.percentile,
      score: r.score,
      state: r === next ? "next" : r.score > points ? "above" : "cleared",
    })),
    ...markers,
  ].map((row) => ({ ...row, gap: row.score - points }));
  // Highest first; on a tie a rung sits above a marker, and you sit above other markers.
  const rank = (row) => (row.kind === "rung" ? 0 : row.kind === "you" ? 1 : 2);
  return rows.sort((x, y) => y.score - x.score || rank(x) - rank(y));
}

// --- Screens and the Log test steppers ------------------------------------------------

export const ROUTES = ["ladder", "log", "progress"];

/** The screen for a URL hash ("#/log" or "#/log?class" → "log"); anything unknown is the Ladder. */
export function routeFrom(hash) {
  const name = (hash ?? "").replace(/^#\/?/, "").split("?")[0];
  return ROUTES.includes(name) ? name : "ladder";
}

/** One stepper press: value ± step, kept to one decimal place and within [min, max]. An empty value starts at min. */
export function stepValue(value, step, direction, [min, max]) {
  if (!Number.isFinite(value)) return min;
  const next = Math.round((value + direction * step) * 10) / 10;
  return Math.min(max, Math.max(min, next));
}

/** Rungs passed going from one score to another: positive when climbing, negative when dropping. Reaching a rung's score clears it. */
export function rungsClimbed(rungs, fromScore, toScore) {
  const passed = (low, high) => rungs.filter((r) => r.score > low && r.score <= high).length;
  return toScore >= fromScore ? passed(fromScore, toScore) : -passed(toScore, fromScore);
}
