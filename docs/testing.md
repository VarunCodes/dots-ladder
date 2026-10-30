# Testing

There are two suites: pytest for the Python pipeline, and Node's built-in test runner for the page's logic.

## Run the tests locally

```
python3 -m pip install -r requirements-dev.txt   # pytest, pinned
cd pipeline
python3 -m pytest test_build_rungs.py
cd ..
npm test                                         # Node 24; no npm packages to install
```

Each suite runs in well under a second. The pipeline tests build small CSVs inside each test, so they need no OpenPowerlifting download and no network.

## What the tests cover

`pipeline/test_build_rungs.py` checks `build_rungs.py` against the privacy rules and the data logic:

- **DOTS and GL**: known values for men and women, bodyweight clamping (GL: 40 kg men, 35 kg women), a total of 0, and a guard against the misprinted men's GL constant. The same values as `app/scoring.test.js`.
- **DOTS and GL rungs**: both come from the same lifters' same results, have the same percentiles, and are rounded (DOTS whole numbers, GL 1 decimal place); the CSV's own `Dots` and `Goodlift` values are preferred.
- **Minors**: sub-junior, teen and under-18 divisions, ages and age classes are excluded; "Submasters" and adult divisions are kept.
- **Filters**: non-UK, non-raw, non-SBD, disqualified, pre-`--since` and nameless rows are dropped; `--tested-only` works.
- **Experience**: meets in any country or event count; no-shows don't; a lifter entered in two divisions at one meet counts once.
- **Anonymity**: groups under 20 lifters are skipped, p10/p90 appear only at 50+, and no names reach the output.
- **Input and output**: reading the CSV from inside the zip, the snapshot date taken from the zip's file name, clear errors for bad zips, and the CLI writing JSON.

`app/scoring.test.js` checks the formulas in `app/scoring.js`, including every case in `docs/design.md` section 7:

- **DOTS**: the spec's values, parity with the pipeline, clamping with no NaN or Infinity, and ignoring equipment and event.
- **GL**: men's classic 370 kg at 66, 70, 74 and 83 kg; women's 300 kg at 60 kg; not the misprinted constant; a total of 0; clamping at the minimum bodyweight for every sex, equipment and event; and the right coefficients picked.
- **GL against an independent source**: one result for each of the 8 sex, equipment and event combinations must match OpenPowerlifting's own GL score (its `Goodlift` column, from its separate implementation) to 2 decimal places, so a wrong or swapped coefficient fails. Numbers only, no lifters: each bodyweight and total is shared by 2+ lifters. The 24 coefficients were also checked against the IPF's 2020 GL table.
- **Helpers**: the total for a score inverts the score, kg to the next rung rounds up to a multiple of 2.5 kg for both formulas, the same total at a lighter bodyweight, and display precision (DOTS 1 decimal place, GL 2).

`app/chart.test.js` checks the Progress chart's layout in `app/chart.js`: the 3-month window (short months and leap years clamp, across the new year) and which days 3M and All keep, the y-axis values (about three round numbers, on DOTS and GL scales), where each rung was first cleared (not one cleared from the start), the first rung above the plot, the y-axis snapped to round values, which side the tooltip goes (right when it fits clear of labels and the edge, else left, else narrowed), the tiles (total and bodyweight change, average per month and none under 4 weeks, rungs cleared), one point per day (the day's last-saved test, with the count of the others, and no two points at the same x), which rung lines are drawn (those in your range plus the next one above), one test centred with the next rung above it, tests left to right and higher scores higher, everything inside the plot, flat and same-day histories with no NaN, dense mode from 10 tests, month labels (every 2nd past 7 months, January with the year, December rolling over, and always the month after your latest test), the top room used when there's no next rung, and the Top/Bottom bands beyond the published rungs (never P0 or P100) and the nearest test to a tap.

`app/ladder.test.js` checks the page's logic in `app/ladder.js`:

