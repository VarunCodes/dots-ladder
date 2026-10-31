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

/**
 * The group's rungs for one lift, in kg, lowest first: [{ percentile: 50, score: 155 }, ...] with the lifters they
 * come from; null if the group has none for that lift. From the same lifters' same results as the score rungs.
 */
export function liftRungsFor(data, lift, sex, wclass, experience) {
  const group = data.rungs.find((r) => r.sex === sex && r.weightClassKg === wclass && r.experience === experience);
  const set = group?.lifts?.[lift];
  if (!set) return null;
  const rungs = Object.entries(set)
    .filter(([key]) => /^p\d+$/.test(key))
    .map(([key, value]) => ({ percentile: Number(key.slice(1)), score: value }))
    .sort((x, y) => x.percentile - y.percentile);
  return { lifters: set.lifters, rungs };
}

/** "between P10 and P25", "below P10", "above P90", or "" without rungs. Reaching a rung's score clears it. */
export function rungPosition(rungs, points) {
  const cleared = rungs.findLast((r) => r.score <= points);
  const next = rungs.find((r) => r.score > points);
  if (cleared && next) return `between P${cleared.percentile} and P${next.percentile}`;
  if (next) return `below P${next.percentile}`;
  return cleared ? `above P${cleared.percentile}` : "";
}

/**
 * What a save achieved, for the note on the Ladder: the lifts the new record set a PR on, and the highest rung
 * your score newly cleared. A rung counts only when you're compared with the same group (sex, class, formula)
 * before and after, so changing class isn't read as climbing.
 */
export function saveOutcome({ before, after, rungs, prLifts = [] }) {
  const sameGroup =
    before?.profile && before.profile.sex === after.profile.sex && before.profile.formula === after.profile.formula &&
    effectiveClass(before.profile) === effectiveClass(after.profile);
  const cleared = sameGroup ? rungs.findLast((r) => r.score > before.score && r.score <= after.score) ?? null : null;
  return { prLifts, cleared };
}

/** "Saved", "Saved · PR on squat and bench", "Saved · PR on deadlift · Cleared P25". */
export function savedText({ prLifts, cleared }) {
  const lifts = prLifts.length > 1 ? `${prLifts.slice(0, -1).join(", ")} and ${prLifts.at(-1)}` : prLifts[0];
  return ["Saved", lifts && `PR on ${lifts}`, cleared && `Cleared P${cleared.percentile}`].filter(Boolean).join(" · ");
}

/** First rung strictly above the score, or null if every rung is beaten. */
export function nextRung(rungs, points) {
  return rungs.find((r) => r.score > points) ?? null;
}

// --- The lifter's numbers and settings ---------------------------------------------------
// In memory a profile is { sex, bodyweight, squat, bench, deadlift, weightClass, formula, targetBw }, all kg: your
// latest numbers, always worked out from your records (never stored twice), plus your settings. Only the
// settings are saved (by store.js): { weightClass, formula, targetBw }.
// weightClass null means "work it out from bodyweight"; formula is the score shown everywhere ("dots" or "gl");
// targetBw is the weight-class lever's bodyweight on Progress, null for the default.

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

export const OPENER_PCTS = [88, 90, 91, 93]; // the attempt planner's opener choices (attempts.js)

export const RACK_KEYS = ["squat", "safeties", "bench"]; // squat rack height, squat safeties, bench rack height

/** Your rack settings, cleaned: { squat: "9", safeties: "4", bench: "6 / 3" } with only those set; null if none. */
function cleanRack(raw) {
  const rack = Object.fromEntries(RACK_KEYS.map((key) => [key, shortText(raw?.[key])]).filter(([, value]) => value));
  return Object.keys(rack).length ? rack : null;
}

/**
 * A profile's settings, the only part that's saved: { weightClass, formula, targetBw }, with defaults for anything
 * missing or invalid, plus the optional ones only when set: openerPct (the attempt planner's choice) and rack
 * (your rack heights for meet day).
 */
