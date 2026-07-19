# Garmin Health Tips

Sends me three short, personalized health tips a day (morning / midday /
evening) as iPhone notifications via [ntfy](https://ntfy.sh), written by Gemini
from **patterns** in my Garmin watch data. The 7am briefing includes a calorie
target based on my typical burn for that day of the week.

## How it works

- My per-day Garmin history lives in Supabase (the `daily_metrics` table),
  not in this repo.
- **Fetching is automatic**: the `fetch.yml` GitHub Actions workflow pulls
  new days from Garmin into Supabase every 30 minutes, using saved auth
  tokens. On an auth failure it fails that run and stops — it never retries
  within a run, since retrying every 30 minutes would look like credential
  stuffing to Garmin. See `.claude/skills/fetch-garmin/SKILL.md` if it needs
  fixing.
- The `health-tips.yml` workflow runs three times a day, computes
  exponentially weighted weekday statistics from Supabase (all history
  counts; recent weeks count more — see `half_life_days` in `config.yaml`),
  has Gemini write a tip, and sends it via ntfy.
- If the data grows older than `stale_after_days`, the morning run sends a
  "time for a fetch" nudge instead of a tip.

## One-time setup

1. **ntfy** — install the free ntfy app on your iPhone and subscribe to a
   hard-to-guess topic name. Treat the name like a password — anyone who knows
   it can send you notifications and read the tips.
2. **Gemini API key** — create a free one at https://aistudio.google.com/apikey
   (no payment card needed; free tier easily covers three tips a day).
3. **Supabase** — create a free project and the `daily_metrics` table (see
   `plan.md` for the schema). You'll need the project URL and a secret
   (service-role-equivalent) key.
4. **Garmin auth** — run `.venv/bin/python -m src.setup_auth` in Terminal
   (interactive: password + emailed code). Tokens last about a year; it
   prints a base64 blob to store as a secret in the next step.
5. **GitHub** — push this repo to a **private** GitHub repository and add
   these Actions secrets (Settings → Secrets and variables → Actions):
   - `GEMINI_API_KEY` — from step 2
   - `NTFY_TOPIC` — your topic name from step 1
   - `SUPABASE_URL`, `SUPABASE_SECRET_KEY` — from step 3
   - `GARMIN_TOKEN_B64` — the blob from step 4
6. Trigger the **Fetch Garmin data** workflow manually from the Actions tab
   first (backfills 90 days into Supabase), then **Health tips** to test.

## Configuration (`config.yaml`)

Timezone (update the workflow's UTC cron lines if you change it), calorie goal
(`deficit`/`maintain`/`surplus` + amount), tip tone, tip-history retention,
`half_life_days` (how fast old data fades from the averages), and
`stale_after_days` (when to nudge for a fresh fetch).

## Local testing

    .venv/bin/pytest                                        # unit tests
    .venv/bin/python -m src.main --dry-run --slot morning   # full pipeline, prints instead of sending

## When something breaks

A failed **Health tips** run sends a single "Health tips problem"
notification; a failed **Fetch Garmin data** run does not (it just shows red
in the Actions tab — check there if tips stop updating with fresh data).
Garmin login troubleshooting lives in `.claude/skills/fetch-garmin/SKILL.md`.

## Calorie tracker PWA

A React PWA (`pwa/`) for the dashboard, weight logging, and meal logging
(manual or photo-estimated) — see `plan.md` for the architecture and
`docs/superpowers/specs/` for the design docs.
