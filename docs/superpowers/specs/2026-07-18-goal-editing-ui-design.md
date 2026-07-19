# Goal-Editing UI — Design Spec

**Date:** 2026-07-18
**Status:** Approved (brainstorming), pending implementation plan
**Scope:** The deferred "goal-editing UI" item from `plan.md`'s build order — editing the calorie goal, tip timing, and weight goal from the PWA.

## Problem

Two things called "goal" in this project live in two disconnected places:
- The **weight goal** (155 lb) is a hardcoded constant in `pwa/src/components/WeightTrendChart.jsx`.
- The **calorie goal** (deficit/maintain/surplus + amount) and **tip timing** (which of the 3 daily slots are enabled, and at what hour) live in `config.yaml`, read only by the Python tips pipeline on each scheduled GitHub Actions run.

The PWA (a browser app) cannot write to `config.yaml` — that requires a git commit, which the retired FastAPI panel did locally on the Mac but a browser-hosted app cannot do without a server-side git-write credential. This spec moves goal + timing settings into Supabase, the same pattern used for every other PWA-editable piece of data this project has migrated (Garmin history, weights, meals).

## Architecture

A new **`settings` table**, exactly one row, becomes the single source of truth for everything this UI edits. Both the PWA and the Python tips pipeline read (and in the PWA's case, write) it directly:

```
PWA (Settings view) ──update──> Supabase settings (1 row) <──read── src/main.py (GitHub Actions)
```

`config.yaml` keeps everything **not** covered by this UI — `timezone`, `tone`, `history_days`, `half_life_days`, `stale_after_days`. Its `goal:` key is removed entirely.

This makes the tips pipeline depend on Supabase for one more field. That is not a new dependency — `daily_metrics` already lives in Supabase and the pipeline already fails the same way (existing top-level exception handler → "Health tips problem" notification) if Supabase is unreachable.

## Data model

```sql
create table settings (
  id int primary key default 1,
  goal_type text not null check (goal_type in ('deficit','maintain','surplus')),
  goal_amount int not null,
  weight_goal_lb numeric not null,
  slots jsonb not null,
  updated_at timestamptz default now()
);
```

- `slots` mirrors the shape `src/main.py`'s `DEFAULT_SLOTS` already uses: `{"morning": {"enabled": true, "hour": 7}, "midday": {"enabled": true, "hour": 13}, "evening": {"enabled": true, "hour": 20}}`.
- **Exactly one row, id fixed at 1.** Created once (via the secret key, during the build) seeded from the current `config.yaml` values (`goal_type: deficit`, `goal_amount: 500`, the current slot defaults) plus `weight_goal_lb: 155` (matching the constant it replaces).
- RLS: owner-scoped `select` and `update` only — no `insert`/`delete` exposed to the PWA. The row is never created or deleted through the app.

## PWA UI

A **Settings view**, toggled from the header via a plain `useState` flag in `App.jsx` (a "⚙️ Settings" button next to Sign out) — no router, since the app only ever needs two screens.

One form, three parts, one Save button that writes the whole row back in a single `update` call:

1. **Calorie goal** — type selector (`deficit`/`maintain`/`surplus`) + amount input. Validated: `0 ≤ amount ≤ 2000`.
2. **Weight goal** — a single number input, lb. Validated: `50 ≤ weight_goal_lb ≤ 500` (sanity bound, not a real constraint).
3. **Tip timing** — three rows (morning/midday/evening), each an enabled checkbox + an hour picker (0–23). Validated: at least one slot must remain enabled; the hours of the *enabled* slots must be distinct (disabled slots' hours don't matter).

`Dashboard.jsx`'s weight chart switches from the hardcoded `GOAL_WEIGHT = 155` constant to reading `weight_goal_lb` from the same settings fetch the Settings view uses — the settings row becomes the one source for the goal line.

Disabling a slot that already fired today has no special handling — `already_sent()` in `main.py` already gates on history regardless of enabled state, so this needs no new logic.

## Python pipeline changes

`src/main.py`:
- New `fetch_settings()` — queries the single `settings` row via Supabase, reusing `fetch.get_client()` (already exists from the Garmin-data migration, needs no new credential).
- `get_slots()` changes signature from taking the whole `config` dict to taking just a `slots` value — same merge-over-`DEFAULT_SLOTS` logic, narrower input.
- `run()`'s calorie-target call switches from `config["goal"]["type"]/["amount"]` to `settings["goal_type"]/["goal_amount"]`.
- `config.yaml` loses its `goal:` key.
- **No new error handling** — a Supabase read failure here propagates to the same top-level `except Exception` in `main()` that already exists and already sends the "Health tips problem" notification.

## Testing

- **JS validation logic** (calorie range, weight range, distinct-hours-among-enabled-slots) is real logic → Vitest coverage, same as every other `pwa/src/lib/` helper this project has built.
- **Python side** is a narrow, mechanical data-source swap — `calorie_target()` itself is untouched and already tested. No new Python tests for the plumbing; verify the existing 38 tests still pass, and manually confirm one live tip run reads the new settings correctly.

## Out of scope

- Editing `timezone`, `tone`, `history_days`, `half_life_days`, `stale_after_days` — these stay in `config.yaml`, unedited by this UI.
- Any UI for creating/deleting the `settings` row — it's a fixed single row, created once during the build.
