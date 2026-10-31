// Every value worked out from the store, in one place. Each is computed the first time it's asked for and then
// cached for that state (the store makes a new state object on every change), using the pure, tested functions
// in ladder.js, scoring.js and chart.js. Screens and cards read these; none keeps its own copy of the entries or
// works out a score itself. (A draft being typed on Log test isn't in the store: that screen scores it.)
//
// The values come from four small builders: base (your profile and records), rungs, chart and events. Every
// array and object handed out is frozen, so a view that tries to change one fails loudly instead of quietly
// corrupting the cache; the Map and Set ones (prs, prDays) can't be frozen, so treat them as read-only too.
import * as A from "./attempts.js";
import * as L from "./ladder.js";
import { FORMULA_IDS, exchangeRate } from "./scoring.js";
import { inRange, liftDays, onePerDay } from "./chart.js";

const cache = new WeakMap();

/** The derived values for a state, made once per state. */
export function derived(state) {
  let values = cache.get(state);
  if (!values) cache.set(state, (values = make(state)));
  return values;
}

// --- Caching and freezing ---------------------------------------------------------------

/** A value computed on first use, then kept (and frozen). */
function memoizeOnce(compute) {
  let done = false;
  let value;
  return () => {
    if (!done) [done, value] = [true, deepFreeze(compute())];
    return value;
  };
}

/** One computed value per key (e.g. per lift), each kept (and frozen). */
function memoizeByKey(compute) {
  const values = new Map();
  return (key) => {
    if (!values.has(key)) values.set(key, deepFreeze(compute(key)));
    return values.get(key);
  };
}

/** Freezes arrays and plain objects all the way down; a Map's or Set's contents are frozen, though it can't be. */
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (value instanceof Map || value instanceof Set) {
    for (const item of value.values()) deepFreeze(item);
    return value;
  }
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

/** The dates of the records that set a PR on a lift (or on any lift, with none given). */
function daysWithPrs(entries, prs, lift) {
  const setOne = (entry) => (lift ? prs.get(entry.id)?.includes(lift) : prs.has(entry.id));
  return new Set(entries.filter(setOne).map((entry) => entry.date));
}

// --- The builders ---------------------------------------------------------------------------

/** Your profile (latest numbers from your records, plus settings), your records in date order, how current each number is, and the exchange rate. */
function baseValues({ settings, entries, session }) {
  const profile = memoizeOnce(() => L.currentProfile(settings, entries));
  return {
    profile,
    tests: memoizeOnce(() => L.sortTests(entries)),
    yourNumbers: memoizeOnce(() => L.yourNumbers(entries, session.today)),
    // In the chosen formula, plus the other formula's kg on the bar for a kilo of bodyweight.
    exchange: memoizeOnce(() => {
      const p = profile();
      if (!p) return null;
      const at = { total: L.sumLifts(p), bw: p.bodyweight, sex: p.sex };
      const other = FORMULA_IDS.find((id) => id !== p.formula);
      return { ...exchangeRate(p.formula, at), other, otherKgOnBar: exchangeRate(other, at).kgOnBarPerKgBw };
    }),
  };
}

/** Your group's score rungs, each lift's rungs in kg, and the weight-class lever. */
function rungValues({ session }, base) {
  const { rungs: rungsData, experience } = session;
  const group = memoizeOnce(() => {
    const p = base.profile();
    return p && L.rungsFor(rungsData, p.formula, p.sex, L.effectiveClass(p), experience);
  });
  return {
    group,
    liftRungs: memoizeByKey((lift) => {
      const p = base.profile();
      return (p && L.liftRungsFor(rungsData, lift, p.sex, L.effectiveClass(p), experience)?.rungs) ?? [];
    }),
    lever: memoizeOnce(() => {
      const p = base.profile();
      // Where the lever's score would sit: the target class's rungs, for the same experience group as the Ladder.
      return p && L.lever(p, (wclass) => L.rungsFor(rungsData, p.formula, p.sex, wclass, experience)?.rungs);
    }),
  };
}

