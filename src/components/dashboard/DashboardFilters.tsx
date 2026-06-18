import { Building2 } from "lucide-react";

import type { Instance } from "@/hooks/useInstances";
import type { PeriodFilter } from "@/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type DashboardFiltersProps = {
  selectedInstance: string;
  onInstanceChange: (value: string) => void;
  instances: Instance[];
  instancesLoading: boolean;
  period: PeriodFilter;
  onPeriodChange: (value: PeriodFilter) => void;
};

export function DashboardFilters({
  selectedInstance,
  onInstanceChange,
  instances,
  instancesLoading,
  period,
  onPeriodChange,
}: DashboardFiltersProps) {
  return (
    <div className="dashboard-filters">
      <Select value={selectedInstance} onValueChange={onInstanceChange} disabled={instancesLoading}>
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

      <Select value={period} onValueChange={(value: PeriodFilter) => onPeriodChange(value)}>
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
  );
}
