import "./load-env.js";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { tokenLineItems, tryRecordAiUsage } from "./ai-costs.js";
import {
  PipelineClassifier,
  type PipelineClassifierMessage,
  type PipelineClassifierStage,
} from "./pipeline-classifier.js";

type JsonRecord = Record<string, unknown>;

type ClaimedPipelineAnalysis = {
  lead_id: string;
  aces_id: number;
  pipeline_id: string;
  stage_id: string;
  lead_name: string | null;
  instance_name: string | null;
  check_at: string | null;
  cutoff_at: string;
  last_pipeline_activity_at: string;
  previous_summary: string | null;
  previous_confidence: number | null;
  followup_enabled: boolean;
  claim_token: string;
  origin_stage_id: string | null;
  origin_stage_name: string | null;
  attendance_cycle_started_at: string | null;
};

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel obrigatoria ausente: ${name}`);
  return value;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  max: number,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

async function fetchPipeline(
  client: SupabaseClient<any, any, any>,
  claim: ClaimedPipelineAnalysis,
) {
  const { data, error } = await client
    .from("pipelines")
    .select("id, name, ai_classification_enabled")
    .eq("id", claim.pipeline_id)
    .eq("aces_id", claim.aces_id)
    .single();

  if (error || !data) {
    throw new Error(
      `Nao foi possivel carregar o pipeline: ${error?.message ?? "ausente"}`,
    );
  }

  if (!data.ai_classification_enabled) {
    throw new Error("Classificacao foi desabilitada durante o processamento");
  }

  return { id: String(data.id), name: String(data.name) };
}

async function fetchStages(
  client: SupabaseClient<any, any, any>,
  claim: ClaimedPipelineAnalysis,
) {
  const { data, error } = await client
    .from("pipeline_stages")
    .select(
      "id, name, category, position, classifier_semantic_key, classifier_is_destination, classifier_description, classifier_positive_signals, classifier_negative_signals, classifier_examples",
    )
    .eq("aces_id", claim.aces_id)
    .eq("pipeline_id", claim.pipeline_id)
    .order("position", { ascending: true });

  if (error) {
    throw new Error(
      `Nao foi possivel carregar as etapas do pipeline: ${error.message}`,
    );
  }

  const stages: PipelineClassifierStage[] = (data ?? []).map((stage) => ({
    id: String(stage.id),
    name: String(stage.name),
    category: String(stage.category),
    position: Number(stage.position),
    semanticKey: stage.classifier_semantic_key
      ? String(stage.classifier_semantic_key)
      : null,
    classifierDestination: Boolean(stage.classifier_is_destination),
    description: String(stage.classifier_description ?? ""),
    positiveSignals: Array.isArray(stage.classifier_positive_signals)
      ? stage.classifier_positive_signals
      : [],
    negativeSignals: Array.isArray(stage.classifier_negative_signals)
      ? stage.classifier_negative_signals
      : [],
    examples: Array.isArray(stage.classifier_examples)
      ? stage.classifier_examples
      : [],
  }));

  if (stages.length === 0) {
    throw new Error("Pipeline ativo sem etapas classificaveis");
  }

  return stages;
}

async function fetchMessages(
  client: SupabaseClient<any, any, any>,
  claim: ClaimedPipelineAnalysis,
) {
  const pageSize = 500;
  const messages: PipelineClassifierMessage[] = [];

  for (let from = 0; ; from += pageSize) {
    let query = client
      .from("message_history")
      .select("id, content, direction, source_type, sent_at")
      .eq("aces_id", claim.aces_id)
      .eq("lead_id", claim.lead_id)
      .neq("source_type", "system")
      .lte("sent_at", claim.cutoff_at)
      .order("sent_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (claim.check_at) {
      query = query.gt("sent_at", claim.check_at);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(
        `Nao foi possivel carregar mensagens para classificacao: ${error.message}`,
      );
    }

    const page = data ?? [];
    messages.push(
      ...page.map((message) => ({
        id: String(message.id),
        content: String(message.content ?? ""),
        direction: String(message.direction ?? ""),
        sourceType: String(message.source_type ?? ""),
        sentAt: String(message.sent_at),
      })),
    );

    if (page.length < pageSize) break;
  }

  return messages;
}

async function failClaim(
  client: SupabaseClient<any, any, any>,
  claim: ClaimedPipelineAnalysis,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  const { error: releaseError } = await client.rpc(
    "service_fail_pipeline_analysis",
    {
      p_lead_id: claim.lead_id,
      p_claim_token: claim.claim_token,
      p_error: message,
      p_retry_seconds: 300,
    },
  );

  if (releaseError) {
    console.error("[pipeline-worker] Falha ao liberar claim:", {
      leadId: claim.lead_id,
      error: releaseError.message,
    });
  }
}

export function startPipelineWorker() {
  const crmClient = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      db: { schema: "crm" },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const classifier = new PipelineClassifier({
    apiKey: requireEnv("GEMINI_API_KEY"),
    modelName:
      process.env.PIPELINE_CLASSIFIER_MODEL ??
      process.env.CRM_ANALYSIS_WORKER_MODEL,
    fallbackModels: (process.env.GEMINI_FALLBACK_MODELS ?? "")
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean),
    maxRetries: Number(process.env.GEMINI_MAX_RETRIES ?? 3),
    retryBaseDelayMs: Number(process.env.GEMINI_RETRY_BASE_DELAY_MS ?? 1000),
  });
  const pollMs = parsePositiveInteger(
    process.env.PIPELINE_WORKER_POLL_MS,
    60_000,
    3_600_000,
  );
  const batchSize = parsePositiveInteger(
    process.env.PIPELINE_WORKER_BATCH_SIZE,
    10,
    100,
  );
  const leaseSeconds = parsePositiveInteger(
    process.env.PIPELINE_WORKER_LEASE_SECONDS,
    600,
    1800,
  );
  const perAccountLimit = parsePositiveInteger(
    process.env.PIPELINE_WORKER_PER_ACCOUNT_LIMIT,
    2,
    100,
  );
  let running = false;

  const processClaim = async (claim: ClaimedPipelineAnalysis) => {
    try {
      const [pipeline, stages, messages] = await Promise.all([
        fetchPipeline(crmClient, claim),
        fetchStages(crmClient, claim),
        fetchMessages(crmClient, claim),
      ]);

      if (messages.length === 0) {
        throw new Error(
          "Claim sem mensagens classificaveis no intervalo informado",
        );
      }

      const mode = claim.check_at ? "incremental" : "full";
      const result = await classifier.classify({
        mode,
        lead: {
          id: claim.lead_id,
          name: claim.lead_name,
          currentStageId: claim.stage_id,
        },
        pipeline,
        stages,
        messages,
        previousSummary: claim.previous_summary ?? "",
        previousConfidence: claim.previous_confidence,
        originStage:
          claim.origin_stage_id && claim.origin_stage_name
            ? { id: claim.origin_stage_id, name: claim.origin_stage_name }
            : null,
        cutoffAt: claim.cutoff_at,
      });

      await tryRecordAiUsage(crmClient, {
        idempotencyKey: `pipeline:${claim.lead_id}:${claim.cutoff_at}:classifier`,
        acesId: claim.aces_id,
        featureKey: "pipeline_classifier",
        provider: "google_gemini",
        model: result.modelName,
        lineItems: tokenLineItems(result.tokensInput, result.tokensOutput),
        leadId: claim.lead_id,
        instanceName: claim.instance_name,
        occurredAt: new Date().toISOString(),
        metadata: {
          pipeline_id: claim.pipeline_id,
          mode,
          cutoff_at: claim.cutoff_at,
          followup_enabled: claim.followup_enabled,
        },
      });

      const { data, error } = await crmClient.rpc(
        "service_complete_pipeline_analysis",
        {
          p_lead_id: claim.lead_id,
          p_claim_token: claim.claim_token,
          p_cutoff_at: claim.cutoff_at,
          p_observed_stage_id: claim.stage_id,
          p_suggested_stage_id: result.suggestedStageId,
          p_should_apply_stage: result.shouldApplyStage,
          p_summary: result.summary,
          p_confidence: result.confidence,
          p_reason: result.reason,
          p_model_name: result.modelName,
          p_tokens_input: result.tokensInput,
          p_tokens_output: result.tokensOutput,
          p_decision: result.rawDecision,
          p_observed_pipeline_activity_at: claim.last_pipeline_activity_at,
        },
      );

      if (error) {
        throw new Error(
          `Nao foi possivel concluir a classificacao: ${error.message}`,
        );
      }

      const completion = asRecord(data);
      console.log("[pipeline-worker] Classificacao concluida:", {
        leadId: claim.lead_id,
        pipelineId: claim.pipeline_id,
        mode,
        runId: completion.run_id ?? null,
        appliedStageId: completion.applied_stage_id ?? null,
        skipReason: completion.skip_reason ?? null,
      });
    } catch (error) {
      console.error("[pipeline-worker] Falha na classificacao:", {
        leadId: claim.lead_id,
        pipelineId: claim.pipeline_id,
        error: error instanceof Error ? error.message : String(error),
      });
      await failClaim(crmClient, claim, error);
    }
  };

  const runCycle = async () => {
    if (running) return;
    running = true;

    try {
      const { data, error } = await crmClient.rpc(
        "service_claim_pipeline_analyses",
        {
          p_limit: batchSize,
          p_lease_seconds: leaseSeconds,
          p_per_account_limit: perAccountLimit,
        },
      );
      if (error) {
        throw new Error(
          `Falha ao buscar classificacoes pendentes: ${error.message}`,
        );
      }

      const claims = (data ?? []) as ClaimedPipelineAnalysis[];
      for (const claim of claims) {
        await processClaim(claim);
      }
    } catch (error) {
      console.error("[pipeline-worker] Erro no ciclo:", error);
    } finally {
      running = false;
    }
  };

  console.log("[pipeline-worker] Iniciado:", {
    pollMs,
    batchSize,
    leaseSeconds,
    perAccountLimit,
  });
  void runCycle();
  const timer = setInterval(() => void runCycle(), pollMs);

  return () => clearInterval(timer);
}
