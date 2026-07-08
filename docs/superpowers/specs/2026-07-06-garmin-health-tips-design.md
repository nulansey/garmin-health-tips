# Garmin Health Tips — Design

**Date:** 2026-07-06 (v2 revision 2026-07-07)
**Status:** Approved by user (brainstorming session; v2 restructure approved 2026-07-07)

## v2 revision (2026-07-07) — predictive tips with manual fetches

Approved by the user after Garmin's login rate-limiting made daily automated
fetching unreliable, and because they prefer pattern-based tips. Supersedes the
per-run live fetch described below; everything not mentioned here is unchanged
(3 daily slots, ntfy, tip memory, duplicate protection, configurable goal,
error notifications).

- **Data store:** `data/daily.json` — `{ "YYYY-MM-DD": {curated metrics} }`,
  committed to the repo, grows forever.
- **Fetching is manual and local** (weekly or twice-weekly, run by Claude on
  request via a `/fetch-garmin` project skill): `python -m src.fetch` logs in
  with saved tokens, backfills 90 days on first run, then fetches since the
  newest stored day, merges, and the skill commits/pushes. Garmin credentials
  never go to GitHub — Actions secrets shrink to `ANTHROPIC_API_KEY` and
  `NTFY_TOPIC`. Browser-assisted export is the documented fallback if token
  login stays broken.
- **Tips become predictive:** stats are exponentially weighted (EWMA) so ALL
  history counts but recent days count more — `half_life_days: 45` in
  config.yaml (a 45-day-old data point has half the weight of today's).
  Morning calorie target = weekday EWMA of total burn (>= 4 observations of
  that weekday required, else overall EWMA). The prompt gets: per-weekday
  weighted stats with observation counts, the last 14 raw days, the last 4
  same-weekdays, and today's date — Claude contextualizes trends, holidays,
  and habit changes rather than a formula modeling them.
- **Staleness guard:** `stale_after_days: 10` in config.yaml. When the newest
  stored day is older than that, the morning run sends a "time for a Garmin
  fetch" nudge instead of a tip; midday/evening runs exit silently.

## What this is

A small Python service that pulls the user's Garmin watch data, has Claude write
short personalized health tips, and pushes them to the user's iPhone as
notifications on a daily schedule. It includes a morning briefing that
recommends a calorie-intake target based on the previous day's calories burned.

## Goals

- Morning briefing (~7am local): calorie-intake target for today derived from
  yesterday's total burn (resting + active) and the user's configured goal,
  plus a 2–3 sentence recovery summary (sleep, HRV, Body Battery).
- Midday tip (~1pm) and evening tip (~8pm): one actionable suggestion each,
  based on today's data so far and the week's trends. Evening leans toward
  wind-down/bedtime advice.
- Tips are AI-written from the user's actual numbers, not canned rules.
- Near-zero cost: target well under $1/month.

## Non-goals (v1)

- No food logging, no dashboard, no database (Approach C explicitly rejected).
- No more than 3 notifications/day (user chose "morning + 1–2 tips").
- No official Garmin Health API (business-only); uses the unofficial library.

## Decisions made with the user

| Decision | Choice |
|---|---|
| Metrics used | Everything the watch provides: sleep, HRV, Body Battery, stress, steps, calories, workouts, resting HR |
| Phone | iPhone |
| Tip generation | Claude API, Haiku model (~$0.10–0.50/month) |
| Hosting | GitHub Actions on schedule (free tier), private repo |
| Cadence | Morning briefing + midday tip + evening tip |
| Calorie goal | Configurable in `config.yaml` (deficit / maintain / surplus, with adjustable size) |
| Memory | Approach B — light memory: recent tips stored in `history/tips.json`, committed back to the repo, fed to Claude so tips don't repeat and can build on earlier ones |

## Architecture

```
garmin-health-tips/
├── config.yaml            # calorie goal, notification slot times, timezone, tip tone
├── src/
│   ├── garmin.py          # login + pull last 7 days: sleep, HRV, Body Battery,
│   │                      #   stress, steps, calories, workouts
│   ├── analyze.py         # build prompt (data + recent tips + slot), call Claude
│   │                      #   Haiku, return one short tip
│   ├── notify.py          # send tip (or error notice) to iPhone via ntfy
│   ├── main.py            # orchestrates a run; determines slot
│   │                      #   (morning/midday/evening); duplicate protection
│   └── setup_auth.py      # one-time interactive Garmin login (handles MFA),
│                          #   saves reusable token (~1 year lifetime)
├── history/tips.json      # last ~14 days of sent tips (the "light memory")
├── tests/                 # unit tests for pure logic (no network)
└── .github/workflows/
    └── health-tips.yml    # cron schedule: ~7am, ~1pm, ~8pm user's timezone
```

### Run flow

1. GitHub Actions cron fires → checks out repo, installs deps.
2. `main.py` determines which slot this run is from the current time.
3. Duplicate check: if `history/tips.json` already has a tip for this slot
   today, exit quietly (guards against late/double cron fires).
4. `garmin.py` authenticates with the stored token and pulls the last 7 days
   of metrics via the `garminconnect` library.
5. Morning slot only: compute yesterday's total burn; apply configured goal
   (e.g. −500 kcal for weight loss) → calorie target leads the message.
6. `analyze.py` sends metrics + recent tip history + slot context to Claude
   Haiku with instructions: one concise, actionable tip; don't repeat recent
   tips; build on earlier advice from today.
7. `notify.py` POSTs the message to the user's private ntfy topic → iPhone push.
8. Append the sent tip to `history/tips.json`; the workflow commits and pushes
   the updated file back to the repo.

### Secrets (GitHub Actions encrypted secrets — never in code)

- Garmin auth token (produced by `setup_auth.py`)
- Anthropic API key
- ntfy topic name (acts as the notification address; treated as a secret so
  strangers can't push to the user's phone)

## Error handling

- Any failure (Garmin login rejected, API down, etc.) → send ONE short ntfy
  error notification ("⚠️ Health tips: couldn't reach Garmin this morning")
  and exit nonzero so the Actions log shows the failure. No silent skips,
  no retry spam.
- Missing data (watch not worn overnight): morning briefing says so and falls
  back to the 7-day average burn for the calorie target.
- Garmin token expiry (~1 year) or unofficial-API breakage: surfaces via the
  error notification same-day; remediation is re-running `setup_auth.py` or
  updating the library.

## Testing

1. `--dry-run` flag: full real pipeline (Garmin pull + Claude call) but prints
   the tip to console instead of sending — used from the Mac before scheduling.
2. Unit tests (no network): calorie-target math for each goal type, slot
   determination from time-of-day, duplicate-send protection.

## One-time user setup (~15 min)

1. GitHub account + private repo.
2. Install ntfy app on iPhone; choose a hard-to-guess topic name.
3. Create Anthropic API key at console.anthropic.com (requires payment card;
   expected usage is pennies/month).
4. Run `setup_auth.py` once locally with Claude's help (handles Garmin MFA);
   upload resulting token as a GitHub secret.

## Cost summary

- Garmin data: free (unofficial `garminconnect` library).
- Notifications: free (ntfy public server).
- Hosting/scheduling: free (GitHub Actions free tier; ~3 short runs/day).
- Tips: Claude Haiku API, roughly $0.10–0.50/month. Total: well under $1/month.
