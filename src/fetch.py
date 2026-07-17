"""Pull Garmin data into Supabase (the daily_metrics table).

Run manually or via the fetch.yml GitHub Actions workflow (every ~30 min).
Backfills 90 days when the table is empty; afterwards fetches from one day
before the newest stored day (that day may have been partial when last
fetched) through today.
"""
import argparse
import datetime
import os
from datetime import date, timedelta

from supabase import create_client

from src import garmin

BACKFILL_DAYS = 90

# garmin.fetch_day() record key -> daily_metrics column name.
FIELD_MAP = {
    "totalKilocalories": "total_kcal",
    "activeKilocalories": "active_kcal",
    "bmrKilocalories": "bmr_kcal",
    "totalSteps": "steps",
    "totalDistanceMeters": "distance_m",
    "restingHeartRate": "resting_hr",
    "averageStressLevel": "avg_stress",
    "moderateIntensityMinutes": "moderate_min",
    "vigorousIntensityMinutes": "vigorous_min",
    "bodyBatteryHighestValue": "body_battery_high",
    "bodyBatteryLowestValue": "body_battery_low",
    "sleepTimeSeconds": "sleep_seconds",
    "deepSleepSeconds": "deep_sleep_seconds",
    "remSleepSeconds": "rem_sleep_seconds",
    "sleepScore": "sleep_score",
    "hrvLastNightAvg": "hrv_last_night_avg",
    "hrvStatus": "hrv_status",
    "activities": "activities",
}
FIELD_MAP_INV = {v: k for k, v in FIELD_MAP.items()}


def get_client():
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])


NON_INT_COLUMNS = {"distance_m", "activities", "hrv_status"}


def to_row(day_iso, record):
    """A garmin.fetch_day() record -> a daily_metrics row ready to upsert.

    Garmin sometimes returns whole-number fields as floats (e.g. 2543.0);
    Postgres integer columns reject the decimal point, so round those here.
    """
    row = {}
    for k, v in record.items():
        if k not in FIELD_MAP:
            continue
        col = FIELD_MAP[k]
        if isinstance(v, float) and col not in NON_INT_COLUMNS:
            v = round(v)
        row[col] = v
    row["date"] = day_iso
    row["updated_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return row


def load_store(client=None):
    """All rows from daily_metrics, keyed by ISO date, in the pre-migration
    store shape (patterns.py's field names) so callers don't have to change.
    """
    client = client or get_client()
    rows = client.table("daily_metrics").select("*").execute().data
    store = {}
    for row in rows:
        day_iso = row["date"]
        store[day_iso] = {
            FIELD_MAP_INV[k]: v for k, v in row.items() if k in FIELD_MAP_INV
        }
    return store


def newest_date(client=None):
    client = client or get_client()
    res = (
        client.table("daily_metrics")
        .select("date")
        .order("date", desc=True)
        .limit(1)
        .execute()
    )
    return date.fromisoformat(res.data[0]["date"]) if res.data else None


def days_to_fetch(newest, today, backfill_days=BACKFILL_DAYS):
    if newest:
        start = newest - timedelta(days=1)
    else:
        start = today - timedelta(days=backfill_days)
    return [start + timedelta(days=i) for i in range((today - start).days + 1)]


def main():
    parser = argparse.ArgumentParser(description="Fetch Garmin data into Supabase")
    parser.add_argument("--backfill-days", type=int, default=BACKFILL_DAYS,
                        help="how far back to go when the table is empty")
    args = parser.parse_args()

    today = datetime.date.today()
    client = get_client()
    days = days_to_fetch(newest_date(client), today, args.backfill_days)
    print(f"Fetching {len(days)} day(s): {days[0]} .. {days[-1]}")

    api = garmin.connect()
    for i, day in enumerate(days, 1):
        record = garmin.fetch_day(api, day)
        client.table("daily_metrics").upsert(to_row(day.isoformat(), record)).execute()
        if i % 10 == 0 or i == len(days):
            print(f"  {i}/{len(days)} days fetched")

    print(f"Done. Newest day fetched: {days[-1]}.")


if __name__ == "__main__":
    main()
