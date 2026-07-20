import { useState } from "react";
import { supabase } from "../supabaseClient.js";
import { input, buttonPrimary, button, textSecondary } from "../styles/ui.js";

// Shown when a reset/recovery link is opened (App detects PASSWORD_RECOVERY).
// The recovery grant is already an authenticated session, so updateUser can
// set the password directly.
export default function SetPassword({ onDone }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(null); // null | "error" | "saved"
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    setStatus(error ? "error" : "saved");
  }

  return (
    <form onSubmit={save} style={{ maxWidth: 320, margin: "4rem auto" }}>
      <h1>Set a password</h1>
      <input
        type="password" required minLength={8} autoComplete="new-password"
        placeholder="New password (8+ characters)"
        value={password} onChange={(e) => setPassword(e.target.value)}
        style={{ ...input, width: "100%", marginBottom: 8, boxSizing: "border-box" }}
      />
      <button type="submit" disabled={busy} style={{ ...buttonPrimary, width: "100%" }}>
        {busy ? "Saving…" : "Save password"}
      </button>
      {status === "saved" && (
        <p style={textSecondary}>
          Password saved.{" "}
          <button type="button" onClick={onDone}
            style={{ ...button, background: "none", border: "none", color: "var(--accent)", padding: 0 }}>
            Continue
          </button>
        </p>
      )}
      {status === "error" && <p style={{ color: "var(--state-over-fg)" }}>Couldn’t save — try again.</p>}
    </form>
  );
}
