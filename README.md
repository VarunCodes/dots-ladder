# DOTS Ladder

Track my powerlifting DOTS score over time and climb a ladder of anonymous benchmarks ("rungs") built from UK meet results.

## How it works

1. `pipeline/build_rungs.py` turns OpenPowerlifting's public-domain bulk download into `data/rungs.json`: DOTS percentiles for each sex, weight class and experience group (first meet, second meet, 3+ meets). No names.
2. `data/my-lifts.json` holds my own lifts, bodyweight, meets and projections.
3. `index.html` + `app/` is a static page (plain HTML, CSS and JS, no build step) that shows where my DOTS sits on the ladder and the next rung to beat. It will be hosted on GitHub Pages.

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

Data: [OpenPowerlifting](https://www.openpowerlifting.org/), public domain.
