from datetime import date

from web.dashboard import build_dashboard

CONFIG = {
    "timezone": "Pacific/Honolulu",
    "goal": {"type": "deficit", "amount": 500},
    "half_life_days": 45,
    "stale_after_days": 10,
}

STORE = {
    "2026-07-06": {"totalKilocalories": 2400, "totalSteps": 9000,
                   "sleepScore": 80, "sleepTimeSeconds": 27000,
                   "averageStressLevel": 30, "restingHeartRate": 55},
    "2026-07-07": {"totalKilocalories": 2600, "totalSteps": 11000,
                   "sleepScore": 75, "sleepTimeSeconds": 25200,
                   "averageStressLevel": 35, "restingHeartRate": 56},
}

TIPS = [
    {"date": "2026-07-07", "slot": "morning", "text": "tip one"},
    {"date": "2026-07-07", "slot": "midday", "text": "tip two"},
]


def test_build_dashboard_fresh_store():
    d = build_dashboard(STORE, CONFIG, TIPS, date(2026, 7, 8))
    assert d["age_days"] == 1
    assert d["stale"] is False
    assert d["goal"] == {"type": "deficit", "amount": 500}
    assert d["calorie_target"] is not None
    assert d["recent_days"][0]["date"] == "2026-07-07"  # newest first
    assert d["recent_days"][0]["sleep_h"] == 7.0        # 25200 s
    assert d["recent_tips"][0]["text"] == "tip two"     # newest first


def test_build_dashboard_empty_store():
    d = build_dashboard({}, CONFIG, [], date(2026, 7, 8))
    assert d["age_days"] is None
    assert d["stale"] is True
    assert d["calorie_target"] is None
    assert d["recent_days"] == []


def test_build_dashboard_stale_store():
    d = build_dashboard(STORE, CONFIG, TIPS, date(2026, 7, 30))
    assert d["stale"] is True
