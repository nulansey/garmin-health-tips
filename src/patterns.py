"""Exponentially weighted pattern statistics over the daily data store.

The store maps ISO dates to curated daily records. All statistics use every
recorded day, but each day's weight halves every `half_life_days` — so history
keeps improving the averages while lifestyle changes show up within weeks.
"""
from datetime import date, timedelta

WEEKDAY_NAMES = (
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
)

STAT_FIELDS = (
    "totalKilocalories",
    "totalSteps",
    "sleepScore",
    "sleepTimeSeconds",
    "averageStressLevel",
    "restingHeartRate",
)


def _weight(day_iso, today, half_life_days):
    age = (today - date.fromisoformat(day_iso)).days
    return 0.5 ** (age / half_life_days)


def _weighted_mean(entries, field, today, half_life_days):
    num = den = 0.0
    for day_iso, rec in entries:
        value = rec.get(field)
        if value is None:
            continue
        w = _weight(day_iso, today, half_life_days)
        num += w * value
        den += w
    return round(num / den, 1) if den else None


def _weighted_stats(entries, today, half_life_days):
    stats = {f: _weighted_mean(entries, f, today, half_life_days) for f in STAT_FIELDS}
    stats["n"] = len(entries)
    return stats


def target_burn(store, today, half_life_days, min_weekday_obs=4):
    """Weighted typical total burn for today's weekday.

    Falls back to the all-days weighted average until the weekday has at least
    `min_weekday_obs` observations.
    """
    weekday = today.weekday()
    entries = [
        (d, r) for d, r in store.items()
        if r.get("totalKilocalories") and date.fromisoformat(d).weekday() == weekday
    ]
    if len(entries) < min_weekday_obs:
        entries = [(d, r) for d, r in store.items() if r.get("totalKilocalories")]
    if not entries:
        raise RuntimeError("no calorie data in the store yet - run a Garmin fetch")
    num = sum(_weight(d, today, half_life_days) * r["totalKilocalories"] for d, r in entries)
    den = sum(_weight(d, today, half_life_days) for d, r in entries)
    return int(round(num / den))


def data_age_days(store, today):
    """Days since the newest stored day; None for an empty store."""
    if not store:
        return None
    return (today - date.fromisoformat(max(store))).days


def _row(store, day_iso, with_weekday=False):
    row = {"date": day_iso}
    if with_weekday:
        row["weekday"] = WEEKDAY_NAMES[date.fromisoformat(day_iso).weekday()]
    row.update({f: store[day_iso].get(f) for f in STAT_FIELDS})
    if store[day_iso].get("activities"):
        row["activities"] = store[day_iso]["activities"]
    return row


def pattern_summary(store, today, half_life_days):
    """The context dict handed to Claude for tip writing."""
    by_weekday = {}
    for idx, name in enumerate(WEEKDAY_NAMES):
        entries = [
            (d, r) for d, r in store.items()
            if date.fromisoformat(d).weekday() == idx
        ]
        if entries:
            by_weekday[name] = _weighted_stats(entries, today, half_life_days)

    cutoff = (today - timedelta(days=14)).isoformat()
    last_14 = [
        _row(store, d, with_weekday=True) for d in sorted(store) if d >= cutoff
    ]

    same_weekday = [
        d for d in sorted(store, reverse=True)
        if date.fromisoformat(d).weekday() == today.weekday()
    ][:4]
    last_same = [_row(store, d) for d in same_weekday]

    return {
        "today": today.isoformat(),
        "today_weekday": WEEKDAY_NAMES[today.weekday()],
        "newest_date": max(store) if store else None,
        "data_age_days": data_age_days(store, today),
        "weekday_averages_weighted": by_weekday,
        "last_14_days": last_14,
        "last_4_same_weekdays": last_same,
    }
