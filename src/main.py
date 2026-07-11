"""Orchestration and pure logic for the Garmin health tips service."""
import argparse
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from src import analyze, fetch, notify, patterns

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
HISTORY_PATH = ROOT / "history" / "tips.json"

DEFAULT_SLOTS = {
    "morning": {"enabled": True, "hour": 7},
    "midday": {"enabled": True, "hour": 13},
    "evening": {"enabled": True, "hour": 20},
}


def get_slots(config):
    """Slots from config merged over defaults; absent section = defaults."""
    slots = {k: dict(v) for k, v in DEFAULT_SLOTS.items()}
    for name, override in (config.get("slots") or {}).items():
        if name in slots:
            slots[name].update(override)
    return slots


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


def determine_slot(local_hour, slots=None):
    """The enabled slot whose configured hour is nearest to the local hour.

    Ties break toward the earlier slot; None when no slot is enabled.
    """
    slots = slots if slots is not None else DEFAULT_SLOTS
    best = None
    for name in ("morning", "midday", "evening"):
        s = slots.get(name, {})
        if not s.get("enabled"):
            continue
        dist = abs(local_hour - s["hour"])
        if best is None or dist < best[0]:
            best = (dist, name)
    return best[1] if best else None


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
    today = now.date()
    today_iso = today.isoformat()
    slots = get_slots(config)
    slot = args.slot or determine_slot(now.hour, slots)
    if slot is None or not slots.get(slot, {}).get("enabled", True):
        print(f"slot {slot!r} is disabled; exiting.")
        return

    history = load_history()
    if not args.dry_run and already_sent(history, today_iso, slot):
        print(f"{slot} tip already sent today; exiting.")
        return

    store = fetch.load_store()
    age = patterns.data_age_days(store, today)
    if age is None or age > config.get("stale_after_days", 10):
        nudge = (
            "No Garmin data in the store yet - ask Claude to run /fetch-garmin."
            if age is None
            else f"Newest Garmin data is {age} days old - ask Claude to run "
                 "/fetch-garmin so tips stay accurate."
        )
        if args.dry_run:
            print(f"[{slot}] STALE DATA: {nudge}")
        elif slot == "morning":  # nudge once a day, not three times
            notify.send(nudge, title="Time for a Garmin fetch", tags="hourglass")
            save_history(append_tip(history, today_iso, slot, "[stale-data nudge]",
                                    config.get("history_days", 14)))
        else:
            print("data stale; skipping non-morning slot")
        return

    half_life = config.get("half_life_days", 45)
    context = patterns.pattern_summary(store, today, half_life)
    target = None
    if slot == "morning":
        burn = patterns.target_burn(store, today, half_life)
        target = calorie_target(burn, config["goal"]["type"], config["goal"]["amount"])

    tip = analyze.generate_tip(context, history, slot, config,
                               calorie_target_value=target)

    if args.dry_run:
        print(f"[{slot}] {tip}")
        return

    notify.send(tip, title=TITLES[slot])
    save_history(append_tip(history, today_iso, slot, tip,
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
