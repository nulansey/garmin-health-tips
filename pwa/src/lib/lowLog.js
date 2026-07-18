export const LOW_LOG_KCAL = 800;
export const LOW_LOG_MIN_MEALS = 2;

export function isLowLog(meals, date) {
  const dayMeals = meals.filter((m) => m.intake_date === date);
  if (dayMeals.length < LOW_LOG_MIN_MEALS) return true;
  const total = dayMeals.reduce((s, m) => s + Number(m.calories), 0);
  return total < LOW_LOG_KCAL;
}
