import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import { settingsErrors } from "../lib/settingsValidation.js";
import { input, button, buttonPrimary, textSecondary } from "../styles/ui.js";

const SLOT_NAMES = ["morning", "midday", "evening"];

export default function Settings({ onDone }) {
  const [s, setS] = useState(null);
  const [errors, setErrors] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | saving | saved | error

  useEffect(() => {
    supabase.from("settings").select("*").eq("id", 1).single().then(({ data }) => setS(data));
  }, []);

  if (s === null) return <p style={textSecondary}>Loading settings…</p>;

  function setSlot(name, patch) {
    setS({ ...s, slots: { ...s.slots, [name]: { ...s.slots[name], ...patch } } });
  }

  async function save(e) {
    e.preventDefault();
    const errs = settingsErrors(s);
    setErrors(errs);
    if (errs.length) return;
    setStatus("saving");
    const { error } = await supabase
      .from("settings")
      .update({
        goal_type: s.goal_type,
        goal_amount: s.goal_amount,
        weight_goal_lb: s.weight_goal_lb,
        slots: s.slots,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setStatus(error ? "error" : "saved");
  }

  return (
    <div style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Settings</h1>
        <button onClick={onDone} style={button}>Back</button>
      </header>
      <form onSubmit={save}>
        <h2>Calorie goal</h2>
        <select value={s.goal_type} onChange={(e) => setS({ ...s, goal_type: e.target.value })}
          style={{ ...input, marginRight: 8 }}>
          <option value="deficit">deficit</option>
          <option value="maintain">maintain</option>
          <option value="surplus">surplus</option>
        </select>
        <input type="number" value={s.goal_amount}
          onChange={(e) => setS({ ...s, goal_amount: Number(e.target.value) })}
          style={{ ...input, width: 120 }} /> kcal

        <h2>Weight goal</h2>
        <input type="number" step="0.1" value={s.weight_goal_lb}
          onChange={(e) => setS({ ...s, weight_goal_lb: Number(e.target.value) })}
          style={{ ...input, width: 120 }} /> lb

        <h2>Tip timing</h2>
        {SLOT_NAMES.map((name) => (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
            <input type="checkbox" checked={s.slots[name].enabled}
              onChange={(e) => setSlot(name, { enabled: e.target.checked })} />
            <span style={{ width: 80 }}>{name}</span>
            <input type="number" min="0" max="23" value={s.slots[name].hour}
              onChange={(e) => setSlot(name, { hour: Number(e.target.value) })}
              style={{ ...input, width: 70, padding: 6 }} /> :00
          </div>
        ))}

        {errors.map((msg) => <p key={msg} style={{ color: "var(--state-over-fg)" }}>{msg}</p>)}
        <button type="submit" disabled={status === "saving"} style={{ ...buttonPrimary, marginTop: 12 }}>
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {status === "saved" && <span style={{ color: "var(--state-good-fg)", marginLeft: 8 }}>Saved</span>}
        {status === "error" && <span style={{ color: "var(--state-over-fg)", marginLeft: 8 }}>Save failed</span>}
      </form>
    </div>
  );
}
