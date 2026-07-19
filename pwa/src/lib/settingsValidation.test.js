import { describe, it, expect } from "vitest";
import { settingsErrors } from "./settingsValidation.js";

const valid = {
  goal_type: "deficit",
  goal_amount: 500,
  weight_goal_lb: 155,
  slots: {
    morning: { enabled: true, hour: 7 },
    midday: { enabled: true, hour: 13 },
    evening: { enabled: true, hour: 20 },
  },
};

describe("settingsErrors", () => {
  it("returns no errors for valid settings", () => {
    expect(settingsErrors(valid)).toEqual([]);
  });
  it("rejects an out-of-range calorie amount", () => {
    expect(settingsErrors({ ...valid, goal_amount: 3000 }).length).toBeGreaterThan(0);
  });
  it("rejects an out-of-range weight goal", () => {
    expect(settingsErrors({ ...valid, weight_goal_lb: 20 }).length).toBeGreaterThan(0);
  });
  it("rejects all slots disabled", () => {
    const slots = {
      morning: { enabled: false, hour: 7 },
      midday: { enabled: false, hour: 13 },
      evening: { enabled: false, hour: 20 },
    };
    expect(settingsErrors({ ...valid, slots }).length).toBeGreaterThan(0);
  });
  it("rejects two enabled slots at the same hour", () => {
    const slots = {
      morning: { enabled: true, hour: 13 },
      midday: { enabled: true, hour: 13 },
      evening: { enabled: false, hour: 20 },
    };
    expect(settingsErrors({ ...valid, slots }).length).toBeGreaterThan(0);
  });
  it("allows disabled slots to share an hour", () => {
    const slots = {
      morning: { enabled: true, hour: 7 },
      midday: { enabled: false, hour: 7 },
      evening: { enabled: false, hour: 7 },
    };
    expect(settingsErrors({ ...valid, slots })).toEqual([]);
  });
});
