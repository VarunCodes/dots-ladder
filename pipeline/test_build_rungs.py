"""Tests for build_rungs.py. Run with: python3 -m pytest test_build_rungs.py"""

import csv
import io
import json
import zipfile

import pytest

import build_rungs as br

COLUMNS = ["Name", "Sex", "Event", "Equipment", "Age", "AgeClass", "Division", "BodyweightKg",
           "TotalKg", "Best3SquatKg", "Best3BenchKg", "Best3DeadliftKg", "Place", "Dots", "Goodlift", "Tested", "Federation", "MeetCountry", "Date", "MeetName"]


def row(name, date, meet="Meet", total=400, bw=70.0, **overrides):
    base = dict(Name=name, Sex="M", Event="SBD", Equipment="Raw", Age="", AgeClass="",
                Division="Open", BodyweightKg=bw, TotalKg=total, Best3SquatKg=round(total * 0.35, 1), Best3BenchKg=round(total * 0.25, 1),
                Best3DeadliftKg=round(total * 0.4, 1), Place="1", Dots="", Goodlift="",
                Tested="Yes", Federation="EPA", MeetCountry="England", Date=date, MeetName=meet)
    base.update(overrides)
    return base


def write_csv(tmp_path, rows, name="data.csv"):
    path = tmp_path / name
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    return path


def first_timers(n, date="2025-06-01", meet="Debut", prefix="New", **overrides):
    return [row(f"{prefix} {i}", date, meet, total=300 + i * 5, **overrides) for i in range(n)]


def rung(result, experience):
    return next(r for r in result["rungs"] if r["experience"] == experience)


# --- DOTS ---------------------------------------------------------------------

def test_dots_matches_known_value():
    assert br.dots("M", 70, 370) == pytest.approx(277.9, abs=0.1)


def test_dots_female_regression():
    # Regression value from the published women's coefficients (matched real OPL rows, Oct 2026).
    assert br.dots("F", 60, 300) == pytest.approx(332.56, abs=0.01)


def test_dots_clamps_bodyweight():
    assert br.dots("M", 20, 300) == br.dots("M", 40, 300)
    assert br.dots("M", 250, 300) == br.dots("M", 210, 300)


# --- GL: the same cases as app/scoring.test.js -------------------------------

@pytest.mark.parametrize("bw,expected", [(66, 57.68), (70, 55.92), (74, 54.32), (83, 51.22)])
def test_gl_men_classic_full(bw, expected):
    assert round(br.gl("M", bw, 370), 2) == expected


def test_gl_women_classic_full():
    assert round(br.gl("F", 60, 300), 2) == 67.81


def test_gl_not_the_misprinted_constant():
    assert abs(br.gl("M", 70, 370) - 30.9) > 10


def test_gl_zero_total_and_clamped_bodyweight():
    assert br.gl("M", 70, 0) == 0
    assert br.gl("M", 20, 370) == br.gl("M", 40, 370)
    assert br.gl("F", 20, 300) == br.gl("F", 35, 300)
    assert br.gl("F", 36, 300) != br.gl("F", 35, 300)


# --- Minor detection ----------------------------------------------------------

@pytest.mark.parametrize("division", ["MR-Sj", "Sub-Juniors", "Sub Junior", "SubJr", "Teen 16-17", "U18"])
def test_minor_divisions_are_excluded(division):
    assert br.is_minor(row("X", "2025-01-01", Division=division))


@pytest.mark.parametrize("division", ["Submasters", "MR-O", "Juniors", "Masters 1", "Open"])
def test_adult_divisions_are_kept(division):
    assert not br.is_minor(row("X", "2025-01-01", Division=division))


def test_minor_by_age_and_age_class():
    assert br.is_minor(row("X", "2025-01-01", Age="17"))
    assert br.is_minor(row("X", "2025-01-01", AgeClass="16-17"))
    assert not br.is_minor(row("X", "2025-01-01", Age="18"))


# --- Weight classes and experience --------------------------------------------

@pytest.mark.parametrize("bw,expected", [(66.0, "66"), (66.1, "74"), (74.0, "74"), (130, "120+")])
def test_weight_class_boundaries(bw, expected):
    assert br.weight_class("M", bw) == expected


def test_experience_buckets():
    assert [br.experience_bucket(n) for n in (0, 1, 2, 7)] == \
        ["first meet", "second meet", "3+ meets", "3+ meets"]


# --- build(): filtering -------------------------------------------------------

