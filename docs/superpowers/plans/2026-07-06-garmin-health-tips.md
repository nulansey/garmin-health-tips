# Garmin Health Tips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Python service that pulls Garmin watch data, has Claude Haiku write personalized health tips, and pushes them to the user's iPhone via ntfy on a GitHub Actions schedule — including a morning calorie-intake briefing.

**Architecture:** One small Python package (`src/`) with four modules: `garmin.py` (data fetch via the unofficial `garminconnect` library with saved auth tokens), `analyze.py` (prompt building + Claude Haiku call), `notify.py` (ntfy push), `main.py` (orchestration, slot detection, duplicate protection, tip history). GitHub Actions runs it 3×/day and commits the tip history back to the repo.

**Tech Stack:** Python 3.12, `garminconnect` + `curl_cffi`, `anthropic` SDK (model `claude-haiku-4-5`), `requests` (ntfy), `PyYAML`, `pytest`, GitHub Actions.

## Global Constraints

- Python ≥ 3.11 (uses `zoneinfo` from stdlib).
- Claude model ID is exactly `claude-haiku-4-5` — no date suffix.
- Tips must be plain text, under 500 characters (phone notification).
- Secrets come ONLY from environment variables: `ANTHROPIC_API_KEY`, `NTFY_TOPIC`, `GARMINTOKENS` (token dir path, defaults to `~/.garminconnect`). Never write secrets to files in the repo.
- All Garmin API responses are accessed with `.get(...)` — missing fields must yield `None`, never a crash.
- User's timezone lives in `config.yaml` (`timezone:` IANA name); default in this plan is `Pacific/Honolulu` — confirm with the user and keep the workflow cron lines (UTC) in sync with it.
- All commands below run from the repo root `/Users/unoa/garmin-health-tips` and use the project venv at `.venv/` (`.venv/bin/pytest`, `.venv/bin/pip`).

---

### Task 1: Scaffold + calorie-target math

**Files:**
- Create: `requirements.txt`, `config.yaml`, `.gitignore`, `src/__init__.py`, `src/main.py`, `tests/__init__.py`, `tests/test_calories.py`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `calorie_target(yesterday_burn: int, goal_type: str, amount: int) -> int` and `load_config(path=CONFIG_PATH) -> dict` in `src/main.py`; `config.yaml` with keys `timezone` (str), `goal.type` (`"deficit"|"maintain"|"surplus"`), `goal.amount` (int), `tone` (str), `history_days` (int)

- [ ] **Step 1: Create scaffold files**

`requirements.txt`:

```
garminconnect>=0.3.6
curl_cffi
anthropic
requests
PyYAML
pytest
```

`config.yaml`:

```yaml
# User-editable settings. No secrets in this file.
timezone: Pacific/Honolulu   # IANA timezone; if you change it, also update the
                             # cron times in .github/workflows/health-tips.yml
goal:
  type: deficit              # deficit | maintain | surplus
  amount: 500                # calories below/above yesterday's burn (ignored for maintain)
tone: friendly and encouraging, like a knowledgeable coach who keeps it brief
history_days: 14             # how many days of past tips to remember
```

`.gitignore`:

```
.venv/
__pycache__/
*.pyc
.pytest_cache/
```

`src/__init__.py` and `tests/__init__.py`: empty files.

- [ ] **Step 2: Create the venv and install dependencies**

Run: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
Expected: installs succeed (garminconnect, anthropic, etc.)

- [ ] **Step 3: Write the failing tests**

`tests/test_calories.py`:

```python
from src.main import calorie_target


def test_deficit_subtracts_amount():
    assert calorie_target(2650, "deficit", 500) == 2150


def test_maintain_ignores_amount():
    assert calorie_target(2650, "maintain", 500) == 2650


def test_surplus_adds_amount():
    assert calorie_target(2650, "surplus", 300) == 2950


def test_rounds_to_nearest_50():
    assert calorie_target(2649, "maintain", 0) == 2650


def test_never_recommends_below_1200():
    assert calorie_target(1500, "deficit", 800) == 1200
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_calories.py -v`
Expected: FAIL — `ImportError` / `AttributeError` (no `calorie_target` yet)

