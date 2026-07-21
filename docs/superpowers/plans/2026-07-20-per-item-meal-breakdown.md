# Per-Item Meal Breakdown Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make photo-meal estimates more accurate and correctable — per-item
portion reasoning, per-item editing and recalculation, add/remove items, and a
calorie-density reference in the system prompt.

**Architecture:** All prompt text moves into the pure `prompt.ts` module so it
is testable. The vision schema gains a `reasoning` field per item. The client
stops flattening the item list: `MealItemsEditor` (new, shared) renders one
editable row per item, `PhotoMealForm` owns the meal name, total, and network,
and the breakdown persists in a new nullable `meals.items` jsonb column that
the dashboard can expand.

**Tech Stack:** React 19 (no router, plain `useState`), Supabase JS v2,
Supabase Edge Functions (Deno), Anthropic Messages API (`claude-haiku-4-5`),
vitest 3, Postgres (Supabase).

**Spec:** `docs/superpowers/specs/2026-07-20-per-item-meal-breakdown-design.md`

## Global Constraints

- Photos are still never stored. The base64 stays in React state and is dropped
  on save or cancel.
- Saving still writes exactly **one** `meals` row (joined name, summed
  calories). `dayIntake`, `sevenDayBalance`, `calibrationFactor`, `isLowLog`,
  and `CaloriesChart` must keep working untouched.
- `meals.items` is nullable. Existing rows and manual meals stay null. No
  backfill.
- `reasoning` is `null` for a hand-added item that was never recalculated —
  never fabricate one.
- Recalculation is uncapped; the 20/day photo cap and its counting are
  unchanged.
- Owner-supplied strings are capped at 200 characters via `normalizeName` and
  go in the user turn, never the system prompt.
- Run all commands from `pwa/` unless stated otherwise.
- Styles come from `src/styles/ui.js` (`card`, `input`, `button`,
  `buttonPrimary`, `badge`, `textSecondary`, `textMuted`) — this project uses
  inline styles, no CSS framework.

---

### Task 1: Density table and system prompt

Moves the system prompt out of `index.ts` into the tested pure module and adds
the density reference.

**Files:**
- Modify: `pwa/supabase/functions/estimate-meal/prompt.ts`
- Test: `pwa/supabase/functions/estimate-meal/prompt.test.ts`

**Interfaces:**
- Consumes: existing `MAX_NAME`, `DEFAULT_PROMPT`, `normalizeName`,
  `mealPrompt` from `prompt.ts`.
- Produces:
  - `DENSITIES: {name: string, kcal100g: number}[]`
  - `PLATE_CM: number` (27), `BOWL_CM: number` (15)
  - `systemPrompt(): string`

- [ ] **Step 1: Write the failing test**

Append to `pwa/supabase/functions/estimate-meal/prompt.test.ts`:

```ts
import { DENSITIES, systemPrompt, PLATE_CM, BOWL_CM } from "./prompt.ts";

describe("DENSITIES", () => {
  it("has enough entries to be useful", () => {
    expect(DENSITIES.length).toBeGreaterThanOrEqual(30);
  });

  it("entries are well formed", () => {
    for (const d of DENSITIES) {
      expect(d.name.trim()).not.toBe("");
      expect(Number.isInteger(d.kcal100g)).toBe(true);
      expect(d.kcal100g).toBeGreaterThan(0);
    }
  });

  it("has no duplicate names", () => {
    const names = DENSITIES.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("covers the high-error fat and starch cases", () => {
    const names = DENSITIES.map((d) => d.name);
    for (const required of ["olive oil", "butter", "white rice", "bread"]) {
      expect(names).toContain(required);
    }
  });
});

describe("systemPrompt", () => {
  it("keeps the plate and bowl reference sizes", () => {
    const out = systemPrompt();
    expect(out).toContain(String(PLATE_CM));
    expect(out).toContain(String(BOWL_CM));
  });

  it("includes density lines the model can multiply against", () => {
    const out = systemPrompt();
    expect(out).toContain("olive oil");
    expect(out).toContain(String(DENSITIES.find((d) => d.name === "olive oil")!.kcal100g));
  });

  it("instructs the grams-then-multiply method", () => {
    const out = systemPrompt();
    expect(out).toMatch(/gram/i);
    expect(out).toMatch(/multiply/i);
  });

  it("still tells the model to estimate generously", () => {
    expect(systemPrompt()).toMatch(/generous/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/estimate-meal/prompt.test.ts`
