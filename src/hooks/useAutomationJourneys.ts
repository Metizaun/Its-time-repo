import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  cloneRuleNode,
  normalizeRuleNode,
  type AutomationAnchorEvent,
  type AutomationJourney,
  type AutomationReentryMode,
  type AutomationRuleNode,
  type AutomationStep,
} from "@/lib/automation";

const EMPTY_JOURNEYS: AutomationJourney[] = [];
const EMPTY_STEPS: AutomationStep[] = [];

export interface AutomationJourneyPayload {
  name: string;
  trigger_stage_id: string;
  instance_name: string;
  is_active: boolean;
  humanized_dispatch_enabled: boolean;
  dispatch_limit_per_hour: number;
  entry_rule: AutomationRuleNode;
  exit_rule: AutomationRuleNode;
  anchor_event: AutomationAnchorEvent;
  reentry_mode: AutomationReentryMode;
  reply_target_stage_id: string | null;
  builder_version: number;
}

export interface AutomationStepPayload {
  label: string;
  delay_minutes: number;
  message_template: string;
  is_active: boolean;
  step_rule: AutomationRuleNode | null;
}

function normalizeJourney(row: Record<string, unknown>) {
  return {
    ...(row as Omit<AutomationJourney, "entry_rule" | "exit_rule" | "anchor_event" | "reentry_mode">),
    entry_rule: normalizeRuleNode(row.entry_rule),
    exit_rule: normalizeRuleNode(row.exit_rule),
    humanized_dispatch_enabled: Boolean(row.humanized_dispatch_enabled),
    dispatch_limit_per_hour: Number(row.dispatch_limit_per_hour ?? 40),
    anchor_event: (row.anchor_event as AutomationAnchorEvent | null) ?? "stage_entered_at",
    reentry_mode: (row.reentry_mode as AutomationReentryMode | null) ?? "restart_on_match",
    reply_target_stage_id: (row.reply_target_stage_id as string | null) ?? null,
    builder_version: Number(row.builder_version ?? 1),
  } as AutomationJourney;
}

function normalizeStep(row: Record<string, unknown>) {
  return {
    ...(row as Omit<AutomationStep, "step_rule">),
    step_rule: row.step_rule ? normalizeRuleNode(row.step_rule) : null,
  } as AutomationStep;
}

function serializeRuleNode(rule: AutomationRuleNode | null) {
  if (!rule) {
    return null;
  }

  return cloneRuleNode(rule);
}

