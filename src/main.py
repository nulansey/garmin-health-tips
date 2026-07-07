"""Orchestration and pure logic for the Garmin health tips service."""
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
