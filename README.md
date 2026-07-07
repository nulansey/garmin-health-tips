# Garmin Health Tips

Pulls my Garmin watch data three times a day, has Claude write a short
personalized health tip, and pushes it to my iPhone via [ntfy](https://ntfy.sh).
The 7am briefing includes a calorie-intake target based on yesterday's burn.

## One-time setup (~15 minutes)

1. **ntfy** — install the free ntfy app on your iPhone. Subscribe to a
   hard-to-guess topic name (e.g. `garmin-tips-x7f93k2`). Treat the name like a
   password — anyone who knows it can send you notifications.
2. **Claude API key** — create one at https://console.anthropic.com (requires a
   payment card; expected usage is under $1/month).
3. **Garmin auth** — run `.venv/bin/python -m src.setup_auth` locally. It logs
   in once (handles MFA) and prints a base64 blob.
4. **GitHub** — push this repo to a **private** GitHub repository, then add
   three Actions secrets (Settings → Secrets and variables → Actions):
   - `GARMIN_TOKENS_B64` — the blob from step 3
   - `ANTHROPIC_API_KEY` — from step 2
   - `NTFY_TOPIC` — your topic name from step 1
5. Trigger the **Health tips** workflow manually from the Actions tab to test.

## Configuration

Edit `config.yaml`: timezone, calorie goal (`deficit`/`maintain`/`surplus` and
amount), tip tone, and how many days of tip history to keep. If you change the
timezone, update the cron lines in `.github/workflows/health-tips.yml` (UTC).

## Local testing

    .venv/bin/pytest                                        # unit tests
    .venv/bin/python -m src.main --dry-run --slot morning   # full pipeline, prints instead of sending

## When something breaks

You get a single "Health tips problem" notification and the run shows red in
the Actions tab with a full log. Most common cause: expired Garmin tokens
(~yearly) — re-run `python -m src.setup_auth` and update `GARMIN_TOKENS_B64`.
