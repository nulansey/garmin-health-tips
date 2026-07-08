from datetime import date

import pytest

from src.patterns import data_age_days, pattern_summary, target_burn

TODAY = date(2026, 7, 7)  # a Tuesday


def day(iso, kcal=None, steps=None):
    rec = {}
    if kcal is not None:
        rec["totalKilocalories"] = kcal
    if steps is not None:
        rec["totalSteps"] = steps
    return {iso: rec}


def test_target_burn_weights_recent_weekdays_more():
    # Four past Tuesdays; half-life 7 days => weights 0.5, 0.25, 0.125, 0.0625
    store = {
        **day("2026-06-30", kcal=2000),   # 7 days old
        **day("2026-06-23", kcal=3000),   # 14
        **day("2026-06-16", kcal=3000),   # 21
        **day("2026-06-09", kcal=3000),   # 28
    }
    # (2000*.5 + 3000*(.25+.125+.0625)) / (.5+.25+.125+.0625) = 2466.67
    assert target_burn(store, TODAY, half_life_days=7) == 2467


def test_target_burn_falls_back_to_overall_with_few_weekday_obs():
    # Only 2 Tuesdays (< 4 observations) => use ALL days.
    # Huge half-life makes weights ~equal: mean of (3000*2 + 1000*6)/8 = 1500
    store = {
        **day("2026-06-30", kcal=3000),  # Tue
        **day("2026-06-23", kcal=3000),  # Tue
        **day("2026-07-01", kcal=1000),
        **day("2026-07-02", kcal=1000),
        **day("2026-07-03", kcal=1000),
        **day("2026-07-04", kcal=1000),
        **day("2026-07-05", kcal=1000),
        **day("2026-07-06", kcal=1000),
    }
    assert target_burn(store, TODAY, half_life_days=100000) == 1500


def test_target_burn_ignores_days_without_calorie_data():
    store = {
        **day("2026-06-30", kcal=2000),
        **day("2026-06-23"),  # watch not worn — no kcal key
    }
    assert target_burn(store, TODAY, half_life_days=100000) == 2000


def test_target_burn_raises_on_empty_store():
    with pytest.raises(RuntimeError):
        target_burn({}, TODAY, half_life_days=45)


def test_data_age_days():
    store = {**day("2026-07-04", kcal=2000)}
    assert data_age_days(store, TODAY) == 3
    assert data_age_days({}, TODAY) is None


def test_pattern_summary_shape():
    store = {
        **day("2026-06-30", kcal=2000, steps=8000),  # Tue
        **day("2026-06-23", kcal=3000, steps=4000),  # Tue
        **day("2026-07-06", kcal=2500, steps=6000),  # Mon
        **day("2026-06-01", kcal=2200, steps=5000),  # Mon, > 14 days old
    }
    s = pattern_summary(store, TODAY, half_life_days=45)

    assert s["today"] == "2026-07-07"
    assert s["today_weekday"] == "Tuesday"
    assert s["newest_date"] == "2026-07-06"
    assert s["data_age_days"] == 1

    assert s["weekday_averages_weighted"]["Tuesday"]["n"] == 2
    assert s["weekday_averages_weighted"]["Monday"]["n"] == 2

    # last_14_days excludes the 2026-06-01 entry
    dates_14 = [r["date"] for r in s["last_14_days"]]
    assert "2026-06-01" not in dates_14
    assert "2026-07-06" in dates_14

    # last 4 same-weekdays: only the two Tuesdays, newest first
    assert [r["date"] for r in s["last_4_same_weekdays"]] == [
        "2026-06-30", "2026-06-23",
    ]
