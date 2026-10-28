// Pure logic for the DOTS ladder: no DOM, so it runs in the browser and under `node --test`.
// Weight classes and DOTS coefficients mirror pipeline/build_rungs.py.

const COEFFS = {
  M: { a: -0.000001093, b: 0.0007391293, c: -0.1918759221, d: 24.0900756, e: -307.75076, maxBw: 210 },
  F: { a: -0.0000010706, b: 0.0005158568, c: -0.1126655495, d: 13.6175032, e: -57.96288, maxBw: 150 },
};

const CLASSES = {
  M: [59, 66, 74, 83, 93, 105, 120],
  F: [47, 52, 57, 63, 69, 76, 84],
};

export const EXPERIENCE = ["first meet", "second meet", "3+ meets"];
export const LIFTS = ["squat", "bench", "deadlift"];

function denominator(sex, bodyweight) {
  const { a, b, c, d, e, maxBw } = COEFFS[sex];
  const bw = Math.min(Math.max(bodyweight, 40), maxBw);
  return a * bw ** 4 + b * bw ** 3 + c * bw ** 2 + d * bw + e;
}

export function dots(sex, bodyweight, total) {
  return (total * 500) / denominator(sex, bodyweight);
}

/** Total (kg) needed to reach a DOTS score at a given bodyweight. */
export function totalForDots(sex, bodyweight, score) {
  return (score * denominator(sex, bodyweight)) / 500;
}

export function weightClass(sex, bodyweight) {
  const limit = CLASSES[sex].find((l) => bodyweight <= l);
  return limit ? `${limit}` : `${CLASSES[sex].at(-1)}+`;
}

/** Experience group for the lifter's next meet: based on meets already completed. */
export function experienceBucket(meets) {
  const done = meets.filter((m) => m.result != null).length;
  return EXPERIENCE[Math.min(done, 2)];
}

export function latestBodyweight(log) {
  return [...log].sort((x, y) => x.date.localeCompare(y.date)).at(-1)?.kg ?? null;
}

/** Heaviest logged kg per lift, or null if any lift is missing. */
export function currentLifts(bests) {
  const lifts = {};
  for (const lift of LIFTS) {
    const kgs = bests.filter((b) => b.lift === lift).map((b) => b.kg);
    if (!kgs.length) return null;
    lifts[lift] = Math.max(...kgs);
  }
  return lifts;
}

export function sumLifts(lifts) {
  return LIFTS.reduce((sum, lift) => sum + lifts[lift], 0);
}

/** The group's rungs, lowest first: [{ percentile: 25, dots: 300 }, ...]. */
export function rungsFor(data, sex, wclass, experience) {
  const group = data.rungs.find(
    (r) => r.sex === sex && r.weightClassKg === wclass && r.experience === experience,
  );
  if (!group) return null;
  const rungs = Object.entries(group)
    .filter(([key]) => /^p\d+$/.test(key))
    .map(([key, value]) => ({ percentile: Number(key.slice(1)), dots: value }))
    .sort((x, y) => x.percentile - y.percentile);
  return { lifters: group.lifters, rungs };
}

/** First rung strictly above the score, or null if every rung is beaten. */
export function nextRung(rungs, score) {
  return rungs.find((r) => r.dots > score) ?? null;
}

// --- The lifter's editable numbers ---------------------------------------------------
// A profile is { sex, bodyweight, squat, bench, deadlift, weightClass }, all kg.
// weightClass null means "work it out from bodyweight".

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

/** A clean copy of the profile, or null if a required value is missing or out of range. A class that doesn't exist for the sex falls back to auto. */
export function validProfile(raw) {
  if (raw == null || typeof raw !== "object" || invalidFields(raw).length) return null;
  const weightClass = weightClasses(raw.sex).includes(raw.weightClass) ? raw.weightClass : null;
  return { sex: raw.sex, bodyweight: raw.bodyweight, ...Object.fromEntries(LIFTS.map((l) => [l, raw[l]])), weightClass };
}

/** The starting profile from my-lifts.json: latest bodyweight and heaviest logged lifts, class worked out from bodyweight. */
export function defaultProfile(me) {
  return validProfile({ sex: me.sex, bodyweight: latestBodyweight(me.bodyweightLog), ...currentLifts(me.bests), weightClass: null });
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

/** Total and DOTS for each scenario the event has, at the event's bodyweight. */
export function eventScores(event, sex) {
  return SCENARIOS.filter((scenario) => event[scenario]).map((scenario) => {
    const total = sumLifts(event[scenario]);
    return { scenario, total, dots: dots(sex, event.bodyweight, total) };
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
export function rungBeaten(rungs, score) {
  return rungs.findLast((r) => r.dots <= score) ?? null;
}

/** The starting events from my-lifts.json (any invalid ones are skipped). */
export function defaultEvents(me) {
  return (me.events ?? []).map(validEvent).filter(Boolean);
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
