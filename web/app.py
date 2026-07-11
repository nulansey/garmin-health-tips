"""FastAPI control panel for the Garmin health coach.

Run with:  ./coach   (or: .venv/bin/python -m uvicorn web.app:app --host 0.0.0.0 --port 8787)
"""
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from src.fetch import load_store
from src.main import load_config, load_history
from web.dashboard import build_dashboard

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")  # GEMINI_API_KEY for the chat coach

app = FastAPI(title="Garmin Health Coach")
templates = Jinja2Templates(directory=str(ROOT / "web" / "templates"))

STATIC_DIR = ROOT / "web" / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/health")
def health():
    return {"status": "ok"}


def _flash(request: Request):
    msg = request.query_params.get("msg")
    if not msg:
        return None
    return {"ok": request.query_params.get("ok") == "1", "text": msg}


@app.get("/")
def dashboard_page(request: Request):
    config = load_config()
    today = datetime.now(ZoneInfo(config["timezone"])).date()
    flash = _flash(request)
    try:
        store = load_store()
    except Exception:  # malformed data/daily.json — show the page, not a 500
        store = {}
        flash = flash or {"ok": False,
                          "text": "data/daily.json is unreadable — re-run /fetch-garmin"}
    d = build_dashboard(store, config, load_history(), today)
    return templates.TemplateResponse(request, "dashboard.html",
                                      {"d": d, "flash": flash})
