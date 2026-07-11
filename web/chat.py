"""Chat coach: history persistence, prompt building, Gemini streaming."""
import json
from pathlib import Path

from google import genai
from google.genai import types

MODEL = "gemini-flash-latest"
CHAT_PATH = Path(__file__).resolve().parent.parent / "history" / "chat.json"
MAX_TURNS = 200
CONTEXT_TURNS = 20  # how many past turns go into the prompt


def load_chat(path=CHAT_PATH):
    p = Path(path)
    if not p.exists():
        return []
    return json.loads(p.read_text() or "[]")


def save_chat(turns, path=CHAT_PATH):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(turns[-MAX_TURNS:], indent=2) + "\n")


def build_chat_prompt(message, chat_history, context, tips, config,
                      calorie_target_value=None):
    goal = config.get("goal", {})
    targets = config.get("targets") or {}
    goal_lines = [f"- calorie goal: {goal.get('type')} {goal.get('amount')}"]
    if calorie_target_value is not None:
        goal_lines.append(f"- today's calorie intake target: "
                          f"~{calorie_target_value:,} kcal (use this exact "
                          "number if asked about calories today)")
    if targets.get("sleep_hours"):
        goal_lines.append(f"- sleep target: {targets['sleep_hours']} hours")
    if targets.get("steps"):
        goal_lines.append(f"- step target: {targets['steps']:,} steps")

    recent_tips = [f"[{t['date']} {t['slot']}] {t['text']}" for t in tips[-6:]]
    recent_chat = [f"{t['role']}: {t['text']}"
                   for t in chat_history[-CONTEXT_TURNS:]]

    parts = [
        "You are a personal health coach chatting with one person about their "
        f"Garmin watch data. Tone: {config.get('tone', 'friendly')}. Answer "
        "their question directly using the data; be specific with numbers; "
        "keep replies short (a few sentences) unless they ask for detail. "
        "Plain text only, no markdown.",
        "Their current goals:\n" + "\n".join(goal_lines),
        "Tips already sent to their phone recently (stay consistent with "
        "these):\n" + ("\n".join(recent_tips) if recent_tips else "(none)"),
        "Conversation so far:\n" + ("\n".join(recent_chat)
                                    if recent_chat else "(new conversation)"),
        "Garmin pattern data (JSON):\n" + json.dumps(context, default=str),
        f"user: {message}\ncoach:",
    ]
    return "\n\n".join(parts)


def stream_reply(prompt):
    client = genai.Client()  # reads GEMINI_API_KEY from the environment
    stream = client.models.generate_content_stream(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            max_output_tokens=1000,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    got_text = False
    for chunk in stream:
        if chunk.text:
            got_text = True
            yield chunk.text
    if not got_text:
        raise RuntimeError("Gemini returned an empty reply")
