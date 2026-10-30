// Every value worked out from the store, in one place. Each is computed the first time it's asked for and then
// cached for that state (the store makes a new state object on every change), using the pure, tested functions
// in ladder.js, scoring.js and chart.js. Screens and cards read these; none keeps its own copy of the entries or
// works out a score itself. (A draft being typed on Log test isn't in the store: that screen scores it.)
import * as L from "./ladder.js";
import { inRange, liftDays, onePerDay } from "./chart.js";

const cache = new WeakMap();

/** The derived values for a state, made once per state. */
export function derived(state) {
  let values = cache.get(state);
  if (!values) cache.set(state, (values = make(state)));
  return values;
}

/** A value computed on first use, then kept. */
function once(compute) {
  let done = false;
  let value;
  return () => {
    if (!done) [done, value] = [true, compute()];
    return value;
  };
}

/** One cached value per key (e.g. per lift). */
function perKey(compute) {
  const values = new Map();
  return (key) => {
    if (!values.has(key)) values.set(key, compute(key));
    return values.get(key);
  };
}

function make(state) {
  const { settings, entries, events, view, session } = state;
  const { rungs: rungsData, today, thisMonth, experience } = session;

  const profile = once(() => L.currentProfile(settings, entries));
  const tests = once(() => L.sortTests(entries));
  const group = once(() => {
    const p = profile();
    return p && L.rungsFor(rungsData, p.formula, p.sex, L.effectiveClass(p), experience);
  });
  // Every record with your full numbers as of it, scored in its own sex and the chosen formula.
  const points = once(() => {
    const p = profile();
    if (!p) return [];
    return L.carried(entries).map(({ record, values, from }) => ({
      id: record.id,
      date: record.date,
      record,
      test: { ...values, date: record.date },
      from,
      score: L.profileScore({ ...p, ...values }),
      otherSex: values.sex !== p.sex,
    }));
  });
  const days = once(() => onePerDay(points()));
  const prs = once(() => L.prs(entries));
  const liftRungs = perKey((lift) => {
    const p = profile();
    return (p && L.liftRungsFor(rungsData, lift, p.sex, L.effectiveClass(p), experience)?.rungs) ?? [];
  });
  const prDays = perKey((lift) => {
    const ids = prs();
    return new Set(entries.filter((e) => (lift ? ids.get(e.id)?.includes(lift) : ids.has(e.id))).map((e) => e.date));
  });
  const eventScores = perKey((id) => {
    const p = profile();
    const event = events.find((e) => e.id === id);
    return p && event ? L.eventScores(event, p.sex, p.formula) : [];
  });

  return {
    /** The saved parts and the page's session, as stored. */
    settings,
    events,
    view,
    today,
    thisMonth,
    experience,
    rungsData,
    /** Your latest numbers (from your records) with your settings; null before your first record. */
    get profile() {
      return profile();
    },
    /** Your records, oldest first. */
    get tests() {
      return tests();
    },
    /** The latest record, or null. */
    get latest() {
      return tests().at(-1) ?? null;
    },
    /** Your score now, in the chosen formula. */
    get score() {
      return profile() ? L.profileScore(profile()) : null;
    },
    /** The score rungs for your class and the Ladder's experience tab ({ lifters, rungs }), or null. */
    get group() {
      return group();
    },
    /** Every record with its full numbers and score (see points above). */
    get points() {
      return points();
    },
    /** One point per day: the day's last-saved record. */
    get days() {
      return days();
    },
    /** The days in the chart's range (all, or the last 3 months'). */
    get rangeDays() {
      return inRange(days(), view.range, today);
    },
    /** The days the chart plots: in range, and for a single lift only the days it was logged. */
    get chartDays() {
      const lift = view.metric === "lifts" && view.lift !== "total" ? view.lift : null;
      return lift ? inRange(liftDays(days(), lift), view.range, today) : this.rangeDays;
    },
    /** The lifts each record set a PR on: Map of id → ["squat", ...]. */
    get prs() {
      return prs();
    },
    /** The days with a PR on that lift (or on any lift, with none given). */
    prDays,
    /** One lift's rungs in kg for your group ([] if none). */
    liftRungs,
    /** An event's total and score per scenario, at its bodyweight. */
    eventScores,
    /** The weight-class lever for your target bodyweight. */
    get lever() {
      return profile() ? L.lever(profile(), group()?.rungs ?? []) : null;
    },
    /** The soonest dated event, with the days to go, or null. */
    get nextMeet() {
      return L.nextMeet(events, today);
    },
    /** The events shown on the Ladder: this month or later, soonest first. */
    get ladderEvents() {
      return L.ladderEvents(events, thisMonth);
    },
  };
}
