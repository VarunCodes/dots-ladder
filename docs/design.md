# DOTS Ladder: design and build spec

The "chalk & iron" design: dark gym-floor background, chalk-white text, one chalk-yellow accent.
Three screens behind a bottom tab bar: **Ladder**, **Log test**, **Progress**.

This is the spec the app is built from, kept up to date as it's built. The original mockups stay private, because they hold personal details; the example values below are made up.

> **Privacy rule:** rungs are anonymous percentiles (DOTS and IPF GL) of UK raw full-power results, built from groups of 20+ lifters. Never show an individual lifter's name, meet, or result. The mockups' per-lifter rows become percentile rungs (see the Ladder screen).

---

## 1. Design tokens

Define these as CSS custom properties on `:root` (the top of `app/style.css`). Never hard-code the hex values elsewhere.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#111214` | Page background, tab bar |
| `--surface` | `#1C1D20` | Cards (next-rung card, chart card, stepper rows) |
| `--surface-2` | `#17181B` | List rows, stepper buttons, the unselected DOTS/GL option |
| `--border` | `#34353A` | Outlined cards, button borders |
| `--divider` | `#26272B` | Tab bar top border, bar-chart tracks |
| `--grid` | `#2A2B30` | Chart gridlines |
| `--text` | `#F2F0EA` | Primary text (warm chalk white, not pure white) |
| `--text-2` | `#D6D3CB` | Secondary emphasis, bar fills |
| `--muted` | `#A9A69E` | Labels, captions, inactive tabs |
| `--accent` | `#E8C547` | "You", current tab, primary button, goal line, the selected DOTS/GL option |
| `--accent-hover` | `#F3DA7A` | Link / button hover |
| `--on-accent` | `#111214` | Text and icons on an accent background |
| `--error` | `#FF6B5E` | Errors only |

**Accent rule:** the accent marks only *you* and *your next action*: your ladder row, the next-rung gain, the active tab, the Save button, the goal line, and the score you've chosen to see. Everything else is greyscale. Don't add a second accent colour.

Set `<meta name="theme-color" content="#111214">`. Dark only: there's no light mode.

## 2. Typography

Barlow and Barlow Condensed, self-hosted in `fonts/` (SIL OFL). No font CDN.

| Role | Font | Size / weight | Notes |
|---|---|---|---|
| Hero number (your score) | Barlow Condensed | 84px / 700, line-height 0.9 | Ladder screen only |
| Result number (Log) | Barlow Condensed | 68px / 700 | |
| Screen title | Barlow Condensed | 34px / 700, uppercase | |
| Section heading | Barlow Condensed | 22px / 600, uppercase, letter-spacing 0.02em | |
| Rung score value | Barlow Condensed | 22px / 600 (26px / 700 on your row) | |
| Eyebrow label | Barlow | 13px, uppercase, letter-spacing 0.14em, `--muted` | e.g. "DOTS LADDER" |
| Body | Barlow | 16–17px / 400–600 | |
| Caption | Barlow | 13px, `--muted` | |
| Tab label | Barlow | 12px (600 when active) | |

Use tabular figures for all numbers (`font-variant-numeric: tabular-nums`) so values don't jitter while you step them.

## 3. Layout

- Mobile-first, designed at 390 × 844. Content column max-width 480px, centred on wider screens.
- Side gutter 20px. Card radius 16px. Row radius 12px. Pill radius 999px.
- Header top padding 56px (allow for the iOS safe area: `padding-top: max(56px, env(safe-area-inset-top))`).
- Vertical rhythm: 6px between list rows, 8px between stepper rows, 16–22px between sections.
- Touch targets must be at least 44 × 44px.
- Icons: inline stroke SVGs (24px, stroke 1.8, round caps), `aria-hidden="true"` when next to a text label. No emoji.

## 4. Bottom tab bar

- Fixed to the bottom of the screen, full width. Background `--bg`, 1px top border `--divider`, padding `8px 8px max(28px, env(safe-area-inset-bottom))`.
- Three equal columns: **Ladder** (rungs icon), **Log test** (plus-in-circle icon), **Progress** (trend-arrow icon).
- Each tab has its icon above its label and is at least 48px tall.
- Active tab: `--accent`, label weight 600, `aria-current="page"`. Inactive tabs: `--muted`.
- Wrap the bar in `<nav aria-label="Main">` and make each tab a real `<a href>`.
- **Routing:** hash routes `#/ladder` (default), `#/log`, `#/progress`. Listen for `hashchange`; unknown hashes go to `#/ladder`. Hash routes work on GitHub Pages without server config.
- Pad the main content at the bottom so the fixed bar never covers the last list row.

