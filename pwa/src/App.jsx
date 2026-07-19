import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Settings from "./pages/Settings.jsx";
import { button, textSecondary } from "./styles/ui.js";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <p style={{ ...textSecondary, margin: "4rem auto", textAlign: "center" }}>Loading…</p>;
  if (!session) return <Login />;

  if (view === "settings") return <Settings onDone={() => setView("dashboard")} />;

  return (
    <div style={{ maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Calories</h1>
        <div>
          <button onClick={() => setView("settings")} style={{ ...button, marginRight: 8 }}>⚙️ Settings</button>
          <button onClick={() => supabase.auth.signOut()} style={button}>Sign out</button>
        </div>
      </header>
      <Dashboard />
    </div>
  );
}
