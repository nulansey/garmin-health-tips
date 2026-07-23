import { describe, it, expect } from "vitest";
import { intakeDate, calendarDate } from "./intakeDate.js";

// Honolulu is UTC-10. 02:00 HST on 2026-07-17 == 12:00 UTC same day.
// 14:00 HST on 2026-07-17 == 00:00 UTC on 2026-07-18.
describe("intakeDate", () => {
  it("buckets pre-6am HST to the previous day", () => {
    expect(intakeDate(new Date("2026-07-17T12:00:00Z"))).toBe("2026-07-16");
  });
  it("buckets 6am HST exactly to the same day", () => {
    // 06:00 HST == 16:00 UTC
    expect(intakeDate(new Date("2026-07-17T16:00:00Z"))).toBe("2026-07-17");
  });
  it("buckets afternoon HST to the same day", () => {
    expect(intakeDate(new Date("2026-07-18T00:00:00Z"))).toBe("2026-07-17");
  });
});

describe("calendarDate", () => {
  it("returns the Hawaii calendar day, no 6am shift", () => {
    // 02:00 HST on 07-17 - intakeDate would bucket this to 07-16, calendar does not.
    expect(calendarDate(new Date("2026-07-17T12:00:00Z"))).toBe("2026-07-17");
  });
  it("rolls at Hawaii midnight, not UTC midnight", () => {
    // 00:00 UTC 07-18 is still 14:00 HST 07-17.
    expect(calendarDate(new Date("2026-07-18T00:00:00Z"))).toBe("2026-07-17");
    // 10:00 UTC 07-18 == 00:00 HST 07-18.
    expect(calendarDate(new Date("2026-07-18T10:00:00Z"))).toBe("2026-07-18");
  });
});