## 5. Screens

"Score" below means whichever formula is selected, DOTS or GL (see 5.1). Every screen shows the same one, and never mixes the two.

### 5.1 Ladder (`#/ladder`)

1. **Header**
   - Eyebrow "DOTS LADDER" on the left (the app's name, so it stays "DOTS" in either formula).
   - Next to it, top right, the **score toggle**: a two-option segmented control, "DOTS" and "GL".
     - Real `<button>`s with `aria-pressed`, in a group labelled "Score shown".
     - It's out of the layout flow, so it doesn't push the score down: the eyebrow and hero keep their spacing. Below 360px wide it would overlap the score, so there it stays in the row.
     - Selected: `--accent` fill, `--on-accent` text. Unselected: `--surface-2` fill, `--muted` text. Each at least 44px tall.
     - The choice is global and saved (`profile.formula`, section 6). Changing it updates everything at once: the hero score and its label ("your DOTS" / "your GL"), the next-rung card, the rung list, the Log result card (which has its own toggle), and event scores (and the Progress screen once it's built).
   - Under the caption, a pill showing "Meet in N days" ("Meet in 1 day", "Meet today"; `--accent` background, `--on-accent` text) for the soonest event with an exact date, today or later. Hidden without one. (The mockup had it top right; the score toggle sits there now.)
   - Hero: your latest score (84px) followed by "your DOTS" or "your GL" in `--muted`.
   - Caption: `{total} kg total · {bw} kg bodyweight · {position among the rungs}`.
2. **Next-rung card** (`--surface`, 16px padding)
   - Up-arrow icon in `--accent`, then "Next rung" in `--muted`, then **"+{Δscore} {DOTS|GL} ≈ +{kg} kg on your total"**.
   - If you're above every rung: "Top rung reached".
3. **"THE RUNGS"** heading, with chips for who you're compared with: UK · Raw · Full power · {sex} {class} (the class chip opens Log test at the class picker), and tabs for meet experience: first meet, second meet, 3+ meets.
4. **Rung list**:
   - Rungs are per formula. DOTS percentiles don't map onto GL percentiles, so `rungs.json` holds a separate set for each, from the same lifters.
   - Rung row (`--surface-2`): P-label | percentile name (e.g. "Upper quartile") with the rung's score underneath | the gap from your score (`+13.5` / `−4.4`) in `--muted`.
   - The **next** rung up is dashed in `--accent`, with its gap in `--accent`, weight 600.
   - **Your row:** `--accent` background, `--on-accent` text. It shows your score (26px / 700), "You", "{total} kg @ {bw} kg", and a person icon.
   - Events are dashed rows with a flag, labelled "{name}, {14 Nov 2026 or Nov 2026}". An event with both scenarios shows two rows, named "(conservative)" and "(optimistic)", or "(cons.)" and "(opt.)" under 400px wide; screen readers always get the full word. No icons, by decision.
   - The gym-goer estimate is muted italic with "≈"; it's a DOTS estimate, so it shows in DOTS only.
   - Use a semantic `<ol>`, ordered from the highest rung down.

### 5.2 Log test (`#/log`)

Log a single 1RM (a squat PR on Monday), a full 1RM test, or just a bodyweight. Only what you change is saved.

1. Header: eyebrow "LOG A TEST", title "NEW 1RMS".
2. **Test date**: a date field, defaulting to today, so an old one can be backfilled. No future dates and nothing before 1990. A date before your latest record gets a note: it goes into your history, and the Ladder keeps showing the latest. A date before your first record saves all four values (the first record must hold them).
3. **Four stepper rows** (`--surface` cards). Each row is a grid of label | − | value | +:
   - Bodyweight: steps of 0.1 kg, 1 decimal place, caption "Morning weigh-in".
   - Squat, Bench, Deadlift: steps of 2.5 kg, caption "kg · 2.5 steps".
   - − and + are real `<button>`s, 44 × 44px, with `--surface-2` fill and a `--border` outline. Each has an aria-label such as "Increase squat".
   - The value (28px Barlow Condensed) is also directly editable: tapping it opens a numeric input.
   - Every field starts from your numbers as of the chosen date (each value as last logged on or before it).
   - **Unchanged fields are muted, not disabled:** the value in `--muted`, the caption "Last logged 12 Oct". They stay fully usable; changing one (typing, − or +) makes it part of this record, and it looks as normal again.
   - **Lifts carried from another bodyweight:** when a lift you're not logging was last logged at a bodyweight more than 5 kg from this one, the result card says so in `--text-2`: "Squat and deadlift logged at 60 kg; you're 80 kg now. Retest them for an accurate score." (The score treats them as done at today's weight.)
   - **Bodyweight older than a week** (from its last logging to the chosen date): the caption becomes "From 3 Oct · update it?" in `--text-2`. A nudge only; it never blocks saving.
   - Values can't go below the minimum.
4. **Live result card** (1px `--border` outline), which updates on every change:
   - Top row: on the left, "Squat 150 kg · +5 kg" when one lift changed, otherwise "Total {n} kg". On the right, "+x vs last" in `--accent` when you've improved, or "−x vs last" in `--muted` when you haven't (at the formula's precision). "Last" is your numbers as of the chosen date, before this record; before your first record it says "First record".
   - The score (68px), with the same DOTS / GL toggle beside it (it names the score, so the unit is for screen readers only). Here the accent belongs to Save, so the selected option is `--text` fill with `--bg` text, like the experience tabs. Switching saves the formula only, never the draft's numbers.
   - A rung line: "Climbs N rung(s). Next rung needs X more {DOTS|GL}." or "Clears every rung."
5. **Save** button: full width, 52px tall, `--accent` fill, `--on-accent` text, 17px / 600. It names what will be saved: "Save squat 1RM", "Save squat & bench", "Save test" (all three lifts), "Save bodyweight" (bodyweight goes along with any lift), or a disabled "No changes yet". It adds a record of just those values and returns you to `#/ladder`.

### 5.3 Progress (`#/progress`)

1. Header: eyebrow "PROGRESS", title "THE CLIMB", and the same DOTS / GL toggle as the Ladder's, top right and out of the layout flow (so the header keeps its spacing; under 360px it sits in the row). Switching it redraws Progress and is saved for every screen.
2. **Chart controls**, above the card: **Score | Lifts | BW** on the left (chalk when chosen, like the experience tabs) and **3M | All** on the right (text, the chosen one underlined in `--accent`), each at least 44px. **Lifts** adds a second row underneath in the same underlined style: **Total | Squat | Bench | Deadlift**. All of it is remembered on the device (the store's `view`).
   - **Score** plots your score with everything below (rungs, bands, rung-cleared rings). **Lifts** and **BW** plot kg ("370 kg total now", "120 kg bench now", "70 kg bodyweight now") with no rungs, since rungs are scores. A bodyweight change is never in the accent: lighter isn't automatically better. No change reads "±0 kg".
   - **Total** has a point on every day you logged anything (the rest carried forward). **A single lift** has a point only on the days that lift was logged, never a carried value, and **draws that lift's own rungs in kg** ("Next rung · P25 · 130 kg", bands and rung-cleared rings as on Score). Its PRs get a small "PR" label above the point ("PR · Personal record" in the legend), so they don't clash with the hollow rung-cleared ring; a PR label that would touch a rung or band label goes below its point instead.
   - **Whose rungs:** a caption under the header, "Rungs: men 83 kg, first meet" (or "Bench rungs: …"), wherever rungs are drawn. They follow your class now, so earlier points at another bodyweight are compared with this class too.
   - **3M** shows the last 3 months (from the same day 3 months ago; with no test that recent, the latest still shows). The header's "since", and the tiles, follow the range.
3. **Chart card** (`--surface`): one component, the same height from one test to many, so the page doesn't jump as data grows. Hand-drawn SVG (no chart library); layout in `app/chart.js`.
   - Header: your latest score (44px) with "{DOTS|GL} now"; on the right "+x since {first test's date}" (`--accent` when up), or "Starting point" with one test. On a narrow screen the change drops onto its own line rather than squeezing the score. Under it, the first rung above the plot, e.g. "P50 · 338 ↑ off chart".
   - **Each day's numbers:** what was logged that day plus the rest carried forward. A squat 1RM alone still gets a point (its score uses your latest bench, deadlift and bodyweight); the tooltip names it ("14 Oct · Squat 1RM · PR") and says what was carried ("bench & deadlift carried"; screen readers get each value's date). Lifts carried from a bodyweight more than 5 kg away say so instead ("squat & deadlift from 60 kg").
   - **One point per day:** the day's last-saved test, the one the Ladder treats as latest. Several tests on one day would otherwise sit on top of each other; all of them stay in the Tests list, and the tooltip says "2 more that day".
   - Each day's score, in that test's own sex: `--accent` dots (10px) joined by a 2.5px line. The selected test (the latest by default) is ringed, with a thin guide line down to the axis.
   - **Rung cleared:** the test where you first reached a rung (after a test below it) is a hollow accent ring. A rung cleared from your first test isn't marked.
   - **Other sex category:** a muted (`--text-2`) dot, so it isn't read as this category's.
   - **Y-axis:** round values on the left (270, 290, 310) with faint `--divider` gridlines. The range snaps out to those values, so a labelled line always sits below your lowest test and above your highest.
   - **Beyond the published rungs:** when a test sits above the group's top rung, a faint band (`--text` at 4%) fills the plot above that line, named in the gutter: "Top 10%" (or "Top 25%" for a group whose top rung is P75). Below the lowest rung: "Bottom 10%" at the foot. No P0 or P100: those are single lifters' exact results, which the privacy rules never show.
   - **A gutter on the right** holds the rung labels: points stop before it, so your latest test never covers a label at any width. Rung lines run on into it.
   - **Rung lines** (no goal line): dashed lines for the rungs between your lowest and highest score, plus the next rung above your latest. Labels carry the value: the next rung in `--accent` above its line, "Next rung · P25 · 300"; others `--muted` below theirs, "P10 · 266". They come from the group the Ladder shows (class and experience tab), so the two always agree.
   - Month labels at 11px in `--muted`: every month, or every 2nd once the range passes 7 months; January shows the year ("Jan ’27"). The range always reaches the next label after your latest test, so the month ahead is in view.
   - The top of the plot keeps room for the next rung's label only when there is one; above the top rung, the points use that space.
   - **One test:** a single dot, centred in about four months, with no line, and the next rung above it.
   - **10+ tests (dense):** dots shrink to 6px and the line to 2px; only the selected test (and rung-cleared rings) stay full size.
   - **Touch:** dots can sit closer than 44px, so there's no button per dot. One button covers the plot: a tap selects the day nearest it, and the left and right arrow keys step through days. Tapping the test that's already showing hides its tooltip and guide line (it can cover a neighbouring test); the latest keeps its ring.
   - **Tooltip** by the selected point (replacing the detail row): "26 Oct · 1RM test", "277.9 · −15.8" (or "first test"), and "370 kg @ 70" with "Women's test" or "2 more that day" when they apply ("Log another to see your progress." with one test). It goes right of the point whenever it fits there clear of the labels and the card edge, so the line up to the point stays visible; otherwise left; if neither fits, it narrows to the roomier side and wraps. It sits level with the point, nudged in near the top and bottom. Screen readers get the same words, plus where it sat ("Between P10 and P25"), from a live region.
   - **Legend** under the plot, listing only what's drawn: 1RM test, Rung, Rung cleared, and the other category's test.
   - The SVG has `role="img"` and an aria-label summing up first and latest scores.
   - With no tests there's nothing to draw, but that can't happen: the first visit saves a first test, and the last test can't be deleted.
4. **Stat tiles** (2 × 2, `--surface`), since your first test (or over the last 3 months with 3M), always about your score and numbers whatever the chart plots:
   - **Total:** latest total, and its change in kg (`--accent` when up; "First test" with one).
   - **Bodyweight:** latest bodyweight, and its change in kg (always `--muted`: lighter isn't automatically better).
   - **Avg per month:** the change in score from first to latest test, divided by the months between them; "—" with under 4 weeks between them. A plain average of what happened, not a prediction.
   - **Rungs cleared:** how many rungs you've reached since your first test, with the highest and when ("P10 · 20 Aug"), or the next one ("Next: P25"). If your latest score has fallen back below it: "P50 · 3 Oct · since dropped".
   - The tiles always cover every day in range, whatever the chart plots.
5. **"Weight-class lever" card** (outlined)
   - "Same {total} kg total at {targetBw} kg = **{score} {DOTS|GL}**", with the number in accent.
   - Caption: "+{delta} from bodyweight alone", plus ", enough to clear P{n}" when it would clear a rung of the Ladder's group.
   - The target bodyweight is a field (saved as `profile.targetBw`; empty means the default). The default is the top of the next lighter class, i.e. cutting one class (66 kg at 70 kg), or the top of your class if it's the lightest.
6. **"LIFT SPLIT"**: "Against UK meet lifters: men 83 kg, first meet.", then three horizontal bars (Squat, Bench, Deadlift). Under each bar, where that lift sits among its own rungs ("Between P50 and P75", "Above P90"), so the lift holding your total back stands out.
   - Track `--divider`, fill `--text-2`, height 10px, radius 5px.
   - Width is relative to your best lift; the kg value sits on the right.
7. **"1RMs"**: every record, newest first: the date with a **PR** badge (chalk outline) when it beat your previous best on a lift, what it logged ("Squat 1RM · 150 kg", "1RM test · 370 kg @ 70 kg", "Bodyweight · 69.5 kg"; "· Women's" for the other category), and your score at it on the right.
   - Open one to fix its date, sex or the values it logged; the rest are noted as "carried from earlier records". Valid changes save straight away; closing it with invalid values undoes them.
   - "Delete squat 1RM" (or "Delete 1RM test", …) asks first. Your only record can't be deleted ("Clear my numbers" on Log test starts over), nor the first while the next one doesn't hold all four values.
8. **"UPCOMING"**: the events editor (meets or test days with conservative and optimistic targets, and an optional exact date).

**Nice to have, later:** a gym test or meet type for each entry (meets as diamonds on the chart, with the class competed in), and a trend line with a projection ("P25 around Mar 2027").

## 6. Data model (one store)

Everything stays on the device. Nothing the lifter enters is sent anywhere.

**One store, one key.** `app/store.js` is the only code that reads or writes the browser's storage, under one versioned key, `dots-ladder:data`:

```json
{ "version": 2,
  "settings": { "weightClass": null, "formula": "dots", "targetBw": null },
  "entries":  [{ "id": "uuid", "date": "2027-01-15", "sex": "M", "bodyweight": 82.5, "squat": 150, "bench": 105, "deadlift": 190 },
               { "id": "uuid", "date": "2027-02-03", "sex": "M", "squat": 155 }],
  "events":   [{ "id": "uuid", "name": "Spring meet", "month": "2027-04", "date": "2027-04-10", "bodyweight": 82,
                 "conservative": { "squat": 155, "bench": 107.5, "deadlift": 195 }, "optimistic": null }],
  "view":     { "metric": "score", "lift": "total", "range": "all" } }
```

Each new field defaults when it's missing, so adding an optional field never needs a migration.

- **`settings`, settings only.** Your numbers (sex, bodyweight, lifts) are never stored here: they're worked out from your entries.
  - `weightClass` is `null` when it's worked out from bodyweight.
  - `formula` is `"dots"` or `"gl"`: the score every screen shows. It defaults to `"dots"`.
  - `targetBw` is the weight-class lever's bodyweight, or `null` for the default.
- **`entries`,** every record, oldest first; same-day records keep their save order. **A record holds only what was logged** (any of bodyweight, squat, bench, deadlift): a full 1RM test, a single 1RM, or a bodyweight. Nothing worked out is stored (not "carried", not a type that the logged values already tell).
  - **Your numbers on a date** are the latest of each value up to that date, carried forward. The earliest record must hold all four, so every record has a full set to score; saving refuses a history that doesn't start that way.
  - Each record keeps its sex, so it's always scored in the category it was done in.
- **`events`,** planned meets or test days. `date` is optional (`null` for a month-only plan); setting it sets the month, and moving the month away from it clears it.
- **`view`,** what the Progress chart plots (`score`, `lifts`, `bw`), which lift Lifts shows (`total`, `squat`, `bench`, `deadlift`) and over which range (`3m`, `all`). Anything missing or unknown is Score, Total and All.

**Version 1** kept four keys (`dots-ladder:profile`, `:tests`, `:events`, `:progress-view`). They're migrated once, when version 2 doesn't exist yet, with nothing lost: an older profile that still held numbers becomes the first record (dated that day) when there were none, records without a sex take the profile's, and the old "Total" chart tab opens as Lifts → Total. The old keys are left in place for now (an older cached copy of the app still finds its data, and going back a version loses nothing); "Clear my numbers" removes the old profile and records too.

**Derived values.** `app/derive.js` works out everything from the store once per change (your profile, carried values, one point per day, scores, rungs, PRs, the lever, events' scores) using the pure functions in `ladder.js`, `scoring.js` and `chart.js`. Screens and cards only read these; none keeps its own copy of the entries or works out a score itself. Every change goes through `store.update()`, and one subscriber refreshes the screen that's showing.

- Calculate scores whenever they're displayed. Never store them.
- The store wraps every storage read and write in try/catch. If storage is empty, corrupt or unavailable, the app starts with an empty state (and changes last until the page closes). A screen with no tests shows an empty state that links to `#/log`.

**Rung data** (`data/rungs.json`, built by the pipeline, the only data the page loads): for each group (sex, class, experience), `dots` and `gl` percentiles and, under `lifts`, each lift's percentiles in kg rounded to the nearest 2.5 kg, all from the same lifters' same results. Each lift's set carries its own `lifters` count and follows the same rules (20+ lifters, p10/p90 only at 50+). Per-lift rungs come from full-power meets only, so all three lifts describe the same people as the score rungs; they don't change with the DOTS / GL toggle.

## 7. Calculations (unit-test these)

All formulas live in `app/scoring.js`: each is a coefficient table plus a function, so adding one (Wilks, say) is one more entry.

```
score(formula, { total, bw, sex, equipment = "classic", event = "full" })
```

- `formula`: `"dots"` or `"gl"`. `sex`: `"M"` or `"F"`. `equipment`: `"classic"` or `"equipped"`. `event`: `"full"` or `"bench"`.
- The rungs are raw full power, so the app always uses classic, full.
- Display precision: **DOTS to 1 decimal place, GL to 2.** Published rungs: DOTS whole numbers, GL 1 decimal place.

**DOTS** = `500 / (a·bw⁴ + b·bw³ + c·bw² + d·bw + e) × total`. It ignores equipment and event.

| | a | b | c | d | e | bw clamp |
|---|---|---|---|---|---|---|
| Men | −0.0000010930 | 0.0007391293 | −0.1918759221 | 24.0900756 | −307.75076 | 40–210 |
| Women | −0.0000010706 | 0.0005158568 | −0.1126655495 | 13.6175032 | −57.96288 | 40–150 |

**IPF GL points** = `total × 100 / (A − B·e^(−C·bw))`. "Total" is the bench result when `event` is `"bench"`. Minimum bodyweight 40 kg for men and 35 kg for women; a total of 0 scores 0.

| Sex | Equipment | Event | A | B | C |
|---|---|---|---|---|---|
| M | classic | full | 1199.72839 | 1025.18162 | 0.00921 |
| M | equipped | full | 1236.25115 | 1449.21864 | 0.01644 |
| M | classic | bench | 320.98041 | 281.40258 | 0.01008 |
| M | equipped | bench | 381.22073 | 733.79378 | 0.02398 |
| F | classic | full | 610.32796 | 1045.59282 | 0.03048 |
| F | equipped | full | 758.63878 | 949.31382 | 0.02435 |
| F | classic | bench | 142.40398 | 442.52671 | 0.04724 |
| F | equipped | bench | 221.82209 | 357.00377 | 0.02937 |

Men's classic C is **0.00921**. Some copies of the IPF PDF misprint it as 0.09210; don't use that.

**kg to next rung** = `kgToNextRung(formula, …)`: solve for the total that reaches the next rung's score, subtract the current total, and round **up** to the next 2.5 kg, because attempts go up in 2.5 kg steps.

**Same total at the target bodyweight** = `scoreAtBodyweight(formula, total, targetBw, sex)`.

### Required test cases

| Input | Expected |
|---|---|
| DOTS(370, 70.0, M) | 277.9 |
| DOTS(370, 66.0, M) | 289.9 |
| DOTS(500, 93.0, M) | 318.1 |
| DOTS(300, 60.0, F) | 332.6 |
| DOTS kg to next rung: 277.9 → 282.7 at 70 kg, total 370 | raw 6.35, displayed **+7.5 kg** |
| DOTS: bodyweight below 40 or above the clamp | clamped, no NaN or Infinity |
| DOTS: total 0 | 0.0 |
| GL, men's classic full, total 370 @ 66 / 70 / 74 / 83 | 57.68 / 55.92 / 54.32 / 51.22 |
| GL, women's classic full, 300 @ 60 | 67.81 |
| GL 370 @ 70, men | **not** about 30.9 (that's the misprinted C) |
| GL: total 0 | 0 |
| GL: bodyweight below the minimum | clamped, no NaN or Infinity |
| kgToNextRung, both formulas | always a multiple of 2.5 |
| You above every rung | "Top rung reached", no next-rung number |

(The mockup showed "+6.5 kg". The 2.5 kg rounding rule makes that **+7.5 kg**. Follow the spec, not the mockup.)

## 8. Accessibility

- Text contrast is at least 4.5:1. All the token pairs above pass on `--bg` and `--surface`.
- Every control is a real `<button>`, `<a>` or `<input>` with a `<label>`. Never put click handlers on a `div`.
- Toggles (experience tabs, the DOTS/GL toggle) use `aria-pressed`.
- Keep focus outlines visible: `outline: 2px solid var(--accent); outline-offset: 2px`.
- Respect `prefers-reduced-motion`: nothing moves or scales, but colour changes and fades stay, so every state change is still visible.
- Touch targets are at least 44px; a smaller-looking control (the class chip) extends its tap area with a pseudo-element.

## 8a. Motion

Restrained and quick: motion confirms a change, it never decorates. Plain CSS, using the tokens on `:root` in `app/style.css` (named after the transitions.dev scale): `--duration-quick` 150ms for presses, number swaps and closes, `--duration-fast` 250ms for slides, opens and screens, and `--ease-smooth-out`. No bounce, no `transition: all`, no motion on typing or stepper values.

- **Choices** (DOTS/GL, experience tabs, chart views) sit in one track, and the chosen fill slides to the option you pick; the 3M | All and lift rows slide their accent underline. Their buttons are built once and updated in place (`dom.js` `choiceGroup`), so the transitions play.
- **Buttons that act** (Save, steppers, + Add, the class chip) shrink to 96% while pressed. Hover states only where there's a pointer.
- **Screens** fade in and rise 8px when you switch to them, not on first load.
- **Headline numbers** (the Ladder score, the chart's latest) fade the new value in when it changes. The Log result doesn't, as it changes with every keystroke.
- **Events and records** open and close smoothly to their height (Chromium; other browsers snap).
- **After a save**, the Ladder says what it achieved under the caption: "Saved", "Saved · PR on squat", "Saved · Cleared P25" (a rung counts only within the same group). Its accent check draws itself in (500ms), the score fades to its new value, and the note goes on the next change or when you leave the Ladder.
- **The chart line** carries a soft chalk glint that runs towards your latest entry every few seconds and, arriving, wraps that entry's ring both ways (over and under) before fading (off with reduced motion).
- **Tab bar icons** are outlines; the open tab's filled version cross-fades in (scale, blur and opacity; not on first load).

## 9. Build phases (one PR each, checked on the phone between them)

1. ✅ **Tokens and type.** The CSS variables and fonts; the ladder restyled. (PR #11)
2. ✅ **Tab bar and routing.** The three hash routes and the fixed bottom bar. (PR #12)
3. ✅ **Scoring module and tests.** Pure functions for DOTS and GL, kg to the next rung and the same total at the target bodyweight, with the section 7 cases; the DOTS/GL toggle and GL rungs.
4. ✅ **Log test.** Steppers, live result and saving (PR #12); the dated test history with an editable date, "vs last test", exact meet dates and the "Meet in N days" pill.
5. ✅ **Progress.** The chart (one, a few and 10+ tests), the weight-class lever, the lift split, and the editable list of tests.
6. ✅ **PWA.** `manifest.webmanifest` and a network-first service worker that caches the app shell and the rung data; installs and works offline. (PR #3, before the redesign)
