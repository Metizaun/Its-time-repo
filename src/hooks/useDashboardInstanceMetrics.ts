import type { DashboardFilters } from "@/types/dashboard";
import { useDashboardOperationalQuery } from "@/hooks/useDashboardMetrics";

export function useDashboardInstanceMetrics(filters: DashboardFilters) {
  const query = useDashboardOperationalQuery(filters);

  return {
    instances: query.data?.instances ?? [],
    loading: query.isLoading,
    fetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
