import { Lead, PeriodFilter } from "@/types";
import { startOfDay, subDays, isWithinInterval } from "date-fns";

export function filterLeadsByPeriod(
  leads: Lead[],
  period: PeriodFilter,
  customRange?: { from: Date | null; to: Date | null }
): Lead[] {
  const now = new Date();
  const today = startOfDay(now);

  switch (period) {
    case "hoje":
      return leads.filter((lead) => {
        const leadDate = startOfDay(new Date(lead.dataCriacao));
        return leadDate.getTime() === today.getTime();
      });
    
    case "7d":
      const sevenDaysAgo = subDays(now, 7);
      return leads.filter((lead) => new Date(lead.dataCriacao) >= sevenDaysAgo);
    
    case "30d":
      const thirtyDaysAgo = subDays(now, 30);
      return leads.filter((lead) => new Date(lead.dataCriacao) >= thirtyDaysAgo);
    
    case "custom":
      if (!customRange?.from || !customRange?.to) return leads;
      return leads.filter((lead) =>
        isWithinInterval(new Date(lead.dataCriacao), {
          start: customRange.from,
          end: customRange.to,
        })
      );
    
    case "total":
    default:
      return leads;
  }
}

export function filterLeadsBySearch(leads: Lead[], query: string): Lead[] {
  if (!query.trim()) return leads;
  
  const lowerQuery = query.toLowerCase();
  return leads.filter(
    (lead) =>
      lead.nome.toLowerCase().includes(lowerQuery) ||
      lead.cidade.toLowerCase().includes(lowerQuery) ||
      lead.email.toLowerCase().includes(lowerQuery) ||
      lead.telefone.includes(query) ||
      lead.origem.toLowerCase().includes(lowerQuery) ||
      lead.responsavel.toLowerCase().includes(lowerQuery)
  );
}
