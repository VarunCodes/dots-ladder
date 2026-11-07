# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **UK novice meet lifters:** preparing for, or a few meets into, powerlifting. They know their 1RMs but may not know DOTS, GL or percentiles.
- **Serious gym-goers:** people who test their 1RMs but have never competed. They need the most explanation on a first visit: what the score is, and who they're being compared with.

The job for both: find out how their squat, bench and deadlift compare with UK powerlifters' real meet results, decide what to work on next, and see it move over time.

## Product Purpose

DOTS Ladder turns a lifter's 1RMs and bodyweight into a DOTS (or IPF GL) score and puts it on a ladder of anonymous rungs (P10, P25, P50, P75, P90) built from UK meet results.

Success means:
1. **Know where I stand:** a first visit answers "how do I compare with UK powerlifters?" without outside help.
2. **Know what to improve:** clear, factual next targets for each lift and what they'd do for the score.
3. **Keep coming back:** logging tests over months shows the climb. Most of the value builds up with repeat use, so the first visit has to earn the second.

Meet planning (events, attempt targets) is supported but secondary.

## Positioning

The rungs are measured, not guessed. They come from OpenPowerlifting results for UK powerlifters at real meets, split by sex, weight class and meet experience (first meet, second meet, 3+ meets). A lifter compares themselves with competitive powerlifters like them: not the general public, not gym-goers, and not a generic strength standard or population estimate. Many of these powerlifters were at their very first meet, so they're competitors, not pros or elite athletes.

## Operating Context

- Used on a phone, mostly at home or in the gym after a test, sometimes ahead of a meet.
- An installable PWA that works offline with the last data it loaded.
- Everything the lifter enters stays in the browser on their device. Nothing is sent anywhere.

## Capabilities and Constraints

- Screens: Ladder, Log test, Progress, Meet (unlocked by adding an event).
- Scores: DOTS or IPF GL, switchable everywhere; the rungs are computed separately for each.
- Rungs are aggregates only: n ≥ 20 lifters (P10/P90 need n ≥ 50). No individual lifters' rows, no under-18s, no doping-flagged results.
- Benchmarks are measured only, plus exactly one labelled estimate: the gym-goer marker (DOTS only). No other benchmark is estimated or hypothetical.
- The lifter's own lifts may be estimated from a set they did (Epley, 2 to 10 reps, rounded down to 2.5 kg), for someone who has never tested a max. It's always labelled "est." with the set it came from, and the record keeps the set.
- Plain HTML, CSS and JS with no build step and no CDN, hosted on GitHub Pages. The repository is public, so no personal data goes in.
- Terms used in code and docs: "rung" (a percentile benchmark), "P10" to "P90", "score" (DOTS or GL), "typical" (the median of the lifter's group), "experience" (meet count group). On screen they're not fixed: use whatever words a lifter understands.

## Brand Commitments

- Name: DOTS Ladder.
- UK English.
- Facts from the rungs only, never training advice or programming tips.
- **Understandable first.** Everything on screen should be easy to take in for anyone: a newcomer, a gym-goer, a lifter or an experienced powerlifter. Even "P25" can lose a powerlifter, so prefer plain words ("better than 1 in 4 powerlifters at their first meet") or explain the term where it appears. This matters most where a screen holds many cards and tools: when understanding and brevity pull apart, understanding wins.
- **Say who the ladder is.** The comparison group is always **powerlifters** at UK meets ("396 UK powerlifters, men, 74 kg, at their first meet"), never "lifters", "people", "average" or "population", so nobody reads it as the gym or the public. Spell out "powerlifting meet" once for newcomers. Keep it welcoming: never "pros", "elite" or "top athletes". "Lifter" is fine for the visitor themselves.
- Encouraging, not judging: a low rung is "your biggest opportunity", never "weak" or "behind".
- Credit OpenPowerlifting wherever rung data is shown.

### Every line earns its place

Each line states a fact from the lifter's numbers or the rungs, or what to do next in the app. If removing it loses nothing, remove it.

- **Specific over general:** "+12.5 kg to the next benchmark", not "a little more work on deadlift".
- **No hype or filler:** no "unlock", "supercharge", "journey", "level up", "crush it"; no "Great job!" or "Let's dive in"; no exclamation marks.
- **No empty praise:** state the fact ("Now stronger than 1 in 4 powerlifters at their first meet") and let it speak.
- **No padding:** say a thing once; no groups of three for rhythm; no "simply", "just" or "easily".
- **No decoration:** no emoji or icons that don't carry meaning.

## Evidence on Hand

- `data/rungs.json`: rungs, per-lift rungs and typical lift splits from the OpenPowerlifting bulk download (public domain).
- `docs/population-estimates.md`: the method behind the single gym-goer estimate.
- User test 1 (1 Nov 2026, a gym-app developer who isn't a powerlifter): DOTS, GL and "P10" weren't understood; percentiles were read as the general population rather than UK powerlifters at meets; meet features went unused; repeat use is in doubt.
- User test 2 (7 Nov 2026, a casual gym-goer, no guidance): DOTS and percentiles confusing; unclear what the starting point and the next step are; Progress meant nothing on a first visit. A prototype of a one-question-per-screen first visit (#57) followed: "bench" needed to be "bench press", and "stronger than 10 of them" read oddly.
- No testimonials, user numbers or endorsements exist. Don't invent any.

## Product Principles

1. **Real data, honestly labelled.** Every number traces back to OpenPowerlifting or to the lifter's own entries; every estimate (the gym-goer marker, a lift from a set) says it's an estimate.
2. **Explain before you rank.** Someone who has never competed should understand what a benchmark means and who it represents before seeing where they sit. Plain words beat precise jargon.
3. **Point to the next step, factually.** Show what the next rung takes and what it would do for the score; leave how to train for it to the lifter.
4. **Private by default.** The lifter's numbers never leave their device.
5. **Reward coming back.** Every visit after a test should show movement: a cleared rung, a PR, a shrinking gap.

## Accessibility & Inclusion

- WCAG 2.2 AA.
- Works at 320px wide without horizontal scrolling; tap targets of at least 44px.
- State is never shown by colour alone; selectors expose their state (`aria-pressed`, `aria-expanded`).
- Respects reduced motion.