- [ ] **Step 5: Write the implementation**

`src/main.py`:

```python
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_calories.py -v`
Expected: 5 passed

- [ ] **Step 7: Commit**

```bash
git add requirements.txt config.yaml .gitignore src/ tests/
git commit -m "feat: scaffold project and add calorie-target math"
```

---

### Task 2: Slot detection + tip history with duplicate protection

**Files:**
- Modify: `src/main.py`
- Create: `history/tips.json`, `tests/test_slots_history.py`

**Interfaces:**
- Consumes: `HISTORY_PATH` from Task 1
- Produces in `src/main.py`: `determine_slot(local_hour: int) -> str` (returns `"morning"|"midday"|"evening"`); `load_history(path=HISTORY_PATH) -> list[dict]`; `already_sent(history: list, day_iso: str, slot: str) -> bool`; `append_tip(history: list, day_iso: str, slot: str, text: str, keep_days: int = 14) -> list`; `save_history(history: list, path=HISTORY_PATH) -> None`. History entries are `{"date": "YYYY-MM-DD", "slot": str, "text": str}`.

- [ ] **Step 1: Create the empty history file**

`history/tips.json`:

```json
[]
```

- [ ] **Step 2: Write the failing tests**

`tests/test_slots_history.py`:

```python
from src.main import already_sent, append_tip, determine_slot


def test_early_hours_are_morning():
    assert determine_slot(7) == "morning"
    assert determine_slot(10) == "morning"


def test_afternoon_is_midday():
    assert determine_slot(11) == "midday"
    assert determine_slot(16) == "midday"


def test_late_hours_are_evening():
    assert determine_slot(17) == "evening"
    assert determine_slot(22) == "evening"


def test_already_sent_matches_date_and_slot():
    history = [{"date": "2026-07-06", "slot": "morning", "text": "hi"}]
    assert already_sent(history, "2026-07-06", "morning")
    assert not already_sent(history, "2026-07-06", "midday")
    assert not already_sent(history, "2026-07-05", "morning")


def test_append_tip_adds_entry():
    out = append_tip([], "2026-07-06", "morning", "eat well", keep_days=14)
    assert out == [{"date": "2026-07-06", "slot": "morning", "text": "eat well"}]


def test_append_tip_prunes_entries_older_than_keep_days():
    history = [{"date": "2026-06-01", "slot": "morning", "text": "old"}]
    out = append_tip(history, "2026-07-06", "morning", "new", keep_days=14)
    assert [t["text"] for t in out] == ["new"]
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_slots_history.py -v`
Expected: FAIL — names not defined

- [ ] **Step 4: Write the implementation**

Add to `src/main.py` (below `calorie_target`; add `import json` and `from datetime import date, timedelta` to the imports at the top):

```python
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
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `.venv/bin/pytest -v`
Expected: 11 passed

- [ ] **Step 6: Commit**

```bash
git add src/main.py history/tips.json tests/test_slots_history.py
git commit -m "feat: add slot detection and tip history with duplicate protection"
```

---

### Task 3: ntfy notifications

**Files:**
- Create: `src/notify.py`, `tests/test_notify.py`

**Interfaces:**
- Consumes: `NTFY_TOPIC` env var
- Produces in `src/notify.py`: `send(message: str, title: str = "Health tip", tags: str = "green_heart", priority: str = "default") -> None` (raises on HTTP failure or missing `NTFY_TOPIC`); `send_error(detail: str) -> None` (high-priority warning notification)

- [ ] **Step 1: Write the failing test**

`tests/test_notify.py`:

```python
import pytest

import src.notify as notify


