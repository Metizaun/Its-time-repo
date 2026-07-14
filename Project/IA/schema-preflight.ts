import "./load-env.js";
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const CHAT_ATTACHMENTS_BUCKET = "chat-attachments";
const AUTOMATION_MEDIA_BUCKET = "automation-media";
const CALENDAR_FOLLOWUP_MIGRATION =
  "supabase/migrations/20260615223657_add_calendar_followup_dispatch.sql";
const AGENT_FOLLOWUP_MIGRATION =
  "supabase/migrations/20260619194439_add_agent_native_followup.sql";
const EXTERNAL_EVOLUTION_CREDENTIALS_MIGRATION =
  "supabase/migrations/20260622143901_add_external_evolution_credentials.sql";
const AGENTS_TOOLS_BI_MIGRATION =
  "supabase/migrations/20260622215036_create_agents_tools_and_bi_foundation.sql";
const PRESCRIPTION_ANALYST_MIGRATION =
  "supabase/migrations/20260623210142_add_prescription_analyst_foundation.sql";
const META_WHATSAPP_FOUNDATION_MIGRATION =
  "supabase/migrations/20260526023423_add_meta_whatsapp_foundation.sql";
const GUPSHUP_FOUNDATION_MIGRATION =
  "supabase/migrations/20260707201001_add_gupshup_channel_foundation.sql";
const RB_BILLING_REFACTOR_MIGRATION =
  "supabase/migrations/20260707223000_refactor_rb_billing_automation.sql";
const CHAT_NOTIFICATIONS_AUDIO_MIGRATION =
  "supabase/migrations/20260714172130_chat_realtime_notifications_audio.sql";
const CHAT_ATTACHMENTS_FILE_SIZE_LIMIT = 104857600;
const CHAT_ATTACHMENTS_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/webm",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
];
const AUTOMATION_MEDIA_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
];

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

type StorageBucketInfo = {
  public: boolean;
  file_size_limit?: number | null;
  allowed_mime_types?: string[] | null;
};

