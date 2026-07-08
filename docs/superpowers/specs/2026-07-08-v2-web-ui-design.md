# v2 Web UI Design — Local Control Panel with Chat Coach

**Date:** 2026-07-08
**Status:** Approved by user (this session)

## Summary

A local web app (the "control panel") on top of the existing v1 tips pipeline.
It runs on the user's Mac, is reachable from their iPhone on home WiFi (and via
Tailscale later, with no code change), and provides three things:

1. A **dashboard** — recent Garmin data, current goals, latest tips, data freshness.
2. A **goals editor** — calorie goal, sleep/step targets, tip timing — whose
   saves sync to GitHub so the cloud cron picks them up.
3. A **chat coach** — a Gemini-backed chatbot with the user's health data and
   goals in context.

The v1 cloud pipeline (GitHub Actions, 3×/day, Gemini tip → ntfy push) is
untouched except that the tip prompt learns about the new sleep/step targets.

## Decisions made during brainstorming

- **Runs locally** on the Mac; **phone access via LAN now, Tailscale-ready**
  (bind `0.0.0.0`; no auth beyond network privacy — single user, private network).
- **Chat brain: Gemini only** (reuses v1's `GEMINI_API_KEY` free-tier setup).
  LM Studio / local-LLM options were considered and rejected for simplicity.
- **Editable in the UI:** calorie goal (type + amount), sleep target, step
  target, tip timing/frequency. Coach tone stays a `config.yaml`-only setting.
- **Sync model:** saving a goal writes the file(s) locally, then
  `git pull --rebase` → commit → push to `nulansey/garmin-health-tips`. Changes
  take effect on the **next tip cycle**, not instantly. User approved this
  tradeoff (it keeps tips firing while the Mac sleeps).
- **Chat is read-only in v2**: it advises using the data but does not change
  goals. Conversational goal-editing is a possible v3 feature.

## Architecture

- New package `web/` inside this repo. FastAPI + Uvicorn, one process:
  `python -m web` (or a `./coach` launch script).
- Server-rendered pages + a little vanilla JS; no frontend build step. Jinja2
  templates. Mobile-friendly layout (it will mostly be viewed on a phone).
- Reuses v1 modules directly: `src.patterns` (weekday summaries, staleness),
  `src.fetch.load_store`, `src.main.load_config` / `calorie_target`, and the
  Gemini client pattern from `src.analyze`.
- `GEMINI_API_KEY` read from a git-ignored `.env` at the repo root (the web app
  loads it at startup). Never committed.

### Components

| Unit | Purpose | Depends on |
|---|---|---|
| `web/app.py` | FastAPI app, routes, startup | all below |
| `web/dashboard.py` | Assemble dashboard data (snapshot, goals, tips, freshness) | `src.patterns`, `src.fetch`, `history/tips.json` |
| `web/goals.py` | Read/validate/write goal fields in `config.yaml`; rewrite workflow cron lines | `config.yaml`, `.github/workflows/health-tips.yml` |
| `web/gitsync.py` | pull --rebase, commit, push; conflict handling | git CLI |
| `web/chat.py` | Build chat prompt with health context; stream Gemini replies; persist history | `src.patterns`, google-genai |
| `web/templates/`, `web/static/` | UI | — |

## Feature details

### Dashboard (read-only)

- Last ~14 days of key metrics (steps, calories burned, sleep score/duration,
  resting HR, stress) from `data/daily.json`, plus the weighted per-weekday
  averages for "today".
- Current goals as configured.
- Last few tips from `history/tips.json` (note: the cloud cron commits history
  back to the repo; the dashboard shows what's in the local checkout, with a
  "pull latest" refresh action that runs the same gitsync pull).
- Freshness banner reusing `patterns.data_age_days` + `stale_after_days`,
  telling the user to run `/fetch-garmin` when stale.

### Goals editor

- **Calorie goal:** type (`deficit | maintain | surplus`) + amount. Validation:
  amount is a non-negative integer, sane bound (≤ 2000). Maps to existing
  `goal.type` / `goal.amount` in `config.yaml`.
- **Targets (new `targets:` section in `config.yaml`):**
  - `sleep_hours` (float, 4–12, optional)
  - `steps` (int, 1000–50000, optional)
  Both optional; absent = coach doesn't push that target.
- **Timing/frequency:** which of the three slots are enabled, and each slot's
  local (HST) hour. Writes a `slots:` section in `config.yaml` (source of
  truth) **and** rewrites the three `cron:` lines in
  `.github/workflows/health-tips.yml` to match (HST → UTC conversion). A
  disabled slot's cron line is removed; `src/main.py` also checks slot
  enablement so a stray run is a no-op. Validation requires **at least one
  slot enabled** (an empty `schedule:` block would make the workflow invalid).
- On save: validate → write file(s) → gitsync (pull --rebase, commit
  `"config: update goals via web UI"`, push) → confirmation banner: "Saved and
  pushed — live from the next tip."
- Config writes preserve the file as a whole (load YAML, update keys, dump);
  losing the explanatory comments in `config.yaml` is acceptable — the UI
  becomes the primary editing surface. README notes this.

### Chat coach

- Single conversation view. User sends a message; server calls Gemini
  (`gemini-2.5-flash`) with:
  - a system-style preamble: role ("personal health coach for one person"),
    tone from config, current goals/targets, today's calorie target when
    computable;
  - the same pattern context v1 builds (`patterns.pattern_summary`);
  - recent sent tips (so chat and tips don't contradict);
  - the last N chat turns (N ≈ 20) for continuity.
- Replies stream to the page (SSE or chunked fetch).
- History persisted to `history/chat.json`, **git-ignored** (local-only;
  the cloud pipeline never needs it). Trimmed to the last ~200 turns.
- A "clear chat" button.
- Free-tier limits (≈10 RPM) are far above single-user chat usage; on any
  Gemini error show a readable message in the chat and keep the app alive.

### Tips integration (cloud side)

- `src/analyze.build_prompt` gains awareness of `targets:`: when set, the
  prompt tells the model the user's sleep/step goals so tips nudge toward them
  ("you're averaging 6h10m against your 7h goal").
- `src/main.py` reads `slots:` for enablement (default: all enabled if the
  section is absent, so nothing breaks before the first UI save).

## Error handling

- **Gemini failure (chat):** friendly inline error; app keeps running.
- **Git push rejected:** retry once with pull --rebase. If rebase conflicts
  (should be near-impossible: cron only touches `history/tips.json`, UI only
  touches `config.yaml`/workflow), keep the local edit, abort the rebase, and
  show: "Saved locally but couldn't push — run git status in the repo." Never
  lose a local edit silently.
- **Invalid form input:** rejected server-side with a clear message; nothing
  written.
- **Store/config missing or malformed:** dashboard renders what it can with a
  visible warning instead of a 500 page.

## Phone access

- Uvicorn binds `0.0.0.0:8787`. On home WiFi: `http://<mac-name>.local:8787`.
- Tailscale: install on Mac + iPhone, use the Mac's Tailscale name — zero code
  change. README gets a short section with both.
- No auth in v2 (single user, private networks only). README warns against
  port-forwarding it to the open internet.

## Testing

pytest, same style as v1:

- `goals.py`: validation matrix; YAML round-trip writes; cron rewrite
  (HST→UTC math, slot disable removes the line, workflow file stays valid YAML).
- `chat.py`: prompt building (context, goals, history trimming) with the
  Gemini call mocked.
- `dashboard.py`: assembly against a fixture store; stale/empty cases.
- `gitsync.py`: against a throwaway local bare repo (init in tmp, push/pull
  cycle, simulated reject).
- `src/analyze.py` / `src/main.py`: extended for targets and slot enablement.
- Manual smoke test: launch script, phone on LAN, one chat exchange, one goal
  save reaching GitHub.

## Build phases (for the implementation plan)

1. **Skeleton + dashboard** — FastAPI app, launch script, dashboard page,
   LAN access. Read-only; independently useful.
2. **Goals editor (calorie + targets)** — forms, validation, config write,
   gitsync; extend tip prompt for targets.
3. **Timing editor** — slots UI, cron rewrite, slot enablement in `main.py`.
4. **Chat coach** — streaming chat, context assembly, local history.
5. **Polish** — error states, README (launch, phone, Tailscale), full test
   pass, final smoke test.

## Out of scope (deliberately)

- Chat changing goals conversationally (v3 candidate).
- Auth/multi-user, HTTPS, public hosting.
- Automating the Garmin data fetch (stays manual via `/fetch-garmin`).
- Charts/graphing libraries — v2 dashboard is tables/numbers; visual charts
  can come later if wanted.
