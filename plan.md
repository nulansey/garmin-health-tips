Garmin Calorie Tracker — Project Spec
Personal fitness/calorie-tracking PWA built on top of the existing Garmin fetch pipeline in this repo. Solo use for now (owner only); friends maybe later. This document is the source of truth for architecture and design decisions — consult it before making structural changes.
Big picture

* Goal: weight loss. Primary long-horizon view is current weight vs goal weight.
* Core loop: Garmin supplies calories burned; meals are logged via photo (AI-estimated) or manual entry; the app shows daily calorie balance and weight trend.
* Existing `config.yaml` goal (500 kcal deficit vs yesterday's burn) remains the per-day target; eventually merges into app settings.
Architecture

```
Garmin Connect ──(garminconnect lib, token auth)──> fetch script
fetch script ──(runs on GitHub Actions every ~30 min)──> Supabase (Postgres)
Supabase <── PWA (React + Vite + Recharts, hosted Vercel/Cloudflare Pages)
PWA ──photo──> Supabase Edge Function ──> vision LLM ──> name+calories ──> user confirms ──> meals table
GitHub Actions tips workflow ──reads──> Supabase (replaces data/daily.json)

```

Data pipeline (migration from current state)
Current state: `src/fetch.py` is run manually on the owner's MacBook and writes `data/daily.json`, which is committed/pushed; a GitHub Actions workflow generates health tips from it 3x/day. Garmin tokens live only on the laptop.
Decided changes (Option A — tokens move to GitHub):

1. `fetch.py`: replace the JSON store with Supabase upserts into `daily_metrics` (supabase-py, `service` access via secret key). Days-to-fetch logic: `select max(date)` instead of `max(store)` keys. Keep the existing pattern of refetching from one day before the newest stored day (that day may have been partial).
2. One-time import: backfill existing `data/daily.json` history into `daily_metrics`.
3. New workflow `fetch.yml`: cron `*/30 * * * *` + `workflow_dispatch`; decodes `GARMIN_TOKENS_B64` secret to `~/.garminconnect`; runs the fetch.
   * On auth failure, fail loudly and STOP. Do not retry — repeated failed logins every 30 min look like credential stuffing and get the Garmin account throttled (already fought this once; see comments in `setup_auth.py`).
   * GitHub cron drifts 5–15 min; that's fine, don't chase punctuality. Scheduled workflows auto-disable after 60 days without repo activity.
4. Point the tips workflow at Supabase; retire `data/daily.json` and the commit/push instructions in the fetch docstring. Remove the stale `GARMIN_TOKENS_B64` leftover confusion in `setup_auth.py` docs (the secret is now real again).
GitHub Actions secrets (already/soon configured)

* `SUPABASE_URL` — `https://<project-ref>.supabase.co` (full URL, not the ref)
* `SUPABASE_SECRET_KEY` — Supabase `sb_secret_...` key (new-style key; legacy service_role not used). Server-side only, never in frontend code.
* `GARMIN_TOKENS_B64` — base64 tarball of the Garmin token store, produced by `setup_auth.py`. Tokens last ~1 year; re-run setup and update the secret on expiry.
The Supabase `sb_publishable_...` key is used by the PWA (safe to expose).
Database (Supabase Postgres)
Tables already created; RLS enabled on all three with no policies (locked down — only the secret key works). Add deliberate read policies only when the PWA needs them.

* `daily_metrics` — one row per calendar date (PK `date`): total/active/bmr kcal, steps, distance_m, resting_hr, avg_stress, moderate/vigorous minutes, body battery high/low, sleep seconds (total/deep/rem), sleep_score, hrv_last_night_avg, hrv_status, `activities jsonb`, updated_at.
* `meals` — id, eaten_at timestamptz, `intake_date date` (computed at insert by the 6am rule), name, calories, `source` ('photo' | 'manual'), created_at.
* `weights` — id, measured_at, weight numeric.
Key design decisions (settled — do not relitigate silently)

1. Burn source: Garmin `totalKilocalories` is the single source of calories out. Do NOT add a separate BMR estimate on top (double-counting).
2. Day boundary: intake days run 6am→6am local (Pacific/Honolulu) — late-night eating counts toward the previous day. Garmin metrics stay calendar-day (can't be rebucketed); the minor window mismatch is accepted.
3. Photos are not retained. Vision call extracts dish name + calorie estimate; user confirms/adjusts on a mandatory confirmation screen; only name + calories are saved.
4. Manual entry exists for anything un-photographable (drinks, restaurant meals, packaged food). User looks up values themselves and enters name + calories.
5. Weight chart: plot the 7-day rolling average as the primary line (raw daily weigh-ins as faint dots at most), with goal weight as a horizontal target line. Raw scale weight is ±2–3 lb noise; never present it as the trend.
6. Weight as calibration: over 2–3 week windows, compare predicted balance vs actual weight-trend change to surface the user's personal logging-bias correction factor. (Photo logging under-reports ~15–25% for everyone.)
7. "Today" is always partial with 30-min fetching — label today's burn as in-progress, not final.
8. Missed-log handling: flag low-log days rather than averaging them into trends naively.
9. Vision cost ceiling: hard budget cap on the vision API key.
10. No "fuel gauge": the UI shows daily/weekly calorie balance and trends, not a "calories currently in body" number (not a real quantity; estimates carry ±10–20% error).
Vision pipeline

* Client resizes the photo before upload (no 12MP uploads).
* Supabase Edge Function holds the vision API key (never in the browser), calls a vision-capable model with a prompt that includes the owner's plate/bowl dimensions (to be provided) for portion sizing, returns structured JSON: foods, portions, calorie estimates.
* PWA shows a confirm/adjust screen; nothing is saved without confirmation.
* Estimates are ±30–50% on real meals — treat as convenience layer, not source of truth. Weight trend (decision 6) is the ground truth.
PWA

* React + Vite + Recharts; `vite-plugin-pwa` for manifest/service worker; deploy on Vercel or Cloudflare Pages.
* Camera: `<input type="file" accept="image/*" capture="environment">` — native camera, no custom camera UI.
* Auth: single real password (or magic link) once per device with a long-lived stored session; no PIN.
* Dashboard: calorie balance (day/week), weight trend vs goal, Garmin metrics (steps, sleep, HRV, body battery, activities), goal status. Weight entry is a simple form (check whether the owner's scale syncs to Garmin Connect — if so it arrives via the pipeline instead).
* Timezone: Pacific/Honolulu everywhere.
Build order

1. Fetch-script migration + `fetch.yml` workflow + JSON backfill → verify data flows into `daily_metrics` (first run should auto-fill the current multi-day gap — that's the migration test).
2. Repoint tips workflow at Supabase; delete `data/daily.json`.
3. PWA skeleton: auth, dashboard reading `daily_metrics`, weight entry + trend chart.
4. Manual meal entry + daily balance view (6am bucketing).
5. Photo flow: upload → Edge Function → vision → confirm screen.
6. Calibration factor + low-log-day flagging.
