"""Assemble everything the dashboard page shows."""
from datetime import date

from src import patterns
from src.main import calorie_target


def _day_row(day_iso, rec):
    secs = rec.get("sleepTimeSeconds")
    return {
        "date": day_iso,
        "weekday": patterns.WEEKDAY_NAMES[date.fromisoformat(day_iso).weekday()][:3],
        "steps": rec.get("totalSteps"),
        "kcal": rec.get("totalKilocalories"),
        "sleep_h": round(secs / 3600, 1) if secs else None,
        "sleep_score": rec.get("sleepScore"),
        "resting_hr": rec.get("restingHeartRate"),
        "stress": rec.get("averageStressLevel"),
    }


def build_dashboard(store, config, tips, today):
    half_life = config.get("half_life_days", 45)
    age = patterns.data_age_days(store, today)
    stale = age is None or age > config.get("stale_after_days", 10)

    target = None
    if store:
        try:
            burn = patterns.target_burn(store, today, half_life)
            target = calorie_target(burn, config["goal"]["type"],
                                    config["goal"]["amount"])
        except RuntimeError:
            pass  # no calorie data yet; dashboard shows "n/a"

    weekday_name = patterns.WEEKDAY_NAMES[today.weekday()]
    weekday_stats = None
    if store:
        summary = patterns.pattern_summary(store, today, half_life)
        weekday_stats = summary["weekday_averages_weighted"].get(weekday_name)

    cutoff = sorted(store)[-14] if len(store) >= 14 else (min(store) if store else "")
    recent = [_day_row(d, store[d]) for d in sorted(store, reverse=True) if d >= cutoff]

    return {
        "age_days": age,
        "stale": stale,
        "goal": dict(config.get("goal", {})),
        "targets": dict(config.get("targets", {})),
        "calorie_target": target,
        "today_weekday": weekday_name,
        "weekday_stats": weekday_stats,
        "recent_days": recent,
        "recent_tips": list(reversed(tips[-5:])),
    }
