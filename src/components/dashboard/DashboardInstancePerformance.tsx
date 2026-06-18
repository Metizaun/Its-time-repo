import { ChartCard } from "@/components/charts/ChartCard";
import type { DashboardInstanceMetric } from "@/types/dashboard";

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export function DashboardInstancePerformance({
  instances,
  loading,
}: {
  instances: DashboardInstanceMetric[];
  loading: boolean;
}) {
  const maxLeads = Math.max(...instances.map((instance) => instance.leads), 1);

  return (
    <ChartCard title="Performance por Instancia" subtitle="volume, resposta e validacao no pipeline">
      {loading ? (
        <div className="dashboard-list-skeleton">
          <div className="dashboard-skeleton dashboard-skeleton--row" />
          <div className="dashboard-skeleton dashboard-skeleton--row" />
          <div className="dashboard-skeleton dashboard-skeleton--row" />
        </div>
      ) : instances.length === 0 ? (
        <div className="empty-state">Sem registros no periodo</div>
      ) : (
        <div className="dashboard-instance-table">
          <div className="dashboard-instance-table__head">
            <span>Instancia</span>
            <span>Leads</span>
            <span>Resposta IA</span>
            <span>Ganhos</span>
          </div>

          {instances.slice(0, 8).map((instance) => (
            <article key={instance.instance} className="dashboard-instance-row">
              <div className="dashboard-instance-row__identity">
                <strong>{instance.instance}</strong>
                <span>{instance.messages} interacoes</span>
              </div>

              <div className="dashboard-instance-row__bar">
                <span style={{ width: `${Math.max((instance.leads / maxLeads) * 100, 4)}%` }} />
                <strong>{instance.leads}</strong>
              </div>

              <div className="dashboard-instance-row__metric">{formatPercent(instance.response_rate)}</div>
              <div className="dashboard-instance-row__metric">{instance.won}</div>
            </article>
          ))}
        </div>
      )}
    </ChartCard>
  );
}
