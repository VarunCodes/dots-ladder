# DOTS Ladder: project brief for Claude Code

A personal powerlifting app for a UK raw lifter: track DOTS (or IPF GL) over months of 1RM tests, and climb a ladder of anonymous UK meet percentiles ("rungs").
Local planning notes (gitignored): `docs/conversation-summary.md`. Read them before product decisions.

## Hard guardrails
- Public output is aggregate rungs only: groups of 20+ lifters, p10/p90 only at 50+, rounded. Never p0/p100 or any single lifter's result (beyond the rungs, the chart says "Top 10%" instead). No names, initials or per-lifter rows. Exclude under-18s and anti-doping outcomes.
- `private/` is gitignored and never committed or published.
- Data comes only from OpenPowerlifting's bulk download (public domain). Never commit the zip/CSV, only the generated `data/rungs.json`. Credit OpenPowerlifting on any public page.
- Rungs are OpenPowerlifting-only. The one exception is the gym-goer reference marker (`GYM_GOER_ESTIMATE` in `app/ladder.js`, DOTS only): labelled as an estimate, styled unlike a rung, kept below every rung by a test. Don't add more estimates; see `docs/population-estimates.md`.
- The repo and the Pages site are public: no username, email, real name, venue, exact meet date or absolute paths in anything committed (files, commit messages, PRs). Personal records live in `private/`; everyone's numbers, mine included, are entered on the page and stay on the device.
- Front end: plain HTML/CSS/JS, no build step, no CDNs, relative paths only (Pages serves under `/dots-ladder/`). Logic lives in the pure, unit-tested `app/ladder.js`, `app/scoring.js` and `app/chart.js`; the other `app/*.js` files only render.

## Working here
- `main` needs a PR and all three CI checks (`pytest (3.10)`, `pytest (3.14)`, `node-test`); no direct pushes. Never push the archived `dots-ladder-old` history here.
- Every file the page loads goes in `PRECACHE` in `sw.js`; a test enforces it.
- Commands: README.md and `docs/testing.md`. pytest is in the repo-root `.venv`. A full pipeline rebuild takes ~35 s on the ~830 MB CSV.
- By decision: entering your numbers is mandatory (no example or trial mode), and "Raw" is fixed because the rungs are raw-only.

## Where things live
- Live at https://varuncodes.github.io/dots-ladder/, an installable PWA (network-first `sw.js`).
- Screens (hash routes): Ladder `app/app.js`, Log test `app/log.js`, Progress `app/progress.js` with the events editor `app/events.js`.
- Spec, data model (localStorage keys) and formulas: `docs/design.md`. The pipeline: `pipeline/build_rungs.py`.

## Backlog
- Export/import of on-device data (browser storage can be wiped).
- Optional weekly GitHub Action to rebuild `rungs.json` (commit only the JSON).
- After the first meet: note the result in `private/my-lifts.json` and log it on the phone.
- Progress PR C: gym test or meet type (meets as diamonds, class recorded) and a projection; first discuss non-linear growth and 1RMs from different days.
- A check at Save when a test's sex differs from the last one; event labels wrapping with an exact date.
- Optional local-only page reading `private/` for the named-lifter ladder.

## Conventions
UK English, kg, DOTS and IPF GL (not Wilks). The app name "DOTS Ladder" stays; in copy about a score, use the selected formula's label.

## Design
"Chalk & iron", specified in `docs/design.md` (public, made-up example values only); the original mockups stay in gitignored `private/design/` (they hold personal details). Dark only, tokens at the top of `app/style.css`: one accent `#e8c547` for you and your next action only, red `#ff6b5e` for errors only. Barlow and Barlow Condensed, self-hosted in `fonts/`. Icons are inline SVG in the sprite in `index.html`, `aria-hidden` with the meaning in text.
