import { useMemo, useState } from "react";
import { Building2, Check, DollarSign, Filter, Target, TrendingUp, Users } from "lucide-react";

import { useLeads } from "@/hooks/useLeads";
import { useInstances } from "@/hooks/useInstances";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { useAuth } from "@/contexts/AuthContext";
import { useApp } from "@/context/AppContext";
import { KPICard } from "@/components/KPICard";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { FunnelChart } from "@/components/charts/FunnelChart";
import { RevenueByVendorChart } from "@/components/charts/RevenueByVendorChart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { filterLeadsByPeriod } from "@/lib/utils/filters";
import {
  computeFunnelDataFromStages,
  groupLeadsByDay,
  groupLeadsByOrigin,
  groupRevenueByVendor,
} from "@/lib/utils/metrics";
import { Lead, PeriodFilter, PipelineStage } from "@/types";

const MAX_FUNNEL_STAGES = 5;

function getEffectiveFunnelStages(stages: PipelineStage[]) {
  const selectedStages = stages.filter((stage) => stage.is_funnel_stage);

  if (selectedStages.length > 0 && selectedStages.length <= MAX_FUNNEL_STAGES) {
    return selectedStages;
  }

  return stages.slice(0, MAX_FUNNEL_STAGES);
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="section-label">
      <span className="section-label__text">{children}</span>
    </div>
  );
}

function normalizeConnection(value?: string | null): Lead["conexao"] {
  if (value === "Baixa" || value === "Alta") return value;
  return "Média";
}