Expected: FAIL — `DENSITIES`, `systemPrompt`, `PLATE_CM`, `BOWL_CM` are not
exported.

- [ ] **Step 3: Write minimal implementation**

Append to `pwa/supabase/functions/estimate-meal/prompt.ts`:

```ts
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
 */
export function systemPrompt(): string {
  const table = DENSITIES.map((d) => `- ${d.name}: ${d.kcal100g} kcal per 100 g`).join("\n");
  return [
    "You estimate calories from a photo of a meal.",
    "",
    `The owner's usual dinner plate is ${PLATE_CM} cm across and their usual bowl is ${BOWL_CM} cm across - use them to judge portion size.`,
    "Estimate generously rather than low; real portions are usually bigger than they look.",
    "",
    "For each food, work in three steps:",
    "1. Identify the food.",
    "2. Estimate its portion in grams, using the plate and bowl above for scale.",
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/estimate-meal/prompt.test.ts`
Expected: PASS — 6 existing + 8 new = 14 tests.

- [ ] **Step 5: Commit**

```bash
git add pwa/supabase/functions/estimate-meal/prompt.ts pwa/supabase/functions/estimate-meal/prompt.test.ts
git commit -m "feat: calorie density reference in the meal system prompt"
```

---

### Task 2: Per-item recalculation prompt

**Files:**
- Modify: `pwa/supabase/functions/estimate-meal/prompt.ts`
- Test: `pwa/supabase/functions/estimate-meal/prompt.test.ts`

**Interfaces:**
- Consumes: `normalizeName`, `mealPrompt`, `DEFAULT_PROMPT` from Task 1's module.
- Produces: `itemPrompt(items: {name?: unknown}[], index: unknown): string`

- [ ] **Step 1: Write the failing test**

Append to `prompt.test.ts` (add `itemPrompt` to the existing import from
`./prompt.ts`):

```ts
describe("itemPrompt", () => {
  const plate = [{ name: "chicken breast" }, { name: "white rice" }, { name: "broccoli" }];

  it("names the target item and constrains scope to it", () => {
    const out = itemPrompt(plate, 1);
    expect(out).toContain("white rice");
    expect(out).toMatch(/only/i);
    expect(out).toMatch(/not the whole plate/i);
  });

  it("includes the other items as context so the model knows which region", () => {
    const out = itemPrompt(plate, 1);
    expect(out).toContain("chicken breast");
    expect(out).toContain("broccoli");
  });

  it("tells the model to assume a typical serving when the item is not visible", () => {
    const out = itemPrompt(plate, 1);
    expect(out).toMatch(/not visible|cannot find|typical serving/i);
  });

  it("truncates a long item name like every other owner-supplied string", () => {
    const out = itemPrompt([{ name: "c".repeat(500) }], 0);
    expect(out).toContain("c".repeat(MAX_NAME));
    expect(out).not.toContain("c".repeat(MAX_NAME + 1));
  });

  it("falls back to the whole-meal prompt on unusable input", () => {
    expect(itemPrompt(plate, 9)).toBe(DEFAULT_PROMPT);
    expect(itemPrompt(plate, -1)).toBe(DEFAULT_PROMPT);
    expect(itemPrompt(plate, "x")).toBe(DEFAULT_PROMPT);
    expect(itemPrompt([], 0)).toBe(DEFAULT_PROMPT);
    expect(itemPrompt([{ name: "   " }], 0)).toBe(DEFAULT_PROMPT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/estimate-meal/prompt.test.ts`
Expected: FAIL — `itemPrompt is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `prompt.ts`:

```ts
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
    `calories for only "${target}" as it appears in this photo - not the whole`,
    "plate, and not the other items listed above.",
    "",
    `If you cannot find "${target}" in the photo, assume a typical single`,
    "serving of it and say so in the reasoning.",
    "",
    "Return the single item in `items` and its calories as `total_calories`.",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/estimate-meal/prompt.test.ts`
Expected: PASS — 14 + 5 = 19 tests.

- [ ] **Step 5: Commit**

```bash
git add pwa/supabase/functions/estimate-meal/prompt.ts pwa/supabase/functions/estimate-meal/prompt.test.ts
git commit -m "feat: per-item recalculation prompt carrying full plate context"
```

---

### Task 3: Edge function — reasoning field and per-item path

**Files:**
- Modify: `pwa/supabase/functions/estimate-meal/index.ts`

**Interfaces:**
- Consumes: `systemPrompt`, `mealPrompt`, `itemPrompt` from `./prompt.ts`.
- Produces: `POST /estimate-meal` accepts
  `{image: string, name?: string, items?: {name}[], itemIndex?: number}` and
  returns `{items: [{name, estimated_calories, reasoning}], total_calories}`.

- [ ] **Step 1: Widen the import**

Replace:

```ts
import { mealPrompt } from "./prompt.ts";
```

with:

```ts
import { mealPrompt, itemPrompt, systemPrompt } from "./prompt.ts";
```

- [ ] **Step 2: Delete the inlined system prompt and crockery constants**

Delete these three lines (now owned by `prompt.ts`):

```ts
const PLATE_CM = 27; // owner's usual dinner plate diameter
const BOWL_CM = 15;  // owner's usual bowl diameter

const SYSTEM = `You estimate calories from a photo of a meal. The owner's usual dinner plate is ${PLATE_CM} cm across and their usual bowl is ${BOWL_CM} cm across — use them to judge portion size. Estimate generously rather than low; real portions are usually bigger than they look. Return only the structured JSON.`;
```

- [ ] **Step 3: Add `reasoning` to the schema**

In `SCHEMA`, replace the item `properties` and `required` block:

```ts
        properties: {
          name: { type: "string" },
          estimated_calories: { type: "integer" },
        },
        required: ["name", "estimated_calories"],
```

with:

```ts
        properties: {
          name: { type: "string" },
          estimated_calories: { type: "integer" },
          reasoning: { type: "string" },
        },
        required: ["name", "estimated_calories", "reasoning"],
```

- [ ] **Step 4: Thread the prompt choice through `estimate()`**

Replace the signature:

```ts
async function estimate(imageB64: string, name?: unknown) {
```

with:

```ts
// `items` + `itemIndex` re-price one item on the plate; `name` corrects the
// whole meal; neither is a first estimate. Exactly one prompt is chosen here.
async function estimate(
  imageB64: string,
  name?: unknown,
  items?: unknown,
  itemIndex?: unknown,
) {
  const text = Array.isArray(items) ? itemPrompt(items, itemIndex) : mealPrompt(name);
```

and replace `system: SYSTEM,` with:

```ts
      system: systemPrompt(),
```

and replace the text content line:

```ts
            { type: "text", text: mealPrompt(name) },
```

with:

```ts
            { type: "text", text },
```

- [ ] **Step 5: Validate and pass the new fields in the handler**

Replace:

```ts
    const { image, name } = await req.json();
```

with:

```ts
    const { image, name, items, itemIndex } = await req.json();
```

Then, immediately after the existing `invalid name` check, add:

```ts
    if (items !== undefined && !Array.isArray(items)) {
      return json({ error: "invalid items" }, 400);
    }
```

And replace:

```ts
    return await estimate(image, name);
```

with:

```ts
    return await estimate(image, name, items, itemIndex);
```

- [ ] **Step 6: Type-check the function**

Run from the repo root:

```bash
npx --yes deno@2 check pwa/supabase/functions/estimate-meal/index.ts
```

Expected: `Check file:///...index.ts` with no errors.

- [ ] **Step 7: Confirm the suite still passes**

Run from `pwa/`: `npx vitest run`
Expected: PASS — 8 files, 63 tests (44 pre-existing + 19 in `prompt.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add pwa/supabase/functions/estimate-meal/index.ts
git commit -m "feat: reasoning field and per-item re-pricing in estimate-meal"
```

---

### Task 4: Item helpers

Pure functions the client needs, tested alongside the other `lib/` helpers.

**Files:**
- Create: `pwa/src/lib/mealItems.js`
- Test: `pwa/src/lib/mealItems.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `itemsTotal(items): number`
  - `itemsForSave(items): {name, calories, reasoning}[]`
  - `blankItem(key): {key, name, calories, reasoning}`
  - `hasIncompleteItem(items): boolean`

- [ ] **Step 1: Write the failing test**

Create `pwa/src/lib/mealItems.test.js`:

```js
import { describe, it, expect } from "vitest";
import { itemsTotal, itemsForSave, blankItem, hasIncompleteItem } from "./mealItems.js";

describe("itemsTotal", () => {
  it("sums calorie fields", () => {
    expect(itemsTotal([{ calories: 250 }, { calories: 260 }])).toBe(510);
  });

  it("treats blank fields mid-edit as zero", () => {
    expect(itemsTotal([{ calories: 250 }, { calories: "" }])).toBe(250);
  });

  it("ignores non-numeric junk rather than returning NaN", () => {
    expect(itemsTotal([{ calories: "abc" }, { calories: 100 }])).toBe(100);
  });

  it("is zero for an empty list", () => {
    expect(itemsTotal([])).toBe(0);
  });

  it("accepts numeric strings from number inputs", () => {
    expect(itemsTotal([{ calories: "250" }])).toBe(250);
  });
});

describe("itemsForSave", () => {
  it("strips the client-side key", () => {
    const out = itemsForSave([{ key: 3, name: "egg", calories: "143", reasoning: "one large" }]);
    expect(out).toEqual([{ name: "egg", calories: 143, reasoning: "one large" }]);
  });

  it("drops fully blank rows", () => {
    const out = itemsForSave([
      { key: 1, name: "egg", calories: "143", reasoning: null },
      { key: 2, name: "", calories: "", reasoning: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("egg");
  });

  it("keeps a named row with no calories (the save guard catches it)", () => {
    const out = itemsForSave([{ key: 1, name: "toast", calories: "", reasoning: null }]);
    expect(out).toHaveLength(1);
    expect(out[0].calories).toBe(0);
  });

  it("preserves a null reasoning rather than inventing one", () => {
    const out = itemsForSave([{ key: 1, name: "juice", calories: "110", reasoning: null }]);
    expect(out[0].reasoning).toBeNull();
  });
});

describe("hasIncompleteItem", () => {
  it("is true when a named row has no calories", () => {
    expect(hasIncompleteItem([{ name: "toast", calories: "" }])).toBe(true);
  });

  it("is false when every named row has calories", () => {
    expect(hasIncompleteItem([{ name: "toast", calories: "90" }])).toBe(false);
  });

  it("ignores fully blank rows, which are dropped at save", () => {
    expect(hasIncompleteItem([{ name: "", calories: "" }])).toBe(false);
  });
});

describe("blankItem", () => {
  it("carries the given key and empty fields", () => {
    expect(blankItem(7)).toEqual({ key: 7, name: "", calories: "", reasoning: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mealItems.test.js`
Expected: FAIL — cannot find module `./mealItems.js`.

- [ ] **Step 3: Write minimal implementation**

Create `pwa/src/lib/mealItems.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mealItems.test.js`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add pwa/src/lib/mealItems.js pwa/src/lib/mealItems.test.js
git commit -m "feat: pure helpers for the editable meal item list"
```

---

### Task 5: `MealItemsEditor` component

**Files:**
- Create: `pwa/src/components/MealItemsEditor.jsx`

**Interfaces:**
- Consumes: `blankItem` from `../lib/mealItems.js`; styles from
  `../styles/ui.js`.
- Produces: default export
  `MealItemsEditor({items, onChange, onRecalculate, busyIndex})`. Controlled —
  it never holds item state of its own.

- [ ] **Step 1: Write the component**

Create `pwa/src/components/MealItemsEditor.jsx`:

```jsx
import { useRef } from "react";
import { blankItem } from "../lib/mealItems.js";
import { input, button, textMuted } from "../styles/ui.js";

// Controlled editor for a meal's item list. Owns no meal-level concerns - no
// meal name, no total, no save, no network. The parent owns the array.
//
// onRecalculate is optional: without it no recalculate control renders, which
// is what a caller with no photo needs.
export default function MealItemsEditor({ items, onChange, onRecalculate, busyIndex = null }) {
  // Row identity must survive add, remove and reorder. Array index would make
  // every row below a removed one remount and lose focus mid-edit, so each row
  // carries its own key from this counter. Never persisted.
  const nextKey = useRef(1000);

  function patch(i, fields) {
    onChange(items.map((it, n) => (n === i ? { ...it, ...fields } : it)));
  }

  function remove(i) {
    onChange(items.filter((_, n) => n !== i));
  }

  function add() {
    onChange([...items, blankItem(nextKey.current++)]);
  }

  return (
    <div>
      {items.map((it, i) => (
        <div key={it.key} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              value={it.name}
              onChange={(e) => patch(i, { name: e.target.value })}
              placeholder="Item"
              style={{ ...input, flex: 2, minWidth: 120 }}
            />
            <input
              type="number"
              value={it.calories}
              onChange={(e) => patch(i, { calories: e.target.value })}
              placeholder="kcal"
              style={{ ...input, flex: 1, minWidth: 80 }}
            />
            {onRecalculate && (
              <button
                type="button"
                onClick={() => onRecalculate(i)}
                disabled={busyIndex !== null || !it.name.trim()}
                style={{ ...button, padding: "6px 10px" }}
              >
                {busyIndex === i ? "…" : "↻"}
              </button>
            )}
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove ${it.name || "item"}`}
              style={{ ...button, padding: "6px 10px" }}
            >
              ✕
            </button>
          </div>
          {it.reasoning && (
            <div style={{ ...textMuted, fontSize: 13, marginTop: 2 }}>{it.reasoning}</div>
          )}
        </div>
      ))}
      <button type="button" onClick={add} style={{ ...button, marginTop: 4 }}>
        + Add item
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: `✓ built in …` with no errors. (The component is not rendered by
anything yet — this only proves it parses and its imports resolve.)

- [ ] **Step 3: Commit**

```bash
git add pwa/src/components/MealItemsEditor.jsx
git commit -m "feat: shared editor for a meal's item list"
```

---

### Task 6: `PhotoMealForm` composes the editor

**Files:**
- Modify: `pwa/src/components/PhotoMealForm.jsx`

**Interfaces:**
- Consumes: `MealItemsEditor`; `itemsTotal`, `itemsForSave`,
  `hasIncompleteItem` from `../lib/mealItems.js`; the `items`/`itemIndex`
  request contract from Task 3.
- Produces: unchanged default export `PhotoMealForm({onSaved})`.

- [ ] **Step 1: Rewrite the component**

Replace `pwa/src/components/PhotoMealForm.jsx` in full:

```jsx
import { useState } from "react";
import { supabase } from "../supabaseClient.js";
import { intakeDate } from "../lib/intakeDate.js";
import { resizeImage } from "../lib/resizeImage.js";
import { itemsTotal, itemsForSave, hasIncompleteItem } from "../lib/mealItems.js";
import MealItemsEditor from "./MealItemsEditor.jsx";
import { input, button, buttonPrimary, textSecondary } from "../styles/ui.js";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/estimate-meal`;

// One call for both paths. `body` is either {image} for a first estimate or
// {image, items, itemIndex} to re-price a single item. Throws on non-OK.
async function callEstimate(body) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error("estimate failed");
  return await resp.json();
}

export default function PhotoMealForm({ onSaved }) {
  // idle | estimating | confirm | error
  const [status, setStatus] = useState("idle");
  const [mealName, setMealName] = useState("");
  const [items, setItems] = useState([]);
  // Kept only so the confirm screen can re-price items. Never persisted, and
  // dropped on save or cancel.
  const [image, setImage] = useState(null);
  const [busyIndex, setBusyIndex] = useState(null);
  const [recalcFailed, setRecalcFailed] = useState(false);

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("estimating");
    try {
      const b64 = await resizeImage(file);
      const est = await callEstimate({ image: b64 });
      const rows = (est.items ?? []).map((it, i) => ({
        key: i,
        name: it.name ?? "",
        calories: String(it.estimated_calories ?? ""),
        reasoning: it.reasoning ?? null,
      }));
      setImage(b64);
      setItems(rows);
      setMealName(rows.map((r) => r.name).join(", ") || "Meal");
      setStatus("confirm");
    } catch {
      setStatus("error");
    }
  }

  // Re-price ONE item against the same photo. The whole plate goes along as
  // context so the model prices the named item rather than the entire plate.
  // Every other row - including manual edits - is left alone.
  async function recalculate(i) {
    setRecalcFailed(false);
    setBusyIndex(i);
    try {
      const est = await callEstimate({
        image,
        items: items.map((it) => ({ name: it.name })),
        itemIndex: i,
      });
      const first = est.items?.[0];
      setItems((prev) =>
        prev.map((it, n) =>
          n === i
            ? {
                ...it,
                calories: String(est.total_calories ?? it.calories),
                reasoning: first?.reasoning ?? it.reasoning,
              }
            : it,
        ),
      );
    } catch {
      setRecalcFailed(true);
    }
    setBusyIndex(null);
  }

  function reset() {
    setStatus("idle");
    setMealName("");
    setItems([]);
    setImage(null);
    setBusyIndex(null);
    setRecalcFailed(false);
  }

  async function confirm(e) {
    e.preventDefault();
    const rows = itemsForSave(items);
    const { error } = await supabase.from("meals").insert({
      name: mealName,
      calories: itemsTotal(items),
      source: "photo",
      eaten_at: new Date().toISOString(),
      intake_date: intakeDate(),
      items: rows.length ? rows : null,
    });
    if (error) { setStatus("error"); return; }
    reset();
    onSaved();
  }

  if (status === "confirm") {
    const total = itemsTotal(items);
    const incomplete = hasIncompleteItem(items);
    return (
      <form onSubmit={confirm} style={{ margin: "1rem 0" }}>
        <input
          value={mealName}
          onChange={(e) => setMealName(e.target.value)}
          required
          placeholder="Meal"
          style={{ ...input, width: "100%", marginBottom: 8, boxSizing: "border-box" }}
        />
        <MealItemsEditor
          items={items}
          onChange={setItems}
          onRecalculate={recalculate}
          busyIndex={busyIndex}
        />
        <div style={{ margin: "12px 0", fontWeight: "var(--font-weight-emphasis)" }}>
          Total: {total} kcal
        </div>
        {incomplete && (
          <p style={textSecondary}>Give every named item a calorie number before saving.</p>
        )}
        {recalcFailed && (
          <p style={{ color: "var(--state-over-fg)" }}>
            Recalculate failed — the item above is unchanged.
          </p>
        )}
        <button type="submit" disabled={incomplete} style={buttonPrimary}>Save</button>
        <button type="button" onClick={reset} style={{ ...button, marginLeft: 8 }}>Cancel</button>
      </form>
    );
  }

  return (
    <div style={{ margin: "1rem 0" }}>
      <label style={{ ...button, display: "inline-block" }}>
        {status === "estimating" ? "Estimating…" : "📷 Photo a meal"}
        <input type="file" accept="image/*" capture="environment" onChange={onPick}
          disabled={status === "estimating"} style={{ display: "none" }} />
      </label>
      {status === "error" && <span style={{ color: "var(--state-over-fg)", marginLeft: 8 }}>Estimate failed</span>}
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: `✓ built in …` with no errors.

- [ ] **Step 3: Verify the suite still passes**

Run: `npx vitest run`
Expected: PASS — 9 files, 76 tests (63 after Task 3, plus 13 from Task 4).

- [ ] **Step 4: Commit**

```bash
git add pwa/src/components/PhotoMealForm.jsx
git commit -m "feat: per-item confirm screen for photo meals"
```

---

### Task 7: Schema column and dashboard breakdown

The column must exist before any save with `items` succeeds, so Step 1 runs
before the UI is exercised. **Applying SQL changes the live database: confirm
with the owner before Step 1.**

**Files:**
- Modify: `pwa/src/pages/Dashboard.jsx`

**Interfaces:**
- Consumes: `meals.items` from Step 1.
- Produces: no new exports.

- [ ] **Step 1: Add the column**

Ask the owner before running. In the Supabase SQL editor, or via the CLI:

```sql
alter table meals add column items jsonb;
```

Verify:

```bash
cd /Users/unoa/garmin-health-tips && set -a && . ./.env && set +a && \
curl -s "$SUPABASE_URL/rest/v1/meals?select=id,items&limit=1" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY"
```

Expected: a JSON array where the row has an `items` key (value `null`), not an
error mentioning the column does not exist.

- [ ] **Step 2: Select the new column**

In `loadMeals`, replace:

```js
      .select("id, intake_date, name, calories")
```

with:

```js
      .select("id, intake_date, name, calories, items")
```

- [ ] **Step 3: Track which meal is expanded**

Add alongside the other `useState` declarations in `Dashboard`:

```js
  const [expandedMeal, setExpandedMeal] = useState(null);
```

- [ ] **Step 4: Render the arrow and breakdown**

Replace the meal list block:

```jsx
          <ul style={{ listStyle: "none", padding: 0 }}>
            {todayMeals.map((m) => (
              <li key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                <span>{m.name} — {m.calories}</span>
                <button onClick={() => deleteMeal(m.id)} style={{ ...button, padding: "2px 8px" }}>Delete</button>
              </li>
            ))}
          </ul>
```

with:

```jsx
          <ul style={{ listStyle: "none", padding: 0 }}>
            {todayMeals.map((m) => {
              // Keyed on "has items", not "is a photo meal" - manual meals get
              // breakdowns in the follow-up spec and should need no change here.
              const breakdown = m.items?.length ? m.items : null;
              const open = expandedMeal === m.id;
              return (
                <li key={m.id} style={{ padding: "4px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>
                      {breakdown && (
                        <button
                          type="button"
                          onClick={() => setExpandedMeal(open ? null : m.id)}
                          aria-expanded={open}
                          aria-label={`${open ? "Hide" : "Show"} items for ${m.name}`}
                          style={{ ...button, padding: "0 6px", marginRight: 6, background: "none", border: "none" }}
                        >
                          {open ? "▾" : "▸"}
                        </button>
                      )}
                      {m.name} — {m.calories}
                    </span>
                    <button onClick={() => deleteMeal(m.id)} style={{ ...button, padding: "2px 8px" }}>Delete</button>
                  </div>
                  {open && breakdown && (
                    <ul style={{ listStyle: "none", padding: "4px 0 4px 22px", margin: 0 }}>
                      {breakdown.map((it, i) => (
                        <li key={i} style={{ ...textSecondary, fontSize: 14, padding: "2px 0" }}>
                          {it.name} — {it.calories}
                          {it.reasoning && (
                            <div style={{ ...textMuted, fontSize: 13 }}>{it.reasoning}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
```

- [ ] **Step 5: Verify it builds and the suite passes**

Run: `npm run build && npx vitest run`
Expected: build `✓ built in …`; tests 9 files, 76 tests passing.

- [ ] **Step 6: Commit**

```bash
git add pwa/src/pages/Dashboard.jsx
git commit -m "feat: expandable item breakdown on logged meals"
```

---

### Task 8: Deploy and verify end to end

**Deploying changes live behavior and spends real API calls: confirm with the
owner before Steps 2 and 3.**

**Files:** none modified until Step 8.

- [ ] **Step 1: Confirm the column exists**

Task 7 Step 1 must have been applied. Re-run its verify command if unsure.

- [ ] **Step 2: Push the client**

```bash
git push
gh run list --workflow=deploy-pwa.yml --limit 1
```

Expected: `completed  success`.

- [ ] **Step 3: Deploy the edge function**

```bash
cd pwa && npx --yes supabase@latest functions deploy estimate-meal --project-ref giydwqerqtikkbzwfeae
```

Expected: `Deployed Functions.` listing `estimate-meal`. If it fails on auth,
the owner runs `npx supabase login` — do not supply credentials.

- [ ] **Step 4: Multi-item estimate**

Photograph a plate with at least three distinguishable foods.
Expected: one row per food, each with a plausible portion note beneath, and
`Total:` equal to the sum of the rows.

- [ ] **Step 5: Per-item correction — the key check**

Change one item's name to a clearly different food and tap its ↻.
Expected: only that row's calories and reasoning change; the other rows keep
their values; and the returned number is plausible **for that item alone**, not
close to the whole-plate total. A whole-plate-sized number here means the
context-carrying prompt regressed.

- [ ] **Step 6: Add, price, and remove**

Add an item the model could not have seen (a drink out of frame), name it, and
tap its ↻.
Expected: a plausible typical-serving number, with reasoning saying it was not
visible in the photo.

Then type into two rows, remove the row between them, and confirm the remaining
rows keep their typed values without losing focus.

- [ ] **Step 7: Save and expand**

Save the meal, then find it in today's list and tap the ▸ arrow.
Expected: the breakdown matches what was saved, including the hand-added item.
Then log a manual meal and confirm it shows **no** arrow.

- [ ] **Step 8: Mark the spec implemented**

Set the status line of
`docs/superpowers/specs/2026-07-20-per-item-meal-breakdown-design.md` to
`implemented <date>`, then:

```bash
git add docs/superpowers/specs/2026-07-20-per-item-meal-breakdown-design.md
git commit -m "docs: mark per-item meal breakdown spec implemented"
git push
```

---

## Notes for the implementer

- **Do not** change how `underCap` counts. Recalculations create no rows and so
  never touch the 20/day cap. That is intended.
- `estimate()` returns a `Response` (it calls `json(...)` itself), not a parsed
  object. Keep that shape.
- The per-item response is a normal estimate response whose `total_calories` is
  that one item's calories — the client reads `total_calories`, not
  `items[0].estimated_calories`, because the model is instructed to put the
  figure there.
- Row `key` is client-only. `itemsForSave` strips it; nothing should ever write
  it to Postgres.
- Never fabricate a `reasoning` string for a hand-typed item. Null is correct
  and the UI renders nothing for it.
- The follow-up spec
  (`2026-07-20-manual-meal-items-and-text-estimate-design.md`) consumes
  `MealItemsEditor` with `onRecalculate` omitted. Keep that prop genuinely
  optional — no crash, no empty control, when it is absent.
