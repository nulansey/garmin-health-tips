"""Orchestration and pure logic for the Garmin health tips service."""
import json
from datetime import date, timedelta
from pathlib import Path

import yaml

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
