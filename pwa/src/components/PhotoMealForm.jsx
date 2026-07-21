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
