import "./load-env.js";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

import { registerOutboundEcho } from "./outbound-echo-registry.js";
import { type SendResult, WhatsAppProviderError } from "./whatsapp-provider.js";
import { createWhatsAppProviderRegistry } from "./whatsapp-provider-registry.js";

type ClaimedExecution = {
  execution_id: string;
  enrollment_id?: string | null;
  lead_id: string;
  aces_id: number;
  instance_name: string | null;
  phone: string | null;
  lead_name: string | null;
  city: string | null;
  lead_status: string | null;
  template: string | null;
  step_label: string | null;
  funnel_name: string | null;
  scheduled_at: string;
  attempt_count: number;
};

type ClaimedCalendarFollowup = {
  event_id: string;
  aces_id: number;
  lead_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  all_day: boolean;
  location: string | null;
  meeting_url: string | null;
  metadata: Record<string, unknown> | null;
  lead_name: string | null;
  contact_phone: string | null;
  instance_name: string | null;
  attempt_count: number;
};

type ClaimedAgentFollowup = {
  task_id: string;
  aces_id: number;
  lead_id: string;
  agent_id: string | null;
  due_at: string;
  requested_text: string | null;
  message_text: string | null;
  attempt_count: number;
  lead_name: string | null;
  lead_phone: string | null;
  instance_name: string | null;
  agent_name: string | null;
  agent_active: boolean;
  agent_model: string | null;
  manual_ai_enabled: boolean | null;
  freeze_until: string | null;
  last_lead_inbound_at: string | null;
};

type ExpiredUploadIntent = {
  id: string;
  storage_path: string | null;
};

type ExpiredMessageAttachment = {
  id: string;
  storage_path: string | null;
};

type BrasilApiHoliday = {
  date?: string;
  name?: string;
  type?: string;
};

type HumanizedDispatchPlan = {
  action: "send_now" | "defer";
  humanized: boolean;
  dispatch_at: string;
  dispatch_meta: Record<string, unknown> | null;
};

type DispatchFailureKind = "transient" | "permanent";

type WhatsAppSendResult = {
  providerMessageId: string | null;
  providerPayloadSummary: Record<string, unknown> | null;
};

class AutomationDispatchError extends Error {
  kind: DispatchFailureKind;
  statusCode: number | null;
  errorCode: string | null;

  constructor(
    message: string,
    options: {
      kind: DispatchFailureKind;
      statusCode?: number | null;
      errorCode?: string | null;
    }
  ) {
    super(message);
    this.name = "AutomationDispatchError";
    this.kind = options.kind;
    this.statusCode = options.statusCode ?? null;
    this.errorCode = options.errorCode?.toUpperCase() ?? null;
  }
}

const HOLIDAY_COUNTRY_CODE = "BR";
const PLACEHOLDER_PATTERN = /(\{|\[)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(\}|\])/g;
const UNRESOLVED_PLACEHOLDER_PATTERN = /[\{\[]\s*[a-zA-Z_][a-zA-Z0-9_]*\s*[\}\]]/;
const TRANSIENT_HTTP_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const PERMANENT_HTTP_STATUS_CODES = new Set([400]);
const TRANSIENT_NETWORK_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"]);
const MAX_TRANSIENT_RETRIES = 5;
const CALENDAR_FOLLOWUP_MAX_TRANSIENT_RETRIES = 3;
const CALENDAR_FOLLOWUP_CONVERSATION_PREFIX = "calendar_followup";
const CALENDAR_FOLLOWUP_TIMEZONE = "America/Sao_Paulo";
const CALENDAR_FOLLOWUP_DEFAULT_TEMPLATE =
  'Ola, {nome}! Passando para lembrar do compromisso "{titulo}" hoje as {horario}.';
const AGENT_FOLLOWUP_MAX_TRANSIENT_RETRIES = 3;
const AGENT_FOLLOWUP_CONVERSATION_PREFIX = "agent_followup";
const AGENT_FOLLOWUP_DEFAULT_TEMPLATE =
  "Oi, {nome}! Como combinado, estou te chamando por aqui. Podemos continuar?";
