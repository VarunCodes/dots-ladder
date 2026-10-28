#!/usr/bin/env python3
"""
build_rungs.py - turn the OpenPowerlifting bulk download into anonymous "rungs".

What it does
  1. Reads the OpenPowerlifting bulk CSV (the .zip as downloaded, or an unzipped .csv).
  2. Works out how many meets each lifter had competed in before each result.
  3. Keeps UK, raw, full-power (squat/bench/deadlift) results from adult lifters.
  4. Groups lifters by sex, weight class and experience, and works out DOTS percentiles.
  5. Writes rungs.json: a small file of group statistics with no names in it.

Only rungs.json belongs in your repo. Never commit the downloaded zip/CSV.

Usage
  python3 build_rungs.py openpowerlifting-latest.zip
  python3 build_rungs.py openpowerlifting-latest.zip --since 2024-01-01 --tested-only
  python3 build_rungs.py --download            # fetch the zip first (check DOWNLOAD_URL below)

Needs only Python 3.10+ and its standard library.
"""

import argparse
import csv
import io
import json
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

# Confirmed working 27 Oct 2026. If it breaks, check the "Data" page on openpowerlifting.org.
DOWNLOAD_URL = "https://openpowerlifting.gitlab.io/opl-csv/files/openpowerlifting-latest.zip"
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "data" / "rungs.json"

UK_COUNTRIES = {"England", "Scotland", "Wales", "N.Ireland", "UK"}
FAILED_PLACES = {"DQ", "DD", "NS", "G"}  # disqualified, doping DQ, no-show, guest
NOT_COMPETED = {"NS"}                     # a no-show doesn't count as meet experience

# IPF classes (upper limits in kg). Results are grouped by actual bodyweight,
# because federations use slightly different class sets.
CLASSES = {
    "M": [59, 66, 74, 83, 93, 105, 120],
    "F": [47, 52, 57, 63, 69, 76, 84],
}
CORE_PERCENTILES = [25, 50, 75]
EXTREME_PERCENTILES = [10, 90]

# Sub-junior / youth division labels. Deliberately does NOT match "Submasters" (35-39).
MINOR_DIVISION = re.compile(r"sub[\s_-]*(jr|junior)|(^|[\s_-])sj($|[\s_-])|teen|youth|u1[0-8]\b", re.I)
MINOR_AGE_CLASSES = {"5-12", "13-15", "16-17"}


class DataError(Exception):
    """Raised when the input file can't be used."""


def weight_class(sex, bodyweight):
    for limit in CLASSES[sex]:
        if bodyweight <= limit:
            return f"{limit}"
    return f"{CLASSES[sex][-1]}+"


def experience_bucket(prior_meets):
    if prior_meets == 0:
        return "first meet"
    if prior_meets == 1:
        return "second meet"
    return "3+ meets"


def dots(sex, bodyweight, total):
    """DOTS score, used only when the CSV's own Dots value is missing."""
    if sex == "M":
        a, b, c, d, e = -0.000001093, 0.0007391293, -0.1918759221, 24.0900756, -307.75076
        bodyweight = min(max(bodyweight, 40.0), 210.0)
    else:
        a, b, c, d, e = -0.0000010706, 0.0005158568, -0.1126655495, 13.6175032, -57.96288
        bodyweight = min(max(bodyweight, 40.0), 150.0)
    denom = a * bodyweight**4 + b * bodyweight**3 + c * bodyweight**2 + d * bodyweight + e
    return total * 500 / denom


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def is_minor(row):
    age = to_float(row.get("Age"))
    if age is not None and age < 18:
        return True
    if row.get("AgeClass") in MINOR_AGE_CLASSES:
        return True
    return bool(MINOR_DIVISION.search(row.get("Division") or ""))


def csv_name(path):
    """Name of the CSV to read: the first .csv inside a .zip, or the file itself."""
    path = Path(path)
    if path.suffix.lower() != ".zip":
        return path.name
    try:
        with zipfile.ZipFile(path) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    except zipfile.BadZipFile as exc:
        raise DataError(f"{path} isn't a valid zip file.") from exc
    if not names:
        raise DataError(f"No .csv file found inside {path}.")
    return names[0]


def snapshot_date(path):
    """OPL snapshot date from the CSV's name (openpowerlifting-YYYY-MM-DD-...), or None."""
    match = re.search(r"openpowerlifting-(\d{4}-\d{2}-\d{2})", csv_name(path))
    return match.group(1) if match else None


def open_rows(path):
    """Yield CSV rows from a .zip (first .csv inside) or a plain .csv, streaming."""
    path = Path(path)
    if path.suffix.lower() == ".zip":
        name = csv_name(path)
        with zipfile.ZipFile(path) as zf:
            with zf.open(name) as raw:
                yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", newline=""))
    else:
        with open(path, encoding="utf-8", newline="") as f:
            yield from csv.DictReader(f)


