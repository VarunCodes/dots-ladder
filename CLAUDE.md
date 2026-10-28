# DOTS Ladder: project brief for Claude Code

A personal powerlifting app for a UK raw lifter: track DOTS over months of training and 1RM tests, and climb a ladder of anonymous UK meet percentiles ("rungs").
Local planning notes (gitignored): `docs/conversation-summary.md`. Read them before product decisions.

## Hard guardrails
- Public output is aggregate rungs only: groups of 20+ lifters, p10/p90 only at 50+, rounded. No names, initials or per-lifter rows. Exclude under-18s and anti-doping outcomes.
- `private/` is gitignored and never committed or published.
- Data comes only from OpenPowerlifting's bulk download (public domain). Never commit the zip/CSV, only the generated `data/rungs.json`. Credit OpenPowerlifting on any public page.
- Rungs are OpenPowerlifting-only. The one exception on the ladder is the "Male/Female gym-goer (estimate)" reference marker (`GYM_GOER_ESTIMATE` in `app/ladder.js`): labelled as an estimate, styled unlike a rung, kept below every rung by a test. Don't add more estimates; see `docs/population-estimates.md`.
- The repo and the Pages site are public: no username, email, real name, venue, exact meet date or absolute paths in anything committed (files, commit messages, PRs). Personal records (my lifts, meets, plans) live in gitignored `private/` (e.g. `private/my-lifts.json`), never in the repo; everyone's numbers, mine included, are entered on the page and stay on the device.
- Front end: plain HTML/CSS/JS, no build step, no CDNs, relative paths only (Pages serves under `/dots-ladder/`, and it keeps the later PWA simple). Logic lives in `app/ladder.js` and is unit tested; `app/app.js` only renders.

## Commands
See README.md and docs/testing.md. Locally, pytest is in the repo-root `.venv`. A full pipeline rebuild takes ~35 s on the ~830 MB CSV.

## Status
Live at https://varuncodes.github.io/dots-ladder/ (public repo, Pages serves `main`), installable as a PWA (`manifest.webmanifest`, `sw.js`, network-first). When adding a file the page loads, add it to `PRECACHE` in `sw.js`; a test enforces it. Three screens behind a bottom tab bar, with hash routes (`#/ladder` default, `#/log`, `#/progress`; unknown hashes go to the Ladder): the Ladder renders in `app/app.js`, Log test in `app/log.js` (steppers, live result, a draft until "Save test"), and Your events sit on Progress (`app/events.js`) until Progress is built. Numbers and events are saved in localStorage (`dots-ladder:profile`, `dots-ladder:events`). New visitors start blank: the first-visit form on the Ladder asks for sex, bodyweight and the three lifts, and the tab bar stays hidden until then; events start empty. Entering your numbers is mandatory: there's no example or trial mode, by decision. The page loads only `data/rungs.json`; "Raw" is fixed because the rungs are raw-only. A ruleset on `main` requires a PR and all three CI checks; no direct pushes. The old private repo, `dots-ladder-old`, is archived as a backup; never push its history here.

## Next steps
1. Optional weekly GitHub Action to rebuild `rungs.json` (commit only the JSON).
2. After the first meet, note the result in `private/my-lifts.json` (local record) and update Your numbers on the phone.
3. Export/import of the on-device profile (browser storage can be wiped), then more interactions; user input stays on the device, never committed. An app-store wrapper only later, if wanted.
4. Optional local-only page reading `private/` for the named-lifter ladder.

## Conventions
UK English, kg, DOTS (not Wilks).

## Design
"Chalk & iron", from a private design spec (`private/design/`: spec and mockups for the Ladder, Log test and Progress screens; never commit them, they hold personal details). Dark only, tokens at the top of `app/style.css`: background `#111214`, surfaces `#1c1d20`/`#17181b`, chalk text `#f2f0ea`, muted `#a9a69e`, one accent `#e8c547` for you and your next action only (your row, the next-rung gain, the primary button, focus), and red `#ff6b5e` for errors only. Barlow (body) and Barlow Condensed (numbers, headings), self-hosted in `fonts/` (OFL). Uppercase section headings and eyebrow labels, as in the mockups. Ladder rows: P-label | name and DOTS | gap; the next rung dashed in accent, your row filled accent, events dashed with a flag, the gym-goer estimate muted italic with "≈". Icons are inline SVG in the sprite at the top of `index.html` (24 px grid, 1.8 stroke, `currentColor`), `aria-hidden` with the meaning in text.
