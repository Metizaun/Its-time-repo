import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { getCrmBackend } from "@/services/crmBackend";

export function useIsStaff() {
  const { user, loading: authLoading } = useAuth();
  const query = useQuery({
    queryKey: ["superadmin-access", user?.id],
    queryFn: () => getCrmBackend<{ isStaff: boolean }>("/api/admin/access"),
    enabled: Boolean(user && !authLoading),
    staleTime: 60_000,
    retry: false,
  });

  return {
    isStaff: query.data?.isStaff === true,
    loading: authLoading || (Boolean(user) && query.isLoading),
    error: query.error,
  };
}
