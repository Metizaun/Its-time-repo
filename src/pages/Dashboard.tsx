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
} from "@/components/ui/material-ui-dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { filterLeadsByPeriod } from "@/lib/utils/filters";
import {
  computeFunnelDataFromStages,
  groupLeadsByDay,
  groupLeadsByOrigin,
  groupRevenueByVendor,
} from "@/lib/utils/metrics";
import { Lead, PipelineStage } from "@/types";

const MAX_FUNNEL_STAGES = 5;

function getEffectiveFunnelStages(stages: PipelineStage[]) {
  const selectedStages = stages.filter((stage) => stage.is_funnel_stage);

  if (selectedStages.length > 0 && selectedStages.length <= MAX_FUNNEL_STAGES) {
    return selectedStages;
  }

  return stages.slice(0, MAX_FUNNEL_STAGES);
}

export default function Dashboard() {
  const { leads, loading } = useLeads({ enableRealtime: false });
  const { stages, toggleFunnelStage } = usePipelineStages();
  const { instances, loading: instancesLoading } = useInstances();
  const { userRole } = useAuth();
  const { ui, setPeriodFilter } = useApp();
  const [selectedInstance, setSelectedInstance] = useState<string>("todas");
  const isAdmin = userRole === "ADMIN";

  const normalizedLeads = useMemo(() => {
    return leads.map((lead) => ({
      ...lead,
      nome: lead.lead_name || "Sem nome",
      cidade: lead.last_city || "",
      email: lead.email || "",
      telefone: lead.contact_phone || "",
      origem: lead.source || "Desconhecido",
      conexao: (lead.connection_level || "Media") as any,
      valor: lead.value || 0,
      dataCriacao: lead.created_at,
      responsavel: lead.owner_name || "Sem responsável",
      observacoes: "",
    })) as unknown as Lead[];
  }, [leads]);

  const periodFilteredLeads = useMemo(
    () => filterLeadsByPeriod(normalizedLeads, ui.periodFilter, ui.customRange),
    [normalizedLeads, ui.periodFilter, ui.customRange]
  );

  const filteredLeads = useMemo(() => {
    if (selectedInstance === "todas") return periodFilteredLeads;

    return periodFilteredLeads.filter((lead) => {
      const leadInstanceName = (lead as any).instance_name;
      return leadInstanceName === selectedInstance;
    });
  }, [periodFilteredLeads, selectedInstance]);

  const selectedFunnelStages = useMemo(() => getEffectiveFunnelStages(stages), [stages]);
  const selectedFunnelStageIds = useMemo(
    () => selectedFunnelStages.map((stage) => stage.id),
    [selectedFunnelStages]
  );

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

  const dailyData = useMemo(() => groupLeadsByDay(filteredLeads as any), [filteredLeads]);
  const originData = useMemo(() => groupLeadsByOrigin(filteredLeads as any), [filteredLeads]);
  const funnelData = useMemo(() => {
    if (!stages.length || selectedFunnelStageIds.length === 0) {
      return [];
    }

    return computeFunnelDataFromStages(filteredLeads as any, stages, selectedFunnelStageIds);
  }, [filteredLeads, selectedFunnelStageIds, stages]);
  const revenueByVendor = useMemo(() => groupRevenueByVendor(filteredLeads as any), [filteredLeads]);

  const funnelHeaderAction = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Selecionar etapas do funil"
          className="group inline-flex h-11 w-11 items-center justify-center rounded-[18px] border border-white/10 bg-[rgba(5,8,14,0.34)] text-white/75 shadow-[0_10px_30px_rgba(0,0,0,0.16)] backdrop-blur-xl transition-all duration-200 hover:border-white/15 hover:bg-[rgba(8,12,18,0.46)] hover:text-white/90"
        >
          <Filter className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="w-[360px] overflow-hidden rounded-[28px] p-0"
      >
        <div className="border-b border-white/8 px-5 pb-4 pt-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold tracking-tight text-white">Etapas do funil</p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-white/65">
              {selectedFunnelStageIds.length}/{MAX_FUNNEL_STAGES}
            </span>
          </div>
        </div>

        <DropdownMenuLabel className="px-5 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/35">
          Pipeline
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="mx-4 my-0 h-px bg-white/8" />

        <div className="max-h-80 overflow-y-auto px-2 py-2">
          {stages.length === 0 ? (
            <p className="px-4 py-5 text-xs text-white/55">Nenhuma etapa do pipeline encontrada.</p>
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
                  className={cn(
                    "mb-1.5 rounded-[22px] border border-white/[0.06] px-0 py-0 text-white/85",
                    "focus:bg-transparent focus:text-white",
                    !isAdmin && "cursor-default",
                    isChecked
                      ? "bg-white/[0.08]"
                      : "bg-transparent hover:bg-white/[0.04]"
                  )}
                >
                  <div className="flex w-full items-center justify-between gap-4 px-4 py-3">
                    <p className="min-w-0 truncate text-[13px] font-semibold text-white">{stage.name}</p>

                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all",
                        isChecked
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white shadow-[0_0_18px_rgba(229,57,58,0.24)]"
                          : "border-white/12 bg-white/[0.02] text-transparent"
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </DropdownMenuItem>
              );
            })
          )}
        </div>

        <DropdownMenuSeparator className="mx-4 my-0 h-px bg-white/8" />
        {!isAdmin ? (
          <div className="px-5 py-4 text-xs text-white/50">
            Somente usuários ADMIN podem editar o filtro do funil.
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">Visão geral do desempenho de vendas</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={selectedInstance} onValueChange={setSelectedInstance} disabled={instancesLoading}>
            <SelectTrigger className="w-full sm:w-[210px]">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Building2 className="w-4 h-4" />
                <div className="min-w-0 flex-1">
                  <SelectValue className="truncate block" placeholder="Todas as instâncias" />
                </div>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as instâncias</SelectItem>
              {instances.map((instance) => (
                <SelectItem key={instance.instancia} value={instance.instancia}>
                  {instance.instancia}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={ui.periodFilter} onValueChange={(value: any) => setPeriodFilter(value)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SelectValue className="truncate block" />
                </div>
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hoje">Hoje</SelectItem>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="total">Total</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedInstance !== "todas" && (
        <div className="p-3 bg-[var(--color-bg-elevated)] border-none rounded-[16px] text-sm text-[var(--color-text-secondary)] shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
          <span className="font-medium text-foreground">Filtrando por instância:</span> {selectedInstance}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 min-w-0">
        <KPICard title="Total de Leads" value={kpis.totalLeads} icon={Users} subtitle="leads no periodo" />
        <KPICard title="Negócios Ganhos" value={kpis.negociosGanhos} icon={Target} subtitle="vendas fechadas" />
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
          title="Taxa de Conversão"
          value={`${kpis.taxaConversao.toFixed(1)}%`}
          icon={TrendingUp}
          subtitle="leads para vendas"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LineChart data={dailyData} title="Evolução de Leads" />
        <BarChart data={originData} title="Leads por Origem" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FunnelChart
          data={funnelData}
          title="Funil de Vendas"
          headerAction={funnelHeaderAction}
          totalLeads={filteredLeads.length}
        />
        <RevenueByVendorChart data={revenueByVendor} title="Receita por Vendedor" />
      </div>
    </div>
  );
}
