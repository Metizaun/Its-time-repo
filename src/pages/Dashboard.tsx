import { useLeads } from "@/hooks/useLeads";
import { useInstances } from "@/hooks/useInstances";
import { useApp } from "@/context/AppContext";
import { KPICard } from "@/components/KPICard";
import { LineChart } from "@/components/charts/LineChart";
import { BarChart } from "@/components/charts/BarChart";
import { FunnelChart } from "@/components/charts/FunnelChart";
import { RevenueByVendorChart } from "@/components/charts/RevenueByVendorChart";
import { TrendingUp, Users, DollarSign, Target, Building2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useMemo } from "react";
// Removemos imports manuais de data-fns que causavam o erro (isAfter, etc)
// Importamos a função utilitária segura:
import { filterLeadsByPeriod } from "@/lib/utils/filters";
import { 
  groupLeadsByDay, 
  groupLeadsByOrigin, 
  computeFunnelData, 
  groupRevenueByVendor 
} from "@/lib/utils/metrics";
import { Lead } from "@/types"; // Garantindo a tipagem

export default function Dashboard() {
  const { leads, loading } = useLeads({ enableRealtime: false });
  const { instances, loading: instancesLoading } = useInstances();
  const { ui, setPeriodFilter } = useApp();
  const [selectedInstance, setSelectedInstance] = useState<string>("todas");

  // PASSO 1: Normalizar/Converter os leads PRIMEIRO.
  // Isso garante que todo o resto do código trabalhe com dados limpos e tipados.
  const normalizedLeads = useMemo(() => {
    return leads.map(l => ({
      ...l,
      // Mapeamento para garantir compatibilidade com a interface Lead e Utils
      nome: l.lead_name || 'Sem nome',
      cidade: l.last_city || '',
      email: l.email || '',
      telefone: l.contact_phone || '',
      origem: l.source || 'Desconhecido',
      conexao: (l.connection_level || 'Média') as "Baixa" | "Média" | "Alta",
      valor: l.value || 0,
      dataCriacao: l.created_at, // O utilitário filters.ts espera dataCriacao
      responsavel: l.owner_name || 'Sem responsável',
      observacoes: ''
    })) as unknown as Lead[]; // Casting para garantir compatibilidade com filters.ts
  }, [leads]);
  
  // PASSO 2: Filtrar por período usando a função utilitária SEGURA.
  // A função filterLeadsByPeriod em filters.ts usa comparações que não crasham a aplicação.
  const periodFilteredLeads = useMemo(() => {
    return filterLeadsByPeriod(normalizedLeads, ui.periodFilter, ui.customRange);
  }, [normalizedLeads, ui.periodFilter, ui.customRange]);
  
  // PASSO 3: Filtrar por instância (agora operando sobre os dados já filtrados por data)
  const filteredLeads = useMemo(() => {
    if (selectedInstance === "todas") return periodFilteredLeads;
    // Filtrar por instance_name do lead (que vem da view v_lead_details)
    return periodFilteredLeads.filter(lead => {
      const leadInstanceName = (lead as any).instance_name;
      return leadInstanceName === selectedInstance;
    });
  }, [periodFilteredLeads, selectedInstance]);
  
  // Compute KPIs
  const kpis = useMemo(() => {
    const totalLeads = filteredLeads.length;
    const negociosGanhos = filteredLeads.filter(l => l.status === "Fechado").length;
    const valorTotal = filteredLeads
      .filter(l => l.status === "Fechado")
      .reduce((sum, l) => sum + (l.valor || 0), 0); // Note: l.valor já existe pois normalizamos antes
    const taxaConversao = totalLeads > 0 ? (negociosGanhos / totalLeads) * 100 : 0;
    
    return { totalLeads, negociosGanhos, valorTotal, taxaConversao };
  }, [filteredLeads]);

  // Métricas para os gráficos
  const dailyData = useMemo(() => groupLeadsByDay(filteredLeads as any), [filteredLeads]);
  const originData = useMemo(() => groupLeadsByOrigin(filteredLeads as any), [filteredLeads]);
  const funnelData = useMemo(() => computeFunnelData(filteredLeads as any), [filteredLeads]);
  const revenueByVendor = useMemo(() => groupRevenueByVendor(filteredLeads as any), [filteredLeads]);

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Visão geral do desempenho de vendas
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={selectedInstance} onValueChange={setSelectedInstance} disabled={instancesLoading}>
            <SelectTrigger className="w-full sm:w-[210px]">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Building2 className="w-4 h-4" />
                <div className="flex-1 min-w-0">
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

          {/* O seletor de período atualiza o contexto global 'ui.periodFilter', 
              que dispara o recálculo do useMemo 'periodFilteredLeads' acima */}
          <Select value={ui.periodFilter} onValueChange={(value: any) => setPeriodFilter(value)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="flex-1 min-w-0">
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
        <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg text-sm">
          <span className="font-medium">Filtrando por instância:</span> {selectedInstance}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 min-w-0">
        <KPICard
          title="Total de Leads"
          value={kpis.totalLeads}
          icon={Users}
          subtitle="leads no período"
        />
        <KPICard
          title="Negócios Ganhos"
          value={kpis.negociosGanhos}
          icon={Target}
          subtitle="vendas fechadas"
        />
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
          subtitle="leads → vendas"
        />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LineChart data={dailyData} title="Evolução de Leads" />
        <BarChart data={originData} title="Leads por Origem" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FunnelChart data={funnelData} title="Funil de Vendas" />
        <RevenueByVendorChart data={revenueByVendor} title="Receita por Vendedor" />
      </div>
    </div>
  );
}
