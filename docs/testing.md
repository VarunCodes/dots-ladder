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

- **DOTS**: known values for men and women, and bodyweight clamping.
- **Minors**: sub-junior, teen and under-18 divisions, ages and age classes are excluded; "Submasters" and adult divisions are kept.
- **Filters**: non-UK, non-raw, non-SBD, disqualified, pre-`--since` and nameless rows are dropped; `--tested-only` works.
- **Experience**: meets in any country or event count; no-shows don't; a lifter entered in two divisions at one meet counts once.
- **Anonymity**: groups under 20 lifters are skipped, p10/p90 appear only at 50+, and no names reach the output.
- **Input and output**: reading the CSV from inside the zip, the snapshot date taken from the zip's file name, clear errors for bad zips, and the CLI writing JSON.

`app/ladder.test.js` checks the page's logic in `app/ladder.js`:

- **Parity with the pipeline**: the same DOTS values, bodyweight clamping and weight-class boundaries as the Python tests, so the page and the rungs never disagree.
- **Page logic**: experience group, latest bodyweight, best lifts, the rungs for a group, and the next rung to beat.
- **Contract tests on the committed data**: `data/rungs.json` and `data/my-lifts.json` must give a full ladder (a median rung for every experience group in the user's class), and every rung must be aggregate only (no unexpected fields, 20+ lifters, p10/p90 only at 50+). If a pipeline change or a data edit would break the page or the privacy rules, CI fails.

`app/pwa.test.js` checks the installable app:

- **Manifest**: the fields Chrome needs to offer install, `display: standalone`, and `start_url` and `scope` of `./` (the site lives under `/dots-ladder/`).
- **Icons**: every icon exists, is a PNG of its declared size, and there's a 192 px, a 512 px and a maskable one.
- **Service worker**: every file in its cache list exists, and every file the page loads (from `index.html`, `app/app.js` and the manifest) is in that list, so the page opens offline. Adding a file to the page without caching it fails CI.

What can't run in Node is checked by hand: install from Chrome on Android, then reopen in aeroplane mode. To debug the phone, connect it over USB and open `chrome://inspect` on the computer.

The DOM code in `app/app.js` isn't unit tested. It's thin, and it's checked by viewing the page.

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

Each job takes about 10 s, most of it starting the runner and setting up Python. Private repos on GitHub's free plan get 2,000 Actions minutes a month. Each job counts as a minimum of 1 minute, so one push uses about 3 minutes.

### Required checks

GitHub can block merging a PR until the tests pass (branch protection or rulesets). For private repos that needs a paid plan; on the free plan the check is advisory only. If the repo becomes public, turn it on: Settings → Rules → require the `pytest (3.10)`, `pytest (3.14)` and `node-test` checks on `main`.
