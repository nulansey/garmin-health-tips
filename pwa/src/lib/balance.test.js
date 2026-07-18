import { describe, it, expect } from "vitest";
import { dayIntake, sevenDayBalance } from "./balance.js";

describe("dayIntake", () => {
  it("sums calories for the given intake_date only", () => {
    const meals = [
      { intake_date: "2026-07-17", calories: 500 },
      { intake_date: "2026-07-17", calories: 300 },
      { intake_date: "2026-07-16", calories: 900 },
    ];
    expect(dayIntake(meals, "2026-07-17")).toBe(800);
  });
  it("returns 0 when no meals match", () => {
    expect(dayIntake([], "2026-07-17")).toBe(0);
  });
});

describe("sevenDayBalance", () => {
  it("sums burn minus intake over the 7 days ending today", () => {
    const days = [
      { date: "2026-07-17", total_kcal: 2000 },
      { date: "2026-07-16", total_kcal: 2000 },
    ];
    const meals = [
      { intake_date: "2026-07-17", calories: 1500 },
      { intake_date: "2026-07-16", calories: 1800 },
      { intake_date: "2026-07-01", calories: 9999 }, // outside window, ignored
    ];
    // (2000-1500) + (2000-1800) = 700
    expect(sevenDayBalance(days, meals, "2026-07-17")).toBe(700);
  });
});