export function settingsOf(profile) {
  return {
    weightClass: typeof profile?.weightClass === "string" ? profile.weightClass : null,
    formula: FORMULA_IDS.includes(profile?.formula) ? profile.formula : DEFAULT_FORMULA,
    targetBw: inRange(profile?.targetBw, LIMITS.bodyweight) ? profile.targetBw : null,
    ...(OPENER_PCTS.includes(profile?.openerPct) && { openerPct: profile.openerPct }),
    ...(cleanRack(profile?.rack) && { rack: cleanRack(profile.rack) }),
  };
}

/** Your profile: your latest numbers from your records, with your settings; null before your first record. */
export function currentProfile(settings, tests) {
  const latest = carried(tests).at(-1);
  return latest ? validProfile({ ...settings, ...latest.values }) : null;
}

/** The full profile an older version saved, numbers included (used once to start the history), or null. */
export function legacyProfile(raw) {
  return validProfile(raw);
}

// --- 1RMs: every record of what you logged, dated ----------------------------------------
// A record holds what was logged on one day: { id, date: "YYYY-MM-DD", sex, and any of bodyweight, squat, bench,
// deadlift }. One lift is a "squat 1RM"; all three are a "1RM test"; bodyweight can be logged alone. Your numbers
// on a date are the latest of each up to that date, carried forward; the earliest record holds all four, so every
// record has a full set to score. Each record keeps its sex, so it's scored in the category it was done in.
// Class and formula are settings on the profile; the profile's sex and numbers are worked out from the latest values.

export const EARLIEST_DATE = "1990-01-01";
export const VALUES = ["bodyweight", ...LIFTS];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const limitFor = (name) => (name === "bodyweight" ? LIMITS.bodyweight : LIMITS.lift);

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

/** The values a record logged, in order: e.g. ["squat"], or all four for a full record. */
export function loggedValues(record) {
  return VALUES.filter((name) => record?.[name] != null && !Number.isNaN(record[name]));
}

/** Whether a record holds bodyweight and all three lifts (the earliest record must). */
export const isComplete = (record) => loggedValues(record).length === VALUES.length;

/** Names of the record's problems: "date" (missing, not a day, before 1990 or after today), any logged value out of range, or "values" if nothing is logged. */
export function testProblems(raw, today) {
  const date = raw?.date;
  const bad = !isDay(date) || date < EARLIEST_DATE || date > today ? ["date"] : [];
  const logged = loggedValues(raw);
  bad.push(...logged.filter((name) => !inRange(raw[name], limitFor(name))));
  if (!logged.length) bad.push("values");
  return bad;
}

/**
 * A clean copy of a stored record (only what it logged), or null. One saved before records kept their sex takes
 * `fallbackSex` (the profile's, which it was saved under). The future-date rule is for entry only, so a stored
 * record survives a clock change.
 */
