"""Fetch and curate the user's Garmin Connect data."""
import os

from garminconnect import Garmin

TOKENSTORE = os.environ.get("GARMINTOKENS", "~/.garminconnect")

SUMMARY_FIELDS = (
    "totalKilocalories",
    "activeKilocalories",
    "bmrKilocalories",
    "totalSteps",
    "totalDistanceMeters",
    "restingHeartRate",
    "averageStressLevel",
    "moderateIntensityMinutes",
    "vigorousIntensityMinutes",
    "bodyBatteryHighestValue",
    "bodyBatteryLowestValue",
)


def connect():
    """Log in with the saved token store (created once by setup_auth)."""
    api = Garmin()
    api.login(TOKENSTORE)
    return api


def fetch_day(api, day):
    """One day's curated record for the data store.

    Curating (rather than storing raw responses) keeps the store small and the
    Claude prompt cheap — raw stress/body-battery series are thousands of
    points per day.
    """
    d = day.isoformat()

    summary = api.get_user_summary(d) or {}
    record = {k: summary.get(k) for k in SUMMARY_FIELDS}

    sleep_raw = api.get_sleep_data(d) or {}
    dto = sleep_raw.get("dailySleepDTO") or {}
    record.update(
        sleepTimeSeconds=dto.get("sleepTimeSeconds"),
        deepSleepSeconds=dto.get("deepSleepSeconds"),
        remSleepSeconds=dto.get("remSleepSeconds"),
        sleepScore=((dto.get("sleepScores") or {}).get("overall") or {}).get("value"),
    )

    hrv_raw = api.get_hrv_data(d) or {}
    hrv = hrv_raw.get("hrvSummary") or {}
    record["hrvLastNightAvg"] = hrv.get("lastNightAvg")
    record["hrvStatus"] = hrv.get("status")

    record["activities"] = [
        {
            "name": a.get("activityName"),
            "type": (a.get("activityType") or {}).get("typeKey"),
            "durationSeconds": a.get("duration"),
            "calories": a.get("calories"),
        }
        for a in (api.get_activities_by_date(d, d) or [])
    ]
    return record
