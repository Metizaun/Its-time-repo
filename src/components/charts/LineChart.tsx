import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { DailyData } from "@/lib/utils/metrics";
import { ChartCard } from "./ChartCard";

interface LineChartProps {
  data: DailyData[];
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

export function LineChart({ data, title }: LineChartProps) {
  return (
    <ChartCard title={title}>
      {data.length === 0 ? (
        <div className="empty-state">Sem registros no periodo</div>
      ) : (
        <div className="chart-scroll">
          <ResponsiveContainer width="100%" height={300} minHeight={300}>
            <RechartsLineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid stroke={chartColors.grid} />

              <XAxis
                dataKey="date"
                stroke={chartColors.axis}
                fontSize={10}
                tick={{ fontSize: 10, fill: chartColors.axis }}
              />

              <YAxis
                yAxisId="left"
                stroke={chartColors.axis}
                fontSize={10}
                tick={{ fontSize: 10, fill: chartColors.axis }}
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

              <Line
                type="monotone"
                dataKey="leads"
                stroke={chartColors.primary}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                name="Leads"
                yAxisId="left"
                dot={{ fill: chartColors.primary, stroke: chartColors.surface, strokeWidth: 2, r: 4 }}
                activeDot={{ r: 5 }}
              />

              <Line
                type="monotone"
                dataKey="ganhos"
                stroke={chartColors.success}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                name="Ganhos"
                yAxisId="left"
                dot={{ fill: chartColors.success, stroke: chartColors.surface, strokeWidth: 2, r: 4 }}
                activeDot={{ r: 5 }}
              />
            </RechartsLineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
