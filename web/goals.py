"""Read, validate, and write user-editable goals in config.yaml."""
from pathlib import Path

import yaml

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.yaml"

GOAL_TYPES = ("deficit", "maintain", "surplus")
MAX_AMOUNT = 2000
SLEEP_RANGE = (4.0, 12.0)
STEPS_RANGE = (1000, 50000)


def validate_goal(goal_type, amount):
    errors = []
    if goal_type not in GOAL_TYPES:
        errors.append(f"goal type must be one of {', '.join(GOAL_TYPES)}")
    if not isinstance(amount, int) or isinstance(amount, bool):
        errors.append("amount must be a whole number")
    elif not 0 <= amount <= MAX_AMOUNT:
        errors.append(f"amount must be between 0 and {MAX_AMOUNT}")
    return errors


def validate_targets(sleep_hours, steps):
    errors = []
    if sleep_hours is not None and not SLEEP_RANGE[0] <= sleep_hours <= SLEEP_RANGE[1]:
        errors.append(f"sleep target must be {SLEEP_RANGE[0]}-{SLEEP_RANGE[1]} hours")
    if steps is not None and not STEPS_RANGE[0] <= steps <= STEPS_RANGE[1]:
        errors.append(f"step target must be {STEPS_RANGE[0]}-{STEPS_RANGE[1]}")
    return errors


def _update_config(mutate, path):
    data = yaml.safe_load(Path(path).read_text())
    mutate(data)
    Path(path).write_text(yaml.safe_dump(data, sort_keys=False))


def set_goal(goal_type, amount, path=CONFIG_PATH):
    def mutate(data):
        data["goal"] = {"type": goal_type, "amount": amount}
    _update_config(mutate, path)


def set_targets(sleep_hours, steps, path=CONFIG_PATH):
    def mutate(data):
        targets = {}
        if sleep_hours is not None:
            targets["sleep_hours"] = sleep_hours
        if steps is not None:
            targets["steps"] = steps
        if targets:
            data["targets"] = targets
        else:
            data.pop("targets", None)
    _update_config(mutate, path)
