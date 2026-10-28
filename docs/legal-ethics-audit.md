# Lifter Data App: Legal and Ethics Audit

Written 27 Oct 2026. General review, not legal advice.

## Verdict

A private ladder for your own use is low risk. A public site or a commercial app built on per-lifter records is not, even with initials, and Apple's review rules make that design hard to ship at all. The safest route to the same "climb the ladder" experience is to rank against **aggregate rungs** (percentiles by class, sex and experience) computed from OpenPowerlifting's public-domain data, not against individual lifters.

| Scenario | Risk | Why |
| --- | --- | --- |
| Private: on your device or a private, unshared page | Low | Likely within UK GDPR's personal/household exemption; data is public domain |
| Public GitHub Pages site with per-lifter rows (names or initials) | Medium | Publishing to the world falls outside the household exemption; initials are still personal data |
| Commercial app with per-lifter rows | High | Full UK GDPR duties, weaker legitimate-interests case, Apple bars compiling personal data from public databases without consent |
| Commercial app with aggregate rungs only | Low | No individual is identifiable; OpenPowerlifting data is public domain |

Before a paid launch, a short consultation with a UK data protection solicitor is worth the cost.

## Data sources

Use OpenPowerlifting's bulk download, not the federation websites. It is the only source with a clear licence.

