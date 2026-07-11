"""Slot timing: config writes and GitHub workflow cron rewriting."""
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "health-tips.yml"

SLOT_ORDER = ("morning", "midday", "evening")
SLOT_LABELS = {"morning": "morning briefing", "midday": "midday tip",
               "evening": "evening tip"}


def validate_slots(slots):
    errors = []
    enabled_hours = []
    for name in SLOT_ORDER:
        s = slots.get(name, {})
        hour = s.get("hour")
        if not isinstance(hour, int) or isinstance(hour, bool) or not 0 <= hour <= 23:
            errors.append(f"{name}: hour must be a whole number 0-23")
        elif s.get("enabled"):
            enabled_hours.append(hour)
    if not enabled_hours:
        errors.append("at least one slot must be enabled")
    if len(enabled_hours) != len(set(enabled_hours)):
        errors.append("enabled slots must have different hours")
    return errors


def utc_hour(local_hour, tz_name):
    offset = datetime.now(ZoneInfo(tz_name)).utcoffset()
    return int((local_hour - offset.total_seconds() / 3600) % 24)


def set_slots(slots, path=CONFIG_PATH):
    data = yaml.safe_load(Path(path).read_text())
    data["slots"] = {name: {"enabled": bool(slots[name]["enabled"]),
                            "hour": slots[name]["hour"]}
                     for name in SLOT_ORDER}
    Path(path).write_text(yaml.safe_dump(data, sort_keys=False))


def rewrite_workflow(slots, tz_name, path=WORKFLOW_PATH):
    lines = [f"  schedule:",
             f"    # Cron times are UTC, generated from config.yaml slots"
             f" ({tz_name})."]
    for name in SLOT_ORDER:
        s = slots[name]
        if not s.get("enabled"):
            continue
        lines.append(f'    - cron: "0 {utc_hour(s["hour"], tz_name)} * * *"'
                     f'   # {s["hour"]:02d}:00 local — {SLOT_LABELS[name]}')
    block = "\n".join(lines) + "\n"
    text = Path(path).read_text()
    new_text, n = re.subn(r"(?m)^  schedule:\n(?:^    .*\n)+", block, text, count=1)
    if n != 1:
        raise RuntimeError("could not find the schedule block in the workflow file")
    Path(path).write_text(new_text)
