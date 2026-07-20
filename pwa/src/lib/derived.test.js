import { describe, it, expect } from "vitest";
import {
  sleepStages,
  sleepDebt,
  metricTrend,
  activeCalorieRatio,
  weeklySteps,
  stepStreak,
  recoveryScore,
} from "./derived.js";

const day = (over = {}) => ({
  sleep_seconds: null,
  deep_sleep_seconds: null,
  rem_sleep_seconds: null,
  sleep_score: null,
  resting_hr: null,
  avg_stress: null,
  steps: null,
  total_kcal: null,
  active_kcal: null,
  body_battery_high: null,
  body_battery_low: null,
  ...over,
});

describe("sleepStages", () => {
  it("splits into deep/rem/light percentages", () => {
    const s = sleepStages(day({ sleep_seconds: 28800, deep_sleep_seconds: 7200, rem_sleep_seconds: 7200 }));
    expect(s).toEqual({ deepPct: 25, remPct: 25, lightPct: 50 });
  });
  it("null without sleep data", () => {
    expect(sleepStages(day())).toBeNull();
  });
});

describe("sleepDebt", () => {
  it("sums shortfall vs 7.5h over days with data, skipping gaps", () => {
    const days = [
      day({ sleep_seconds: 6.5 * 3600 }), // 1h short
      day(), // no data - skipped
      day({ sleep_seconds: 8 * 3600 }), // 0.5h ahead
    ];
    expect(sleepDebt(days)).toBe(0.5);
  });
  it("null when no sleep data at all", () => {
    expect(sleepDebt([day(), day()])).toBeNull();
  });
});

describe("metricTrend", () => {
  const days = [
    day({ resting_hr: 52 }),
    day({ resting_hr: 55 }),
    day({ resting_hr: 56 }),
    day({ resting_hr: 54 }),
  ];
  it("compares today against the prior average", () => {
    expect(metricTrend(days, "resting_hr")).toEqual({ today: 52, avg: 55, delta: -3 });
  });
  it("null with under 3 baseline samples", () => {
    expect(metricTrend(days.slice(0, 3), "resting_hr")).toBeNull();
  });
  it("null when today has no value", () => {
    expect(metricTrend([day(), ...days], "resting_hr")).toBeNull();
  });
});

describe("activeCalorieRatio", () => {
  it("active share of total burn", () => {
    expect(activeCalorieRatio(day({ total_kcal: 2500, active_kcal: 850 }))).toBe(34);
  });
  it("null without totals", () => {
    expect(activeCalorieRatio(day())).toBeNull();
  });
});

describe("weeklySteps / stepStreak", () => {
  const days = [
    day({ steps: 3000 }), // today, in progress, below threshold
    day({ steps: 9000 }),
    day({ steps: 8000 }),
    day({ steps: 2000 }),
    day({ steps: 9000 }),
  ];
  it("sums the last 7 days", () => {
    expect(weeklySteps(days)).toBe(31000);
  });
  it("today below threshold doesn't break the streak", () => {
    expect(stepStreak(days)).toBe(2);
  });
  it("today above threshold extends the streak", () => {
    expect(stepStreak([day({ steps: 8000 }), ...days.slice(1)])).toBe(3);
  });
});

describe("recoveryScore", () => {
  it("averages available components", () => {
    // sleep 80, recharge 90-30=60, no HR baseline -> (80+60)/2 = 70
    const days = [day({ sleep_score: 80, body_battery_high: 90, body_battery_low: 30 })];
    expect(recoveryScore(days)).toBe(70);
  });
  it("includes resting HR vs baseline when available", () => {
    const days = [
      day({ sleep_score: 80, resting_hr: 52 }),
      day({ resting_hr: 55 }),
      day({ resting_hr: 56 }),
      day({ resting_hr: 54 }),
    ];
    // sleep 80, hr: 50 - (-3)*5 = 65 -> (80+65)/2 = 72.5 -> 73
    expect(recoveryScore(days)).toBe(73);
  });
  it("null with no signals", () => {
    expect(recoveryScore([day()])).toBeNull();
  });
});
