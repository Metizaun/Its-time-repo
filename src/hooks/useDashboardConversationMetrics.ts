import type { DashboardFilters } from "@/types/dashboard";
import { useDashboardOperationalQuery } from "@/hooks/useDashboardMetrics";

export function useDashboardConversationMetrics(filters: DashboardFilters) {
  const query = useDashboardOperationalQuery(filters);

  return {
    conversation: query.data?.conversation,
    loading: query.isLoading,
    fetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
