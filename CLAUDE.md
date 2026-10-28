# DOTS Ladder: project brief for Claude Code

A personal powerlifting app for a UK raw lifter: track DOTS over months of training and 1RM tests, and climb a ladder of anonymous UK meet percentiles ("rungs").
Local planning notes (gitignored): `docs/conversation-summary.md`. Read them before product decisions.

## Hard guardrails
- Public output is aggregate rungs only: groups of 20+ lifters, p10/p90 only at 50+, rounded. No names, initials or per-lifter rows. Exclude under-18s and anti-doping outcomes.
- `private/` is gitignored and never committed or published.
- Data comes only from OpenPowerlifting's bulk download (public domain). Never commit the zip/CSV, only the generated `data/rungs.json`. Credit OpenPowerlifting on any public page.
- The repo and the Pages site are public: no username, email, real name, venue, exact meet date or absolute paths in anything committed (files, commit messages, PRs). Meets in `data/my-lifts.json` are month-only (`"month": "YYYY-MM"`); a contract test enforces it.
- Front end: plain HTML/CSS/JS, no build step, no CDNs, relative paths only (Pages serves under `/dots-ladder/`, and it keeps the later PWA simple). Logic lives in `app/ladder.js` and is unit tested; `app/app.js` only renders.

## Commands
See README.md and docs/testing.md. Locally, pytest is in the repo-root `.venv`. A full pipeline rebuild takes ~35 s on the ~830 MB CSV.

## Status
Live at https://varuncodes.github.io/dots-ladder/ (public repo, Pages serves `main`), installable as a PWA (`manifest.webmanifest`, `sw.js`, network-first). When adding a file the page loads, add it to `PRECACHE` in `sw.js`; a test enforces it. Lifts, bodyweight, sex and weight class are editable on the page and saved in localStorage (`dots-ladder:profile`); `my-lifts.json` only supplies the defaults. A ruleset on `main` requires a PR and all three CI checks; no direct pushes. The old private repo, `dots-ladder-old`, is archived as a backup; never push its history here.

## Next steps
1. Optional weekly GitHub Action to rebuild `rungs.json` (commit only the JSON).
2. After the first meet, add the result to `data/my-lifts.json`.
3. Export/import of the on-device profile (browser storage can be wiped), then more interactions; user input stays on the device, never committed. An app-store wrapper only later, if wanted.
4. Optional local-only page reading `private/` for the named-lifter ladder.

## Conventions
UK English, kg, DOTS (not Wilks).
