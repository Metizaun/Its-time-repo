import type { Instance } from "@/hooks/useInstances";
import type { PeriodFilter } from "@/types";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { SectionLabel } from "@/components/dashboard/SectionLabel";

type DashboardHeaderProps = {
  selectedInstance: string;
  onInstanceChange: (value: string) => void;
  instances: Instance[];
  instancesLoading: boolean;
  period: PeriodFilter;
  onPeriodChange: (value: PeriodFilter) => void;
};

export function DashboardHeader({
  selectedInstance,
  onInstanceChange,
  instances,
  instancesLoading,
  period,
  onPeriodChange,
}: DashboardHeaderProps) {
  return (
    <header className="dashboard-header">
      <div>
        <SectionLabel>Dashboard</SectionLabel>
        <h1 className="dashboard-title">Dashboard</h1>
        <p className="dashboard-description">Leads, conversas e evolucao do pipeline</p>
      </div>

      <DashboardFilters
        selectedInstance={selectedInstance}
        onInstanceChange={onInstanceChange}
        instances={instances}
        instancesLoading={instancesLoading}
        period={period}
        onPeriodChange={onPeriodChange}
      />
    </header>
  );
}
