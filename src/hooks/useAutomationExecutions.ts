import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { AutomationExecution } from "@/lib/automation";

async function fetchAutomationExecutions(funnelId: string) {
  const { data, error } = await supabase
    .from("automation_executions")
    .select("*")
    .eq("funnel_id", funnelId)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    throw error;
  }

  return (data || []) as AutomationExecution[];
}

export function useAutomationExecutions(funnelId: string | null, enabled = true) {
  const executionsQuery = useQuery({
    queryKey: ["automation", "executions", funnelId],
    queryFn: () => fetchAutomationExecutions(funnelId as string),
    enabled: enabled && typeof funnelId === "string" && funnelId.length > 0,
    refetchInterval: 30_000,
  });

  return {
    executions: executionsQuery.data || [],
    loading: executionsQuery.isLoading,
    error: executionsQuery.error,
    refetch: executionsQuery.refetch,
  };
}
