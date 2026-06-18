import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartCard } from "@/components/charts/ChartCard";
import type { DashboardConversationEvolutionItem } from "@/types/dashboard";

const chartColors = {
  axis: "var(--color-gray-400)",
  grid: "var(--color-gray-100)",
  ai: "var(--color-chart-primary)",
  automation: "var(--color-primary-100)",
  human: "var(--color-chart-graphite)",
  lead: "var(--color-secondary-500)",
  surface: "var(--color-surface-1)",
  inverse: "var(--color-bg-inverse)",
};

export function ConversationActivityChart({
  data,
  loading,
}: {
  data: DashboardConversationEvolutionItem[];
  loading: boolean;
}) {
  return (
    <ChartCard title="IA x Humano x Lead" subtitle="volume de interacoes por origem">
      {loading ? (
        <div className="dashboard-chart-skeleton" />
      ) : data.length === 0 ? (
        <div className="empty-state">Sem registros no periodo</div>
      ) : (
        <div className="chart-scroll">
          <ResponsiveContainer width="100%" height={300} minHeight={300}>
            <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid stroke={chartColors.grid} />
              <XAxis dataKey="date" stroke={chartColors.axis} tick={{ fontSize: 10, fill: chartColors.axis }} />
              <YAxis stroke={chartColors.axis} tick={{ fontSize: 10, fill: chartColors.axis }} />
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
                wrapperStyle={{
                  color: "var(--color-gray-600)",
                  fontFamily: "var(--font-family-mono)",
                  fontSize: "var(--text-xs)",
                }}
              />
              <Bar dataKey="ai" stackId="messages" fill={chartColors.ai} name="IA" radius={[6, 6, 0, 0]} />
              <Bar dataKey="automation" stackId="messages" fill={chartColors.automation} name="Automacao" />
              <Bar dataKey="human" stackId="messages" fill={chartColors.human} name="Humano" />
              <Bar dataKey="lead" stackId="messages" fill={chartColors.lead} name="Lead" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
