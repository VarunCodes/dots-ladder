# DOTS Ladder: project brief for Claude Code

A personal powerlifting app for a UK raw lifter: track DOTS (or IPF GL) across 1RMs, and climb a ladder of anonymous UK meet percentiles ("rungs"). Gitignored planning notes: `docs/conversation-summary.md`; read before product decisions.

## Hard guardrails
- Public output is aggregate rungs only (score and per-lift): groups of 20+ lifters, p10/p90 only at 50+, rounded. Never p0/p100 or any single lifter's result; no names, initials or per-lifter rows. Exclude under-18s and anti-doping outcomes.
- Data comes only from OpenPowerlifting's bulk download (public domain): commit only the generated `data/rungs.json`, never the zip/CSV, and credit OpenPowerlifting on public pages.
- No estimates on the ladder beyond the one gym-goer marker (`GYM_GOER_ESTIMATE`, DOTS only, kept below every rung by a test); see `docs/population-estimates.md`.
- The repo, issues and Pages site are public: no username, email, real name, venue, exact meet date or absolute paths in anything committed or posted. `private/` (gitignored) is never committed; personal numbers are entered on the page and stay on the device.
- Front end: plain HTML/CSS/JS, no build step, no CDNs, relative paths (Pages serves under `/dots-ladder/`). Logic lives in the pure, unit-tested `app/ladder.js`, `app/scoring.js` and `app/chart.js`; other `app/*.js` files only render.

## Working here
- `main` needs a PR and all three CI checks; no direct pushes. Never push the archived `dots-ladder-old` history.
- Every file the page loads goes in `PRECACHE` in `sw.js` (a test enforces it).
- Commands: README.md and `docs/testing.md`; pytest is in the root `.venv`; a pipeline rebuild takes ~35 s.
- Ideas and bugs go through GitHub issues (forms in `.github/ISSUE_TEMPLATE/`). Refine in the issue (proposal, decisions marked 🟢 recommended / 🟠 needs input, "Done when"), then a PR with "Closes #N".
- By decision: entering your numbers is mandatory (no trial mode), and "Raw" is fixed (rungs are raw-only).

## Where things live
- Live: https://varuncodes.github.io/dots-ladder/ (installable PWA, network-first `sw.js`).
- Screens: Ladder `app/app.js`, Log test `app/log.js`, Progress `app/progress.js` (events editor `app/events.js`).
- Spec, data model and formulas: `docs/design.md`. Pipeline: `pipeline/build_rungs.py`.

## Backlog
Open GitHub issues. Not yet raised: a weekly rungs rebuild, meet type and projection (discuss non-linear growth first), the analytics piece (rank over time, relative strength), a check when a record's sex differs from the last, and wrapping event labels.

## Conventions
UK English, kg, DOTS and IPF GL (not Wilks). "DOTS Ladder" stays the app name; copy about a score uses the selected formula's label.

## Design
"Chalk & iron", specified in `docs/design.md`; mockups stay in `private/design/`. Dark only, tokens atop `app/style.css`: one accent `#e8c547` for you and your next action, red `#ff6b5e` for errors only. Barlow fonts self-hosted in `fonts/`. Icons are inline SVG, `aria-hidden` with the meaning in text.