| Source | What it holds | Licence or terms | Use it? |
| --- | --- | --- | --- |
| [OpenPowerlifting](https://www.openpowerlifting.org/dist/openipf/faq) | Meet results for UK federations (EPA, BP, BPU, UKIPL and more): bodyweight, lifts, totals, age, division | Data released into the public domain; site code is AGPLv3+ | Yes, via the bulk data download |
| Federation sites (British Powerlifting, EPA, BPU) | Results PDFs, records, rankings | No public data licence found; [British Powerlifting's by-laws](https://www.britishpowerlifting.org/wp-content/uploads/2025/03/By-Laws-.pdf) require results and records to be published but say nothing on reuse | Only with written permission |
| Lifter social media (Instagram, YouTube) | Training logs, gym 1RMs, videos | Platform terms generally prohibit scraping | No |

- **Training data and gym 1RMs aren't in any official source.** Federations publish meet results only.
- **Public domain removes the copyright and database-right barrier for OpenPowerlifting's data, not the privacy one.** UK GDPR still applies to personal data taken from it.
- **AGPL applies only if you reuse OpenPowerlifting's code.** Using only the data carries no such duty.

These are powerlifting federations, not bodybuilding bodies; bodybuilding federations publish placings, not lifts.

## UK GDPR

Meet results about named lifters are personal data, and being public does not change that. Initials don't anonymise them either.

**Initials are not enough.** The ICO's "motivated intruder" test asks whether someone could re-identify a person using means reasonably likely to be used. Initials plus meet, date, bodyweight and total match back to the full name on OpenPowerlifting in seconds. Pseudonymised data is still personal data ([summary of ICO guidance](https://wiggin.co.uk/insight/anonymisation-and-pseudonymisation-ico-issues-guidance/)). Data is only anonymous once it can't be linked to a person, for example a percentile across hundreds of lifters.

**The personal-use exemption is narrow.** It covers purely personal or household activity: a ladder on your own device fits; a public GitHub Pages site generally doesn't.

**If GDPR applies, you are the data controller and need:**

- **A lawful basis.** Almost always legitimate interests: a specific purpose, necessity, and a balance against lifters' interests ([ICO position, summarised by Osborne Clarke](https://www.osborneclarke.com/insights/ico-updates-its-views-using-personal-data-generative-ai-uk)). People usually don't know their data is being scraped, which weighs against you; a commercial purpose makes the balance harder.
- **Necessity.** If aggregates give the same experience, per-lifter records are hard to justify.
- **Transparency.** Article 14 requires telling people when you didn't collect their data directly, or at minimum a clear public privacy notice.
- **Rights handling.** Objection, erasure and access requests need a contact route and a fast removal process.
- **Registration.** A commercial controller usually pays the ICO's annual data protection fee.

**Leave out entirely:** anyone under 18; anti-doping outcomes; exact bodyweight where weight class will do (weight can count as health data in some contexts).

## Database right, copyright and scraping

Individual results are facts and can't be copyrighted, but a collection can be protected. OpenPowerlifting has waived its rights; the federations haven't.

- **Database right** protects substantial investment in a database for 15 years. Extracting a substantial part, or repeatedly taking small parts, infringes it ([overview](https://sprintlaw.co.uk/articles/understanding-the-copyright-and-rights-in-databases-regulations-1997-what-uk-businesses-need-to-know/); [1997 Regulations](https://www.legislation.gov.uk/uksi/1997/3032/note)). Scraping every results page from a federation site is that pattern.
- **Exceptions are narrow:** non-commercial research and private study, with acknowledgement.
- **Copyright** can cover a database's original arrangement and document layout, not raw numbers.
- **Website terms** can forbid automated access. Check terms and robots.txt; prefer official downloads or permission.
- **OpenPowerlifting** is public domain. Credit it anyway, and report errors via its issue tracker.

## Personal vs commercial

| Factor | Personal use | Public site (GitHub Pages) | Commercial app |
| --- | --- | --- | --- |
| UK GDPR | Likely exempt (household) | Applies | Applies; legitimate-interests balance harder |
| Database right (federation data) | Private-study exception may help | Risky without permission | Needs permission |
| OpenPowerlifting data | Fine | Fine for licensing; GDPR still applies | Fine for licensing; GDPR still applies |
| App store rules | Not relevant | Not relevant | Apple and Google requirements apply |
| Privacy notice and rights process | Not needed | Needed | Needed, plus ICO fee |

**Apple:** guideline 5.1.1 (numbered (vii) when added in 2019) bars apps that compile personal information from any source other than the user, even public databases, without consent ([2019 update](https://mjtsai.com/blog/2019/06/04/updates-to-the-app-store-review-guidelines/); [text excerpt](https://conductatlas.com/platform/apple/apple-app-store-review-guidelines/provision/CA-P-019067/apps-may-not-compile-personal-information-without-user-consent/)). Per-lifter results are likely to be rejected.

**Google Play:** public privacy policy and an accurate Data safety form required; data used only for disclosed purposes ([User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?authuser=1)).

**Designs that pass:** (1) aggregate rungs; (2) opt-in profiles where lifters claim their own record; (3) friends' ladders with consent.

## Ethics

Lifters agreed to federation publication, not to being rungs on someone else's ladder. Private motivation is harmless; publishing or selling is a different act.

- Context matters: a "lifters to beat" list feels more personal than a sporting record.
- The bottom of the table is the sensitive part: low totals, masters and first-timers.
- Records go stale and errors get copied forward.
- Commercial use sits uneasily with a volunteer-run, open-data sport.
- Give back: credit OpenPowerlifting, report errors, consider supporting the project.

## Checklist

### Personal build (GitHub Pages)

- [ ] Use OpenPowerlifting's bulk download, not scraped federation pages, and never commit the raw CSV to the repo
- [ ] Keep any per-lifter ladder local only (an HTML file or localhost), with its data file in .gitignore. A private repo isn't enough: a GitHub Pages site is public on normal plans even when its repo is private
- [ ] Publish only aggregate rungs: groups of 20+ lifters, no minimum or maximum values, rounded to whole numbers
- [ ] Commit only the small generated rungs file (no names) and your own lifts
- [ ] Exclude under-18s and anti-doping data
- [ ] Credit OpenPowerlifting on the page

### Before a commercial launch

- [ ] Rebuild the ladder on aggregate rungs, or on opt-in and friends' data only
- [ ] Write a legitimate interests assessment for any personal data you still hold
- [ ] Publish a privacy policy and fill in Google Play's Data safety form
- [ ] Set up a contact route for lifters' objection and erasure requests
- [ ] Pay the ICO data protection fee if you process personal data commercially
- [ ] Get written permission before using any federation's own data
- [ ] Check App Store guideline 5.1.1 against your final design
- [ ] Book a short review with a UK data protection solicitor
