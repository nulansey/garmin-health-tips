import { describe, it, expect } from "vitest";
import { isLowLog } from "./lowLog.js";

describe("isLowLog", () => {
  it("flags a day with too few meals", () => {
    const meals = [{ intake_date: "2026-07-17", calories: 1500 }];
    expect(isLowLog(meals, "2026-07-17")).toBe(true); // only 1 meal
  });
  it("flags a day with implausibly low total", () => {
    const meals = [
      { intake_date: "2026-07-17", calories: 300 },
      { intake_date: "2026-07-17", calories: 200 },
    ];
    expect(isLowLog(meals, "2026-07-17")).toBe(true); // 500 < 800
  });
  it("does not flag a well-logged day", () => {
    const meals = [
      { intake_date: "2026-07-17", calories: 600 },
      { intake_date: "2026-07-17", calories: 700 },
      { intake_date: "2026-07-17", calories: 500 },
    ];
    expect(isLowLog(meals, "2026-07-17")).toBe(false);
  });
});
