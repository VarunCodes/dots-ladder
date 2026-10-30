# DOTS Ladder

Track my powerlifting DOTS score over time and climb a ladder of anonymous benchmarks ("rungs") built from UK meet results.

## What's DOTS?

DOTS stands for **Dynamic Objective Team Scoring**. It turns a powerlifting total (squat + bench + deadlift) into a score adjusted for bodyweight and sex, so lifters of different sizes can be compared fairly: a heavier lifter needs a bigger total for the same score. Many federations use it in place of the older Wilks formula, and OpenPowerlifting lists it alongside meet results.

The app can also show **IPF GL points** (the IPF's "Goodlift" formula) instead: a toggle next to the title switches every score, rung and gap between the two. The rungs are worked out separately for each formula, because a DOTS percentile isn't the same lifter as a GL percentile once bodyweight comes in.

## Using the app

- **First visit:** the app asks for your sex, bodyweight and squat, bench and deadlift 1RMs, then shows your DOTS and where you sit on the ladder. Nothing else appears until you've entered them.
- **Ladder:** your DOTS (or GL), the next rung and how many kg it takes, and the rungs for your class and meet experience (first meet, second meet, 3+ meets), with your events and a gym-goer estimate alongside (DOTS only: it's an estimate, and there's no GL version of it).
- **Log test:** after a training block or 1RM test, step your bodyweight and lifts up or down and see your new DOTS, how it compares with your last test, and the rungs it climbs before you save. Each saved test is dated (today, or an earlier day to backfill an old test) and kept in your history. Your weight class is worked out from your bodyweight, or you can pick one to compare against, such as a class you plan to cut to.
- **Progress:** a chart of your score at every test, with the rungs you're between and the next one above; tap it to see any test. Switch it to your total or bodyweight, or to the last 3 months; tiles show how your total, bodyweight and score have moved. The weight-class lever shows what the same total would score at a lighter bodyweight, such as the class below. The lift split compares your squat, bench and deadlift, and every test can be corrected or deleted.
- **Progress → upcoming events:** add upcoming meets or test days, each with a month (or an exact date, which counts down as "Meet in N days" on the ladder), the bodyweight you expect, and conservative and optimistic squat, bench and deadlift targets. The next 3 show on the ladder, so you can see which rungs each target would reach.
- **Private to your phone:** everything you enter is saved in the browser on that device, and never sent anywhere or committed.

## How it works

1. `pipeline/build_rungs.py` turns OpenPowerlifting's public-domain bulk download into `data/rungs.json`: DOTS and GL percentiles for each sex, weight class and experience group (first meet, second meet, 3+ meets), both from the same lifters. No names.
2. `index.html` + `app/` is a static page (plain HTML, CSS and JS, no build step) that shows where my DOTS sits on the ladder and the next rung to beat. It's hosted on GitHub Pages.
3. `manifest.webmanifest`, `icons/` and `sw.js` make the page an installable app (a PWA). The service worker fetches every file from the network first and falls back to the last copy offline.

## Install on Android

Open the site in Chrome, then menu → **Add to home screen** → **Install**. It opens full screen and works offline with the last data it loaded.

## View the page locally

```
python3 -m http.server 8000   # from the repo root, then open http://localhost:8000
```

Opening `index.html` directly won't work: browsers block loading the JSON file from `file://`.

## Rebuild the rungs

```
cd pipeline
python3 build_rungs.py --download                              # fetch the latest zip, then build
python3 build_rungs.py /path/to/openpowerlifting-latest.zip   # or build from a zip you have
```

Writes `data/rungs.json`. Options: `python3 build_rungs.py --help`. Never commit the zip.

## Tests

```
python3 -m pip install -r requirements-dev.txt   # pytest
(cd pipeline && python3 -m pytest test_build_rungs.py)
npm test                                         # Node 24, no packages
```

Details, coverage and CI: `docs/testing.md`.

## Privacy rules

- Public pages show aggregate rungs only (groups of 20+ lifters). No names or per-lifter rows.
- No personal data in the repo. Everyone's numbers, mine included, are entered on the page and stay in the browser on that device.
- `private/` holds my own records and named-lifter data for local use, and is gitignored.
- See `docs/legal-ethics-audit.md`.

## Docs

- `docs/design.md`: the "chalk & iron" design and build spec (tokens, screens, data model, formulas and their test cases, build phases)
- `docs/legal-ethics-audit.md`: legal and ethics review
- `docs/testing.md`: running the tests, what they cover, and CI
- `docs/federation-analysis.md`: why there's no federation or drug-tested switch (data per federation, Oct 2026)
- `docs/population-estimates.md`: the one gym-goer reference marker, and why it's an estimate and never a rung

## References

- **Data:** [OpenPowerlifting](https://www.openpowerlifting.org/) bulk download, released into the public domain. The rungs are built only from this data.
- **DOTS formula:** the coefficients OpenPowerlifting uses. The page and the pipeline share them, and tests keep the two in step.
- **IPF GL points:** the International Powerlifting Federation's GL formula (2020 coefficients). The page has the full table in `app/scoring.js`; the pipeline uses the raw full-power row, with the same test values.
- **Fonts:** [Barlow and Barlow Condensed](https://github.com/jpt/barlow) by the Barlow Project Authors, SIL Open Font License 1.1 (`fonts/OFL.txt`).
- **Icons:** original pictograms drawn for this app; no third-party icons.
- **Gym-goer estimate:** method and sources in `docs/population-estimates.md`.
