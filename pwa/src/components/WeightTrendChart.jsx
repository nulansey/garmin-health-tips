import {
  ComposedChart, Line, Scatter, ReferenceLine,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

const GOAL_WEIGHT = 155;

function withRollingAvg(weights) {
  // weights: [{ measured_at, weight }], any order. Returns points sorted
  // oldest-first with a 7-day trailing average attached to each.
  const sorted = [...weights].sort(
    (a, b) => new Date(a.measured_at) - new Date(b.measured_at)
  );
  return sorted.map((w) => {
    const t = new Date(w.measured_at).getTime();
    const window = sorted.filter((o) => {
      const dt = t - new Date(o.measured_at).getTime();
      return dt >= 0 && dt <= 7 * 24 * 3600 * 1000;
    });
    const avg = window.reduce((s, o) => s + Number(o.weight), 0) / window.length;
    return {
      date: new Date(w.measured_at).toLocaleDateString(),
      weight: Number(w.weight),
      avg: Math.round(avg * 10) / 10,
    };
  });
}

export default function WeightTrendChart({ weights }) {
  if (!weights || weights.length === 0) return <p>No weight entries yet.</p>;
  const data = withRollingAvg(weights);
  // Include GOAL_WEIGHT in the range so the reference line is always visible,
  // not just when actual weight happens to be near the goal.
  const values = data.flatMap((d) => [d.weight, d.avg]).concat(GOAL_WEIGHT);
  const domain = [Math.floor(Math.min(...values) - 3), Math.ceil(Math.max(...values) + 3)];
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data}>
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis domain={domain} tick={{ fontSize: 11 }} />
        <Tooltip />
        <ReferenceLine y={GOAL_WEIGHT} stroke="#16a34a" strokeDasharray="4 4"
          label={{ value: `Goal ${GOAL_WEIGHT}`, position: "insideTopRight", fontSize: 11 }} />
        <Scatter dataKey="weight" fill="#cbd5e1" />
        <Line type="monotone" dataKey="avg" stroke="#0f172a" dot={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
