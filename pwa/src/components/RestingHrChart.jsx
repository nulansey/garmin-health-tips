import {
  ComposedChart, Area, Line, CartesianGrid, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { SERIES_COLORS, chartTheme } from "../styles/chartTheme.js";

const shortDate = (iso) => iso.slice(5).replace("-", "/");

// Daily resting HR against a shaded trailing-30-day-average band (±2 bpm).
// Days outside the band are the signal - illness, poor recovery, or a real
// fitness shift. `days` is newest-first; chart shows all fetched days.
export default function RestingHrChart({ days }) {
  const data = days
    .map((d, i) => {
      const window = days
        .slice(i + 1, i + 31)
        .map((p) => p.resting_hr)
        .filter((v) => v != null);
      const avg = window.length >= 3
        ? window.reduce((a, b) => a + b, 0) / window.length
        : null;
      return {
        date: shortDate(d.date),
        rhr: d.resting_hr,
        band: avg == null ? null : [Math.round(avg) - 2, Math.round(avg) + 2],
      };
    })
    .reverse();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data}>
        <CartesianGrid stroke={chartTheme.grid} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: chartTheme.axisTick }} stroke={chartTheme.grid} />
        <YAxis domain={["dataMin - 3", "dataMax + 3"]} tick={{ fontSize: 11, fill: chartTheme.axisTick }} stroke={chartTheme.grid} />
        <Tooltip {...chartTheme.tooltip} formatter={(v, name) => (name === "30d band" ? `${v[0]}–${v[1]}` : v)} />
        <Area name="30d band" dataKey="band" fill={SERIES_COLORS.rhr} fillOpacity={0.15} stroke="none" />
        <Line name="Resting HR" type="monotone" dataKey="rhr" stroke={SERIES_COLORS.rhr} dot={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
