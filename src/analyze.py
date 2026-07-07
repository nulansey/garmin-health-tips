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
