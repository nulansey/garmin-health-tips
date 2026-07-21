// Helpers for the editable meal item list. Calorie fields arrive as strings
// from number inputs and are routinely blank mid-edit, so everything here
// tolerates partial input rather than assuming clean numbers.

function calorieValue(item) {
  const n = Number(item?.calories);
  return Number.isFinite(n) ? n : 0;
}

function isBlank(item) {
  return !String(item?.name ?? "").trim() && String(item?.calories ?? "").trim() === "";
}

/** Sum of the item calories. Blank or junk fields count as zero. */
export function itemsTotal(items) {
  return (items ?? []).reduce((sum, it) => sum + calorieValue(it), 0);
}

/**
 * The array as persisted: blank rows dropped, calories coerced to numbers,
 * and the client-side `key` stripped - it exists only to keep React row
 * identity stable and means nothing in the database.
 */
export function itemsForSave(items) {
  return (items ?? [])
    .filter((it) => !isBlank(it))
    .map((it) => ({
      name: String(it.name ?? "").trim(),
      calories: calorieValue(it),
      reasoning: it.reasoning ?? null,
    }));
}

/**
 * True when some row has a name but no calories. Such a row would silently
 * contribute zero to the total, so saving is blocked on it.
 */
export function hasIncompleteItem(items) {
  return (items ?? []).some(
    (it) => String(it?.name ?? "").trim() !== "" && String(it?.calories ?? "").trim() === "",
  );
}

export function blankItem(key) {
  return { key, name: "", calories: "", reasoning: null };
}

/**
 * Fill in a nameless row's name from the meal name.
 *
 * Runs on save-shape rows (after itemsForSave), never before it: applying a
 * fallback first would give a fully blank row a name and resurrect it into the
 * saved list instead of dropping it.
 *
 * This is what keeps the fast path fast - meal name plus one calorie number,
 * without separately naming the single item.
 */
export function withFallbackName(rows, fallback) {
  return (rows ?? []).map((r) => ({
    ...r,
    name: String(r.name ?? "").trim() || fallback,
  }));
}
