# Manual meal item breakdowns and text-only calorie estimation

**Date:** 2026-07-20
**Status:** approved, not yet implemented
**Depends on:** `2026-07-20-per-item-meal-breakdown-design.md` — this spec
consumes the `MealItemsEditor` component, the `meals.items` column, the
`reasoning` schema field, and the density table that spec introduces. It cannot
start until that one has landed.

**Scope:** Two changes to manual meal entry. First, a manually logged meal can
have the same item breakdown a photo meal has. Second, a typed description
("2 eggs and a sausage") can be priced by the model without a photo.

## Problem

Manual entry is one name and one calorie number. Two gaps follow:

1. A hand-logged meal cannot be broken into items, so it gets no expandable
   breakdown on the dashboard and no per-item structure — even though the
   `items` column and the editor both exist after the previous spec.
2. Pricing a hand-logged meal is entirely on the owner. For food with no photo —
   eaten out, already finished, or simply not worth photographing — there is no
   estimate available at all, despite the fact that a text description is often
   *easier* to price accurately than a photo. "2 eggs and a sausage" is a count
   against a known density with no portion inference required; a photo of the
   same plate requires guessing how big the eggs were.

## Decisions

1. **Manual meals use the same editor as photo meals.** `MealItemsEditor` is
   rendered by `MealForm` with `onRecalculate` omitted, so no per-item
   recalculate control appears — there is no photo to re-read.
2. **Text estimation is a separate action from saving.** Typing a description
   and pressing "Estimate" populates the item rows; it does not save. The owner
   reviews and edits before the meal is written, exactly as with a photo.
3. **The fast path stays fast.** One item row with a name and a number, then
   Save, is the same number of interactions manual entry takes today. Nothing
   about the current flow gets slower for someone who already knows the calorie
   count.
4. **Text estimates are uncapped.** They consume no image tokens and are
   materially cheaper than photo estimates. This matches the decision already
   made for recalculations. The 20/day photo cap is untouched and continues to
   count saved photo meals only.
5. **A text-estimated meal is still `source: 'manual'`.** The source column
   records how the row was *entered*, and this is the manual form. Leaving it
   `manual` also keeps the photo cap counting exactly what it counts today.
6. **No photo, no plate reference.** The system prompt's plate and bowl
   dimensions are meaningless without an image and are omitted for text-only
   calls, which otherwise invite the model to reason about a plate that does
   not exist.

## Architecture

### `pwa/supabase/functions/estimate-meal/prompt.ts`

- `systemPrompt({ photo })` — gains a parameter. With `photo: true` it is
  exactly the string the previous spec defines, plate and bowl included. With
  `photo: false` the plate and bowl sentences are dropped and the
  portion-estimation instruction is reworded to lean on stated quantities and
  typical serving sizes. The density table and the
  identify → grams → multiply method are present in both.
- `textPrompt(description)` — the user turn for a text-only estimate. Reuses
  `normalizeName` for the same 200-character cap and untrusted-input handling
  applied to every other owner-supplied string, and instructs the model to
  break the description into one item per distinct food, honouring stated
  counts ("2 eggs" is two eggs, not one).

### `pwa/supabase/functions/estimate-meal/index.ts`

The handler currently requires `image`. It becomes: **at least one of `image`
or `text` is required**, and the two paths are otherwise the same call.

- `image` present → today's behavior, `systemPrompt({photo: true})`, cap check
  applies.
- `image` absent, `text` present → `systemPrompt({photo: false})`,
  `textPrompt(text)`, message content is the text block alone with no image
  block, **cap check skipped** (decision 4).
- Neither present → the existing `missing image` 400, reworded to
  `missing image or text`.
- `text` present but not a string → 400, matching how `name` is already
  validated.

The response schema is unchanged, so both paths return the same
`{items: [{name, estimated_calories, reasoning}], total_calories}` and the
client parses one shape.

### `pwa/src/components/MealForm.jsx`

Rewritten around the shared editor while preserving the fast path:

- A meal name input, which doubles as the description for estimation.
- An "Estimate" button beside it, disabled while the name is empty and while a
  request is in flight. On success it replaces the item rows with the returned
  items; on failure it shows an inline message and leaves existing rows
  untouched, matching the recalculation failure behavior already shipped.
- `MealItemsEditor` with `onRecalculate` omitted, seeded with one blank row so
  that typing a name and a number and pressing Save is the current flow
  unchanged.
- The derived read-only total and the Save button.

Save inserts one `meals` row: the meal name, the summed item calories,
`source: 'manual'`, and the items array — reusing `itemsTotal` and
`itemsForSave` from the previous spec rather than reimplementing either.

When the owner never touches the item editor beyond the first row, the saved
`items` is a single-element array. That is intentional and harmless: the
dashboard's expand arrow shows a one-item breakdown, which is accurate.

### `pwa/src/pages/Dashboard.jsx`

No changes. The previous spec's arrow condition is "has items", not "is a photo
meal", so manual meals with breakdowns get the arrow for free.

## Testing

Automated, extending `prompt.test.ts`:

- `systemPrompt({photo: true})` contains the plate and bowl dimensions;
  `systemPrompt({photo: false})` contains neither, and both contain the density
  table and the grams-then-multiply instruction.
- `textPrompt` embeds the description, instructs one item per distinct food,
  preserves stated counts, and truncates at 200 characters like every other
  owner-supplied string.
- Blank and non-string descriptions are handled the same way blank names
  already are.

Manual:

1. Type "2 eggs and a sausage" and press Estimate. Confirm three-ish item rows
   appear with plausible per-item numbers, the eggs are counted as two, and the
   total equals the sum.
2. Edit one returned item's calories by hand, then Save. Expand the meal on the
   dashboard and confirm the edited number persisted, not the model's.
3. Type a name and a calorie number into the first row without pressing
   Estimate, then Save. Confirm it saves as it always has — this is the check
   that the fast path did not regress.
4. Press Estimate with the phone offline. Confirm an inline failure message and
   that existing rows are untouched.
5. Confirm the photo flow still works end to end and its 20/day cap still
   counts only photo meals — a run of text estimates must not consume it.

## Out of scope

- Any live nutrition API (settled in the previous spec).
- Editing a meal after it is saved, manual or photo.
- Text estimation for a single item inside the photo flow — the photo flow's
  per-item recalculation already covers correcting an item there, and a
  photo-less single-item estimate is a different affordance with no demand yet.
- Voice or barcode entry.
- Changing the 20/day photo cap or how it is counted.
