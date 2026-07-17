"""FastAPI control panel for the Garmin health coach.

Run with:  ./coach   (or: .venv/bin/python -m uvicorn web.app:app --host 0.0.0.0 --port 8787)
"""
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import FastAPI, Form, Request
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from src import patterns
from src.fetch import load_store
from src.main import calorie_target, get_slots, load_config, load_history
from web import chat, gitsync, goals, schedule
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
    except Exception:  # Supabase unreachable/misconfigured — show the page, not a 500
        store = {}
        flash = flash or {"ok": False,
                          "text": "Garmin data is unavailable — check Supabase "
                                  "credentials or re-run the fetch"}
    d = build_dashboard(store, config, load_history(), today)
    return templates.TemplateResponse(request, "dashboard.html",
                                      {"d": d, "flash": flash})


def _redirect(path, ok, text):
    return RedirectResponse(f"{path}?ok={'1' if ok else '0'}&msg={quote(text)}",
                            status_code=303)


def _save_and_sync(write, description):
    """Run a config write, then sync to GitHub. Returns a redirect response."""
    write()
    ok, detail = gitsync.commit_and_push(
        ["config.yaml", ".github/workflows/health-tips.yml"],
        f"config: {description} via web UI")
    if ok:
        return _redirect("/goals", True, "Saved and pushed — live from the next tip.")
    return _redirect("/goals", False, detail)


@app.get("/goals")
def goals_page(request: Request):
    config = load_config()
    return templates.TemplateResponse(request, "goals.html",
                                      {"config": config,
                                       "slots": get_slots(config),
                                       "flash": _flash(request)})


@app.post("/goals/calorie")
def save_calorie(goal_type: str = Form(...), amount: int = Form(...)):
    errors = goals.validate_goal(goal_type, amount)
    if errors:
        return _redirect("/goals", False, "; ".join(errors))
    return _save_and_sync(
        lambda: goals.set_goal(goal_type, amount, path=goals.CONFIG_PATH),
        "update calorie goal")


@app.post("/goals/targets")
def save_targets(sleep_hours: str = Form(""), steps: str = Form("")):
    sleep_val = float(sleep_hours) if sleep_hours.strip() else None
    steps_val = int(steps) if steps.strip() else None
    errors = goals.validate_targets(sleep_val, steps_val)
    if errors:
        return _redirect("/goals", False, "; ".join(errors))
    return _save_and_sync(
        lambda: goals.set_targets(sleep_val, steps_val, path=goals.CONFIG_PATH),
        "update targets")


@app.post("/refresh")
def refresh():
    ok, detail = gitsync.pull()
    return _redirect("/", ok, "Pulled latest from GitHub." if ok else detail)


@app.post("/goals/timing")
async def save_timing(request: Request):
    form = await request.form()
    slots = {}
    for name in ("morning", "midday", "evening"):
        try:
            hour = int(form.get(f"{name}_hour", ""))
        except ValueError:
            hour = -1  # fails validation below
        slots[name] = {"enabled": f"{name}_enabled" in form, "hour": hour}
    errors = schedule.validate_slots(slots)
    if errors:
        return _redirect("/goals", False, "; ".join(errors))
    config = load_config()

    def write():
        schedule.set_slots(slots, path=schedule.CONFIG_PATH)
        schedule.rewrite_workflow(slots, config["timezone"],
                                  path=schedule.WORKFLOW_PATH)

    return _save_and_sync(write, "update tip timing")


class ChatMessage(BaseModel):
    message: str


@app.get("/chat")
def chat_page(request: Request):
    return templates.TemplateResponse(request, "chat.html",
                                      {"history": chat.load_chat(chat.CHAT_PATH),
                                       "flash": None})


@app.post("/chat/send")
def chat_send(body: ChatMessage):
    config = load_config()
    now = datetime.now(ZoneInfo(config["timezone"]))
    try:
        store = load_store()
    except Exception:  # Supabase unreachable/misconfigured
        store = {}
    half_life = config.get("half_life_days", 45)
    context = (patterns.pattern_summary(store, now.date(), half_life)
               if store else {"note": "no Garmin data in the store yet"})
    target = None
    if store:
        try:
            burn = patterns.target_burn(store, now.date(), half_life)
            target = calorie_target(burn, config["goal"]["type"],
                                    config["goal"]["amount"])
        except RuntimeError:
            pass
    prompt = chat.build_chat_prompt(body.message, chat.load_chat(chat.CHAT_PATH),
                                    context, load_history(), config,
                                    calorie_target_value=target)

    def generate():
        reply_parts = []
        try:
            for piece in chat.stream_reply(prompt):
                reply_parts.append(piece)
                yield piece
        except Exception as exc:
            msg = ("Sorry, I had trouble reaching Gemini just now "
                   f"({type(exc).__name__}). Try again in a moment.")
            reply_parts = [msg]
            yield msg
        ts = now.isoformat()
        turns = chat.load_chat(chat.CHAT_PATH)
        turns.append({"role": "user", "text": body.message, "ts": ts})
        turns.append({"role": "coach", "text": "".join(reply_parts), "ts": ts})
        chat.save_chat(turns, path=chat.CHAT_PATH)

    return StreamingResponse(generate(), media_type="text/plain")


@app.post("/chat/clear")
def chat_clear():
    chat.save_chat([], path=chat.CHAT_PATH)
    return {"status": "cleared"}
