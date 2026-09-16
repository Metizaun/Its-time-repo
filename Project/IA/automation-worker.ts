import "./load-env.js";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

import { registerOutboundEcho } from "./outbound-echo-registry.js";
import { buildChatSendPolicy } from "./chat-send-policy.js";
import { GupshupTemplateService } from "./gupshup-template-service.js";
import { MetaTemplateService } from "./meta-template-service.js";
import {
  type SendResult,
  type WhatsAppProvider,
  type WhatsAppProviderName,
  WhatsAppProviderError,
} from "./whatsapp-provider.js";
import { createWhatsAppProviderRegistry } from "./whatsapp-provider-registry.js";
import { AutomationAiMessageService } from "./automation-ai-message-service.js";
import {
  revalidatePublicImage,
  PublicImageInspectionError,
  type PublicImageSnapshot,
} from "./integrations/public-image-inspector.js";

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
  content_mode?: "text" | "media" | null;
  media_asset_id?: string | null;
  media_kind?: "image" | "video" | "document" | null;
  media_caption?: string | null;
  media_source_url?: string | null;
  media_mime_type?: string | null;
  media_file_name?: string | null;
  gupshup_template_id?: string | null;
  gupshup_template_name?: string | null;
  gupshup_template_language?: string | null;
  gupshup_template_params?: string[] | null;
  rb_pix_key?: string | null;
  rb_total_amount?: number | null;
  rb_next_due_date?: string | null;
  rb_titles_count?: number | null;
  rb_store_emp_id?: string | null;
  rb_store_emp_cpf_cnpj?: string | null;
  collection_variables?: Record<string, string> | null;
};

type CollectionDispatchContext = {
  collection?: boolean;
  action?: "continue" | "cancel";
  reason?: string;
  caseId?: string;
  timezone?: string;
  context?: {
    cases?: Array<{
      totalOpenAmount?: string | number | null;
      currency?: string | null;
      openReceivablesCount?: number | null;
      oldestDueDate?: string | null;
      mostOverdueDays?: number | null;
      customer?: { name?: string | null } | null;
      creditor?: { name?: string | null; document?: string | null } | null;
      payment?: { method?: string | null; pixKey?: string | null; paymentUrl?: string | null } | null;
    }>;
  };
};

type CollectionDispatchReservation = {
  reserved?: boolean;
  collection?: boolean;
  reason?: string;
  deferUntil?: string;
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
  providerStatus: "accepted" | "sent" | "failed" | null;
  providerPayloadSummary: Record<string, unknown> | null;
};

