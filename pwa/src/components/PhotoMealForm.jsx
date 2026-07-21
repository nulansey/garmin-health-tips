import { useState } from "react";
import { supabase } from "../supabaseClient.js";
import { intakeDate } from "../lib/intakeDate.js";
import { resizeImage } from "../lib/resizeImage.js";
import { input, button, buttonPrimary } from "../styles/ui.js";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/estimate-meal`;

// Posts the photo for a calorie estimate. `name`, when given, tells the model
// what the food actually is so it only has to judge portion size - that is how
// a misidentified meal gets corrected. Throws on any non-OK response.
async function callEstimate(image, name) {
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(name ? { image, name } : { image }),
  });
  if (!resp.ok) throw new Error("estimate failed");
  return await resp.json();
}

export default function PhotoMealForm({ onSaved }) {
  // idle | estimating | confirm | recalculating | error
  const [status, setStatus] = useState("idle");
  const [name, setName] = useState("");
  const [calories, setCalories] = useState("");
  // Kept only so the confirm screen can re-estimate. Never persisted, and
  // dropped on save or cancel.
  const [image, setImage] = useState(null);
  const [recalcFailed, setRecalcFailed] = useState(false);

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("estimating");
    try {
      const b64 = await resizeImage(file);
      const est = await callEstimate(b64);
      setImage(b64);
      setName(est.items?.map((i) => i.name).join(", ") || "Meal");
      setCalories(String(est.total_calories ?? ""));
      setStatus("confirm");
    } catch {
      setStatus("error");
    }
  }

  // Re-price the same photo against the corrected name. Only the calorie field
  // changes - the name was just typed by hand, so overwriting it would undo
  // the correction. On failure the existing estimate is left intact.
  async function recalculate() {
    setRecalcFailed(false);
    setStatus("recalculating");
    try {
      const est = await callEstimate(image, name);
      setCalories(String(est.total_calories ?? ""));
    } catch {
      setRecalcFailed(true);
    }
    setStatus("confirm");
  }

  function reset() {
    setStatus("idle");
    setName("");
    setCalories("");
    setImage(null);
    setRecalcFailed(false);
  }

  async function confirm(e) {
    e.preventDefault();
    const { error } = await supabase.from("meals").insert({
      name,
      calories: Number(calories),
      source: "photo",
      eaten_at: new Date().toISOString(),
      intake_date: intakeDate(),
    });
    if (error) { setStatus("error"); return; }
    reset();
    onSaved();
  }

  if (status === "confirm" || status === "recalculating") {
    const busy = status === "recalculating";
    return (
      <form onSubmit={confirm} style={{ display: "flex", gap: 8, margin: "1rem 0", flexWrap: "wrap" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} required
          style={{ ...input, flex: 2, minWidth: 120 }} />
        <input type="number" value={calories} onChange={(e) => setCalories(e.target.value)} required
          style={{ ...input, flex: 1, minWidth: 90 }} />
        <button type="button" onClick={recalculate} disabled={busy} style={button}>
          {busy ? "Recalculating…" : "↻ Recalculate"}
        </button>
        <button type="submit" style={buttonPrimary}>Save</button>
        <button type="button" onClick={reset} style={button}>Cancel</button>
        {recalcFailed && (
          <span style={{ color: "var(--state-over-fg)", width: "100%" }}>
            Recalculate failed — the estimate above is unchanged.
          </span>
        )}
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