class FakeResponse:
    def raise_for_status(self):
        pass


def test_send_posts_message_to_topic(monkeypatch):
    calls = {}

    def fake_post(url, data=None, headers=None, timeout=None):
        calls.update(url=url, data=data, headers=headers)
        return FakeResponse()

    monkeypatch.setenv("NTFY_TOPIC", "my-secret-topic")
    monkeypatch.setattr(notify.requests, "post", fake_post)

    notify.send("hello", title="Test title")

    assert calls["url"] == "https://ntfy.sh/my-secret-topic"
    assert calls["data"] == b"hello"
    assert calls["headers"]["Title"] == "Test title"


def test_send_requires_topic(monkeypatch):
    monkeypatch.delenv("NTFY_TOPIC", raising=False)
    with pytest.raises(RuntimeError):
        notify.send("hello")


def test_send_error_uses_warning_style(monkeypatch):
    calls = {}

    def fake_post(url, data=None, headers=None, timeout=None):
        calls.update(url=url, data=data, headers=headers)
        return FakeResponse()

    monkeypatch.setenv("NTFY_TOPIC", "my-secret-topic")
    monkeypatch.setattr(notify.requests, "post", fake_post)

    notify.send_error("couldn't reach Garmin")

    assert b"couldn't reach Garmin" in calls["data"]
    assert calls["headers"]["Priority"] == "high"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_notify.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.notify'`

- [ ] **Step 3: Write the implementation**

`src/notify.py`:

```python
"""Push notifications to the user's phone via ntfy.sh."""
import os

import requests

NTFY_URL = "https://ntfy.sh"


def _topic():
    topic = os.environ.get("NTFY_TOPIC")
    if not topic:
        raise RuntimeError("NTFY_TOPIC environment variable is not set")
    return topic


def send(message, title="Health tip", tags="green_heart", priority="default"):
    response = requests.post(
        f"{NTFY_URL}/{_topic()}",
        data=message.encode("utf-8"),
        headers={"Title": title, "Tags": tags, "Priority": priority},
        timeout=30,
    )
    response.raise_for_status()


def send_error(detail):
    send(
        f"Health tips: {detail}"[:400],
        title="Health tips problem",
        tags="warning",
        priority="high",
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_notify.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/notify.py tests/test_notify.py
git commit -m "feat: add ntfy push notifications"
```

---

### Task 4: Garmin data fetch + one-time auth setup

**Files:**
- Create: `src/garmin.py`, `src/setup_auth.py`, `tests/test_garmin.py`

**Interfaces:**
- Consumes: `GARMINTOKENS` env var (token dir, default `~/.garminconnect`)
- Produces in `src/garmin.py`: `fetch_data(today: datetime.date) -> dict` with keys `today` (ISO str), `daily_summaries` (dict of ISO date → curated summary dict, 7 days, newest first insertion order), `last_night_sleep` (dict), `hrv_summary` (dict), `recent_activities` (list of dicts); `yesterday_burn(data: dict) -> tuple[int, bool]` (kcal, used_7day_fallback). `src/setup_auth.py` is a `python -m src.setup_auth` script.

Note: `fetch_data` hits the real Garmin API and is not unit-tested — it is exercised by the `--dry-run` in Task 6. `yesterday_burn` is pure and tested here.

- [ ] **Step 1: Write the failing tests**

`tests/test_garmin.py`:

```python
import pytest

from src.garmin import yesterday_burn


def make(summaries):
    return {"daily_summaries": summaries}


def test_uses_yesterdays_total_burn():
    data = make({
        "2026-07-06": {"totalKilocalories": 2100},
        "2026-07-05": {"totalKilocalories": 2600},
    })
    assert yesterday_burn(data) == (2600, False)


def test_falls_back_to_average_when_yesterday_missing():
    data = make({
        "2026-07-06": {"totalKilocalories": 2100},
        "2026-07-05": {"totalKilocalories": None},
        "2026-07-04": {"totalKilocalories": 2500},
    })
    # average of the days that DO have data: (2100 + 2500) / 2
    assert yesterday_burn(data) == (2300, True)


def test_raises_when_no_data_at_all():
    data = make({"2026-07-06": {}, "2026-07-05": {}})
    with pytest.raises(RuntimeError):
        yesterday_burn(data)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_garmin.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.garmin'`

