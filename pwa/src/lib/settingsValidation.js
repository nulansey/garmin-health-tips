const SLOT_NAMES = ["morning", "midday", "evening"];

export function settingsErrors(s) {
  const errors = [];

  if (!Number.isInteger(s.goal_amount) || s.goal_amount < 0 || s.goal_amount > 2000) {
    errors.push("Calorie amount must be a whole number between 0 and 2000.");
  }
  if (!(s.weight_goal_lb >= 50 && s.weight_goal_lb <= 500)) {
    errors.push("Weight goal must be between 50 and 500 lb.");
  }

  const enabled = SLOT_NAMES.filter((n) => s.slots[n]?.enabled);
  if (enabled.length === 0) {
    errors.push("At least one tip time must stay enabled.");
  }
  for (const n of enabled) {
    const h = s.slots[n].hour;
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      errors.push(`${n} hour must be between 0 and 23.`);
    }
  }
  const hours = enabled.map((n) => s.slots[n].hour);
  if (new Set(hours).size !== hours.length) {
    errors.push("Enabled tip times must be at different hours.");
  }

  return errors;
}