const RB_GUPSHUP_TEMPLATE_FALLBACKS: Record<string, string> = {
  "d2687393-bd72-4d1d-a652-d3e41d1830ed":
    "Olá {{1}}, tudo bem?\n\nPassamos para lembrar que o seu pagamento vence em 2 dias. Para sua comodidade, recomendamos que se programe para efetuá-lo até a data de vencimento: {{2}}\n\nAgradecemos a sua atenção e permanecemos à disposição!\n\nAté logo 👋",
  "5bb297eb-c1f4-4e03-8e62-7f7ed5821782":
    "Olá {{1}}, tudo bem?\n\nPassamos para lembrar que o seu boleto vence hoje. Para evitar encargos por atraso, pedimos a gentileza de verificar o pagamento dentro do prazo.\n\nPara sua comodidade, o pagamento pode ser realizado através da chave pix {{2}} e nos envie o comprovante para a baixa ou em uma de nossas unidades.\n\nObrigado! 💙\n\nEquipe Óticas Dr. Óculos",
  "279e2b9e-523c-4e98-a2f0-059f71cc22a4":
    "Oi {{1}}, tudo bem? 😊\n\nSabemos que imprevistos acontecem e, por isso, estamos entrando em contato para lembrar que há em aberto a parcela com vencimento em {{2}}. \n\nPara sua comodidade, o pagamento ser realizado através da chave pix: {{3}}, e nos envie aqui o comprovante para a baixa ou em uma de nossas unidades.\n\nCaso já tenha realizado o pagamento, por favor, nos envie o comprovante para a baixa.  \n\nAguardamos seu retorno. \n\nEquipe Óticas Dr. Óculos",
  "c77f81d7-660b-488c-ba66-8312d1a69784":
    "Prezado(a) {{1}},\n\nIdentificamos boleto(s) que se encontra em aberto(s). Contamos com sua prontidão em regularizar o quanto antes.\n\nMe informe como posso auxiliar",
  "2e7440ac-6133-4a7c-9bb0-5be887839435":
    "Prezado(a) {{1}},\n\nMesmo após tentativas de renegociar o(s) débito(s) não identificamos o(s) pagamento(s) boleto(s) que se encontra em aberto(s) e reforçamos que a ausência do pagamento será passível o envio do seu cadastro aos órgãos de proteção ao crédito e protesto.\n\nParcelas em aberto:\n\nVencimento: {{1}} Valor: {{2}}\n\nMe informe como posso auxiliar\n\nEquipe Óticas Dr. Óculos agradece sua atenção e permanecemos à disposição",
  "2f37cb6d-ae16-4861-80c6-156b7624e9f5":
    "AVISO URGENTE\nParcelas em aberto: {{1}}\n\nMesmo após novas tentativas de renegociar o(s) débito(s) não identificamos o(s) pagamento(s) boleto(s) que se encontra em aberto(s) e informamos que a partir de agora seu cadastro será incluído aos órgãos de proteção ao crédito e protesto. \n\nVencimento {{2}} Valor {{3}}\n\nMe informe como posso auxiliar",
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
const PLACEHOLDER_PATTERN = /(\{|\[)\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*(\}|\])/g;
const UNRESOLVED_PLACEHOLDER_PATTERN = /(?:\{|\[)\s*[a-zA-Z_][a-zA-Z0-9_.]*\s*(?:\}|\])/;
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

function normalizeTextForComparison(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function cleanBusinessNamePart(value: string) {
  return value
    .replace(/\p{Cc}+/gu, " ")
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

export function buildExecutionTemplateVariables(execution: ClaimedExecution) {
  const rbTotalAmount =
    execution.rb_total_amount === null || execution.rb_total_amount === undefined
      ? null
      : Number(execution.rb_total_amount);

  const firstName = (execution.lead_name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0] ?? "";
  const titleFirstName = firstName
    ? firstName.slice(0, 1).toUpperCase() + firstName.slice(1).toLowerCase()
    : "";
  const dueDate = execution.rb_next_due_date
    ? new Date(`${execution.rb_next_due_date}T00:00:00`).toLocaleDateString("pt-BR")
    : "";
  const totalAmount =
    typeof rbTotalAmount === "number" && Number.isFinite(rbTotalAmount)
      ? rbTotalAmount.toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "";

  return {
    empresa: normalizeBusinessName(execution.lead_name),
    nome: execution.lead_name ?? "",
    primeiro_nome: titleFirstName,
    name: titleFirstName,
    telefone: execution.phone ?? "",
    cidade: execution.city ?? "",
    status: execution.lead_status ?? "",
    rb_pix_key: execution.rb_pix_key ?? "",
    rb_total_amount: totalAmount,
    rb_next_due_date: dueDate,
    rb_titles_count:
      typeof execution.rb_titles_count === "number" ? String(execution.rb_titles_count) : "",
    rb_store_emp_id: execution.rb_store_emp_id ?? "",
    rb_store_emp_cpf_cnpj: execution.rb_store_emp_cpf_cnpj ?? "",
    pix: execution.rb_pix_key ?? "",
    vencimento: dueDate,
    dtvencimento: dueDate,
    vl_liquido: totalAmount,
    valor_liquido: totalAmount,
    ...(execution.collection_variables ?? {}),
  };
}

export function renderExecutionMessage(execution: ClaimedExecution) {
  if (!execution.template) {
    throw new AutomationDispatchError("Template do disparo nao encontrado", {
      kind: "permanent",
    });
  }

  const renderedMessage = renderTemplate(execution.template, buildExecutionTemplateVariables(execution));

  assertNoUnresolvedPlaceholders(renderedMessage);
  return renderedMessage;
}

function renderExecutionCaption(execution: ClaimedExecution) {
  const caption = (execution.media_caption ?? "").trim();
  if (!caption) {
    return "";
  }

  const renderedCaption = renderTemplate(caption, buildExecutionTemplateVariables(execution));

  assertNoUnresolvedPlaceholders(renderedCaption);
  return renderedCaption;
}

export function renderExecutionTemplateParameters(execution: ClaimedExecution) {
  if (!Array.isArray(execution.gupshup_template_params)) {
    return [];
  }

  const vars = buildExecutionTemplateVariables(execution) as Record<string, string>;
  const templateParamAliases: Record<string, string> = {
    nome: "name",
    primeiro_nome: "primeiro_nome",
    name: "name",
    vencimento: "vencimento",
    pix: "pix",
    dtvencimento: "vencimento",
    vl_liquido: "vl_liquido",
    valor_liquido: "vl_liquido",
    rb_total_amount: "rb_total_amount",
  };
  return execution.gupshup_template_params.map((param) => {
    const rawParam = String(param ?? "").trim();
    const normalizedParam = normalizeTemplateKey(rawParam);
    const aliasedParam = templateParamAliases[normalizedParam] ?? normalizedParam;
    if (vars[aliasedParam]) {
      const value = vars[aliasedParam];
      return aliasedParam === "vl_liquido" ? `R$ ${value}` : value;
    }

    const renderedParam = renderTemplate(rawParam, vars);
    assertNoUnresolvedPlaceholders(renderedParam);
    return renderedParam;
  });
}

function buildGupshupTemplateHistoryContent(execution: ClaimedExecution) {
  const templateRef = execution.gupshup_template_name?.trim() || execution.gupshup_template_id?.trim() || "template";
  const params = renderExecutionTemplateParameters(execution);
  return params.length > 0
    ? `[Template Gupshup enviado: ${templateRef}] Parametros: ${params.join(" | ")}`
    : `[Template Gupshup enviado: ${templateRef}]`;
}

function getLocalGupshupTemplateFallback(execution: ClaimedExecution) {
  const templateId = execution.gupshup_template_id?.trim();
  if (!templateId) {
    return null;
  }

  return RB_GUPSHUP_TEMPLATE_FALLBACKS[templateId] ?? null;
}

export function applyGupshupTemplateParameters(templateBody: string, params: string[]) {
  let paramIndex = 0;
  const rendered = templateBody.replace(/\{\{\s*\d+\s*\}\}/g, (placeholder) => {
    const value = params[paramIndex];
    paramIndex += 1;
    return value ?? placeholder;
  });

  return rendered.replace(/\s+\n/g, "\n").trim();
}

export function requiresGupshupTemplateForAutomation(
  providerName: WhatsAppProviderName,
  hasTemplate: boolean,
  lastInboundAt: string | null | undefined,
  evaluatedAt = new Date(),
) {
  if (providerName !== "gupshup" || hasTemplate) {
    return false;
  }

  return buildChatSendPolicy(providerName, lastInboundAt, evaluatedAt).mode === "template_required";
}

async function assertAutomationConversationWindow(
  crmClient: { from: (table: string) => any },
  providerName: WhatsAppProviderName,
  execution: ClaimedExecution,
) {
  const hasTemplate = Boolean(
    execution.gupshup_template_id?.trim() || execution.gupshup_template_name?.trim(),
  );
  if (providerName === "meta" && !hasTemplate) {
    throw new AutomationDispatchError("Este WhatsApp exige um template oficial aprovado", {
      kind: "permanent",
      errorCode: "META_TEMPLATE_REQUIRED",
    });
  }
  if (providerName !== "gupshup" || hasTemplate) {
    return;
  }

  const { data, error } = await crmClient
    .from("leads")
    .select("last_lead_inbound_at")
    .eq("id", execution.lead_id)
    .eq("aces_id", execution.aces_id)
    .maybeSingle();

  if (error) {
    throw new AutomationDispatchError("Nao foi possivel validar a janela de 24 h", {
      kind: "transient",
      errorCode: "GUPSHUP_WINDOW_LOOKUP_FAILED",
    });
  }

  const lead = data as { last_lead_inbound_at?: unknown } | null;
  const lastInboundAt =
    typeof lead?.last_lead_inbound_at === "string" ? lead.last_lead_inbound_at : null;
  if (requiresGupshupTemplateForAutomation(providerName, false, lastInboundAt)) {
    throw new AutomationDispatchError("Janela de 24 h encerrada", {
      kind: "permanent",
      errorCode: "GUPSHUP_WINDOW_CLOSED",
    });
  }
}

async function buildOutboundHistoryContent(
  execution: ClaimedExecution,
  providerName: WhatsAppProviderName | null | undefined,
  renderedMessage: string,
  crmClient: ReturnType<typeof createClient>
) {
  if (providerName === "meta" && execution.gupshup_template_name?.trim() && execution.instance_name) {
    const metaClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      db: { schema: "meta" },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: channel, error: channelError } = await metaClient.from("whatsapp_channels")
      .select("id").eq("instance_name", execution.instance_name).single();
    if (channelError) throw channelError;
    const { data: template, error: templateError } = await metaClient.from("whatsapp_templates")
      .select("components_json").eq("channel_id", channel.id)
      .eq("name", execution.gupshup_template_name.trim())
      .eq("language", execution.gupshup_template_language || "pt_BR").single();
    if (templateError) throw templateError;
    const components = Array.isArray(template.components_json) ? template.components_json : [];
    const body = components.find((component) => isRecord(component)
      && String(component.type ?? "").toUpperCase() === "BODY");
    const bodyText = isRecord(body) && typeof body.text === "string" ? body.text : "";
    if (bodyText) return applyGupshupTemplateParameters(bodyText, renderExecutionTemplateParameters(execution));
  }
  if (
    providerName === "gupshup" &&
    (execution.gupshup_template_id?.trim() || execution.gupshup_template_name?.trim())
  ) {
    if (!execution.instance_name) {
      return buildGupshupTemplateHistoryContent(execution);
    }

    const instanceName = execution.instance_name;
    const { data: channel, error } = await crmClient
      .from("instance")
      .select("aces_id")
      .eq("instancia", instanceName)
      .maybeSingle();
    if (error) {
      throw error;
    }

    const gupshupClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      db: { schema: "gupshup" },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: gupshupChannel, error: gupshupError } = await gupshupClient
      .from("channel")
      .select("app_id, app_name, api_key")
      .eq("instance_name", instanceName)
      .eq("aces_id", Number((channel as { aces_id?: number } | null)?.aces_id))
      .eq("status", "active")
      .maybeSingle();

    if (gupshupError) {
      throw gupshupError;
    }

    const appId = typeof gupshupChannel?.app_id === "string" ? gupshupChannel.app_id.trim() : "";
    const apiKey = typeof gupshupChannel?.api_key === "string" ? gupshupChannel.api_key.trim() : "";
    if (appId && apiKey) {
      try {
        const templateService = new GupshupTemplateService({ apiKey, appId });
        const templateId = execution.gupshup_template_id?.trim() || "";
        const templateName = execution.gupshup_template_name?.trim() || "";
        const template =
          (templateId ? await templateService.getTemplateById(templateId) : null) ??
          (await templateService.listTemplates()).find((item) => item.name === templateName) ??
          null;

        if (template?.body?.trim()) {
          return applyGupshupTemplateParameters(template.body, renderExecutionTemplateParameters(execution));
        }
      } catch (error) {
        console.warn("[automation-worker] Falha ao consultar catalogo da Gupshup para salvar historico:", {
          executionId: execution.execution_id,
          templateId: execution.gupshup_template_id ?? null,
          error: extractErrorMessage(error),
        });
      }
    }

    const localFallback = getLocalGupshupTemplateFallback(execution);
    if (localFallback) {
      return applyGupshupTemplateParameters(localFallback, renderExecutionTemplateParameters(execution));
    }

    return buildGupshupTemplateHistoryContent(execution);
  }

  return renderedMessage;
}

function buildMediaHistoryContent(execution: ClaimedExecution, caption: string) {
  if (caption.trim()) {
    return caption.trim();
  }

  const fileName = execution.media_file_name?.trim() || "arquivo";
  return `[Midia enviada: ${fileName}]`;
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

  if (typeof error === "object" && error !== null && "kind" in error) {
    const candidate = error as { kind?: unknown; errorCode?: unknown; message?: unknown };
    if (candidate.kind === "transient" || candidate.kind === "permanent") {
      return new AutomationDispatchError(
        typeof candidate.message === "string" ? candidate.message : "Falha na automacao",
        {
          kind: candidate.kind,
          errorCode: typeof candidate.errorCode === "string" ? candidate.errorCode : null,
        },
      );
    }
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
  provider: WhatsAppProvider,
  providerName: WhatsAppProviderName,
  execution: ClaimedExecution,
  message: string
): Promise<WhatsAppSendResult> {
  if (!execution.instance_name || !execution.phone) {
    throw new AutomationDispatchError("Instancia ou telefone ausente para envio de texto", {
      kind: "permanent",
    });
  }

  try {
    const templateName = providerName === "meta"
      ? execution.gupshup_template_name
      : execution.gupshup_template_id || execution.gupshup_template_name;
    const response =
      (providerName === "gupshup" || providerName === "meta") &&
      templateName
        ? await provider.sendTemplate({
            instanceName: execution.instance_name,
            to: execution.phone,
            templateId: execution.gupshup_template_id ?? undefined,
            templateName: templateName || "",
            languageCode: execution.gupshup_template_language || "pt_BR",
            bodyParameters: renderExecutionTemplateParameters(execution),
            sourceType: "automation",
          })
        : await provider.sendText({
            instanceName: execution.instance_name,
            to: execution.phone,
            text: message,
            sourceType: "automation",
          });

    return {
      providerMessageId: response.providerMessageId,
      providerStatus: response.providerStatus ?? null,
      providerPayloadSummary: summarizeProviderPayload(response.raw),
    };
  } catch (error) {
    const statusCode = error instanceof WhatsAppProviderError ? error.statusCode : null;
    const errorCode = error instanceof WhatsAppProviderError ? error.errorCode : null;
    const providerName = error instanceof WhatsAppProviderError ? error.provider : "evolution";
    const payload = error instanceof WhatsAppProviderError ? error.payloadSummary : error;
    const payloadMessage = extractExternalErrorMessage(payload);
    const messagePrefix = `Falha ao enviar mensagem no provider ${providerName}`;

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

async function sendRawWhatsAppText(
  provider: WhatsAppProvider,
  instanceName: string,
  phone: string,
  message: string
): Promise<WhatsAppSendResult> {
  try {
    const response = await provider.sendText({
      instanceName,
      to: phone,
      text: message,
      sourceType: "automation",
    });

    return {
      providerMessageId: response.providerMessageId,
      providerStatus: response.providerStatus ?? null,
      providerPayloadSummary: summarizeProviderPayload(response.raw),
    };
  } catch (error) {
    const statusCode = error instanceof WhatsAppProviderError ? error.statusCode : null;
    const errorCode = error instanceof WhatsAppProviderError ? error.errorCode : null;
    const providerName = error instanceof WhatsAppProviderError ? error.provider : "evolution";
    const payload = error instanceof WhatsAppProviderError ? error.payloadSummary : error;
    const payloadMessage = extractExternalErrorMessage(payload);
    const messagePrefix = `Falha ao enviar mensagem no provider ${providerName}`;

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

async function sendWhatsAppMedia(
  provider: WhatsAppProvider,
  providerName: WhatsAppProviderName,
  execution: ClaimedExecution,
  caption: string
): Promise<WhatsAppSendResult> {
  if (!execution.instance_name || !execution.phone) {
    throw new AutomationDispatchError("Instancia ou telefone ausente para envio de midia", {
      kind: "permanent",
    });
  }

  if (!execution.media_source_url || !execution.media_kind) {
    throw new AutomationDispatchError("Midia da automacao incompleta", {
      kind: "permanent",
    });
  }

  try {
    const templateName = providerName === "meta"
      ? execution.gupshup_template_name
      : execution.gupshup_template_id || execution.gupshup_template_name;
    const response = (providerName === "meta" || providerName === "gupshup") && templateName
      ? await provider.sendTemplate({
          instanceName: execution.instance_name,
          to: execution.phone,
          templateId: execution.gupshup_template_id ?? undefined,
          templateName,
          languageCode: execution.gupshup_template_language || "pt_BR",
          bodyParameters: renderExecutionTemplateParameters(execution),
          headerMedia: { kind: "image", url: execution.media_source_url },
          sourceType: "automation",
        })
      : provider.sendMedia
        ? await provider.sendMedia({
      instanceName: execution.instance_name,
      to: execution.phone,
      mediaUrl: execution.media_source_url,
      mimeType:
        execution.media_mime_type ??
        (execution.media_kind === "image"
          ? "image/jpeg"
          : execution.media_kind === "video"
            ? "video/mp4"
            : "application/pdf"),
      fileName:
        execution.media_file_name ??
        (execution.media_kind === "image"
          ? "imagem.jpg"
          : execution.media_kind === "video"
            ? "video.mp4"
            : "documento.pdf"),
      kind: execution.media_kind,
      caption: caption || null,
      templateName:
        providerName === "gupshup"
          ? execution.gupshup_template_id || execution.gupshup_template_name || null
          : null,
      languageCode: providerName === "gupshup" ? execution.gupshup_template_language || "pt_BR" : null,
      templateParameters:
        providerName === "gupshup" ? renderExecutionTemplateParameters(execution) : [],
      sourceType: "automation",
    })
        : (() => { throw new AutomationDispatchError(`Provider ${providerName} sem suporte a midia`, { kind: "permanent" }); })();

    return {
      providerMessageId: response.providerMessageId,
      providerStatus: response.providerStatus ?? null,
      providerPayloadSummary: summarizeProviderPayload(response.raw),
    };
  } catch (error) {
    const statusCode = error instanceof WhatsAppProviderError ? error.statusCode : null;
    const errorCode = error instanceof WhatsAppProviderError ? error.errorCode : null;
    const payload = error instanceof WhatsAppProviderError ? error.payloadSummary : error;
    const payloadMessage = extractExternalErrorMessage(payload);
    const messagePrefix = `Falha ao enviar midia no provider ${providerName}`;

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
  const forwardingIntegrityIntervalRaw = Number(
    process.env.FORWARDING_INTEGRITY_INTERVAL_MS ?? 3600000
  );
  const forwardingIntegrityIntervalMs = Number.isFinite(forwardingIntegrityIntervalRaw)
    ? Math.max(60000, forwardingIntegrityIntervalRaw)
    : 3600000;
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
  const biProjectionEnabled = process.env.BI_PROJECTION_WORKER_ENABLED === "true";
  const biProjectionBatchSizeRaw = Number(process.env.BI_PROJECTION_BATCH_SIZE ?? 100);
  const biProjectionBatchSize = Number.isFinite(biProjectionBatchSizeRaw)
    ? Math.max(1, Math.min(biProjectionBatchSizeRaw, 500))
    : 100;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "crm" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const agentsSupabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "agents" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const calendarSupabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "calendar" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const collectionsSupabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "collections" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const metaSupabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "meta" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const gupshupSupabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "gupshup" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const metaTemplates = new MetaTemplateService({
    supabaseUrl,
    supabaseServiceRoleKey: serviceRoleKey,
    providerMode: process.env.META_PROVIDER_MODE?.trim().toLowerCase() === "live" ? "live" : "mock",
    graphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v20.0",
    fixturePath: process.env.META_TEMPLATES_FIXTURE_PATH,
    resolveSecret: (secretRef) => process.env[secretRef] ?? null,
  });

  const biSupabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "bi" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const automationAiMessages = new AutomationAiMessageService(
    { crm: supabase, agents: agentsSupabase, bi: biSupabase },
    {
      openaiApiKey: process.env.OPENAI_API_KEY,
      geminiApiKey: process.env.GEMINI_API_KEY,
      openaiModel: process.env.AUTOMATION_OPENAI_MODEL,
      geminiModels: process.env.AUTOMATION_GEMINI_MODELS?.split(","),
    },
  );

  async function blockInvalidTemplate(execution: ClaimedExecution, status: string) {
    const { data: detail } = await supabase.from("automation_executions")
      .select("step_id,funnel_id").eq("id", execution.execution_id).eq("aces_id", execution.aces_id).single();
    if (detail?.step_id) await supabase.from("automation_steps").update({ is_active: false }).eq("id", detail.step_id);
    if (detail?.funnel_id) await supabase.from("automation_funnels").update({ is_active: false }).eq("id", detail.funnel_id);
    await supabase.from("notifications").upsert({
      aces_id: execution.aces_id,
      category: "notice",
      event_type: "automation_template_blocked",
      title: "Automacao pausada por template",
      description: `O template da automacao esta ${status.toLowerCase()} e precisa ser revisado.`,
      action_path: "/automacao",
      idempotency_key: `automation-template:${detail?.step_id ?? execution.execution_id}:${status}`,
    }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  }

  async function assertCurrentTemplateApproved(
    providerName: WhatsAppProviderName,
    execution: ClaimedExecution,
  ) {
    if (providerName !== "meta" && providerName !== "gupshup") return;
    const templateId = execution.gupshup_template_id?.trim() || "";
    const templateName = execution.gupshup_template_name?.trim() || "";
    if (!templateId && !templateName) return;
    let status = "UNKNOWN";
    let providerCategory: string | null = null;
    const { data: executionDetail, error: detailError } = await supabase
      .from("automation_executions").select("step_id").eq("id", execution.execution_id).eq("aces_id", execution.aces_id).single();
    if (detailError) throw detailError;
    try {
      if (providerName === "meta") {
        await metaTemplates.syncTemplatesForInstance(execution.instance_name as string);
        const { data: channel, error: channelError } = await metaSupabase
          .from("whatsapp_channels").select("id").eq("instance_name", execution.instance_name).single();
        if (channelError) throw channelError;
        const { data: template, error: templateError } = await metaSupabase
          .from("whatsapp_templates").select("status,category,requested_category")
          .eq("channel_id", channel.id).eq("name", templateName).eq("language", execution.gupshup_template_language || "pt_BR").single();
        if (templateError) throw templateError;
        status = String(template.status ?? "UNKNOWN").toUpperCase();
        providerCategory = typeof template.category === "string" ? template.category.toUpperCase() : null;
      } else {
        const { data: channel, error: channelError } = await gupshupSupabase
          .from("channel").select("app_id,api_key").eq("instance_name", execution.instance_name).eq("status", "active").single();
        if (channelError) throw channelError;
        const service = new GupshupTemplateService({ apiKey: channel.api_key, appId: channel.app_id });
        const template = (templateId ? await service.getTemplateById(templateId) : null)
          ?? (await service.listTemplates()).find((item) => item.name === templateName);
        status = String(template?.status ?? "REMOVED").toUpperCase();
        providerCategory = template?.category?.toUpperCase() ?? null;
      }
    } catch (error) {
      throw new AutomationDispatchError(`Nao foi possivel consultar o status atual do template: ${extractErrorMessage(error)}`, {
        kind: "transient",
        errorCode: "TEMPLATE_STATUS_LOOKUP_FAILED",
      });
    }
    if (executionDetail.step_id && providerCategory) {
      const { data: step, error: stepError } = await supabase.from("automation_steps")
        .select("template_requested_category,template_provider_category,template_category_acknowledged_at")
        .eq("id", executionDetail.step_id).single();
      if (stepError) throw stepError;
      if (step.template_provider_category !== providerCategory) {
        await supabase.from("automation_steps").update({
          template_provider_category: providerCategory,
          template_category_acknowledged_at: null,
          template_category_acknowledged_by: null,
        }).eq("id", executionDetail.step_id);
        step.template_category_acknowledged_at = null;
      }
      if (step.template_requested_category && step.template_requested_category !== providerCategory
        && !step.template_category_acknowledged_at) {
        await blockInvalidTemplate(execution, "RECLASSIFIED");
        throw new AutomationDispatchError("Template reclassificado sem nova confirmacao", {
          kind: "permanent",
          errorCode: "TEMPLATE_CATEGORY_CONFIRMATION_REQUIRED",
        });
      }
    }
    if (status !== "APPROVED") {
      await blockInvalidTemplate(execution, status);
      throw new AutomationDispatchError(`Template oficial ${status.toLowerCase()}`, {
        kind: "permanent",
        errorCode: "TEMPLATE_NOT_APPROVED",
      });
    }
  }

  async function reconcileForwardingIntegrity() {
    const { data, error } = await agentsSupabase.rpc(
      "reconcile_forwarding_destination_sellers",
      { p_aces_id: null },
    );
    if (error) throw error;
    const removed = Number(data ?? 0);
    if (removed > 0) {
      console.warn("[automation-worker] Vínculos inválidos de encaminhamento removidos:", { removed });
    }
  }

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
  let biProjectionRunning = false;
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

  async function saveOutboundMessage(
    execution: ClaimedExecution,
    content: string,
    sentAt: string,
    sendResult?: WhatsAppSendResult | null,
    providerName?: WhatsAppProviderName | null
  ) {
    const { error } = await supabase.from("message_history").insert({
      lead_id: execution.lead_id,
      aces_id: execution.aces_id,
      content,
      direction: "outbound",
      source_type: "automation",
      conversation_id: `automation:${execution.execution_id}`,
      instance: execution.instance_name,
      sent_at: sentAt,
      provider: providerName ?? null,
      provider_message_id: sendResult?.providerMessageId ?? null,
      provider_status: sendResult?.providerStatus ?? null,
      provider_payload_summary: sendResult?.providerPayloadSummary ?? null,
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
    sendResult: WhatsAppSendResult,
    providerName: WhatsAppProviderName
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
      provider: providerName,
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

    const { error } = await agentsSupabase.from("ai_lead_state").upsert(
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

    const providerName = await whatsAppProviders.resolveInstanceProvider(
      followup.aces_id,
      followup.instance_name
    );
    const provider = whatsAppProviders.getProvider(providerName);

    if (
      requiresGupshupTemplateForAutomation(
        providerName,
        false,
        followup.last_lead_inbound_at,
      )
    ) {
      throw new AutomationDispatchError("Janela de 24 h encerrada", {
        kind: "permanent",
        errorCode: "GUPSHUP_WINDOW_CLOSED",
      });
    }

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
        bodyParameters: [renderedMessage],
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

  async function cancelExecution(executionId: string, reason: string) {
    const { error } = await supabase.from("automation_executions").update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      completed_reason: reason,
      last_error: reason,
      claimed_by: null,
      updated_at: new Date().toISOString(),
    }).eq("id", executionId).eq("status", "processing");
    if (error) throw error;
  }

  function formatCollectionMoney(value: string | number | null | undefined) {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? amount.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "";
  }

  function formatCollectionDate(value: string | null | undefined) {
    if (!value) return "";
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
  }

  async function prepareCollectionExecution(execution: ClaimedExecution) {
    const { data, error } = await collectionsSupabase.rpc("get_execution_dispatch_context", {
      p_execution_id: execution.execution_id,
    });
    if (error) throw error;
    const dispatchContext = (data ?? {}) as CollectionDispatchContext;
    if (!dispatchContext.collection) return { collection: false };
    if (dispatchContext.action === "cancel") {
      const reason = dispatchContext.reason || "collection_case_not_eligible";
      const { error: cancelError } = await collectionsSupabase.rpc("cancel_collection_execution", {
        p_execution_id: execution.execution_id,
        p_reason: reason,
      });
      if (cancelError) throw cancelError;
      return { collection: true, cancelled: true };
    }

    const collectionCase = dispatchContext.context?.cases?.[0];
    if (!collectionCase) {
      throw new AutomationDispatchError("Contexto canonico de cobranca indisponivel", {
        kind: "permanent",
      });
    }
    const amount = formatCollectionMoney(collectionCase.totalOpenAmount);
    const dueDate = formatCollectionDate(collectionCase.oldestDueDate);
    const variables: Record<string, string> = {
      nome: collectionCase.customer?.name ?? "",
      valor: amount ? `R$ ${amount}` : "",
      vencimento: dueDate,
      credor: collectionCase.creditor?.name ?? "",
      "collection.total_open_amount": amount,
      "collection.currency": collectionCase.currency ?? "",
      "collection.open_receivables_count": String(collectionCase.openReceivablesCount ?? 0),
      "collection.oldest_due_date": dueDate,
      "collection.most_overdue_days": String(collectionCase.mostOverdueDays ?? 0),
      "collection.creditor_name": collectionCase.creditor?.name ?? "",
      "collection.creditor_document": collectionCase.creditor?.document ?? "",
      "collection.payment_method": collectionCase.payment?.method ?? "",
      "collection.pix_key": collectionCase.payment?.pixKey ?? "",
      "collection.payment_url": collectionCase.payment?.paymentUrl ?? "",
      // Aliases temporarios para templates RB durante o corte para o contrato canonico.
      rb_pix_key: collectionCase.payment?.pixKey ?? "",
      rb_total_amount: amount,
      rb_next_due_date: dueDate,
      rb_titles_count: String(collectionCase.openReceivablesCount ?? 0),
      pix: collectionCase.payment?.pixKey ?? "",
      dtvencimento: dueDate,
      vl_liquido: amount,
      valor_liquido: amount,
    };
    execution.collection_variables = variables;
    return { collection: true, cancelled: false };
  }

  async function reserveCollectionDispatch(executionId: string) {
    const { data, error } = await collectionsSupabase.rpc("reserve_collection_dispatch", {
      p_execution_id: executionId,
    });
    if (error) throw error;
    return (data ?? {}) as CollectionDispatchReservation;
  }

  async function markCollectionDispatchSent(executionId: string, sentAt: string) {
    const { error } = await collectionsSupabase.rpc("mark_collection_dispatch_sent", {
      p_execution_id: executionId,
      p_sent_at: sentAt,
    });
    if (error) throw error;
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
            const collectionState = await prepareCollectionExecution(execution);
            if (collectionState.cancelled) {
              continue;
            }

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

            const generation = await automationAiMessages.prepare({
              executionId: execution.execution_id,
              acesId: execution.aces_id,
              leadId: execution.lead_id,
              instanceName: execution.instance_name,
            });
            if (generation.generatedText) {
              execution.template = generation.generatedText;
              execution.media_caption = generation.generatedText;
            }
            if (generation.bindings.length > 0) {
              const parameters = generation.bindings
                .map((binding, index) => {
                  const row = isRecord(binding) ? binding : {};
                  const position = Number(row.position ?? index + 1);
                  const source = typeof row.source === "string" ? row.source : "fixed";
                  const value = source === "ai"
                    ? generation.generatedText ?? ""
                    : source === "fixed"
                      ? String(row.value ?? "")
                      : generation.bindingValues[source] ?? "";
                  return { position, value };
                })
                .sort((a, b) => a.position - b.position);
              const valid = parameters.every((item, index) => item.position === index + 1 && item.value.trim());
              if (!valid || new Set(parameters.map((item) => item.position)).size !== parameters.length) {
                throw new AutomationDispatchError("Bindings do template estao incompletos", {
                  kind: "permanent",
                  errorCode: "AUTOMATION_TEMPLATE_BINDINGS_INVALID",
                });
              }
              execution.gupshup_template_params = parameters.map((item) => item.value);
            }
            if (generation.mediaSource === "webhook") {
              if (!generation.mediaSnapshot) {
                throw new AutomationDispatchError("Evento nao possui a imagem exigida pelo passo", {
                  kind: "permanent",
                  errorCode: "AUTOMATION_WEBHOOK_MEDIA_MISSING",
                });
              }
              try {
                const verified = await revalidatePublicImage(generation.mediaSnapshot as PublicImageSnapshot);
                execution.content_mode = "media";
                execution.media_kind = "image";
                execution.media_source_url = verified.finalUrl;
                execution.media_mime_type = verified.mimeType;
                execution.media_file_name = verified.fileName;
              } catch (error) {
                if (error instanceof PublicImageInspectionError) {
                  throw new AutomationDispatchError(error.message, {
                    kind: error.kind,
                    errorCode: `WEBHOOK_MEDIA_${error.code.toUpperCase()}`,
                  });
                }
                throw error;
              }
            }

            const contentMode = execution.content_mode === "media" ? "media" : "text";
            renderedMessage =
              contentMode === "media"
                ? buildMediaHistoryContent(execution, renderExecutionCaption(execution))
                : renderExecutionMessage(execution);
            const providerName = await whatsAppProviders.resolveInstanceProvider(
              execution.aces_id,
              execution.instance_name
            );
            const provider = whatsAppProviders.getProvider(providerName);
            await assertCurrentTemplateApproved(providerName, execution);
            await assertAutomationConversationWindow(supabase, providerName, execution);
            if (
              (providerName === "meta" || providerName === "gupshup")
              && (execution.gupshup_template_id?.trim() || execution.gupshup_template_name?.trim())
            ) {
              renderedMessage = await buildOutboundHistoryContent(
                execution, providerName, renderedMessage, supabase as any,
              );
            }
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

            const reservation = await reserveCollectionDispatch(execution.execution_id);
            if (reservation.collection && reservation.reserved === false) {
              const deferUntil = reservation.deferUntil;
              if (!deferUntil) {
                throw new AutomationDispatchError("Reserva diaria de cobranca sem data de adiamento", {
                  kind: "transient",
                });
              }
              await deferExecution(execution.execution_id, deferUntil, {
                ...(dispatchPlan.dispatch_meta ?? {}),
                collection_dispatch_reason: reservation.reason ?? "deferred_contact_daily_limit",
                deferred_contact_daily_limit: true,
              });
              continue;
            }

            const sendResult =
              contentMode === "media"
                ? await sendWhatsAppMedia(provider, providerName, execution, renderExecutionCaption(execution))
                : await sendWhatsAppMessage(
                    provider,
                    providerName,
                    execution,
                    renderedMessage
                  );

            const historyContent = renderedMessage;
            await registerAutomationOutboundEcho(execution, historyContent, sentAt);
            await saveOutboundMessage(execution, historyContent, sentAt, sendResult, providerName);
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
            if (reservation.collection) {
              await markCollectionDispatchSent(execution.execution_id, sentAt);
            }
          } catch (error: any) {
            const failure = classifyExecutionFailure(error);

            console.error(
              `[automation-worker] Falha ${failure.kind} ao processar execucao ${execution.execution_id}:`,
              error
            );

            try {
              if (failure.errorCode === "AUTOMATION_WEBHOOK_MEDIA_MISSING") {
                await cancelExecution(execution.execution_id, failure.message);
                continue;
              }
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
            const providerName = await whatsAppProviders.resolveInstanceProvider(
              followup.aces_id,
              followup.instance_name
            );
            const sendResult = await sendRawWhatsAppText(
              whatsAppProviders.getProvider(providerName),
              followup.instance_name,
              followup.contact_phone,
              renderedMessage
            );
            await saveCalendarFollowupMessage(followup, renderedMessage, sentAt, sendResult, providerName);

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

  async function processBiProjection() {
    if (!biProjectionEnabled || biProjectionRunning) return;
    biProjectionRunning = true;

    try {
      while (true) {
        const { data, error } = await supabase.rpc("rpc_project_bi_outbox_batch", {
          p_limit: biProjectionBatchSize,
        });
        if (error) throw error;

        const processed = Number(data ?? 0);
        if (!Number.isFinite(processed) || processed < biProjectionBatchSize) return;
      }
    } finally {
      biProjectionRunning = false;
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

  const forwardingIntegrityTimer = setInterval(() => {
    reconcileForwardingIntegrity().catch((error) => {
      console.error("[automation-worker] Erro na reconciliação de encaminhamento:", error);
    });
  }, forwardingIntegrityIntervalMs);

  const biProjectionTimer = biProjectionEnabled
    ? setInterval(() => {
        processBiProjection().catch((error) => {
          console.error("[automation-worker] Erro na projecao do BI:", error);
        });
      }, pollMs)
    : null;

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

  reconcileForwardingIntegrity().catch((error) => {
    console.error("[automation-worker] Erro na reconciliação inicial de encaminhamento:", error);
  });

  if (biProjectionEnabled) {
    processBiProjection().catch((error) => {
      console.error("[automation-worker] Erro na projecao inicial do BI:", error);
    });
  }

  console.log(
    `[automation-worker] Rodando a cada ${pollMs}ms com lote maximo de ${batchSize} execucoes; limpeza de anexos a cada ${chatAttachmentsCleanupIntervalMs}ms; integridade de encaminhamento a cada ${forwardingIntegrityIntervalMs}ms; follow-up calendario ${
      calendarFollowupEnabled
        ? `ativo com lote ${calendarFollowupBatchSize}${calendarFollowupDryRun ? " em dry-run" : ""}`
        : "desativado"
    }; follow-up agente ${
      agentFollowupEnabled
        ? `ativo com lote ${agentFollowupBatchSize}${agentFollowupDryRun ? " em dry-run" : ""}`
        : "desativado"
    }; projecao BI ${biProjectionEnabled ? `ativa com lote ${biProjectionBatchSize}` : "desativada"}`
  );

  return {
    processDueExecutions,
    processDueCalendarFollowups,
    processDueAgentFollowups,
    processBiProjection,
    cleanupExpiredChatAttachments,
    reconcileForwardingIntegrity,
    stop() {
      clearInterval(timer);
      if (calendarFollowupTimer) {
        clearInterval(calendarFollowupTimer);
      }
      if (agentFollowupTimer) {
        clearInterval(agentFollowupTimer);
      }
      clearInterval(chatCleanupTimer);
      clearInterval(forwardingIntegrityTimer);
      if (biProjectionTimer) {
        clearInterval(biProjectionTimer);
      }
    },
  };
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startAutomationWorker();
}
