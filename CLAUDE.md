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

## Next steps
1. Move to a fresh public repo (single clean commit), then enable Pages and required CI checks.
2. Optional weekly GitHub Action to rebuild `rungs.json` (commit only the JSON).
3. After the first meet, add the result to `data/my-lifts.json`.
4. Make the site an installable PWA; an app-store wrapper only after that, if wanted.
5. Optional local-only page reading `private/` for the named-lifter ladder.

## Conventions
UK English, kg, DOTS (not Wilks).
