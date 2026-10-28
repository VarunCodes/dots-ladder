# Population estimates: one gym-goer marker, never a rung

**Decision (28 Oct 2026):** the rungs stay OpenPowerlifting-only: measured percentiles of real UK meet results. The ladder also shows a single **reference marker**, "Regular gym-goer (estimate)", for the selected sex: about **200 DOTS for men** and **160 DOTS for women**. It's there for scale, to show how far a lifter on the ladder already is from a typical gym-goer, because powerlifting is a niche sport. There's no marker for untrained adults. It adds nothing to a ladder for people who train.

## Why it's an estimate, not data

No dataset measures squat, bench and deadlift one-rep maxes for the general UK population. The marker is built from typical strength-to-bodyweight ratios, so it could be 20–30% out either way. That's why it:

- is never a rung, and never sits among the rungs (a contract test checks it stays below every published rung)
- looks different from the rungs: muted italic text, a tick on the rail instead of a lamp, and "~" before the value
- says "estimate" in its label

## Method

- **Bodyweight:** about 85 kg for an average UK man and 71 kg for a woman (approximate Health Survey for England figures). DOTS adjusts for bodyweight, so the result isn't sensitive to this.
- **Strength ratios** (one-rep max ÷ bodyweight) for a regular gym-goer, from published strength standards. Those sites' users already lift, which suits a "gym-goer" figure:

| | Squat | Bench | Deadlift | Total | DOTS |
| --- | --- | --- | --- | --- | --- |
| Man, 85 kg | 1.25× (107.5 kg) | 0.75× (65 kg) | 1.5× (127.5 kg) | 300 kg | about 200 |
| Woman, 71 kg | 0.75× (52.5 kg) | 0.5× (35 kg) | 1.0× (70 kg) | 157.5 kg | about 160 |

For comparison, the lowest published rung for men (74 kg, first meet, "beats 10%") is 266, and for women (69 kg, first meet) it's 229.

## Sources

- Strength Level, strength standards: https://strengthlevel.com/strength-standards/squat/lb
- StrengthLog, bench press standards: https://www.strengthlog.com/bench-press-strength-standards-kg/
- Health Survey for England 2022, adult overweight and obesity: https://digital.nhs.uk/data-and-information/publications/statistical/health-survey-for-england/2022-part-2/adult-overweight-and-obesity
- Untrained versus trained bench press (University of Granada): https://produccioncientifica.ugr.es/documentos/618f57019ff8c939aacc0267?lang=en

## Guardrails

- Rungs come only from OpenPowerlifting. Nothing estimated is ever added to `data/rungs.json`.
- At most this one reference marker. More estimates (untrained, "elite" or anything else) would dilute the ladder's point: real lifters, real meets.
- If a measured population dataset ever appears, replace the estimate, or remove the marker if it doesn't hold up.
