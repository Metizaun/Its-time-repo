import { useMemo, useState } from "react";
import { BadgeDollarSign, Check, Clock3, Filter, Send, Target } from "lucide-react";

import { ChartCard } from "@/components/charts/ChartCard";
import { FunnelChart } from "@/components/charts/FunnelChart";
import { ConversationActivityChart } from "@/components/dashboard/ConversationActivityChart";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardInsightList } from "@/components/dashboard/DashboardInsightList";
import { DashboardInstancePerformance } from "@/components/dashboard/DashboardInstancePerformance";
import { DashboardMetricGrid } from "@/components/dashboard/DashboardMetricGrid";
import { DashboardPipelineMovement } from "@/components/dashboard/DashboardPipelineMovement";
import { DashboardSection } from "@/components/dashboard/DashboardSection";
import { KPICard } from "@/components/KPICard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboardConversationMetrics } from "@/hooks/useDashboardConversationMetrics";
import { useDashboardInstanceMetrics } from "@/hooks/useDashboardInstanceMetrics";
import { useDashboardMetrics } from "@/hooks/useDashboardMetrics";
import { useInstances } from "@/hooks/useInstances";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { cn } from "@/lib/utils";
import type { FunnelStep } from "@/lib/utils/metrics";
import type { DashboardFilters } from "@/types/dashboard";
import type { PeriodFilter, PipelineStage } from "@/types";

const MAX_FUNNEL_STAGES = 5;

function getEffectiveFunnelStages(stages: PipelineStage[]) {
  const selectedStages = stages.filter((stage) => stage.is_funnel_stage);

  if (selectedStages.length > 0 && selectedStages.length <= MAX_FUNNEL_STAGES) {
    return selectedStages;
  }

  return stages.slice(0, MAX_FUNNEL_STAGES);
}

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function ChartSkeleton({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <ChartCard title={title} subtitle={subtitle}>
      <div className="dashboard-chart-skeleton" />
    </ChartCard>
  );
}

