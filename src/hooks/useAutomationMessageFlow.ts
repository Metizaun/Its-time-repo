import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type {
  AutomationEnrollment,
  AutomationExecution,
  AutomationMessageFlowSnapshot,
  AutomationStep,
} from "@/lib/automation";

const EMPTY_FLOW: AutomationMessageFlowSnapshot = {
  stepCounts: {},
  parkedCount: 0,
  highlightedStepIds: [],
  activeLeadsCount: 0,
};

function normalizeFlowSnapshot(data: unknown): AutomationMessageFlowSnapshot {
  const record = (data ?? {}) as Record<string, unknown>;
  const rawStepCounts = (record.step_counts ?? {}) as Record<string, unknown>;
  const stepCounts = Object.fromEntries(
    Object.entries(rawStepCounts).map(([stepId, count]) => [stepId, Number(count ?? 0)]),
  );

  return {
    stepCounts,
    parkedCount: Number(record.parked_count ?? 0),
    highlightedStepIds: Array.isArray(record.highlighted_step_ids)
      ? record.highlighted_step_ids
          .map((value) => (typeof value === "string" ? value : String(value ?? "")))
          .filter(Boolean)
      : [],
    activeLeadsCount: Number(record.active_leads_count ?? 0),
  };
}

function buildFlowSnapshotFromExecutions(
  steps: AutomationStep[],
  enrollments: Pick<AutomationEnrollment, "lead_id">[],
  executions: Pick<AutomationExecution, "lead_id" | "step_id" | "status">[],
): AutomationMessageFlowSnapshot {
  const orderedSteps = [...steps].sort((left, right) => {
    if (left.position !== right.position) {
      return left.position - right.position;
    }

    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
  const orderedStepIds = orderedSteps.map((step) => step.id);
  const activeLeadIds = Array.from(new Set(enrollments.map((enrollment) => enrollment.lead_id)));
  const sentStepsByLead = new Map<string, Set<string>>();

  for (const execution of executions) {
    if (!execution.step_id || execution.status !== "sent") {
      continue;
    }

    const sentSteps = sentStepsByLead.get(execution.lead_id) ?? new Set<string>();
    sentSteps.add(execution.step_id);
    sentStepsByLead.set(execution.lead_id, sentSteps);
  }

  const stepCounts: Record<string, number> = {};
  let parkedCount = 0;

  for (const leadId of activeLeadIds) {
    const sentSteps = sentStepsByLead.get(leadId) ?? new Set<string>();
    const nextStepId = orderedStepIds.find((stepId) => !sentSteps.has(stepId)) ?? null;

    if (nextStepId) {
      stepCounts[nextStepId] = (stepCounts[nextStepId] ?? 0) + 1;
      continue;
    }

    parkedCount += 1;
  }

  const highestCount = Math.max(0, ...Object.values(stepCounts));

  return {
    stepCounts,
    parkedCount,
    highlightedStepIds: highestCount > 0
      ? Object.entries(stepCounts)
          .filter(([, count]) => count === highestCount)
          .map(([stepId]) => stepId)
      : [],
    activeLeadsCount: activeLeadIds.length,
  };
}

async function fetchAutomationMessageFlowFallback(funnelId: string, steps: AutomationStep[]) {
  const [{ data: enrollments, error: enrollmentsError }, { data: executions, error: executionsError }] =
    await Promise.all([
      supabase
        .from("automation_enrollments")
        .select("lead_id")
        .eq("funnel_id", funnelId)
        .eq("status", "active"),
      supabase
        .from("automation_executions")
        .select("lead_id, step_id, status")
        .eq("funnel_id", funnelId)
        .in("status", ["pending", "processing", "sent"]),
    ]);

  if (enrollmentsError) {
    throw enrollmentsError;
  }

  if (executionsError) {
    throw executionsError;
  }

  return buildFlowSnapshotFromExecutions(
    steps,
    (enrollments ?? []) as Pick<AutomationEnrollment, "lead_id">[],
    (executions ?? []) as Pick<AutomationExecution, "lead_id" | "step_id" | "status">[],
  );
}

async function fetchAutomationMessageFlow(funnelId: string, steps: AutomationStep[]) {
  const { data, error } = await supabase.rpc("rpc_get_automation_message_flow", {
    p_funnel_id: funnelId,
  });

  if (error && ["PGRST202", "PGRST205", "42883"].includes(error.code ?? "")) {
    return fetchAutomationMessageFlowFallback(funnelId, steps);
  }

  if (error) {
    throw error;
  }

  return normalizeFlowSnapshot(data);
}

export function useAutomationMessageFlow(
  funnelId: string | null,
  steps: AutomationStep[],
  enabled = true,
) {
  const query = useQuery({
    queryKey: ["automation", "message-flow", funnelId, steps.map((step) => `${step.id}:${step.position}`).join("|")],
    queryFn: () => fetchAutomationMessageFlow(funnelId as string, steps),
    enabled: enabled && typeof funnelId === "string" && funnelId.length > 0,
    refetchInterval: enabled ? 30_000 : false,
  });

  return {
    flow: query.data ?? EMPTY_FLOW,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
