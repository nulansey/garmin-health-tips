// Metrics derived from daily_metrics rows. `days` is always newest-first
// (the Dashboard query orders by date desc).

// Percent of sleep spent in each stage; light = remainder. Null without data.
export function sleepStages(day) {
  const total = day.sleep_seconds;
  if (!total) return null;
  const deep = day.deep_sleep_seconds ?? 0;
  const rem = day.rem_sleep_seconds ?? 0;
  const pct = (s) => Math.round((s / total) * 100);
  return {
    deepPct: pct(deep),
    remPct: pct(rem),
    lightPct: pct(Math.max(0, total - deep - rem)),
  };
}

// Hours short of `targetHours`/night over the last `window` days that have
// sleep data. Positive = behind, negative = ahead. Null when no data.
export function sleepDebt(days, targetHours = 7.5, window = 7) {
  const slept = days
    .slice(0, window)
    .map((d) => d.sleep_seconds)
    .filter((s) => s != null);
  if (slept.length === 0) return null;
  const debt = slept.reduce((sum, s) => sum + (targetHours - s / 3600), 0);
  return Math.round(debt * 10) / 10;
}

// Today's value for `key` vs its average over the preceding `baselineDays`.
// Null unless today has a value and the baseline has >= 3 samples.
export function metricTrend(days, key, baselineDays = 30) {
  const today = days[0]?.[key];
  if (today == null) return null;
  const prior = days
    .slice(1, 1 + baselineDays)
    .map((d) => d[key])
    .filter((v) => v != null);
  if (prior.length < 3) return null;
  const avg = Math.round(prior.reduce((a, b) => a + b, 0) / prior.length);
  return { today, avg, delta: today - avg };
}

// Share of today's burn that came from activity. Null without data.
export function activeCalorieRatio(day) {
  if (!day.total_kcal || day.active_kcal == null) return null;
  return Math.round((day.active_kcal / day.total_kcal) * 100);
}

// Total steps over the last `window` days (missing days count 0).
export function weeklySteps(days, window = 7) {
  return days.slice(0, window).reduce((sum, d) => sum + (d.steps ?? 0), 0);
}

// Consecutive days at or above `threshold` steps. Today still in progress
// doesn't break the streak - it just doesn't count until it qualifies.
export function stepStreak(days, threshold = 7500) {
  let streak = (days[0]?.steps ?? 0) >= threshold ? 1 : 0;
  for (let i = 1; i < days.length; i++) {
    if ((days[i].steps ?? 0) >= threshold) streak++;
    else break;
  }
  return streak;
}

// ponytail: naive equal-weight recovery heuristic; revisit weights/scaling if
// it doesn't match how mornings actually feel.
// 0-100 from up to three signals, averaging whichever are available:
// sleep score, body battery recharge (high - low), and resting HR vs the
// 30-day baseline (at baseline = 50, each bpm below adds 5). Null if none.
export function recoveryScore(days) {
  const today = days[0];
  if (!today) return null;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const parts = [];
  if (today.sleep_score != null) parts.push(today.sleep_score);
  if (today.body_battery_high != null && today.body_battery_low != null)
    parts.push(clamp(today.body_battery_high - today.body_battery_low));
  const hr = metricTrend(days, "resting_hr");
  if (hr) parts.push(clamp(50 - hr.delta * 5));
  if (parts.length === 0) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}
