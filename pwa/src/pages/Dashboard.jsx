import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient.js";
import WeightForm from "../components/WeightForm.jsx";
import WeightTrendChart from "../components/WeightTrendChart.jsx";
import MealForm from "../components/MealForm.jsx";
import PhotoMealForm from "../components/PhotoMealForm.jsx";
import { intakeDate } from "../lib/intakeDate.js";
import { dayIntake, sevenDayBalance, deficitState } from "../lib/balance.js";
import { calibrationFactor } from "../lib/calibration.js";
import { isLowLog } from "../lib/lowLog.js";
import { card, badge, button, textSecondary, textMuted } from "../styles/ui.js";

function hoursMinutes(seconds) {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function StatTile({ label, value }) {
  return (
    <div style={{ ...card, padding: 12 }}>
      <div style={{ ...textSecondary, fontSize: 13 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: "var(--font-weight-emphasis)" }}>{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState(null); // null = loading, [] = loaded empty
  const [error, setError] = useState(false);
  const [weights, setWeights] = useState(null);
  const [meals, setMeals] = useState(null);
  const [goal, setGoal] = useState(null);

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

  async function loadMeals() {
    const { data } = await supabase
      .from("meals")
      .select("id, intake_date, name, calories")
      .order("eaten_at", { ascending: false });
    setMeals(data ?? []);
  }

  async function deleteMeal(id) {
    await supabase.from("meals").delete().eq("id", id);
    loadMeals();
  }

  async function loadGoal() {
    const { data } = await supabase
      .from("settings")
      .select("goal_type, goal_amount")
      .eq("id", 1)
      .single();
    setGoal(data ?? null);
  }

  useEffect(() => {
    load();
    loadWeights();
    loadMeals();
    loadGoal();
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
  const todayBucket = intakeDate();
  const burnToday = today.total_kcal; // may be null - Garmin hasn't synced yet
  const inToday = meals ? dayIntake(meals, todayBucket) : null;
  const balanceToday = burnToday == null || inToday == null ? null : burnToday - inToday;
  const state = balanceToday == null || goal == null ? null : deficitState(balanceToday, goal.goal_type, goal.goal_amount);
  const weekBalance = meals ? sevenDayBalance(days, meals, todayBucket) : null;
  const todayMeals = meals ? meals.filter((m) => m.intake_date === todayBucket) : [];
  const lowLog = meals ? isLowLog(meals, todayBucket) : false;

  const tiles = [
    ["Calories in", meals === null ? "—" : inToday],
    ["Calories out", burnToday ?? "—"],
    ["Steps", today.steps ?? "—"],
    ["Resting HR", today.resting_hr ?? "—"],
    ["Sleep", hoursMinutes(today.sleep_seconds)],
    ["Sleep score", today.sleep_score ?? "—"],
    ["Body battery high", today.body_battery_high ?? "—"],
    ["Body battery low", today.body_battery_low ?? "—"],
    ["7-day balance", weekBalance ?? "—"],
  ];

  return (
    <section>
      <div style={{ ...card, ...(state ? badge[state] : {}), padding: 20, marginBottom: 20 }}>
        <div style={{ ...textSecondary, fontSize: 14 }}>
          Today's balance{lowLog ? " — low log, not reliable" : ""}
        </div>
        <div style={{ fontSize: 48, fontWeight: "var(--font-weight-emphasis)", lineHeight: 1.1 }}>
          {balanceToday == null ? "—" : balanceToday}
        </div>
      </div>

      <h2>Today ({today.date})</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8, marginBottom: 16 }}>
        {tiles.map(([label, value]) => (
          <StatTile key={label} label={label} value={value} />
        ))}
      </div>

      {meals === null ? (
        <p style={textSecondary}>Loading meals…</p>
      ) : (
        <div>
          {(() => {
            const cal = calibrationFactor({
              days, meals, weights: weights ?? [], endDate: todayBucket,
            });
            if (!cal) return <p style={textMuted}>Calibration: need ~3 weeks of logs and weigh-ins.</p>;
            const pct = Math.round((cal.factor - 1) * 100);
            return (
              <p style={textMuted}>
                Calibration ({cal.usableDays} usable days): scale shows {cal.actualLb.toFixed(1)} lb vs {cal.predictedLb.toFixed(1)} lb predicted.
                {pct > 0
                  ? ` You likely eat ~${pct}% more than you log.`
                  : ` Your logs track the scale closely.`}
              </p>
            );
          })()}
          <MealForm onSaved={loadMeals} />
          <PhotoMealForm onSaved={loadMeals} />
          <ul style={{ listStyle: "none", padding: 0 }}>
            {todayMeals.map((m) => (
              <li key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                <span>{m.name} — {m.calories}</span>
                <button onClick={() => deleteMeal(m.id)} style={{ ...button, padding: "2px 8px" }}>Delete</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2>Weight</h2>
      <WeightForm onSaved={loadWeights} />
      {weights === null ? <p style={textSecondary}>Loading weight…</p> : <WeightTrendChart weights={weights} />}
    </section>
  );
}
