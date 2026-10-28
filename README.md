# DOTS Ladder

Track my powerlifting DOTS score over time and climb a ladder of anonymous benchmarks ("rungs") built from UK meet results.

## What's DOTS?

DOTS stands for **Dynamic Objective Team Scoring**. It turns a powerlifting total (squat + bench + deadlift) into a score adjusted for bodyweight and sex, so lifters of different sizes can be compared fairly: a heavier lifter needs a bigger total for the same score. Many federations use it in place of the older Wilks formula, and OpenPowerlifting lists it alongside meet results.

## How it works

1. `pipeline/build_rungs.py` turns OpenPowerlifting's public-domain bulk download into `data/rungs.json`: DOTS percentiles for each sex, weight class and experience group (first meet, second meet, 3+ meets). No names.
2. `data/my-lifts.json` holds my own lifts, bodyweight, meets and events. The page only uses it for starting values:
   - **Edit your numbers** changes sex, bodyweight, squat, bench and deadlift, and the weight class (worked out from bodyweight unless you pick one).
   - **Your events** holds upcoming meets or test days: a month, the bodyweight, and conservative and optimistic squat, bench and deadlift. The next 3 appear on the ladder.
   - Edits are saved in the browser on that device, never sent or committed.
3. `index.html` + `app/` is a static page (plain HTML, CSS and JS, no build step) that shows where my DOTS sits on the ladder and the next rung to beat. It's hosted on GitHub Pages.
4. `manifest.webmanifest`, `icons/` and `sw.js` make the page an installable app (a PWA). The service worker fetches every file from the network first and falls back to the last copy offline.

## Install on Android

Open the site in Chrome, then menu → **Add to home screen** → **Install**. It opens full screen and works offline with the last data it loaded.

## View the page locally

```
python3 -m http.server 8000   # from the repo root, then open http://localhost:8000
```

Opening `index.html` directly won't work: browsers block loading the JSON files from `file://`.

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
- My own data is limited to what the page needs: lifts, bodyweight, and meets to the month only.
- `private/` holds named-lifter data for local use and is gitignored.
- See `docs/legal-ethics-audit.md`.

## Docs

- `docs/legal-ethics-audit.md`: legal and ethics review
- `docs/testing.md`: running the tests, what they cover, and CI
- `docs/federation-analysis.md`: why there's no federation or drug-tested switch (data per federation, Oct 2026)

Data: [OpenPowerlifting](https://www.openpowerlifting.org/), public domain.
