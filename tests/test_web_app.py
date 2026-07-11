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
