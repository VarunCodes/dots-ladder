// Pure logic for the DOTS ladder: no DOM, so it runs in the browser and under `node --test`.
// Weight classes mirror pipeline/build_rungs.py; the scoring formulas live in scoring.js.
import { DEFAULT_FORMULA, FORMULAS, FORMULA_IDS, MAX_SET_REPS, estimateMax, formatScore, kgToNextRung, score, totalForScore } from "./scoring.js";

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
// targetBw is the weight-class lever's class on Progress, saved as the top of that class (null for the default);
// an older bodyweight in between picks the class it falls in.

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
 * The lever's class choices, lightest first: the next lighter class, your class ("now") and the next heavier one, each
 * at the top of its class: [{ label: "66", kg: 66, now: false }, ...]. The open class has no top, so it's never a choice.
 */
export function leverClasses(sex, bodyweight) {
  const limits = CLASSES[sex];
  const own = limits.findIndex((limit) => bodyweight <= limit);
  const i = own === -1 ? limits.length : own; // the open class sits past the last limit
  return [i - 1, i, i + 1]
    .filter((j) => j >= 0 && j < limits.length)
    .map((j) => ({ label: `${limits[j]}`, kg: limits[j], now: j === i }));
}

/** The lightest total that still scores at least `score` at the bodyweight, rounded up to the next 2.5 kg. */
function breakEvenTotal(formula, scoreNow, bw, sex) {
  // Both formulas are the total times a factor of bodyweight, so the break-even total is a straight ratio.
  const factor = score(formula, { total: 1, bw, sex });
  return Math.ceil(scoreNow / factor / 2.5 - 1e-9) * 2.5;
}

/** Your total scored at each whole kilo across the choices, with a little either side: [{ bw, score }, ...]. */
function leverCurve(profile, classes) {
  const total = sumLifts(profile);
  const kgs = [profile.bodyweight, ...classes.map((c) => c.kg)];
  const from = Math.max(LIMITS.bodyweight[0], Math.floor(Math.min(...kgs)) - 3);
  const to = Math.min(LIMITS.bodyweight[1], Math.ceil(Math.max(...kgs)) + 3);
  const points = [];
  for (let bw = from; bw <= to; bw++) points.push({ bw, score: score(profile.formula, { total, bw, sex: profile.sex }) });
  return points;
}

/**
 * The weight-class lever, for the class chosen (or the default: the next lighter one): the same total scored at the
 * top of that class and the change from bodyweight alone, the break-even total there (the lightest that scores the
 * same as you do now) and its gap from your total, where that score sits among the class's rungs (`classRungs(label)`
 * gives them for your experience group; "" without any), and your total's score across the choices for the curve.
 */
export function lever(profile, classRungs = () => []) {
  const classes = leverClasses(profile.sex, profile.bodyweight);
  const saved = profile.targetBw == null ? null : Number(weightClass(profile.sex, profile.targetBw));
  const target = classes.find((c) => c.kg === saved) ?? classes.find((c) => c.kg === defaultTargetBw(profile.sex, profile.bodyweight));
  const total = sumLifts(profile);
  const now = profileScore(profile);
  const then = profileScore({ ...profile, bodyweight: target.kg });
  const breakEven = breakEvenTotal(profile.formula, now, target.kg, profile.sex);
  return {
    classes,
    target,
    targetBw: target.kg,
    now,
    then,
    delta: then - now,
    breakEven,
    room: breakEven - total,
    position: rungPosition(classRungs(target.label) ?? [], then),
    curve: leverCurve(profile, classes),
  };
}

// --- "What total do I need?": a target score and bodyweight back to a total ----------------

export const CALC_TARGETS = 3; // quick targets: the next few rungs above your score
export const CALC_SCORE_LIMITS = [1, 1000]; // a typed target outside these isn't a score

/** The calculator's quick targets: the next CALC_TARGETS rungs above your score, lowest first. */
export function quickTargets(rungs, points) {
  return rungs.filter((r) => r.score > points).slice(0, CALC_TARGETS);
}

/** The top of the next lighter class below a bodyweight (66 at 68 kg, and at 74), or null below the lightest. */
export function lighterClassTop(sex, bodyweight) {
  return CLASSES[sex].filter((limit) => limit < bodyweight).at(-1) ?? null;
}

/**
 * What total scores `target` at bodyweight `bw` (rounded up to the next 2.5 kg) and its gap from your total, how
 * many rungs that target climbs from your score now (`climbs`, negative below it) and the highest rung it reaches,
 * and the same target at the next lighter class's top. With a value that isn't usable: { problems: ["target", "bw"] }.
 */
