# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **UK novice meet lifters:** preparing for, or a few meets into, powerlifting. They know their 1RMs but may not know DOTS, GL or percentiles.
- **Serious gym-goers:** people who test their 1RMs but have never competed. They need the most explanation on a first visit: what the score is, and who they're being compared with.

The job for both: find out how their squat, bench and deadlift compare with real UK meet lifters, decide what to work on next, and see it move over time.

## Product Purpose

DOTS Ladder turns a lifter's 1RMs and bodyweight into a DOTS (or IPF GL) score and puts it on a ladder of anonymous rungs (P10, P25, P50, P75, P90) built from UK meet results.

Success means:
1. **Know where I stand:** a first visit answers "how do I compare with UK meet lifters?" without outside help.
2. **Know what to improve:** clear, factual next targets for each lift and what they'd do for the score.
3. **Keep coming back:** logging tests over months shows the climb. Most of the value builds up with repeat use, so the first visit has to earn the second.

Meet planning (events, attempt targets) is supported but secondary.

## Positioning

The rungs are measured, not guessed. They come from OpenPowerlifting results for UK lifters, split by sex, weight class and meet experience (first meet, second meet, 3+ meets). A lifter can compare themselves with lifters like them, rather than with a generic strength standard or a population estimate.

## Operating Context

- Used on a phone, mostly at home or in the gym after a test, sometimes ahead of a meet.
- An installable PWA that works offline with the last data it loaded.
- Everything the lifter enters stays in the browser on their device. Nothing is sent anywhere.

## Capabilities and Constraints

- Screens: Ladder, Log test, Progress, Meet (unlocked by adding an event).
- Scores: DOTS or IPF GL, switchable everywhere; the rungs are computed separately for each.
- Rungs are aggregates only: n ≥ 20 lifters (P10/P90 need n ≥ 50). No individual lifters' rows, no under-18s, no doping-flagged results.
- Exactly one labelled estimate is allowed: the gym-goer marker (DOTS only). There are no other estimates or hypothetical numbers.
- Plain HTML, CSS and JS with no build step and no CDN, hosted on GitHub Pages. The repository is public, so no personal data goes in.
- Terminology: "rung" (a percentile benchmark), "P10" to "P90", "score" (DOTS or GL), "typical" (the median of the lifter's group), "experience" (meet count group).

## Brand Commitments

- Name: DOTS Ladder.
- UK English.
- Facts from the rungs only, never training advice or programming tips.
- Plain language: explain jargon (DOTS, GL, P10, rung) where it first appears. Don't assume powerlifting knowledge.
- Encouraging, not judging: a low rung is "your biggest opportunity", never "weak" or "behind".
- Credit OpenPowerlifting wherever rung data is shown.

## Evidence on Hand

- `data/rungs.json`: rungs, per-lift rungs and typical lift splits from the OpenPowerlifting bulk download (public domain).
- `docs/population-estimates.md`: the method behind the single gym-goer estimate.
- One user test (1 Nov 2026, a gym-app developer who isn't a powerlifter): DOTS, GL and "P10" weren't understood; percentiles were read as the general population rather than UK meet lifters; meet features went unused; repeat use is in doubt.
- No testimonials, user numbers or endorsements exist. Don't invent any.

## Product Principles

1. **Real data, honestly labelled.** Every number traces back to OpenPowerlifting or to the lifter's own entries; the one estimate says it's an estimate.
2. **Explain before you rank.** Someone who has never competed should understand what a rung is and who it represents before seeing where they sit.
3. **Point to the next step, factually.** Show what the next rung takes and what it would do for the score; leave how to train for it to the lifter.
4. **Private by default.** The lifter's numbers never leave their device.
5. **Reward coming back.** Every visit after a test should show movement: a cleared rung, a PR, a shrinking gap.

## Accessibility & Inclusion

- WCAG 2.2 AA.
- Works at 320px wide without horizontal scrolling; tap targets of at least 44px.
- State is never shown by colour alone; selectors expose their state (`aria-pressed`, `aria-expanded`).
- Respects reduced motion.
