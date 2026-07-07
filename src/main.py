"""Orchestration and pure logic for the Garmin health tips service."""
import argparse
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from src import analyze, garmin, notify

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
HISTORY_PATH = ROOT / "history" / "tips.json"


def load_config(path=CONFIG_PATH):
    with open(path) as f:
        return yaml.safe_load(f)


def calorie_target(yesterday_burn, goal_type, amount):
    """Today's intake target from yesterday's total burn and the configured goal.

    Rounded to the nearest 50 kcal; never recommends below a 1200 kcal floor.
    """
    if goal_type == "deficit":
        target = yesterday_burn - amount
    elif goal_type == "surplus":
        target = yesterday_burn + amount
    else:  # maintain
        target = yesterday_burn
    target = max(1200, target)
    return int(round(target / 50.0) * 50)


def determine_slot(local_hour):
    """Map the local hour to a notification slot."""
    if local_hour < 11:
        return "morning"
    if local_hour < 17:
        return "midday"
    return "evening"


def load_history(path=HISTORY_PATH):
    if not Path(path).exists():
        return []
    return json.loads(Path(path).read_text() or "[]")


def already_sent(history, day_iso, slot):
    return any(t["date"] == day_iso and t["slot"] == slot for t in history)


def append_tip(history, day_iso, slot, text, keep_days=14):
    history = history + [{"date": day_iso, "slot": slot, "text": text}]
    cutoff = (date.fromisoformat(day_iso) - timedelta(days=keep_days)).isoformat()
    return [t for t in history if t["date"] >= cutoff]


def save_history(history, path=HISTORY_PATH):
    Path(path).write_text(json.dumps(history, indent=2) + "\n")


TITLES = {
    "morning": "Morning briefing",
    "midday": "Midday check-in",
    "evening": "Evening wind-down",
}


def run(args):
    config = load_config()
    now = datetime.now(ZoneInfo(config["timezone"]))
    today = now.date().isoformat()
    slot = args.slot or determine_slot(now.hour)

    history = load_history()
    if not args.dry_run and already_sent(history, today, slot):
        print(f"{slot} tip already sent today; exiting.")
        return

    data = garmin.fetch_data(now.date())
    target, fallback = None, False
    if slot == "morning":
        burn, fallback = garmin.yesterday_burn(data)
        target = calorie_target(burn, config["goal"]["type"], config["goal"]["amount"])

    tip = analyze.generate_tip(
        data, history, slot, config,
        calorie_target_value=target, fallback_used=fallback,
    )

    if args.dry_run:
        print(f"[{slot}] {tip}")
        return

    notify.send(tip, title=TITLES[slot])
    save_history(append_tip(history, today, slot, tip,
                            config.get("history_days", 14)))
    print(f"Sent {slot} tip.")


def main():
    parser = argparse.ArgumentParser(description="Garmin health tips")
    parser.add_argument("--dry-run", action="store_true",
                        help="run the full pipeline but print instead of sending")
    parser.add_argument("--slot", choices=["morning", "midday", "evening"],
                        help="override slot detection")
    args = parser.parse_args()
    try:
        run(args)
    except Exception as exc:
        if not args.dry_run:
            try:
                notify.send_error(str(exc))
            except Exception:
                pass  # notification of the error failed too; the log still has it
        raise


if __name__ == "__main__":
    main()
