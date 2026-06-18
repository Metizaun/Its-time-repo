import { Activity, Bot, MessageCircleReply, Users } from "lucide-react";

import { KPICard } from "@/components/KPICard";
import type { DashboardKpis } from "@/types/dashboard";

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function MetricSkeleton() {
  return (
    <article className="card-kpi dashboard-skeleton-card">
      <div className="dashboard-skeleton dashboard-skeleton--label" />
      <div className="dashboard-skeleton dashboard-skeleton--value" />
      <div className="dashboard-skeleton dashboard-skeleton--copy" />
    </article>
  );
}

export function DashboardMetricGrid({ kpis, loading }: { kpis: DashboardKpis; loading: boolean }) {
  if (loading) {
    return (
      <div className="dashboard-kpi-grid">
        <MetricSkeleton />
        <MetricSkeleton />
        <MetricSkeleton />
        <MetricSkeleton />
      </div>
    );
  }

  return (
    <div className="dashboard-kpi-grid">
      <KPICard title="Leads no Periodo" value={kpis.leads_period} icon={Users} subtitle="leads no filtro atual" />
      <KPICard
        title="Leads em Atendimento"
        value={kpis.open_leads}
        icon={Activity}
        subtitle="etapas abertas do pipeline"
      />
      <KPICard
        title="Atendimentos com IA"
        value={kpis.ai_assisted_leads}
        icon={Bot}
        subtitle="leads com atuacao da IA"
      />
      <KPICard
        title="Taxa de Resposta a IA"
        value={formatPercent(kpis.ai_response_rate)}
        icon={MessageCircleReply}
        subtitle="retorno apos contato da IA"
      />
    </div>
  );
}