export default function Dashboard() {
  const { leads, loading } = useLeads({ enableRealtime: false });
  const { stages, toggleFunnelStage } = usePipelineStages();
  const { instances, loading: instancesLoading } = useInstances();
  const { userRole } = useAuth();
  const { ui, setPeriodFilter } = useApp();
  const [selectedInstance, setSelectedInstance] = useState<string>("todas");
  const isAdmin = userRole === "ADMIN";

  const normalizedLeads = useMemo<Lead[]>(() => {
    return leads.map((lead) => ({
      ...lead,
      nome: lead.lead_name || "Sem nome",
      cidade: lead.last_city || "",
      email: lead.email || "",
      telefone: lead.contact_phone || "",
      origem: lead.source || "Desconhecido",
      conexao: normalizeConnection(lead.connection_level),
      valor: lead.value || 0,
      dataCriacao: lead.created_at,
      responsavel: lead.owner_name || "Sem responsavel",
      observacoes: "",
    }));
  }, [leads]);

  const periodFilteredLeads = useMemo(
    () => filterLeadsByPeriod(normalizedLeads, ui.periodFilter, ui.customRange),
    [normalizedLeads, ui.periodFilter, ui.customRange]
  );

  const filteredLeads = useMemo(() => {
    if (selectedInstance === "todas") return periodFilteredLeads;

    return periodFilteredLeads.filter((lead) => {
      return lead.instance_name === selectedInstance;
    });
  }, [periodFilteredLeads, selectedInstance]);

  const selectedFunnelStages = useMemo(() => getEffectiveFunnelStages(stages), [stages]);
  const selectedFunnelStageIds = useMemo(() => selectedFunnelStages.map((stage) => stage.id), [selectedFunnelStages]);

  const handleFunnelStageToggle = async (stageId: string, nextEnabled: boolean) => {
    if (!isAdmin) return;
    await toggleFunnelStage(stageId, nextEnabled);
  };

  const kpis = useMemo(() => {
    const totalLeads = filteredLeads.length;
    const negociosGanhos = filteredLeads.filter((lead) => lead.status === "Fechado").length;
    const valorTotal = filteredLeads
      .filter((lead) => lead.status === "Fechado")
      .reduce((sum, lead) => sum + (lead.valor || 0), 0);
    const taxaConversao = totalLeads > 0 ? (negociosGanhos / totalLeads) * 100 : 0;

    return { totalLeads, negociosGanhos, valorTotal, taxaConversao };
  }, [filteredLeads]);

  const dailyData = useMemo(() => groupLeadsByDay(filteredLeads), [filteredLeads]);
  const originData = useMemo(() => groupLeadsByOrigin(filteredLeads), [filteredLeads]);
  const funnelData = useMemo(() => {
    if (!stages.length || selectedFunnelStageIds.length === 0) {
      return [];
    }

    return computeFunnelDataFromStages(filteredLeads, stages, selectedFunnelStageIds);
  }, [filteredLeads, selectedFunnelStageIds, stages]);
  const revenueByVendor = useMemo(() => groupRevenueByVendor(filteredLeads), [filteredLeads]);

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

  if (loading) {
    return (
      <div className="dashboard-page">
        <div>
          <SectionLabel>Dashboard</SectionLabel>
          <h1 className="dashboard-title">Dashboard</h1>
          <p className="dashboard-description">Carregando metricas de vendas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <SectionLabel>Dashboard</SectionLabel>
          <h1 className="dashboard-title">Dashboard</h1>
          <p className="dashboard-description">Visao geral do desempenho de vendas</p>
        </div>

        <div className="dashboard-filters">
          <Select value={selectedInstance} onValueChange={setSelectedInstance} disabled={instancesLoading}>
            <SelectTrigger className="dashboard-filter-trigger dashboard-filter--instance">
              <div className="dashboard-filter-content">
                <Building2 className="dashboard-filter-icon" />
                <span className="dashboard-filter-value">
                  <SelectValue placeholder="Todas as instancias" />
                </span>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as instancias</SelectItem>
              {instances.map((instance) => (
                <SelectItem key={instance.instancia} value={instance.instancia}>
                  {instance.instancia}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={ui.periodFilter} onValueChange={(value: PeriodFilter) => setPeriodFilter(value)}>
            <SelectTrigger className="dashboard-filter-trigger dashboard-filter--period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hoje">Hoje</SelectItem>
              <SelectItem value="7d">Ultimos 7 dias</SelectItem>
              <SelectItem value="30d">Ultimos 30 dias</SelectItem>
              <SelectItem value="total">Total</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      {selectedInstance !== "todas" && (
        <div className="dashboard-filter-note">
          <strong>Filtrando por instancia:</strong> {selectedInstance}
        </div>
      )}

      <section className="dashboard-section">
        <SectionLabel>Consolidado Geral</SectionLabel>

        <div className="dashboard-kpi-grid">
          <KPICard title="Total de Leads" value={kpis.totalLeads} icon={Users} subtitle="leads no periodo" />
          <KPICard title="Negocios Ganhos" value={kpis.negociosGanhos} icon={Target} subtitle="vendas fechadas" />
          <KPICard
            title="Receita Total"
            value={
              <>
                R${" "}
                <span className="whitespace-nowrap">
                  {kpis.valorTotal.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </>
            }
            icon={DollarSign}
            subtitle="valor total fechado"
          />
          <KPICard
            title="Taxa de Conversao"
            value={`${kpis.taxaConversao.toFixed(1)}%`}
            icon={TrendingUp}
            subtitle="leads para vendas"
          />
        </div>
      </section>

      <section className="dashboard-section">
        <SectionLabel>Aquisicao De Clientes</SectionLabel>

        <div className="dashboard-chart-grid">
          <LineChart data={dailyData} title="Evolucao de Leads" />
          <BarChart data={originData} title="Leads por Origem" />
        </div>
      </section>

      <section className="dashboard-section">
        <SectionLabel>Funil E Receita</SectionLabel>

        <div className="dashboard-chart-grid">
          <FunnelChart
            data={funnelData}
            title="Funil de Vendas"
            headerAction={funnelHeaderAction}
            totalLeads={filteredLeads.length}
          />
          <RevenueByVendorChart data={revenueByVendor} title="Receita por Vendedor" />
        </div>
      </section>
    </div>
  );
}
