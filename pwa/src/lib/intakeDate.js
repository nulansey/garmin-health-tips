// Today's plain calendar date (YYYY-MM-DD) in Pacific/Honolulu - no 6am shift.
// Matches how fetch.py stamps daily_metrics rows, so a row's `date` can be
// compared against it to tell whether that day is still in progress.
export function calendarDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Honolulu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // en-CA yields YYYY-MM-DD
}

// Returns the 6am->6am intake-day bucket (YYYY-MM-DD) in Pacific/Honolulu.
// A meal before 6am local counts toward the previous calendar day.
export function intakeDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Honolulu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  const hour = Number(get("hour")) % 24; // Intl can emit "24" at midnight
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (hour < 6) dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}
