# Garmin Health Tips

Sends me three short, personalized health tips a day (morning / midday /
evening) as iPhone notifications via [ntfy](https://ntfy.sh), written by Gemini
from **patterns** in my Garmin watch data. The 7am briefing includes a calorie
target based on my typical burn for that day of the week.

## How it works

- `data/daily.json` holds my per-day Garmin history, committed to this repo.
- **Fetching is manual**: every week or so I ask Claude to run the
  `/fetch-garmin` skill, which pulls new days from Garmin locally and pushes
  the updated store. Garmin credentials never leave my Mac.
- GitHub Actions runs three times a day, computes exponentially weighted
  weekday statistics (all history counts; recent weeks count more — see
  `half_life_days` in `config.yaml`), has Gemini write a tip, and sends
  it via ntfy.
- If the data grows older than `stale_after_days`, the morning run sends a
  "time for a fetch" nudge instead of a tip.

## One-time setup

1. **ntfy** — install the free ntfy app on your iPhone and subscribe to a
   hard-to-guess topic name. Treat the name like a password — anyone who knows
   it can send you notifications and read the tips.
2. **Gemini API key** — create a free one at https://aistudio.google.com/apikey
   (no payment card needed; free tier easily covers three tips a day).
3. **Garmin auth** — run `.venv/bin/python -m src.setup_auth` in Terminal
   (interactive: password + emailed code). Tokens last about a year.
4. **First fetch** — run `.venv/bin/python -m src.fetch` (backfills 90 days).
5. **GitHub** — push this repo to a **private** GitHub repository and add two
   Actions secrets (Settings → Secrets and variables → Actions):
   - `GEMINI_API_KEY` — from step 2
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

## Web control panel (v2)

A local web app for the dashboard, goal editing, and a chat coach.

### Run it

    ./coach

Then open http://localhost:8787 on the Mac, or http://<mac-name>.local:8787
from your phone on the same WiFi (find the name in System Settings → General
→ Sharing → Local hostname).

Requirements: `.venv/bin/pip install -r requirements-web.txt` once, and a
`.env` file at the repo root containing `GEMINI_API_KEY=...` (never commit it).

### Phone access from anywhere (optional)

Install Tailscale (free for personal use) on both the Mac and the phone, sign
into the same account, then use the Mac's Tailscale hostname instead of
`<mac-name>.local`. No app changes needed.

**Do not** port-forward 8787 on your router — the app has no login and your
health data would be public.

### How goal saves work

Saving in the UI writes `config.yaml` (and the workflow schedule for timing
changes), then commits and pushes to GitHub. The scheduled runs pick the
change up on the next tip. Note: the first save rewrites `config.yaml`
without its explanatory comments — the UI is the primary editor from then on.
