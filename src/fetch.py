"""Pull Garmin data into the local store (data/daily.json).

Run manually (weekly or so):  .venv/bin/python -m src.fetch
Backfills 90 days on the first run; afterwards fetches from one day before the
newest stored day (that day may have been partial when last fetched) through
today. Commit and push data/daily.json afterwards so the scheduled runs see it.
"""
import argparse
import datetime
import json
from datetime import date, timedelta
from pathlib import Path

from src import garmin

STORE_PATH = Path(__file__).resolve().parent.parent / "data" / "daily.json"
BACKFILL_DAYS = 90


def load_store(path=STORE_PATH):
    p = Path(path)
    if not p.exists():
        return {}
    return json.loads(p.read_text() or "{}")


def save_store(store, path=STORE_PATH):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(dict(sorted(store.items())), indent=2) + "\n")


def days_to_fetch(store, today, backfill_days=BACKFILL_DAYS):
    if store:
        start = date.fromisoformat(max(store)) - timedelta(days=1)
    else:
        start = today - timedelta(days=backfill_days)
    return [start + timedelta(days=i) for i in range((today - start).days + 1)]


def main():
    parser = argparse.ArgumentParser(description="Fetch Garmin data into data/daily.json")
    parser.add_argument("--backfill-days", type=int, default=BACKFILL_DAYS,
                        help="how far back to go when the store is empty")
    args = parser.parse_args()

    today = datetime.date.today()
    store = load_store()
    days = days_to_fetch(store, today, args.backfill_days)
    print(f"Fetching {len(days)} day(s): {days[0]} .. {days[-1]}")

    api = garmin.connect()
    for i, day in enumerate(days, 1):
        store[day.isoformat()] = garmin.fetch_day(api, day)
        if i % 10 == 0 or i == len(days):
            save_store(store)  # checkpoint so an interrupted run keeps progress
            print(f"  {i}/{len(days)} days fetched")

    save_store(store)
    print(f"Store now has {len(store)} days (newest: {max(store)}).")
    print("Next: commit and push data/daily.json so the scheduled runs use it.")


if __name__ == "__main__":
    main()
