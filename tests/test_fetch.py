from datetime import date
from types import SimpleNamespace

from src.fetch import days_to_fetch, load_store, newest_date, to_row

TODAY = date(2026, 7, 7)


class FakeTable:
    def __init__(self, rows):
        self.rows = rows

    def select(self, *_a, **_kw):
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


class FakeClient:
    def __init__(self, rows):
        self._table = FakeTable(rows)

    def table(self, name):
        assert name == "daily_metrics"
        return self._table


def test_empty_table_backfills():
    days = days_to_fetch(None, TODAY, backfill_days=90)
    assert len(days) == 91  # 90 days back through today inclusive
    assert days[0] == date(2026, 4, 8)
    assert days[-1] == TODAY


def test_incremental_fetch_refetches_last_stored_day():
    # Newest stored day may have been fetched mid-day, so re-fetch from one
    # day before it through today.
    days = days_to_fetch(date(2026, 7, 1), TODAY, backfill_days=90)
    assert days[0] == date(2026, 6, 30)
    assert days[-1] == TODAY
    assert len(days) == 8


def test_newest_date_from_client():
    client = FakeClient([{"date": "2026-07-01"}])
    assert newest_date(client) == date(2026, 7, 1)


def test_newest_date_empty_table():
    assert newest_date(FakeClient([])) is None


def test_to_row_maps_fields_and_stamps_date():
    row = to_row("2026-07-01", {"totalKilocalories": 2500, "totalSteps": 8000})
    assert row["date"] == "2026-07-01"
    assert row["total_kcal"] == 2500
    assert row["steps"] == 8000
    assert "updated_at" in row


def test_to_row_ignores_unmapped_keys():
    row = to_row("2026-07-01", {"unknownField": 1})
    assert "unknownField" not in row
    assert "unknown_field" not in row


def test_load_store_maps_columns_back_to_record_field_names():
    rows = [{"date": "2026-07-01", "total_kcal": 2500, "steps": 8000, "updated_at": "x"}]
    store = load_store(FakeClient(rows))
    assert store == {"2026-07-01": {"totalKilocalories": 2500, "totalSteps": 8000}}


def test_load_store_empty_table():
    assert load_store(FakeClient([])) == {}
