import type { SupabaseClient } from "@supabase/supabase-js";

export type AiUsageLineItem = {
  metric: string;
  quantity: number;
  metadata?: Record<string, unknown>;
};

export type RecordAiUsageInput = {
  idempotencyKey: string;
  acesId: number;
  featureKey: string;
  provider: string;
  model: string;
  lineItems: AiUsageLineItem[];
  operation?: string;
  providerRequestId?: string | null;
  aiRunId?: string | null;
  toolRunId?: string | null;
  pipelineRunId?: string | null;
  agentId?: string | null;
  leadId?: string | null;
  instanceName?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
};

function normalizeLineItems(items: AiUsageLineItem[]) {
  return items
    .filter(
      (item) =>
        item.metric.trim() &&
        Number.isFinite(item.quantity) &&
        item.quantity >= 0,
    )
    .map((item) => ({
      metric: item.metric.trim(),
      quantity: item.quantity,
      metadata: item.metadata ?? {},
    }));
}

export async function recordAiUsage(
  crmClient: SupabaseClient<any, any, any>,
  input: RecordAiUsageInput,
) {
  const lineItems = normalizeLineItems(input.lineItems);
  if (lineItems.length === 0) {
    return null;
  }

  const { data, error } = await crmClient.rpc("service_record_ai_usage", {
    p_idempotency_key: input.idempotencyKey,
    p_aces_id: input.acesId,
    p_feature_key: input.featureKey,
    p_provider: input.provider,
    p_model: input.model,
    p_line_items: lineItems,
    p_operation: input.operation ?? "standard",
    p_provider_request_id: input.providerRequestId ?? null,
    p_ai_run_id: input.aiRunId ?? null,
    p_tool_run_id: input.toolRunId ?? null,
    p_pipeline_run_id: input.pipelineRunId ?? null,
    p_agent_id: input.agentId ?? null,
    p_lead_id: input.leadId ?? null,
    p_instance_name: input.instanceName ?? null,
    p_metadata: input.metadata ?? {},
    p_occurred_at: input.occurredAt ?? new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Falha ao registrar uso de IA: ${error.message}`);
  }

  return data ? String(data) : null;
}

export async function tryRecordAiUsage(
  crmClient: SupabaseClient<any, any, any>,
  input: RecordAiUsageInput,
) {
  try {
    return await recordAiUsage(crmClient, input);
  } catch (error) {
    console.warn(
      "[costs] Falha ao registrar uso de IA; reconciliacao necessaria:",
      {
        idempotencyKey: input.idempotencyKey,
        featureKey: input.featureKey,
        provider: input.provider,
        model: input.model,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return null;
  }
}

export function tokenLineItems(
  tokensInput: number | null,
  tokensOutput: number | null,
) {
  const items: AiUsageLineItem[] = [];
  if (tokensInput !== null && tokensInput >= 0) {
    items.push({ metric: "input_text_token", quantity: tokensInput });
  }
  if (tokensOutput !== null && tokensOutput >= 0) {
    items.push({ metric: "output_token", quantity: tokensOutput });
  }
  if (items.length === 0) {
    items.push({
      metric: "request",
      quantity: 1,
      metadata: { token_usage_missing: true },
    });
  }
  return items;
}
