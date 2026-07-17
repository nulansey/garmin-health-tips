import { useState } from "react";
import { supabase } from "../supabaseClient.js";

export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(null); // null | "sent" | "error"

  async function sendLink(e) {
    e.preventDefault();
    setStatus(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
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
        style={{ width: "100%", padding: 8, marginBottom: 8 }}
      />
      <button type="submit" style={{ width: "100%", padding: 8 }}>
        Send magic link
      </button>
      {status === "sent" && <p>Check your email for the link.</p>}
      {status === "error" && <p>Something went wrong — try again.</p>}
    </form>
  );
}
