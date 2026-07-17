---
name: fetch-garmin
description: Check the automated Garmin data pipeline (Supabase-backed, fetched every 30 min by GitHub Actions) and refresh Garmin auth tokens when they expire or the fetch workflow starts failing. Run when the user asks to check/fix Garmin data or reports stale/missing tips.
---

# Garmin data pipeline

Data flows automatically now: the `fetch.yml` GitHub Actions workflow pulls
Garmin data into Supabase's `daily_metrics` table every 30 minutes. There is
nothing to run manually under normal operation.

All commands run from the repo root (`~/garmin-health-tips`).

## Check pipeline health

    gh run list --workflow=fetch.yml --limit 5

A recent green run means data is current. To see the newest stored date
directly (needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in a local `.env`):

    set -a && source .env && set +a
    .venv/bin/python -c "from src.fetch import load_store; s = load_store(); print(max(s) if s else 'empty')"

## Troubleshooting

- **`fetch.yml` failing on "Restore Garmin tokens" or the fetch step:**
  Garmin tokens (the `GARMIN_TOKEN_B64` secret) are missing or expired
  (~yearly). The user must re-run `.venv/bin/python -m src.setup_auth` in
  their own Terminal app (it is interactive: password + emailed MFA code —
  the `!` prefix inside Claude Code does NOT work for it). It prints a fresh
  base64 blob; the user sets it themselves with `gh secret set
  GARMIN_TOKEN_B64` — don't ask them to paste the blob into chat, it's a
  credential. Garmin rate-limits login attempts aggressively; if 429s
  appear, wait 24 quiet hours before one retry. Because `fetch.yml` never
  retries within a run, a broken token just fails every 30-minute run
  quietly until this is fixed — it does not hammer Garmin in the meantime.
- **One-off manual fetch** (e.g. to test right after a token refresh,
  without waiting for the next cron tick):

      gh workflow run fetch.yml
      gh run watch --exit-status

  Or locally: `set -a && source .env && set +a && .venv/bin/python -m src.fetch`
  (needs `SUPABASE_URL`/`SUPABASE_SECRET_KEY` in `.env` and valid Garmin
  tokens in `~/.garminconnect`).
- **If token login is permanently broken:** fallback is a browser-assisted
  export — ask the user to install a browser MCP, drive their logged-in
  connect.garmin.com session, and write records directly into Supabase's
  `daily_metrics` table (see `src/garmin.py` `fetch_day` for the record
  shape and `src/fetch.py`'s `FIELD_MAP`/`to_row` for the column mapping).