type StorageBucketLookupClient = {
  storage: {
    getBucket: (
      id: string
    ) => Promise<{ data: StorageBucketInfo | null; error: { message: string } | null }>;
  };
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

function buildManualSchemaFailure(
  label: string,
  migration: string,
  reason: string
): SchemaFailure {
  return {
    label,
    migration,
    reason,
  };
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

async function validateAutomationFreezeRepairRpc(serviceClient: SupabaseClient<any, any, any>) {
  const { error } = await serviceClient.rpc("rpc_repair_automation_ai_freezes", {
    p_lead_id: NIL_UUID,
    p_reference: "schema_preflight",
  });

  return error
    ? buildSchemaFailure(
        "crm.rpc_repair_automation_ai_freezes",
        "supabase/migrations/20260423113000_fix_automation_progress_and_ai_echo_freeze.sql",
        error
      )
    : null;
}

async function validateCalendarFollowupClaimRpc(calendarClient: SupabaseClient<any, any, any>) {
  const { error } = await calendarClient.rpc("rpc_claim_due_followup_events", {
    p_limit: 0,
  });

  return error
    ? buildSchemaFailure(
        "calendar.rpc_claim_due_followup_events",
        CALENDAR_FOLLOWUP_MIGRATION,
        error
      )
    : null;
}

async function validateCalendarFollowupMarkSentRpc(calendarClient: SupabaseClient<any, any, any>) {
  const { error } = await calendarClient.rpc("rpc_mark_followup_sent", {
    p_event_id: NIL_UUID,
    p_sent_at: new Date().toISOString(),
    p_provider_message_id: null,
  });

  return error
    ? buildSchemaFailure(
        "calendar.rpc_mark_followup_sent",
        CALENDAR_FOLLOWUP_MIGRATION,
        error
      )
    : null;
}

async function validateCalendarFollowupMarkFailedRpc(calendarClient: SupabaseClient<any, any, any>) {
  const { error } = await calendarClient.rpc("rpc_mark_followup_failed", {
    p_event_id: NIL_UUID,
    p_error: "schema_preflight",
    p_retry: true,
  });

  return error
    ? buildSchemaFailure(
        "calendar.rpc_mark_followup_failed",
        CALENDAR_FOLLOWUP_MIGRATION,
        error
      )
    : null;
}

async function validateCalendarFollowupSkipRpc(calendarClient: SupabaseClient<any, any, any>) {
  const { error } = await calendarClient.rpc("rpc_skip_followup", {
    p_event_id: NIL_UUID,
    p_reason: "schema_preflight",
  });

  return error
    ? buildSchemaFailure(
        "calendar.rpc_skip_followup",
        CALENDAR_FOLLOWUP_MIGRATION,
        error
      )
    : null;
}

async function validateAgentFollowupClaimRpc(serviceClient: SupabaseClient<any, any, any>) {
  const { error } = await serviceClient.rpc("rpc_claim_due_agent_followups", {
    p_limit: 0,
  });

  return error
    ? buildSchemaFailure(
        "crm.rpc_claim_due_agent_followups",
        AGENT_FOLLOWUP_MIGRATION,
        error
      )
    : null;
}

async function validateAgentFollowupMarkSentRpc(serviceClient: SupabaseClient<any, any, any>) {
  const { error } = await serviceClient.rpc("rpc_mark_agent_followup_sent", {
    p_task_id: NIL_UUID,
    p_sent_at: new Date().toISOString(),
    p_provider: null,
    p_provider_message_id: null,
    p_provider_status: null,
    p_provider_payload_summary: null,
  });

  return error
    ? buildSchemaFailure(
        "crm.rpc_mark_agent_followup_sent",
        AGENT_FOLLOWUP_MIGRATION,
        error
      )
    : null;
}

async function validateAgentFollowupMarkFailedRpc(serviceClient: SupabaseClient<any, any, any>) {
  const { error } = await serviceClient.rpc("rpc_mark_agent_followup_failed", {
    p_task_id: NIL_UUID,
    p_error: "schema_preflight",
    p_retry: true,
    p_provider: null,
    p_provider_status: null,
    p_provider_error_code: null,
    p_provider_error_message: null,
    p_provider_payload_summary: null,
  });

  return error
    ? buildSchemaFailure(
        "crm.rpc_mark_agent_followup_failed",
        AGENT_FOLLOWUP_MIGRATION,
        error
      )
    : null;
}

async function validateAgentFollowupCancelRpc(serviceClient: SupabaseClient<any, any, any>) {
  const { error } = await serviceClient.rpc("rpc_cancel_agent_followup", {
    p_task_id: NIL_UUID,
    p_reason: "schema_preflight",
  });

  return error
    ? buildSchemaFailure(
        "crm.rpc_cancel_agent_followup",
        AGENT_FOLLOWUP_MIGRATION,
        error
      )
    : null;
}

async function validateBiProjectionRpc(serviceClient: SupabaseClient<any, any, any>) {
  const { error } = await serviceClient.rpc("rpc_project_bi_outbox_batch", {
    p_limit: 0,
  });

  return error
    ? buildSchemaFailure(
        "crm.rpc_project_bi_outbox_batch",
        AGENTS_TOOLS_BI_MIGRATION,
        error
      )
    : null;
}

async function validateConfigureAgentAudioRpc(agentsClient: SupabaseClient<any, any, any>) {
  const { error } = await agentsClient.rpc("configure_agent_audio", {
    p_agent_id: NIL_UUID,
    p_voice_id: "schema-preflight",
    p_selection_rate: 0.018,
    p_activate_agent: false,
  });

  if (!error) return null;
  const normalized = normalizePostgrestError(error);
  if (/Agente nao encontrado/i.test(normalized.message)) return null;
  return buildSchemaFailure(
    "agents.configure_agent_audio",
    AGENTS_TOOLS_BI_MIGRATION,
    error
  );
}

async function validateOpticsTemplate(agentsClient: SupabaseClient<any, any, any>) {
  const { data: template, error: templateError } = await agentsClient
    .from("agent_templates")
    .select("template_key, version, is_active")
    .eq("template_key", "optics-consultant")
    .eq("version", 1)
    .eq("is_active", true)
    .maybeSingle();
  if (templateError) {
    return buildSchemaFailure("agents.agent_templates optics-consultant", AGENTS_TOOLS_BI_MIGRATION, templateError);
  }
  if (!template) {
    return buildManualSchemaFailure(
      "agents.agent_templates optics-consultant",
      AGENTS_TOOLS_BI_MIGRATION,
      "Template ativo nao encontrado"
    );
  }

  const { count, error: toolsError } = await agentsClient
    .from("agent_template_tools")
    .select("tool_key", { count: "exact", head: true })
    .eq("template_key", "optics-consultant")
    .eq("template_version", 1);
  if (toolsError) {
    return buildSchemaFailure("agents.agent_template_tools optics-consultant", AGENTS_TOOLS_BI_MIGRATION, toolsError);
  }
  return count === 5
    ? null
    : buildManualSchemaFailure(
        "agents.agent_template_tools optics-consultant",
        AGENTS_TOOLS_BI_MIGRATION,
        `Esperadas 5 Tools; encontradas ${count ?? 0}`
      );
}

async function validateChatAttachmentsStorage(
  serviceClient: StorageBucketLookupClient
) {
  const migration =
    "supabase/migrations/20260611202948_create_chat_attachments_storage.sql";
  const { data, error } = await serviceClient.storage.getBucket(CHAT_ATTACHMENTS_BUCKET);

  if (error) {
    return buildManualSchemaFailure(
      "storage.bucket chat-attachments",
      migration,
      error.message
    );
  }

  if (!data) {
    return buildManualSchemaFailure(
      "storage.bucket chat-attachments",
      migration,
      "Bucket nao encontrado"
    );
  }

  if (data.public) {
    return buildManualSchemaFailure(
      "storage.bucket chat-attachments",
      migration,
      "Bucket deve ser privado"
    );
  }

  if (data.file_size_limit !== CHAT_ATTACHMENTS_FILE_SIZE_LIMIT) {
    return buildManualSchemaFailure(
      "storage.bucket chat-attachments",
      migration,
      `file_size_limit esperado ${CHAT_ATTACHMENTS_FILE_SIZE_LIMIT}, recebido ${data.file_size_limit}`
    );
  }

  const actualMimeTypes = new Set(data.allowed_mime_types ?? []);
  const missingMimeTypes = CHAT_ATTACHMENTS_ALLOWED_MIME_TYPES.filter(
    (mimeType) => !actualMimeTypes.has(mimeType)
  );

  if (missingMimeTypes.length > 0) {
    return buildManualSchemaFailure(
      "storage.bucket chat-attachments",
      migration,
      `allowed_mime_types ausentes: ${missingMimeTypes.join(", ")}`
    );
  }

  return null;
}

async function validateAutomationMediaStorage(
  serviceClient: StorageBucketLookupClient
) {
  const migration =
    "supabase/migrations/20260707103000_add_direct_automation_media_uploads.sql";
  const { data, error } = await serviceClient.storage.getBucket(AUTOMATION_MEDIA_BUCKET);

  if (error) {
    return buildManualSchemaFailure(
      "storage.bucket automation-media",
      migration,
      error.message
    );
  }

  if (!data) {
    return buildManualSchemaFailure(
      "storage.bucket automation-media",
      migration,
      "Bucket nao encontrado"
    );
  }

  if (!data.public) {
    return buildManualSchemaFailure(
      "storage.bucket automation-media",
      migration,
      "Bucket deve ser publico"
    );
  }

  if (data.file_size_limit !== CHAT_ATTACHMENTS_FILE_SIZE_LIMIT) {
    return buildManualSchemaFailure(
      "storage.bucket automation-media",
      migration,
      `file_size_limit esperado ${CHAT_ATTACHMENTS_FILE_SIZE_LIMIT}, recebido ${data.file_size_limit}`
    );
  }

  const actualMimeTypes = new Set(data.allowed_mime_types ?? []);
  const missingMimeTypes = AUTOMATION_MEDIA_ALLOWED_MIME_TYPES.filter(
    (mimeType) => !actualMimeTypes.has(mimeType)
  );

  if (missingMimeTypes.length > 0) {
    return buildManualSchemaFailure(
      "storage.bucket automation-media",
      migration,
      `allowed_mime_types ausentes: ${missingMimeTypes.join(", ")}`
    );
  }

  return null;
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

  const metaClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    db: { schema: "meta" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const gupshupClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    db: { schema: "gupshup" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const agentsClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    db: { schema: "agents" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const calendarClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    db: { schema: "calendar" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rbClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    db: { schema: "rb" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const checks = await Promise.all([
    validateChatAttachmentsStorage(serviceClient),
    validateAutomationMediaStorage(serviceClient),
    validateSelectedColumns(
      serviceClient,
      "chat_read_states",
      ["crm_user_id", "aces_id", "lead_id", "last_read_at", "updated_at"],
      "crm.chat_read_states",
      CHAT_NOTIFICATIONS_AUDIO_MIGRATION
    ),
    validateSelectedColumns(
      serviceClient,
      "notifications",
      ["id", "aces_id", "category", "title", "description", "published_at", "idempotency_key"],
      "crm.notifications",
      CHAT_NOTIFICATIONS_AUDIO_MIGRATION
    ),
    validateSelectedColumns(
      serviceClient,
      "notification_reads",
      ["notification_id", "crm_user_id", "read_at"],
      "crm.notification_reads",
      CHAT_NOTIFICATIONS_AUDIO_MIGRATION
    ),
    validateSelectedColumns(
      calendarClient,
      "events",
      [
        "id",
        "aces_id",
        "lead_id",
        "title",
        "start_time",
        "end_time",
        "status",
        "followup_1h_enabled",
        "followup_1h_status",
        "followup_1h_last_attempt_at",
        "followup_1h_sent_at",
        "followup_1h_error",
        "metadata",
        "deleted_at",
      ],
      "calendar.events (follow-up)",
      CALENDAR_FOLLOWUP_MIGRATION
    ),
    validateSelectedColumns(
      metaClient,
      "instance",
      ["instance_name", "provider", "meta_channel_id"],
      "meta.instance (provider)",
      META_WHATSAPP_FOUNDATION_MIGRATION
    ),
    validateSelectedColumns(
      gupshupClient,
      "channel",
      ["id", "aces_id", "instance_name", "app_id", "app_name", "api_key", "phone_number", "status"],
      "gupshup.channel",
      GUPSHUP_FOUNDATION_MIGRATION
    ),
    validateSelectedColumns(
      serviceClient,
      "instance",
      ["connection_mode", "remote_evolution_url", "remote_instance_name", "remote_webhook_connected_at"],
      "crm.instance (external webhook mode)",
      "supabase/migrations/20260618120000_add_external_webhook_instance_mode.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "instance_provider_credentials",
      ["instance_name", "aces_id", "evolution_api_key", "updated_at"],
      "crm.instance_provider_credentials",
      EXTERNAL_EVOLUTION_CREDENTIALS_MIGRATION
    ),
    validateSelectedColumns(
      serviceClient,
      "instance_access_memberships",
      ["id", "aces_id", "instance_name", "crm_user_id", "access_level", "is_active"],
      "crm.instance_access_memberships",
      "supabase/migrations/20260624135935_add_instance_access_memberships.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "v_lead_details",
      ["id", "aces_id", "interaction_mode", "manual_pending_state", "manual_pending_since"],
      "crm.v_lead_details manual handoff fields",
      "supabase/migrations/20260708211239_handoff_internal_chat_manual.sql"
    ),
    validateSelectedColumns(
      agentsClient,
      "ai_agents",
      [
        "id",
        "handoff_enabled",
        "handoff_prompt",
        "handoff_target_phone",
        "template_key",
        "template_version",
      ],
      "agents.ai_agents",
      AGENTS_TOOLS_BI_MIGRATION
    ),
    validateSelectedColumns(
      agentsClient,
      "ai_lead_state",
      ["agent_id", "lead_id", "manual_ai_enabled"],
      "agents.ai_lead_state.manual_ai_enabled",
      AGENTS_TOOLS_BI_MIGRATION
    ),
    validateOpticsTemplate(agentsClient),
    validateConfigureAgentAudioRpc(agentsClient),
    validateSelectedColumns(
      agentsClient,
      "ai_lead_state",
      ["agent_id", "lead_id", "pause_origin", "pause_reference", "paused_at"],
      "agents.ai_lead_state (pause metadata)",
      AGENTS_TOOLS_BI_MIGRATION
    ),
    validateSelectedColumns(
      agentsClient,
      "agent_templates",
      ["template_key", "version", "display_name", "agent_defaults", "is_active"],
      "agents.agent_templates",
      AGENTS_TOOLS_BI_MIGRATION
    ),
    validateSelectedColumns(
      agentsClient,
      "agent_tools",
      ["id", "aces_id", "agent_id", "tool_key", "is_enabled", "readiness", "config"],
      "agents.agent_tools",
      AGENTS_TOOLS_BI_MIGRATION
    ),
    validateSelectedColumns(
      agentsClient,
      "agent_tool_runs",
      ["id", "aces_id", "agent_id", "agent_tool_id", "lead_id", "status", "idempotency_key"],
      "agents.agent_tool_runs",
      AGENTS_TOOLS_BI_MIGRATION
    ),
    validateSelectedColumns(
      rbClient,
      "sync_runs",
      ["id", "aces_id", "agent_tool_id", "agent_id", "local_run_date", "status", "payload_summary"],
      "rb.sync_runs",
      "supabase/migrations/20260708180000_rb_schema_segregation.sql"
    ),
    validateSelectedColumns(
      rbClient,
      "lead_metadata",
      [
        "lead_id",
        "aces_id",
        "clie_id",
        "cpf_cnpj",
        "store_emp_id",
        "store_emp_cpf_cnpj",
        "total_amount",
        "titles_count",
        "titles",
        "next_due_date",
        "last_sync_at",
        "pix_key",
      ],
      "rb.lead_metadata",
      "supabase/migrations/20260708180000_rb_schema_segregation.sql"
    ),
    validateSelectedColumns(
      agentsClient,
      "visagism_catalog_items",
      ["id", "aces_id", "product_code", "recommendation_description", "attributes", "source_url", "is_active", "display_order"],
      "agents.visagism_catalog_items",
      "supabase/migrations/20260622233000_add_visagism_backend_foundation.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "receituarios",
      ["id", "lead_id", "aces_id", "source_attachment_id", "agent_tool_run_id", "status", "raw_extraction"],
      "crm.receituarios (prescription analyst)",
      PRESCRIPTION_ANALYST_MIGRATION
    ),
    validateSelectedColumns(
      serviceClient,
      "lens_price_rules",
      ["id", "aces_id", "agent_tool_id", "lens_category", "min_sphere", "max_sphere", "price_cents", "priority", "is_active"],
      "crm.lens_price_rules",
      PRESCRIPTION_ANALYST_MIGRATION
    ),
    validateSelectedColumns(
      serviceClient,
      "follow_up_tasks",
      [
        "id",
        "lead_id",
        "aces_id",
        "due_at",
        "completed",
        "completed_at",
        "agent_id",
        "source",
        "status",
        "idempotency_key",
        "requested_message_id",
        "requested_text",
        "message_text",
        "attempt_count",
        "last_attempt_at",
        "sent_at",
        "last_error",
        "provider",
        "provider_message_id",
        "provider_status",
        "provider_error_code",
        "provider_error_message",
        "provider_payload_summary",
        "metadata",
      ],
      "crm.follow_up_tasks (agent follow-up)",
      AGENT_FOLLOWUP_MIGRATION
    ),
    validateSelectedColumns(
      serviceClient,
      "tags",
      ["id", "name", "urgencia", "usage_description"],
      "crm.tags.usage_description",
      "supabase/migrations/20260617123000_add_ai_crm_management_v1.sql"
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
      "automation_funnels",
      ["id", "humanized_dispatch_window_start", "humanized_dispatch_window_end"],
      "crm.automation_funnels (janela de disparo humanizado)",
      "supabase/migrations/20260517120000_add_humanized_dispatch_window.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "automation_funnels",
      ["id", "daily_dispatch_enabled", "daily_dispatch_weekends_enabled", "daily_dispatch_time"],
      "crm.automation_funnels (disparo diario)",
      "supabase/migrations/20260710170000_add_daily_dispatch_weekends_control.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "automation_funnels",
      ["id", "entry_source"],
      "crm.automation_funnels.entry_source",
      RB_BILLING_REFACTOR_MIGRATION
    ),
    validateSelectedColumns(
      serviceClient,
      "automation_steps",
      ["id", "rb_message_kind", "rb_days_offset", "rb_payment_type_ids"],
      "crm.automation_steps (RB message config)",
      RB_BILLING_REFACTOR_MIGRATION
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
      "automation_executions",
      [
        "id",
        "provider",
        "provider_message_id",
        "provider_status",
        "provider_error_code",
        "provider_error_message",
        "provider_payload_summary",
      ],
      "crm.automation_executions (Meta provider status)",
      META_WHATSAPP_FOUNDATION_MIGRATION
    ),
    validateSelectedColumns(
      serviceClient,
      "message_history",
      [
        "id",
        "provider",
        "provider_message_id",
        "provider_status",
        "provider_error_code",
        "provider_error_message",
        "provider_payload_summary",
      ],
      "crm.message_history (Meta provider status)",
      META_WHATSAPP_FOUNDATION_MIGRATION
    ),
    validateSelectedColumns(
      serviceClient,
      "automation_media_assets",
      [
        "id",
        "aces_id",
        "instance_name",
        "display_name",
        "source_url",
        "storage_bucket",
        "storage_path",
        "media_kind",
        "mime_type",
        "file_name",
        "file_size",
        "default_caption",
        "upload_status",
        "is_active",
        "created_at",
        "updated_at",
      ],
      "crm.automation_media_assets",
      "supabase/migrations/20260707103000_add_direct_automation_media_uploads.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "message_attachment_upload_intents",
      [
        "id",
        "message_id",
        "attachment_id",
        "aces_id",
        "lead_id",
        "kind",
        "mime_type",
        "storage_bucket",
        "storage_path",
        "file_name",
        "file_size",
        "status",
        "intent_expires_at",
        "created_at",
        "updated_at",
      ],
      "crm.message_attachment_upload_intents",
      "supabase/migrations/20260611232755_create_chat_message_attachments_backend.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "message_attachments",
      [
        "id",
        "message_id",
        "aces_id",
        "lead_id",
        "kind",
        "mime_type",
        "storage_bucket",
        "storage_path",
        "file_name",
        "file_size",
        "expires_at",
        "storage_deleted_at",
        "created_at",
        "updated_at",
      ],
      "crm.message_attachments",
      "supabase/migrations/20260611232755_create_chat_message_attachments_backend.sql"
    ),
    validateSelectedColumns(
      metaClient,
      "whatsapp_channels",
      [
        "id",
        "aces_id",
        "instance_name",
        "waba_id",
        "phone_number_id",
        "access_token_secret_ref",
        "app_secret_ref",
        "webhook_verify_token",
        "status",
        "last_template_sync_at",
      ],
      "meta.whatsapp_channels",
      META_WHATSAPP_FOUNDATION_MIGRATION
    ),
    validateSelectedColumns(
      metaClient,
      "whatsapp_templates",
      [
        "id",
        "channel_id",
        "meta_template_id",
        "name",
        "language",
        "category",
        "status",
        "components_json",
        "variables_json",
        "rejection_reason",
        "last_synced_at",
      ],
      "meta.whatsapp_templates",
      META_WHATSAPP_FOUNDATION_MIGRATION
    ),
    validateSelectedColumns(
      metaClient,
      "whatsapp_provider_status_events",
      [
        "id",
        "aces_id",
        "channel_id",
        "provider",
        "provider_message_id",
        "status",
        "event_timestamp",
        "provider_error_code",
        "provider_error_message",
        "payload_summary",
      ],
      "meta.whatsapp_provider_status_events",
      META_WHATSAPP_FOUNDATION_MIGRATION
    ),
    validateSelectedColumns(
      serviceClient,
      "automation_holidays",
      ["id", "country_code", "holiday_date", "name", "type", "source"],
      "crm.automation_holidays",
      "supabase/migrations/20260421160000_fix_automation_humanized_instance_holidays.sql"
    ),
    validateSelectedColumns(
      serviceClient,
      "outbound_echo_registry",
      ["id", "origin", "instance_name", "phone", "fingerprint", "expires_at"],
      "crm.outbound_echo_registry",
      "supabase/migrations/20260423113000_fix_automation_progress_and_ai_echo_freeze.sql"
    ),
    validateHumanizedPlanRpc(serviceClient),
    validateHumanizedMarkRpc(serviceClient),
    validateHumanizedWindowRpc(serviceClient),
    validateAutomationFreezeRepairRpc(serviceClient),
    validateCalendarFollowupClaimRpc(calendarClient),
    validateCalendarFollowupMarkSentRpc(calendarClient),
    validateCalendarFollowupMarkFailedRpc(calendarClient),
    validateCalendarFollowupSkipRpc(calendarClient),
    validateAgentFollowupClaimRpc(serviceClient),
    validateAgentFollowupMarkSentRpc(serviceClient),
    validateAgentFollowupMarkFailedRpc(serviceClient),
    validateAgentFollowupCancelRpc(serviceClient),
    validateBiProjectionRpc(serviceClient),
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