- **Parity with the pipeline**: the same weight-class boundaries as the Python tests, so the page and the rungs never disagree.
- **Page logic**: the rungs for a group in one formula (never mixed, and none when the group lacks that formula), the next rung to beat, and the ladder's rows (highest first, the next rung marked, cleared rungs, the gap from your score, ties putting the rung above the marker). Every published percentile must have a name.
- **Formula setting**: a profile saved without a formula loads as DOTS, GL is kept and round-trips, and the profile's score follows it.
- **Progress**: the chart view remembered (anything unknown, corrupt or blocked back to Score and All), the weight-class lever's default target (the next lighter class), the target bodyweight kept only when valid, the lever's score, change and the rung it would clear (in DOTS and GL), and the "between P10 and P25" position.
- **Test history**: each test keeps its own sex (older ones take the profile's, new saves need one) and is scored in it, the profile's sex following the latest test, real calendar days only, no future dates or dates before 1990, stored tests surviving a clock change, sorting by date (same-day tests in save order), the last test on or before a date (none for an older backfill), the profile taking the latest test's numbers, numbers saved before the history becoming its first test, and saving and loading (invalid tests dropped, corrupt or blocked storage falling back).
- **Events**: month handling, the optional exact date (a real day inside the event's month; older events without one still load), the "Meet in N days" countdown (soonest dated event, today included) and calendar-day counting across clock changes and leap years, which values are wrong (including "fill in at least one scenario"), clean copies with empty scenarios as null, scores at the event's bodyweight, the next 3 upcoming events for the ladder, the class note when an event's bodyweight is in another class, the rung an event beats, and saving and loading (invalid saved events dropped, deleting every event kept, corrupt or blocked storage falling back).
- **Screens and Log test**: the route from the URL hash (unknown or query-suffixed hashes handled), stepper presses (one decimal place, kept in range, an empty field starting at the minimum), and how many rungs a new result climbs or drops.
- **First visit**: the onboarding form only flags values that have been entered, and isn't complete until all five are valid.
- **Editable numbers**: the class list per sex, the class worked out from bodyweight or chosen, the "weigh in at X kg or under" check, rejecting missing or out-of-range values and naming which ones (so the page can say what to fix), and saving to and loading from browser storage (with a fake storage: nothing saved, corrupt JSON, invalid values and blocked storage all fall back).
- **Gym-goer marker**: the estimate and label for each sex ("Male gym-goer (estimate)" ~200, "Female gym-goer (estimate)" ~160), in DOTS only: GL gets no marker.
- **Contract tests on the committed data** (`data/rungs.json`, the only data file the page loads):
  - Every rung must be aggregate only: no unexpected fields, 20+ lifters, and p10/p90 only at 50+, with the same percentiles in DOTS and GL.
  - Rungs are rounded (DOTS whole numbers, GL 1 decimal place) and rise with the percentile.
  - Every class in the rungs must be choosable in the class dropdown.
  - The gym-goer estimates must stay below every published DOTS rung, so the marker never passes for one (see `docs/population-estimates.md`).

  If a pipeline change or a data edit would break the page or the privacy rules, CI fails.

`app/pwa.test.js` checks the installable app:

- **Manifest**: the fields Chrome needs to offer install, `display: standalone`, and `start_url` and `scope` of `./` (the site lives under `/dots-ladder/`).
- **Icons**: every icon exists, is a PNG of its declared size, and there's a 192 px, a 512 px and a maskable one.
- **Service worker**: every file in its cache list exists, and every file the page loads is in that list, so the page opens offline. That covers `index.html` (in-page `#` references from the icon sprite are skipped), every module `app/app.js` imports directly or indirectly, the data files, files the stylesheet loads (the font) and the manifest icons. Adding a file to the page without caching it fails CI.
- **Offline behaviour**: `sw.js` runs in Node with a stub network and cache. Online, it serves the network copy, saves it, and revalidates rather than trusting the browser's HTTP cache. Offline, it serves the saved copy, opening any page falls back to the saved start page, and with nothing saved the request fails instead of hanging. Other sites and non-GET requests are left to the browser.

What can't run in Node (the browser installing the app and swapping in the service worker) is checked by hand: install from Chrome on Android, then reopen in aeroplane mode. To debug the phone, connect it over USB and open `chrome://inspect` on the computer.

The DOM code in `app/app.js`, `app/log.js`, `app/progress.js` and `app/events.js` isn't unit tested; it only renders what `ladder.js`, `scoring.js` and `chart.js` work out. So far it has been checked by hand and with headless Chrome runs outside the repo, so nothing in CI exercises the page in a real browser yet.

## CI: GitHub Actions

`.github/workflows/tests.yml` runs both suites on every pull request and on every push to `main`. A PR shows a green tick or a red cross next to each job: `pytest (3.10)`, `pytest (3.14)` and `node-test`.

| Setting | Why |
| --- | --- |
| Python 3.10 and 3.14 | The two ends of the supported range (see below) |
| Node 24 for `node-test` | Matches local; `node --test` is built in, so nothing is installed |
| `permissions: contents: read` | The job can read the repo but not change it |
| `timeout-minutes: 5` | A hung job can't burn minutes; a normal run takes about 10 s |
| pip cache keyed on `requirements-dev.txt` | pytest isn't re-downloaded each run |
| `concurrency` with cancel-in-progress | A new push cancels the previous run on the same branch |

### Why two Python versions

The pipeline says it needs **Python 3.10+**. Testing both ends of that range catches two different mistakes:

- **3.10, the oldest supported.** It catches code that uses something newer by accident (syntax or a standard-library function added in 3.11+). That would pass on a modern machine and break on 3.10. The floor is 3.10 because pytest 9 needs it.
- **3.14, the newest, and the local version.** It catches anything deprecated or removed in recent Python.

If both ends pass, the versions in between almost always do too, so they aren't tested. The two jobs run in parallel, so the second one adds no waiting time.

To raise the floor, change the lower version in the workflow's matrix and the "Python 3.10+" line in the `build_rungs.py` docstring together.

### Cost and speed

Each job takes about 10 s, most of it starting the runner and setting up Python. The repo is public, and GitHub Actions is free for public repos on standard runners, so CI costs nothing.

### Required checks

A ruleset on `main` requires a pull request and all three checks (`pytest (3.10)`, `pytest (3.14)` and `node-test`) to pass before merging, so nothing reaches `main` or the live site without green CI. It's under Settings → Rules.