- [ ] **Step 3: Write the implementation**

`src/garmin.py`:

```python
"""Fetch and curate the user's Garmin Connect data."""
import datetime
import os

from garminconnect import Garmin

TOKENSTORE = os.environ.get("GARMINTOKENS", "~/.garminconnect")

SUMMARY_FIELDS = (
    "totalKilocalories",
    "activeKilocalories",
    "bmrKilocalories",
    "totalSteps",
    "totalDistanceMeters",
    "restingHeartRate",
    "averageStressLevel",
    "moderateIntensityMinutes",
    "vigorousIntensityMinutes",
    "bodyBatteryHighestValue",
    "bodyBatteryLowestValue",
    "sleepingSeconds",
)


def connect():
    """Log in with the saved token store (created once by setup_auth)."""
    api = Garmin()
    api.login(TOKENSTORE)
    return api


def fetch_data(today):
    """Pull the last 7 days of metrics, curated down to the fields the tip needs.

    Curating (rather than dumping raw responses) keeps the Claude prompt small —
    raw stress/body-battery series are thousands of data points.
    """
    api = connect()
    days = [(today - datetime.timedelta(days=i)).isoformat() for i in range(7)]

    summaries = {}
    for d in days:
        s = api.get_user_summary(d) or {}
        summaries[d] = {k: s.get(k) for k in SUMMARY_FIELDS}

    sleep_raw = api.get_sleep_data(days[0]) or {}
    dto = sleep_raw.get("dailySleepDTO") or {}
    sleep = {
        "sleepTimeSeconds": dto.get("sleepTimeSeconds"),
        "deepSleepSeconds": dto.get("deepSleepSeconds"),
        "remSleepSeconds": dto.get("remSleepSeconds"),
        "awakeSleepSeconds": dto.get("awakeSleepSeconds"),
        "sleepScore": ((dto.get("sleepScores") or {}).get("overall") or {}).get("value"),
    }

    hrv_raw = api.get_hrv_data(days[0]) or {}
    hrv = hrv_raw.get("hrvSummary") or {}

    activities = [
        {
            "name": a.get("activityName"),
            "type": (a.get("activityType") or {}).get("typeKey"),
            "start": a.get("startTimeLocal"),
            "durationSeconds": a.get("duration"),
            "calories": a.get("calories"),
        }
        for a in (api.get_activities_by_date(days[-1], days[0]) or [])
    ]

    return {
        "today": days[0],
        "daily_summaries": summaries,
        "last_night_sleep": sleep,
        "hrv_summary": hrv,
        "recent_activities": activities,
    }


def yesterday_burn(data):
    """Yesterday's total kcal burned, or the 7-day average if yesterday is missing.

    Returns (kcal, used_fallback).
    """
    days = sorted(data["daily_summaries"], reverse=True)
    yesterday = data["daily_summaries"].get(days[1], {}) if len(days) > 1 else {}
    burn = yesterday.get("totalKilocalories")
    if burn:
        return int(burn), False
    values = [
        s.get("totalKilocalories")
        for s in data["daily_summaries"].values()
        if s and s.get("totalKilocalories")
    ]
    if not values:
        raise RuntimeError("no calorie data in the last 7 days (was the watch worn?)")
    return int(sum(values) / len(values)), True
```

`src/setup_auth.py`:

