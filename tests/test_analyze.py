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
