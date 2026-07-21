import "../load-env.js";

import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { tokenLineItems } from "../ai-costs.js";
import {
  PipelineClassifier,
  type PipelineClassifierMessage,
  type PipelineClassifierStage,
} from "../pipeline-classifier.js";

const execFileAsync = promisify(execFile);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QueryResult<T> = {
  rows: T[];
};

type Claim = {
  lead_id: string;
  aces_id: number;
  pipeline_id: string;
  stage_id: string;
  lead_name: string | null;
  instance_name: string | null;
  check_at: string | null;
  cutoff_at: string;
  previous_summary: string | null;
  previous_confidence: number | null;
  followup_enabled: boolean;
  claim_token: string;
  last_pipeline_activity_at: string;
  origin_stage_id: string | null;
  origin_stage_name: string | null;
};

type BundleRow = {
  bundle: {
    pipeline: { id: string; name: string };
    stages: PipelineClassifierStage[];
    messages: PipelineClassifierMessage[];
  };
};

type CompletionRow = {
  completion: {
    success: boolean;
    run_id: string;
    mode: "full" | "incremental";
    applied_stage_id: string | null;
    skip_reason: string | null;
    check_at: string;
  };
};

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel obrigatoria ausente: ${name}`);
  return value;
}

function sqlText(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlNullableText(value: string | null | undefined) {
  return value == null ? "NULL" : sqlText(value);
}

function sqlUuid(value: string | null | undefined) {
  if (value == null) return "NULL";
  if (!UUID_PATTERN.test(value)) throw new Error(`UUID invalido: ${value}`);
  return `${sqlText(value)}::uuid`;
}

function sqlNumber(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "NULL" : String(value);
}

function isProviderBillingBlocked(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /429 Too Many Requests|credits are depleted|billing|quota/i.test(
    message,
  );
}

async function queryLinked<T>(sql: string): Promise<T[]> {
  const command = process.execPath;
  const npxCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npx-cli.js",
  );
  const { stdout, stderr } = await execFileAsync(
    command,
    [
      npxCli,
      "--yes",
      "supabase",
      "db",
      "query",
      "--linked",
      "--output-format",
      "json",
      sql.replaceAll(/\s+/g, " ").trim(),
    ],
    {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );

  if (stderr.trim() && !/Initialising login role/i.test(stderr)) {
    console.warn("[pipeline-pilot] Aviso da CLI:", stderr.trim());
  }

  const parsed = JSON.parse(stdout) as QueryResult<T>;
  return parsed.rows ?? [];
}

async function fetchBundle(claim: Claim) {
  const rows = await queryLinked<BundleRow>(`
    SELECT jsonb_build_object(
      'pipeline', jsonb_build_object('id', pipeline.id, 'name', pipeline.name),
      'stages', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', stage.id,
          'name', stage.name,
          'category', stage.category,
          'position', stage.position,
          'semanticKey', stage.classifier_semantic_key,
          'classifierDestination', stage.classifier_is_destination,
          'description', stage.classifier_description,
          'positiveSignals', stage.classifier_positive_signals,
          'negativeSignals', stage.classifier_negative_signals,
          'examples', stage.classifier_examples
        ) ORDER BY stage.position)
        FROM crm.pipeline_stages AS stage
        WHERE stage.pipeline_id = pipeline.id
          AND stage.aces_id = pipeline.aces_id
      ), '[]'::jsonb),
      'messages', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', history.id,
          'content', history.content,
          'direction', history.direction,
          'sourceType', history.source_type,
          'sentAt', history.sent_at
        ) ORDER BY history.sent_at, history.id)
        FROM crm.message_history AS history
        WHERE history.lead_id = ${sqlUuid(claim.lead_id)}
          AND history.aces_id = ${claim.aces_id}
          AND history.source_type <> 'system'
          AND history.sent_at <= ${sqlText(claim.cutoff_at)}::timestamptz
          ${claim.check_at ? `AND history.sent_at > ${sqlText(claim.check_at)}::timestamptz` : ""}
      ), '[]'::jsonb)
    ) AS bundle
    FROM crm.pipelines AS pipeline
    WHERE pipeline.id = ${sqlUuid(claim.pipeline_id)}
      AND pipeline.aces_id = ${claim.aces_id};
  `);

  if (!rows[0]?.bundle)
    throw new Error("Bundle de classificacao nao encontrado");
  return rows[0].bundle;
}

async function failClaim(claim: Claim, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await queryLinked(`
    SELECT crm.service_fail_pipeline_analysis(
      ${sqlUuid(claim.lead_id)},
      ${sqlUuid(claim.claim_token)},
      ${sqlText(message.slice(0, 2000))},
      300
    ) AS released;
  `);
}

async function main() {
  const limit = Math.max(1, Math.min(10, Number(process.argv[2] ?? 10)));
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

  const claims = await queryLinked<Claim>(`
    SELECT *
    FROM crm.service_claim_pipeline_analyses(${limit}, 1800, 2)
    WHERE aces_id = 3
    ORDER BY last_pipeline_activity_at, lead_id;
  `);

  if (claims.length === 0) {
    console.log(
      JSON.stringify({ requested: limit, claimed: 0, results: [] }, null, 2),
    );
    return;
  }

  const report: Array<Record<string, unknown>> = [];
  let providerBillingError: string | null = null;

  for (const [index, claim] of claims.entries()) {
    if (providerBillingError) {
      await failClaim(claim, providerBillingError);
      report.push({
        order: index + 1,
        leadId: claim.lead_id,
        leadName: claim.lead_name,
        previousStageId: claim.stage_id,
        error:
          "Nao processado: circuito do provedor aberto apos falha de credito/quota",
      });
      continue;
    }

    try {
      const bundle = await fetchBundle(claim);
      if (bundle.messages.length === 0)
        throw new Error("Claim sem mensagens classificaveis");

      const mode = claim.check_at ? "incremental" : "full";
      const result = await classifier.classify({
        mode,
        lead: {
          id: claim.lead_id,
          name: claim.lead_name,
          currentStageId: claim.stage_id,
        },
        pipeline: bundle.pipeline,
        stages: bundle.stages,
        messages: bundle.messages,
        previousSummary: claim.previous_summary ?? "",
        previousConfidence: claim.previous_confidence,
        originStage:
          claim.origin_stage_id && claim.origin_stage_name
            ? { id: claim.origin_stage_id, name: claim.origin_stage_name }
            : null,
        cutoffAt: claim.cutoff_at,
      });

      const completionRows = await queryLinked<CompletionRow>(`
        SELECT crm.service_complete_pipeline_analysis(
          ${sqlUuid(claim.lead_id)},
          ${sqlUuid(claim.claim_token)},
          ${sqlText(claim.cutoff_at)}::timestamptz,
          ${sqlUuid(claim.stage_id)},
          ${sqlUuid(result.suggestedStageId)},
          ${result.shouldApplyStage ? "true" : "false"},
          ${sqlText(result.summary)},
          ${sqlNumber(result.confidence)},
          ${sqlText(result.reason)},
          ${sqlText(result.modelName)},
          ${sqlNumber(result.tokensInput)},
          ${sqlNumber(result.tokensOutput)},
          ${sqlText(JSON.stringify(result.rawDecision))}::jsonb,
          ${sqlText(claim.last_pipeline_activity_at)}::timestamptz
        ) AS completion;
      `);
      const completion = completionRows[0]?.completion;
      if (!completion?.success)
        throw new Error("Conclusao da classificacao nao confirmada");

      const lineItems = tokenLineItems(result.tokensInput, result.tokensOutput);
      await queryLinked(`
        SELECT crm.service_record_ai_usage(
          ${sqlText(`pipeline:${claim.lead_id}:${claim.cutoff_at}:classifier`)},
          ${claim.aces_id},
          'pipeline_classifier',
          'google_gemini',
          ${sqlText(result.modelName)},
          ${sqlText(JSON.stringify(lineItems))}::jsonb,
          'standard',
          NULL,
          NULL,
          NULL,
          ${sqlUuid(completion.run_id)},
          NULL,
          ${sqlUuid(claim.lead_id)},
          ${sqlNullableText(claim.instance_name)},
          ${sqlText(JSON.stringify({ pilot: true, mode, cutoff_at: claim.cutoff_at }))}::jsonb,
          now()
        ) AS usage_event_id;
      `);

      const stageById = new Map(
        bundle.stages.map((stage) => [stage.id, stage.name]),
      );
      report.push({
        order: index + 1,
        leadId: claim.lead_id,
        leadName: claim.lead_name,
        mode,
        previousStageId: claim.stage_id,
        previousStage: stageById.get(claim.stage_id) ?? claim.stage_id,
        suggestedStageId: result.suggestedStageId,
        suggestedStage: result.suggestedStageId
          ? (stageById.get(result.suggestedStageId) ?? result.suggestedStageId)
          : null,
        appliedStageId: completion.applied_stage_id,
        appliedStage: completion.applied_stage_id
          ? (stageById.get(completion.applied_stage_id) ??
            completion.applied_stage_id)
          : null,
        finalStage:
          stageById.get(completion.applied_stage_id ?? claim.stage_id) ??
          completion.applied_stage_id ??
          claim.stage_id,
        confidence: result.confidence,
        shouldApplyStage: result.shouldApplyStage,
        skipReason: completion.skip_reason,
        reason: result.reason,
        runId: completion.run_id,
        cutoffAt: claim.cutoff_at,
        messageCount: bundle.messages.length,
        model: result.modelName,
      });
      console.error(
        `[pipeline-pilot] ${index + 1}/${claims.length} concluido: ${stageById.get(claim.stage_id) ?? claim.stage_id} -> ${stageById.get(completion.applied_stage_id ?? claim.stage_id) ?? completion.applied_stage_id ?? claim.stage_id}`,
      );
    } catch (error) {
      if (isProviderBillingBlocked(error)) {
        providerBillingError =
          error instanceof Error ? error.message : String(error);
      }
      await failClaim(claim, error).catch((releaseError) => {
        console.error("[pipeline-pilot] Falha ao liberar claim:", releaseError);
      });
      report.push({
        order: index + 1,
        leadId: claim.lead_id,
        leadName: claim.lead_name,
        previousStageId: claim.stage_id,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(
        `[pipeline-pilot] ${index + 1}/${claims.length} falhou: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(
    JSON.stringify(
      { requested: limit, claimed: claims.length, results: report },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("[pipeline-pilot] Falha fatal:", error);
  process.exitCode = 1;
});