```python
"""One-time interactive Garmin Connect login.

Run locally:  .venv/bin/python -m src.setup_auth

Saves reusable auth tokens to ~/.garminconnect (or $GARMINTOKENS) and prints a
base64 blob to paste into the GitHub Actions secret GARMIN_TOKENS_B64.
Tokens last roughly a year; re-run this when they expire.
"""
import base64
import io
import os
import tarfile
from getpass import getpass
from pathlib import Path

from garminconnect import Garmin


def main():
    tokenstore = os.environ.get("GARMINTOKENS", "~/.garminconnect")
    email = input("Garmin Connect email: ").strip()
    password = getpass("Garmin Connect password (not stored anywhere): ")
    api = Garmin(
        email=email,
        password=password,
        prompt_mfa=lambda: input("MFA code (if prompted by Garmin): ").strip(),
    )
    api.login(tokenstore)
    print(f"\nLogin OK. Tokens saved to {tokenstore}")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(Path(tokenstore).expanduser(), arcname=".garminconnect")
    blob = base64.b64encode(buf.getvalue()).decode()
    print("\nPaste this whole line as the GitHub secret GARMIN_TOKENS_B64:\n")
    print(blob)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_garmin.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add src/garmin.py src/setup_auth.py tests/test_garmin.py
git commit -m "feat: add Garmin data fetch and one-time auth setup"
```

---

### Task 5: Claude tip generation

**Files:**
- Create: `src/analyze.py`, `tests/test_analyze.py`

**Interfaces:**
- Consumes: `ANTHROPIC_API_KEY` env var; history entry shape from Task 2; data dict shape from Task 4; config keys `tone`
- Produces in `src/analyze.py`: `build_prompt(data: dict, history: list, slot: str, config: dict, calorie_target_value: int | None = None, fallback_used: bool = False) -> str` (pure); `generate_tip(...same args...) -> str` (calls Claude, raises `RuntimeError` on empty output)

- [ ] **Step 1: Write the failing tests**

`tests/test_analyze.py`:

```python
from src.analyze import build_prompt

CONFIG = {"tone": "friendly"}


def test_morning_prompt_leads_with_calorie_target():
    p = build_prompt({"today": "2026-07-06"}, [], "morning", CONFIG,
                     calorie_target_value=2150)
    assert "~2,150 calories" in p
    assert "MORNING BRIEFING" in p


def test_morning_prompt_mentions_fallback_when_data_was_missing():
    p = build_prompt({}, [], "morning", CONFIG,
                     calorie_target_value=2150, fallback_used=True)
    assert "7-day average" in p


def test_prompt_includes_recent_tips_and_tone():
    history = [{"date": "2026-07-05", "slot": "evening", "text": "wind down early"}]
    p = build_prompt({}, history, "midday", CONFIG)
    assert "wind down early" in p
    assert "friendly" in p


def test_prompt_includes_garmin_data():
    p = build_prompt({"last_night_sleep": {"sleepScore": 82}}, [], "evening", CONFIG)
    assert "sleepScore" in p
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_analyze.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.analyze'`

- [ ] **Step 3: Write the implementation**

`src/analyze.py`:

