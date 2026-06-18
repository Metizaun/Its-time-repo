import { format } from "date-fns";

import { ChartCard } from "@/components/charts/ChartCard";
import type { DashboardStaleLead } from "@/types/dashboard";

function formatLastInteraction(value: string | null) {
  if (!value) return "Sem interacao registrada";

  return `Ultima interacao ${format(new Date(value), "dd/MM HH:mm")}`;
}

export function DashboardInsightList({
  leads,
  loading,
}: {
  leads: DashboardStaleLead[];
  loading: boolean;
}) {
  return (
    <ChartCard title="Leads sem interacao recente" subtitle="abertos que merecem revisao">
      {loading ? (
        <div className="dashboard-list-skeleton">
          <div className="dashboard-skeleton dashboard-skeleton--row" />
          <div className="dashboard-skeleton dashboard-skeleton--row" />
          <div className="dashboard-skeleton dashboard-skeleton--row" />
        </div>
      ) : leads.length === 0 ? (
        <div className="empty-state">Sem registros no periodo</div>
      ) : (
        <div className="dashboard-insight-list">
          {leads.map((lead) => (
            <article key={lead.id} className="dashboard-insight-row">
              <div className="dashboard-insight-row__main">
                <p className="dashboard-insight-row__title">{lead.name}</p>
                <p className="dashboard-insight-row__meta">{formatLastInteraction(lead.last_message_at)}</p>
              </div>
              <div className="dashboard-insight-row__side">
                <span>{lead.instance || "Sem instancia"}</span>
                {lead.stage ? <small>{lead.stage}</small> : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </ChartCard>
  );
}
