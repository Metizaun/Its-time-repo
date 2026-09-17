import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { getCrmBackend } from "@/services/crmBackend";

export function useIsSupportStaff() {
  const { user, loading: authLoading } = useAuth();
  const query = useQuery({
    queryKey: ["support-access", user?.id],
    queryFn: () => getCrmBackend<{ isSupportStaff: boolean }>("/api/agent-simulator/access"),
    enabled: Boolean(user && !authLoading),
    staleTime: 60_000,
    retry: false,
  });

  return {
    isSupportStaff: query.data?.isSupportStaff === true,
    loading: authLoading || (Boolean(user) && query.isLoading),
    error: query.error,
  };
}
