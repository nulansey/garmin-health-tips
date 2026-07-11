import yaml

from web import goals

BASE = {"timezone": "Pacific/Honolulu",
        "goal": {"type": "deficit", "amount": 500},
        "tone": "friendly", "history_days": 14}


def _write(tmp_path, data):
    p = tmp_path / "config.yaml"
    p.write_text(yaml.safe_dump(data, sort_keys=False))
    return p


def test_validate_goal():
    assert goals.validate_goal("deficit", 500) == []
    assert goals.validate_goal("maintain", 0) == []
    assert goals.validate_goal("bulk", 500)          # unknown type
    assert goals.validate_goal("deficit", -5)        # negative
    assert goals.validate_goal("deficit", 2500)      # over cap
    assert goals.validate_goal("deficit", "lots")    # not an int


def test_validate_targets():
    assert goals.validate_targets(7.5, 10000) == []
    assert goals.validate_targets(None, None) == []   # both optional
    assert goals.validate_targets(2, None)            # sleep too low
    assert goals.validate_targets(None, 100)          # steps too low
    assert goals.validate_targets(None, 90000)        # steps too high


def test_set_goal_roundtrip(tmp_path):
    p = _write(tmp_path, BASE)
    goals.set_goal("surplus", 300, path=p)
    data = yaml.safe_load(p.read_text())
    assert data["goal"] == {"type": "surplus", "amount": 300}
    assert data["timezone"] == "Pacific/Honolulu"  # other keys survive


def test_set_targets_add_and_remove(tmp_path):
    p = _write(tmp_path, BASE)
    goals.set_targets(7.5, 10000, path=p)
    data = yaml.safe_load(p.read_text())
    assert data["targets"] == {"sleep_hours": 7.5, "steps": 10000}
    goals.set_targets(None, 8000, path=p)
    data = yaml.safe_load(p.read_text())
    assert data["targets"] == {"steps": 8000}
    goals.set_targets(None, None, path=p)
    assert "targets" not in yaml.safe_load(p.read_text())
