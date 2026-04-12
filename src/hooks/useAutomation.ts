import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface AutomationFunnel {
  id: string;
  aces_id: number;
  name: string;
  trigger_stage_id: string;
  instance_name: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationStep {
  id: string;
  funnel_id: string;
  position: number;
  label: string;
  delay_minutes: number;
  message_template: string;
  channel: "whatsapp";
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationExecution {
  id: string;
  aces_id: number;
  funnel_id: string | null;
  step_id: string | null;
  lead_id: string;
  source_stage_id: string | null;
  scheduled_at: string;
  sent_at: string | null;
  cancelled_at: string | null;
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  rendered_message: string | null;
  phone_snapshot: string | null;
  instance_snapshot: string | null;
  lead_name_snapshot: string | null;
  city_snapshot: string | null;
  status_snapshot: string | null;
  funnel_name_snapshot: string | null;
  step_label_snapshot: string | null;
  last_error: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

interface FunnelPayload {
  name: string;
  trigger_stage_id: string;
  instance_name: string;
  is_active: boolean;
}

interface StepPayload {
  label: string;
  delay_minutes: number;
  message_template: string;
  is_active: boolean;
}

export function useAutomation(enabled = true) {
  const [funnels, setFunnels] = useState<AutomationFunnel[]>([]);
  const [steps, setSteps] = useState<AutomationStep[]>([]);
  const [executions, setExecutions] = useState<AutomationExecution[]>([]);
  const [stepCounts, setStepCounts] = useState<Record<string, number>>({});
  const [loadingFunnels, setLoadingFunnels] = useState(true);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [loadingExecutions, setLoadingExecutions] = useState(false);

  const fetchFunnels = useCallback(async () => {
    try {
      if (!enabled) {
        setFunnels([]);
        setStepCounts({});
        setLoadingFunnels(false);
        return;
      }

      setLoadingFunnels(true);

      const [{ data: funnelData, error: funnelError }, { data: stepData, error: stepError }] = await Promise.all([
        supabase.from("automation_funnels").select("*").order("created_at", { ascending: true }),
        supabase.from("automation_steps").select("id, funnel_id"),
      ]);

      if (funnelError) throw funnelError;
      if (stepError) throw stepError;

      const counts = (stepData || []).reduce<Record<string, number>>((acc, step) => {
        acc[step.funnel_id] = (acc[step.funnel_id] || 0) + 1;
        return acc;
      }, {});

      setFunnels((funnelData as AutomationFunnel[]) || []);
      setStepCounts(counts);
    } catch (error: any) {
      console.error("Erro ao carregar automações:", error);
      toast.error("Erro ao carregar automações", { description: error.message });
    } finally {
      setLoadingFunnels(false);
    }
  }, []);

  const fetchSteps = useCallback(async (funnelId: string | null) => {
    if (!enabled || !funnelId) {
      setSteps([]);
      return;
    }

    try {
      setLoadingSteps(true);
      const { data, error } = await supabase
        .from("automation_steps")
        .select("*")
        .eq("funnel_id", funnelId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });

      if (error) throw error;
      setSteps((data as AutomationStep[]) || []);
    } catch (error: any) {
      console.error("Erro ao carregar disparos:", error);
      toast.error("Erro ao carregar disparos", { description: error.message });
    } finally {
      setLoadingSteps(false);
    }
  }, []);

  const fetchExecutions = useCallback(async (funnelId: string | null) => {
    if (!enabled || !funnelId) {
      setExecutions([]);
      return;
    }

    try {
      setLoadingExecutions(true);
      const { data, error } = await supabase
        .from("automation_executions")
        .select("*")
        .eq("funnel_id", funnelId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setExecutions((data as AutomationExecution[]) || []);
    } catch (error: any) {
      console.error("Erro ao carregar execuções:", error);
      toast.error("Erro ao carregar execuções", { description: error.message });
    } finally {
      setLoadingExecutions(false);
    }
  }, []);

  const syncFunnel = useCallback(async (funnelId: string) => {
    const { error } = await supabase.rpc("rpc_sync_automation_funnel", {
      p_funnel_id: funnelId,
    });

    if (error) {
      throw error;
    }
  }, []);

  const createFunnel = useCallback(async (payload: FunnelPayload) => {
    const { data, error } = await supabase
      .from("automation_funnels")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    await fetchFunnels();
    toast.success("Funil criado com sucesso");
    return data as AutomationFunnel;
  }, [fetchFunnels]);

  const updateFunnel = useCallback(async (funnelId: string, payload: FunnelPayload) => {
    const { data, error } = await supabase
      .from("automation_funnels")
      .update(payload)
      .eq("id", funnelId)
      .select()
      .single();

    if (error) throw error;

    await syncFunnel(funnelId);
    await fetchFunnels();
    toast.success("Funil atualizado com sucesso");
    return data as AutomationFunnel;
  }, [fetchFunnels, syncFunnel]);

  const deleteFunnel = useCallback(async (funnelId: string) => {
    const { error } = await supabase
      .from("automation_funnels")
      .delete()
      .eq("id", funnelId);

    if (error) throw error;

    await fetchFunnels();
    setSteps([]);
    setExecutions([]);
    toast.success("Funil removido com sucesso");
  }, [fetchFunnels]);

  const createStep = useCallback(async (funnelId: string, payload: StepPayload) => {
    const nextPosition = steps.length > 0 ? Math.max(...steps.map((step) => step.position)) + 1 : 0;

    const { data, error } = await supabase
      .from("automation_steps")
      .insert({
        funnel_id: funnelId,
        position: nextPosition,
        channel: "whatsapp",
        ...payload,
      })
      .select()
      .single();

    if (error) throw error;

    await syncFunnel(funnelId);
    await fetchFunnels();
    await Promise.all([fetchSteps(funnelId), fetchExecutions(funnelId)]);
    toast.success("Disparo criado com sucesso");
    return data as AutomationStep;
  }, [fetchExecutions, fetchFunnels, fetchSteps, steps, syncFunnel]);

  const updateStep = useCallback(async (stepId: string, funnelId: string, payload: StepPayload) => {
    const { data, error } = await supabase
      .from("automation_steps")
      .update(payload)
      .eq("id", stepId)
      .select()
      .single();

    if (error) throw error;

    await syncFunnel(funnelId);
    await Promise.all([fetchSteps(funnelId), fetchExecutions(funnelId)]);
    toast.success("Disparo atualizado com sucesso");
    return data as AutomationStep;
  }, [fetchExecutions, fetchSteps, syncFunnel]);

  const deleteStep = useCallback(async (stepId: string, funnelId: string) => {
    const { error } = await supabase
      .from("automation_steps")
      .delete()
      .eq("id", stepId);

    if (error) throw error;

    await syncFunnel(funnelId);
    await fetchFunnels();
    await Promise.all([fetchSteps(funnelId), fetchExecutions(funnelId)]);
    toast.success("Disparo removido com sucesso");
  }, [fetchExecutions, fetchFunnels, fetchSteps, syncFunnel]);

  const reorderSteps = useCallback(async (funnelId: string, reorderedSteps: AutomationStep[]) => {
    const previous = steps;
    setSteps(reorderedSteps);

    try {
      const updates = reorderedSteps.map((step, index) =>
        supabase.from("automation_steps").update({ position: index }).eq("id", step.id)
      );

      const results = await Promise.all(updates);
      const failed = results.find((result) => result.error);
      if (failed?.error) {
        throw failed.error;
      }

      await syncFunnel(funnelId);
      await fetchFunnels();
      await fetchSteps(funnelId);
      toast.success("Ordem dos disparos atualizada");
    } catch (error: any) {
      setSteps(previous);
      console.error("Erro ao reordenar disparos:", error);
      toast.error("Erro ao reordenar disparos", { description: error.message });
    }
  }, [fetchFunnels, fetchSteps, steps, syncFunnel]);

  useEffect(() => {
    fetchFunnels();
  }, [enabled, fetchFunnels]);

  return {
    funnels,
    steps,
    executions,
    stepCounts,
    loadingFunnels,
    loadingSteps,
    loadingExecutions,
    refetchFunnels: fetchFunnels,
    fetchSteps,
    fetchExecutions,
    createFunnel,
    updateFunnel,
    deleteFunnel,
    createStep,
    updateStep,
    deleteStep,
    reorderSteps,
  };
}