```python
"""Build the prompt and ask Claude Haiku for one health tip."""
import json

import anthropic

MODEL = "claude-haiku-4-5"

SLOT_GUIDANCE = {
    "morning": (
        "This is the MORNING BRIEFING. Lead with the calorie target line exactly "
        "as provided, then 2-3 short sentences on recovery (sleep, HRV, Body "
        "Battery) and how to approach the day."
    ),
    "midday": (
        "This is a MIDDAY tip. Look at today's activity, steps, and stress so far "
        "and give ONE actionable suggestion for the afternoon."
    ),
    "evening": (
        "This is an EVENING tip. Focus on winding down: today's totals, stress, "
        "and one concrete bedtime or recovery suggestion."
    ),
}


def build_prompt(data, history, slot, config, calorie_target_value=None,
                 fallback_used=False):
    recent = [f"[{t['date']} {t['slot']}] {t['text']}" for t in history[-10:]]
    parts = [
        "You write short health tips for one person based on their Garmin watch "
        f"data. Tone: {config['tone']}.",
        SLOT_GUIDANCE[slot],
        "Keep it under 500 characters total - it is sent as a phone notification. "
        "Plain text only: no markdown, no preamble, no sign-off.",
        "Do not repeat recent tips; build on what was said earlier today when "
        "relevant.",
    ]
    if calorie_target_value is not None:
        line = f'Start with exactly: "Aim for ~{calorie_target_value:,} calories today."'
        if fallback_used:
            line += (
                " Then note the target is based on their 7-day average burn "
                "because yesterday's data was incomplete."
            )
        parts.append(line)
    parts.append(
        "Recent tips already sent:\n" + ("\n".join(recent) if recent else "(none)")
    )
    parts.append("Garmin data (JSON):\n" + json.dumps(data, default=str))
    return "\n\n".join(parts)


def generate_tip(data, history, slot, config, calorie_target_value=None,
                 fallback_used=False):
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment
    prompt = build_prompt(data, history, slot, config, calorie_target_value,
                          fallback_used)
    response = client.messages.create(
        model=MODEL,
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}],
    )
    text = next((b.text for b in response.content if b.type == "text"), "").strip()
    if not text:
        raise RuntimeError("Claude returned an empty tip")
    return text
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_analyze.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add src/analyze.py tests/test_analyze.py
git commit -m "feat: add Claude Haiku tip generation"
```

---

### Task 6: Orchestration + dry-run mode

**Files:**
- Modify: `src/main.py` (add imports, `run()`, `main()`, `__main__` guard)

**Interfaces:**
- Consumes: everything from Tasks 1–5
- Produces: `python -m src.main` entry point with `--dry-run` (full pipeline, prints instead of sending, skips duplicate check and history write) and `--slot morning|midday|evening` (override slot detection)

- [ ] **Step 1: Write the orchestration code**

Add to `src/main.py`. Extend the top-of-file imports to:

```python
"""Orchestration and pure logic for the Garmin health tips service."""
import argparse
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from src import analyze, garmin, notify
```

Append at the bottom of the file:

```python
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
```

- [ ] **Step 2: Run the whole test suite**

Run: `.venv/bin/pytest -v`
Expected: all 21 tests pass (the new imports must not break the pure-function tests)

- [ ] **Step 3: Commit**

```bash
git add src/main.py
git commit -m "feat: wire up orchestration with dry-run mode and error notifications"
```

- [ ] **Step 4: USER CHECKPOINT — end-to-end dry run (requires the user)**

This step needs the user's credentials and cannot be done autonomously. Ask the user to:

1. Run `.venv/bin/python -m src.setup_auth` in a terminal (their Garmin email/password + possible MFA code). Confirm it prints "Login OK".
2. Provide/export `ANTHROPIC_API_KEY` (from console.anthropic.com).

Then run: `ANTHROPIC_API_KEY=... .venv/bin/python -m src.main --dry-run --slot morning`
Expected: prints a `[morning]` tip starting with "Aim for ~N calories today." using their real Garmin data. Also spot-check `--slot evening`.

If Garmin field names differ from the curated `SUMMARY_FIELDS` (values come back `None`), print one raw `api.get_user_summary(...)` response, adjust the field list, and re-run — this is the expected place to discover real-API drift.

---

### Task 7: GitHub Actions schedule + setup README

**Files:**
- Create: `.github/workflows/health-tips.yml`, `README.md`

