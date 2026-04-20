import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  getLeadAiState,
  updateLeadAiState,
  type LeadAiControlState,
  type LeadAiReason,
} from "@/services/leadAiService";

type UseLeadAiControlOptions = {
  enabled?: boolean;
};

type ToggleResult = Promise<LeadAiControlState | null>;

export function useLeadAiControl(
  leadId: string | null,
  instanceName?: string | null,
  options: UseLeadAiControlOptions = {}
) {
  const { enabled: hookEnabled = true } = options;
  const [state, setState] = useState<LeadAiControlState | null>(null);
  const [loading, setLoading] = useState(Boolean(hookEnabled && leadId));
  const [saving, setSaving] = useState(false);

  const fetchState = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!hookEnabled || !leadId) {
        setState(null);
        setLoading(false);
        return null;
      }

      if (!silent) {
        setLoading(true);
      }

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          throw sessionError;
        }

        const accessToken = sessionData.session?.access_token;
        if (!accessToken) {
          throw new Error("Sessao expirada. Faca login novamente.");
        }

        const nextState = await getLeadAiState({
          accessToken,
          leadId,
        });

        setState(nextState);
        return nextState;
      } catch (error: any) {
        console.error("Erro ao carregar controle de IA do lead:", error);

        if (!silent) {
          toast.error("Erro ao carregar controle da IA", {
            description: error.message,
          });
        }

        return null;
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [hookEnabled, leadId]
  );

  const toggle = useCallback(
    async (nextEnabled: boolean): ToggleResult => {
      if (!hookEnabled || !leadId || !state || saving || loading || !state.available) {
        return null;
      }

      const previousState = state;
      const optimisticReason: LeadAiReason = nextEnabled ? "active" : "manual_off";

      setSaving(true);
      setState({
        ...state,
        enabled: nextEnabled,
        pausedUntil: null,
        reason: optimisticReason,
        bypassingGlobalInactive: nextEnabled ? !state.agentIsActive : false,
      });

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
          throw sessionError;
        }

        const accessToken = sessionData.session?.access_token;
        if (!accessToken) {
          throw new Error("Sessao expirada. Faca login novamente.");
        }

        const nextState = await updateLeadAiState({
          accessToken,
          leadId,
          enabled: nextEnabled,
        });

        setState(nextState);
        toast.success(nextEnabled ? "IA ativada para o lead" : "IA desativada para o lead");
        return nextState;
      } catch (error: any) {
        console.error("Erro ao atualizar controle de IA do lead:", error);
        setState(previousState);
        toast.error("Erro ao atualizar controle da IA", {
          description: error.message,
        });
        return null;
      } finally {
        setSaving(false);
      }
    },
    [hookEnabled, leadId, loading, saving, state]
  );

  useEffect(() => {
    void fetchState();
  }, [fetchState, instanceName]);

  useEffect(() => {
    if (!hookEnabled || !leadId) {
      return;
    }

    const messageChannel = supabase
      .channel(`lead-ai-control:messages:${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "crm",
          table: "message_history",
          filter: `lead_id=eq.${leadId}`,
        },
        () => {
          void fetchState({ silent: true });
        }
      )
      .subscribe();

    const leadStateChannel = supabase
      .channel(`lead-ai-control:state:${leadId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "crm",
          table: "ai_lead_state",
          filter: `lead_id=eq.${leadId}`,
        },
        () => {
          void fetchState({ silent: true });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messageChannel);
      supabase.removeChannel(leadStateChannel);
    };
  }, [fetchState, hookEnabled, leadId]);

  return {
    state,
    enabled: state?.enabled ?? false,
    available: state?.available ?? false,
    reason: state?.reason ?? ("no_agent" as LeadAiReason),
    bypassingGlobalInactive: state?.bypassingGlobalInactive ?? false,
    loading,
    saving,
    toggle,
    refetch: fetchState,
  };
}
