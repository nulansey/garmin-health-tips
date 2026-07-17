import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import WeightForm from "../components/WeightForm.jsx";
import WeightTrendChart from "../components/WeightTrendChart.jsx";

function hoursMinutes(seconds) {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function Dashboard() {
  const [days, setDays] = useState(null); // null = loading, [] = loaded empty
  const [error, setError] = useState(false);
  const [weights, setWeights] = useState(null);

  async function load() {
    setError(false);
    setDays(null);
    const { data, error } = await supabase
      .from("daily_metrics")
      .select("*")
      .order("date", { ascending: false })
      .limit(90);
    if (error) setError(true);
    else setDays(data);
  }

  async function loadWeights() {
    const { data } = await supabase
      .from("weights")
      .select("id, measured_at, weight")
      .order("measured_at", { ascending: true });
    setWeights(data ?? []);
  }

  useEffect(() => {
    load();
    loadWeights();
  }, []);

  if (error)
    return (
      <section>
        <p>Couldn't load Garmin data.</p>
        <button onClick={load}>Retry</button>
      </section>
    );
  if (days === null) return <p>Loading Garmin data…</p>;
  if (days.length === 0) return <p>No Garmin data yet.</p>;

  const today = days[0]; // newest first
  const stats = [
    ["Calories burned (in progress)", today.total_kcal ?? "—"],
    ["Steps", today.steps ?? "—"],
    ["Resting HR", today.resting_hr ?? "—"],
    ["Sleep", hoursMinutes(today.sleep_seconds)],
    ["Sleep score", today.sleep_score ?? "—"],
    ["Body battery high", today.body_battery_high ?? "—"],
    ["Body battery low", today.body_battery_low ?? "—"],
  ];

  return (
    <section>
      <h2>Today ({today.date})</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {stats.map(([label, value]) => (
          <li key={label} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span>{label}</span>
            <strong>{value}</strong>
          </li>
        ))}
      </ul>

      <h2>Weight</h2>
      <WeightForm onSaved={loadWeights} />
      {weights === null ? <p>Loading weight…</p> : <WeightTrendChart weights={weights} />}
    </section>
  );
}
