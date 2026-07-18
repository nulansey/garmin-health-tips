import { dayIntake } from "./balance.js";
import { isLowLog } from "./lowLog.js";

export const CALIBRATION_WINDOW_DAYS = 21;
export const KCAL_PER_LB = 3500;

export function rollingAvg(weights, date, windowDays = 7) {
  const end = new Date(date + "T23:59:59Z").getTime();
  const start = end - windowDays * 86400000;
  const inWindow = weights.filter((w) => {
    const t = new Date(w.measured_at).getTime();
    return t > start && t <= end;
  });
  if (inWindow.length === 0) return null;
  return inWindow.reduce((s, w) => s + Number(w.weight), 0) / inWindow.length;
}

function windowDates(endDate, n) {
  const end = new Date(endDate + "T00:00:00Z");
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out; // newest first
}

export function calibrationFactor({ days, meals, weights, endDate }) {
  const burnByDate = Object.fromEntries(days.map((d) => [d.date, d.total_kcal ?? 0]));
  const dates = windowDates(endDate, CALIBRATION_WINDOW_DAYS);

  let predictedKcal = 0;
  let usableDays = 0;
  for (const date of dates) {
    if (isLowLog(meals, date)) continue; // exclude untrustworthy days
    predictedKcal += (burnByDate[date] ?? 0) - dayIntake(meals, date);
    usableDays++;
  }
  if (usableDays < 7) return null;

  const startDate = dates[dates.length - 1];
  const startAvg = rollingAvg(weights, startDate);
  const endAvg = rollingAvg(weights, endDate);
  if (startAvg == null || endAvg == null) return null;

  const predictedLb = predictedKcal / KCAL_PER_LB;      // + = predicted loss
  const actualLb = startAvg - endAvg;                    // + = actual loss
  if (Math.abs(actualLb) < 0.2) return null;             // trend too flat to divide

  return {
    factor: predictedLb / actualLb,
    predictedLb,
    actualLb,
    usableDays,
  };
}
