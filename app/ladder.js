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

/** First rung strictly above the score, or null if every rung is beaten. */
export function nextRung(rungs, points) {
  return rungs.find((r) => r.score > points) ?? null;
}

// --- The lifter's editable numbers ---------------------------------------------------
// A profile is { sex, bodyweight, squat, bench, deadlift, weightClass, formula }, all kg.
// weightClass null means "work it out from bodyweight"; formula is the score shown everywhere ("dots" or "gl").

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
  return { sex: raw.sex, bodyweight: raw.bodyweight, ...Object.fromEntries(LIFTS.map((l) => [l, raw[l]])), weightClass, formula };
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

// --- Events: upcoming meets or test days, with conservative and optimistic lifts ---------
// An event is { id, name, month: "YYYY-MM", bodyweight, conservative, optimistic };
// each scenario is { squat, bench, deadlift } or null, and at least one is given.

export const EVENTS_KEY = "dots-ladder:events";
export const SCENARIOS = ["conservative", "optimistic"];
export const MAX_LADDER_EVENTS = 3;
export const MAX_NAME = 40;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// An empty form field reads as NaN; a stored scenario that wasn't given is null.
const blank = (value) => value == null || Number.isNaN(value);
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

/** Names of the event's values that are wrong: "name", "month", "bodyweight", "conservative.squat", ..., or "scenarios" if none is given. A scenario left fully empty is fine. */
export function eventProblems(raw) {
  const bad = [];
  if (raw?.name != null && (typeof raw.name !== "string" || raw.name.length > MAX_NAME)) bad.push("name");
  if (typeof raw?.month !== "string" || !MONTH.test(raw.month)) bad.push("month");
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
