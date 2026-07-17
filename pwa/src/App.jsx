import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <p style={{ margin: "4rem auto", textAlign: "center" }}>Loading…</p>;
  if (!session) return <Login />;

  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", padding: "0 1rem" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Calories</h1>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <Dashboard />
    </div>
  );
}