def test_filters_drop_ineligible_rows(tmp_path):
    rows = first_timers(20) + [
        row("Yank", "2025-06-01", MeetCountry="USA"),
        row("Kid", "2025-06-01", Division="MR-Sj"),
        row("Dq", "2025-06-01", Place="DQ"),
        row("Benchy", "2025-06-01", Event="B"),
        row("Wraps", "2025-06-01", Equipment="Wraps"),
        row("Old", "2023-01-01"),
    ]
    result = br.build(write_csv(tmp_path, rows), min_group=20)
    assert rung(result, "first meet")["lifters"] == 20


def test_rows_without_a_name_are_skipped(tmp_path):
    result = br.build(write_csv(tmp_path, first_timers(20) + [row("", "2025-06-01")]), min_group=20)
    assert rung(result, "first meet")["lifters"] == 20


def test_duplicate_divisions_count_once(tmp_path):
    rows = first_timers(20) + [row("New 0", "2025-06-01", "Debut", total=300, Division="MR-Jr")]
    result = br.build(write_csv(tmp_path, rows), min_group=20)
    assert rung(result, "first meet")["lifters"] == 20


def test_no_show_does_not_count_as_experience(tmp_path):
    rows = first_timers(19) + [
        row("Ghost", "2024-03-01", "Earlier", Place="NS"),
        row("Ghost", "2025-06-01", "Debut"),
    ]
    result = br.build(write_csv(tmp_path, rows), min_group=20)
    assert rung(result, "first meet")["lifters"] == 20


def test_experience_counts_meets_in_any_country_or_event(tmp_path):
    rows = first_timers(20) + [
        row("Traveller", "2024-02-01", "Arnold", MeetCountry="USA", Event="B"),
        row("Traveller", "2025-06-01", "Debut"),
    ]
    result = br.build(write_csv(tmp_path, rows), min_group=1)
    assert rung(result, "second meet")["lifters"] == 1
    assert rung(result, "first meet")["lifters"] == 20


def test_tested_only_flag(tmp_path):
    rows = first_timers(20) + first_timers(5, meet="Untested", prefix="Raw", Tested="")
    assert rung(br.build(write_csv(tmp_path, rows), min_group=20), "first meet")["lifters"] == 25
    tested = br.build(write_csv(tmp_path, rows), min_group=20, tested_only=True)
    assert rung(tested, "first meet")["lifters"] == 20


# --- build(): grouping and anonymity ------------------------------------------

def test_small_groups_are_skipped(tmp_path):
    result = br.build(write_csv(tmp_path, first_timers(19)), min_group=20)
    assert result["rungs"] == []
    assert result["groupsSkippedTooSmall"] == 1


def test_extreme_percentiles_need_a_bigger_group(tmp_path):
    small = rung(br.build(write_csv(tmp_path, first_timers(20)), min_group=20), "first meet")
    big = rung(br.build(write_csv(tmp_path, first_timers(50)), min_group=20), "first meet")
    for formula in ("dots", "gl"):
        assert set(small[formula]) == {"p25", "p50", "p75"}
        assert set(big[formula]) == {"p10", "p25", "p50", "p75", "p90"}


def test_dots_and_gl_come_from_the_same_lifters(tmp_path):
    result = rung(br.build(write_csv(tmp_path, first_timers(20)), min_group=20), "first meet")
    assert set(result) == {"sex", "weightClassKg", "experience", "lifters", "dots", "gl", "lifts"}
    totals = sorted(300 + i * 5 for i in range(20))
    assert result["dots"]["p50"] == round(br.percentile([br.dots("M", 70, t) for t in totals], 50))
    assert result["gl"]["p50"] == round(br.percentile([br.gl("M", 70, t) for t in totals], 50), 1)


def test_rounding_dots_whole_gl_one_decimal(tmp_path):
    result = rung(br.build(write_csv(tmp_path, first_timers(20)), min_group=20), "first meet")
    assert all(isinstance(v, int) for v in result["dots"].values())
    assert all(round(v, 1) == v for v in result["gl"].values())
    assert any(round(v) != v for v in result["gl"].values()), "GL keeps its decimal place"


def test_latest_result_per_lifter_is_used(tmp_path):
    vets = []
    for i in range(20):
        for j, (date, total) in enumerate([("2023-01-01", 300), ("2023-06-01", 310),
                                           ("2024-06-01", 600), ("2025-06-01", 400)]):
            vets.append(row(f"Vet {i}", date, f"Meet {j}", total=total))
    result = br.build(write_csv(tmp_path, vets), min_group=20)
    # 2024-06-01 (600) and 2025-06-01 (400) are both "3+ meets"; the later one wins.
    assert rung(result, "3+ meets")["dots"]["p50"] == round(br.dots("M", 70, 400))
    assert rung(result, "3+ meets")["gl"]["p50"] == round(br.gl("M", 70, 400), 1)


