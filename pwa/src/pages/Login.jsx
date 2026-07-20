import { useState } from "react";
import { supabase } from "../supabaseClient.js";
import { input, buttonPrimary, textSecondary } from "../styles/ui.js";

export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(null); // null | "sent" | "error"

  async function sendLink(e) {
    e.preventDefault();
    setStatus(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    setStatus(error ? "error" : "sent");
  }

  return (
    <form onSubmit={sendLink} style={{ maxWidth: 320, margin: "4rem auto" }}>
      <h1>Sign in</h1>
      <input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ ...input, width: "100%", marginBottom: 8, boxSizing: "border-box" }}
      />
      <button type="submit" style={{ ...buttonPrimary, width: "100%" }}>
        Send magic link
      </button>
      {status === "sent" && <p style={textSecondary}>Check your email for the link.</p>}
      {status === "error" && <p style={{ color: "var(--state-over-fg)" }}>Something went wrong — try again.</p>}
    </form>
  );
}
