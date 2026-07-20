import { useState } from "react";
import { supabase } from "../supabaseClient.js";
import { input, buttonPrimary, button, textSecondary } from "../styles/ui.js";

// Email + password login. Kept fully in-app (no email round-trip) so the
// session lands in this context's storage and survives relaunch - the
// magic-link flow broke on iOS home-screen PWAs, which can't see the session
// Safari stored when the link opened there. First-time/forgotten passwords
// go through resetPasswordForEmail -> App shows the SetPassword screen.
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(null); // null | "error" | "need-email" | "reset-sent"
  const [busy, setBusy] = useState(false);

  async function signIn(e) {
    e.preventDefault();
    setStatus(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setStatus("error"); // success flips App's session -> dashboard
  }

  async function sendReset() {
    if (!email) return setStatus("need-email");
    setStatus(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + import.meta.env.BASE_URL,
    });
    setStatus(error ? "error" : "reset-sent");
  }

  return (
    <form onSubmit={signIn} style={{ maxWidth: 320, margin: "4rem auto" }}>
      <h1>Sign in</h1>
      <input
        type="email" required autoComplete="username" placeholder="you@example.com"
        value={email} onChange={(e) => setEmail(e.target.value)}
        style={{ ...input, width: "100%", marginBottom: 8, boxSizing: "border-box" }}
      />
      <input
        type="password" required autoComplete="current-password" placeholder="Password"
        value={password} onChange={(e) => setPassword(e.target.value)}
        style={{ ...input, width: "100%", marginBottom: 8, boxSizing: "border-box" }}
      />
      <button type="submit" disabled={busy} style={{ ...buttonPrimary, width: "100%" }}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <button type="button" onClick={sendReset}
        style={{ ...button, width: "100%", marginTop: 8, background: "none", border: "none", color: "var(--text-secondary)" }}>
        Set or reset password
      </button>
      {status === "error" && <p style={{ color: "var(--state-over-fg)" }}>Sign-in failed — check your details or reset your password.</p>}
      {status === "need-email" && <p style={textSecondary}>Enter your email first, then tap “Set or reset password.”</p>}
      {status === "reset-sent" && <p style={textSecondary}>Check your email for a link to set your password.</p>}
    </form>
  );
}
