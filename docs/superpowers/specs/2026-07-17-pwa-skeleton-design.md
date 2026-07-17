# PWA Skeleton — Design Spec

**Date:** 2026-07-17
**Status:** Approved (brainstorming), pending implementation plan
**Scope:** Build order step 3 of `plan.md` — "PWA skeleton: auth, dashboard reading `daily_metrics`, weight entry + trend chart."

This is the first phase of the React PWA described in `plan.md`. It stands up
the app shell, authentication, the Garmin dashboard (read), and manual weight
entry with a trend chart (write). It deliberately stops short of meals,
calorie balance, and the photo/vision flow — those are later phases.

## Goal

A phone-installable Progressive Web App that, for the owner only:
- authenticates via Supabase magic link (persisted session, ~once per device);
- reads Garmin history from the `daily_metrics` Supabase table and shows the
  daily numbers;
- lets the owner enter weight, stores it in the `weights` table, and plots a
  weight trend against a goal line.

## Non-goals (this phase)

- No meals, no calorie balance view (needs the `meals` table — phase 4). Showing
  burn without intake would imply a balance that does not yet exist.
- No photo/vision flow (phase 5).
- No goal-editing UI — goal weight is a hardcoded constant this phase (155 lbs).
- No changes to `src/` (Python fetch/tips) or `web/` (the existing FastAPI
  panel). The FastAPI panel keeps running; the PWA replaces it in a later phase.
- No changes to `src/garmin.py` — weight is entered manually, not fetched.
- No JS unit-test harness (see Testing).

## Architecture

New self-contained `pwa/` directory at the repo root — its own `package.json`,
`node_modules`, and Vite toolchain, sharing nothing with the Python code except
Supabase and the git repo. The deploy platform points at `pwa/` as its root.

```
garmin-health-tips/
  src/         Python: fetch, tips — unchanged
  web/         Python: existing FastAPI panel — untouched this phase
  pwa/         NEW — the React PWA
    package.json, vite.config.js, index.html
    .env.local          VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (gitignored)
    src/
      main.jsx, App.jsx
      supabaseClient.js
      pages/       Login.jsx, Dashboard.jsx
      components/  WeightForm.jsx, WeightTrendChart.jsx
```

**Stack:** React + Vite, Recharts (charts), `vite-plugin-pwa` (manifest +
service worker), `@supabase/supabase-js` (data + auth). Node 22 / npm already
present.

**Keys:** `pwa/.env.local` holds the Supabase URL and the **publishable/anon**
key (`sb_publishable_...`) only. The secret key never appears in frontend code;
it stays server-side in GitHub Actions. `pwa/.env.local` and `pwa/node_modules`
are gitignored.

## Authentication & access control

Supabase Auth (magic link). The security concern: Supabase allows new signups
by default, so an RLS policy gated only on `auth.role() = 'authenticated'`
would let *anyone* who requests a magic link read the owner's health data.
Two layers guard against this:

1. **Disable new signups** in the Supabase dashboard (Auth → Providers → Email
   → "Allow new users to sign up" = off), after the owner's user exists.
   Manual dashboard step, owner-driven.
2. **RLS policies gate on the owner's specific user id** (`auth.uid() =
   '<owner-uuid>'`), not merely "authenticated" — so even if signups were
   re-enabled by accident, a stranger's session reads nothing.

Policies needed this phase (owner provides the SQL to the Supabase SQL editor;
assistant writes it):
- `daily_metrics`: `select`
- `weights`: `select`, `insert`

No policies on `meals` this phase (untouched table). Server-side writes from
Actions use the secret key, which bypasses RLS entirely and is unaffected.

## Data flow

**Auth:** App loads → check for existing Supabase session. None → Login page
(email + "send magic link"). Owner clicks emailed link → returns authenticated,
session persisted to localStorage by `supabase-js`. Session present → Dashboard.

**Read:** Dashboard mounts → two anon-client queries, both RLS-gated:
`daily_metrics` (last ~90 days) and `weights` (all rows). RLS returns only the
owner's rows; a stranger's session gets empty results, not an error.

**Write:** Weight form → `insert` one row into `weights` (`measured_at` = now,
`weight` = entered number) → on success, re-query `weights` so the chart
updates. No optimistic UI, no offline queue (owner is on wifi at weigh-in).

## What the dashboard renders (this phase)

- **Weight trend chart:** 7-day rolling average as the primary line, raw
  weigh-ins as faint dots, goal weight as a horizontal reference line
  (`plan.md` decision #5). Goal weight is a hardcoded constant this phase:
  **155 lbs**. Weight is entered and displayed in pounds.
- **Garmin daily numbers** from `daily_metrics`: steps, resting HR, sleep,
  body battery, and today's calories-burned labeled in-progress (`plan.md` #7).
- **No calorie balance** (needs meals — phase 4).

## Error handling

- Read query fails → inline "couldn't load data" with a retry, not a blank
  screen.
- Insert fails → form shows the error and keeps the typed value.
- Magic-link / auth error → back to Login with a message.
- No global crash boundary beyond React's default this phase.

## Testing

No JS unit-test harness this phase. A login-gated skeleton is mostly framework
wiring; React Testing Library over components that mainly render Supabase data
has a poor effort-to-value ratio. Real logic (6am meal bucketing in phase 4,
calibration factor in phase 6) gets proper tests when it arrives. Verification
this phase is the browser-driven end-to-end check below.

## Done-when (phase acceptance)

1. `npm run build` succeeds and emits the PWA service worker + manifest
   (`sw.js` and `manifest.webmanifest` in the build output) — this is what
   makes it a PWA rather than a plain page.
2. Locally (`npm run dev`), logged in as the owner: the dashboard shows the
   real Garmin data (currently 38 days) and the weight chart renders.
3. Entering a weight persists it (visible in Supabase; chart updates on
   re-query).
4. Verified by driving the running app in a browser, not by asserting the
   build passed.

## Manual steps owned by the user (not the assistant)

- Disable new signups in the Supabase dashboard after the owner's user exists.
- Run the assistant-provided RLS policy SQL in the Supabase SQL editor.
- Choose and connect a deploy target (Vercel recommended, or Cloudflare Pages);
  both serve a static Vite build from the `pwa/` subdirectory for free. The
  skeleton builds and runs locally regardless of choice.

## Deferred to later phases

- Meals + 6am-bucketed calorie balance (phase 4).
- Photo → Edge Function → vision → confirm screen (phase 5).
- Calibration factor + low-log-day flagging (phase 6).
- Goal-weight editing (settings) and retiring the FastAPI `web/` panel.