export function totalNeeded(profile, rungs, { target, bw }) {
  const [low, high] = CALC_SCORE_LIMITS;
  const problems = [
    ...(Number.isFinite(target) && target >= low && target <= high ? [] : ["target"]),
    ...(Number.isFinite(bw) && bw >= LIMITS.bodyweight[0] && bw <= LIMITS.bodyweight[1] ? [] : ["bw"]),
  ];
  if (problems.length) return { problems };
  const needed = breakEvenTotal(profile.formula, target, bw, profile.sex);
  const lighter = lighterClassTop(profile.sex, bw);
  return {
    problems,
    needed,
    gap: Math.round((needed - sumLifts(profile)) * 10) / 10,
    climbs: rungsClimbed(rungs, profileScore(profile), target),
    reaches: rungs.filter((r) => r.score <= target).at(-1) ?? null,
    clearsAll: rungs.length > 0 && target >= rungs.at(-1).score,
    lighter: lighter && { kg: lighter, needed: breakEvenTotal(profile.formula, target, lighter, profile.sex) },
  };
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
 * missing or invalid, plus the optional ones only when set: openerPct (the attempt planner's choice), rack
 * (your rack heights for meet day), lastBackup (the day you last backed up, for Your data's reminder),
 * experience (the meet experience you gave on your first visit, which the Ladder opens on) and analytics
 * (false when you've switched anonymous usage counts off; they're on by default).
 */
export function settingsOf(profile) {
  return {
    weightClass: typeof profile?.weightClass === "string" ? profile.weightClass : null,
    formula: FORMULA_IDS.includes(profile?.formula) ? profile.formula : DEFAULT_FORMULA,
    targetBw: inRange(profile?.targetBw, LIMITS.bodyweight) ? profile.targetBw : null,
    ...(OPENER_PCTS.includes(profile?.openerPct) && { openerPct: profile.openerPct }),
    ...(cleanRack(profile?.rack) && { rack: cleanRack(profile.rack) }),
    ...(isDay(profile?.lastBackup) && { lastBackup: profile.lastBackup }),
    ...(EXPERIENCE.includes(profile?.experience) && { experience: profile.experience }),
    ...(typeof profile?.analytics === "boolean" && { analytics: profile.analytics }),
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
//
// A lift can be an estimate from a set: the record keeps the set under `sets` ({ squat: { kg: 60, reps: 5 } }) and
// the lift's value is worked out from it whenever the record is read (estimateMax), so a later change to the
// formula reaches every record. The value is saved alongside, so an older copy of the app still reads the record.

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
  const sets = cleanSets(raw.sets);
  const withEstimates = { ...raw, ...Object.fromEntries(Object.entries(sets).map(([lift, set]) => [lift, estimateMax(set.kg, set.reps)])) };
  if (!(sex in CLASSES) || testProblems(withEstimates, "9999-12-31").length) return null;
  const values = Object.fromEntries(loggedValues(withEstimates).map((name) => [name, withEstimates[name]]));
  return { id: raw.id, date: raw.date, sex, ...values, ...(Object.keys(sets).length && { sets }) };
}

/** The sets behind estimated lifts, kept only when they give a lift in range from 2 to 10 reps: { squat: { kg, reps } }. */
export function cleanSets(raw) {
  const sets = {};
  for (const lift of LIFTS) {
    const set = raw?.[lift];
    const max = set && inRange(set.kg, LIMITS.lift) && set.reps > 1 ? estimateMax(set.kg, set.reps) : null;
    if (max != null && inRange(max, LIMITS.lift)) sets[lift] = { kg: set.kg, reps: set.reps };
  }
  return sets;
}

/** Whether a record's lift is estimated from a set. */
export const isEstimated = (record, lift) => Boolean(record?.sets?.[lift]);

/** "est. from 60 kg × 5" for an estimated lift, or "" for a tested one. */
export function estimateText(record, lift) {
  const set = record?.sets?.[lift];
  return set ? `est. from ${set.kg} kg × ${set.reps}` : "";
}

/**
 * A record as edited in the 1RMs list: a lift whose value was changed by hand is a tested max now, so its set goes;
 * the sets of lifts left alone stay. Returns the record with what's left of `sets`.
 */
export function editedSets(before, after) {
  const sets = Object.fromEntries(Object.entries(before.sets ?? {}).filter(([lift]) => after[lift] === before[lift]));
  const { sets: _, ...rest } = after;
  return Object.keys(sets).length ? { ...rest, sets } : rest;
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

export const STALE_WEEKS = 6; // a lift last tested this long ago gets a "last tested" note

/**
 * How current each number behind your score is, as of today: one row per value (bodyweight, then the lifts)
 * { name, kg, date (when it was last logged), days (since then), tested (logged in your latest record, rather than
 * carried from an earlier one) }, and for lifts { best (your best ever), pr (the record that set it was a PR, as in
 * prs(): it beat every earlier value, so a first value or an equalled best isn't one), estimate ("est. from 60 kg × 5",
 * or "" for a tested lift) }. `stale` lists the lifts
 * last tested STALE_WEEKS or more ago, oldest first, with their weeks. Null with no records.
 */
export function yourNumbers(tests, today) {
  const latest = carried(tests).at(-1);
  if (!latest) return null;
  const prRecords = prs(tests);
  const setBy = (lift, date) => sortTests(tests).findLast((t) => lift in t && t.date === date);
  const best = Object.fromEntries(LIFTS.map((lift) => [lift, Math.max(...tests.filter((t) => lift in t).map((t) => t[lift]))]));
  const rows = VALUES.map((name) => {
    const date = latest.from[name];
    const row = { name, kg: latest.values[name], date, days: daysBetween(date, today), tested: date === latest.record.date };
    if (!LIFTS.includes(name)) return row;
    const record = setBy(name, date);
    return { ...row, best: best[name], pr: Boolean(prRecords.get(record.id)?.includes(name)), estimate: estimateText(record, name) };
  });
  const stale = rows
    .filter((row) => row.name !== "bodyweight" && row.days >= STALE_WEEKS * 7)
    .sort((x, y) => y.days - x.days)
    .map((row) => ({ lift: row.name, weeks: Math.floor(row.days / 7) }));
  return { rows, stale };
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

/**
 * Your next event, today or later, or null: the soonest by its exact date, or by its month when it has none (a
 * month-only event counts for the whole month, after any dated one in it). The days to go only with a date.
 */
export function nextMeet(events, today) {
  const when = (e) => e.date ?? `${e.month}-99`;
  const event = events
    .filter((e) => (e.date ? e.date >= today : e.month >= today.slice(0, 7)))
    .sort((x, y) => when(x).localeCompare(when(y)))[0];
  return event ? { event, days: event.date ? daysBetween(today, event.date) : null } : null;
}

/** Meet's cards wait for an upcoming event, or a meet with a result to show; until then only the unlock card shows. */
export const meetLocked = (nextMeet, meetResult) => !nextMeet && !meetResult;

/** The exact date to save with a meet's first attempt: today, for one planned by month alone, if today is in that month. */
export function meetDate(event, today) {
  return !event.date && today.startsWith(`${event.month}-`) ? { date: today } : {};
}

/** The records the 1RMs list shows, newest first: the latest RECENT_RECORDS, or all of them. */
export const RECENT_RECORDS = 5;
export function shownRecords(tests, all) {
  const newest = [...tests].reverse();
  return all ? newest : newest.slice(0, RECENT_RECORDS);
}

/** Whole days from one "YYYY-MM-DD" to another (calendar days, so clock changes don't matter). */
export function daysBetween(from, to) {
  const utc = (day) => Date.UTC(...day.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** "today", "yesterday", "5 days ago", "3 weeks ago". */
export function agoText(days) {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return days < 14 ? `${days} days ago` : `${Math.floor(days / 7)} weeks ago`;
}

// --- Your data: backing up what's on this phone -----------------------------------------

export const BACKUP_DUE_DAYS = 14;

/**
 * Your data's backup line: { text, due }. A backup is due 2 weeks after the last one or, if you've never backed
 * up, 2 weeks after your first record; then the line asks for one.
 */
export function backupStatus(settings, tests, today) {
  const last = settings.lastBackup;
  const since = last ?? tests[0]?.date;
  const due = since != null && daysBetween(since, today) >= BACKUP_DUE_DAYS;
  const when = last ? `Last backup ${agoText(daysBetween(last, today))}.` : "Not backed up yet.";
  return { text: due ? `${when} Back up to keep your latest records safe.` : when, due };
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

// --- Lift balance: your split against the typical one, and what stands out --------------

export const LIFT_NAMES = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };

/** Each lift's share of your total, in %. */
export function liftShares(lifts) {
  const total = sumLifts(lifts);
  return Object.fromEntries(LIFTS.map((lift) => [lift, (100 * lifts[lift]) / total]));
}

/**
 * The group's typical split: each lift's median share of a total, scaled to sum to 100 (medians needn't), as
 * { lifters, squat, bench, deadlift, scaled }; null if the group has none (an older rungs.json, or too few lifters).
 */
export function typicalSplit(data, sex, wclass, experience) {
  const split = data.rungs.find((r) => r.sex === sex && r.weightClassKg === wclass && r.experience === experience)?.split;
  if (!split || !LIFTS.every((lift) => split[lift] > 0)) return null;
  const sum = LIFTS.reduce((total, lift) => total + split[lift], 0);
  const shares = Object.fromEntries(LIFTS.map((lift) => [lift, (100 * split[lift]) / sum]));
  return { lifters: split.lifters, ...shares, scaled: Math.abs(sum - 100) >= 0.5 };
}

/** Where a value sits among rungs, compactly: "Below P10", "P10–P25", "Above P90", or "" without rungs. */
export function rungBand(rungs, value) {
  const cleared = rungs.findLast((r) => r.score <= value);
  const next = rungs.find((r) => r.score > value);
  if (cleared && next) return `P${cleared.percentile}–P${next.percentile}`;
  if (next) return `Below P${next.percentile}`;
  return cleared ? `Above P${cleared.percentile}` : "";
}

const kgText = (kg) => `${Number(kg.toFixed(1))}`;
const listed = (words) => (words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0]);
const named = (lifts) => {
  const text = listed(lifts.map((lift) => LIFT_NAMES[lift].toLowerCase()));
  return text[0].toUpperCase() + text.slice(1);
};

/**
 * Lift balance for the Ladder: your shares, the typical split (or null), a row per lift ({ lift, kg, band,
 * opportunity, detail }), the lift to show first (`selected`), and up to four summary lines of facts from the
 * rungs, the first with a bold `lead`:
 *   1. your biggest opportunity: the lowest-ranked lift among its own rungs (a lower share than typical breaks a
 *      tie), or "Your lifts rank evenly" when every lift sits in the same band;
 *   2. the lift nearest its next rung, in kg;
 *   3. your strongest lift (not when they rank evenly);
 *   4. what every lift at its next rung would do for your score.
 * A row's `detail` is that lift's own lines: where it sits (and its share against typical), then its next rung
 * and the one after, in kg, each with what it would do for your score.
 * `liftRungs(lift)` gives a lift's rungs in kg; `scoreRungs` are the score rungs for the same group.
 */
export function liftBalance(profile, liftRungs, typical, scoreRungs) {
  const shares = liftShares(profile);
  const rungsOf = Object.fromEntries(LIFTS.map((lift) => [lift, liftRungs(lift) ?? []]));
  const ranked = LIFTS.filter((lift) => rungsOf[lift].length);
  // A lift's rank: the highest rung it has cleared (0 below them all).
  const level = (lift) => rungsOf[lift].findLast((r) => r.score <= profile[lift])?.percentile ?? 0;
  const band = (lift) => rungBand(rungsOf[lift], profile[lift]);
  const gap = (lift) => (typical ? shares[lift] - typical[lift] : 0);

  let opportunity = [];
  let strongest = [];
  const even = ranked.length > 1 && ranked.every((lift) => band(lift) === band(ranked[0]));
  if (ranked.length > 1 && !even) {
    const low = Math.min(...ranked.map(level));
    const high = Math.max(...ranked.map(level));
    const lowest = ranked.filter((lift) => level(lift) === low);
    // A share further under typical breaks a tie; within half a point, they're named together.
    const under = Math.min(...lowest.map(gap));
    opportunity = lowest.filter((lift) => gap(lift) - under < 0.5);
    if (high > low) strongest = ranked.filter((lift) => level(lift) === high);
  }

  const lines = [];
  if (even) {
    const all = ranked.length === 3 ? "All three" : "Both";
    lines.push({ lead: "Your lifts rank evenly.", text: `${all} sit ${rungPosition(rungsOf[ranked[0]], profile[ranked[0]])}.` });
  } else if (opportunity.length === 1) {
    const [lift] = opportunity;
    const points = Math.round(Math.abs(gap(lift)));
    const share = !typical ? "" : points < 1 ? ", and its share is close to typical" : `, and its share is ${points} point${points === 1 ? "" : "s"} ${gap(lift) < 0 ? "under" : "over"} typical`;
    lines.push({ lead: `${LIFT_NAMES[lift]} is your biggest opportunity.`, text: `It sits ${rungPosition(rungsOf[lift], profile[lift])}${share}.` });
  } else if (opportunity.length > 1) {
    const where = opportunity.map((lift) => rungPosition(rungsOf[lift], profile[lift]));
    const same = where.every((w) => w === where[0]);
    lines.push({
      lead: `${named(opportunity)} are your biggest opportunities.`,
      text: same ? `${opportunity.length === 2 ? "Both" : "All"} sit ${where[0]}.` : `They sit ${listed(where)}.`,
    });
  }

  // The lift nearest its next rung (the opportunity first in a tie, then squat, bench, deadlift).
  const ahead = ranked
    .map((lift) => ({ lift, next: nextRung(rungsOf[lift], profile[lift]) }))
    .filter(({ next }) => next)
    .map((a) => ({ ...a, kg: a.next.score - profile[a.lift] }));
  const nearest = ranked.length > 1 && ahead.length
    ? ahead.reduce((best, a) => (a.kg < best.kg - 1e-9 || (Math.abs(a.kg - best.kg) < 1e-9 && opportunity.includes(a.lift) && !opportunity.includes(best.lift)) ? a : best))
    : null;
  if (nearest) {
    const of = ranked.length === 3 ? "your three lifts" : "your lifts";
    lines.push({ text: `${LIFT_NAMES[nearest.lift]} is ${kgText(nearest.kg)} kg from P${nearest.next.percentile}, the closest rung of ${of}.` });
  }

  if (strongest.length) {
    const plural = strongest.length > 1;
    lines.push({ text: `${named(strongest)} ${plural ? "are your strongest lifts" : "is your strongest lift"}: ${band(strongest[0])}.` });
  }

  // What lifting more does for your score: "take your score to P25 (+12.3 DOTS)", or just the points when no rung
  // is passed. The points tell apart two lines that reach the same rung.
  const now = profileScore(profile);
  const scoreEffect = (lifts) => {
    const then = profileScore({ ...profile, ...lifts });
    const points = `${formatScore(profile.formula, then - now)} ${FORMULAS[profile.formula].label}`;
    if (rungsClimbed(scoreRungs, now, then) > 0) return `take your score to P${scoreRungs.findLast((r) => r.score <= then).percentile} (+${points})`;
    return `add ${points}`;
  };

  // Every lift with a rung ahead, at its next rung together (only when two or more have one).
  if (ahead.length > 1) {
    const who = ahead.length === 3 ? "All three lifts" : named(ahead.map((a) => a.lift));
    const kgs = listed(ahead.map((a) => `+${kgText(a.kg)}`));
    const at = Object.fromEntries(ahead.map((a) => [a.lift, a.next.score]));
    lines.push({ text: `${who} at their next rung (${kgs} kg) would ${scoreEffect(at)}.` });
  }

  // Each lift's own detail, shown when it's selected: where it sits, then its next rung and the one after, each
  // with what it does for your score.
  const detail = (lift) => {
    const rungs = rungsOf[lift];
    if (!rungs.length) return [{ text: `No ${LIFT_NAMES[lift].toLowerCase()} rungs for this group yet.` }];
    const points = Math.round(Math.abs(gap(lift)));
    const share = !typical ? "" : points < 1 ? ", share close to typical" : `, share ${points} point${points === 1 ? "" : "s"} ${gap(lift) < 0 ? "under" : "over"} typical`;
    const out = [{ lead: `${LIFT_NAMES[lift]}:`, text: `${rungPosition(rungs, profile[lift])}${share}.` }];
    for (const rung of rungs.filter((r) => r.score > profile[lift]).slice(0, 2)) {
      out.push({ text: `+${kgText(rung.score - profile[lift])} kg to P${rung.percentile} (${kgText(rung.score)} kg) would ${scoreEffect({ [lift]: rung.score })}.` });
    }
    return out;
  };

  // The lift shown first: the opportunity, else (ranking evenly) the nearest rung, else the first with rungs.
  const selected = opportunity[0] ?? nearest?.lift ?? ranked[0] ?? null;
  const rows = LIFTS.map((lift) => ({ lift, kg: profile[lift], band: band(lift), opportunity: opportunity.includes(lift), detail: detail(lift) }));
  return { shares, typical, rows, lines, selected };
}

// --- First visit: one question per screen ------------------------------------------------
// A newcomer answers one thing at a time (category, bodyweight, meets so far, whether they know their max, then each
// lift), and every few screens get something back: their class, where each lift places them, the 100, their
// score and the next target. Always DOTS. What's answered is kept as a draft in the store, so a half-finished
// visit picks up where it stopped; the first record is saved only at the end.
//
// Draft: { sex, bodyweight, competed ("never" | "once" | "more"), mode ("max" | "set"), via ("steps" | "quick"),
//          lifts: { squat: { mode, kg, reps } } }, each null until answered.

/** The screens in order; the progress bar counts these. "welcome" comes before them and "quick" stands in for 1-7. */
export const FIRST_VISIT_STEPS = ["sex", "bodyweight", "competed", "max-known", ...LIFTS, "standing", "score", "target", "next"];
export const FIRST_VISIT_SCREENS = ["welcome", "quick", ...FIRST_VISIT_STEPS];
export const COMPETED = { never: EXPERIENCE[0], once: EXPERIENCE[1], more: EXPERIENCE[2] };
const ENTRY_MODES = ["max", "set"];

/** A saved draft, cleaned: anything unknown or out of range is left unanswered (null). */
export function cleanDraft(raw) {
  if (raw == null || typeof raw !== "object") return null;
  const one = (value, allowed) => (allowed.includes(value) ? value : null);
  const lifts = {};
  for (const lift of LIFTS) {
    const entry = raw.lifts?.[lift];
    if (!entry || typeof entry !== "object") continue;
    lifts[lift] = {
      mode: one(entry.mode, ENTRY_MODES) ?? "max",
      kg: inRange(entry.kg, LIMITS.lift) ? entry.kg : null,
      reps: Number.isInteger(entry.reps) && entry.reps >= 1 ? entry.reps : null,
    };
  }
  return {
    sex: one(raw.sex, Object.keys(CLASSES)),
    bodyweight: inRange(raw.bodyweight, LIMITS.bodyweight) ? raw.bodyweight : null,
    competed: one(raw.competed, Object.keys(COMPETED)),
    mode: one(raw.mode, ENTRY_MODES),
    via: one(raw.via, ["steps", "quick"]) ?? "steps",
    lifts,
  };
}

/** An empty draft: nothing answered. */
export const emptyDraft = () => cleanDraft({});

/** Whether a draft holds any answer worth offering to pick up again. */
export const draftStarted = (draft) => Boolean(draft?.sex);

/**
 * What's wrong with one lift's entry, or null: "kg" (missing or outside 1-600 kg), "reps" (not a whole number from
 * 1), "too-many-reps" (past 10, where the estimate isn't reliable) or "estimate" (a set whose estimate is out of range).
 */
export function liftEntryProblem(entry) {
  if (!inRange(entry?.kg, LIMITS.lift)) return "kg";
  if (entry.mode !== "set") return null;
  if (!Number.isInteger(entry.reps) || entry.reps < 1) return "reps";
  if (entry.reps > MAX_SET_REPS) return "too-many-reps";
  return inRange(estimateMax(entry.kg, entry.reps), LIMITS.lift) ? null : "estimate";
}

export const LIFT_ENTRY_TEXT = {
  kg: "Enter a weight from 1 to 600 kg.",
  reps: "Reps are a whole number, 1 or more.",
  "too-many-reps": `Estimates get unreliable past ${MAX_SET_REPS} reps. Use a heavier set of ${MAX_SET_REPS} or fewer.`,
  estimate: "That set gives a max over 600 kg. Check the weight.",
};

/** A lift's max from the draft: the weight, or the estimate from a set; null until it's valid. */
export function draftMax(draft, lift) {
  const entry = draft?.lifts?.[lift];
  if (liftEntryProblem(entry)) return null;
  return entry.mode === "set" ? estimateMax(entry.kg, entry.reps) : entry.kg;
}

/** Whether a lift in the draft is an estimate (a set of 2 or more reps). */
export const draftEstimated = (draft, lift) => draft?.lifts?.[lift]?.mode === "set" && draft.lifts[lift].reps > 1;

/** The answers each screen needs before it can show; a screen opened early goes to firstMissing instead. */
const NEEDS = {
  bodyweight: ["sex"],
  competed: ["sex", "bodyweight"],
  "max-known": ["sex", "bodyweight", "competed"],
  squat: ["sex", "bodyweight", "competed", "mode"],
  bench: ["sex", "bodyweight", "competed", "mode", "squat"],
  deadlift: ["sex", "bodyweight", "competed", "mode", "squat", "bench"],
  standing: ["sex", "bodyweight", "competed", ...LIFTS],
  score: ["sex", "bodyweight", "competed", ...LIFTS],
  target: ["sex", "bodyweight", "competed", ...LIFTS],
  next: ["sex", "bodyweight", "competed", ...LIFTS],
};
const answered = (draft, need) => (LIFTS.includes(need) ? draftMax(draft, need) != null : draft?.[need] != null);

/** Whether a screen can show with this draft's answers. */
export function canShow(draft, screen) {
  if (!FIRST_VISIT_SCREENS.includes(screen)) return false;
  return (NEEDS[screen] ?? []).every((need) => answered(draft, need));
}

/** The first screen still waiting for an answer ("standing" once everything's in), for picking up a draft. */
export function firstMissing(draft) {
  const order = [["sex", "sex"], ["bodyweight", "bodyweight"], ["competed", "competed"], ["mode", "max-known"], ...LIFTS.map((l) => [l, l])];
  return order.find(([need]) => !answered(draft, need))?.[1] ?? "standing";
}

/** The screen Back goes to from this one: the one before it, or quick setup's form for the results after it. */
export function previousScreen(draft, screen) {
  if (screen === "quick" || screen === "sex") return "welcome";
  if (screen === "standing" && draft?.via === "quick") return "quick";
  const i = FIRST_VISIT_STEPS.indexOf(screen);
  return i > 0 ? FIRST_VISIT_STEPS[i - 1] : "welcome";
}

/** Your numbers from a finished draft, as a profile (DOTS, class from bodyweight); null until every answer is in. */
export function draftProfile(draft) {
  if (!canShow(draft, "standing")) return null;
  return validProfile({ sex: draft.sex, bodyweight: draft.bodyweight, ...Object.fromEntries(LIFTS.map((l) => [l, draftMax(draft, l)])), weightClass: null, formula: "dots" });
}

/** The first record from a finished draft, dated `today`: all four values, with the sets behind any estimates. */
export function draftRecord(draft, today, id) {
  const profile = draftProfile(draft);
  if (!profile) return null;
  const sets = Object.fromEntries(LIFTS.filter((l) => draftEstimated(draft, l)).map((l) => [l, { kg: draft.lifts[l].kg, reps: draft.lifts[l].reps }]));
  const record = testFrom(profile, today, id);
  return Object.keys(sets).length ? { ...record, sets } : record;
}

/**
 * Who a first visit is compared with: the group for its sex, class and meet experience, falling back to first-meet
 * lifters when the class has too few at that experience. { sex, wclass, experience, fellBack, rungs (DOTS), lifts
 * ({ squat: rungs in kg }) }, or null when even first meet has no rungs.
 */
export function draftGroup(data, draft) {
  if (!draft?.sex || draft.bodyweight == null) return null;
  const wclass = weightClass(draft.sex, draft.bodyweight);
  const want = COMPETED[draft.competed ?? "never"];
  const experience = [want, EXPERIENCE[0]].find((exp) => rungsFor(data, "dots", draft.sex, wclass, exp)?.rungs.length);
  if (!experience) return null;
  const lifts = Object.fromEntries(LIFTS.map((l) => [l, liftRungsFor(data, l, draft.sex, wclass, experience)?.rungs ?? []]));
  return { sex: draft.sex, wclass, experience, fellBack: experience !== want, rungs: rungsFor(data, "dots", draft.sex, wclass, experience).rungs, lifts };
}

/** "women, 63 kg, at their first meet", "men, over 120 kg, with 3 or more meets". */
export function groupWords({ sex, wclass, experience }) {
  const who = sex === "F" ? "women" : "men";
  const cls = wclass.endsWith("+") ? `over ${wclass.slice(0, -1)} kg` : `${wclass} kg`;
  return `${who}, ${cls}, ${experience === EXPERIENCE[2] ? "with 3 or more meets" : `at their ${experience}`}`;
}

/** The bodyweights a class covers, as at a meet: "57.1 to 63 kg", "up to 47 kg", "over 84 kg". */
export function classRange(sex, wclass) {
  if (wclass.endsWith("+")) return `over ${wclass.slice(0, -1)} kg`;
  const limits = CLASSES[sex];
  const below = limits[limits.indexOf(Number(wclass)) - 1];
  return below ? `${below}.1 to ${wclass} kg` : `up to ${wclass} kg`;
}

/**
 * Where a value sits among rungs: { passed (the highest percentile reached, 0 below them all), next (the first rung
 * above, or null at the top) }. Only five rungs are known, so it's always "at least" the one passed.
 */
export function placeOn(rungs, value) {
  return { passed: rungs.findLast((r) => r.score <= value)?.percentile ?? 0, next: rungs.find((r) => r.score > value) ?? null };
}

const kgWords = (n) => `${Number(n.toFixed(1))} kg`;

/**
 * A lift's card once it's typed, in ladder words: below the first rung, the kilos that put it on the ladder;
 * on it, where it would place at a meet and the next rung. { title, more }.
 */
export function liftPlaceWords(lift, max, group) {
  const name = lift === "bench" ? "bench press" : lift;
  const { passed, next } = placeOn(group.lifts[lift], max);
  if (!passed && next) return { title: `+${kgWords(next.score - max)} puts your ${name} on the ladder`, more: `That's the first rung: ${kgWords(next.score)}, against ${groupWords(group)}.` };
  const title = `At a meet, your ${name} would place ahead of at least ${passed} in 100`;
  const who = groupWords(group);
  return { title, more: `${who[0].toUpperCase()}${who.slice(1)}.${next ? ` Next rung: ${kgWords(next.score)}, ahead of ${next.percentile}.` : " That's the top rung."}` };
}

/**
 * The 100 screen, for your total: { title, more, key, label, filled, outlined }. Below the first rung: the kilos
 * onto the ladder and the first rung named, with its lifters outlined; on the ladder: where you'd place at a meet
 * and the kilos to the next rung.
 */
export function standingWords(profile, group) {
  const total = sumLifts(profile);
  const lifts = { total, bw: profile.bodyweight, sex: profile.sex };
  const points = score("dots", lifts);
  const { passed, next } = placeOn(group.rungs, points);
  const add = next ? Math.max(2.5, kgToNextRung("dots", lifts, next.score)) : 0;
  if (!passed) {
    return {
      title: `+${kgWords(add)} on your total puts you on the ladder.`,
      more: `That's the first rung: a ${kgWords(total + add)} total. The ${next.percentile} outlined dots are the lifters you'd pass.`,
      key: ["The first rung"],
      label: `100 dots, none filled; ${next.percentile} outlined, the first rung.`,
      filled: 0,
      outlined: next.percentile,
    };
  }
  return {
    title: `At a meet, you'd place ahead of at least ${passed} of these 100 lifters.`,
    more: next ? `Next rung: +${kgWords(add)} on your total to pass ${next.percentile}.` : "That's the top rung.",
    key: next ? ["You're ahead", "Your next rung"] : ["You're ahead"],
    label: `100 dots, ${passed} filled${next ? `, up to ${next.percentile} outlined as your next rung` : ""}.`,
    filled: passed,
    outlined: next?.percentile ?? passed,
  };
}

/** The score screen: the score, and two ways to raise it with your own numbers (the second left out at DOTS's lightest). */
export function scoreWords(profile) {
  const total = sumLifts(profile);
  const { sex, bodyweight } = profile;
  const now = score("dots", { total, bw: bodyweight, sex });
  const lighter = Math.max(FORMULAS.dots.lightest(sex), bodyweight - 2);
  const rows = [{ label: "Lift 5 kg more in total", points: score("dots", { total: total + 5, bw: bodyweight, sex }) }];
  if (lighter < bodyweight) rows.push({ label: `Lift the same at ${kgWords(lighter)}`, points: score("dots", { total, bw: lighter, sex }) });
  return {
    points: now,
    from: `From a ${kgWords(total)} total at ${kgWords(bodyweight)} bodyweight.`,
    rows: rows.map((row) => ({ ...row, change: row.points - now })),
    // The app's one estimate, always named by sex so nobody reads the other one's figure as theirs.
    gymGoer: `For comparison, ${sex === "F" ? "a woman" : "a man"} who trains at the gym regularly scores about ${GYM_GOER_ESTIMATE[sex]}. That one's an estimate; everything else here comes from real meets.`,
  };
}

/**
 * The target screen: { add (kg on your total, 0 past every rung), total (the total it makes), title, lifts }, where
 * lifts are each lift's next rung ({ lift, kg, add, words }, or kg null at the top).
 */
export function targetWords(profile, group) {
  const total = sumLifts(profile);
  const lifts = { total, bw: profile.bodyweight, sex: profile.sex };
  const { passed, next } = placeOn(group.rungs, score("dots", lifts));
  const add = next ? Math.max(2.5, kgToNextRung("dots", lifts, next.score)) : 0;
  const perLift = LIFTS.map((lift) => {
    const place = placeOn(group.lifts[lift], profile[lift]);
    if (!place.next) return { lift, kg: null, add: 0, words: "Top rung" };
    return { lift, kg: place.next.score, add: place.next.score - profile[lift], words: place.passed ? `ahead of ${place.next.percentile} in 100` : "first rung" };
  });
  const title = !next ? "You're past every rung" : passed ? `on your total puts you ahead of ${next.percentile} in 100.` : "on your total puts you on the ladder.";
  return { add, total: total + add, title, onLadder: Boolean(passed), lifts: perLift };
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