def percentile(sorted_values, p):
    """Linear-interpolation percentile of an already sorted list."""
    k = (len(sorted_values) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (k - lo)


class MeetIndex:
    """Gives each meet a small integer id, so lifter histories don't hold repeated strings."""

    def __init__(self):
        self.ids = {}

    def id_for(self, row):
        key = (row.get("Date", ""), row.get("Federation", ""), row.get("MeetName", ""))
        if key not in self.ids:
            self.ids[key] = len(self.ids)
        return self.ids[key]


def build(path, since="2024-01-01", min_group=20, min_group_extremes=50, tested_only=False):
    # Pass 1: every lifter's distinct meets (any country or event) where they actually competed.
    meets = MeetIndex()
    history = defaultdict(set)  # lifter -> {(date, meet id)}
    for row in open_rows(path):
        if not row.get("Name") or not row.get("Date") or row.get("Place") in NOT_COMPETED:
            continue
        history[row["Name"]].add((row["Date"], meets.id_for(row)))
    order = {name: sorted(entries) for name, entries in history.items()}
    del history

    # Pass 2: eligible results. One value per lifter per group: their most recent result.
    latest = {}  # (sex, class, experience, lifter) -> (date, DOTS)
    seen = set()
    for row in open_rows(path):
        sex = row.get("Sex")
        if sex not in CLASSES or not row.get("Name"):
            continue
        if row.get("Event") != "SBD" or row.get("Equipment") != "Raw":
            continue
        if row.get("MeetCountry") not in UK_COUNTRIES:
            continue
        if tested_only and row.get("Tested") != "Yes":
            continue
        if row.get("Place") in FAILED_PLACES or (row.get("Date") or "") < since:
            continue
        if is_minor(row):
            continue
        total, bw = to_float(row.get("TotalKg")), to_float(row.get("BodyweightKg"))
        if not total or not bw:
            continue

        name, meet = row["Name"], (row["Date"], meets.id_for(row))
        if (name, meet) in seen:  # same meet listed under two divisions
            continue
        seen.add((name, meet))

        prior = order[name].index(meet)
        score = to_float(row.get("Dots")) or dots(sex, bw, total)
        key = (sex, weight_class(sex, bw), experience_bucket(prior), name)
        if key not in latest or row["Date"] > latest[key][0]:
            latest[key] = (row["Date"], score)

    # Group, apply the minimum group sizes, and drop names.
    groups = defaultdict(list)
    for (sex, wclass, exp, _name), (_date, score) in latest.items():
        groups[(sex, wclass, exp)].append(score)

    rungs, skipped = [], 0
    for (sex, wclass, exp), scores in sorted(groups.items()):
        if len(scores) < min_group:
            skipped += 1
            continue
        scores.sort()
        rung = {"sex": sex, "weightClassKg": wclass, "experience": exp, "lifters": len(scores)}
        shown = CORE_PERCENTILES + (EXTREME_PERCENTILES if len(scores) >= min_group_extremes else [])
        for p in sorted(shown):
            rung[f"p{p}"] = round(percentile(scores, p))  # p50 is the median
        rungs.append(rung)

    return {
        "snapshot": snapshot_date(path),
        "source": "OpenPowerlifting bulk data (public domain), openpowerlifting.org",
        "filters": {
            "countries": sorted(UK_COUNTRIES),
            "event": "SBD",
            "equipment": "Raw",
            "testedOnly": tested_only,
            "since": since,
            "adultsOnly": True,
            "minGroupSize": min_group,
            "minGroupSizeForP10P90": min_group_extremes,
            "onePerLifter": "most recent result per lifter within each group",
        },
        "groupsSkippedTooSmall": skipped,
        "rungs": rungs,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("data", nargs="?", default="openpowerlifting-latest.zip", help="bulk .zip or .csv")
    ap.add_argument("--download", action="store_true", help="download the latest zip first")
    ap.add_argument("--since", default="2024-01-01", help="only results on or after this date")
    ap.add_argument("--min-group", type=int, default=20, help="smallest group that gets a rung")
    ap.add_argument("--min-group-extremes", type=int, default=50,
                    help="smallest group that also gets p10 and p90")
    ap.add_argument("--tested-only", action="store_true", help="only drug-tested federations")
    ap.add_argument("--out", default=DEFAULT_OUT, help="default: data/rungs.json in the repo")
    args = ap.parse_args(argv)

    if args.download:
        print(f"Downloading {DOWNLOAD_URL} ...")
        urllib.request.urlretrieve(DOWNLOAD_URL, args.data)
    if not Path(args.data).exists():
        sys.exit(f"Can't find {args.data}. Download it from openpowerlifting.org, or use --download.")

    try:
        result = build(args.data, args.since, args.min_group, args.min_group_extremes, args.tested_only)
    except DataError as exc:
        sys.exit(str(exc))
    Path(args.out).write_text(json.dumps(result, indent=2) + "\n")
    print(f"Wrote {len(result['rungs'])} rungs to {args.out} "
          f"({result['groupsSkippedTooSmall']} groups too small to publish).")


if __name__ == "__main__":
    main()
