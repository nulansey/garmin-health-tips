import { describe, it, expect } from "vitest";
import { rollingAvg, calibrationFactor } from "./calibration.js";

describe("rollingAvg", () => {
  it("averages weigh-ins within the trailing window", () => {
    const weights = [
      { measured_at: "2026-07-10T12:00:00Z", weight: 170 },
      { measured_at: "2026-07-16T12:00:00Z", weight: 168 },
    ];
    expect(rollingAvg(weights, "2026-07-16", 7)).toBe(169);
  });
  it("returns null with no weigh-ins in window", () => {
    expect(rollingAvg([], "2026-07-16", 7)).toBe(null);
  });
});

describe("calibrationFactor", () => {
  it("computes factor from predicted vs actual over the window", () => {
    // 21 days, each burn 2000, intake 1500 (well-logged: 3 meals of 500).
    // Predicted balance = 21 * 500 = 10500 kcal deficit -> 3.0 lb predicted loss.
    // Weight: rolling avg drops from 170 (start window) to 168.5 (end) -> 1.5 lb actual loss.
    // factor = 3.0 / 1.5 = 2.0
    const dates = [];
    for (let i = 0; i < 21; i++) {
      const d = new Date("2026-07-21T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
    const days = dates.map((date) => ({ date, total_kcal: 2000 }));
    const meals = dates.flatMap((date) => [
      { intake_date: date, calories: 500 },
      { intake_date: date, calories: 500 },
      { intake_date: date, calories: 500 },
    ]);
    const weights = [
      { measured_at: "2026-07-01T12:00:00Z", weight: 170 },
      { measured_at: "2026-07-21T12:00:00Z", weight: 168.5 },
    ];
    const r = calibrationFactor({ days, meals, weights, endDate: "2026-07-21" });
    expect(r.predictedLb).toBeCloseTo(3.0, 1);
    expect(r.actualLb).toBeCloseTo(1.5, 1);
    expect(r.factor).toBeCloseTo(2.0, 1);
    expect(r.usableDays).toBe(21);
  });

  it("returns null when there is too little usable data", () => {
    const r = calibrationFactor({ days: [], meals: [], weights: [], endDate: "2026-07-21" });
    expect(r).toBe(null);
  });
});
