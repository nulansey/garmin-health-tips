export function dayIntake(meals, date) {
  return meals
    .filter((m) => m.intake_date === date)
    .reduce((sum, m) => sum + Number(m.calories), 0);
}

// Balance = burn - intake, summed over the 7 intake-dates ending at `today`.
// Garmin burn is calendar-day; intake is 6am-bucketed. The minor window
// mismatch is accepted (see spec decision #2).
export function sevenDayBalance(days, meals, today) {
  const burnByDate = Object.fromEntries(days.map((d) => [d.date, d.total_kcal ?? 0]));
  const end = new Date(today + "T00:00:00Z");
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    total += (burnByDate[iso] ?? 0) - dayIntake(meals, iso);
  }
  return total;
}
