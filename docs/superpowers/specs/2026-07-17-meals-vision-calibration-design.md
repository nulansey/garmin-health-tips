# Meals, Vision & Calibration — Design Spec

**Date:** 2026-07-17
**Status:** Approved (brainstorming), pending implementation plan
**Scope:** Build-order steps 4–6 of `plan.md` — manual meal entry + calorie balance (phase 4), the photo/vision flow (phase 5), and the calibration factor + low-log-day flagging (phase 6).

This spec covers the whole remaining scope of the PWA as three sequential phases built on the skeleton delivered in `2026-07-17-pwa-skeleton-design.md`. The phases share the same Supabase database and the same React PWA; each builds on the previous. **Recommended execution is one phase at a time**, each verified before the next — this document is the destination map, not a single-session mandate.

## Shared context (all three phases)

- **Stack:** the existing `pwa/` React + Vite app (auth, dashboard, weight chart already built). Supabase for data. Anthropic Claude for vision (phase 5 only).
- **Day boundary:** intake days run **6am→6am local** (Pacific/Honolulu) — a meal eaten before 6am counts toward the previous day (`plan.md` decision #2). Garmin metrics stay calendar-day; the minor window mismatch is accepted.
- **Tables already exist** (from the migration/skeleton work): `meals` (id, eaten_at timestamptz, intake_date date, name, calories int, source 'photo'|'manual', created_at) and `weights` (id, measured_at, weight). `daily_metrics` supplies burn. No schema changes are required for any phase; RLS policies are added per phase as new access is needed.
- **Burn source:** Garmin `total_kcal` from `daily_metrics` is the single source of calories out — never add a separate BMR estimate (`plan.md` decision #1).
- **Timezone:** Pacific/Honolulu everywhere.

---

## Phase 4 — Manual meal entry + calorie balance

### Goal
Log meals by hand and see the day's calorie balance (burn − intake), with intake bucketed by the 6am rule.

### Data flow
- **Write:** a meal form (name + calories) inserts one `meals` row with `source: 'manual'`, `eaten_at` = now, and `intake_date` computed by the 6am rule at insert time (before 6am local → previous calendar date; otherwise today's date).
- **Read:** the dashboard queries today's `meals` (by `intake_date`) and today's `daily_metrics` row, and shows:
  - Calories in (sum of today's meal calories)
  - Calories out (Garmin `total_kcal`, labeled in-progress per `plan.md` #7)
  - Balance (out − in) for the day, and a rolling 7-day balance summary
- **Edit/delete:** each meal row gets a delete button (delete + re-add covers correction — no edit form this phase; YAGNI). Deleting re-queries so the balance updates.

### The 6am bucketing rule
`intake_date` is computed once, at insert, in Pacific/Honolulu: if the local hour is < 6, `intake_date` = (local date − 1 day); else local date. Stored on the row so all later reads group by a fixed value and never recompute the window. This is the one piece of non-trivial logic in phase 4 and gets a runnable check.

### RLS
Add owner-scoped `select`, `insert`, and `delete` policies on `meals`, gated on the owner's `auth.uid()` (same pattern and UUID as the skeleton's `weights` policies).

### What phase 4 does NOT include
No photo flow, no calibration, no goal-editing UI. The per-day calorie *target* (from `config.yaml`'s deficit goal) may be shown for reference but is not editable here.

### Done-when
1. Entering a meal persists it with the correct `intake_date` (a meal logged at 2am local lands on the previous day; a 2pm meal lands on today).
2. The dashboard shows calories in / out / balance for today and a 7-day balance.
3. Deleting a meal updates the balance.
4. Verified by driving the running app in a browser.

---

## Phase 5 — Photo → vision → calorie estimate

### Goal
Log a meal by photographing it: a vision model estimates the dish and calories, the owner confirms/adjusts, and only name + calories are saved.

### Model & cost
- **Vision model:** `claude-haiku-4-5` (input $1/M tokens, output $5/M). A resized photo (~1,500 tokens) plus a short structured reply costs roughly **$0.002–$0.005 per photo**. If accuracy proves insufficient, `claude-sonnet-5` is a one-line swap — start at Haiku.
- **Cost cap (two layers, both required):**
  1. Hard: a monthly USD spend limit on the Anthropic API key, set in the Anthropic Console (~$5/mo). Provider-enforced, un-bypassable. Owner-set, manual.
  2. Soft: the Edge Function tracks a per-day photo count in Supabase and refuses past ~20/day.

### Architecture
- **Supabase Edge Function** (Deno/TypeScript) holds `ANTHROPIC_API_KEY` as a Supabase secret and makes the Anthropic call server-side. The PWA sends the resized image to the Edge Function; the image never goes from the browser to Anthropic directly, and the API key never reaches the browser.
- **Client-side resize:** the PWA downscales the photo before upload (no 12MP originals).
- **Structured output:** the Edge Function requests guaranteed-parseable JSON from Claude — `{ items: [{ name, estimated_calories }], total_calories }` — via Claude's structured-outputs feature, using a prompt that includes the owner's plate/bowl dimensions for portion scale.

### Data flow
Photo (camera via `<input type="file" accept="image/*" capture="environment">`) → client resize → POST to Edge Function → Claude vision → structured JSON back to the PWA → **mandatory confirm/adjust screen** → on confirm, insert one `meals` row with `source: 'photo'` (same insert path and 6am bucketing as phase 4). Nothing is saved without confirmation.

### Photo retention
**Photos are never stored** (`plan.md` decision #3). The image lives in memory for the duration of the request and is discarded; only name + calories persist.

### Accuracy expectation
Vision estimates are ±30–50% on real meals — a convenience layer, not ground truth. Weight trend (phase 6) is the ground truth that corrects for the systematic bias.

### Owner-provided input (at build time)
The owner's usual plate and bowl diameters, for the portion-scale prompt. Flagged now; collected when phase 5 is built.

### Done-when
1. Taking/uploading a photo returns a name + calorie estimate on a confirm screen.
2. Confirming saves a `meals` row with `source: 'photo'`; adjusting the number before confirm saves the adjusted value.
3. The API key is never present in browser-delivered code (it lives only in the Edge Function).
4. The per-day cap rejects the 21st photo of a day.
5. Verified by driving the running app in a browser.

---

## Phase 6 — Calibration factor + low-log-day flagging

### Goal
Surface the owner's personal logging-bias correction factor by comparing predicted calorie balance against actual weight-trend change, and flag days whose logs are too incomplete to trust.

### Calibration factor
- Over a trailing 2–3 week window (default 21 days; adjustable), compute:
  - **Predicted balance:** sum of daily (`total_kcal` − logged intake) across the window.
  - **Actual change:** the change in the 7-day rolling weight average across the window (the same rolling average the chart already computes).
- Bridge with ~3,500 kcal ≈ 1 lb: expected weight change = predicted balance / 3,500. Compare to actual. The ratio is the correction factor (e.g. actual loss half of predicted → factor ≈ 2.0 → "you likely eat ~X% more than you log").
- **Display only, never silently applied:** the raw logged numbers always remain visible; the corrected estimate is shown alongside, clearly labeled. The owner is never shown a single "true" number that hides the correction.

### Low-log-day flagging
- A day is flagged low-log when its logged intake is implausibly low (below a calorie threshold) or it has fewer than a minimum number of meals (defaults; adjustable).
- Flagged days are **excluded from the calibration window** (otherwise a forgotten lunch reads as a large deficit and poisons the factor) and are **surfaced on the dashboard** so the owner knows that day's balance isn't trustworthy.

### Why last / thresholds
Calibration needs weeks of real phase-4/5 data before it means anything, so it can only be verified once that data exists. Its window length and low-log thresholds are tuned in use — the plan specifies sensible defaults and marks them adjustable rather than claiming an up-front-perfect value.

### Data & API
Pure computation over `meals`, `weights`, and `daily_metrics` already present. No new tables, no new external calls, no new user input.

### Done-when
1. Given a window of real data, the app computes and displays a correction factor alongside the raw balance.
2. A day with implausibly low logged intake is flagged on the dashboard and excluded from the calibration computation.
3. The calibration math has a runnable check against a known synthetic window (predicted vs actual → expected factor).
4. Verified by driving the running app in a browser once sufficient data exists.

## Manual steps owned by the user (across phases)

- Run the assistant-provided RLS SQL for `meals` (phase 4).
- Set the Anthropic API key as a Supabase Edge Function secret, and set the monthly spend limit in the Anthropic Console (phase 5).
- Provide plate/bowl diameters for the portion-scale prompt (phase 5).
- Deploy the Edge Function to Supabase (phase 5).

## Deferred / out of scope for these three phases
- Goal-editing UI (calorie/sleep/step targets, tip timing) and retiring the FastAPI `web/` panel — later work, tracked in `plan.md`.
- Any change to the Python tips pipeline (`src/`) or the Garmin fetch — untouched.
