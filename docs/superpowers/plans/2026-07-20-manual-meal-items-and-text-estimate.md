# Manual Meal Items and Text Estimation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give manually logged meals the same item breakdown photo meals have,
and let a typed description ("2 eggs and a sausage") be priced by the model
without a photo.

**Architecture:** `systemPrompt` gains a `{photo}` flag so the plate/bowl scale
reference is dropped when there is no image; `textPrompt` builds the user turn
for a description. The edge function accepts `text` as an alternative to
`image`, skipping the photo cap on that path. `MealForm` is rebuilt around the
already-shipped `MealItemsEditor` with `onRecalculate` omitted, and the network
call shared with `PhotoMealForm` moves into a small lib module.

**Tech Stack:** React 19 (no router, plain `useState`), Supabase JS v2, Supabase
Edge Functions (Deno), Anthropic Messages API (`claude-haiku-4-5`), vitest 3.

**Spec:** `docs/superpowers/specs/2026-07-20-manual-meal-items-and-text-estimate-design.md`

**Depends on:** `2026-07-20-per-item-meal-breakdown-design.md`, implemented
2026-07-21. `MealItemsEditor`, `meals.items`, the `reasoning` schema field, the
density table, and `itemsTotal`/`itemsForSave`/`hasIncompleteItem`/`blankItem`
all already exist and are in use — do not recreate any of them.

## Global Constraints

- Saving still writes exactly **one** `meals` row (name, summed calories).
  `dayIntake`, `sevenDayBalance`, `calibrationFactor`, `isLowLog`, and
  `CaloriesChart` must keep working untouched.
- A text-estimated meal is `source: 'manual'`. The 20/day photo cap and its
  counting are unchanged, and text estimates must never consume it.
- The fast path must not regress: meal name + one calorie number + Save is the
  same number of interactions manual entry takes today.
- Owner-supplied strings are capped at 200 characters via `normalizeName` and
  go in the user turn, never the system prompt.
- `reasoning` is `null` for a hand-typed item — never fabricate one.
- With a photo present, every existing behavior is byte-for-byte unchanged.
- Run all commands from `pwa/` unless stated otherwise.
- Styles come from `src/styles/ui.js` (`card`, `input`, `button`,
  `buttonPrimary`, `badge`, `textSecondary`, `textMuted`) — inline styles, no
  CSS framework.

---

### Task 1: `systemPrompt({photo})`

**Files:**
- Modify: `pwa/supabase/functions/estimate-meal/prompt.ts`
- Test: `pwa/supabase/functions/estimate-meal/prompt.test.ts`

**Interfaces:**
- Consumes: existing `DENSITIES`, `PLATE_CM`, `BOWL_CM` from `prompt.ts`.
- Produces: `systemPrompt(opts?: { photo?: boolean }): string`. The `photo`
  option defaults to `true`, so the existing no-argument callers and tests keep
  working unchanged.

- [ ] **Step 1: Write the failing test**

Append to `pwa/supabase/functions/estimate-meal/prompt.test.ts`. The existing
`describe("systemPrompt", ...)` block stays exactly as it is — it calls
`systemPrompt()` with no arguments and must keep passing.

```ts
describe("systemPrompt photo/text modes", () => {
  it("defaults to photo mode so existing callers are unaffected", () => {
    expect(systemPrompt()).toBe(systemPrompt({ photo: true }));
  });

  it("keeps the plate and bowl scale reference in photo mode", () => {
    const out = systemPrompt({ photo: true });
    expect(out).toContain(String(PLATE_CM));
    expect(out).toContain(String(BOWL_CM));
  });

  it("drops the plate and bowl reference in text mode", () => {
    const out = systemPrompt({ photo: false });
    expect(out).not.toContain(String(PLATE_CM));
    expect(out).not.toContain(String(BOWL_CM));
  });

  it("leans on stated quantities instead of scale in text mode", () => {
    expect(systemPrompt({ photo: false })).toMatch(/stated quantit|typical serving/i);
  });

  it("carries the density table in both modes", () => {
    for (const photo of [true, false]) {
      const out = systemPrompt({ photo });
      expect(out).toContain("olive oil");
      expect(out).toContain(String(DENSITIES.find((d) => d.name === "olive oil")!.kcal100g));
    }
  });

  it("carries the grams-then-multiply method in both modes", () => {
    for (const photo of [true, false]) {
      const out = systemPrompt({ photo });
      expect(out).toMatch(/gram/i);
      expect(out).toMatch(/multiply/i);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/estimate-meal/prompt.test.ts`
