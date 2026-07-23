"""Build the prompt and ask Gemini for one health tip."""
import json

from google import genai
from google.genai import types

# Pinned to a minor-version alias, never the floating "-latest": on 2026-07-21
# "-latest" moved from 2.5 to 3.x Flash, which swapped thinking_budget (token
# count) for thinking_level (semantic) and 400'd every request. 3.x uses
# thinking_level (see generate_tip); a bump back to a 2.x model would need
# thinking_budget instead.
MODEL = "gemini-3.5-flash"

SLOT_GUIDANCE = {
    "morning": (
        "This is the MORNING BRIEFING. Lead with the calorie target line exactly "
        "as provided (it is based on their typical burn for this weekday), then "
        "2-3 short sentences setting up the day using what this weekday usually "
        "looks like for them."
    ),
    "midday": (
        "This is a MIDDAY tip. Based on what their afternoons usually look like "
        "on this weekday (steps, stress, activities), give ONE actionable "
        "suggestion for the rest of the day."
    ),
    "evening": (
        "This is an EVENING tip. Focus on winding down: their typical sleep on "
        "this weekday, recent sleep trend, and one concrete bedtime or recovery "
        "suggestion."
    ),
}


def build_prompt(context, history, slot, config, calorie_target_value=None):
    recent = [f"[{t['date']} {t['slot']}] {t['text']}" for t in history[-10:]]
    parts = [
        "You write short predictive health tips for one person based on "
        f"patterns in their Garmin watch data. Tone: {config['tone']}.",
        "The data below contains weighted per-weekday averages (recent weeks "
        "count more than old ones; 'n' is how many of that weekday are on "
        "record), the last 14 raw days, and their last few same-weekdays. "
        f"Today is a {context.get('today_weekday', 'day')}: lean on that "
        "weekday's patterns, but use the recent raw days to spot trends, "
        "streaks, holidays, or habit changes the averages hide.",
        SLOT_GUIDANCE[slot],
        "Keep it under 500 characters total - it is sent as a phone notification. "
        "Plain text only: no markdown, no preamble, no sign-off.",
        "Do not repeat recent tips; build on what was said earlier today when "
        "relevant.",
    ]
    targets = config.get("targets") or {}
    target_bits = []
    if targets.get("sleep_hours"):
        target_bits.append(f"a nightly sleep target of {targets['sleep_hours']} hours")
    if targets.get("steps"):
        target_bits.append(f"a daily step target of {targets['steps']:,} steps")
    if target_bits:
        parts.insert(3, "The user has set " + " and ".join(target_bits) +
                        ". When their patterns fall short of a target, nudge "
                        "them toward it with something concrete; when they hit "
                        "it, acknowledge it briefly.")
    if calorie_target_value is not None:
        parts.append(
            f'Start with exactly: "Aim for ~{calorie_target_value:,} calories today."'
        )
    parts.append(
        "Recent tips already sent:\n" + ("\n".join(recent) if recent else "(none)")
    )
    parts.append("Garmin pattern data (JSON):\n" + json.dumps(context, default=str))
    return "\n\n".join(parts)


def generate_tip(context, history, slot, config, calorie_target_value=None):
    client = genai.Client()  # reads GEMINI_API_KEY from the environment
    prompt = build_prompt(context, history, slot, config, calorie_target_value)
    response = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            # Thinking tokens share this budget, so give headroom above the
            # ~150 tokens a 500-char tip needs; MINIMAL keeps reasoning small
            # but not zero (3.x has no full-off like 2.x's thinking_budget=0),
            # and too tight a cap leaves response.text empty.
            max_output_tokens=800,
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.MINIMAL,
            ),
        ),
    )
    text = (response.text or "").strip()
    if not text:
        raise RuntimeError("Gemini returned an empty tip")
    return text
