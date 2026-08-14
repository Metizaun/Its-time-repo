import {
  Bar,
  BarChart,
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
import type { AdminMonthlyFinancial, AdminOverview } from "@/types/superadmin";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const tooltipStyle = {
  backgroundColor: "var(--color-bg-inverse)",
  border: "none",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-md)",
  color: "var(--color-surface-1)",
  fontFamily: "var(--font-family-mono)",
  fontSize: "var(--text-xs)",
};

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(`${value}T12:00:00`));
}

export function FinancialSeriesChart({ data }: { data: AdminMonthlyFinancial[] }) {
  const chartData = data.map((item) => ({ ...item, month: monthLabel(item.competencia) }));
  return (
    <ChartCard title="Entrada versus consumo" subtitle="Receita lançada, consumo cobrado e custo real em 12 meses">
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-gray-100)" vertical={false} />
          <XAxis dataKey="month" stroke="var(--color-gray-400)" tick={{ fontSize: 11 }} />
          <YAxis stroke="var(--color-gray-400)" tick={{ fontSize: 10 }} tickFormatter={(value) => currency.format(value)} width={72} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => currency.format(value)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="revenue_booked_brl" name="Receita" stroke="var(--color-chart-primary)" strokeWidth={3} dot={{ r: 3, strokeWidth: 2 }} />
          <Line type="monotone" dataKey="billed_consumption_brl" name="Consumo cobrado" stroke="var(--color-chart-blue)" strokeWidth={2} dot={{ r: 3, strokeWidth: 2 }} />
          <Line type="monotone" dataKey="provider_cost_brl" name="Custo real" stroke="var(--color-chart-graphite)" strokeWidth={2} dot={{ r: 3, strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function AccountRankingChart({ data }: { data: AdminOverview["ranking"] }) {
  return (
    <ChartCard title="Ranking de custo por cliente" subtitle="Custo real de provider no mês atual">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-gray-100)" horizontal={false} />
          <XAxis type="number" stroke="var(--color-gray-400)" tick={{ fontSize: 10 }} tickFormatter={(value) => currency.format(value)} />
          <YAxis type="category" dataKey="name" width={110} stroke="var(--color-gray-400)" tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => currency.format(value)} />
          <Bar dataKey="provider_cost_brl" name="Custo real" fill="var(--color-chart-primary)" radius={[0, 7, 7, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
