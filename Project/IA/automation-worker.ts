import "./load-env.js";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

import { registerOutboundEcho } from "./outbound-echo-registry.js";

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
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [5, 15, 30, 60, 120].map((minutes) => minutes * 60 * 1000);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
) {
  const cleanPhone = normalizePhone(phone);
  const finalNumber = cleanPhone.length <= 11 ? `55${cleanPhone}` : cleanPhone;

  try {
    await axios.post(
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

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "crm" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let running = false;
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

  const timer = setInterval(() => {
    processDueExecutions().catch((error) => {
      console.error("[automation-worker] Erro no ciclo do worker:", error);
    });
  }, pollMs);

  processDueExecutions().catch((error) => {
    console.error("[automation-worker] Erro na execucao inicial:", error);
  });

  console.log(
    `[automation-worker] Rodando a cada ${pollMs}ms com lote maximo de ${batchSize} execucoes`
  );

  return {
    processDueExecutions,
    stop() {
      clearInterval(timer);
    },
  };
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startAutomationWorker();
}