export function validTest(raw, fallbackSex) {
  if (raw == null || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return null;
  const sex = raw.sex in CLASSES ? raw.sex : fallbackSex;
  if (!(sex in CLASSES) || testProblems(raw, "9999-12-31").length) return null;
  return { id: raw.id, date: raw.date, sex, ...Object.fromEntries(loggedValues(raw).map((name) => [name, raw[name]])) };
}

/** Records oldest first by date; records on the same day keep the order they were saved in. */
export function sortTests(tests) {
  return tests.map((test, i) => [test, i]).sort(([x, i], [y, j]) => x.date.localeCompare(y.date) || i - j).map(([test]) => test);
}

/**
 * Each record, oldest first, with your full numbers as of it (what it logged, the rest carried forward) and the
 * date each value was last logged: [{ record, values: { sex, bodyweight, squat, bench, deadlift }, from: { squat: "2026-10-12", ... } }].
 */
export function carried(tests) {
  const values = {};
  const from = {};
  return sortTests(tests).map((record) => {
    for (const name of loggedValues(record)) [values[name], from[name]] = [record[name], record.date];
    values.sex = record.sex;
    return { record, values: { ...values }, from: { ...from } };
  });
}

/** Your numbers as of a day (on or before it), with when each was last logged; null before your first record. */
export function valuesAt(tests, date) {
  return carried(tests).findLast((c) => c.record.date <= date) ?? null;
}

/** The newest record by date, or null with none. */
export function latestTest(tests) {
  return sortTests(tests).at(-1) ?? null;
}

/** The profile with its sex and numbers from your latest values (unchanged with no records). */
export function withLatestTest(profile, tests) {
  const latest = carried(tests).at(-1);
  return latest ? { ...profile, ...latest.values } : profile;
}

/** A unique id for a saved record or event. */
export function newId(prefix) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** A new record from the profile's sex and the chosen values (all four by default). */
export function testFrom(profile, date, id, names = VALUES) {
  return { id, date, sex: profile.sex, ...Object.fromEntries(names.map((name) => [name, profile[name]])) };
}

/** What the Save button says for the values changed: "Save squat 1RM", "Save squat & bench", "Save test", "Save bodyweight", or null for nothing. */
export function saveLabel(changed) {
  const lifts = LIFTS.filter((lift) => changed.includes(lift));
  if (lifts.length === LIFTS.length) return "Save test";
  if (lifts.length === 2) return `Save ${lifts[0]} & ${lifts[1]}`;
  if (lifts.length === 1) return `Save ${lifts[0]} 1RM`;
  return changed.includes("bodyweight") ? "Save bodyweight" : null;
}

/** What a record is called: "1RM test" (all three lifts), "Squat 1RM", "Squat & bench 1RM", or "Bodyweight". */
export function recordName(record) {
  const lifts = LIFTS.filter((lift) => lift in record);
  if (lifts.length === LIFTS.length) return "1RM test";
  if (!lifts.length) return "Bodyweight";
  const names = lifts.join(" & ");
  return `${names[0].toUpperCase()}${names.slice(1)} 1RM`;
}

/** The lifts each record set a PR on (more than every earlier value of that lift): Map of id → ["squat", ...]. A first value isn't a PR. */
export function prs(tests) {
  const best = {};
  const result = new Map();
  for (const record of sortTests(tests)) {
    const beaten = LIFTS.filter((lift) => lift in record && best[lift] != null && record[lift] > best[lift]);
    if (beaten.length) result.set(record.id, beaten);
    for (const lift of LIFTS) if (lift in record) best[lift] = Math.max(best[lift] ?? -Infinity, record[lift]);
  }
  return result;
}

export const BODYWEIGHT_SHIFT_KG = 5; // beyond this, a lift carried from another bodyweight is flagged

/**
 * Lifts carried into a day from a noticeably different bodyweight: [{ lift, bodyweight }] for each lift not logged
 * that day whose bodyweight when it was logged differs from `bodyweight` by more than 5 kg. A score built on them
 * treats old lifts as done at today's weight, so it's worth a retest.
 */
export function staleLifts(tests, date, bodyweight, loggedNow = []) {
  const at = valuesAt(tests, date);
  if (!at) return [];
  return LIFTS.filter((lift) => !loggedNow.includes(lift) && at.from[lift] !== date).flatMap((lift) => {
    const then = valuesAt(tests, at.from[lift]).values.bodyweight;
    return Math.abs(then - bodyweight) > BODYWEIGHT_SHIFT_KG ? [{ lift, bodyweight: then }] : [];
  });
}

/** "squat and deadlift logged at 60 kg", or "squat logged at 60 kg and deadlift at 62 kg" when they differ. */
export function staleText(stale) {
  const join = (items) => items.join(", ").replace(/, ([^,]*)$/, " and $1");
  const weights = new Set(stale.map((s) => s.bodyweight));
  return weights.size === 1
    ? `${join(stale.map((s) => s.lift))} logged at ${stale[0].bodyweight} kg`
    : join(stale.map((s, i) => `${s.lift}${i ? "" : " logged"} at ${s.bodyweight} kg`));
}

/** Why a record can't be deleted: "only" (your only record), "earliest" (the next one doesn't hold all four), or null. */
export function deleteProblem(tests, id) {
  const rest = sortTests(tests.filter((t) => t.id !== id));
  if (!rest.length) return "only";
  return isComplete(rest[0]) ? null : "earliest";
}

/**
 * Saved records, cleaned and oldest first: invalid ones are dropped. A record from before records kept their sex
 * takes `fallbackSex` (an older profile's), or failing that another record's. Not an array → null.
 */
export function cleanTests(raw, fallbackSex) {
  if (!Array.isArray(raw)) return null;
  const sex = fallbackSex ?? raw.find((r) => r?.sex in CLASSES)?.sex;
  return sortTests(raw.map((test) => validTest(test, sex)).filter(Boolean));
}

/** Whether records can be saved: every one valid, and the earliest holding all four values. */
export function canSaveTests(tests) {
  const clean = tests.map((test) => validTest(test));
  if (clean.includes(null)) return false;
  return !clean.length || isComplete(sortTests(clean)[0]);
}

// --- Progress view: what the chart plots and over which range ---------------------------
// A per-device convenience (not part of your data): { metric: "score" | "lifts" | "bw", lift: "total" | "squat" |
// "bench" | "deadlift" (which one Lifts shows), range: "all" | "3m" }.

export const METRICS = ["score", "lifts", "bw"];
export const LIFT_VIEWS = ["total", ...LIFTS];
export const RANGES = ["3m", "all"];
const DEFAULT_VIEW = { metric: "score", lift: "total", range: "all" };

/** The chart view, with anything missing or unknown back to the default (Score, Total, All). The old "Total" tab is now Lifts → Total. */
export function cleanView(raw) {
  const metric = raw?.metric === "total" ? "lifts" : raw?.metric;
  return {
    metric: METRICS.includes(metric) ? metric : DEFAULT_VIEW.metric,
    lift: LIFT_VIEWS.includes(raw?.lift) ? raw.lift : DEFAULT_VIEW.lift,
    range: RANGES.includes(raw?.range) ? raw.range : DEFAULT_VIEW.range,
  };
}

// --- Events: upcoming meets or test days, with conservative and optimistic lifts ---------
// An event is { id, name, month: "YYYY-MM", date: "YYYY-MM-DD" or null, bodyweight, conservative, optimistic };
// each scenario is { squat, bench, deadlift } or null, and at least one is given. The exact date is optional
// and stays on the device; when it's set, the month is the date's month.

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

export const MAX_LABEL = 12; // a flight ("Flight B") or a rack setting ("9", "4 / 5")

/** Short optional text (a flight, a rack setting), trimmed; null when blank or too long. */
function shortText(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  return text && text.length <= MAX_LABEL ? text : null;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_BEFORE = 60; // lifters before you in your flight

/**
 * The optional meet-day part of an event, cleaned: { flight, start: { squat: "11:30", ... }, before (lifters before
 * you), attempts: { squat: [{ kg, good }], ... } }. Anything
 * invalid is dropped rather than refusing the event (it's typed and tapped on the day); null if nothing's left.
 * A lift keeps at most three attempts, and only up to its first invalid one, so the order stays true.
 */
export function cleanDay(raw) {
  if (raw == null || typeof raw !== "object") return null;
  const day = {};
  const flight = shortText(raw.flight);
  if (flight) day.flight = flight;
  const start = Object.fromEntries(LIFTS.filter((lift) => TIME.test(raw.start?.[lift] ?? "")).map((lift) => [lift, raw.start[lift]]));
  if (Object.keys(start).length) day.start = start;
  if (Number.isInteger(raw.before) && raw.before >= 0 && raw.before <= MAX_BEFORE) day.before = raw.before;
  const attempts = {};
  for (const lift of LIFTS) {
    const list = Array.isArray(raw.attempts?.[lift]) ? raw.attempts[lift].slice(0, 3) : [];
    const valid = [];
    for (const a of list) {
      if (!inRange(a?.kg, LIMITS.lift) || typeof a.good !== "boolean") break;
      valid.push({ kg: a.kg, good: a.good });
    }
    if (valid.length) attempts[lift] = valid;
  }
  if (Object.keys(attempts).length) day.attempts = attempts;
  return Object.keys(day).length ? day : null;
}

/** A clean copy of the event, or null if it has no id or any problem. Its meet-day part is kept, cleaned. */
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
    ...(cleanDay(raw.day) && { day: cleanDay(raw.day) }),
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

/** Saved events, cleaned: invalid ones are dropped. Not an array → null. */
export function cleanEvents(raw) {
  return Array.isArray(raw) ? raw.map(validEvent).filter(Boolean) : null;
}

/** Whether events can be saved: every one valid. */
export function canSaveEvents(events) {
  return !events.map(validEvent).includes(null);
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

export const ROUTES = ["ladder", "log", "progress", "meet"];

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
