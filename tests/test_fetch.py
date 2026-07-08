from datetime import date

from src.fetch import days_to_fetch, load_store, save_store

TODAY = date(2026, 7, 7)


def test_empty_store_backfills():
    days = days_to_fetch({}, TODAY, backfill_days=90)
    assert len(days) == 91  # 90 days back through today inclusive
    assert days[0] == date(2026, 4, 8)
    assert days[-1] == TODAY


def test_incremental_fetch_refetches_last_stored_day():
    # Newest stored day may have been fetched mid-day, so re-fetch from one
    # day before it through today.
    store = {"2026-07-01": {}, "2026-06-30": {}}
    days = days_to_fetch(store, TODAY, backfill_days=90)
    assert days[0] == date(2026, 6, 30)
    assert days[-1] == TODAY
    assert len(days) == 8


def test_store_roundtrip(tmp_path):
    path = tmp_path / "daily.json"
    save_store({"2026-07-01": {"totalSteps": 5000}}, path=path)
    assert load_store(path=path) == {"2026-07-01": {"totalSteps": 5000}}


def test_load_missing_store_is_empty(tmp_path):
    assert load_store(path=tmp_path / "nope.json") == {}
