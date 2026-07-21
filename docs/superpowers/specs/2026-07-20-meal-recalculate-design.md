# Recalculate a photo estimate from a corrected meal name

**Date:** 2026-07-20
**Status:** implemented 2026-07-21

**Scope:** On the photo-meal confirm screen, let the owner correct the meal
name and re-run the calorie estimate against the same photo. Fixes the case
where the model misidentifies a food — tofu for chicken — and every downstream
number inherits the error.

## Problem

`PhotoMealForm` posts a photo to the `estimate-meal` edge function, shows the
returned name and calorie total on a confirm screen, and saves on submit. Both
fields are editable, but editing the name does nothing to the calories. To fix
a misidentified food today the owner has to guess the corrected calorie number
by hand, which defeats the point of the photo estimate.

## Decisions

1. **Confirm screen only.** Recalculation is available between the estimate and
   the save, while the resized image is still in memory. Already-saved meals
   cannot be recalculated — that would require storing photos, reversing
   decision #3 of `2026-07-17-meals-vision-calibration-design.md` ("photos are
   never stored"). That decision stands.
2. **Uncapped.** Recalculations do not count against the 20/day photo cap and
   are not separately limited. This is a single-user app and the calls are
   cheap. The button is disabled while a request is in flight, which prevents
   accidental double-taps; that is UI correctness, not a quota.
3. **The typed name is authoritative.** When a name is supplied, it is ground
   truth for *what* the food is; the photo is used only to judge *how much*.
   This is what makes the feature fix misidentification rather than merely
   re-rolling the same guess.
4. **Only calories update.** A recalculation overwrites the calorie field and
   leaves the name exactly as typed. Rewriting the name would undo the
   correction the owner just made.
5. **Extend the existing endpoint.** `estimate-meal` takes an optional `name`
   rather than gaining a sibling function. A separate endpoint would duplicate
   the schema, CORS handling, and cap check to run the same model call.

## Architecture

### Client — `pwa/src/components/PhotoMealForm.jsx`

The resized base64 currently lives in a local variable inside `onPick` and is
unreachable once the confirm screen renders. It moves into component state so
the confirm screen can re-post it. It is still never persisted: it is dropped
when the meal is saved or cancelled, and never written to Supabase.

The confirm screen gains a "Recalculate" button beside Save and Cancel. It
posts `{ image, name }` to the same function URL with the same bearer token,
and on success writes only `total_calories` into the calorie field.

Status handling extends the existing `status` state machine with a
`recalculating` value. While in that state the Recalculate button is disabled
and reads "Recalculating…"; Save and Cancel stay live.

### Edge function — `pwa/supabase/functions/estimate-meal/index.ts`

The request body accepts an optional `name: string`. When absent or empty the
function behaves exactly as it does today — same system prompt, same schema,
same response — so the first estimate of every meal is unchanged.

When present, the user-supplied name is appended to the text block of the
message as a correction: the food is identified by the owner, and the model's
job is reduced to portion estimation from the photo and the known plate and
bowl diameters. The response schema is unchanged, so the client parses one
shape in both cases.

The name is untrusted free text from a form field. It is capped at 200
characters and embedded as a labelled value in the user text block rather than
concatenated into the system prompt, so a long or adversarial string cannot
displace the portion-size instructions. A non-string `name` is rejected with a
400 alongside the existing `missing image` check; an over-length string is
truncated rather than rejected, since the realistic cause is a rambling meal
description, not an attack.

### Pure helper — `pwa/supabase/functions/estimate-meal/prompt.ts`

Prompt building happens server-side, so the helper lives beside the function
that uses it rather than in `pwa/src/lib/` — a client-side copy would be dead
code, since the client only sends the raw name.

The module is plain TypeScript with no Deno APIs (no `Deno.env`, no network),
so vitest can import it directly and the same file is both shipped and tested.
`index.ts` imports it; nothing is duplicated across the two runtimes.

Exports `mealPrompt(name)`, returning the text block for the vision call:
the unchanged default sentence when there is no usable name, and the
correction phrasing when there is. Name normalisation — trim, treat empty as
absent, truncate to `MAX_NAME` (200 characters) — lives here too, so the
length cap is enforced in one place and covered by the same tests.

## Testing

`pwa/supabase/functions/estimate-meal/prompt.test.ts` covers: no name returns
the plain prompt unchanged; a name produces the correction phrasing; empty and
whitespace-only names are treated as absent; a name over 200 characters is
truncated. Run with the existing `npx vitest run` from `pwa/`.

Vitest's default `include` glob reaches outside `src/`, so these tests are
picked up without config changes. Verified on 2026-07-20 with a throwaway test
at that exact path: vitest collected it and ran it. There is no
`vitest.config` in `pwa/`, so the defaults apply.

Manual check, since the vision call cannot be asserted on: photograph a meal,
change the name to something clearly different ("salad" → "cheeseburger"), tap
Recalculate, and confirm the calorie figure moves in the expected direction and
the name field is untouched.

## Out of scope

- Recalculating already-saved meals (requires photo storage — see decision 1).
- Storing photos in any form.
- Changing the 20/day photo cap or how it is counted.
- Re-shooting a photo for an existing meal.
