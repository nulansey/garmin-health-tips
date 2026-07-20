import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { chartTheme } from "../styles/chartTheme.js";

const shortDate = (iso) => iso.slice(5).replace("-", "/");
const hours = (s) => (s == null ? null : Math.round((s / 3600) * 10) / 10);

// Nightly sleep stages stacked in one hue (light -> dark = light/REM/deep),
// last 30 days. Sleep score rides in the tooltip label - no second axis.
export default function SleepChart({ days }) {
  const data = days
    .slice(0, 30)
    .map((d) => {
      const total = d.sleep_seconds;
      const deep = d.deep_sleep_seconds ?? 0;
      const rem = d.rem_sleep_seconds ?? 0;
      return {
        date: shortDate(d.date),
        deep: total == null ? null : hours(deep),
        rem: total == null ? null : hours(rem),
        light: total == null ? null : hours(Math.max(0, total - deep - rem)),
        score: d.sleep_score,
      };
    })
    .reverse();
  const seg = { stroke: "var(--surface-card)", strokeWidth: 1 };
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid stroke={chartTheme.grid} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: chartTheme.axisTick }} stroke={chartTheme.grid} />
        <YAxis unit="h" tick={{ fontSize: 11, fill: chartTheme.axisTick }} stroke={chartTheme.grid} />
        <Tooltip
          {...chartTheme.tooltip}
          labelFormatter={(label, payload) => {
            const score = payload?.[0]?.payload?.score;
            return score == null ? label : `${label} · score ${score}`;
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar name="Deep" dataKey="deep" stackId="sleep" fill="var(--series-sleep-deep)" {...seg} />
        <Bar name="REM" dataKey="rem" stackId="sleep" fill="var(--series-sleep-rem)" {...seg} />
        <Bar name="Light" dataKey="light" stackId="sleep" fill="var(--series-sleep-light)"
          radius={[2, 2, 0, 0]} {...seg} />
      </BarChart>
    </ResponsiveContainer>
  );
}
