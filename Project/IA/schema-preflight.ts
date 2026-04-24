import "./load-env.js";
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

type SchemaPreflightConfig = {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
};

type SchemaFailure = {
  label: string;
  reason: string;
  migration: string;
};

type NormalizedPostgrestError = {
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
};

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }

  return value;
}

function buildSchemaFailure(
  label: string,
  migration: string,
  error: PostgrestError
): SchemaFailure {
  const normalized = normalizePostgrestError(error);
  const parts = [normalized.message];

  if (normalized.details) {
    parts.push(`details: ${normalized.details}`);
  }

  if (normalized.hint) {
    parts.push(`hint: ${normalized.hint}`);
  }

  if (normalized.code) {
    parts.push(`code: ${normalized.code}`);
  }

  return {
    label,
    migration,
    reason: parts.join(" | "),
  };
}

function normalizePostgrestError(error: PostgrestError): NormalizedPostgrestError {
  const message = typeof error.message === "string" && error.message.trim()
    ? error.message.trim()
    : "Erro desconhecido ao consultar o Supabase";

  return {
    code: typeof error.code === "string" && error.code.trim() ? error.code.trim() : null,
    message,
    details:
      typeof error.details === "string" && error.details.trim() ? error.details.trim() : null,
    hint: typeof error.hint === "string" && error.hint.trim() ? error.hint.trim() : null,
  };
}

function formatSchemaFailures(failures: SchemaFailure[]) {
  const migrations = Array.from(new Set(failures.map((failure) => failure.migration)));

  return [
    "[schema-preflight] Schema do Supabase incompatível com esta versão do backend.",
    ...failures.map(
      (failure) => `- ${failure.label}: ${failure.reason} | migration: ${failure.migration}`
    ),
    "Aplique as migrations abaixo no Supabase antes de redeployar:",
    ...migrations.map((migration) => `- ${migration}`),
  ].join("\n");
}

async function validateSelectedColumns(
  serviceClient: SupabaseClient<any, any, any>,
  table: string,
  columns: string[],
  label: string,
  migration: string
) {
  const { error } = await serviceClient.from(table).select(columns.join(",")).limit(1);
  return error ? buildSchemaFailure(label, migration, error) : null;
}

async function validateHumanizedPlanRpc(serviceClient: SupabaseClient<any, any, any>) {
  const { error } = await serviceClient.rpc("rpc_plan_humanized_dispatch", {
    p_execution_id: NIL_UUID,
    p_message_length: 1,
  });

  if (!error) {
    return null;
  }

  const normalized = normalizePostgrestError(error);
  if (/Execucao nao encontrada para planejamento humanizado/i.test(normalized.message)) {
    return null;
  }

  return buildSchemaFailure(
    "crm.rpc_plan_humanized_dispatch",
    "supabase/migrations/20260420130000_add_humanized_automation_dispatch.sql",
    error
  );
}

async function validateHumanizedMarkRpc(serviceClient: SupabaseClient<any, any, any>) {
  const { error } = await serviceClient.rpc("rpc_mark_humanized_dispatch_sent", {
    p_execution_id: NIL_UUID,
    p_sent_at: new Date().toISOString(),
  });

  return error
    ? buildSchemaFailure(
        "crm.rpc_mark_humanized_dispatch_sent",
        "supabase/migrations/20260420130000_add_humanized_automation_dispatch.sql",
        error
      )
    : null;
}

async function validateHumanizedWindowRpc(serviceClient: SupabaseClient<any, any, any>) {
  const { error } = await serviceClient.rpc("is_humanized_dispatch_window", {
    p_at: new Date().toISOString(),
    p_timezone: "America/Sao_Paulo",
  });

  return error
    ? buildSchemaFailure(
        "crm.is_humanized_dispatch_window",
        "supabase/migrations/20260421160000_fix_automation_humanized_instance_holidays.sql",
        error
      )
    : null;
}

export async function assertRuntimeSchemaCompatibility(
  config: SchemaPreflightConfig = {}
) {
  const supabaseUrl = config.supabaseUrl ?? requireEnv("SUPABASE_URL");
  const supabaseServiceRoleKey =
    config.supabaseServiceRoleKey ?? requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    db: { schema: "crm" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const checks = await Promise.all([
    validateSelectedColumns(
      serviceClient,
      "ai_agents",
      ["id", "handoff_enabled", "handoff_prompt", "handoff_target_phone"],
      "crm.ai_agents (handoff)",
      "supabase/migrations/20260423230000_add_ai_agent_handoff_config.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "ai_lead_state",
      ["agent_id", "lead_id", "manual_ai_enabled"],
      "crm.ai_lead_state.manual_ai_enabled",
      "supabase/migrations/20260420110000_add_manual_ai_override_to_lead_state.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "automation_funnels",
      [
        "id",
        "entry_rule",
        "exit_rule",
        "anchor_event",
        "reentry_mode",
        "reply_target_stage_id",
        "builder_version",
      ],
      "crm.automation_funnels (logica v2)",
      "supabase/migrations/20260418090000_add_automation_logic_engine_v2.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "automation_funnels",
      ["id", "humanized_dispatch_enabled", "dispatch_limit_per_hour"],
      "crm.automation_funnels (humanizacao)",
      "supabase/migrations/20260420130000_add_humanized_automation_dispatch.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "automation_executions",
      ["id", "dispatch_meta"],
      "crm.automation_executions.dispatch_meta",
      "supabase/migrations/20260420130000_add_humanized_automation_dispatch.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "automation_holidays",
      ["id", "country_code", "holiday_date", "name", "type", "source"],
      "crm.automation_holidays",
      "supabase/migrations/20260421160000_fix_automation_humanized_instance_holidays.sql"
    ),
    validateHumanizedPlanRpc(serviceClient),
    validateHumanizedMarkRpc(serviceClient),
    validateHumanizedWindowRpc(serviceClient),
  ]);

  const failures = checks.filter((check): check is SchemaFailure => check !== null);
  if (failures.length > 0) {
    throw new Error(formatSchemaFailures(failures));
  }
}

async function runCli() {
  await assertRuntimeSchemaCompatibility();
  console.log("[schema-preflight] Schema do Supabase compatível com o backend atual.");
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runCli().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "[schema-preflight] Falha desconhecida"
    );
    process.exit(1);
  });
}
