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


def test_determine_slot_defaults_backcompat():
    # nearest-hour logic must agree with the old fixed windows for defaults
    assert determine_slot(8) == "morning"
    assert determine_slot(12) == "midday"
    assert determine_slot(19) == "evening"


def test_determine_slot_custom_hours():
    slots = {"morning": {"enabled": True, "hour": 9},
             "midday": {"enabled": False, "hour": 13},
             "evening": {"enabled": True, "hour": 21}}
    assert determine_slot(9, slots) == "morning"
    assert determine_slot(14, slots) == "morning"   # midday disabled; 9 is nearer than 21
    assert determine_slot(20, slots) == "evening"


def test_determine_slot_none_enabled():
    slots = {k: {"enabled": False, "hour": h}
             for k, h in [("morning", 7), ("midday", 13), ("evening", 20)]}
    assert determine_slot(10, slots) is None
