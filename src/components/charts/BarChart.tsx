import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { OriginData } from "@/lib/utils/metrics";
import { ChartCard } from "./ChartCard";

interface BarChartProps {
  data: OriginData[];
  title: string;
}

const chartColors = {
  axis: "var(--color-gray-400)",
  grid: "var(--color-gray-100)",
  primary: "var(--color-chart-primary)",
  success: "var(--color-chart-green)",
  surface: "var(--color-surface-1)",
  inverse: "var(--color-bg-inverse)",
};

export function BarChart({ data, title }: BarChartProps) {
  return (
    <ChartCard title={title}>
      <div className="chart-scroll">
        <ResponsiveContainer width="100%" height={300} minHeight={300}>
          <RechartsBarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid stroke={chartColors.grid} />

            <XAxis
              dataKey="origem"
              stroke={chartColors.axis}
              fontSize={10}
              tick={{ fontSize: 10, fill: chartColors.axis }}
            />

            <YAxis
              yAxisId="left"
              stroke={chartColors.axis}
              fontSize={10}
              tick={{ fontSize: 10, fill: chartColors.axis }}
              domain={[0, (dataMax: number) => dataMax + 500]}
            />

            <YAxis
              yAxisId="right"
              orientation="right"
              tick={false}
              stroke="transparent"
              domain={[0, (dataMax: number) => dataMax + 1]}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: chartColors.inverse,
                border: "none",
                borderRadius: "var(--radius-lg)",
                boxShadow: "var(--shadow-md)",
                color: chartColors.surface,
                fontFamily: "var(--font-family-mono)",
                fontSize: "var(--text-xs)",
              }}
              labelStyle={{ color: chartColors.surface, fontWeight: 600 }}
              itemStyle={{ color: chartColors.surface }}
              wrapperStyle={{ zIndex: 1000 }}
            />

            <Legend wrapperStyle={{ color: "var(--color-gray-600)", fontFamily: "var(--font-family-mono)", fontSize: "var(--text-xs)" }} />

            <Bar dataKey="leads" fill={chartColors.primary} name="Leads" radius={[6, 6, 0, 0]} yAxisId="right" />

            <Bar
              dataKey="ganhos"
              fill={chartColors.success}
              name="Ganhos (R$)"
              radius={[6, 6, 0, 0]}
              yAxisId="left"
            />
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
