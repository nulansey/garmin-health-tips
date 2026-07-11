import yaml

from src.main import DEFAULT_SLOTS, get_slots
from web import schedule

WORKFLOW = """name: Health tips

on:
  schedule:
    # old comment
    - cron: "0 17 * * *"   # 07:00 HST — morning briefing
    - cron: "0 23 * * *"   # 13:00 HST — midday tip
  workflow_dispatch:

jobs:
  send-tip:
    runs-on: ubuntu-latest
"""


def test_get_slots_defaults_and_merge():
    assert get_slots({}) == DEFAULT_SLOTS
    merged = get_slots({"slots": {"morning": {"hour": 8}}})
    assert merged["morning"] == {"enabled": True, "hour": 8}
    assert merged["evening"] == {"enabled": True, "hour": 20}


def test_validate_slots():
    ok = {"morning": {"enabled": True, "hour": 7},
          "midday": {"enabled": False, "hour": 13},
          "evening": {"enabled": True, "hour": 20}}
    assert schedule.validate_slots(ok) == []
    none_on = {k: {**v, "enabled": False} for k, v in ok.items()}
    assert schedule.validate_slots(none_on)          # all disabled
    dupe = {"morning": {"enabled": True, "hour": 7},
            "midday": {"enabled": True, "hour": 7},
            "evening": {"enabled": False, "hour": 20}}
    assert schedule.validate_slots(dupe)             # duplicate enabled hours
    bad_hour = {"morning": {"enabled": True, "hour": 24},
                "midday": {"enabled": False, "hour": 13},
                "evening": {"enabled": False, "hour": 20}}
    assert schedule.validate_slots(bad_hour)


def test_utc_hour_honolulu():
    assert schedule.utc_hour(7, "Pacific/Honolulu") == 17   # UTC-10
    assert schedule.utc_hour(20, "Pacific/Honolulu") == 6   # wraps midnight


def test_rewrite_workflow(tmp_path):
    p = tmp_path / "wf.yml"
    p.write_text(WORKFLOW)
    slots = {"morning": {"enabled": True, "hour": 8},
             "midday": {"enabled": False, "hour": 13},
             "evening": {"enabled": True, "hour": 21}}
    schedule.rewrite_workflow(slots, "Pacific/Honolulu", path=p)
    text = p.read_text()
    assert '"0 18 * * *"' in text     # 08:00 HST
    assert '"0 7 * * *"' in text      # 21:00 HST
    assert "midday" not in text       # disabled slot removed
    assert "workflow_dispatch" in text  # rest of file intact
    assert yaml.safe_load(text)       # still valid YAML


def test_set_slots_roundtrip(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text("timezone: Pacific/Honolulu\ngoal:\n  type: deficit\n  amount: 500\n")
    slots = {"morning": {"enabled": True, "hour": 8},
             "midday": {"enabled": False, "hour": 13},
             "evening": {"enabled": True, "hour": 20}}
    schedule.set_slots(slots, path=p)
    data = yaml.safe_load(p.read_text())
    assert data["slots"]["morning"]["hour"] == 8
    assert data["slots"]["midday"]["enabled"] is False
    assert data["goal"]["amount"] == 500