Expected: FAIL — `systemPrompt({photo: false})` still contains `27` and `15`,
because the parameter is ignored.

- [ ] **Step 3: Write minimal implementation**

In `prompt.ts`, replace the whole `systemPrompt` function with:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/estimate-meal/prompt.test.ts`
Expected: PASS — 19 existing + 6 new = 25 tests. The four original
`systemPrompt` tests must be among the passes; if any now fails, the default
argument is wrong.

- [ ] **Step 5: Commit**

```bash
git add pwa/supabase/functions/estimate-meal/prompt.ts pwa/supabase/functions/estimate-meal/prompt.test.ts
git commit -m "feat: systemPrompt drops the plate reference for text-only estimates"
```

---

### Task 2: `textPrompt(description)`

**Files:**
- Modify: `pwa/supabase/functions/estimate-meal/prompt.ts`
- Test: `pwa/supabase/functions/estimate-meal/prompt.test.ts`

**Interfaces:**
- Consumes: `normalizeName`, `DEFAULT_PROMPT`, `MAX_NAME` from `prompt.ts`.
- Produces: `textPrompt(description: unknown): string`

- [ ] **Step 1: Write the failing test**

Add `textPrompt` to the existing import from `./prompt.ts`, then append:

```ts
describe("textPrompt", () => {
  it("embeds the description", () => {
    expect(textPrompt("2 eggs and a sausage")).toContain("2 eggs and a sausage");
  });

  it("asks for one item per distinct food", () => {
    expect(textPrompt("2 eggs and a sausage")).toMatch(/one item per|separate item|each distinct food/i);
  });

  it("tells the model to honour stated counts", () => {
    expect(textPrompt("2 eggs and a sausage")).toMatch(/count|quantit/i);
  });

  it("truncates a long description like every other owner-supplied string", () => {
    const out = textPrompt("d".repeat(500));
    expect(out).toContain("d".repeat(MAX_NAME));
    expect(out).not.toContain("d".repeat(MAX_NAME + 1));
  });

  it("falls back to the default prompt on blank or non-string input", () => {
    expect(textPrompt("")).toBe(DEFAULT_PROMPT);
    expect(textPrompt("   ")).toBe(DEFAULT_PROMPT);
    expect(textPrompt(undefined)).toBe(DEFAULT_PROMPT);
    expect(textPrompt(42)).toBe(DEFAULT_PROMPT);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run supabase/functions/estimate-meal/prompt.test.ts`
Expected: FAIL — `textPrompt is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `prompt.ts`:

```ts
/**
 * The user turn for a text-only estimate.
 *
 * A written description is often easier to price than a photo: "2 eggs" is a
 * count against a known density with no portion inference at all, where a
 * photo of the same plate needs the egg size guessed. So the instruction leans
 * hard on splitting the description into distinct foods and honouring whatever
 * counts the owner stated.
 *
 * The description is untrusted owner input and gets the same 200-character cap
 * and user-turn placement as every other such string.
 */
export function textPrompt(description: unknown): string {
  const clean = normalizeName(description);
  if (!clean) return DEFAULT_PROMPT;
  return [
    `The owner ate: ${clean}`,
    "",
    "Break this into one item per distinct food. Honour any stated count or",
    "quantity exactly - \"2 eggs\" is two eggs, not one - and where no quantity",
    "is given, assume one typical serving.",
    "",
    "Estimate the calories for each item, then total them.",
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run supabase/functions/estimate-meal/prompt.test.ts`
Expected: PASS — 25 + 5 = 30 tests.

- [ ] **Step 5: Commit**

```bash
git add pwa/supabase/functions/estimate-meal/prompt.ts pwa/supabase/functions/estimate-meal/prompt.test.ts
git commit -m "feat: prompt for pricing a written meal description"
```

---

### Task 3: Edge function accepts `text`

Restructures `estimate()` to take an options object — it is about to have five
call-shaping inputs and positional parameters stop being readable.

**Security note:** today the only in-code auth check is a side effect of
`underCap`, which returns `false` without an `Authorization` header and yields
a 429. The text path skips the cap, so that incidental check disappears with
it. An explicit header check replaces it. Platform JWT verification is also on
(there is no `[functions]` section in `supabase/config.toml` disabling it), but
an unauthenticated request must not be able to reach a paid API call on the
strength of a platform default alone.

**Files:**
- Modify: `pwa/supabase/functions/estimate-meal/index.ts`

**Interfaces:**
- Consumes: `systemPrompt`, `mealPrompt`, `itemPrompt`, `textPrompt` from
  `./prompt.ts`.
- Produces: `POST /estimate-meal` accepts
  `{image?: string, name?: string, items?: {name}[], itemIndex?: number, text?: string}`.
  At least one of `image` or a non-blank `text` is required. Response shape is
  unchanged.

- [ ] **Step 1: Widen the import**

Replace:

```ts
import { mealPrompt, itemPrompt, systemPrompt } from "./prompt.ts";
```

with:

```ts
import { mealPrompt, itemPrompt, systemPrompt, textPrompt } from "./prompt.ts";
```

- [ ] **Step 2: Rewrite `estimate()` to take an options object**

Replace the whole function signature and request body — from
`async function estimate(` down to and including the closing `});` of the
`fetch` call — with:

```ts
type EstimateArgs = {
  image?: unknown;
  name?: unknown;
  items?: unknown;
  itemIndex?: unknown;
  text?: unknown;
};

// Exactly one prompt is chosen here. With a photo: `items` + `itemIndex`
// re-price one item on the plate, `name` corrects the whole meal, neither is a
// first estimate. Without a photo it is a written description instead, and the
// system prompt drops the plate scale reference that would make no sense.
async function estimate({ image, name, items, itemIndex, text }: EstimateArgs) {
  const photo = typeof image === "string" && image !== "";
  const userText = photo
    ? (Array.isArray(items) ? itemPrompt(items, itemIndex) : mealPrompt(name))
    : textPrompt(text);
  const content: unknown[] = [];
  if (photo) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: image },
    });
  }
  content.push({ type: "text", text: userText });

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: systemPrompt({ photo }),
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    }),
  });
```

Leave everything below that — the `if (!resp.ok)` block, the `textBlock`
lookup, and the closing `}` — exactly as it is.

- [ ] **Step 3: Rewrite the handler's validation and dispatch**

Replace the whole `try` block body in `Deno.serve` with:

```ts
    const { image, name, items, itemIndex, text } = await req.json();

    // Auth is checked explicitly rather than relying on underCap's incidental
    // 429: the text path skips the cap, and an unauthenticated request must
    // never reach a paid API call.
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "unauthorized" }, 401);

    const hasImage = typeof image === "string" && image !== "";
    const hasText = typeof text === "string" && text.trim() !== "";
    if (!hasImage && !hasText) {
      return json({ error: "missing image or text" }, 400);
    }
    if (text !== undefined && text !== null && typeof text !== "string") {
      return json({ error: "invalid text" }, 400);
    }
    // Absent is fine (first estimate). Present-but-not-a-string is a client
    // bug worth surfacing; over-length is truncated in normalizeName, since
    // the realistic cause is a rambling description, not an attack.
    if (name !== undefined && name !== null && typeof name !== "string") {
      return json({ error: "invalid name" }, 400);
    }
    if (items !== undefined && !Array.isArray(items)) {
      return json({ error: "invalid items" }, 400);
    }
    // The cap counts saved photo meals and exists to bound image spend. Text
    // estimates cost no image tokens and are deliberately uncapped.
    if (hasImage && !(await underCap(auth))) {
      return json({ error: "daily photo limit reached" }, 429);
    }
    return await estimate({ image, name, items, itemIndex, text });
```

- [ ] **Step 4: Type-check the function**

Run from the repo root:

```bash
npx --yes deno@2 check pwa/supabase/functions/estimate-meal/index.ts
```

Expected: `Check file:///...index.ts` with no errors.

- [ ] **Step 5: Confirm the suite still passes**

Run from `pwa/`: `npx vitest run`
Expected: PASS — 9 files, 87 tests (76 before this plan + 11 from Tasks 1–2).

- [ ] **Step 6: Commit**

```bash
git add pwa/supabase/functions/estimate-meal/index.ts
git commit -m "feat: estimate-meal prices a written description without a photo"
```

---

### Task 4: Meal-name fallback helper

The fast path is: type the meal name, type one calorie number, Save — without
also typing that single item's name. The saved item inherits the meal name so
the row is not stored nameless.

**Files:**
- Modify: `pwa/src/lib/mealItems.js`
- Test: `pwa/src/lib/mealItems.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `withFallbackName(rows, fallback)` — operates on **save-shape** rows
  (`{name, calories, reasoning}`, no `key`), i.e. the output of `itemsForSave`.

- [ ] **Step 1: Write the failing test**

Add `withFallbackName` to the existing import in
`pwa/src/lib/mealItems.test.js`, then append:

```js
describe("withFallbackName", () => {
  it("gives a nameless row the fallback name", () => {
    const out = withFallbackName([{ name: "", calories: 90, reasoning: null }], "Toast");
    expect(out[0].name).toBe("Toast");
  });

  it("leaves an already-named row alone", () => {
    const out = withFallbackName([{ name: "egg", calories: 143, reasoning: null }], "Breakfast");
    expect(out[0].name).toBe("egg");
  });

  it("treats a whitespace-only name as nameless", () => {
    const out = withFallbackName([{ name: "   ", calories: 90, reasoning: null }], "Toast");
    expect(out[0].name).toBe("Toast");
  });

  it("preserves calories and reasoning untouched", () => {
    const out = withFallbackName([{ name: "", calories: 90, reasoning: "one slice" }], "Toast");
    expect(out[0]).toEqual({ name: "Toast", calories: 90, reasoning: "one slice" });
  });

  it("is empty for an empty list", () => {
    expect(withFallbackName([], "Toast")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/mealItems.test.js`
Expected: FAIL — `withFallbackName is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `pwa/src/lib/mealItems.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/mealItems.test.js`
Expected: PASS — 13 existing + 5 new = 18 tests.

- [ ] **Step 5: Commit**

```bash
git add pwa/src/lib/mealItems.js pwa/src/lib/mealItems.test.js
git commit -m "feat: meal-name fallback for a nameless item row"
```

---

### Task 5: `MealForm` with items and text estimation

Also lifts the estimate network call out of `PhotoMealForm` into a lib module
so both forms share one copy of the auth-and-fetch logic.

**Files:**
- Create: `pwa/src/lib/estimateMeal.js`
- Modify: `pwa/src/components/PhotoMealForm.jsx`
- Modify: `pwa/src/components/MealForm.jsx`

**Interfaces:**
- Consumes: `MealItemsEditor` (default export, props `{items, onChange,
  onRecalculate, busyIndex}`); `itemsTotal`, `itemsForSave`,
  `hasIncompleteItem`, `blankItem`, `withFallbackName` from
  `../lib/mealItems.js`; the `text` request contract from Task 3.
- Produces: `callEstimate(body)` from `../lib/estimateMeal.js` — POSTs the body
  with the session bearer token, throws on any non-OK response, returns the
  parsed JSON.

- [ ] **Step 1: Create the shared call**

Create `pwa/src/lib/estimateMeal.js`:

```js
import { supabase } from "../supabaseClient.js";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/estimate-meal`;

// Shared by the photo and manual meal forms. `body` is {image} for a first
// photo estimate, {image, items, itemIndex} to re-price one item, or {text} to
// price a written description. Throws on any non-OK response so callers can
// keep their existing estimate on screen.
export async function callEstimate(body) {
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
```

- [ ] **Step 2: Point `PhotoMealForm` at it**

In `pwa/src/components/PhotoMealForm.jsx`, delete the local `FUNCTION_URL`
constant and the entire local `callEstimate` function (including its comment
block), then add to the imports:

```jsx
import { callEstimate } from "../lib/estimateMeal.js";
```

Nothing else in that file changes — the call sites already pass an object.

- [ ] **Step 3: Rewrite `MealForm`**

Replace `pwa/src/components/MealForm.jsx` in full:

```jsx
import { useState } from "react";
import { supabase } from "../supabaseClient.js";
import { intakeDate } from "../lib/intakeDate.js";
import { callEstimate } from "../lib/estimateMeal.js";
import {
  itemsTotal, itemsForSave, hasIncompleteItem, blankItem, withFallbackName,
} from "../lib/mealItems.js";
import MealItemsEditor from "./MealItemsEditor.jsx";
import { input, button, buttonPrimary, textSecondary } from "../styles/ui.js";

export default function MealForm({ onSaved }) {
  const [mealName, setMealName] = useState("");
  // One blank row so the fast path - meal name, one number, Save - takes the
  // same interactions it always has.
  const [items, setItems] = useState([blankItem(0)]);
  const [estimating, setEstimating] = useState(false);
  const [estimateFailed, setEstimateFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  // Price the typed description. No photo, so the model works from stated
  // quantities. On failure the rows already on screen are left untouched.
  async function estimate() {
    setEstimateFailed(false);
    setEstimating(true);
    try {
      const est = await callEstimate({ text: mealName });
      setItems(
        (est.items ?? []).map((it, i) => ({
          key: i,
          name: it.name ?? "",
          calories: String(it.estimated_calories ?? ""),
          reasoning: it.reasoning ?? null,
        })),
      );
    } catch {
      setEstimateFailed(true);
    }
    setEstimating(false);
  }

  async function save(e) {
    e.preventDefault();
    setError(false);
    setSaving(true);
    const rows = withFallbackName(itemsForSave(items), mealName.trim());
    const { error } = await supabase.from("meals").insert({
      name: mealName,
      calories: itemsTotal(items),
      source: "manual",
      eaten_at: new Date().toISOString(),
      intake_date: intakeDate(),
      items: rows.length ? rows : null,
    });
    setSaving(false);
    if (error) {
      setError(true); // keep typed values so nothing is re-entered
    } else {
      setMealName("");
      setItems([blankItem(0)]);
      setEstimateFailed(false);
      onSaved();
    }
  }

  const total = itemsTotal(items);
  const incomplete = hasIncompleteItem(items);
  const savedRows = withFallbackName(itemsForSave(items), mealName.trim());
  const canSave = mealName.trim() !== "" && savedRows.length > 0 && !incomplete && !saving;

  return (
    <form onSubmit={save} style={{ margin: "1rem 0" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          required
          placeholder="Meal (e.g. 2 eggs and a sausage)"
          value={mealName}
          onChange={(e) => setMealName(e.target.value)}
          style={{ ...input, flex: 2, minWidth: 140 }}
        />
        <button
          type="button"
          onClick={estimate}
          disabled={estimating || !mealName.trim()}
          style={button}
        >
          {estimating ? "Estimating…" : "✨ Estimate"}
        </button>
      </div>
      <MealItemsEditor items={items} onChange={setItems} />
      <div style={{ margin: "12px 0", fontWeight: "var(--font-weight-emphasis)" }}>
        Total: {total} kcal
      </div>
      {incomplete && (
        <p style={textSecondary}>Give every named item a calorie number before saving.</p>
      )}
      {estimateFailed && (
        <p style={{ color: "var(--state-over-fg)" }}>
          Estimate failed — the items above are unchanged.
        </p>
      )}
      <button type="submit" disabled={!canSave} style={buttonPrimary}>
        {saving ? "Saving…" : "Log meal"}
      </button>
      {error && <span style={{ color: "var(--state-over-fg)", marginLeft: 8 }}>Save failed</span>}
    </form>
  );
}
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: `✓ built in …` with no errors. A failure naming `callEstimate` or
`FUNCTION_URL` means Step 2's deletion in `PhotoMealForm` was incomplete.

- [ ] **Step 5: Verify the suite still passes**

Run: `npx vitest run`
Expected: PASS — 9 files, 92 tests (87 after Task 3, plus 5 from Task 4).

- [ ] **Step 6: Commit**

```bash
git add pwa/src/lib/estimateMeal.js pwa/src/components/MealForm.jsx pwa/src/components/PhotoMealForm.jsx
git commit -m "feat: item breakdown and text estimation for manual meals"
```

---

### Task 6: Deploy and verify end to end

**Deploying changes live behavior and spends real API calls: confirm with the
owner before Steps 1 and 2.**

**Files:** none modified until Step 8.

- [ ] **Step 1: Push the client**

```bash
git push
gh run list --workflow=deploy-pwa.yml --limit 1
```

Expected: `completed  success`.

- [ ] **Step 2: Deploy the edge function**

```bash
cd pwa && npx --yes supabase@latest functions deploy estimate-meal --project-ref giydwqerqtikkbzwfeae
```

Expected: `Deployed Functions.` listing `estimate-meal`. If it fails on auth,
the owner runs `npx supabase login` — do not supply credentials.

- [ ] **Step 3: Text estimate**

Type "2 eggs and a sausage" into the manual meal field and press ✨ Estimate.
Expected: separate rows for the eggs and the sausage, each with a portion note,
the eggs priced as **two** eggs, and `Total:` equal to the sum.

- [ ] **Step 4: Hand edit wins over the model**

Change one returned item's calories by hand, then Log meal. Expand the meal on
the dashboard.
Expected: the breakdown shows the hand-typed number, not the model's.

- [ ] **Step 5: The fast path did not regress — the key check**

Type a meal name and a single calorie number into the first item row, without
pressing Estimate, then Log meal.
Expected: it saves in the same interactions it always took, and expanding it
shows a one-item breakdown named after the meal. If this needs the item named
separately, `withFallbackName` is not wired up.

- [ ] **Step 6: Failure is non-destructive**

With the phone offline, press ✨ Estimate.
Expected: "Estimate failed — the items above are unchanged." and every typed
value still present.

- [ ] **Step 7: The photo flow and its cap are untouched**

Photograph a meal and confirm the per-item confirm screen, ↻ recalculation, and
save all still work. Then confirm a run of text estimates has not consumed the
20/day photo budget — text estimates create `source: 'manual'` rows, which the
cap does not count:

```bash
cd /Users/unoa/garmin-health-tips && set -a && . ./.env && set +a && \
curl -s "$SUPABASE_URL/rest/v1/meals?select=name,source,items&order=eaten_at.desc&limit=5" \
  -H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY"
```

Expected: the text-estimated meals show `"source":"manual"` with a populated
`items` array.

- [ ] **Step 8: Mark the spec implemented**

Set the status line of
`docs/superpowers/specs/2026-07-20-manual-meal-items-and-text-estimate-design.md`
to `implemented <date>`, then:

```bash
git add docs/superpowers/specs/2026-07-20-manual-meal-items-and-text-estimate-design.md
git commit -m "docs: mark manual meal items and text estimate spec implemented"
git push
```

---

## Notes for the implementer

- **Do not** change `underCap` or how it counts. Text estimates save
  `source: 'manual'` rows, which it does not count — that is the entire
  mechanism keeping them uncapped. Do not "fix" it.
- `withFallbackName` runs **after** `itemsForSave`, never before. Reversed, a
  fully blank row would gain a name and be resurrected into the saved list
  instead of dropped.
- `MealItemsEditor` is rendered here **without** `onRecalculate`, so no ↻
  control appears. That is correct: there is no photo to re-read.
- `estimate()` in the edge function returns a `Response` (it calls `json(...)`
  itself), not a parsed object. Keep that shape.
- With a photo present, nothing about the request changes — same system prompt,
  same prompts, same cap check. Any diff in photo behavior is a bug.
- Never fabricate a `reasoning` string for a hand-typed item. Null is correct
  and the UI renders nothing for it.
