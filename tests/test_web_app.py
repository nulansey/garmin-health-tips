from fastapi.testclient import TestClient

from web.app import app


def test_health_endpoint():
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_dashboard_page_renders():
    client = TestClient(app)
    resp = client.get("/")
    assert resp.status_code == 200
    assert "Garmin Health Coach" in resp.text
    assert "Calorie goal" in resp.text


def test_goals_page_renders():
    client = TestClient(app)
    resp = client.get("/goals")
    assert resp.status_code == 200
    assert "Calorie goal" in resp.text


def test_calorie_save_rejects_bad_amount(monkeypatch):
    import web.app as webapp
    pushed = []
    monkeypatch.setattr(webapp.gitsync, "commit_and_push",
                        lambda *a, **k: pushed.append(a) or (True, "pushed"))
    client = TestClient(app)
    resp = client.post("/goals/calorie",
                       data={"goal_type": "deficit", "amount": "99999"},
                       follow_redirects=False)
    assert resp.status_code == 303
    assert "ok=0" in resp.headers["location"]
    assert pushed == []  # invalid input never reaches git


def test_calorie_save_valid(monkeypatch, tmp_path):
    import shutil
    import web.app as webapp
    import web.goals as goals_mod
    cfg = tmp_path / "config.yaml"
    shutil.copy(goals_mod.CONFIG_PATH, cfg)
    monkeypatch.setattr(goals_mod, "CONFIG_PATH", cfg)
    calls = []
    monkeypatch.setattr(webapp.gitsync, "commit_and_push",
                        lambda paths, msg, **k: calls.append(msg) or (True, "pushed"))
    client = TestClient(app)
    resp = client.post("/goals/calorie",
                       data={"goal_type": "maintain", "amount": "0"},
                       follow_redirects=False)
    assert resp.status_code == 303
    assert "ok=1" in resp.headers["location"]
    assert calls and calls[0].startswith("config:")
