import { useMutation } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { AutomationPreviewResult } from "@/lib/automation";

async function previewAutomationRule(funnelId: string, leadId: string) {
  const { data, error } = await supabase.rpc("rpc_preview_automation_rule", {
    p_funnel_id: funnelId,
    p_lead_id: leadId,
  });

  if (error) {
    throw error;
  }

  return data as AutomationPreviewResult;
}

export function useAutomationPreview() {
  const previewMutation = useMutation({
    mutationFn: async (params: { funnelId: string; leadId: string }) =>
      previewAutomationRule(params.funnelId, params.leadId),
  });

  return {
    preview: previewMutation.mutateAsync,
    previewResult: previewMutation.data || null,
    loading: previewMutation.isPending,
    error: previewMutation.error,
    reset: previewMutation.reset,
  };
}
