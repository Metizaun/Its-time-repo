import { useQuery } from "@tanstack/react-query";

import { listAutomationMediaAssets } from "@/services/automationMediaService";

export function useAutomationMediaAssets(instanceName?: string | null, enabled = true) {
  const query = useQuery({
    queryKey: ["automation", "media-assets", instanceName ?? "all"],
    queryFn: () => listAutomationMediaAssets(instanceName),
    enabled,
    staleTime: 60_000,
  });

  return {
    assets: query.data ?? [],
    loading: query.isLoading,
    refetch: query.refetch,
  };
}
