import { Lead } from "@/types";
import { format, parseISO } from "date-fns";

export interface KPIMetrics {
  totalLeads: number;
  negociosGanhos: number;
  valorTotal: number;
  taxaConversao: number;
}

export function computeKPIs(leads: Lead[]): KPIMetrics {
  const totalLeads = leads.length;
  const negociosGanhos = leads.filter((l) => l.status === "Fechado").length;
  const valorTotal = leads
    .filter((l) => l.status === "Fechado")
    .reduce((sum, l) => sum + l.valor, 0);
  const taxaConversao = totalLeads > 0 ? (negociosGanhos / totalLeads) * 100 : 0;

  return { totalLeads, negociosGanhos, valorTotal, taxaConversao };
}

export interface DailyData {
  date: string;
  leads: number;
  ganhos: number;
}

export function groupLeadsByDay(leads: Lead[]): DailyData[] {
  const grouped: Record<string, { leads: number; ganhos: number }> = {};

  leads.forEach((lead) => {
    const date = format(parseISO(lead.dataCriacao), "dd/MM");
    if (!grouped[date]) {
      grouped[date] = { leads: 0, ganhos: 0 };
    }
    grouped[date].leads++;
    if (lead.status === "Fechado") {
      grouped[date].ganhos += lead.valor;
    }
  });

  return Object.entries(grouped)
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => {
      const [dayA, monthA] = a.date.split("/").map(Number);
      const [dayB, monthB] = b.date.split("/").map(Number);
      return monthA === monthB ? dayA - dayB : monthA - monthB;
    });
}

export interface OriginData {
  origem: string;
  leads: number;
  ganhos: number;
}

export function groupLeadsByOrigin(leads: Lead[]): OriginData[] {
  const grouped: Record<string, { leads: number; ganhos: number }> = {};

  leads.forEach((lead) => {
    if (!grouped[lead.origem]) {
      grouped[lead.origem] = { leads: 0, ganhos: 0 };
    }
    grouped[lead.origem].leads++;
    if (lead.status === "Fechado") {
      grouped[lead.origem].ganhos += lead.valor;
    }
  });

  return Object.entries(grouped).map(([origem, data]) => ({ origem, ...data }));
}

export interface FunnelStep {
  name: string;
  value: number;
}

export function computeFunnelData(leads: Lead[]): FunnelStep[] {
  const statusOrder: Lead["status"][] = [
    "Novo",
    "Atendimento",
    "Orçamento",
    "Fechado",
    "Perdido",
    "Remarketing",
  ];

  return statusOrder.map((status) => ({
    name: status,
    value: leads.filter((l) => l.status === status).length,
  }));
}

export interface RevenueByVendor {
  responsavel: string;
  receita: number;
}

export function groupRevenueByVendor(leads: Lead[]): RevenueByVendor[] {
  const grouped: Record<string, number> = {};

  leads
    .filter((lead) => lead.status === "Fechado")
    .forEach((lead) => {
      if (!grouped[lead.responsavel]) {
        grouped[lead.responsavel] = 0;
      }
      grouped[lead.responsavel] += lead.valor;
    });

  return Object.entries(grouped)
    .map(([responsavel, receita]) => ({ responsavel, receita }))
    .sort((a, b) => b.receita - a.receita);
}