export default function Dashboard() {
  const { stages, toggleFunnelStage } = usePipelineStages();
  const { instances, loading: instancesLoading } = useInstances();
  const { userRole } = useAuth();
  const { ui, setPeriodFilter } = useApp();
  const [selectedInstance, setSelectedInstance] = useState<string>("todas");
  const isAdmin = userRole === "ADMIN";

  const filters = useMemo<DashboardFilters>(
    () => ({
      period: ui.periodFilter,
      customRange: ui.customRange,
      instance: selectedInstance,
    }),
    [selectedInstance, ui.customRange, ui.periodFilter]
  );

  const dashboardMetrics = useDashboardMetrics(filters);
  const conversationQuery = useDashboardConversationMetrics(filters);
  const instanceQuery = useDashboardInstanceMetrics(filters);

  const selectedFunnelStages = useMemo(() => getEffectiveFunnelStages(stages), [stages]);
  const selectedFunnelStageIds = useMemo(() => selectedFunnelStages.map((stage) => stage.id), [selectedFunnelStages]);

  const displayedFunnelData = useMemo<FunnelStep[]>(() => {
    const source = dashboardMetrics.pipeline.funnel;

    if (selectedFunnelStageIds.length > 0) {
      const selected = source.filter((stage) => stage.id && selectedFunnelStageIds.includes(stage.id));
      if (selected.length > 0) return selected.slice(0, MAX_FUNNEL_STAGES);
    }

    const rpcSelected = source.filter((stage) => stage.is_funnel_stage);
    if (rpcSelected.length > 0 && rpcSelected.length <= MAX_FUNNEL_STAGES) {
      return rpcSelected;
    }

    return source.slice(0, MAX_FUNNEL_STAGES);
  }, [dashboardMetrics.pipeline.funnel, selectedFunnelStageIds]);

  const handleFunnelStageToggle = async (stageId: string, nextEnabled: boolean) => {
    if (!isAdmin) return;
    await toggleFunnelStage(stageId, nextEnabled);
  };

  const funnelHeaderAction = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Selecionar etapas do funil" className="funnel-menu-trigger">
          <Filter className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={10} className="funnel-menu-content">
        <div className="funnel-menu-header">
          <p className="funnel-menu-title">Etapas do funil</p>
          <span className="funnel-menu-count">
            {selectedFunnelStageIds.length}/{MAX_FUNNEL_STAGES}
          </span>
        </div>

        <DropdownMenuLabel className="funnel-menu-label">Pipeline</DropdownMenuLabel>
        <DropdownMenuSeparator className="funnel-menu-separator" />

        <div className="funnel-menu-list">
          {stages.length === 0 ? (
            <p className="funnel-menu-empty">Nenhuma etapa do pipeline encontrada.</p>
          ) : (
            stages.map((stage) => {
              const isChecked = selectedFunnelStageIds.includes(stage.id);

              return (
                <DropdownMenuItem
                  key={stage.id}
                  disabled={!isAdmin}
                  onSelect={(event) => {
                    event.preventDefault();
                    void handleFunnelStageToggle(stage.id, !isChecked);
                  }}
                  className={cn("funnel-menu-item", !isAdmin && "cursor-default")}
                >
                  <div className="funnel-menu-item__inner">
                    <p className="funnel-menu-item__name">{stage.name}</p>

                    <span className={cn("funnel-check", isChecked && "funnel-check--active")}>
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </DropdownMenuItem>
              );
            })
          )}
        </div>

        <DropdownMenuSeparator className="funnel-menu-separator" />
        {!isAdmin ? <div className="funnel-menu-note">Somente usuarios ADMIN podem editar o filtro do funil.</div> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const conversation = conversationQuery.conversation ?? dashboardMetrics.metrics.conversation;
  const instanceMetrics = instanceQuery.instances;
  const loading = dashboardMetrics.loading;

  return (
    <div className="dashboard-page">
      <DashboardHeader
        selectedInstance={selectedInstance}
        onInstanceChange={setSelectedInstance}
        instances={instances}
        instancesLoading={instancesLoading}
        period={ui.periodFilter}
        onPeriodChange={(value: PeriodFilter) => setPeriodFilter(value)}
      />

      {selectedInstance !== "todas" ? (
        <div className="dashboard-filter-note">
          <strong>Filtrando por instancia:</strong> {selectedInstance}
        </div>
      ) : null}

      {!dashboardMetrics.rpcEnabled ? (
        <div className="dashboard-data-note">
          Metricas agregadas desativadas neste ambiente. Ative VITE_ENABLE_DASHBOARD_RPC=true no
          ambiente local de desenvolvimento ou teste para validar dados reais.
        </div>
      ) : dashboardMetrics.error ? (
        <div className="dashboard-data-note">
          Metricas agregadas indisponiveis no momento. Verifique a migration da RPC e tente novamente.
        </div>
      ) : null}

      <DashboardSection label="Consolidado Operacional">
        <DashboardMetricGrid kpis={dashboardMetrics.kpis} loading={loading} />
      </DashboardSection>

      <DashboardSection label="Movimento Do Pipeline">
        <div className="dashboard-pipeline-grid">
          {loading ? (
            <ChartSkeleton title="Funil do Pipeline" />
          ) : (
            <FunnelChart
              data={displayedFunnelData}
              title="Funil do Pipeline"
              headerAction={funnelHeaderAction}
              totalLeads={dashboardMetrics.kpis.leads_period}
            />
          )}

          {loading ? (
            <ChartSkeleton title="Evolucao de Leads" subtitle="entrada diaria e densidade por semana" />
          ) : (
            <DashboardPipelineMovement
              evolution={dashboardMetrics.pipeline.evolution}
              heatmap={dashboardMetrics.pipeline.heatmap}
              loading={loading}
            />
          )}
        </div>
      </DashboardSection>

      <DashboardSection label="Conversas E IA">
        <div className="dashboard-wide-grid">
          <ConversationActivityChart data={conversation.evolution} loading={conversationQuery.loading} />
          <DashboardInsightList leads={conversation.stale_leads_list} loading={conversationQuery.loading} />
        </div>
      </DashboardSection>

      <DashboardSection label="Performance Por Instancia">
        <DashboardInstancePerformance instances={instanceMetrics} loading={instanceQuery.loading} />
      </DashboardSection>

      <DashboardSection label="Indicadores Opcionais">
        <div className="dashboard-secondary-grid">
          <KPICard
            title="Conversao do Pipeline"
            value={formatPercent(dashboardMetrics.pipeline.conversion_rate)}
            icon={Target}
            subtitle={`${dashboardMetrics.pipeline.won_leads} leads chegaram em ganho`}
          />
          <KPICard
            title="Receita Registrada"
            value={formatCurrency(dashboardMetrics.optional.revenue_registered)}
            icon={BadgeDollarSign}
            subtitle={`${dashboardMetrics.optional.leads_with_revenue} leads com receita`}
          />
          <KPICard
            title="Disparos Enviados"
            value={dashboardMetrics.optional.dispatches_sent}
            icon={Send}
            subtitle="mensagens automaticas concluidas"
          />
          <KPICard
            title="Disparos Pendentes"
            value={dashboardMetrics.optional.dispatches_pending}
            icon={Clock3}
            subtitle="automacoes em fila ou processamento"
          />
        </div>
      </DashboardSection>
    </div>
  );
}
