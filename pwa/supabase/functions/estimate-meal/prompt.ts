// Builds the user text block for the meal vision call.
//
// Plain TypeScript with no Deno APIs on purpose: vitest imports this exact
// file, so the shipped code is the tested code (see prompt.test.ts).

export const MAX_NAME = 200;

export const DEFAULT_PROMPT = "Estimate the calories in this meal.";

/** Trim, treat blank or non-string as absent, cap length. */
export function normalizeName(name: unknown): string {
  if (typeof name !== "string") return "";
  return name.trim().slice(0, MAX_NAME);
}

/**
 * With no usable name this returns the original prompt unchanged, so a
 * first-time estimate behaves exactly as it always has.
 *
 * With a name, the owner's text is ground truth for WHAT the food is and the
 * photo is reduced to judging HOW MUCH - that is what makes correcting a
 * misidentified food actually move the number. The name goes here, in the
 * user turn, never into the system prompt where it could displace the
 * plate/bowl portion-size instructions.
 */
export function mealPrompt(name: unknown): string {
  const clean = normalizeName(name);
  if (!clean) return DEFAULT_PROMPT;
  return [
    `The owner says the food in this photo is: ${clean}`,
    "",
    "Trust that identification over your own reading of the image, even if",
    "the food looks like something else. Use the photo only to judge portion",
    "size, then estimate the calories for that food at that portion.",
  ].join("\n");
}