const META_CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [5, 15, 30, 60, 120].map((minutes) => minutes * 60 * 1000);
const CHAT_ATTACHMENTS_BUCKET = "chat-attachments";
const GENERIC_NAME_PATTERNS = [
  /^clinica de estetica$/i,
  /^clinica odontologica$/i,
  /^consultorio odontologico$/i,
  /^limpeza de pele\b/i,
  /^dentista\b/i,
  /^implante\b/i,
  /^advogado\b/i,
  /^oftalmologista\b/i,
  /^centro$/i,
  /^curitiba$/i,
  /^sao paulo$/i,
  /^sao jose dos pinhais$/i,
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function normalizeTextForComparison(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cleanBusinessNamePart(value: string) {
  return value
    .replace(/[\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/^[\s.,;:|\-\u2013\u2014]+|[\s.,;:|\-\u2013\u2014]+$/gu, "")
    .trim();
}

function stripBusinessNameDetails(value: string) {
  let normalized = cleanBusinessNamePart(value);
  const commaParts = normalized.split(/\s*,\s+/).map(cleanBusinessNamePart).filter(Boolean);
  if (commaParts.length > 1) {
    normalized = commaParts[0];
  }

  const withoutTrailingParentheses = cleanBusinessNamePart(
    normalized.replace(/\s*\([^)]{3,80}\)\s*$/g, "")
  );
  if (withoutTrailingParentheses && withoutTrailingParentheses.split(/\s+/).length >= 2) {
    normalized = withoutTrailingParentheses;
  }

  return normalized.replace(/\.$/, "");
}

function isGenericBusinessNamePart(value: string) {
  const normalized = normalizeTextForComparison(value).replace(/[.,]/g, "").trim();
  if (!normalized || normalized === ".") {
    return true;
  }

  return GENERIC_NAME_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeBusinessName(rawName: string | null) {
  const text = cleanBusinessNamePart(rawName ?? "");
  if (!text || text === ".") {
    return "sua empresa";
  }

  const strongParts = text
    .split(/\s+(?:\||-|\u2013|\u2014|\u2022|\u00b7)\s+/u)
    .map(stripBusinessNameDetails)
    .filter(Boolean);
  const candidates = strongParts.length > 1 ? strongParts : [stripBusinessNameDetails(text)];
  const firstSpecificCandidate = candidates.find((candidate) => !isGenericBusinessNamePart(candidate));
  const chosenCandidate = firstSpecificCandidate || candidates[0] || text;
  const normalizedCandidate = cleanBusinessNamePart(chosenCandidate).slice(0, 80);

  return normalizedCandidate || "sua empresa";
}

function normalizeTemplateKey(key: string) {
  const normalized = normalizeTextForComparison(key.trim());

  if (normalized === "empresa" || normalized === "empresas") {
    return "empresa";
  }

  return normalized;
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(PLACEHOLDER_PATTERN, (placeholder, _open, key: string) => {
    const normalizedKey = normalizeTemplateKey(key);
    return vars[normalizedKey] ?? placeholder;
  });
}

function assertNoUnresolvedPlaceholders(message: string) {
  const unresolved = message.match(UNRESOLVED_PLACEHOLDER_PATTERN)?.[0];
  if (unresolved) {
    throw new AutomationDispatchError(`Mensagem contem variavel nao resolvida: ${unresolved}`, {
      kind: "permanent",
    });
  }
}

function renderExecutionMessage(execution: ClaimedExecution) {
  if (!execution.template) {
    throw new AutomationDispatchError("Template do disparo nao encontrado", {
      kind: "permanent",
    });
  }

  const renderedMessage = renderTemplate(execution.template, {
    empresa: normalizeBusinessName(execution.lead_name),
    nome: execution.lead_name ?? "",
    telefone: execution.phone ?? "",
    cidade: execution.city ?? "",
    status: execution.lead_status ?? "",
  });

  assertNoUnresolvedPlaceholders(renderedMessage);
  return renderedMessage;
}

function formatCalendarDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: CALENDAR_FOLLOWUP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatCalendarTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: CALENDAR_FOLLOWUP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildCalendarFollowupConversationId(eventId: string) {
  return `${CALENDAR_FOLLOWUP_CONVERSATION_PREFIX}:${eventId}`;
}

function buildAgentFollowupConversationId(taskId: string) {
  return `${AGENT_FOLLOWUP_CONVERSATION_PREFIX}:${taskId}`;
}

function renderCalendarFollowupMessage(followup: ClaimedCalendarFollowup, template: string) {
  const renderedMessage = renderTemplate(template, {
    nome: followup.lead_name ?? "",
    empresa: normalizeBusinessName(followup.lead_name),
    titulo: followup.title,
    horario: followup.all_day ? "dia inteiro" : formatCalendarTime(followup.start_time),
    data: formatCalendarDate(followup.start_time),
    local: followup.location ?? "",
    link: followup.meeting_url ?? "",
  });

  assertNoUnresolvedPlaceholders(renderedMessage);
  return renderedMessage;
}

function renderAgentFollowupMessage(followup: ClaimedAgentFollowup) {
  const template = followup.message_text?.trim() || AGENT_FOLLOWUP_DEFAULT_TEMPLATE;
  const renderedMessage = renderTemplate(template, {
    nome: followup.lead_name?.trim() || "tudo bem",
    empresa: normalizeBusinessName(followup.lead_name),
    pedido: followup.requested_text ?? "",
    horario: formatCalendarTime(followup.due_at),
    data: formatCalendarDate(followup.due_at),
  });

  assertNoUnresolvedPlaceholders(renderedMessage);
  return renderedMessage;
}

function isOutsideMetaConversationWindow(lastLeadInboundAt: string | null | undefined) {
  if (!lastLeadInboundAt) {
    return true;
  }

  const inboundAt = Date.parse(lastLeadInboundAt);
  return !Number.isFinite(inboundAt) || Date.now() - inboundAt > META_CONVERSATION_WINDOW_MS;
}

function isFutureDate(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractProviderMessageId(value: unknown, depth = 0): string | null {
  if (depth > 4 || !isRecord(value)) {
    return null;
  }

  const directKeys = ["id", "messageId", "message_id", "providerMessageId", "wamid"];
  for (const key of directKeys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  for (const key of ["key", "data", "message", "result"]) {
    const candidate = extractProviderMessageId(value[key], depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function summarizeProviderPayload(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (isRecord(value)) {
    const summary: Record<string, unknown> = {};
    for (const key of ["key", "id", "messageId", "status", "message", "instance", "data"]) {
      if (key in value) {
        summary[key] = value[key];
      }
    }

    return Object.keys(summary).length > 0 ? summary : { payload: value };
  }

  if (typeof value === "string") {
    return { payload: value.slice(0, 1000) };
  }

  try {
    return { payload: JSON.stringify(value).slice(0, 1000) };
  } catch {
    return { payload: String(value).slice(0, 1000) };
  }
}

function parseNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parseDateValue(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractExternalErrorMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const directMessage =
      (typeof record.message === "string" && record.message.trim()) ||
      (typeof record.error === "string" && record.error.trim()) ||
      (typeof record.reason === "string" && record.reason.trim()) ||
      null;

    if (directMessage) {
      return directMessage;
    }

    try {
      return JSON.stringify(record);
    } catch {
      return null;
    }
  }

  return null;
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return extractExternalErrorMessage(error) ?? "Falha no disparo automatizado";
}

function classifyTransportFailure(
  statusCode: number | null,
  errorCode: string | null,
  message: string
): DispatchFailureKind {
  const normalizedMessage = normalizeTextForComparison(message);
  const normalizedCode = errorCode?.toUpperCase() ?? null;

  if (statusCode !== null && PERMANENT_HTTP_STATUS_CODES.has(statusCode)) {
    return "permanent";
  }

  if (
    (statusCode !== null && TRANSIENT_HTTP_STATUS_CODES.has(statusCode)) ||
    (normalizedCode !== null && TRANSIENT_NETWORK_ERROR_CODES.has(normalizedCode))
  ) {
    return "transient";
  }

  if (
    normalizedMessage.includes("internal server error") ||
    normalizedMessage.includes("too many requests") ||
    normalizedMessage.includes("econnrefused") ||
    normalizedMessage.includes("econnreset") ||
    normalizedMessage.includes("etimedout") ||
    normalizedMessage.includes("gateway timeout") ||
    normalizedMessage.includes("service unavailable") ||
    normalizedMessage.includes("bad gateway")
  ) {
    return "transient";
  }

  if (
    normalizedMessage.includes("bad request") ||
    normalizedMessage.includes("payload invalido") ||
    normalizedMessage.includes("invalid payload")
  ) {
    return "permanent";
  }

  return "permanent";
}

function classifyExecutionFailure(error: unknown) {
  if (error instanceof AutomationDispatchError) {
    return error;
  }

  if (error instanceof WhatsAppProviderError) {
    return new AutomationDispatchError(error.message, {
      kind: error.kind,
      statusCode: error.statusCode,
      errorCode: error.errorCode,
    });
  }

  const message = extractErrorMessage(error);
  const normalizedMessage = normalizeTextForComparison(message);
  const kind =
    normalizedMessage.includes("internal server error") ||
    normalizedMessage.includes("too many requests") ||
    normalizedMessage.includes("econnrefused") ||
    normalizedMessage.includes("econnreset") ||
    normalizedMessage.includes("etimedout") ||
    normalizedMessage.includes("bad gateway") ||
    normalizedMessage.includes("service unavailable") ||
    normalizedMessage.includes("gateway timeout")
      ? "transient"
      : "permanent";

  return new AutomationDispatchError(message, { kind });
}

function getDispatchMetaRecord(dispatchMeta: Record<string, unknown> | null | undefined) {
  return isRecord(dispatchMeta) ? { ...dispatchMeta } : {};
}

function getRetryState(dispatchMeta: Record<string, unknown> | null | undefined, now: Date) {
  const meta = getDispatchMetaRecord(dispatchMeta);
  const retryCount = Math.max(parseNumericValue(meta.retry_count) ?? 0, 0);
  const firstRetryAt = parseDateValue(meta.first_retry_at);
  const withinWindow =
    firstRetryAt !== null && now.getTime() - firstRetryAt.getTime() <= RETRY_WINDOW_MS;
  const nextRetryCount = withinWindow ? retryCount + 1 : 1;

  return {
    retryCount: nextRetryCount,
    firstRetryAt: withinWindow && firstRetryAt ? firstRetryAt.toISOString() : now.toISOString(),
    exceeded: nextRetryCount > MAX_TRANSIENT_RETRIES,
  };
}

function computeRetryBackoffMs(retryCount: number) {
  const safeRetryCount = Math.max(retryCount, 1);
  return RETRY_DELAYS_MS[Math.min(safeRetryCount - 1, RETRY_DELAYS_MS.length - 1)];
}

function resolveRetryDispatchAt(dispatchPlan: HumanizedDispatchPlan, retryCount: number) {
  const backoffAt = Date.now() + computeRetryBackoffMs(retryCount);
  const plannedAt = Date.parse(dispatchPlan.dispatch_at);
  const targetAt =
    dispatchPlan.action === "defer" && Number.isFinite(plannedAt)
      ? Math.max(plannedAt, backoffAt)
      : backoffAt;

  return new Date(targetAt).toISOString();
}

function buildFailureDispatchMeta(
  dispatchMeta: Record<string, unknown> | null | undefined,
  kind: DispatchFailureKind,
  message: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...getDispatchMetaRecord(dispatchMeta),
    last_failure_at: new Date().toISOString(),
    last_failure_kind: kind,
    last_failure_message: message,
    ...overrides,
  };
}

async function sendWhatsAppMessage(
  evolutionApiUrl: string,
  evolutionApiKey: string,
  instanceName: string,
  phone: string,
  message: string
): Promise<WhatsAppSendResult> {
  const cleanPhone = normalizePhone(phone);
  const finalNumber = cleanPhone.length <= 11 ? `55${cleanPhone}` : cleanPhone;

  try {
    const response = await axios.post(
      `${evolutionApiUrl}/message/sendText/${instanceName}`,
      {
        number: `${finalNumber}@s.whatsapp.net`,
        text: message,
        delay: 1000,
      },
      {
        headers: { apikey: evolutionApiKey },
      }
    );

    return {
      providerMessageId: extractProviderMessageId(response.data),
      providerPayloadSummary: summarizeProviderPayload(response.data),
    };
  } catch (error) {
    const statusCode = axios.isAxiosError(error) ? error.response?.status ?? null : null;
    const errorCode =
      axios.isAxiosError(error) && typeof error.code === "string" ? error.code.toUpperCase() : null;
    const payload = axios.isAxiosError(error) ? error.response?.data ?? error.message : error;
    const payloadMessage = extractExternalErrorMessage(payload);
    const messagePrefix = "Falha ao enviar mensagem na Evolution";

    throw new AutomationDispatchError(
      payloadMessage ? `${messagePrefix}: ${payloadMessage}` : messagePrefix,
      {
        kind: classifyTransportFailure(statusCode, errorCode, payloadMessage ?? messagePrefix),
        statusCode,
        errorCode,
      }
    );
  }
}

export function startAutomationWorker() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const evolutionApiUrl = requireEnv("EVOLUTION_API_URL");
  const evolutionApiKey = requireEnv("EVOLUTION_API_KEY");
  const pollMs = Number(process.env.AUTOMATION_WORKER_POLL_MS ?? 15000);
  const batchSize = Number(process.env.AUTOMATION_WORKER_BATCH_SIZE ?? 50);
  const chatAttachmentsCleanupIntervalMs = Number(
    process.env.CHAT_ATTACHMENTS_CLEANUP_INTERVAL_MS ?? 3600000
  );
  const chatAttachmentsCleanupBatchSize = Number(
    process.env.CHAT_ATTACHMENTS_CLEANUP_BATCH_SIZE ?? 100
  );
  const calendarFollowupEnabled = process.env.CALENDAR_FOLLOWUP_ENABLED === "true";
  const calendarFollowupDryRun = process.env.CALENDAR_FOLLOWUP_DRY_RUN === "true";
  const calendarFollowupBatchSizeRaw = Number(process.env.CALENDAR_FOLLOWUP_BATCH_SIZE ?? 25);
  const calendarFollowupBatchSize = Number.isFinite(calendarFollowupBatchSizeRaw)
    ? Math.max(1, Math.min(calendarFollowupBatchSizeRaw, 100))
    : 25;
  const calendarFollowupTemplate = process.env.CALENDAR_FOLLOWUP_1H_TEMPLATE?.trim()
    ? process.env.CALENDAR_FOLLOWUP_1H_TEMPLATE
    : CALENDAR_FOLLOWUP_DEFAULT_TEMPLATE;
  const agentFollowupEnabled = process.env.AGENT_FOLLOWUP_ENABLED === "true";
  const agentFollowupDryRun = process.env.AGENT_FOLLOWUP_DRY_RUN === "true";
  const agentFollowupBatchSizeRaw = Number(process.env.AGENT_FOLLOWUP_BATCH_SIZE ?? 25);
  const agentFollowupBatchSize = Number.isFinite(agentFollowupBatchSizeRaw)
    ? Math.max(1, Math.min(agentFollowupBatchSizeRaw, 100))
    : 25;
  const agentFollowupMetaTemplateName =
    process.env.AGENT_FOLLOWUP_META_TEMPLATE_NAME?.trim() || null;
  const agentFollowupMetaTemplateLanguage =
    process.env.AGENT_FOLLOWUP_META_TEMPLATE_LANGUAGE?.trim() || "pt_BR";

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "crm" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const calendarSupabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "calendar" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const whatsAppProviders = createWhatsAppProviderRegistry({
    supabaseUrl,
    supabaseServiceRoleKey: serviceRoleKey,
    evolutionApiUrl,
    evolutionApiKey,
    metaProviderMode: process.env.META_PROVIDER_MODE,
    metaGraphApiVersion: process.env.META_GRAPH_API_VERSION,
  });

  let running = false;
  let calendarFollowupRunning = false;
  let agentFollowupRunning = false;
  let chatCleanupRunning = false;
  const holidayCacheYears = new Set<number>();
  let lastFreezeRepairAt = 0;

  function getFallbackNationalHolidays(year: number): BrasilApiHoliday[] {
    const easter = getEasterDate(year);
    const goodFriday = new Date(Date.UTC(year, easter.getUTCMonth(), easter.getUTCDate() - 2));

    return [
      { date: `${year}-01-01`, name: "Confraternizacao Universal", type: "national" },
      { date: goodFriday.toISOString().slice(0, 10), name: "Paixao de Cristo", type: "national" },
      { date: `${year}-04-21`, name: "Tiradentes", type: "national" },
      { date: `${year}-05-01`, name: "Dia do Trabalho", type: "national" },
      { date: `${year}-09-07`, name: "Independencia do Brasil", type: "national" },
      { date: `${year}-10-12`, name: "Nossa Senhora Aparecida", type: "national" },
      { date: `${year}-11-02`, name: "Finados", type: "national" },
      { date: `${year}-11-15`, name: "Proclamacao da Republica", type: "national" },
      { date: `${year}-11-20`, name: "Consciencia Negra", type: "national" },
      { date: `${year}-12-25`, name: "Natal", type: "national" },
    ];
  }

  function getEasterDate(year: number) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    return new Date(Date.UTC(year, month, day));
  }

  async function fetchNationalHolidays(year: number) {
    try {
      const response = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) {
        throw new Error("Resposta invalida da BrasilAPI");
      }

      return payload as BrasilApiHoliday[];
    } catch (error) {
      console.warn(
        `[automation-worker] Falha ao consultar BrasilAPI para feriados de ${year}; usando fallback local:`,
        error instanceof Error ? error.message : error
      );
      return getFallbackNationalHolidays(year);
    }
  }

  async function ensureNationalHolidaysCached(year: number) {
    if (holidayCacheYears.has(year)) {
      return;
    }

    const { count, error: countError } = await supabase
      .from("automation_holidays")
      .select("holiday_date", { count: "exact", head: true })
      .eq("country_code", HOLIDAY_COUNTRY_CODE)
      .eq("type", "national")
      .gte("holiday_date", `${year}-01-01`)
      .lte("holiday_date", `${year}-12-31`);

    if (countError) {
      throw countError;
    }

    if ((count ?? 0) > 0) {
      holidayCacheYears.add(year);
      return;
    }

    const holidays = await fetchNationalHolidays(year);
    const rows = holidays
      .filter((holiday) => typeof holiday.date === "string" && holiday.date.trim())
      .map((holiday) => ({
        country_code: HOLIDAY_COUNTRY_CODE,
        holiday_date: holiday.date,
        name: holiday.name || "Feriado nacional",
        type: "national",
        source: "brasilapi",
      }));

    if (rows.length === 0) {
      throw new Error(`Nenhum feriado nacional encontrado para ${year}`);
    }

    const { error: upsertError } = await supabase
      .from("automation_holidays")
      .upsert(rows, { onConflict: "country_code,holiday_date,type" });

    if (upsertError) {
      throw upsertError;
    }

    holidayCacheYears.add(year);
  }

  async function ensureHolidayCacheForDispatch() {
    const now = new Date();
    await Promise.all([
      ensureNationalHolidaysCached(now.getUTCFullYear()),
      ensureNationalHolidaysCached(now.getUTCFullYear() + 1),
    ]);
  }

  async function saveOutboundMessage(execution: ClaimedExecution, content: string, sentAt: string) {
    const { error } = await supabase.from("message_history").insert({
      lead_id: execution.lead_id,
      aces_id: execution.aces_id,
      content,
      direction: "outbound",
      source_type: "ai",
      conversation_id: `automation:${execution.execution_id}`,
      instance: execution.instance_name,
      sent_at: sentAt,
    });

    if (error) {
      throw error;
    }
  }

  async function registerAutomationOutboundEcho(execution: ClaimedExecution, content: string, sentAt: string) {
    if (!execution.instance_name || !execution.phone) {
      return;
    }

    await registerOutboundEcho({
      client: supabase as any,
      acesId: execution.aces_id,
      leadId: execution.lead_id,
      origin: "automation",
      referenceId: execution.execution_id,
      conversationId: `automation:${execution.execution_id}`,
      instanceName: execution.instance_name,
      phone: execution.phone,
      content,
      sentAt,
    });
  }

  async function calendarFollowupHistoryExists(followup: ClaimedCalendarFollowup) {
    const { data, error } = await supabase
      .from("message_history")
      .select("id")
      .eq("lead_id", followup.lead_id)
      .eq("conversation_id", buildCalendarFollowupConversationId(followup.event_id))
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return Boolean(data);
  }

  async function saveCalendarFollowupMessage(
    followup: ClaimedCalendarFollowup,
    content: string,
    sentAt: string,
    sendResult: WhatsAppSendResult
  ) {
    const { error } = await supabase.from("message_history").insert({
      lead_id: followup.lead_id,
      aces_id: followup.aces_id,
      content,
      direction: "outbound",
      source_type: "automation",
      conversation_id: buildCalendarFollowupConversationId(followup.event_id),
      instance: followup.instance_name,
      sent_at: sentAt,
      provider: "evolution",
      provider_message_id: sendResult.providerMessageId,
      provider_status: "sent",
      provider_payload_summary: sendResult.providerPayloadSummary,
    });

    if (error) {
      throw error;
    }
  }

  async function registerCalendarFollowupOutboundEcho(
    followup: ClaimedCalendarFollowup,
    content: string,
    sentAt: string
  ) {
    if (!followup.instance_name || !followup.contact_phone) {
      return;
    }

    await registerOutboundEcho({
      client: supabase as any,
      acesId: followup.aces_id,
      leadId: followup.lead_id,
      origin: "calendar_followup",
      referenceId: followup.event_id,
      conversationId: buildCalendarFollowupConversationId(followup.event_id),
      instanceName: followup.instance_name,
      phone: followup.contact_phone,
      content,
      sentAt,
    });
  }

  async function markCalendarFollowupSent(
    followup: ClaimedCalendarFollowup,
    sentAt: string,
    providerMessageId: string | null
  ) {
    const { error } = await calendarSupabase.rpc("rpc_mark_followup_sent", {
      p_event_id: followup.event_id,
      p_sent_at: sentAt,
      p_provider_message_id: providerMessageId,
    });

    if (error) {
      throw error;
    }
  }

  async function markCalendarFollowupFailed(
    followup: ClaimedCalendarFollowup,
    reason: string,
    retry: boolean
  ) {
    const { error } = await calendarSupabase.rpc("rpc_mark_followup_failed", {
      p_event_id: followup.event_id,
      p_error: reason,
      p_retry: retry,
    });

    if (error) {
      throw error;
    }
  }

  async function skipCalendarFollowup(followup: ClaimedCalendarFollowup, reason: string) {
    const { error } = await calendarSupabase.rpc("rpc_skip_followup", {
      p_event_id: followup.event_id,
      p_reason: reason,
    });

    if (error) {
      throw error;
    }
  }

  async function agentFollowupHistoryExists(followup: ClaimedAgentFollowup) {
    const { data, error } = await supabase
      .from("message_history")
      .select("id")
      .eq("lead_id", followup.lead_id)
      .eq("conversation_id", buildAgentFollowupConversationId(followup.task_id))
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return Boolean(data);
  }

  async function registerAgentFollowupOutboundEcho(
    followup: ClaimedAgentFollowup,
    content: string,
    sentAt: string
  ) {
    if (!followup.instance_name || !followup.lead_phone) {
      return;
    }

    await registerOutboundEcho({
      client: supabase as any,
      acesId: followup.aces_id,
      leadId: followup.lead_id,
      origin: "agent_followup",
      referenceId: followup.task_id,
      conversationId: buildAgentFollowupConversationId(followup.task_id),
      instanceName: followup.instance_name,
      phone: followup.lead_phone,
      content,
      sentAt,
    });
  }

  async function saveAgentFollowupMessage(
    followup: ClaimedAgentFollowup,
    content: string,
    sentAt: string,
    sendResult: SendResult
  ) {
    const { error } = await supabase.from("message_history").insert({
      lead_id: followup.lead_id,
      aces_id: followup.aces_id,
      content,
      direction: "outbound",
      source_type: "ai",
      conversation_id: buildAgentFollowupConversationId(followup.task_id),
      instance: followup.instance_name,
      sent_at: sentAt,
      provider: sendResult.provider,
      provider_message_id: sendResult.providerMessageId,
      provider_status: sendResult.providerStatus,
      provider_payload_summary: summarizeProviderPayload(sendResult.raw),
    });

    if (error) {
      throw error;
    }
  }

  async function updateAgentFollowupLeadState(followup: ClaimedAgentFollowup, sentAt: string) {
    if (!followup.agent_id) {
      return;
    }

    const { error } = await supabase.from("ai_lead_state").upsert(
      {
        agent_id: followup.agent_id,
        lead_id: followup.lead_id,
        last_ai_reply_at: sentAt,
        status: "active",
        updated_at: sentAt,
      },
      { onConflict: "agent_id,lead_id" }
    );

    if (error) {
      throw error;
    }
  }

  async function markAgentFollowupSent(
    followup: ClaimedAgentFollowup,
    sentAt: string,
    sendResult: SendResult | null
  ) {
    const { error } = await supabase.rpc("rpc_mark_agent_followup_sent", {
      p_task_id: followup.task_id,
      p_sent_at: sentAt,
      p_provider: sendResult?.provider ?? null,
      p_provider_message_id: sendResult?.providerMessageId ?? null,
      p_provider_status: sendResult?.providerStatus ?? null,
      p_provider_payload_summary: sendResult ? summarizeProviderPayload(sendResult.raw) : null,
    });

    if (error) {
      throw error;
    }
  }

  async function markAgentFollowupFailed(
    followup: ClaimedAgentFollowup,
    reason: string,
    retry: boolean,
    originalError: unknown
  ) {
    const providerError =
      originalError instanceof WhatsAppProviderError ? originalError : null;
    const { error } = await supabase.rpc("rpc_mark_agent_followup_failed", {
      p_task_id: followup.task_id,
      p_error: reason,
      p_retry: retry,
      p_provider: providerError?.provider ?? null,
      p_provider_status: providerError ? "failed" : null,
      p_provider_error_code: providerError?.errorCode ?? null,
      p_provider_error_message: providerError?.message ?? reason,
      p_provider_payload_summary: providerError
        ? summarizeProviderPayload(providerError.payloadSummary)
        : null,
    });

    if (error) {
      throw error;
    }
  }

  async function sendAgentFollowupMessage(
    followup: ClaimedAgentFollowup,
    renderedMessage: string
  ): Promise<SendResult> {
    if (!followup.agent_id) {
      throw new AutomationDispatchError("Agente do follow-up nao encontrado", {
        kind: "permanent",
      });
    }

    if (!followup.agent_active) {
      throw new AutomationDispatchError("Agente inativo para follow-up nativo", {
        kind: "permanent",
      });
    }

    if (followup.manual_ai_enabled === false) {
      throw new AutomationDispatchError("IA desligada manualmente para o lead", {
        kind: "permanent",
      });
    }

    if (isFutureDate(followup.freeze_until)) {
      throw new AutomationDispatchError("IA pausada para o lead no momento do follow-up", {
        kind: "permanent",
      });
    }

    if (!followup.instance_name) {
      throw new AutomationDispatchError("Instancia de envio nao definida para o lead", {
        kind: "permanent",
      });
    }

    if (!followup.lead_phone) {
      throw new AutomationDispatchError("Lead sem telefone para follow-up do agente", {
        kind: "permanent",
      });
    }

    const providerName = await whatsAppProviders.resolveInstanceProvider(followup.instance_name);
    const provider = whatsAppProviders.getProvider(providerName);

    if (providerName === "meta" && isOutsideMetaConversationWindow(followup.last_lead_inbound_at)) {
      if (!agentFollowupMetaTemplateName) {
        throw new AutomationDispatchError(
          "Template Meta de follow-up do agente nao configurado fora da janela de 24h",
          { kind: "permanent" }
        );
      }

      return provider.sendTemplate({
        instanceName: followup.instance_name,
        to: followup.lead_phone,
        templateName: agentFollowupMetaTemplateName,
        languageCode: agentFollowupMetaTemplateLanguage,
        parameters: [renderedMessage],
        sourceType: "ai",
      });
    }

    return provider.sendText({
      instanceName: followup.instance_name,
      to: followup.lead_phone,
      text: renderedMessage,
      sourceType: "ai",
    });
  }

  async function deferExecution(
    executionId: string,
    dispatchAt: string,
    dispatchMeta: Record<string, unknown> | null,
    options: {
      attemptCount?: number;
      lastError?: string | null;
    } = {}
  ) {
    const payload: Record<string, unknown> = {
      status: "pending",
      scheduled_at: dispatchAt,
      dispatch_meta: dispatchMeta,
      claimed_by: null,
      updated_at: new Date().toISOString(),
    };

    if (typeof options.attemptCount === "number") {
      payload.attempt_count = options.attemptCount;
    }

    if (options.lastError !== undefined) {
      payload.last_error = options.lastError;
    }

    const { error } = await supabase
      .from("automation_executions")
      .update(payload)
      .eq("id", executionId)
      .eq("status", "processing");

    if (error) {
      throw error;
    }
  }

  async function updateExecutionDispatchMeta(
    executionId: string,
    dispatchMeta: Record<string, unknown> | null
  ) {
    const { error } = await supabase
      .from("automation_executions")
      .update({
        dispatch_meta: dispatchMeta,
        updated_at: new Date().toISOString(),
      })
      .eq("id", executionId)
      .eq("status", "processing");

    if (error) {
      throw error;
    }
  }

  async function fetchExecutionDispatchMeta(executionId: string) {
    const { data, error } = await supabase
      .from("automation_executions")
      .select("dispatch_meta")
      .eq("id", executionId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return isRecord(data?.dispatch_meta) ? (data.dispatch_meta as Record<string, unknown>) : null;
  }

  async function planHumanizedDispatch(
    executionId: string,
    messageLength: number
  ): Promise<HumanizedDispatchPlan> {
    const { data, error } = await supabase.rpc("rpc_plan_humanized_dispatch", {
      p_execution_id: executionId,
      p_message_length: messageLength,
    });

    if (error) {
      throw error;
    }

    return data as HumanizedDispatchPlan;
  }

  async function markDispatchSent(executionId: string, sentAt: string) {
    const { error } = await supabase.rpc("rpc_mark_humanized_dispatch_sent", {
      p_execution_id: executionId,
      p_sent_at: sentAt,
    });

    if (error) {
      throw error;
    }
  }

  async function completeExecution(executionId: string, renderedMessage: string) {
    const { error } = await supabase.rpc("rpc_complete_automation_execution", {
      p_execution_id: executionId,
      p_rendered_message: renderedMessage,
    });

    if (error) {
      throw error;
    }
  }

  async function failExecution(executionId: string, reason: string) {
    const { error } = await supabase.rpc("rpc_fail_automation_execution", {
      p_execution_id: executionId,
      p_error: reason,
    });

    if (error) {
      throw error;
    }
  }

  async function repairAutomationAiFreezes(leadId?: string | null, reference?: string | null) {
    const { error } = await supabase.rpc("rpc_repair_automation_ai_freezes", {
      p_lead_id: leadId ?? null,
      p_reference: reference ?? null,
    });

    if (error) {
      throw error;
    }
  }

  async function removeChatAttachmentObject(storagePath: string | null) {
    if (!storagePath) {
      return true;
    }

    const { error } = await supabase.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .remove([storagePath]);

    if (error) {
      console.warn("[automation-worker] Falha ao remover objeto de anexo do chat:", {
        storagePath,
        error,
      });
      return false;
    }

    return true;
  }

  async function cleanupExpiredChatAttachments() {
    if (chatCleanupRunning) {
      return;
    }

    chatCleanupRunning = true;

    try {
      const now = new Date().toISOString();
      const { data: intentsData, error: intentsError } = await supabase
        .from("message_attachment_upload_intents")
        .select("id, storage_path")
        .eq("status", "issued")
        .lte("intent_expires_at", now)
        .limit(chatAttachmentsCleanupBatchSize);

      if (intentsError) {
        throw intentsError;
      }

      for (const intent of (intentsData ?? []) as ExpiredUploadIntent[]) {
        const removed = await removeChatAttachmentObject(intent.storage_path);
        if (!removed) {
          continue;
        }

        const { error } = await supabase
          .from("message_attachment_upload_intents")
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("id", intent.id)
          .eq("status", "issued");

        if (error) {
          console.warn("[automation-worker] Falha ao marcar intent de anexo como expirada:", {
            intentId: intent.id,
            error,
          });
        }
      }

      const { data: attachmentsData, error: attachmentsError } = await supabase
        .from("message_attachments")
        .select("id, storage_path")
        .is("storage_deleted_at", null)
        .lte("expires_at", now)
        .limit(chatAttachmentsCleanupBatchSize);

      if (attachmentsError) {
        throw attachmentsError;
      }

      for (const attachment of (attachmentsData ?? []) as ExpiredMessageAttachment[]) {
        const removed = await removeChatAttachmentObject(attachment.storage_path);
        if (!removed) {
          continue;
        }

        const { error } = await supabase
          .from("message_attachments")
          .update({ storage_deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", attachment.id)
          .is("storage_deleted_at", null);

        if (error) {
          console.warn("[automation-worker] Falha ao marcar anexo do chat como removido:", {
            attachmentId: attachment.id,
            error,
          });
        }
      }
    } finally {
      chatCleanupRunning = false;
    }
  }

  async function processDueExecutions() {
    if (running) {
      return;
    }

    running = true;

    try {
      await ensureHolidayCacheForDispatch();
      if (Date.now() - lastFreezeRepairAt > 5 * 60_000) {
        try {
          await repairAutomationAiFreezes(null, "worker_cycle");
        } catch (error) {
          console.warn("[automation-worker] Falha ao rodar reparo global de freeze:", error);
        }
        lastFreezeRepairAt = Date.now();
      }

      while (true) {
        const { data, error } = await supabase.rpc("rpc_claim_due_automation_executions_v2", {
          p_limit: batchSize,
        });

        if (error) {
          throw error;
        }

        const executions = (data as ClaimedExecution[]) || [];
        if (executions.length === 0) {
          return;
        }

        for (const execution of executions) {
          let renderedMessage: string | null = null;

          try {
            if (!execution.instance_name) {
              throw new AutomationDispatchError("Instancia de envio nao definida", {
                kind: "permanent",
              });
            }

            if (!execution.phone) {
              throw new AutomationDispatchError("Lead sem telefone para disparo", {
                kind: "permanent",
              });
            }

            renderedMessage = renderExecutionMessage(execution);
            const dispatchPlan = await planHumanizedDispatch(
              execution.execution_id,
              renderedMessage.length
            );

            if (dispatchPlan.action === "defer") {
              await deferExecution(
                execution.execution_id,
                dispatchPlan.dispatch_at,
                dispatchPlan.dispatch_meta
              );
              continue;
            }

            const sentAt = new Date().toISOString();
            await registerAutomationOutboundEcho(execution, renderedMessage, sentAt);
            await sendWhatsAppMessage(
              evolutionApiUrl,
              evolutionApiKey,
              execution.instance_name,
              execution.phone,
              renderedMessage
            );
            await saveOutboundMessage(execution, renderedMessage, sentAt);
            try {
              await repairAutomationAiFreezes(
                execution.lead_id,
                `automation_execution:${execution.execution_id}`
              );
            } catch (error) {
              console.warn(
                `[automation-worker] Falha ao reparar freeze do lead ${execution.lead_id}:`,
                error
              );
            }
            await markDispatchSent(execution.execution_id, sentAt);
            await completeExecution(execution.execution_id, renderedMessage);
          } catch (error: any) {
            const failure = classifyExecutionFailure(error);

            console.error(
              `[automation-worker] Falha ${failure.kind} ao processar execucao ${execution.execution_id}:`,
              error
            );

            try {
              if (failure.kind === "transient") {
                const messageLength = renderedMessage?.length ?? execution.template?.length ?? 0;
                const dispatchPlan = await planHumanizedDispatch(execution.execution_id, messageLength);
                const retryState = getRetryState(dispatchPlan.dispatch_meta, new Date());
                const retryDispatchAt = resolveRetryDispatchAt(dispatchPlan, retryState.retryCount);
                const retryMeta = buildFailureDispatchMeta(
                  dispatchPlan.dispatch_meta,
                  "transient",
                  failure.message,
                  {
                    retry_count: retryState.retryCount,
                    first_retry_at: retryState.firstRetryAt,
                  }
                );

                if (dispatchPlan.humanized || "planned_dispatch_at" in retryMeta) {
                  retryMeta.planned_dispatch_at = retryDispatchAt;
                  retryMeta.planned_at = new Date().toISOString();
                }

                if (retryState.exceeded) {
                  const terminalMessage = `Falha transitoria recorrente apos ${MAX_TRANSIENT_RETRIES} tentativas em 24h: ${failure.message}`;
                  const terminalMeta = buildFailureDispatchMeta(
                    retryMeta,
                    "permanent",
                    terminalMessage
                  );

                  await updateExecutionDispatchMeta(execution.execution_id, terminalMeta);
                  await failExecution(execution.execution_id, terminalMessage);
                } else {
                  await deferExecution(execution.execution_id, retryDispatchAt, retryMeta, {
                    attemptCount: execution.attempt_count + 1,
                    lastError: failure.message,
                  });
                }
              } else {
                const currentDispatchMeta = await fetchExecutionDispatchMeta(execution.execution_id);
                const failureMeta = buildFailureDispatchMeta(
                  currentDispatchMeta,
                  "permanent",
                  failure.message
                );
                await updateExecutionDispatchMeta(execution.execution_id, failureMeta);
                await failExecution(execution.execution_id, failure.message);
              }
            } catch (recoveryError) {
              console.error(
                `[automation-worker] Falha adicional ao tratar execucao ${execution.execution_id}:`,
                recoveryError
              );

              try {
                await failExecution(execution.execution_id, failure.message);
              } catch (failError) {
                console.error(
                  `[automation-worker] Falha adicional ao marcar execucao ${execution.execution_id} como erro:`,
                  failError
                );
              }
            }
          }
        }
      }
    } finally {
      running = false;
    }
  }

  async function processDueCalendarFollowups() {
    if (!calendarFollowupEnabled || calendarFollowupRunning) {
      return;
    }

    calendarFollowupRunning = true;

    try {
      while (true) {
        const { data, error } = await calendarSupabase.rpc("rpc_claim_due_followup_events", {
          p_limit: calendarFollowupBatchSize,
        });

        if (error) {
          throw error;
        }

        const followups = (data as ClaimedCalendarFollowup[]) || [];
        if (followups.length === 0) {
          return;
        }

        for (const followup of followups) {
          try {
            const startsAtMs = Date.parse(followup.start_time);
            if (Number.isFinite(startsAtMs) && startsAtMs <= Date.now()) {
              await skipCalendarFollowup(followup, "Evento iniciou antes do lembrete ser enviado");
              continue;
            }

            const alreadySent = await calendarFollowupHistoryExists(followup);
            if (alreadySent) {
              await markCalendarFollowupSent(followup, new Date().toISOString(), null);
              continue;
            }

            if (!followup.instance_name) {
              throw new AutomationDispatchError("Instancia de envio nao definida para o lead", {
                kind: "permanent",
              });
            }

            if (!followup.contact_phone) {
              throw new AutomationDispatchError("Lead sem telefone para lembrete do calendario", {
                kind: "permanent",
              });
            }

            const renderedMessage = renderCalendarFollowupMessage(
              followup,
              calendarFollowupTemplate
            );

            if (calendarFollowupDryRun) {
              console.log("[automation-worker] Dry-run do follow-up de calendario:", {
                eventId: followup.event_id,
                leadId: followup.lead_id,
                instanceName: followup.instance_name,
                message: renderedMessage,
              });
              await markCalendarFollowupFailed(
                followup,
                "Dry-run: mensagem validada sem envio",
                true
              );
              continue;
            }

            const sentAt = new Date().toISOString();
            await registerCalendarFollowupOutboundEcho(followup, renderedMessage, sentAt);
            const sendResult = await sendWhatsAppMessage(
              evolutionApiUrl,
              evolutionApiKey,
              followup.instance_name,
              followup.contact_phone,
              renderedMessage
            );
            await saveCalendarFollowupMessage(followup, renderedMessage, sentAt, sendResult);

            try {
              await repairAutomationAiFreezes(
                followup.lead_id,
                `calendar_followup:${followup.event_id}`
              );
            } catch (error) {
              console.warn(
                `[automation-worker] Falha ao reparar freeze apos follow-up do evento ${followup.event_id}:`,
                error
              );
            }

            await markCalendarFollowupSent(followup, sentAt, sendResult.providerMessageId);
          } catch (error) {
            const failure = classifyExecutionFailure(error);
            const shouldRetry =
              failure.kind === "transient" &&
              followup.attempt_count < CALENDAR_FOLLOWUP_MAX_TRANSIENT_RETRIES;

            console.error(
              `[automation-worker] Falha ${failure.kind} no follow-up do evento ${followup.event_id}:`,
              error
            );

            try {
              await markCalendarFollowupFailed(followup, failure.message, shouldRetry);
            } catch (recoveryError) {
              console.error(
                `[automation-worker] Falha adicional ao marcar follow-up ${followup.event_id}:`,
                recoveryError
              );
            }
          }
        }
      }
    } finally {
      calendarFollowupRunning = false;
    }
  }

  async function processDueAgentFollowups() {
    if (!agentFollowupEnabled || agentFollowupRunning) {
      return;
    }

    agentFollowupRunning = true;

    try {
      while (true) {
        const { data, error } = await supabase.rpc("rpc_claim_due_agent_followups", {
          p_limit: agentFollowupBatchSize,
        });

        if (error) {
          throw error;
        }

        const followups = (data as ClaimedAgentFollowup[]) || [];
        if (followups.length === 0) {
          return;
        }

        for (const followup of followups) {
          try {
            const alreadySent = await agentFollowupHistoryExists(followup);
            if (alreadySent) {
              await markAgentFollowupSent(followup, new Date().toISOString(), null);
              continue;
            }

            const renderedMessage = renderAgentFollowupMessage(followup);

            if (agentFollowupDryRun) {
              console.log("[automation-worker] Dry-run do follow-up nativo do agente:", {
                taskId: followup.task_id,
                leadId: followup.lead_id,
                agentId: followup.agent_id,
                instanceName: followup.instance_name,
                message: renderedMessage,
              });
              await markAgentFollowupFailed(
                followup,
                "Dry-run: mensagem validada sem envio",
                true,
                null
              );
              continue;
            }

            const sentAt = new Date().toISOString();
            await registerAgentFollowupOutboundEcho(followup, renderedMessage, sentAt);
            const sendResult = await sendAgentFollowupMessage(followup, renderedMessage);
            await saveAgentFollowupMessage(followup, renderedMessage, sentAt, sendResult);
            await updateAgentFollowupLeadState(followup, sentAt);
            await markAgentFollowupSent(followup, sentAt, sendResult);
          } catch (error) {
            const failure = classifyExecutionFailure(error);
            const shouldRetry =
              failure.kind === "transient" &&
              followup.attempt_count < AGENT_FOLLOWUP_MAX_TRANSIENT_RETRIES;

            console.error(
              `[automation-worker] Falha ${failure.kind} no follow-up nativo ${followup.task_id}:`,
              error
            );

            try {
              await markAgentFollowupFailed(followup, failure.message, shouldRetry, error);
            } catch (recoveryError) {
              console.error(
                `[automation-worker] Falha adicional ao marcar follow-up nativo ${followup.task_id}:`,
                recoveryError
              );
            }
          }
        }
      }
    } finally {
      agentFollowupRunning = false;
    }
  }

  const timer = setInterval(() => {
    processDueExecutions().catch((error) => {
      console.error("[automation-worker] Erro no ciclo do worker:", error);
    });
  }, pollMs);

  const calendarFollowupTimer = calendarFollowupEnabled
    ? setInterval(() => {
        processDueCalendarFollowups().catch((error) => {
          console.error("[automation-worker] Erro no ciclo de follow-up do calendario:", error);
        });
      }, pollMs)
    : null;

  const agentFollowupTimer = agentFollowupEnabled
    ? setInterval(() => {
        processDueAgentFollowups().catch((error) => {
          console.error("[automation-worker] Erro no ciclo de follow-up nativo do agente:", error);
        });
      }, pollMs)
    : null;

  const chatCleanupTimer = setInterval(() => {
    cleanupExpiredChatAttachments().catch((error) => {
      console.error("[automation-worker] Erro na limpeza de anexos do chat:", error);
    });
  }, chatAttachmentsCleanupIntervalMs);

  processDueExecutions().catch((error) => {
    console.error("[automation-worker] Erro na execucao inicial:", error);
  });

  if (calendarFollowupEnabled) {
    processDueCalendarFollowups().catch((error) => {
      console.error("[automation-worker] Erro na execucao inicial do follow-up do calendario:", error);
    });
  }

  if (agentFollowupEnabled) {
    processDueAgentFollowups().catch((error) => {
      console.error("[automation-worker] Erro na execucao inicial do follow-up nativo do agente:", error);
    });
  }

  cleanupExpiredChatAttachments().catch((error) => {
    console.error("[automation-worker] Erro na limpeza inicial de anexos do chat:", error);
  });

  console.log(
    `[automation-worker] Rodando a cada ${pollMs}ms com lote maximo de ${batchSize} execucoes; limpeza de anexos a cada ${chatAttachmentsCleanupIntervalMs}ms; follow-up calendario ${
      calendarFollowupEnabled
        ? `ativo com lote ${calendarFollowupBatchSize}${calendarFollowupDryRun ? " em dry-run" : ""}`
        : "desativado"
    }; follow-up agente ${
      agentFollowupEnabled
        ? `ativo com lote ${agentFollowupBatchSize}${agentFollowupDryRun ? " em dry-run" : ""}`
        : "desativado"
    }`
  );

  return {
    processDueExecutions,
    processDueCalendarFollowups,
    processDueAgentFollowups,
    cleanupExpiredChatAttachments,
    stop() {
      clearInterval(timer);
      if (calendarFollowupTimer) {
        clearInterval(calendarFollowupTimer);
      }
      if (agentFollowupTimer) {
        clearInterval(agentFollowupTimer);
      }
      clearInterval(chatCleanupTimer);
    },
  };
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startAutomationWorker();
}
