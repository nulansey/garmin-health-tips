# Garmin Health Tips

Sends me three short, personalized health tips a day (morning / midday /
evening) as iPhone notifications via [ntfy](https://ntfy.sh), written by Claude
from **patterns** in my Garmin watch data. The 7am briefing includes a calorie
target based on my typical burn for that day of the week.

## How it works

- `data/daily.json` holds my per-day Garmin history, committed to this repo.
- **Fetching is manual**: every week or so I ask Claude to run the
  `/fetch-garmin` skill, which pulls new days from Garmin locally and pushes
  the updated store. Garmin credentials never leave my Mac.
- GitHub Actions runs three times a day, computes exponentially weighted
  weekday statistics (all history counts; recent weeks count more — see
  `half_life_days` in `config.yaml`), has Claude Haiku write a tip, and sends
  it via ntfy.
- If the data grows older than `stale_after_days`, the morning run sends a
  "time for a fetch" nudge instead of a tip.

## One-time setup

1. **ntfy** — install the free ntfy app on your iPhone and subscribe to a
   hard-to-guess topic name. Treat the name like a password — anyone who knows
   it can send you notifications and read the tips.
2. **Claude API key** — create one at https://console.anthropic.com (requires a
   payment card; expected usage is under $1/month).
3. **Garmin auth** — run `.venv/bin/python -m src.setup_auth` in Terminal
   (interactive: password + emailed code). Tokens last about a year.
4. **First fetch** — run `.venv/bin/python -m src.fetch` (backfills 90 days).
5. **GitHub** — push this repo to a **private** GitHub repository and add two
   Actions secrets (Settings → Secrets and variables → Actions):
   - `ANTHROPIC_API_KEY` — from step 2
   - `NTFY_TOPIC` — your topic name from step 1
6. Trigger the **Health tips** workflow manually from the Actions tab to test.

## Configuration (`config.yaml`)

Timezone (update the workflow's UTC cron lines if you change it), calorie goal
(`deficit`/`maintain`/`surplus` + amount), tip tone, tip-history retention,
`half_life_days` (how fast old data fades from the averages), and
`stale_after_days` (when to nudge for a fresh fetch).

## Local testing

    .venv/bin/pytest                                        # unit tests
    .venv/bin/python -m src.main --dry-run --slot morning   # full pipeline, prints instead of sending

## When something breaks

You get a single "Health tips problem" notification and the run shows red in
the Actions tab with a full log. Garmin login troubleshooting lives in
`.claude/skills/fetch-garmin/SKILL.md`.
