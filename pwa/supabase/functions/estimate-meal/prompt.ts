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

// Owner's usual crockery, used as the scale reference in photos.
export const PLATE_CM = 27;
export const BOWL_CM = 15;

/**
 * Calorie density reference, kcal per 100 g of the food as eaten.
 *
 * Deliberately weighted toward fats, oils, and dense starches: those dominate
 * estimation error. A tablespoon of oil is ~120 kcal and nearly invisible in a
 * photo, while precision on broccoli cannot move a daily total. This is a
 * reference, not a whitelist - foods absent from it are estimated from the
 * model's own knowledge, as they were before this table existed.
 *
 * Generic on purpose: there is not yet enough logging history to tailor it.
 * Extending it is a one-line edit.
 */
export const DENSITIES: { name: string; kcal100g: number }[] = [
  // Fats and oils - the largest error source
  { name: "olive oil", kcal100g: 884 },
  { name: "butter", kcal100g: 717 },
  { name: "mayonnaise", kcal100g: 680 },
  { name: "peanut butter", kcal100g: 588 },
  { name: "almonds", kcal100g: 579 },
  { name: "cheddar cheese", kcal100g: 403 },
  { name: "avocado", kcal100g: 160 },
  // Dense starches
  { name: "white rice", kcal100g: 130 },
  { name: "brown rice", kcal100g: 123 },
  { name: "pasta", kcal100g: 131 },
  { name: "bread", kcal100g: 265 },
  { name: "tortilla", kcal100g: 310 },
  { name: "potato", kcal100g: 87 },
  { name: "sweet potato", kcal100g: 90 },
  { name: "french fries", kcal100g: 312 },
  { name: "tortilla chips", kcal100g: 489 },
  { name: "oats", kcal100g: 389 },
  // Proteins - cut matters, so name several
  { name: "chicken breast", kcal100g: 165 },
  { name: "chicken thigh", kcal100g: 209 },
  { name: "ground beef", kcal100g: 250 },
  { name: "steak", kcal100g: 271 },
  { name: "pork chop", kcal100g: 231 },
  { name: "bacon", kcal100g: 541 },
  { name: "sausage", kcal100g: 301 },
  { name: "lamb", kcal100g: 294 },
  { name: "salmon", kcal100g: 208 },
  { name: "white fish", kcal100g: 96 },
  { name: "shrimp", kcal100g: 99 },
  { name: "egg", kcal100g: 143 },
  { name: "tofu", kcal100g: 76 },
  // Low-density, low-stakes - a handful only
  { name: "broccoli", kcal100g: 34 },
  { name: "mixed salad greens", kcal100g: 17 },
  { name: "corn", kcal100g: 86 },
  { name: "banana", kcal100g: 89 },
  { name: "apple", kcal100g: 52 },
  { name: "beer", kcal100g: 43 },
];

/**
 * The system prompt for every meal estimate.
 *
 * Lives here rather than in index.ts so it is covered by tests. The density
 * table gives the model a fixed number to multiply against instead of
 * recalling a total from impression, and the three-step method forces it to
 * commit to a portion size before it can produce a calorie figure - which is
 * what makes the per-item reasoning field an accuracy feature rather than a
 * display one.
 *
 * `photo: false` drops the plate and bowl sentences: without an image they are
 * meaningless, and leaving them in invites the model to reason about a plate
 * that does not exist. Portion estimation leans on stated quantities instead.
 * Defaults to photo mode so existing callers are unaffected.
 */
export function systemPrompt({ photo = true }: { photo?: boolean } = {}): string {
  const table = DENSITIES.map((d) => `- ${d.name}: ${d.kcal100g} kcal per 100 g`).join("\n");
  const opening = photo
    ? [
        "You estimate calories from a photo of a meal.",
        "",
        `The owner's usual dinner plate is ${PLATE_CM} cm across and their usual bowl is ${BOWL_CM} cm across - use them to judge portion size.`,
      ]
    : [
        "You estimate calories from a written description of a meal.",
        "",
        "There is no photo. Judge portion size from any stated quantity or count in the description; where none is given, assume a typical single serving.",
      ];
  const sizingStep = photo
    ? "2. Estimate its portion in grams, using the plate and bowl above for scale."
    : "2. Estimate its portion in grams from the stated quantity, or a typical serving if none is stated.";
  return [
    ...opening,
    "Estimate generously rather than low; real portions are usually bigger than they look.",
    "",
    "For each food, work in three steps:",
    "1. Identify the food.",
    sizingStep,
    "3. Multiply that weight by the calorie density below to get its calories.",
    "",
    "State the result of steps 2 and 3 in that item's `reasoning` field, briefly - for example \"~150 g, about a deck of cards\".",
    "",
    "Calorie density reference (use your own knowledge for foods not listed):",
    table,
    "",
    "Return only the structured JSON.",
  ].join("\n");
}

/**
 * The user turn for re-pricing ONE item on a plate.
 *
 * Naming the corrected item alone is not enough: given a photo of chicken,
 * rice and broccoli and the single name "fried rice", the model can reasonably
 * price the entire plate as fried rice - a plausible, badly wrong number. So
 * the whole plate goes in as context and the target is named explicitly.
 *
 * A hand-added item may not be in the photo at all (a drink out of frame), so
 * the model is told to fall back to a typical serving and say so, rather than
 * hunting for food that is not there or refusing.
 *
 * Returns DEFAULT_PROMPT for input it cannot form a sensible instruction from,
 * rather than emitting a malformed one.
 */
export function itemPrompt(items: { name?: unknown }[], index: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return DEFAULT_PROMPT;
  if (typeof index !== "number" || !Number.isInteger(index)) return DEFAULT_PROMPT;
  if (index < 0 || index >= items.length) return DEFAULT_PROMPT;

  const names = items.map((it) => normalizeName(it?.name));
  const target = names[index];
  if (!target) return DEFAULT_PROMPT;

  const listed = names.map((n, i) => `${i + 1}. ${n || "(unnamed)"}`).join("\n");
  return [
    "This photo contains these items:",
    listed,
    "",
    `The owner says item ${index + 1} is: ${target}`,
    "",
    "Trust that identification over your own reading of the image. Estimate",
    `calories for only "${target}" as it appears in this photo - not the whole plate,`,
    "and not the other items listed above.",
    "",
    `If you cannot find "${target}" in the photo, assume a typical single`,
    "serving of it and say so in the reasoning.",
    "",
    "Return the single item in `items` and its calories as `total_calories`.",
  ].join("\n");
}
