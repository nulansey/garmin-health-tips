---
name: fetch-garmin
description: Fetch the user's Garmin data into data/daily.json and push it to GitHub. Run when the user asks to update/fetch their Garmin or health data (intended cadence - weekly or twice a week).
---

# Fetch Garmin data

All commands run from the repo root (`~/garmin-health-tips`).

1. Run the fetch: `.venv/bin/python -m src.fetch`
   - First ever run backfills 90 days (a few minutes, ~3 API calls per day);
     later runs only fetch since the newest stored day.
   - It checkpoints every 10 days, so an interrupted run keeps its progress —
     just re-run.
2. Verify the final line reports a newest date of today or yesterday.
3. Commit and push so the scheduled GitHub runs see the fresh data:
   `git add data/daily.json && git commit -m "Update Garmin data through <newest date>" && git push`
4. Optionally sanity-check tips: `.venv/bin/python -m src.main --dry-run --slot morning`
   (needs `ANTHROPIC_API_KEY` in the environment).

## Troubleshooting

- **Login/token errors:** tokens in `~/.garminconnect` are missing or expired
  (~yearly). The user must re-run `.venv/bin/python -m src.setup_auth` in their
  own Terminal app (it is interactive: password + emailed MFA code — the `!`
  prefix inside Claude Code does NOT work for it). Garmin rate-limits login
  attempts aggressively; if 429s appear, wait 24 quiet hours before one retry.
- **If token login is permanently broken:** fallback is a browser-assisted
  export — ask the user to install a browser MCP, drive their logged-in
  connect.garmin.com session, and write the same per-day records into
  `data/daily.json` (see `src/garmin.py` `fetch_day` for the record shape and
  `docs/superpowers/specs/2026-07-06-garmin-health-tips-design.md` v2 section).
