import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { RevenueByVendor } from "@/lib/utils/metrics";
import { ChartCard } from "./ChartCard";

interface RevenueByVendorChartProps {
  data: RevenueByVendor[];
  title: string;
}

const chartColors = {
  axis: "var(--color-gray-400)",
  grid: "var(--color-gray-100)",
  surface: "var(--color-surface-1)",
  inverse: "var(--color-bg-inverse)",
};

const seriesColors = [
  "var(--color-chart-primary)",
  "var(--color-chart-blue)",
  "var(--color-chart-green)",
  "var(--color-chart-purple)",
  "var(--color-chart-graphite)",
];

export function RevenueByVendorChart({ data, title }: RevenueByVendorChartProps) {
  const formattedData = data.map((item) => ({
    ...item,
    receitaFormatted: new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 0,
    }).format(item.receita),
  }));

  return (
    <ChartCard title={title}>
      <div className="chart-scroll">
        <ResponsiveContainer width="100%" height={300} minHeight={300}>
          <RechartsBarChart data={formattedData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }} layout="vertical">
            <CartesianGrid stroke={chartColors.grid} />

            <XAxis
              type="number"
              stroke={chartColors.axis}
              fontSize={10}
              tick={{ fontSize: 10, fill: chartColors.axis }}
              tickFormatter={(value) =>
                new Intl.NumberFormat("pt-BR", {
                  notation: "compact",
                  compactDisplay: "short",
                }).format(value)
              }
            />

            <YAxis
              type="category"
              dataKey="responsavel"
              stroke={chartColors.axis}
              fontSize={11}
              tick={{ fontSize: 11, fill: chartColors.axis }}
              width={90}
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
              formatter={(value: number, name) => [
                new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(value),
                name,
              ]}
              labelFormatter={(label) => `Vendedor: ${label}`}
              wrapperStyle={{ zIndex: 1000 }}
            />

            <Bar dataKey="receita" name="Receita" radius={[0, 6, 6, 0]}>
              {formattedData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={seriesColors[index % seriesColors.length]} className="transition-opacity hover:opacity-80" />
              ))}
            </Bar>
          </RechartsBarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
