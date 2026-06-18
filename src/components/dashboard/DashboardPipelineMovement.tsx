import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard } from "@/components/charts/ChartCard";
import { DashboardLeadHeatmap } from "@/components/dashboard/DashboardLeadHeatmap";
import type { DashboardHeatmapCell, DashboardLeadEvolutionItem } from "@/types/dashboard";

const chartColors = {
  axis: "var(--color-gray-400)",
  grid: "var(--color-gray-100)",
  primary: "var(--color-chart-primary)",
  success: "var(--color-chart-graphite)",
  surface: "var(--color-surface-1)",
  inverse: "var(--color-bg-inverse)",
};

interface DashboardPipelineMovementProps {
  evolution: DashboardLeadEvolutionItem[];
  heatmap: DashboardHeatmapCell[];
  loading: boolean;
}

export function DashboardPipelineMovement({ evolution, heatmap, loading }: DashboardPipelineMovementProps) {
  return (
    <div className="dashboard-pipeline-stack">
      <ChartCard title="Evolucao de Leads" subtitle="entrada diaria">
        {loading ? (
          <div className="dashboard-chart-skeleton dashboard-chart-skeleton--pipeline-line" />
        ) : evolution.length === 0 ? (
          <div className="empty-state">Sem serie diaria</div>
        ) : (
          <div className="dashboard-pipeline-line">
            <ResponsiveContainer width="100%" height={210} minHeight={210}>
              <LineChart data={evolution} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={chartColors.grid} vertical={false} />
                <XAxis
                  dataKey="date"
                  stroke={chartColors.axis}
                  tick={{ fontSize: 10, fill: chartColors.axis }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  stroke={chartColors.axis}
                  tick={{ fontSize: 10, fill: chartColors.axis }}
                  tickLine={false}
                  axisLine={false}
                  width={34}
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
                <Legend
                  verticalAlign="bottom"
                  height={26}
                  iconType="circle"
                  wrapperStyle={{
                    color: "var(--color-gray-600)",
                    fontFamily: "var(--font-family-mono)",
                    fontSize: "var(--text-xs)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="leads"
                  stroke={chartColors.primary}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  name="Leads"
                  dot={{ fill: chartColors.primary, stroke: chartColors.surface, strokeWidth: 2, r: 3 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="ganhos"
                  stroke={chartColors.success}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  name="Ganhos"
                  dot={{ fill: chartColors.success, stroke: chartColors.surface, strokeWidth: 2, r: 3 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      <ChartCard title="Densidade de Leads" subtitle="entradas por dia da semana">
        {loading ? (
          <div className="dashboard-chart-skeleton dashboard-chart-skeleton--heatmap" />
        ) : (
          <DashboardLeadHeatmap data={heatmap} />
        )}
      </ChartCard>
    </div>
  );
}