**Interfaces:**
- Consumes: `python -m src.main` from Task 6; GitHub secrets `GARMIN_TOKENS_B64` (from Task 4's setup_auth), `ANTHROPIC_API_KEY`, `NTFY_TOPIC`
- Produces: scheduled runs at ~7am/1pm/8pm user-local time; `history/tips.json` committed back after each send

- [ ] **Step 1: Write the workflow**

`.github/workflows/health-tips.yml`:

```yaml
name: Health tips

on:
  schedule:
    # Cron times are UTC. These are 7:00, 13:00, 20:00 in Pacific/Honolulu
    # (UTC-10, no DST). If config.yaml's timezone changes, update these.
    - cron: "0 17 * * *"   # 07:00 HST — morning briefing
    - cron: "0 23 * * *"   # 13:00 HST — midday tip
    - cron: "0 6 * * *"    # 20:00 HST — evening tip
  workflow_dispatch:        # allows manual test runs from the Actions tab

permissions:
  contents: write           # to commit history/tips.json back

concurrency:
  group: health-tips
  cancel-in-progress: false

jobs:
  send-tip:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip

      - run: pip install -r requirements.txt

      - name: Restore Garmin auth tokens
        env:
          GARMIN_TOKENS_B64: ${{ secrets.GARMIN_TOKENS_B64 }}
        run: echo "$GARMIN_TOKENS_B64" | base64 -d | tar -xzf - -C ~

      - name: Send tip
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          NTFY_TOPIC: ${{ secrets.NTFY_TOPIC }}
        run: python -m src.main

      - name: Save tip history
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add history/tips.json
          git diff --cached --quiet && exit 0
          git commit -m "Record sent tip"
          git pull --rebase
          git push
```

- [ ] **Step 2: Write the README**

`README.md`:

```markdown
# Garmin Health Tips

Pulls my Garmin watch data three times a day, has Claude write a short
personalized health tip, and pushes it to my iPhone via [ntfy](https://ntfy.sh).
The 7am briefing includes a calorie-intake target based on yesterday's burn.

## One-time setup (~15 minutes)

1. **ntfy** — install the free ntfy app on your iPhone. Subscribe to a
   hard-to-guess topic name (e.g. `garmin-tips-x7f93k2`). Treat the name like a
   password — anyone who knows it can send you notifications.
2. **Claude API key** — create one at https://console.anthropic.com (requires a
   payment card; expected usage is under $1/month).
3. **Garmin auth** — run `.venv/bin/python -m src.setup_auth` locally. It logs
   in once (handles MFA) and prints a base64 blob.
4. **GitHub** — push this repo to a **private** GitHub repository, then add
   three Actions secrets (Settings → Secrets and variables → Actions):
   - `GARMIN_TOKENS_B64` — the blob from step 3
   - `ANTHROPIC_API_KEY` — from step 2
   - `NTFY_TOPIC` — your topic name from step 1
5. Trigger the **Health tips** workflow manually from the Actions tab to test.

## Configuration

Edit `config.yaml`: timezone, calorie goal (`deficit`/`maintain`/`surplus` and
amount), tip tone, and how many days of tip history to keep. If you change the
timezone, update the cron lines in `.github/workflows/health-tips.yml` (UTC).

## Local testing

    .venv/bin/pytest                                   # unit tests
    .venv/bin/python -m src.main --dry-run --slot morning   # full pipeline, prints instead of sending

## When something breaks

You get a single "Health tips problem" notification and the run shows red in
the Actions tab with a full log. Most common cause: expired Garmin tokens
(~yearly) — re-run `python -m src.setup_auth` and update `GARMIN_TOKENS_B64`.
```

- [ ] **Step 3: Validate the workflow YAML parses**

Run: `.venv/bin/python -c "import yaml; yaml.safe_load(open('.github/workflows/health-tips.yml')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/health-tips.yml README.md
git commit -m "feat: add GitHub Actions schedule and setup README"
```

- [ ] **Step 5: USER CHECKPOINT — go live (requires the user)**

Ask the user to complete the README's one-time setup: create the private GitHub repo, push, add the three secrets, install ntfy, and trigger one manual `workflow_dispatch` run. Verify a real notification arrives on their phone. Only after that is the project done.