/** Every record as a scored point, one point per day, the chart's ranges, and PRs. */
function chartValues({ entries, view, session }, base) {
  // Each record with your full numbers as of it, scored in its own sex and the chosen formula.
  const points = memoizeOnce(() => {
    const p = base.profile();
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
  const days = memoizeOnce(() => onePerDay(points()));
  const rangeDays = memoizeOnce(() => inRange(days(), view.range, session.today));
  const prs = memoizeOnce(() => L.prs(entries));
  return {
    points,
    days,
    rangeDays,
    chartDays: memoizeOnce(() => {
      const lift = view.metric === "lifts" && view.lift !== "total" ? view.lift : null;
      return lift ? inRange(liftDays(days(), lift), view.range, session.today) : rangeDays();
    }),
    prs,
    prDays: memoizeByKey((lift) => daysWithPrs(entries, prs(), lift)),
  };
}

/** Each event's scores (by id), the soonest dated event, and the events shown on the Ladder. */
function eventValues({ events, session }, base) {
  const eventsById = memoizeOnce(() => new Map(events.map((event) => [event.id, event])));
  return {
    eventScores: memoizeByKey((id) => {
      const p = base.profile();
      const event = eventsById().get(id);
      return p && event ? L.eventScores(event, p.sex, p.formula) : [];
    }),
    nextMeet: memoizeOnce(() => L.nextMeet(events, session.today)),
    ladderEvents: memoizeOnce(() => L.ladderEvents(events, session.thisMonth)),
  };
}

/** The Meet screen's values: the attempt plan for your next meet (or for now, without one), and the plates. */
function meetValues({ settings, session, events, entries }, base, rungs, plans) {
  const attemptPlan = memoizeOnce(() => {
      const p = base.profile();
      if (!p) return null;
      const meet = plans.nextMeet()?.event;
      return A.attemptPlan(p, {
        pct: settings.openerPct ?? A.DEFAULT_OPENER,
        bodyweight: meet?.bodyweight ?? p.bodyweight,
        sex: p.sex,
        formula: p.formula,
        rungs: rungs.group()?.rungs ?? [],
        now: L.profileScore(p),
      });
  });
  // Your next meet's day: the attempts taken, the next one (at the weight you've set, if it's allowed) and its plates.
  const meetDay = memoizeOnce(() => {
    const event = plans.nextMeet()?.event;
    const plan = attemptPlan();
    if (!event || !plan) return null;
    const attempts = event.day?.attempts ?? {};
    const next = A.nextAttempt(attempts, plan);
    if (next) {
      const chosen = session.attemptKg; // { key: "squat:2", kg }, set with − and + before the attempt
      if (chosen?.key === `${next.lift}:${next.number}` && chosen.kg >= next.min) next.kg = chosen.kg;
      next.plates = A.platesPerSide(next.kg);
    }
    const taken = Object.values(attempts).flat().length;
    return { event, attempts, next, taken, states: A.attemptStates(attempts, next) };
  });
  // Warm-ups for one lift: the one you picked, else the lift you're on. Its opener is what you've set for it, else
  // the plan's; the set due now (by the session's clock, on the meet's day) and the ones you've ticked off.
  const warmups = memoizeOnce(() => {
    const day = meetDay();
    if (!day) return null;
    const lift = session.warmupLift ?? day.next?.lift ?? "squat";
    const next = day.next;
    const opener = next?.lift === lift && next.number === 1 ? next.kg : attemptPlan().steps[0].lifts[lift];
    const startText = day.event.day?.start?.[lift] ?? null;
    const before = day.event.day?.before ?? null;
    const timeline = A.warmupTimes(A.warmupSets(opener), A.toMinutes(startText), before);
    const due = day.event.date === session.today ? A.dueSet(timeline, session.clock) : -1;
    const ticked = session.warmupTicks?.[lift] ?? [];
    return {
      lift,
      opener,
      start: startText,
      before,
      openerAt: timeline.openerAt,
      sets: timeline.sets.map((set, i) => ({ ...set, due: i === due, ticked: ticked.includes(i) })),
    };
  });
  // The latest meet with attempts recorded: its result, scored at its bodyweight, PRs against your records before it.
  const meetResult = memoizeOnce(() => {
    const p = base.profile();
    const withAttempts = events.filter((e) => e.date && Object.keys(e.day?.attempts ?? {}).length);
    const event = withAttempts.sort((x, y) => x.date.localeCompare(y.date)).at(-1);
    if (!p || !event) return null;
    const best = A.bestBefore(entries, event.date);
    return { event, ...A.meetResult(event.day.attempts, { best, bodyweight: event.bodyweight, sex: p.sex, formula: p.formula }) };
  });
  return {
    attemptPlan,
    meetDay,
    warmups,
    meetResult,
    // The loader's weight is the session's (not saved); it starts at your next attempt, else your squat opener.
    plates: memoizeOnce(() => {
      const total = session.plateKg ?? meetDay()?.next?.kg ?? attemptPlan()?.steps[0].lifts.squat ?? 60;
      return { total, ...A.platesPerSide(total) };
    }),
  };
}

// --- What screens read --------------------------------------------------------------------

function make(state) {
  const { settings, events, view, session } = state;
  const base = baseValues(state);
  const rungs = rungValues(state, base);
  const chart = chartValues(state, base);
  const plans = eventValues(state, base);
  const meet = meetValues(state, base, rungs, plans);

  return Object.freeze({
    /** The saved parts and the page's session, as stored. */
    settings,
    events,
    view,
    today: session.today,
    thisMonth: session.thisMonth,
    experience: session.experience,
    rungsData: session.rungs,
    /** Your latest numbers (from your records) with your settings; null before your first record. */
    get profile() {
      return base.profile();
    },
    /** Your records, oldest first. */
    get tests() {
      return base.tests();
    },
    /** The latest record, or null. */
    get latest() {
      return base.tests().at(-1) ?? null;
    },
    /** Your score now, in the chosen formula. */
    get score() {
      const p = base.profile();
      return p ? L.profileScore(p) : null;
    },
    /** The score rungs for your class and the Ladder's experience tab ({ lifters, rungs }), or null. */
    get group() {
      return rungs.group();
    },
    /** One lift's rungs in kg for your group ([] if none). */
    liftRungs: rungs.liftRungs,
    /**
     * What a kilo of bodyweight is worth at your numbers: { perKgBw, perBarStep, kgOnBarPerKgBw } in the chosen
     * formula (perKgBw and kgOnBarPerKgBw null at the formula's limits), with the other formula's id and its
     * kgOnBarPerKgBw as { other, otherKgOnBar }; null without numbers.
     */
    get exchange() {
      return base.exchange();
    },
    /** How current each number behind your score is ({ rows, stale }, see ladder.js yourNumbers); null without records. */
    get yourNumbers() {
      return base.yourNumbers();
    },
    /** The weight-class lever for your target class. */
    get lever() {
      return rungs.lever();
    },
    /** Every record with its full numbers and score. */
    get points() {
      return chart.points();
    },
    /** One point per day: the day's last-saved record. */
    get days() {
      return chart.days();
    },
    /** The days in the chart's range (all, or the last 3 months'). */
    get rangeDays() {
      return chart.rangeDays();
    },
    /** The days the chart plots: in range, and for a single lift only the days it was logged. */
    get chartDays() {
      return chart.chartDays();
    },
    /** The lifts each record set a PR on: Map of id → ["squat", ...] (read-only). */
    get prs() {
      return chart.prs();
    },
    /** The days with a PR on that lift, or on any lift with none given (a read-only Set). */
    prDays: chart.prDays,
    /** An event's total and score per scenario, at its bodyweight. */
    eventScores: plans.eventScores,
    /** The soonest dated event, with the days to go, or null. */
    get nextMeet() {
      return plans.nextMeet();
    },
    /** The events shown on the Ladder: this month or later, soonest first. */
    get ladderEvents() {
      return plans.ladderEvents();
    },
    /**
     * Your attempts from your current 1RMs (openers at your chosen %, seconds at 96%, thirds a 2.5 kg PR), each step
     * totalled and scored at the next meet's bodyweight (else yours), with where it lands on the rungs; null
     * without numbers.
     */
    get attemptPlan() {
      return meet.attemptPlan();
    },
    /**
     * Your next meet's day, or null without a meet with a date: { event, attempts, next (null once all nine are
     * taken: { lift, number, planned, min, kg, plates }), taken, states (the nine, for the progress strip) }.
     */
    get meetDay() {
      return meet.meetDay();
    },
    /**
     * Warm-ups for one lift at your next meet, or null without one: { lift, opener, start, before, openerAt,
     * sets: [{ kg, reps, at (minutes after midnight, or null), due, ticked }] }.
     */
    get warmups() {
      return meet.warmups();
    },
    /**
     * Your latest meet with attempts, or null: { event, lifts: { squat: { attempts: [{ kg, good, pr }], best } },
     * taken, made, pct, total (good lifts only; null without one of each), score, left (kg left on the platform) }.
     */
    get meetResult() {
      return meet.meetResult();
    },
    /** The plate loader: { total, plates (one side, inside to outside), perSide, exact }. */
    get plates() {
      return meet.plates();
    },
  });
}
