# Federation analysis: why there's no federation switcher

**Decision (28 Oct 2026):** the page doesn't offer a federation or drug-tested switch. The data can't support one with enough lifters per group. Tested-only rungs are the one option worth considering, as a single default rather than a toggle.

Data: OpenPowerlifting snapshot of 24 Oct 2026, with the same filters as `pipeline/build_rungs.py` (UK meets, raw, full power, adults, results since 1 Jan 2024, failed results removed, one result per lifter per group). That gives 20,667 results from 9,941 lifters. Only aggregate counts and percentiles are shown here. Groups under 20 lifters are shown as "under 20", with no statistics, as on the page.

## Who's in the data

| Federation | Lifters | Share | Drug-tested |
| --- | --- | --- | --- |
| EPA | 5,739 | 58% | yes |
| BP (national championships) | 1,867 | 19% | yes |
| ScottishPL | 967 | 10% | yes |
| WRPF-UK | 915 | 9% | some divisions |
| BPU | 790 | 8% | some divisions |
| WelshPA | 392 | 4% | yes |
| NIPF | 336 | 3% | yes |
| BDFPA, UKIPL, GPC-GB, UKPU and 14 others | under 200 each | 2% or less each | mixed |

A lifter can compete in more than one federation, so the shares add up to more than 100%. About 92% of the results are drug-tested, almost all from British Powerlifting (IPF) and its home-nation divisions.

## Can each option fill the ladder?

The page needs 48 groups (2 sexes × 8 classes × 3 experience levels), each with 20 or more lifters.

| Option | Groups with 20+ lifters | Median group size |
| --- | --- | --- |
| All federations (current) | 45 of 48 | 258 |
| Tested only | 45 of 48 | 230 |
| Untested only | 23 of 48 | 20 |
| EPA only | 44 of 48 | – |
| ScottishPL / WRPF-UK / BPU / BP only | 24–29 of 48 | – |
| WelshPA only | 11 of 48 | – |
| NIPF only | 4 of 48 | – |
| Any other single federation | 0–1 of 48 | – |

Merging the experience levels (sex × class only) doesn't rescue single federations: only 98 of 318 federation groups reach 20 lifters.

**Outliers are not a concern.** In every option, 1–2% of scores in a publishable group are outliers (beyond 1.5 × the interquartile range), and the published percentiles are robust to them.

## Example: men, 74 kg, first meet

| Option | Lifters | p25 | Median | p75 |
| --- | --- | --- | --- | --- |
| All federations | 396 | 300 | 338 | 368 |
| Tested only | 384 | 301 | 340 | 370 |
| EPA only | 284 | 306 | 345 | 372 |
| ScottishPL only | 31 | 296 | 328 | 354 |
| BP, WRPF-UK or untested only | under 20 | – | – | – |

## Findings

1. **A tested/untested toggle would add little.** Tested-only moves most group medians by 0–2 DOTS, because untested lifting is under 10% of the data. The untested side can't fill a ladder.
2. **A federation switcher would mostly show "not enough lifters".** Only EPA covers the ladder. Every other federation leaves large gaps.
3. **"BP" is a competition level, not a separate pool of lifters.** BP results are mostly national championships, which lifters qualify for through EPA and the other divisions. Their medians run 30–40 DOTS higher (for example men 74 kg, 3+ meets: BP 421 against 386 overall, from 142 BP lifters), and they include almost no first-timers. Offering BP next to EPA as a "federation" would mislead.

## What we'd do instead

- **Tested-only rungs as the single default** (`build_rungs.py --tested-only`). They match a British Powerlifting lifter, lose no groups, and stay well above 20 per group.
- **Later, a "national standard" marker:** for example, the BP championships median on the ladder for 3+ meet lifters, as a stretch goal rather than a selectable federation.

## When to revisit

Re-run this when the data has grown noticeably, or if a user competes mainly outside British Powerlifting. A federation option needs most of its 48 groups at 20+ lifters before it's worth showing.