async function fetchJourneysAndSteps() {
  const [{ data: journeyData, error: journeyError }, { data: stepData, error: stepError }] = await Promise.all([
    supabase.from("automation_funnels").select("*").order("created_at", { ascending: true }),
    supabase
      .from("automation_steps")
      .select("*")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (journeyError) {
    throw journeyError;
  }

  if (stepError) {
    throw stepError;
  }

  return {
    journeys: (journeyData ?? []).map((row) => normalizeJourney(row as Record<string, unknown>)),
    steps: (stepData ?? []).map((row) => normalizeStep(row as Record<string, unknown>)),
  };
}

async function syncJourneyRpc(funnelId: string) {
  const { data, error } = await supabase.rpc("rpc_sync_automation_funnel_v2", {
    p_funnel_id: funnelId,
  });

  if (error) {
    throw error;
  }

  return data;
}

export function useAutomationJourneys(enabled = true) {
  const queryClient = useQueryClient();

  const journeysQuery = useQuery({
    queryKey: ["automation", "journeys"],
    queryFn: fetchJourneysAndSteps,
    enabled,
  });

  const journeys = journeysQuery.data?.journeys ?? EMPTY_JOURNEYS;
  const steps = journeysQuery.data?.steps ?? EMPTY_STEPS;

  const stepsByJourney = useMemo(() => {
    return steps.reduce<Record<string, AutomationStep[]>>((accumulator, step) => {
      accumulator[step.funnel_id] = [...(accumulator[step.funnel_id] ?? []), step].sort((left, right) => {
        if (left.position !== right.position) {
          return left.position - right.position;
        }

        return left.created_at.localeCompare(right.created_at);
      });

      return accumulator;
    }, {});
  }, [steps]);

  const stepCounts = useMemo(() => {
    return Object.fromEntries(
      Object.entries(stepsByJourney).map(([journeyId, journeySteps]) => [journeyId, journeySteps.length]),
    );
  }, [stepsByJourney]);

  const invalidateJourneys = async () => {
    await queryClient.invalidateQueries({ queryKey: ["automation", "journeys"] });
  };

  const syncJourneyMutation = useMutation({
    mutationFn: syncJourneyRpc,
  });

  const createJourneyMutation = useMutation({
    mutationFn: async (payload: AutomationJourneyPayload) => {
      const { data, error } = await supabase
        .from("automation_funnels")
        .insert({
          ...payload,
          entry_rule: serializeRuleNode(payload.entry_rule),
          exit_rule: serializeRuleNode(payload.exit_rule),
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return normalizeJourney(data as Record<string, unknown>);
    },
  });

  const updateJourneyMutation = useMutation({
    mutationFn: async (params: { journeyId: string; payload: AutomationJourneyPayload }) => {
      const { data, error } = await supabase
        .from("automation_funnels")
        .update({
          ...params.payload,
          entry_rule: serializeRuleNode(params.payload.entry_rule),
          exit_rule: serializeRuleNode(params.payload.exit_rule),
        })
        .eq("id", params.journeyId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return normalizeJourney(data as Record<string, unknown>);
    },
  });

  const deleteJourneyMutation = useMutation({
    mutationFn: async (journeyId: string) => {
      const { error } = await supabase.from("automation_funnels").delete().eq("id", journeyId);

      if (error) {
        throw error;
      }
    },
  });

  const createStepMutation = useMutation({
    mutationFn: async (params: { funnelId: string; payload: AutomationStepPayload }) => {
      const journeySteps = stepsByJourney[params.funnelId] ?? [];
      const nextPosition =
        journeySteps.length > 0 ? Math.max(...journeySteps.map((step) => step.position)) + 1 : 0;

      const { data, error } = await supabase
        .from("automation_steps")
        .insert({
          funnel_id: params.funnelId,
          position: nextPosition,
          channel: "whatsapp",
          ...params.payload,
          step_rule: serializeRuleNode(params.payload.step_rule),
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return normalizeStep(data as Record<string, unknown>);
    },
  });

  const updateStepMutation = useMutation({
    mutationFn: async (params: { stepId: string; funnelId: string; payload: AutomationStepPayload }) => {
      const { data, error } = await supabase
        .from("automation_steps")
        .update({
          ...params.payload,
          step_rule: serializeRuleNode(params.payload.step_rule),
        })
        .eq("id", params.stepId)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return {
        step: normalizeStep(data as Record<string, unknown>),
        funnelId: params.funnelId,
      };
    },
  });

  const deleteStepMutation = useMutation({
    mutationFn: async (params: { stepId: string; funnelId: string }) => {
      const { error } = await supabase.from("automation_steps").delete().eq("id", params.stepId);

      if (error) {
        throw error;
      }

      return params.funnelId;
    },
  });

  const reorderStepsMutation = useMutation({
    mutationFn: async (params: { funnelId: string; reorderedSteps: AutomationStep[] }) => {
      const updates = params.reorderedSteps.map((step, index) =>
        supabase.from("automation_steps").update({ position: index }).eq("id", step.id),
      );

      const results = await Promise.all(updates);
      const failure = results.find((result) => result.error);
      if (failure?.error) {
        throw failure.error;
      }

      return params.funnelId;
    },
  });

  return {
    journeys,
    steps,
    stepsByJourney,
    stepCounts,
    loadingJourneys: journeysQuery.isLoading,
    loadingSteps: journeysQuery.isLoading,
    refetchJourneys: journeysQuery.refetch,
    syncJourney: async (funnelId: string) => {
      const result = await syncJourneyMutation.mutateAsync(funnelId);
      await invalidateJourneys();
      return result;
    },
    createJourney: async (payload: AutomationJourneyPayload, initialStepPayload?: AutomationStepPayload | null) => {
      const journey = await createJourneyMutation.mutateAsync(payload);
      if (initialStepPayload) {
        try {
          await createStepMutation.mutateAsync({ funnelId: journey.id, payload: initialStepPayload });
        } catch (error) {
          await deleteJourneyMutation.mutateAsync(journey.id).catch(() => undefined);
          throw error;
        }
      }

      await syncJourneyRpc(journey.id);
      await invalidateJourneys();
      toast.success(initialStepPayload ? "Automacao criada com mensagem inicial" : "Automacao criada com sucesso");
      return journey;
    },
    updateJourney: async (journeyId: string, payload: AutomationJourneyPayload) => {
      const journey = await updateJourneyMutation.mutateAsync({ journeyId, payload });
      await syncJourneyRpc(journey.id);
      await invalidateJourneys();
      toast.success("Automacao atualizada com sucesso");
      return journey;
    },
    deleteJourney: async (journeyId: string) => {
      await deleteJourneyMutation.mutateAsync(journeyId);
      await invalidateJourneys();
      toast.success("Automacao removida com sucesso");
    },
    createStep: async (funnelId: string, payload: AutomationStepPayload) => {
      const step = await createStepMutation.mutateAsync({ funnelId, payload });
      await syncJourneyRpc(step.funnel_id);
      await invalidateJourneys();
      toast.success("Mensagem adicionada com sucesso");
      return step;
    },
    updateStep: async (stepId: string, funnelId: string, payload: AutomationStepPayload) => {
      const result = await updateStepMutation.mutateAsync({ stepId, funnelId, payload });
      await syncJourneyRpc(result.funnelId);
      await invalidateJourneys();
      toast.success("Mensagem atualizada com sucesso");
      return result;
    },
    deleteStep: async (stepId: string, funnelId: string) => {
      await deleteStepMutation.mutateAsync({ stepId, funnelId });
      await syncJourneyRpc(funnelId);
      await invalidateJourneys();
      toast.success("Mensagem removida com sucesso");
    },
    reorderSteps: async (funnelId: string, reorderedSteps: AutomationStep[]) => {
      await reorderStepsMutation.mutateAsync({ funnelId, reorderedSteps });
      await syncJourneyRpc(funnelId);
      await invalidateJourneys();
      toast.success("Ordem das mensagens atualizada");
    },
  };
}
