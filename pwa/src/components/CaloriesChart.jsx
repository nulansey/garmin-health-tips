import {
  ComposedChart, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { SERIES_COLORS, chartTheme } from "../styles/chartTheme.js";
import { dayIntake } from "../lib/balance.js";
import { isLowLog } from "../lib/lowLog.js";

const shortDate = (iso) => iso.slice(5).replace("-", "/");

// Burn line vs intake bars, last 30 days. Low-log days get no intake bar
// rather than a misleading near-zero one (same rule as sevenDayBalance).
export default function CaloriesChart({ days, meals }) {
  const data = days
    .slice(0, 30)
    .map((d) => ({
      date: shortDate(d.date),
      burn: d.total_kcal,
      intake: isLowLog(meals, d.date) ? null : dayIntake(meals, d.date),
    }))
    .reverse();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data}>
        <CartesianGrid stroke={chartTheme.grid} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: chartTheme.axisTick }} stroke={chartTheme.grid} />
        <YAxis tick={{ fontSize: 11, fill: chartTheme.axisTick }} stroke={chartTheme.grid} />
        <Tooltip {...chartTheme.tooltip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar name="Intake" dataKey="intake" fill={SERIES_COLORS.extra} radius={[2, 2, 0, 0]} />
        <Line name="Burn" type="monotone" dataKey="burn" stroke={SERIES_COLORS.burn} dot={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