def test_output_has_no_names(tmp_path):
    result = br.build(write_csv(tmp_path, first_timers(25)), min_group=20)
    assert "New " not in json.dumps(result)


def test_csv_score_columns_are_preferred(tmp_path):
    rows = [row(f"New {i}", "2025-06-01", "Debut", Dots="300", Goodlift="61.23") for i in range(20)]
    result = rung(br.build(write_csv(tmp_path, rows), min_group=20), "first meet")
    assert result["dots"]["p50"] == 300
    assert result["gl"]["p50"] == 61.2


# --- Per-lift rungs ------------------------------------------------------------

def test_each_lift_gets_its_own_percentiles_in_kg_rounded_to_2_5(tmp_path):
    result = rung(br.build(write_csv(tmp_path, first_timers(20)), min_group=20), "first meet")
    squats = sorted(round((300 + i * 5) * 0.35, 1) for i in range(20))
    assert result["lifts"]["squat"]["lifters"] == 20
    assert result["lifts"]["squat"]["p50"] == br.round_to_plate(br.percentile(squats, 50))
    for lift in ("squat", "bench", "deadlift"):
        values = [v for k, v in result["lifts"][lift].items() if k != "lifters"]
        assert all(v % 2.5 == 0 for v in values), (lift, values)
        assert set(result["lifts"][lift]) == {"lifters", "p25", "p50", "p75"}


def test_lift_percentiles_follow_the_size_rules_on_their_own_count(tmp_path):
    big = rung(br.build(write_csv(tmp_path, first_timers(50)), min_group=20), "first meet")
    assert {"p10", "p90"} <= set(big["lifts"]["bench"])
    # Five lifters have no bench best: 45 bench values, so no p10/p90 for bench, but squat keeps them.
    rows = first_timers(45) + first_timers(5, prefix="Old", Best3BenchKg="")
    mixed = rung(br.build(write_csv(tmp_path, rows), min_group=20), "first meet")
    assert mixed["lifters"] == 50 and "p10" in mixed["dots"]
    assert mixed["lifts"]["bench"]["lifters"] == 45 and "p10" not in mixed["lifts"]["bench"]
    assert "p10" in mixed["lifts"]["squat"]


def test_a_lift_with_too_few_values_is_left_out(tmp_path):
    rows = first_timers(15, Best3DeadliftKg="") + first_timers(5, prefix="Late")
    result = rung(br.build(write_csv(tmp_path, rows), min_group=20), "first meet")
    assert "deadlift" not in result["lifts"] and "squat" in result["lifts"]


def test_round_to_plate():
    assert [br.round_to_plate(x) for x in (101.2, 101.3, 102.4, 103.8)] == [100.0, 102.5, 102.5, 105.0]


# --- Input handling -----------------------------------------------------------

def test_reads_csv_inside_zip(tmp_path):
    csv_path = write_csv(tmp_path, first_timers(20))
    zip_path = tmp_path / "opl.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.write(csv_path, "openpowerlifting-2026-10-24-abc123/openpowerlifting-2026-10-24-abc123.csv")
    result = br.build(zip_path, min_group=20)
    assert rung(result, "first meet")["lifters"] == 20
    assert result["snapshot"] == "2026-10-24"


def test_snapshot_is_null_when_file_name_has_no_date(tmp_path):
    assert br.build(write_csv(tmp_path, first_timers(20)), min_group=20)["snapshot"] is None


def test_zip_without_csv_gives_clear_error(tmp_path):
    zip_path = tmp_path / "empty.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr("README.txt", "nothing here")
    with pytest.raises(br.DataError, match="No .csv"):
        br.build(zip_path)


def test_bad_zip_gives_clear_error(tmp_path):
    bad = tmp_path / "broken.zip"
    bad.write_text("not a zip")
    with pytest.raises(br.DataError, match="valid zip"):
        br.build(bad)


def test_cli_writes_json(tmp_path):
    out = tmp_path / "rungs.json"
    br.main([str(write_csv(tmp_path, first_timers(20))), "--out", str(out)])
    assert json.loads(out.read_text())["rungs"][0]["lifters"] == 20
