import axios from "axios";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import OpenAI, { toFile } from "openai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { EvolutionWhatsAppProvider } from "./evolution-whatsapp-provider.js";
import {
  matchOutboundEcho,
  registerOutboundEcho,
  type OutboundEchoOrigin,
} from "./outbound-echo-registry.js";
import {
  summarizeProviderPayload,
  type SendMediaInput,
  type SendResult,
  WhatsAppProviderError,
} from "./whatsapp-provider.js";

export const DEFAULT_SYSTEM_MESSAGE = `Voce e um agente comercial via WhatsApp. Responda como humano, com linguagem natural, direta e cordial. Seja util, objetivo e claro. Nunca invente dados. Classifique o lead apenas nas etapas reais do funil fornecido.`;

export const DEFAULT_USER_MESSAGE_TEMPLATE = `Analise a conversa e retorne JSON valido seguindo o schema solicitado.`;

const CHAT_ATTACHMENTS_BUCKET = "chat-attachments";
const CHAT_ATTACHMENT_MAX_FILE_SIZE = 104857600;
const CHAT_IMAGE_RETENTION_DAYS = 7;
const CHAT_ALLOWED_MIME_TYPES = new Set([
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
]);

const DOCUMENT_MIME_TYPES = new Set([
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
]);

const AI_SUMMARY_START = "<!-- AI_ATTENDANCE_SUMMARY_START -->";
const AI_SUMMARY_END = "<!-- AI_ATTENDANCE_SUMMARY_END -->";
const AI_SUMMARY_MAX_LENGTH = 1200;
const AGENT_FOLLOWUP_TIMEZONE = "America/Sao_Paulo";
const AGENT_FOLLOWUP_MIN_CONFIDENCE = 0.75;
const AGENT_FOLLOWUP_MAX_DAYS = 30;
const AGENT_FOLLOWUP_VAGUE_DELAY_MINUTES = 15;
const AGENT_FOLLOWUP_DEFAULT_MESSAGE =
  "Oi, {nome}! Como combinado, estou te chamando por aqui. Podemos continuar?";
const AGENT_FOLLOWUP_CLARIFICATION_REPLY =
  "Claro. Qual horario voce prefere: pela manha, pela tarde ou depois das 18?";

type JsonRecord = Record<string, unknown>;

type AuthContext = {
  accessToken: string;
  authUserId: string;
  crmUserId: string;
  acesId: number;
  role: string;
  name: string | null;
};

type AgentRow = {
  id: string;
  aces_id: number;
  instance_name: string;
  name: string;
  system_prompt: string;
  provider: "gemini";
  model: string;
  is_active: boolean;
  buffer_wait_ms: number;
  human_pause_minutes: number;
  auto_apply_threshold: number;
  handoff_enabled: boolean;
  handoff_prompt: string | null;
  handoff_target_phone: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type StageRuleRow = {
  id: string;
  agent_id: string;
  stage_id: string;
  goal_description: string;
  positive_signals: string[];
  negative_signals: string[];
  example_phrases: string[];
  priority: number;
  is_terminal: boolean;
  created_at: string;
  updated_at: string;
};

type StageRow = {
  id: string;
  aces_id: number;
  name: string;
  category: string;
  position: number;
};

type TagRow = {
  id: string;
  aces_id: number;
  name: string;
  urgencia: number | null;
  usage_description: string | null;
};

type InstanceSetupStatus = "pending_qr" | "connected" | "expired" | "cancelled";
type InstanceConnectionMode = "local" | "external_webhook";
type InstanceAction = "continue_setup" | "reconnect" | "sync_status" | "disconnect" | "delete";

type InstanceRow = {
  instancia: string;
  aces_id: number;
  created_by: string | null;
  color: string | null;
  token: string | null;
  status: string | null;
  created_at?: string;
  updated_at?: string;
  setup_status?: InstanceSetupStatus | null;
  setup_started_at?: string | null;
  setup_expires_at?: string | null;
  operation_lock_until?: string | null;
  last_error?: string | null;
  connection_mode?: InstanceConnectionMode | null;
  remote_evolution_url?: string | null;
  remote_instance_name?: string | null;
  remote_webhook_connected_at?: string | null;
};

type InstanceProviderCredentialRow = {
  instance_name: string;
  aces_id: number;
  evolution_api_key: string;
};

type EvolutionTransport = {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
};

type InstanceListItem = {
  instanceName: string;
  status: "connected" | "disconnected" | "connecting" | "error";
  setupStatus: InstanceSetupStatus;
  connectionMode: InstanceConnectionMode;
  createdAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
  actions: InstanceAction[];
  color: string | null;
  leadCount: number;
};

type LeadRow = {
  id: string;
  aces_id: number;
  owner_id: string | null;
  name: string | null;
  contact_phone: string | null;
  status: string | null;
  stage_id: string | null;
  instancia: string | null;
  last_city: string | null;
  notes: string | null;
  check: string | null;
  last_message_at: string | null;
  updated_at: string | null;
};

type MessageRow = {
  id: string;
  lead_id: string;
  aces_id: number;
  content: string;
  direction: string;
  source_type: string;
  instance: string | null;
  created_by: string | null;
  sent_at: string;
  conversation_id: string | null;
  provider?: "evolution" | "meta" | null;
  provider_message_id?: string | null;
  provider_status?: string | null;
  provider_error_code?: string | null;
  provider_error_message?: string | null;
  provider_payload_summary?: unknown;
};

type LatestLeadInboundMessage = Pick<MessageRow, "id" | "content" | "sent_at">;

type ChatAttachmentKind = "image" | "audio" | "document";

type ChatAttachmentUploadUrlInput = {
  leadId: string;
  instanceName?: string | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  kind: ChatAttachmentKind;
};

type ChatAttachmentSendInput = {
  messageId: string;
  attachmentId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  kind: ChatAttachmentKind;
};

type ChatMessageAttachmentResponse = {
  id: string;
  kind: ChatAttachmentKind;
  mimeType: string;
  fileName: string;
  fileSize: number;
  downloadUrl: string | null;
  expiresAt: string | null;
  storageDeletedAt: string | null;
};

type ChatMessageResponse = {
  id: string;
  leadId: string;
  content: string;
  direction: string;
  directionCode: number;
  sentAt: string;
  leadName: string;
  senderName: string | null;
  providerStatus?: string | null;
  attachments: ChatMessageAttachmentResponse[];
};

type UploadIntentRow = {
  id: string;
  message_id: string;
  attachment_id: string;
  aces_id: number;
  lead_id: string;
  kind: ChatAttachmentKind;
  mime_type: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  status: "issued" | "consumed" | "failed" | "expired";
  intent_expires_at: string;
};

type MessageAttachmentRow = {
  id: string;
  message_id: string;
  kind: ChatAttachmentKind;
  mime_type: string;
  file_name: string | null;
  file_size: number | null;
  storage_path: string;
  expires_at: string | null;
  storage_deleted_at: string | null;
};

type AiRunRow = {
  id: string;
  created_at: string;
  confidence: number | null;
  action_taken: string;
  error: string | null;
  suggested_stage_id: string | null;
  applied_stage_id: string | null;
  output_snapshot: JsonRecord;
  input_snapshot: JsonRecord;
};

type LeadAiReason = "active" | "manual_off" | "auto_pause" | "global_inactive" | "no_agent";

type LeadAiStateRow = {
  agent_id: string;
  lead_id: string;
  freeze_until: string | null;
  pause_origin: string | null;
  pause_reference: string | null;
  paused_at: string | null;
  last_processed_message_at: string | null;
  last_inbound_at: string | null;
  last_ai_reply_at: string | null;
  last_classified_stage_id: string | null;
  last_confidence: number | null;
  status: "active" | "paused" | "error";
  manual_ai_enabled: boolean | null;
  created_at: string;
  updated_at: string;
};

type LeadAiControlState = {
  success: true;
  leadId: string;
  instanceName: string | null;
  agentId: string | null;
  available: boolean;
  enabled: boolean;
  agentIsActive: boolean;
  manualAiEnabled: boolean | null;
  pausedUntil: string | null;
  bypassingGlobalInactive: boolean;
  reason: LeadAiReason;
};

type ParsedWebhookMessage = {
  instanceName: string;
  fromMe: boolean;
  phone: string;
  content: string;
  messageId: string | null;
  conversationId: string | null;
  sentAt: string;
  pushName: string | null;
  mediaKind: "audio" | "image" | null;
  mediaMimeType: string | null;
  mediaBase64: string | null;
  mediaUrl: string | null;
  messageType: string | null;
  raw: JsonRecord;
};

export type WebhookPayload = JsonRecord;

type CreateAgentInput = {
  name: string;
  instanceName: string;
  systemPrompt?: string;
  model?: string;
  provider?: "gemini";
  bufferWaitMs?: number;
  humanPauseMinutes?: number;
  autoApplyThreshold?: number;
  isActive?: boolean;
  handoffEnabled?: boolean;
  handoffPrompt?: string;
  handoffTargetPhone?: string;
};

type UpdateAgentInput = Partial<CreateAgentInput>;

type StageRuleInput = {
  stage_id: string;
  goal_description?: string;
  positive_signals?: string[];
  negative_signals?: string[];
  example_phrases?: string[];
  priority?: number;
  is_terminal?: boolean;
};

type SendManualMessageInput = {
  leadId: string;
  content?: string;
  instanceName?: string | null;
  attachment?: ChatAttachmentSendInput | null;
};

type TestHandoffInput = {
  instanceName: string;
  targetPhone: string;
  agentName?: string;
  handoffPrompt?: string;
};

type CreateInstanceInput = {
  instanceName: string;
  connectWebhook?: boolean;
  remoteEvolutionUrl?: string | null;
  remoteApiKey?: string | null;
  remoteInstanceName?: string | null;
};

type DeleteInstanceLeadAction = "none" | "transfer" | "delete";

type DeleteInstanceOptions = {
  hardDelete?: boolean;
  leadAction?: DeleteInstanceLeadAction;
  transferToInstanceName?: string | null;
  confirmationText?: string | null;
};

type UpdateInstanceLifecycleInput = {
  status?: "connected" | "disconnected" | "connecting" | "error";
  setup_status?: InstanceSetupStatus;
  setup_started_at?: string | null;
  setup_expires_at?: string | null;
  operation_lock_until?: string | null;
  last_error?: string | null;
  token?: string | null;
};

type NativeFollowupDecision = {
  should_schedule: boolean;
  needs_clarification: boolean;
  scheduled_at: string | null;
  requested_text: string;
  message_text: string;
  confidence: number;
  reason: string;
};

type StructuredModelResponse = {
  reply_blocks: string[];
  stage_decision: {
    stage_id: string | null;
    reason: string;
  };
  tag_decisions: Array<{
    tag_id: string | null;
    should_apply: boolean;
    reason: string;
    confidence: number;
  }>;
  attendance_summary: {
    text: string;
    reason: string;
    confidence: number;
  };
  lead_verification: {
    checked: boolean;
    reason: string;
  };
  confidence: number;
  reason: string;
  should_apply_stage: boolean;
  should_pause: boolean;
  should_handoff: boolean;
  handoff_reason: string;
  native_followup: NativeFollowupDecision;
};

type ReplyModelResponse = {
  reply_blocks: string[];
};

type GeminiExecutionResult<TParsed> = {
  parsed: TParsed;
  rawText: string;
  modelName: string;
  usedFallback: boolean;
  attempt: number;
  tokensIn: number | null;
  tokensOut: number | null;
};

type HandoffExecutionResult = {
  triggered: boolean;
  targetPhone: string | null;
  reason: string;
  notification: string | null;
};

type CrmDecisionApplication = {
  appliedStageId: string | null;
  stageChanged: boolean;
  appliedTagIds: string[];
  rejectedTagIds: string[];
  summaryUpdated: boolean;
  leadCheckedAt: string | null;
  changed: boolean;
  audit: JsonRecord;
};

type NativeFollowupApplication = {
  scheduled: boolean;
  taskId: string | null;
  dueAt: string | null;
  duplicated: boolean;
  needsClarification: boolean;
  skippedReason: string | null;
  audit: JsonRecord;
};

type ServiceConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  geminiApiKey?: string;
  geminiFallbackModels?: string[];
  geminiMaxRetries?: number;
  geminiRetryBaseDelayMs?: number;
  crmAnalysisWorkerModel?: string;
  openaiApiKey?: string;
  openaiTranscriptionModel?: string;
  openaiVisionModel?: string;
  redisUrl?: string;
  evolutionApiUrl: string;
  evolutionApiKey: string;
  evolutionWebhookSecret?: string;
  webhookPublicBaseUrl?: string;
  chatCacheTtlSeconds?: number;
  chatSignedDownloadTtlSeconds?: number;
  chatAttachmentUploadIntentTtlMinutes?: number;
};

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }

    if (value === 0) {
      return false;
    }
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "sim"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "nao", "não"].includes(normalized)) {
      return false;
    }
  }

  return null;
}

function decodeBase64Payload(value: string) {
  const normalized = (value.includes(",") ? value.split(",").pop() ?? value : value).replace(/\s/g, "");
  return Buffer.from(normalized, "base64");
}

function isProbablyTextPayload(buffer: Buffer) {
  const sample = buffer.subarray(0, 64).toString("utf8").trim().toLowerCase();
  return (
    sample.startsWith("{") ||
    sample.startsWith("[") ||
    sample.startsWith("<!doctype") ||
    sample.startsWith("<html") ||
    sample.includes('"error"') ||
    sample.includes('"status"')
  );
}

function normalizePhone(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  if (clean.startsWith("55") && clean.length > 11) {
    return clean.slice(2);
  }
  return clean;
}

function normalizeLeadDisplayName(value: string | null | undefined) {
  const name = value?.trim().replace(/\s+/g, " ") ?? "";
  if (!name || name.length < 2) {
    return null;
  }

  const lower = name.toLowerCase();
  if (lower === "unknown" || lower === "desconhecido" || lower === "sem nome") {
    return null;
  }

  if (/^\+?\d{8,15}$/.test(name.replace(/\s/g, ""))) {
    return null;
  }

  return name.slice(0, 120);
}

function isFallbackLeadName(value: string | null | undefined, phone: string) {
  const current = value?.trim() ?? "";
  if (!current) {
    return true;
  }

  const normalizedPhone = normalizePhone(phone);
  return current === `Lead ${normalizedPhone}` || current === normalizedPhone || current === `Lead ${phone}`;
}

function resolveWhatsappRecipient(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new HttpError(400, "Numero de WhatsApp invalido");
  }

  const normalized = normalizePhone(digits);
  const finalNumber = normalized.length <= 11 ? `55${normalized}` : normalized;

  return {
    normalized,
    finalNumber,
    jid: `${finalNumber}@s.whatsapp.net`,
  };
}

function phoneVariants(phone: string): string[] {
  const normalized = normalizePhone(phone);
  const variants = new Set<string>([normalized]);

  if (normalized.length <= 11) {
    variants.add(`55${normalized}`);
  }

  if (normalized.startsWith("55") && normalized.length > 11) {
    variants.add(normalized.slice(2));
  }

  return Array.from(variants).filter(Boolean);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizeAsciiText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatInTimeZone(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    ...options,
  }).format(date);
}

function buildNativeTemporalContext(now = new Date()) {
  const tomorrow = addDays(now, 1);
  const nextWeek = addDays(now, 7);

  return {
    timezone: AGENT_FOLLOWUP_TIMEZONE,
    now_utc: now.toISOString(),
    now_local: formatInTimeZone(now, AGENT_FOLLOWUP_TIMEZONE, {
      dateStyle: "full",
      timeStyle: "medium",
    }),
    today_local: formatInTimeZone(now, AGENT_FOLLOWUP_TIMEZONE, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
    }),
    tomorrow_local: formatInTimeZone(tomorrow, AGENT_FOLLOWUP_TIMEZONE, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
    }),
    next_week_reference_local: formatInTimeZone(nextWeek, AGENT_FOLLOWUP_TIMEZONE, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
    }),
    vague_followup_minutes: AGENT_FOLLOWUP_VAGUE_DELAY_MINUTES,
    max_followup_days: AGENT_FOLLOWUP_MAX_DAYS,
  };
}

function leadMessageNeedsFollowupTimeClarification(value: string) {
  const text = normalizeAsciiText(value);
  const hasDateWithoutDefault =
    /\b(amanha|semana que vem|proxima semana|prox(?:ima)? semana)\b/.test(text);
  if (!hasDateWithoutDefault) {
    return false;
  }

  const hasExplicitHour =
    /\b(?:[01]?\d|2[0-3])\s*(?:h|:)\s*(?:[0-5]\d)?\b/.test(text) ||
    /\b(?:meio dia|meia noite)\b/.test(text);
  const hasClearPeriod =
    /\b(?:pela manha|de manha|manha|pela tarde|de tarde|tarde|a noite|de noite|noite|depois das|apos as|ap[oó]s as)\b/.test(
      text
    );

  return !hasExplicitHour && !hasClearPeriod;
}

function isSupabaseUniqueViolation(error: unknown) {
  return asString(asRecord(error).code) === "23505";
}

function parsePositiveInteger(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function normalizeMimeType(value: string) {
  return value.trim().toLowerCase().split(";")[0] ?? "";
}

function resolveAttachmentKind(mimeType: string): ChatAttachmentKind | null {
  const normalized = normalizeMimeType(mimeType);
  if (!CHAT_ALLOWED_MIME_TYPES.has(normalized)) {
    return null;
  }

  if (normalized.startsWith("image/")) {
    return "image";
  }

  if (normalized.startsWith("audio/")) {
    return "audio";
  }

  if (DOCUMENT_MIME_TYPES.has(normalized)) {
    return "document";
  }

  return null;
}

function sanitizeStorageFileName(value: string) {
  const sanitized = value
    .trim()
    .replace(/[\\/?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120);

  return sanitized || "attachment";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildAttachmentStoragePath(params: {
  acesId: number;
  leadId: string;
  messageId: string;
  attachmentId: string;
  fileName: string;
}) {
  return [
    String(params.acesId),
    params.leadId,
    params.messageId,
    `${params.attachmentId}-${sanitizeStorageFileName(params.fileName)}`,
  ].join("/");
}

function buildAttachmentContent(kind: ChatAttachmentKind, caption: string) {
  if (caption.trim()) {
    return caption.trim();
  }

  if (kind === "image") {
    return "[imagem enviada]";
  }

  if (kind === "audio") {
    return "[audio enviado]";
  }

  return "[documento enviado]";
}

function clampConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

function parseStructuredJson(text: string): StructuredModelResponse {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as Partial<StructuredModelResponse>;
  const attendanceSummary = asRecord(parsed.attendance_summary);
  const leadVerification = asRecord(parsed.lead_verification);
  const nativeFollowup = asRecord(parsed.native_followup);

  return {
    reply_blocks: Array.isArray(parsed.reply_blocks)
      ? parsed.reply_blocks.map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
      : [],
    stage_decision: {
      stage_id: parsed.stage_decision?.stage_id ? String(parsed.stage_decision.stage_id) : null,
      reason: parsed.stage_decision?.reason ? String(parsed.stage_decision.reason) : "",
    },
    tag_decisions: Array.isArray(parsed.tag_decisions)
      ? parsed.tag_decisions
          .map((item) => {
            const record = asRecord(item);
            return {
              tag_id: record.tag_id ? String(record.tag_id) : null,
              should_apply: Boolean(record.should_apply),
              reason: record.reason ? String(record.reason) : "",
              confidence: clampConfidence(record.confidence),
            };
          })
          .slice(0, 20)
      : [],
    attendance_summary: {
      text: attendanceSummary.text
        ? truncateText(String(attendanceSummary.text).trim(), AI_SUMMARY_MAX_LENGTH)
        : "",
      reason: attendanceSummary.reason ? String(attendanceSummary.reason) : "",
      confidence: clampConfidence(attendanceSummary.confidence),
    },
    lead_verification: {
      checked: leadVerification.checked === false ? false : true,
      reason: leadVerification.reason ? String(leadVerification.reason) : "",
    },
    confidence: clampConfidence(parsed.confidence),
    reason: parsed.reason ? String(parsed.reason) : "",
    should_apply_stage: Boolean(parsed.should_apply_stage),
    should_pause: Boolean(parsed.should_pause),
    should_handoff: Boolean(parsed.should_handoff),
    handoff_reason: parsed.handoff_reason ? String(parsed.handoff_reason) : "",
    native_followup: {
      should_schedule: Boolean(nativeFollowup.should_schedule),
      needs_clarification: Boolean(nativeFollowup.needs_clarification),
      scheduled_at: nativeFollowup.scheduled_at ? String(nativeFollowup.scheduled_at).trim() : null,
      requested_text: nativeFollowup.requested_text ? String(nativeFollowup.requested_text).trim() : "",
      message_text: nativeFollowup.message_text
        ? truncateText(String(nativeFollowup.message_text).trim(), 500)
        : "",
      confidence: clampConfidence(nativeFollowup.confidence),
      reason: nativeFollowup.reason ? String(nativeFollowup.reason) : "",
    },
  };
}

function parseReplyJson(text: string): ReplyModelResponse {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as Partial<ReplyModelResponse>;

  return {
    reply_blocks: Array.isArray(parsed.reply_blocks)
      ? parsed.reply_blocks.map((item) => String(item).trim()).filter(Boolean).slice(0, 3)
      : [],
  };
}

function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function buildAiSummaryBlock(summary: string, checkedAt: string) {
  return [
    AI_SUMMARY_START,
    `Resumo IA (${checkedAt}):`,
    summary.trim(),
    AI_SUMMARY_END,
  ].join("\n");
}

function upsertAiSummaryBlock(existingNotes: string | null, summary: string, checkedAt: string) {
  const trimmedSummary = truncateText(summary.trim(), AI_SUMMARY_MAX_LENGTH);
  if (!trimmedSummary) {
    return existingNotes ?? null;
  }

  const currentNotes = existingNotes?.trimEnd() ?? "";
  const nextBlock = buildAiSummaryBlock(trimmedSummary, checkedAt);
  const blockPattern = new RegExp(
    `${AI_SUMMARY_START}[\\s\\S]*?${AI_SUMMARY_END}`,
    "m"
  );

  if (blockPattern.test(currentNotes)) {
    return currentNotes.replace(blockPattern, nextBlock).trim();
  }

  return [currentNotes, nextBlock].filter(Boolean).join("\n\n").trim();
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new HttpError(400, message);
  }
  return value;
}

function extractExternalErrorMessage(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  const record = asRecord(value);
  const directMessage =
    asString(record.message) ??
    asString(record.error) ??
    asString(record.reason) ??
    asString(asRecord(record.response).message) ??
    asString(asRecord(record.response).error);

  if (directMessage) {
    return directMessage;
  }

  if (Object.keys(record).length > 0) {
    try {
      return JSON.stringify(record);
    } catch {
      return null;
    }
  }

  return null;
}

function extractSupabaseErrorMessage(value: unknown): string | null {
  const record = asRecord(value);
  const message = asString(record.message);
  const details = asString(record.details);
  const hint = asString(record.hint);
  const code = asString(record.code);

  const parts = [message, details, hint, code ? `code: ${code}` : null].filter(
    (part): part is string => Boolean(part)
  );

  if (parts.length > 0) {
    return parts.join(" | ");
  }

  return extractExternalErrorMessage(value);
}

function buildSupabaseOperationError(
  error: unknown,
  fallbackMessage: string,
  statusCode = 500
) {
  const payloadMessage = extractSupabaseErrorMessage(error);
  const message = payloadMessage ? `${fallbackMessage}: ${payloadMessage}` : fallbackMessage;
  return new HttpError(statusCode, message, error);
}

function buildExternalRequestError(error: unknown, fallbackMessage: string) {
  if (!axios.isAxiosError(error)) {
    return new HttpError(500, fallbackMessage, error);
  }

  const statusCode = error.response?.status;
  const statusText = error.response?.statusText;
  const responsePayload = error.response?.data ?? null;
  const payloadMessage = extractExternalErrorMessage(responsePayload);
  const statusMessage =
    typeof statusCode === "number"
      ? [statusCode, statusText].filter(Boolean).join(" ")
      : null;
  const message = payloadMessage
    ? `${fallbackMessage}: ${payloadMessage}`
    : statusMessage
      ? `${fallbackMessage}: ${statusMessage}`
      : fallbackMessage;
  const resolvedStatus =
    typeof statusCode === "number" && statusCode >= 400 && statusCode < 500 ? statusCode : 502;

  return new HttpError(resolvedStatus, message, responsePayload ?? error.message);
}

function summarizeWhatsAppProviderFailure(error: unknown) {
  if (error instanceof WhatsAppProviderError) {
    return {
      statusCode: error.statusCode ?? 502,
      errorCode: error.errorCode,
      errorMessage: error.message,
      payloadSummary: error.payloadSummary,
    };
  }

  return {
    statusCode: 502,
    errorCode: null,
    errorMessage: error instanceof Error ? error.message : "Falha desconhecida no provider",
    payloadSummary: summarizeProviderPayload(error),
  };
}

function isTransientGeminiError(error: unknown) {
  const message = extractExternalErrorMessage(error) ?? (error instanceof Error ? error.message : "");
  return /\b(429|500|503|504)\b/i.test(message) || /high demand|temporar|try again later|unavailable|timeout/i.test(message);
}

export class AgentManager {
  private static readonly INSTANCE_SETUP_TTL_HOURS = 24;
  private static readonly INSTANCE_OPERATION_LOCK_SECONDS = 45;
  private static readonly DEFAULT_CUSTOMER_AGENT_MODEL = "gemini-2.5-flash";
  private static readonly DEFAULT_CRM_ANALYSIS_WORKER_MODEL = "gemini-3.1-flash-lite";
  private static readonly DEFAULT_GEMINI_FALLBACK_MODELS = [
    "gemini-2.5-flash-lite",
  ];
  private static readonly DEFAULT_GEMINI_MAX_RETRIES = 3;
  private static readonly DEFAULT_GEMINI_RETRY_BASE_DELAY_MS = 1000;
  private static readonly FROM_ME_ECHO_LOOKBACK_MINUTES = 15;
  private static readonly CRM_ANALYSIS_INACTIVITY_MS = 3 * 60 * 60 * 1000;
  private static readonly DEFAULT_CHAT_CACHE_TTL_SECONDS = 60;
  private static readonly DEFAULT_CHAT_SIGNED_DOWNLOAD_TTL_SECONDS = 900;
  private static readonly DEFAULT_CHAT_UPLOAD_INTENT_TTL_MINUTES = 120;
  private static readonly CHAT_RECENT_MESSAGE_CACHE_BYPASS_MS = 10_000;

  private readonly authClient: SupabaseClient<any, any, any>;
  private readonly serviceClient: SupabaseClient<any, any, any>;
  private readonly redis: Redis | null;
  private readonly memoryBuffers = new Map<string, ParsedWebhookMessage[]>();
  private readonly memoryTimers = new Map<string, NodeJS.Timeout>();
  private readonly idleAnalysisTimers = new Map<string, NodeJS.Timeout>();
  private readonly gemini: GoogleGenerativeAI | null;
  private readonly geminiFallbackModels: string[];
  private readonly geminiMaxRetries: number;
  private readonly geminiRetryBaseDelayMs: number;
  private readonly crmAnalysisWorkerModel: string;
  private readonly openai: OpenAI | null;
  private readonly openaiTranscriptionModel: string;
  private readonly openaiVisionModel: string;
  private readonly chatCacheTtlSeconds: number;
  private readonly chatSignedDownloadTtlSeconds: number;
  private readonly chatUploadIntentTtlMinutes: number;

  constructor(private readonly config: ServiceConfig) {
    this.authClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "crm" },
    });

    this.serviceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "crm" },
    });

    this.redis = config.redisUrl ? new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
    this.gemini = config.geminiApiKey ? new GoogleGenerativeAI(config.geminiApiKey) : null;
    this.geminiFallbackModels = config.geminiFallbackModels?.filter(Boolean) ?? AgentManager.DEFAULT_GEMINI_FALLBACK_MODELS;
    this.geminiMaxRetries = Math.max(1, config.geminiMaxRetries ?? AgentManager.DEFAULT_GEMINI_MAX_RETRIES);
    this.geminiRetryBaseDelayMs = Math.max(
      250,
      config.geminiRetryBaseDelayMs ?? AgentManager.DEFAULT_GEMINI_RETRY_BASE_DELAY_MS
    );
    this.crmAnalysisWorkerModel =
      config.crmAnalysisWorkerModel?.trim() || AgentManager.DEFAULT_CRM_ANALYSIS_WORKER_MODEL;
    this.openai = config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey }) : null;
    this.openaiTranscriptionModel = config.openaiTranscriptionModel?.trim() || "gpt-4o-mini-transcribe";
    this.openaiVisionModel = config.openaiVisionModel?.trim() || "gpt-4.1-mini";
    this.chatCacheTtlSeconds = parsePositiveInteger(
      config.chatCacheTtlSeconds,
      AgentManager.DEFAULT_CHAT_CACHE_TTL_SECONDS
    );
    this.chatSignedDownloadTtlSeconds = parsePositiveInteger(
      config.chatSignedDownloadTtlSeconds,
      AgentManager.DEFAULT_CHAT_SIGNED_DOWNLOAD_TTL_SECONDS
    );
    this.chatUploadIntentTtlMinutes = parsePositiveInteger(
      config.chatAttachmentUploadIntentTtlMinutes,
      AgentManager.DEFAULT_CHAT_UPLOAD_INTENT_TTL_MINUTES
    );
  }

  async authenticate(authHeader?: string): Promise<AuthContext> {
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      throw new HttpError(401, "Token de acesso ausente");
    }

    const { data, error } = await this.authClient.auth.getUser(token);
    if (error || !data.user) {
      throw new HttpError(401, "Sessao invalida");
    }

    const { data: crmUser, error: crmError } = await this.serviceClient
      .from("users")
      .select("id, aces_id, role, name")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();

    if (crmError) {
      throw new HttpError(500, "Nao foi possivel validar o usuario CRM", crmError);
    }

    if (!crmUser) {
      throw new HttpError(403, "Usuario CRM nao encontrado");
    }

    return {
      accessToken: token,
      authUserId: data.user.id,
      crmUserId: String(crmUser.id),
      acesId: Number(crmUser.aces_id),
      role: String(crmUser.role),
      name: crmUser.name ? String(crmUser.name) : null,
    };
  }

  private ensureAdmin(context: AuthContext) {
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem gerenciar a IA");
    }
  }

  private sanitizeInstanceName(raw: string) {
    const normalized = raw.trim();
    if (!normalized) {
      throw new HttpError(400, "Nome da instancia e obrigatorio");
    }

    if (!/^[a-zA-Z0-9_-]{3,40}$/.test(normalized)) {
      throw new HttpError(
        400,
        "Nome invalido. Use apenas letras, numeros, _ e -, entre 3 e 40 caracteres."
      );
    }

    return normalized;
  }

  private normalizeInstanceConnectionMode(raw: string | null | undefined): InstanceConnectionMode {
    return raw === "external_webhook" ? "external_webhook" : "local";
  }

  private isExternalWebhookInstance(instance: Pick<InstanceRow, "connection_mode">) {
    return this.normalizeInstanceConnectionMode(instance.connection_mode) === "external_webhook";
  }

  private evolutionHeaders(apiKey = this.config.evolutionApiKey) {
    return { apikey: apiKey };
  }

  private resolveInstanceWebhookUrl() {
    const base = this.config.webhookPublicBaseUrl?.trim().replace(/\/$/, "");
    if (!base) {
      return null;
    }

    return `${base}/api/webhook/evolution`;
  }

  private async configureEvolutionWebhook(
    evolutionApiUrl: string,
    apiKey: string,
    instanceName: string
  ) {
    const webhookUrl = this.resolveInstanceWebhookUrl();
    if (!webhookUrl) {
      return { configured: false, reason: "WEBHOOK_PUBLIC_BASE_URL nao configurada" as const };
    }

    try {
      await axios.post(
        `${evolutionApiUrl}/webhook/set/${encodeURIComponent(instanceName)}`,
        {
          webhook: {
            enabled: true,
            url: webhookUrl,
            byEvents: false,
            base64: true,
            events: ["MESSAGES_UPSERT"],
          },
        },
        { headers: this.evolutionHeaders(apiKey) }
      );

      return { configured: true as const };
    } catch (error: any) {
      throw new HttpError(
        502,
        `Nao foi possivel configurar webhook da instancia ${instanceName} na Evolution`,
        error?.response?.data ?? error?.message ?? error
      );
    }
  }

  private async ensureEvolutionWebhook(instanceName: string) {
    return this.configureEvolutionWebhook(
      this.config.evolutionApiUrl,
      this.config.evolutionApiKey,
      instanceName
    );
  }

  private normalizeInstanceStatus(raw: string | null | undefined): "connected" | "disconnected" | "connecting" | "error" {
    const value = (raw ?? "").toLowerCase();
    if (value === "connected") return "connected";
    if (value === "connecting") return "connecting";
    if (value === "error") return "error";
    return "disconnected";
  }

  private deriveSetupStatus(instance: InstanceRow): InstanceSetupStatus {
    if (this.isExternalWebhookInstance(instance)) {
      return "connected";
    }

    const normalizedStatus = this.normalizeInstanceStatus(instance.status);
    if (normalizedStatus === "connected") {
      return "connected";
    }

    const setupStatus = instance.setup_status ?? null;
    if (setupStatus === "cancelled" || setupStatus === "expired" || setupStatus === "pending_qr" || setupStatus === "connected") {
      if (setupStatus === "pending_qr" && instance.setup_expires_at) {
        const expired = new Date(instance.setup_expires_at).getTime() < Date.now();
        if (expired) {
          return "expired";
        }
      }
      return setupStatus;
    }

    return "pending_qr";
  }

  private buildInstanceActions(instance: InstanceRow, setupStatus: InstanceSetupStatus): InstanceAction[] {
    if (this.isExternalWebhookInstance(instance)) {
      return ["delete"];
    }

    const status = this.normalizeInstanceStatus(instance.status);
    const actions: InstanceAction[] = ["sync_status", "delete"];

    if (status === "connected") {
      actions.push("disconnect");
      return actions;
    }

    if (setupStatus === "pending_qr" || setupStatus === "expired") {
      actions.push("continue_setup");
    }
    actions.push("reconnect");

    return actions;
  }

  private computeSetupExpirationIso(base = new Date()) {
    return addHours(base, AgentManager.INSTANCE_SETUP_TTL_HOURS).toISOString();
  }

  private async markExpiredPendingInstances(acesId: number) {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.serviceClient
      .from("instance")
      .update({
        setup_status: "expired",
        last_error: "Configuracao inicial expirada. Gere um novo QR code para concluir.",
      })
      .eq("aces_id", acesId)
      .eq("setup_status", "pending_qr")
      .lt("setup_expires_at", nowIso)
      .select("instancia");

    if (error) {
      throw new HttpError(500, "Nao foi possivel atualizar setups expirados", error);
    }

    for (const row of data ?? []) {
      await this.logInstanceEvent(acesId, String((row as JsonRecord).instancia), "expired");
    }
  }

  private async logInstanceEvent(
    acesId: number,
    instanceName: string,
    eventType: "created" | "qr_generated" | "connected" | "disconnected" | "reconnect" | "continue_setup" | "expired" | "deleted" | "error",
    payload: JsonRecord = {}
  ) {
    const { error } = await this.serviceClient.from("instance_events").insert({
      aces_id: acesId,
      instancia: instanceName,
      event_type: eventType,
      payload,
    });

    if (error) {
      console.warn("[crm-ai] Nao foi possivel registrar evento da instancia:", error);
    }
  }

  private async acquireInstanceLock(acesId: number, instanceName: string) {
    const { data, error } = await this.serviceClient.rpc("lock_instance_operation", {
      p_instance: instanceName,
      p_aces_id: acesId,
      p_lock_seconds: AgentManager.INSTANCE_OPERATION_LOCK_SECONDS,
    });

    if (error) {
      throw new HttpError(500, "Nao foi possivel bloquear operacao da instancia", error);
    }

    if (!data) {
      throw new HttpError(409, "Ja existe uma operacao em andamento para esta instancia. Tente novamente em instantes.");
    }
  }

  private async releaseInstanceLock(acesId: number, instanceName: string) {
    const { error } = await this.serviceClient.rpc("unlock_instance_operation", {
      p_instance: instanceName,
      p_aces_id: acesId,
    });

    if (error) {
      console.warn("[crm-ai] Falha ao liberar lock da instancia:", error);
    }
  }

  private async withInstanceLock<T>(acesId: number, instanceName: string, operation: () => Promise<T>) {
    await this.acquireInstanceLock(acesId, instanceName);
    try {
      return await operation();
    } finally {
      await this.releaseInstanceLock(acesId, instanceName);
    }
  }

  private async updateInstanceLifecycle(acesId: number, instanceName: string, payload: UpdateInstanceLifecycleInput) {
    const { error } = await this.serviceClient
      .from("instance")
      .update(payload)
      .eq("instancia", instanceName)
      .eq("aces_id", acesId);

    if (error) {
      throw new HttpError(500, "Nao foi possivel atualizar a instancia", error);
    }
  }

  private async assignInstanceOwner(acesId: number, instanceName: string, ownerId: string) {
    const { error } = await this.serviceClient
      .from("instance")
      .update({ created_by: ownerId })
      .eq("instancia", instanceName)
      .eq("aces_id", acesId)
      .is("created_by", null);

    if (error) {
      throw new HttpError(500, "Nao foi possivel vincular a instancia ao usuario", error);
    }
  }

  private async countActiveLeadsForInstance(acesId: number, instanceName: string) {
    const { count, error } = await this.serviceClient
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("aces_id", acesId)
      .eq("instancia", instanceName)
      .eq("view", true);

    if (error) {
      throw new HttpError(500, "Nao foi possivel contar os leads da instancia", error);
    }

    return count ?? 0;
  }

  private async buildLeadCountMap(acesId: number, instances: InstanceRow[]) {
    const entries = await Promise.all(
      instances.map(async (instance) => [
        instance.instancia,
        await this.countActiveLeadsForInstance(acesId, instance.instancia),
      ] as const)
    );

    return new Map(entries);
  }

  private async transferActiveLeadsToInstance(
    context: AuthContext,
    sourceInstanceName: string,
    targetInstanceName: string
  ) {
    const { error } = await this.serviceClient
      .from("leads")
      .update({
        instancia: targetInstanceName,
        owner_id: context.crmUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("aces_id", context.acesId)
      .eq("instancia", sourceInstanceName)
      .eq("view", true);

    if (error) {
      throw new HttpError(500, "Nao foi possivel transferir os leads da instancia", error);
    }
  }

  private async hideActiveLeadsForInstance(context: AuthContext, instanceName: string) {
    const { error } = await this.serviceClient
      .from("leads")
      .update({
        view: false,
        updated_at: new Date().toISOString(),
      })
      .eq("aces_id", context.acesId)
      .eq("instancia", instanceName)
      .eq("view", true);

    if (error) {
      throw new HttpError(500, "Nao foi possivel apagar os leads da instancia", error);
    }
  }

  private async deactivateAutomationFunnelsForInstance(context: AuthContext, instanceName: string) {
    const { error } = await this.serviceClient
      .from("automation_funnels")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("aces_id", context.acesId)
      .eq("created_by", context.crmUserId)
      .eq("instance_name", instanceName)
      .eq("is_active", true);

    if (error) {
      throw new HttpError(500, "Nao foi possivel desativar automacoes da instancia", error);
    }
  }

  private createScopedCrmClient(accessToken: string) {
    return createClient(this.config.supabaseUrl, this.config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "crm" },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });
  }

  private async resyncAutomationFunnelsForConnectedInstance(context: AuthContext, instanceName: string) {
    const { data: funnels, error } = await this.serviceClient
      .from("automation_funnels")
      .select("id, humanized_dispatch_enabled")
      .eq("aces_id", context.acesId)
      .eq("instance_name", instanceName)
      .eq("created_by", context.crmUserId)
      .eq("is_active", true);

    if (error) {
      throw new HttpError(500, "Nao foi possivel localizar automacoes da instancia conectada", error);
    }

    const scopedClient = this.createScopedCrmClient(context.accessToken);
    let syncedFunnels = 0;
    let replannedExecutions = 0;
    const failures: Array<{ funnelId: string; reason: string }> = [];

    for (const funnel of (funnels ?? []) as Array<{ id: string; humanized_dispatch_enabled: boolean | null }>) {
      try {
        await scopedClient.rpc("rpc_sync_automation_funnel_v2", {
          p_funnel_id: funnel.id,
        });
        syncedFunnels += 1;

        if (funnel.humanized_dispatch_enabled) {
          const { data: replanned, error: replanError } = await this.serviceClient.rpc(
            "replan_pending_humanized_funnel_dispatches",
            {
              p_funnel_id: funnel.id,
            }
          );

          if (replanError) {
            throw replanError;
          }

          replannedExecutions += Number(replanned ?? 0);
        }
      } catch (syncError) {
        failures.push({
          funnelId: funnel.id,
          reason:
            extractSupabaseErrorMessage(syncError) ??
            (syncError instanceof Error ? syncError.message : "Falha desconhecida ao replanejar automacao"),
        });
      }
    }

    return {
      foundFunnels: (funnels ?? []).length,
      syncedFunnels,
      replannedExecutions,
      failures,
    };
  }

  private async fetchEvolutionConnectionState(instanceName: string) {
    const { data } = await axios.get(
      `${this.config.evolutionApiUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`,
      { headers: this.evolutionHeaders() }
    );

    const payload = asRecord(data);
    const state =
      asString(asRecord(payload.instance).state) ??
      asString(payload.state) ??
      "disconnected";

    const status = state.toLowerCase() === "open" ? "connected" : "disconnected";
    return { state, status: status as "connected" | "disconnected" };
  }

  private async tryRequestEvolution(
    candidates: Array<{ method: "get" | "post" | "delete"; path: string; body?: JsonRecord }>
  ) {
    let lastErrorPayload: unknown = null;
    for (const candidate of candidates) {
      try {
        const response = await axios.request({
          method: candidate.method,
          url: `${this.config.evolutionApiUrl}${candidate.path}`,
          data: candidate.body,
          headers: this.evolutionHeaders(),
          validateStatus: () => true,
        });

        if (response.status >= 200 && response.status < 300) {
          return { ok: true, data: response.data };
        }

        if (response.status === 404) {
          lastErrorPayload = response.data;
          continue;
        }

        lastErrorPayload = response.data;
      } catch (error: any) {
        lastErrorPayload = error?.response?.data ?? error?.message ?? error;
      }
    }

    return { ok: false, data: lastErrorPayload };
  }

  private async disconnectOnEvolution(instanceName: string) {
    const encoded = encodeURIComponent(instanceName);
    return this.tryRequestEvolution([
      { method: "delete", path: `/instance/logout/${encoded}` },
      { method: "post", path: `/instance/logout/${encoded}` },
      { method: "delete", path: `/instance/disconnect/${encoded}` },
      { method: "post", path: `/instance/disconnect/${encoded}` },
    ]);
  }

  private async deleteOnEvolution(instanceName: string) {
    const encoded = encodeURIComponent(instanceName);
    return this.tryRequestEvolution([
      { method: "delete", path: `/instance/delete/${encoded}` },
      { method: "post", path: `/instance/delete/${encoded}` },
      { method: "post", path: `/instance/delete`, body: { instanceName } },
    ]);
  }

  private async findInstanceByName(instanceName: string) {
    const { data, error } = await this.serviceClient
      .from("instance")
      .select(
        "instancia, aces_id, created_by, color, token, status, created_at, setup_status, setup_started_at, setup_expires_at, operation_lock_until, last_error, connection_mode, remote_evolution_url, remote_instance_name, remote_webhook_connected_at"
      )
      .eq("instancia", instanceName)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel consultar a instancia", error);
    }

    return (data as InstanceRow | null) ?? null;
  }

  private async findInstanceProviderCredentials(instanceName: string, acesId: number) {
    const { data, error } = await this.serviceClient
      .from("instance_provider_credentials")
      .select("instance_name, aces_id, evolution_api_key")
      .eq("instance_name", instanceName)
      .eq("aces_id", acesId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel consultar a credencial da instancia externa", error);
    }

    return (data as InstanceProviderCredentialRow | null) ?? null;
  }

  private normalizeExternalEvolutionUrl(raw: string | null | undefined) {
    const value = raw?.trim().replace(/\/$/, "") ?? "";
    if (!value) {
      throw new HttpError(400, "URL da Evolution externa e obrigatoria");
    }

    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new HttpError(400, "URL da Evolution externa invalida");
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new HttpError(400, "URL da Evolution externa deve usar HTTP ou HTTPS");
    }

    return value;
  }

  private async resolveEvolutionTransport(instanceName: string, expectedAcesId?: number): Promise<EvolutionTransport> {
    const instance = await this.findInstanceByName(instanceName);
    if (!instance) {
      throw new HttpError(404, "Instancia de envio nao encontrada no CRM");
    }

    if (expectedAcesId !== undefined && instance.aces_id !== expectedAcesId) {
      throw new HttpError(403, "Instancia de envio nao pertence a esta conta");
    }

    if (!this.isExternalWebhookInstance(instance)) {
      return {
        apiUrl: this.config.evolutionApiUrl.replace(/\/$/, ""),
        apiKey: this.config.evolutionApiKey,
        instanceName: instance.instancia,
      };
    }

    const apiUrl = instance.remote_evolution_url?.trim().replace(/\/$/, "") ?? "";
    const remoteInstanceName = instance.remote_instance_name?.trim() ?? "";
    const credentials = await this.findInstanceProviderCredentials(instance.instancia, instance.aces_id);
    const apiKey = credentials?.evolution_api_key?.trim() ?? "";

    if (!apiUrl || !remoteInstanceName || !apiKey) {
      throw new HttpError(
        409,
        "Evolution externa sem URL, nome remoto ou API key. Vincule a instancia novamente."
      );
    }

    return { apiUrl, apiKey, instanceName: remoteInstanceName };
  }

  private async findInstanceByRemoteWebhookName(remoteInstanceName: string) {
    const { data, error } = await this.serviceClient
      .from("instance")
      .select(
        "instancia, aces_id, created_by, color, token, status, created_at, setup_status, setup_started_at, setup_expires_at, operation_lock_until, last_error, connection_mode, remote_evolution_url, remote_instance_name, remote_webhook_connected_at"
      )
      .eq("remote_instance_name", remoteInstanceName)
      .eq("connection_mode", "external_webhook")
      .limit(2);

    if (error) {
      throw new HttpError(500, "Nao foi possivel consultar a instancia externa", error);
    }

    const rows = (data ?? []) as InstanceRow[];
    if (rows.length > 1) {
      console.warn("[crm-ai] Webhook externo ambiguo para instancia remota:", {
        remoteInstanceName,
        matches: rows.map((row) => row.instancia),
      });
      return null;
    }

    return rows[0] ?? null;
  }

  private async resolveInstanceForEvolutionWebhook(instanceName: string) {
    const localInstance = await this.findInstanceByName(instanceName);
    if (localInstance) {
      return localInstance;
    }

    return this.findInstanceByRemoteWebhookName(instanceName);
  }

  private async ensureInstanceOwnership(acesId: number, instanceName: string, ownerId?: string | null) {
    const existing = await this.findInstanceByName(instanceName);
    if (!existing) {
      throw new HttpError(404, "Instancia nao encontrada");
    }

    if (existing.aces_id !== acesId) {
      throw new HttpError(403, "Instancia nao pertence a sua conta");
    }

    if (ownerId && existing.created_by !== ownerId) {
      throw new HttpError(403, "Instancia nao pertence ao usuario atual");
    }

    return existing;
  }

  private async fetchQrCodeFromEvolution(instanceName: string) {
    const { data } = await axios.get(
      `${this.config.evolutionApiUrl}/instance/connect/${encodeURIComponent(instanceName)}`,
      { headers: this.evolutionHeaders() }
    );

    const payload = asRecord(data);
    return (
      asString(payload.base64) ??
      asString(asRecord(payload.qrcode).base64) ??
      asString(asRecord(payload.qrcode).code) ??
      null
    );
  }

  private async getAgentForAccount(agentId: string, acesId: number, ownerId?: string | null) {
    let query = this.serviceClient
      .from("ai_agents")
      .select("*")
      .eq("id", agentId)
      .eq("aces_id", acesId);

    if (ownerId) {
      query = query.eq("created_by", ownerId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar o agente", error);
    }

    if (!data) {
      throw new HttpError(404, "Agente nao encontrado");
    }

    return data as AgentRow;
  }

  private async getAgentById(agentId: string) {
    const { data, error } = await this.serviceClient
      .from("ai_agents")
      .select("*")
      .eq("id", agentId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar o agente", error);
    }

    if (!data) {
      throw new HttpError(404, "Agente nao encontrado");
    }

    return data as AgentRow;
  }

  private async getAnyAgentByInstance(instanceName: string, acesId?: number, ownerId?: string | null) {
    let query = this.serviceClient
      .from("ai_agents")
      .select("*")
      .eq("instance_name", instanceName);

    if (typeof acesId === "number") {
      query = query.eq("aces_id", acesId);
    }

    if (ownerId) {
      query = query.eq("created_by", ownerId);
    }

    const { data, error } = await query
      .order("is_active", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel localizar o agente da instancia", error);
    }

    return (data as AgentRow | null) ?? null;
  }

  private async getStagesForAccount(acesId: number) {
    const { data, error } = await this.serviceClient
      .from("pipeline_stages")
      .select("id, aces_id, name, category, position")
      .eq("aces_id", acesId)
      .order("position", { ascending: true });

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar as etapas do funil", error);
    }

    return ((data ?? []) as StageRow[]).sort((a, b) => a.position - b.position);
  }

  private async getTagsForAccount(acesId: number) {
    const { data, error } = await this.serviceClient
      .from("tags")
      .select("id, aces_id, name, urgencia, usage_description")
      .eq("aces_id", acesId)
      .order("name", { ascending: true });

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar as tags do CRM", error);
    }

    return (data ?? []) as TagRow[];
  }

  private async syncMissingStageRules(agent: AgentRow) {
    const stages = await this.getStagesForAccount(agent.aces_id);
    const { data: currentRules, error } = await this.serviceClient
      .from("ai_stage_rules")
      .select("stage_id")
      .eq("agent_id", agent.id);

    if (error) {
      throw new HttpError(500, "Nao foi possivel sincronizar as regras por etapa", error);
    }

    const existing = new Set((currentRules ?? []).map((item) => String(item.stage_id)));
    const missing = stages
      .filter((stage) => !existing.has(stage.id))
      .map((stage) => ({
        agent_id: agent.id,
        stage_id: stage.id,
        goal_description: "",
        positive_signals: [],
        negative_signals: [],
        example_phrases: [],
        priority: stage.position,
        is_terminal: stage.category !== "Aberto",
      }));

    if (missing.length === 0) {
      return;
    }

    const { error: insertError } = await this.serviceClient.from("ai_stage_rules").insert(missing);
    if (insertError) {
      throw new HttpError(500, "Nao foi possivel criar as regras iniciais de etapa", insertError);
    }
  }

  async listAgents(context: AuthContext) {
    this.ensureAdmin(context);

    const { data, error } = await this.serviceClient
      .from("ai_agents")
      .select("*")
      .eq("aces_id", context.acesId)
      .eq("created_by", context.crmUserId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new HttpError(500, "Nao foi possivel listar os agentes", error);
    }

    return (data ?? []) as AgentRow[];
  }

  async createAgent(context: AuthContext, input: CreateAgentInput) {
    this.ensureAdmin(context);

    if (!input.name?.trim()) {
      throw new HttpError(400, "Nome do agente e obrigatorio");
    }

    if (!input.instanceName?.trim()) {
      throw new HttpError(400, "Instancia do agente e obrigatoria");
    }

    const { data: instanceRow, error: instanceError } = await this.serviceClient
      .from("instance")
      .select("instancia")
      .eq("aces_id", context.acesId)
      .eq("created_by", context.crmUserId)
      .eq("instancia", input.instanceName.trim())
      .maybeSingle();

    if (instanceError) {
      throw new HttpError(500, "Nao foi possivel validar a instancia selecionada", instanceError);
    }

    if (!instanceRow) {
      throw new HttpError(400, "A instancia informada nao pertence a esta conta");
    }

    const payload = {
      aces_id: context.acesId,
      instance_name: input.instanceName.trim(),
      name: input.name.trim(),
      system_prompt: input.systemPrompt?.trim() || DEFAULT_SYSTEM_MESSAGE,
      provider: input.provider ?? "gemini",
      model: input.model?.trim() || AgentManager.DEFAULT_CUSTOMER_AGENT_MODEL,
      is_active: input.isActive ?? true,
      buffer_wait_ms: input.bufferWaitMs ?? 15000,
      human_pause_minutes: input.humanPauseMinutes ?? 60,
      auto_apply_threshold: input.autoApplyThreshold ?? 0.85,
      handoff_enabled: input.handoffEnabled ?? false,
      handoff_prompt: input.handoffPrompt?.trim() || null,
      handoff_target_phone: input.handoffTargetPhone?.trim() || null,
      created_by: context.crmUserId,
    };

    const { data, error } = await this.serviceClient
      .from("ai_agents")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw new HttpError(500, "Nao foi possivel criar o agente", error);
    }

    const agent = data as AgentRow;
    await this.syncMissingStageRules(agent);
    return agent;
  }

  async updateAgent(context: AuthContext, agentId: string, input: UpdateAgentInput) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);

    const payload: JsonRecord = {};
    if (input.name !== undefined) payload.name = input.name.trim();
    if (input.instanceName !== undefined) payload.instance_name = input.instanceName.trim();
    if (input.systemPrompt !== undefined) payload.system_prompt = input.systemPrompt.trim();
    if (input.model !== undefined) payload.model = input.model.trim();
    if (input.provider !== undefined) payload.provider = input.provider;
    if (input.isActive !== undefined) payload.is_active = input.isActive;
    if (input.bufferWaitMs !== undefined) payload.buffer_wait_ms = input.bufferWaitMs;
    if (input.humanPauseMinutes !== undefined) payload.human_pause_minutes = input.humanPauseMinutes;
    if (input.autoApplyThreshold !== undefined) payload.auto_apply_threshold = input.autoApplyThreshold;
    if (input.handoffEnabled !== undefined) payload.handoff_enabled = input.handoffEnabled;
    if (input.handoffPrompt !== undefined) payload.handoff_prompt = input.handoffPrompt.trim() || null;
    if (input.handoffTargetPhone !== undefined) payload.handoff_target_phone = input.handoffTargetPhone.trim() || null;

    const { data, error } = await this.serviceClient
      .from("ai_agents")
      .update(payload)
      .eq("id", agentId)
      .eq("aces_id", context.acesId)
      .eq("created_by", context.crmUserId)
      .select("*")
      .single();

    if (error) {
      throw new HttpError(500, "Nao foi possivel atualizar o agente", error);
    }

    const agent = data as AgentRow;
    await this.syncMissingStageRules(agent);
    return agent;
  }

  async getStageRules(context: AuthContext, agentId: string) {
    this.ensureAdmin(context);
    const agent = await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    await this.syncMissingStageRules(agent);

    const stages = await this.getStagesForAccount(context.acesId);
    const { data, error } = await this.serviceClient
      .from("ai_stage_rules")
      .select("*")
      .eq("agent_id", agentId)
      .order("priority", { ascending: true });

    if (error) {
      throw new HttpError(500, "Nao foi possivel listar as regras por etapa", error);
    }

    const rules = (data ?? []) as StageRuleRow[];
    const ruleMap = new Map(rules.map((rule) => [rule.stage_id, rule]));

    return stages.map((stage) => ({
      stage,
      rule:
        ruleMap.get(stage.id) ?? ({
          id: "",
          agent_id: agentId,
          stage_id: stage.id,
          goal_description: "",
          positive_signals: [],
          negative_signals: [],
          example_phrases: [],
          priority: stage.position,
          is_terminal: stage.category !== "Aberto",
          created_at: "",
          updated_at: "",
        } satisfies StageRuleRow),
    }));
  }

  async saveStageRules(context: AuthContext, agentId: string, rules: StageRuleInput[]) {
    this.ensureAdmin(context);
    const agent = await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    await this.syncMissingStageRules(agent);

    const stages = await this.getStagesForAccount(context.acesId);
    const validStageIds = new Set(stages.map((stage) => stage.id));

    const payload = rules.map((rule) => {
      if (!validStageIds.has(rule.stage_id)) {
        throw new HttpError(400, "Uma ou mais etapas nao pertencem a esta conta");
      }

      return {
        agent_id: agentId,
        stage_id: rule.stage_id,
        goal_description: rule.goal_description?.trim() ?? "",
        positive_signals: rule.positive_signals ?? [],
        negative_signals: rule.negative_signals ?? [],
        example_phrases: rule.example_phrases ?? [],
        priority: rule.priority ?? 0,
        is_terminal: rule.is_terminal ?? false,
      };
    });

    if (payload.length > 0) {
      const { error } = await this.serviceClient
        .from("ai_stage_rules")
        .upsert(payload, { onConflict: "agent_id,stage_id" });

      if (error) {
        throw new HttpError(500, "Nao foi possivel salvar as regras da IA", error);
      }
    }

    return this.getStageRules(context, agentId);
  }

  private async getStageRulesForAgent(agent: AgentRow) {
    await this.syncMissingStageRules(agent);
    const stages = await this.getStagesForAccount(agent.aces_id);
    const { data, error } = await this.serviceClient
      .from("ai_stage_rules")
      .select("*")
      .eq("agent_id", agent.id)
      .order("priority", { ascending: true });

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar as regras do agente", error);
    }

    const rules = (data ?? []) as StageRuleRow[];
    const rulesByStage = new Map(rules.map((rule) => [rule.stage_id, rule]));

    return stages.map((stage) => ({
      stage,
      rule:
        rulesByStage.get(stage.id) ??
        ({
          id: "",
          agent_id: agent.id,
          stage_id: stage.id,
          goal_description: "",
          positive_signals: [],
          negative_signals: [],
          example_phrases: [],
          priority: stage.position,
          is_terminal: stage.category !== "Aberto",
          created_at: "",
          updated_at: "",
        } satisfies StageRuleRow),
    }));
  }

  async listRuns(context: AuthContext, agentId: string, leadId?: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);

    const { data: ownedLeads, error: ownedLeadsError } = await this.serviceClient
      .from("leads")
      .select("id")
      .eq("aces_id", context.acesId)
      .eq("owner_id", context.crmUserId);

    if (ownedLeadsError) {
      throw new HttpError(500, "Nao foi possivel validar os leads do usuario", ownedLeadsError);
    }

    const ownedLeadIds = (ownedLeads ?? []).map((lead) => String(lead.id));
    if (leadId && !ownedLeadIds.includes(leadId)) {
      throw new HttpError(404, "Lead nao encontrado para o usuario atual");
    }

    if (ownedLeadIds.length === 0) {
      return [];
    }

    let query = this.serviceClient
      .from("ai_runs")
      .select("*")
      .eq("agent_id", agentId)
      .in("lead_id", ownedLeadIds)
      .order("created_at", { ascending: false })
      .limit(100);

    if (leadId) {
      query = query.eq("lead_id", leadId);
    }

    const { data, error } = await query;
    if (error) {
      throw new HttpError(500, "Nao foi possivel listar as execucoes da IA", error);
    }

    return (data ?? []) as AiRunRow[];
  }

  async resumeLead(context: AuthContext, agentId: string, leadId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    await this.loadLeadById(leadId, context.acesId, context.crmUserId);

    const { error } = await this.serviceClient.from("ai_lead_state").upsert(
      {
        agent_id: agentId,
        lead_id: leadId,
        freeze_until: null,
        status: "active",
        pause_origin: null,
        pause_reference: null,
        paused_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agent_id,lead_id" }
    );

    if (error) {
      throw new HttpError(500, "Nao foi possivel reativar o atendimento da IA", error);
    }

    return { success: true };
  }

  async getLeadAiState(context: AuthContext, leadId: string) {
    const lead = await this.loadLeadById(leadId, context.acesId, context.crmUserId);
    const agent =
      lead.instancia?.trim()
        ? await this.getAnyAgentByInstance(lead.instancia, context.acesId, context.crmUserId)
        : null;

    return this.resolveLeadAiState(lead.id, agent, lead.instancia);
  }

  async updateLeadAiState(context: AuthContext, leadId: string, enabled: boolean) {
    const lead = await this.loadLeadById(leadId, context.acesId, context.crmUserId);
    const instanceName = lead.instancia?.trim() ?? "";
    if (!instanceName) {
      throw new HttpError(409, "Sem agente configurado para esta instancia");
    }

    const agent = await this.getAnyAgentByInstance(instanceName, context.acesId, context.crmUserId);
    if (!agent) {
      throw new HttpError(409, "Sem agente configurado para esta instancia");
    }

    await this.upsertLeadState(agent.id, lead.id, enabled
      ? {
          manual_ai_enabled: agent.is_active ? null : true,
          freeze_until: null,
          status: "active",
          pause_origin: null,
          pause_reference: null,
          paused_at: null,
        }
      : {
          manual_ai_enabled: false,
          freeze_until: null,
          status: "paused",
          pause_origin: "manual_override",
          pause_reference: context.crmUserId,
          paused_at: new Date().toISOString(),
        });

    return this.resolveLeadAiState(lead.id, agent, instanceName);
  }

  async listInstances(context: AuthContext) {
    this.ensureAdmin(context);
    await this.markExpiredPendingInstances(context.acesId);

    const { data, error } = await this.serviceClient
      .from("instance")
      .select(
        "instancia, aces_id, created_by, color, token, status, created_at, setup_status, setup_started_at, setup_expires_at, operation_lock_until, last_error, connection_mode, remote_evolution_url, remote_instance_name, remote_webhook_connected_at"
      )
      .eq("aces_id", context.acesId)
      .eq("created_by", context.crmUserId)
      .or("setup_status.is.null,setup_status.neq.cancelled")
      .order("created_at", { ascending: false });

    if (error) {
      throw new HttpError(500, "Nao foi possivel listar as instancias", error);
    }

    const rows = (data ?? []) as InstanceRow[];
    const leadCounts = await this.buildLeadCountMap(context.acesId, rows);

    return rows.map((instance): InstanceListItem => {
      const setupStatus = this.deriveSetupStatus(instance);
      return {
        instanceName: instance.instancia,
        status: this.normalizeInstanceStatus(instance.status),
        setupStatus,
        connectionMode: this.normalizeInstanceConnectionMode(instance.connection_mode),
        createdAt: instance.created_at ?? null,
        expiresAt: instance.setup_expires_at ?? null,
        lastError: instance.last_error ?? null,
        actions: this.buildInstanceActions(instance, setupStatus),
        color: instance.color ?? null,
        leadCount: leadCounts.get(instance.instancia) ?? 0,
      };
    });
  }

  async createInstanceConnection(context: AuthContext, input: CreateInstanceInput) {
    this.ensureAdmin(context);
    const instanceName = this.sanitizeInstanceName(input.instanceName);
    const connectWebhook = input.connectWebhook === true;

    await this.markExpiredPendingInstances(context.acesId);
    const now = new Date();
    const nowIso = now.toISOString();
    const setupExpiresAt = this.computeSetupExpirationIso(now);
    const existingRow = await this.findInstanceByName(instanceName);
    if (existingRow && existingRow.aces_id !== context.acesId) {
      throw new HttpError(409, "Nome de instancia indisponivel");
    }

    if (existingRow && existingRow.created_by && existingRow.created_by !== context.crmUserId) {
      throw new HttpError(403, "Instancia nao pertence ao usuario atual");
    }

    let existing = existingRow;
    if (existing && !existing.created_by) {
      await this.assignInstanceOwner(context.acesId, instanceName, context.crmUserId);
      existing = { ...existing, created_by: context.crmUserId };
    }

    if (connectWebhook) {
      const remoteEvolutionUrl = this.normalizeExternalEvolutionUrl(input.remoteEvolutionUrl);
      const remoteApiKey = input.remoteApiKey?.trim() ?? "";
      if (!remoteApiKey) {
        throw new HttpError(400, "API key da Evolution externa e obrigatoria");
      }
      const remoteInstanceName = this.sanitizeInstanceName(
        (input.remoteInstanceName ?? "").trim() || instanceName
      );
      const webhookSync = await this.configureEvolutionWebhook(
        remoteEvolutionUrl,
        remoteApiKey,
        remoteInstanceName
      );
      if (!webhookSync.configured) {
        throw new HttpError(500, webhookSync.reason);
      }

      if (!existing) {
        const { error: insertError } = await this.serviceClient.from("instance").insert({
          instancia: instanceName,
          aces_id: context.acesId,
          created_by: context.crmUserId,
          token: null,
          status: "connected",
          setup_status: "connected",
          setup_started_at: nowIso,
          setup_expires_at: null,
          last_error: null,
          connection_mode: "external_webhook",
          remote_evolution_url: remoteEvolutionUrl,
          remote_instance_name: remoteInstanceName,
          remote_webhook_connected_at: nowIso,
        });

        if (insertError) {
          throw new HttpError(500, "Nao foi possivel registrar a instancia no CRM", insertError);
        }

        await this.logInstanceEvent(context.acesId, instanceName, "created", {
          connection_mode: "external_webhook",
          remote_instance_name: remoteInstanceName,
          remote_evolution_url: remoteEvolutionUrl,
        });
      } else {
        const { error: updateError } = await this.serviceClient
          .from("instance")
          .update({
            created_by: context.crmUserId,
            token: null,
            status: "connected",
            setup_status: "connected",
            setup_started_at: nowIso,
            setup_expires_at: null,
            last_error: null,
            connection_mode: "external_webhook",
            remote_evolution_url: remoteEvolutionUrl,
            remote_instance_name: remoteInstanceName,
            remote_webhook_connected_at: nowIso,
          })
          .eq("instancia", instanceName)
          .eq("aces_id", context.acesId);

        if (updateError) {
          throw new HttpError(500, "Nao foi possivel atualizar a instancia com webhook externo", updateError);
        }

        await this.logInstanceEvent(context.acesId, instanceName, "connected", {
          connection_mode: "external_webhook",
          remote_instance_name: remoteInstanceName,
          remote_evolution_url: remoteEvolutionUrl,
        });
      }

      const { error: credentialError } = await this.serviceClient
        .from("instance_provider_credentials")
        .upsert(
          {
            instance_name: instanceName,
            aces_id: context.acesId,
            evolution_api_key: remoteApiKey,
            updated_at: nowIso,
          },
          { onConflict: "instance_name" }
        );

      if (credentialError) {
        throw new HttpError(500, "Nao foi possivel salvar a credencial da Evolution externa", credentialError);
      }

      return {
        success: true,
        instanceName,
        qrCodeBase64: null,
        status: "connected" as const,
        setupStatus: "connected" as const,
        connectionMode: "external_webhook" as const,
        message: "Evolution externa vinculada e webhook MESSAGES_UPSERT configurado.",
        expiresAt: null,
      };
    }

    let token = existing?.token ?? null;
    let qrCodeBase64: string | null = null;

    if (!existing) {
      try {
        const { data } = await axios.post(
          `${this.config.evolutionApiUrl}/instance/create`,
          {
            instanceName,
            qrcode: true,
            integration: "WHATSAPP-BAILEYS",
          },
          { headers: this.evolutionHeaders() }
        );

        const payload = asRecord(data);
        token = asString(asRecord(payload.hash).apikey);
        qrCodeBase64 =
          asString(asRecord(payload.qrcode).base64) ??
          asString(payload.base64) ??
          null;
      } catch (error: any) {
        const status = error?.response?.status as number | undefined;
        if (status !== 409) {
          throw new HttpError(
            502,
            "Falha ao criar instancia na Evolution",
            error?.response?.data ?? error?.message ?? error
          );
        }
      }
      const { error: insertError } = await this.serviceClient.from("instance").insert({
        instancia: instanceName,
        aces_id: context.acesId,
        created_by: context.crmUserId,
        token,
        status: "disconnected",
        setup_status: "pending_qr",
        setup_started_at: nowIso,
        setup_expires_at: setupExpiresAt,
        last_error: null,
        connection_mode: "local",
        remote_evolution_url: null,
        remote_instance_name: null,
        remote_webhook_connected_at: null,
      });

      if (insertError) {
        throw new HttpError(500, "Nao foi possivel registrar a instancia no CRM", insertError);
      }

      await this.logInstanceEvent(context.acesId, instanceName, "created");
      if (qrCodeBase64) {
        await this.logInstanceEvent(context.acesId, instanceName, "qr_generated");
      }
    } else {
      await this.withInstanceLock(context.acesId, instanceName, async () => {
        await this.updateInstanceLifecycle(context.acesId, instanceName, {
          status: this.normalizeInstanceStatus(existing!.status),
          setup_status: existing?.status === "connected" ? "connected" : "pending_qr",
          setup_started_at: nowIso,
          setup_expires_at: existing?.status === "connected" ? null : setupExpiresAt,
          last_error: null,
          token: token ?? null,
        });

        const { error: connectionUpdateError } = await this.serviceClient
          .from("instance")
          .update({
            connection_mode: "local",
            remote_evolution_url: null,
            remote_instance_name: null,
            remote_webhook_connected_at: null,
          })
          .eq("instancia", instanceName)
          .eq("aces_id", context.acesId);

        if (connectionUpdateError) {
          throw new HttpError(500, "Nao foi possivel normalizar a origem da instancia", connectionUpdateError);
        }

        const { error: credentialDeleteError } = await this.serviceClient
          .from("instance_provider_credentials")
          .delete()
          .eq("instance_name", instanceName)
          .eq("aces_id", context.acesId);

        if (credentialDeleteError) {
          throw new HttpError(500, "Nao foi possivel remover a credencial da instancia externa", credentialDeleteError);
        }
      });
    }

    const currentStatus = this.normalizeInstanceStatus(existing?.status);
    if (existing && currentStatus !== "connected") {
      await this.logInstanceEvent(context.acesId, instanceName, "continue_setup");
    }
    if (!qrCodeBase64 && currentStatus !== "connected") {
      try {
        qrCodeBase64 = await this.fetchQrCodeFromEvolution(instanceName);
        await this.logInstanceEvent(context.acesId, instanceName, "qr_generated");
      } catch (error: any) {
        throw new HttpError(
          502,
          "Instancia registrada, mas nao foi possivel gerar QR code",
          error?.response?.data ?? error?.message ?? error
        );
      }
    }

    if (currentStatus !== "connected") {
      await this.updateInstanceLifecycle(context.acesId, instanceName, {
        status: "disconnected",
        setup_status: "pending_qr",
        setup_started_at: nowIso,
        setup_expires_at: setupExpiresAt,
        last_error: null,
        token: token ?? null,
      });
    }

    const webhookSync = await this.ensureEvolutionWebhook(instanceName);
    if (!webhookSync.configured) {
      console.warn(`[crm-ai] Webhook da Evolution nao configurado automaticamente para ${instanceName}: ${webhookSync.reason}`);
    }

    return {
      success: true,
      instanceName,
      qrCodeBase64,
      status: currentStatus === "connected" ? "connected" : "disconnected",
      setupStatus: currentStatus === "connected" ? "connected" : "pending_qr",
      connectionMode: "local" as const,
      expiresAt: currentStatus === "connected" ? null : setupExpiresAt,
    };
  }

  async reconnectInstance(context: AuthContext, instanceNameRaw: string) {
    this.ensureAdmin(context);
    const instanceName = this.sanitizeInstanceName(instanceNameRaw);
    await this.markExpiredPendingInstances(context.acesId);
    const instance = await this.ensureInstanceOwnership(context.acesId, instanceName, context.crmUserId);
    if (this.isExternalWebhookInstance(instance)) {
      throw new HttpError(400, "Instancias conectadas por webhook externo nao usam QR code ou reconexao local");
    }

    return this.withInstanceLock(context.acesId, instanceName, async () => {
      const now = new Date();
      const setupExpiresAt = this.computeSetupExpirationIso(now);
      let qrCodeBase64: string | null = null;

      try {
        qrCodeBase64 = await this.fetchQrCodeFromEvolution(instanceName);
      } catch (error: any) {
        const creationAttempt = await this.tryRequestEvolution([
          {
            method: "post",
            path: "/instance/create",
            body: {
              instanceName,
              qrcode: true,
              integration: "WHATSAPP-BAILEYS",
            },
          },
        ]);

        if (!creationAttempt.ok) {
          throw new HttpError(
            502,
            "Nao foi possivel reconectar a instancia na Evolution",
            creationAttempt.data ?? error?.response?.data ?? error?.message ?? error
          );
        }

        qrCodeBase64 = asString(asRecord(asRecord(creationAttempt.data).qrcode).base64) ?? null;
      }

      await this.updateInstanceLifecycle(context.acesId, instanceName, {
        status: "disconnected",
        setup_status: "pending_qr",
        setup_started_at: now.toISOString(),
        setup_expires_at: setupExpiresAt,
        last_error: null,
      });

      await this.logInstanceEvent(context.acesId, instanceName, "reconnect");
      await this.logInstanceEvent(context.acesId, instanceName, "qr_generated");

      const webhookSync = await this.ensureEvolutionWebhook(instanceName);
      if (!webhookSync.configured) {
        console.warn(`[crm-ai] Webhook da Evolution nao configurado automaticamente para ${instanceName}: ${webhookSync.reason}`);
      }

      return {
        success: true,
        instanceName,
        qrCodeBase64,
        status: "disconnected" as const,
        setupStatus: "pending_qr" as const,
        expiresAt: setupExpiresAt,
      };
    });
  }

  async getInstanceQrCode(context: AuthContext, instanceNameRaw: string) {
    this.ensureAdmin(context);
    const instanceName = this.sanitizeInstanceName(instanceNameRaw);
    const instance = await this.ensureInstanceOwnership(context.acesId, instanceName, context.crmUserId);
    if (this.isExternalWebhookInstance(instance)) {
      throw new HttpError(400, "Instancias conectadas por webhook externo nao possuem QR code local");
    }

    try {
      const qrCodeBase64 = await this.fetchQrCodeFromEvolution(instanceName);
      await this.updateInstanceLifecycle(context.acesId, instanceName, {
        status: "disconnected",
        setup_status: "pending_qr",
        setup_started_at: new Date().toISOString(),
        setup_expires_at: this.computeSetupExpirationIso(),
        last_error: null,
      });
      await this.logInstanceEvent(context.acesId, instanceName, "continue_setup");
      await this.logInstanceEvent(context.acesId, instanceName, "qr_generated");

      return {
        success: true,
        instanceName,
        qrCodeBase64,
        status: "disconnected" as const,
        setupStatus: "pending_qr" as const,
      };
    } catch (error: any) {
      throw new HttpError(
        502,
        "Nao foi possivel atualizar o QR code da instancia",
        error?.response?.data ?? error?.message ?? error
      );
    }
  }

  async getInstanceStatus(context: AuthContext, instanceNameRaw: string) {
    this.ensureAdmin(context);
    const instanceName = this.sanitizeInstanceName(instanceNameRaw);
    const instance = await this.ensureInstanceOwnership(context.acesId, instanceName, context.crmUserId);
    if (this.isExternalWebhookInstance(instance)) {
      const status = this.normalizeInstanceStatus(instance.status);
      const setupStatus = this.deriveSetupStatus(instance);
      return {
        success: true,
        instanceName,
        state: status,
        status,
        setupStatus,
      };
    }

    try {
      const { state, status } = await this.fetchEvolutionConnectionState(instanceName);
      const previousStatus = this.normalizeInstanceStatus(instance.status);
      const justConnected = previousStatus !== "connected" && status === "connected";
      const setupStatus =
        status === "connected"
          ? "connected"
          : this.deriveSetupStatus({ ...instance, status });

      await this.updateInstanceLifecycle(context.acesId, instanceName, {
        status,
        setup_status: setupStatus,
        setup_expires_at: status === "connected" ? null : instance.setup_expires_at ?? this.computeSetupExpirationIso(),
        last_error: null,
      });

      const webhookSync = await this.ensureEvolutionWebhook(instanceName);
      if (!webhookSync.configured) {
        console.warn(`[crm-ai] Webhook da Evolution nao configurado automaticamente para ${instanceName}: ${webhookSync.reason}`);
      }

      if (status === "connected") {
        let automationSyncPayload: JsonRecord = {
          previous_status: previousStatus,
          reconnect_resync_triggered: justConnected,
        };

        if (justConnected) {
          try {
            const syncSummary = await this.resyncAutomationFunnelsForConnectedInstance(context, instanceName);
            automationSyncPayload = {
              ...automationSyncPayload,
              automation_sync: syncSummary,
            };
          } catch (syncError) {
            automationSyncPayload = {
              ...automationSyncPayload,
              automation_sync: {
                failed: true,
                reason:
                  extractSupabaseErrorMessage(syncError) ??
                  (syncError instanceof Error ? syncError.message : "Falha desconhecida ao sincronizar automacoes"),
              },
            };
          }
        }

        await this.logInstanceEvent(context.acesId, instanceName, "connected", automationSyncPayload);
      }

      return {
        success: true,
        instanceName,
        state,
        status,
        setupStatus,
      };
    } catch (error: any) {
      await this.updateInstanceLifecycle(context.acesId, instanceName, {
        status: "error",
        last_error: "Falha ao consultar estado na Evolution.",
      }).catch(() => {
        // falha de persistencia nao deve ocultar erro original
      });
      await this.logInstanceEvent(context.acesId, instanceName, "error", {
        reason: "status_sync_failed",
      });

      throw new HttpError(
        502,
        "Nao foi possivel consultar o status da instancia",
        error?.response?.data ?? error?.message ?? error
      );
    }
  }

  async disconnectInstance(context: AuthContext, instanceNameRaw: string) {
    this.ensureAdmin(context);
    const instanceName = this.sanitizeInstanceName(instanceNameRaw);
    const instance = await this.ensureInstanceOwnership(context.acesId, instanceName, context.crmUserId);
    if (this.isExternalWebhookInstance(instance)) {
      throw new HttpError(400, "Instancias conectadas por webhook externo nao podem ser desconectadas por este fluxo");
    }

    return this.withInstanceLock(context.acesId, instanceName, async () => {
      const evolutionResult = await this.disconnectOnEvolution(instanceName);
      const remoteError = evolutionResult.ok ? null : JSON.stringify(evolutionResult.data ?? {});

      await this.updateInstanceLifecycle(context.acesId, instanceName, {
        status: "disconnected",
        last_error: remoteError,
      });
      await this.logInstanceEvent(context.acesId, instanceName, "disconnected", {
        evolution_ok: evolutionResult.ok,
      });

      return {
        success: true,
        instanceName,
        status: "disconnected" as const,
        warning: evolutionResult.ok ? null : "Instancia marcada como desconectada no CRM, mas a Evolution retornou erro.",
      };
    });
  }

  async deleteInstance(context: AuthContext, instanceNameRaw: string, options?: DeleteInstanceOptions) {
    this.ensureAdmin(context);
    const instanceName = this.sanitizeInstanceName(instanceNameRaw);
    const instance = await this.ensureInstanceOwnership(context.acesId, instanceName, context.crmUserId);
    const hardDelete = options?.hardDelete ?? false;

    return this.withInstanceLock(context.acesId, instanceName, async () => {
      const leadCount = await this.countActiveLeadsForInstance(context.acesId, instanceName);
      const leadAction = options?.leadAction ?? "none";
      let transferTarget: string | null = null;

      if (leadCount > 0) {
        if (leadAction === "none") {
          throw new HttpError(409, "Transfira ou apague os leads antes de excluir a instancia", {
            leadCount,
            requiredAction: true,
          });
        }

        if (leadAction === "transfer") {
          transferTarget = this.sanitizeInstanceName(options?.transferToInstanceName ?? "");
          if (transferTarget === instanceName) {
            throw new HttpError(400, "Selecione uma instancia de destino diferente");
          }

          const target = await this.ensureInstanceOwnership(context.acesId, transferTarget, context.crmUserId);
          if (this.deriveSetupStatus(target) === "cancelled") {
            throw new HttpError(400, "A instancia de destino nao esta ativa");
          }

          await this.transferActiveLeadsToInstance(context, instanceName, transferTarget);
        } else if (leadAction === "delete") {
          if ((options?.confirmationText ?? "").trim().toLowerCase() !== "apagar") {
            throw new HttpError(400, "Digite apagar para confirmar a remocao dos leads");
          }

          await this.hideActiveLeadsForInstance(context, instanceName);
        } else {
          throw new HttpError(400, "Acao de leads invalida");
        }
      }

      await this.deactivateAutomationFunnelsForInstance(context, instanceName);

      const evolutionResult = this.isExternalWebhookInstance(instance)
        ? { ok: true as const, data: null }
        : await this.deleteOnEvolution(instanceName);
      const remoteError = evolutionResult.ok ? null : JSON.stringify(evolutionResult.data ?? {});

      if (hardDelete) {
        const { error } = await this.serviceClient
          .from("instance")
          .delete()
          .eq("instancia", instanceName)
          .eq("aces_id", context.acesId)
          .eq("created_by", context.crmUserId);

        if (error) {
          throw new HttpError(500, "Nao foi possivel remover a instancia do CRM", error);
        }
      } else {
        await this.updateInstanceLifecycle(context.acesId, instanceName, {
          status: "disconnected",
          setup_status: "cancelled",
          setup_expires_at: null,
          last_error: remoteError,
        });
      }

      await this.logInstanceEvent(context.acesId, instanceName, "deleted", {
        hard_delete: hardDelete,
        evolution_ok: evolutionResult.ok,
        lead_action: leadCount > 0 ? leadAction : "none",
        leads_affected: leadCount,
        transfer_target: transferTarget,
      });

      return {
        success: true,
        instanceName,
        mode: hardDelete ? "hard" : "soft",
        leadAction: leadCount > 0 ? leadAction : "none",
        leadsAffected: leadCount,
        transferTarget,
        warning: evolutionResult.ok ? null : "Instancia removida do CRM, mas a Evolution retornou erro durante exclusao.",
      };
    });
  }

  private getModel(modelName: string): GenerativeModel {
    if (!this.gemini) {
      throw new HttpError(500, "GEMINI_API_KEY nao configurada no backend");
    }

    return this.gemini.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json",
      },
    });
  }

  private async registerOutboundEcho(params: {
    acesId: number;
    leadId: string;
    origin: OutboundEchoOrigin;
    referenceId?: string | null;
    conversationId?: string | null;
    instanceName: string;
    phone: string;
    content: string;
    sentAt?: string;
  }) {
    return registerOutboundEcho({
      client: this.serviceClient,
      redis: this.redis,
      ...params,
    });
  }

  private getGeminiModelCandidates(primaryModelName: string) {
    const candidates = [primaryModelName.trim(), ...this.geminiFallbackModels]
      .map((item) => item.trim())
      .filter(Boolean);

    return Array.from(new Set(candidates));
  }

  private async generateGeminiContent(
    primaryModelName: string,
    prompt: string | Array<string | { inlineData: { mimeType: string; data: string } }>
  ) {
    const models = this.getGeminiModelCandidates(primaryModelName);
    let lastError: unknown = null;

    for (const [modelIndex, modelName] of models.entries()) {
      const model = this.getModel(modelName);

      for (let attempt = 1; attempt <= this.geminiMaxRetries; attempt += 1) {
        try {
          const result = await model.generateContent(prompt);
          return {
            result,
            modelName,
            usedFallback: modelIndex > 0,
            attempt,
          };
        } catch (error) {
          lastError = error;
          const canRetry = isTransientGeminiError(error) && attempt < this.geminiMaxRetries;
          const canFallback = isTransientGeminiError(error) && modelIndex < models.length - 1;

          console.warn("[crm-ai] Falha ao gerar conteudo com Gemini:", {
            model: modelName,
            attempt,
            canRetry,
            canFallback,
            error: extractExternalErrorMessage(error) ?? (error instanceof Error ? error.message : error),
          });

          if (canRetry) {
            await wait(this.geminiRetryBaseDelayMs * 2 ** (attempt - 1));
            continue;
          }

          break;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Falha ao gerar conteudo com Gemini");
  }

  private async matchOutboundEcho(instanceName: string, phone: string, content: string) {
    return matchOutboundEcho({
      client: this.serviceClient,
      redis: this.redis,
      instanceName,
      phone,
      content,
    });
  }

  private async matchRecentOutboundMessageFallback(
    leadId: string,
    instanceName: string,
    content: string
  ): Promise<{
    sourceType: "ai" | "automation" | "manual";
    messageId: string | null;
    conversationId: string | null;
  } | null> {
    const since = new Date(
      Date.now() - AgentManager.FROM_ME_ECHO_LOOKBACK_MINUTES * 60_000
    ).toISOString();

    const { data, error } = await this.serviceClient
      .from("message_history")
      .select("id, source_type, created_by, conversation_id, sent_at")
      .eq("lead_id", leadId)
      .eq("direction", "outbound")
      .eq("instance", instanceName)
      .eq("content", content)
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(5);

    if (error) {
      console.warn("[crm-ai] Falha ao consultar fallback de echo outbound:", {
        leadId,
        instanceName,
        error: extractSupabaseErrorMessage(error),
      });
      return null;
    }

    for (const row of (data ?? []) as Array<{
      id: string;
      source_type: string;
      created_by: string | null;
      conversation_id: string | null;
    }>) {
      if (row.source_type === "ai" || row.source_type === "automation") {
        return {
          sourceType: row.source_type,
          messageId: row.id,
          conversationId: row.conversation_id,
        };
      }

      if (row.source_type === "human" && row.created_by) {
        return {
          sourceType: "manual",
          messageId: row.id,
          conversationId: row.conversation_id,
        };
      }
    }

    return null;
  }

  private outboundSourceTypeFromEcho(origin: OutboundEchoOrigin): "human" | "ai" | "automation" {
    if (origin === "manual") {
      return "human";
    }

    if (origin === "agent_followup") {
      return "ai";
    }

    if (origin === "calendar_followup") {
      return "automation";
    }

    return origin;
  }

  private async ensureOutboundEchoVisible(params: {
    acesId: number;
    leadId: string | null;
    instanceName: string;
    content: string;
    sentAt: string;
    conversationId: string | null;
    origin: OutboundEchoOrigin;
  }) {
    if (!params.leadId) {
      return null;
    }

    const sourceType = this.outboundSourceTypeFromEcho(params.origin);
    const sentAtMs = Date.parse(params.sentAt);
    const since = new Date((Number.isFinite(sentAtMs) ? sentAtMs : Date.now()) - 10 * 60_000).toISOString();

    const { data, error } = await this.serviceClient
      .from("message_history")
      .select("id")
      .eq("lead_id", params.leadId)
      .eq("aces_id", params.acesId)
      .eq("direction", "outbound")
      .eq("source_type", sourceType)
      .eq("instance", params.instanceName)
      .eq("content", params.content)
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel verificar echo outbound no historico", error);
    }

    if (data) {
      await this.invalidateChatMessagesCache(params.acesId, params.leadId);
      return String(data.id);
    }

    const message = await this.saveMessage({
      leadId: params.leadId,
      acesId: params.acesId,
      content: params.content,
      direction: "outbound",
      sourceType,
      instanceName: params.instanceName,
      conversationId: params.conversationId,
      sentAt: params.sentAt,
    });

    return message.id;
  }

  private async repairAutomationFreezeForLead(leadId: string | null, reference: string) {
    if (!leadId) {
      return;
    }

    const { error } = await this.serviceClient.rpc("rpc_repair_automation_ai_freezes", {
      p_lead_id: leadId,
      p_reference: reference,
    });

    if (error) {
      throw new HttpError(500, "Nao foi possivel reparar o freeze da IA", error);
    }
  }

  private async dedupeIncomingMessage(messageId: string | null) {
    if (!messageId || !this.redis) {
      return false;
    }

    const key = `crm-ai:inbound:${messageId}`;
    const stored = await this.redis.set(key, "1", "EX", 600, "NX");
    return stored !== "OK";
  }

  private chatMessagesCacheKey(acesId: number, leadId: string) {
    return `crm-chat:messages:${acesId}:${leadId}`;
  }

  private async invalidateChatMessagesCache(acesId: number, leadId: string) {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.del(this.chatMessagesCacheKey(acesId, leadId));
    } catch (error) {
      console.warn("[crm-ai] Falha ao invalidar cache de mensagens do chat:", {
        acesId,
        leadId,
        error: extractExternalErrorMessage(error) ?? (error instanceof Error ? error.message : error),
      });
    }
  }

  private async createSignedDownloadUrl(storagePath: string) {
    const { data, error } = await this.serviceClient.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .createSignedUrl(storagePath, this.chatSignedDownloadTtlSeconds);

    if (error || !data?.signedUrl) {
      throw new HttpError(500, "Nao foi possivel gerar URL assinada do anexo", error);
    }

    return data.signedUrl;
  }

  private async assertStorageObjectExists(storagePath: string) {
    const pathParts = storagePath.split("/").filter(Boolean);
    const fileName = pathParts.pop();
    const directory = pathParts.join("/");

    if (!fileName || !directory) {
      throw new HttpError(400, "Caminho de storage invalido");
    }

    const { data, error } = await this.serviceClient.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .list(directory, { limit: 100, search: fileName });

    if (error) {
      throw new HttpError(500, "Nao foi possivel validar o objeto no Storage", error);
    }

    const found = (data ?? []).some((item) => item.name === fileName);
    if (!found) {
      throw new HttpError(400, "Upload assinado ainda nao foi concluido");
    }
  }

  private async saveMessage(params: {
    id?: string;
    leadId: string;
    acesId: number;
    content: string;
    direction: "inbound" | "outbound";
    sourceType: "lead" | "human" | "ai" | "automation" | "system";
    instanceName: string | null;
    createdBy?: string | null;
    conversationId?: string | null;
    sentAt?: string;
    provider?: "evolution" | "meta" | null;
    providerMessageId?: string | null;
    providerStatus?: "accepted" | "sent" | "failed" | null;
    providerErrorCode?: string | null;
    providerErrorMessage?: string | null;
    providerPayloadSummary?: unknown;
  }) {
    const sentAt = params.sentAt ?? new Date().toISOString();
    const payload: Record<string, unknown> = {
      lead_id: params.leadId,
      aces_id: params.acesId,
      content: params.content,
      direction: params.direction,
      source_type: params.sourceType,
      instance: params.instanceName,
      created_by: params.createdBy ?? null,
      conversation_id: params.conversationId ?? null,
      sent_at: sentAt,
    };

    if (params.id) {
      payload.id = params.id;
    }

    if (params.provider !== undefined) {
      payload.provider = params.provider;
      payload.provider_message_id = params.providerMessageId ?? null;
      payload.provider_status = params.providerStatus ?? null;
      payload.provider_error_code = params.providerErrorCode ?? null;
      payload.provider_error_message = params.providerErrorMessage ?? null;
      payload.provider_payload_summary = params.providerPayloadSummary ?? null;
    }

    await this.invalidateChatMessagesCache(params.acesId, params.leadId);

    const { data, error } = await this.serviceClient
      .from("message_history")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw new HttpError(500, "Nao foi possivel registrar a mensagem no CRM", error);
    }

    await this.serviceClient
      .from("leads")
      .update({
        last_message_at: sentAt,
        updated_at: new Date().toISOString(),
        instancia: params.instanceName,
      })
      .eq("id", params.leadId)
      .eq("aces_id", params.acesId);

    await this.invalidateChatMessagesCache(params.acesId, params.leadId);

    return data as MessageRow;
  }

  private async loadLeadById(leadId: string, acesId: number, ownerId?: string | null) {
    let query = this.serviceClient
      .from("leads")
      .select("id, aces_id, owner_id, name, contact_phone, status, stage_id, instancia, last_city, notes, check, last_message_at, updated_at")
      .eq("id", leadId)
      .eq("aces_id", acesId);

    if (ownerId) {
      query = query.eq("owner_id", ownerId);
    }

    const { data, error } = await query
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar o lead", error);
    }

    if (!data) {
      throw new HttpError(404, "Lead nao encontrado");
    }

    return data as LeadRow;
  }

  private async findLeadByPhone(acesId: number, phone: string) {
    const variants = phoneVariants(phone);
    const { data, error } = await this.serviceClient
      .from("leads")
      .select("id, aces_id, owner_id, name, contact_phone, status, stage_id, instancia, last_city, notes, check, last_message_at, updated_at")
      .eq("aces_id", acesId)
      .in("contact_phone", variants)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel localizar o lead pelo telefone", error);
    }

    return (data as LeadRow | null) ?? null;
  }

  private async getDefaultLeadOwnerId(acesId: number) {
    const { data, error } = await this.serviceClient
      .from("users")
      .select("id")
      .eq("aces_id", acesId)
      .neq("role", "NENHUM")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel definir o responsavel padrao do lead", error);
    }

    return data?.id ? String(data.id) : null;
  }

  private async findOrCreateLead(
    acesId: number,
    phone: string,
    instanceName: string,
    pushName?: string | null,
    ownerId?: string | null
  ) {
    const found = await this.findLeadByPhone(acesId, phone);
    const payloadName = normalizeLeadDisplayName(pushName);
    if (found) {
      if (ownerId && found.owner_id !== ownerId) {
        throw new HttpError(403, "Lead pertence a outro responsavel");
      }

      if (payloadName && isFallbackLeadName(found.name, phone)) {
        const { data, error } = await this.serviceClient
          .from("leads")
          .update({
            name: payloadName,
            updated_at: new Date().toISOString(),
          })
          .eq("id", found.id)
          .eq("aces_id", acesId)
          .select("id, aces_id, owner_id, name, contact_phone, status, stage_id, instancia, last_city, notes, check, last_message_at, updated_at")
          .single();

        if (error) {
          throw new HttpError(500, "Nao foi possivel atualizar o nome do lead", error);
        }

        return data as LeadRow;
      }

      return found;
    }

    const stages = await this.getStagesForAccount(acesId);
    const defaultStage = stages.find((stage) => stage.category === "Aberto") ?? stages[0] ?? null;
    const preferredPhone = normalizePhone(phone);
    const name = payloadName || `Lead ${preferredPhone}`;
    const resolvedOwnerId = ownerId ?? await this.getDefaultLeadOwnerId(acesId);

    const { data, error } = await this.serviceClient
      .from("leads")
      .insert({
        aces_id: acesId,
        name,
        contact_phone: preferredPhone,
        status: defaultStage?.name ?? "Novo",
        stage_id: defaultStage?.id ?? null,
        instancia: instanceName,
        owner_id: resolvedOwnerId,
        view: true,
      })
      .select("id, aces_id, owner_id, name, contact_phone, status, stage_id, instancia, last_city, notes, check, last_message_at, updated_at")
      .single();

    if (error) {
      throw new HttpError(500, "Nao foi possivel criar o lead a partir da conversa", error);
    }

    return data as LeadRow;
  }

  private async fetchRecentConversation(leadId: string) {
    const { data, error } = await this.serviceClient
      .from("message_history")
      .select("id, lead_id, aces_id, content, direction, source_type, instance, created_by, sent_at, conversation_id")
      .eq("lead_id", leadId)
      .order("sent_at", { ascending: false })
      .limit(20);

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar o historico da conversa", error);
    }

    return ((data ?? []) as MessageRow[]).reverse();
  }

  private async fetchLatestLeadInboundMessage(leadId: string) {
    const { data, error } = await this.serviceClient
      .from("message_history")
      .select("id, content, sent_at")
      .eq("lead_id", leadId)
      .eq("source_type", "lead")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar a ultima mensagem do lead", error);
    }

    return (data as LatestLeadInboundMessage | null) ?? null;
  }

  private shouldAnalyzeLead(latestInboundAt: string | null, lastProcessedAt: string | null) {
    if (!latestInboundAt) {
      return false;
    }

    if (!lastProcessedAt) {
      return true;
    }

    const latestInboundMs = Date.parse(latestInboundAt);
    const lastProcessedMs = Date.parse(lastProcessedAt);

    return Number.isFinite(latestInboundMs) && Number.isFinite(lastProcessedMs)
      ? latestInboundMs > lastProcessedMs
      : true;
  }

  private getCrmAnalysisInactivityRemainingMs(latestInboundAt: string | null) {
    if (!latestInboundAt) {
      return 0;
    }

    const latestInboundMs = Date.parse(latestInboundAt);
    if (!Number.isFinite(latestInboundMs)) {
      return 0;
    }

    const elapsedMs = Date.now() - latestInboundMs;
    return Math.max(0, AgentManager.CRM_ANALYSIS_INACTIVITY_MS - elapsedMs);
  }

  private scheduleCrmAnalysisAfterInactivity(agentId: string, leadId: string, delayMs: number) {
    const timerKey = `${agentId}:${leadId}`;
    const existingTimer = this.idleAnalysisTimers.get(timerKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.idleAnalysisTimers.delete(timerKey);
      this.flushBufferedConversation(agentId, leadId).catch((error) => {
        console.error("[crm-ai] Falha ao processar analise apos inatividade:", error);
      });
    }, Math.max(1000, delayMs));

    this.idleAnalysisTimers.set(timerKey, timer);
  }

  private async getLeadState(agentId: string, leadId: string) {
    const { data, error } = await this.serviceClient
      .from("ai_lead_state")
      .select("*")
      .eq("agent_id", agentId)
      .eq("lead_id", leadId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel consultar o estado da IA para o lead", error);
    }

    return (data as LeadAiStateRow | null) ?? null;
  }

  private async resolveLeadAiState(
    leadId: string,
    agent: AgentRow | null,
    instanceName?: string | null
  ): Promise<LeadAiControlState> {
    if (!agent) {
      return {
        success: true,
        leadId,
        instanceName: instanceName ?? null,
        agentId: null,
        available: false,
        enabled: false,
        agentIsActive: false,
        manualAiEnabled: null,
        pausedUntil: null,
        bypassingGlobalInactive: false,
        reason: "no_agent",
      };
    }

    const leadState = await this.getLeadState(agent.id, leadId);
    const manualAiEnabled =
      typeof leadState?.manual_ai_enabled === "boolean"
        ? leadState.manual_ai_enabled
        : null;
    const pausedUntil = asString(leadState?.freeze_until);
    const isPaused = Boolean(pausedUntil && new Date(pausedUntil) > new Date());
    const baseState = {
      success: true as const,
      leadId,
      instanceName: instanceName ?? agent.instance_name ?? null,
      agentId: agent.id,
      available: true,
      agentIsActive: agent.is_active,
      manualAiEnabled,
      pausedUntil,
    };

    if (manualAiEnabled === false) {
      return {
        ...baseState,
        enabled: false,
        bypassingGlobalInactive: false,
        reason: "manual_off",
      };
    }

    if (isPaused) {
      return {
        ...baseState,
        enabled: false,
        bypassingGlobalInactive: false,
        reason: "auto_pause",
      };
    }

    if (manualAiEnabled === true) {
      return {
        ...baseState,
        enabled: true,
        bypassingGlobalInactive: !agent.is_active,
        reason: "active",
      };
    }

    if (agent.is_active) {
      return {
        ...baseState,
        enabled: true,
        bypassingGlobalInactive: false,
        reason: "active",
      };
    }

    return {
      ...baseState,
      enabled: false,
      bypassingGlobalInactive: false,
      reason: "global_inactive",
    };
  }

  private async upsertLeadState(agentId: string, leadId: string, payload: JsonRecord) {
    const { error } = await this.serviceClient.from("ai_lead_state").upsert(
      {
        agent_id: agentId,
        lead_id: leadId,
        ...payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agent_id,lead_id" }
    );

    if (error) {
      console.error("[crm-ai-backend] Falha ao atualizar ai_lead_state:", {
        agentId,
        leadId,
        payload,
        error,
      });
      throw buildSupabaseOperationError(
        error,
        "Nao foi possivel atualizar o estado da IA para o lead"
      );
    }
  }

  private async freezeLead(
    agent: AgentRow,
    leadId: string,
    pauseOrigin: "manual_send" | "human_webhook" | "ai_policy" | "manual_override",
    pauseReference?: string | null,
  ) {
    const freezeUntil = new Date(Date.now() + agent.human_pause_minutes * 60_000).toISOString();
    await this.upsertLeadState(agent.id, leadId, {
      freeze_until: freezeUntil,
      status: "paused",
      pause_origin: pauseOrigin,
      pause_reference: pauseReference ?? null,
      paused_at: new Date().toISOString(),
    });
    return freezeUntil;
  }

  private async createRun(payload: {
    agentId: string;
    leadId: string;
    messageHistoryIds?: string[];
    inputSnapshot?: JsonRecord;
    outputSnapshot?: JsonRecord;
    suggestedStageId?: string | null;
    appliedStageId?: string | null;
    confidence?: number | null;
    actionTaken?: "none" | "reply_only" | "stage_applied" | "manual_pause" | "failed" | "freeze_repair" | "crm_updated";
    error?: string | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
  }) {
    const { error } = await this.serviceClient.from("ai_runs").insert({
      agent_id: payload.agentId,
      lead_id: payload.leadId,
      message_history_ids: payload.messageHistoryIds ?? [],
      input_snapshot: payload.inputSnapshot ?? {},
      output_snapshot: payload.outputSnapshot ?? {},
      suggested_stage_id: payload.suggestedStageId ?? null,
      applied_stage_id: payload.appliedStageId ?? null,
      confidence: payload.confidence ?? null,
      action_taken: payload.actionTaken ?? "none",
      error: payload.error ?? null,
      tokens_in: payload.tokensIn ?? null,
      tokens_out: payload.tokensOut ?? null,
    });

    if (error) {
      throw new HttpError(500, "Nao foi possivel registrar a execucao da IA", error);
    }
  }

  private parseWebhookPayload(payload: WebhookPayload): ParsedWebhookMessage {
    const root = asRecord(payload);
    const data = asRecord(root.data);
    const key = asRecord(data.key);
    const message = asRecord(data.message);
    const messageContext = asRecord(root.message ?? data.messageData ?? data);
    const messageType =
      asString(data.messageType) ??
      asString(root.messageType) ??
      asString(messageContext.messageType);

    const instanceName =
      asString(root.instance) ??
      asString(root.instanceName) ??
      asString(data.instance) ??
      asString(data.instanceName) ??
      asString(asRecord(root.sender).instance) ??
      asString(asRecord(root.apikey).instance);

    const remoteJid = asString(key.remoteJid) ?? asString(data.remoteJid) ?? asString(root.remoteJid);
    const sender = asRecord(data.sender);
    const contact = asRecord(data.contact);
    const pushName = normalizeLeadDisplayName(
      asString(data.pushName) ??
        asString(data.pushname) ??
        asString(data.senderName) ??
        asString(data.notifyName) ??
        asString(data.verifiedBizName) ??
        asString(root.pushName) ??
        asString(root.senderName) ??
        asString(root.notifyName) ??
        asString(sender.pushName) ??
        asString(sender.name) ??
        asString(contact.pushName) ??
        asString(contact.name)
    );
    const messageId = asString(key.id) ?? asString(root.messageId) ?? asString(data.messageId);
    const fromMe = Boolean(key.fromMe ?? data.fromMe ?? root.fromMe);
    const sentAtRaw = data.messageTimestamp ?? root.messageTimestamp ?? root.timestamp ?? Date.now();
    const sentAt =
      typeof sentAtRaw === "number"
        ? new Date(sentAtRaw * (sentAtRaw > 1_000_000_000_000 ? 1 : 1000)).toISOString()
        : new Date(String(sentAtRaw)).toISOString();

    const phoneCandidate =
      asString(remoteJid)?.replace(/@.+$/, "") ??
      asString(data.sender) ??
      asString(root.sender) ??
      asString(root.from) ??
      asString(data.from);

    const textCandidates = [
      asString(message.conversation),
      asString(asRecord(message.extendedTextMessage).text),
      asString(asRecord(message.imageMessage).caption),
      asString(asRecord(message.videoMessage).caption),
      asString(asRecord(root.text).text),
      asString(root.body),
      asString(data.body),
      asString(messageContext.content),
    ].filter((item): item is string => Boolean(item));

    const imageMessage = asRecord(message.imageMessage);
    const audioMessage = asRecord(message.audioMessage);
    const documentMessage = asRecord(message.documentMessage);
    const sharedMediaBase64 =
      asString(message.base64) ??
      asString(messageContext.base64) ??
      asString(data.base64) ??
      asString(root.base64);
    const imageUrl =
      asString(imageMessage.url) ??
      asString(imageMessage.mediaUrl) ??
      asString(asRecord(root.image).url);
    const audioUrl =
      asString(audioMessage.url) ??
      asString(audioMessage.mediaUrl) ??
      asString(asRecord(root.audio).url) ??
      asString(documentMessage.url);
    const inferredAudio =
      messageType === "audioMessage" ||
      Object.keys(audioMessage).length > 0 ||
      (Object.keys(documentMessage).length > 0 &&
        ((asString(documentMessage.mimetype) ?? asString(documentMessage.mime_type) ?? "").startsWith("audio/")));
    const inferredImage = messageType === "imageMessage" || Object.keys(imageMessage).length > 0;
    const imageBase64 =
      asString(imageMessage.base64) ??
      asString(asRecord(root.image).base64) ??
      (inferredImage ? sharedMediaBase64 : null);
    const audioBase64 =
      asString(audioMessage.base64) ??
      asString(asRecord(root.audio).base64) ??
      asString(documentMessage.base64) ??
      (inferredAudio ? sharedMediaBase64 : null);
    const mediaKind =
      inferredAudio || audioBase64 || audioUrl
        ? "audio"
        : inferredImage || imageBase64 || imageUrl
          ? "image"
          : null;
    const mediaMimeType =
      asString(audioMessage.mimetype) ??
      asString(audioMessage.mime_type) ??
      asString(imageMessage.mimetype) ??
      asString(imageMessage.mime_type) ??
      asString(documentMessage.mimetype) ??
      asString(documentMessage.mime_type) ??
      (mediaKind === "audio" ? "audio/ogg" : mediaKind === "image" ? "image/jpeg" : null);

    if (!instanceName) {
      throw new HttpError(400, "Webhook sem instancia identificavel");
    }

    if (!phoneCandidate) {
      throw new HttpError(400, "Webhook sem telefone identificavel");
    }

    return {
      instanceName,
      fromMe,
      phone: phoneCandidate,
      content: textCandidates[0] ?? "",
      messageId,
      conversationId: remoteJid ?? phoneCandidate,
      sentAt,
      pushName,
      mediaKind,
      mediaMimeType,
      mediaBase64: audioBase64 ?? imageBase64 ?? null,
      mediaUrl: audioUrl ?? imageUrl ?? null,
      messageType,
      raw: root,
    };
  }

  private async normalizeInboundContent(message: ParsedWebhookMessage) {
    if (message.content.trim()) {
      return message.content.trim();
    }

    if (!message.mediaKind) {
      return "[mensagem sem texto]";
    }

    if (this.openai) {
      try {
        const normalized = await this.normalizeMediaWithOpenAi(message);
        if (normalized) {
          return normalized;
        }
      } catch (error) {
        console.warn("[crm-ai] Falha ao normalizar midia com OpenAI, usando fallback:", error);
      }
    }

    if (!this.gemini) {
      return message.mediaKind === "audio" ? "[audio recebido]" : "[imagem recebida]";
    }

    const mediaPart = await this.buildMediaPart(message);
    if (!mediaPart) {
      return message.mediaKind === "audio" ? "[audio recebido]" : "[imagem recebida]";
    }

    const modelName = this.crmAnalysisWorkerModel;
    const prompt =
      message.mediaKind === "audio"
        ? "Transcreva em portugues brasileiro o conteudo principal deste audio de WhatsApp. Responda apenas com o texto transcrito."
        : "Descreva de forma objetiva o conteudo principal desta imagem recebida no WhatsApp. Responda apenas com a descricao.";

    const { result } = await this.generateGeminiContent(modelName, [prompt, mediaPart]);
    return result.response.text().trim() || (message.mediaKind === "audio" ? "[audio recebido]" : "[imagem recebida]");
  }

  private async normalizeMediaWithOpenAi(message: ParsedWebhookMessage) {
    if (!this.openai) {
      return null;
    }

    if (message.mediaKind === "audio") {
      const media = await this.resolveMediaBytes(message);
      if (!media) {
        return null;
      }

      const extension = this.getFileExtensionFromMimeType(media.mimeType, "ogg");
      const file = await toFile(media.buffer, `whatsapp-audio.${extension}`, {
        type: media.mimeType,
      });
      const transcription = await this.openai.audio.transcriptions.create({
        file,
        model: this.openaiTranscriptionModel,
        language: "pt",
      });

      return transcription.text.trim() || "[audio recebido]";
    }

    if (message.mediaKind === "image") {
      const media = await this.resolveMediaBytes(message);
      if (!media) {
        return null;
      }

      const response = await this.openai.responses.create({
        model: this.openaiVisionModel,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Descreva de forma objetiva o conteudo principal desta imagem recebida no WhatsApp. Responda apenas com a descricao.",
              },
              {
                type: "input_image",
                image_url: `data:${media.mimeType};base64,${media.buffer.toString("base64")}`,
                detail: "auto",
              },
            ],
          },
        ],
      });

      return response.output_text.trim() || "[imagem recebida]";
    }

    return null;
  }

  private async buildMediaPart(message: ParsedWebhookMessage) {
    const media = await this.resolveMediaBytes(message);
    if (!media) {
      return null;
    }

    return {
      inlineData: {
        mimeType: media.mimeType,
        data: media.buffer.toString("base64"),
      },
    };
  }

  private async resolveMediaBytes(message: ParsedWebhookMessage) {
    const mimeType =
      message.mediaMimeType ??
      (message.mediaKind === "audio" ? "audio/ogg" : message.mediaKind === "image" ? "image/jpeg" : "application/octet-stream");

    if (message.mediaBase64) {
      const buffer = decodeBase64Payload(message.mediaBase64);
      if (buffer.length === 0 || isProbablyTextPayload(buffer)) {
        console.warn("[crm-ai] Base64 de midia invalido ou nao binario; tentando outras fontes");
      } else {
        return {
          mimeType,
          buffer,
        };
      }
    }

    if (message.mediaUrl) {
      const downloaded = await this.tryDownloadMediaUrl(message, mimeType);
      if (downloaded) {
        return downloaded;
      }
    }

    const evolutionMedia = await this.fetchMediaFromEvolution(message, mimeType);
    if (evolutionMedia) {
      return evolutionMedia;
    }

    return null;
  }

  private async tryDownloadMediaUrl(message: ParsedWebhookMessage, mimeType: string) {
    const mediaUrl = requireValue(message.mediaUrl, "URL de midia ausente");
    const attempts: Array<{ headers?: Record<string, string> }> = [{}];
    const transport = await this.resolveEvolutionTransport(message.instanceName);
    if (this.isSameUrlOrigin(mediaUrl, transport.apiUrl)) {
      attempts.push({ headers: this.evolutionHeaders(transport.apiKey) });
    }

    for (const attempt of attempts) {
      try {
        const response = await axios.get<ArrayBuffer>(mediaUrl, {
          responseType: "arraybuffer",
          headers: attempt.headers,
          timeout: 15000,
          validateStatus: (status) => status >= 200 && status < 300,
        });
        const buffer = Buffer.from(response.data);
        const responseMimeType = asString(response.headers["content-type"])?.split(";")[0] || mimeType;

        if (buffer.length === 0 || isProbablyTextPayload(buffer)) {
          console.warn("[crm-ai] Download de midia retornou conteudo invalido", {
            mediaUrl,
            contentType: response.headers["content-type"],
            bytes: buffer.length,
          });
          continue;
        }

        return {
          mimeType: responseMimeType,
          buffer,
        };
      } catch (error: any) {
        console.warn("[crm-ai] Falha ao baixar midia por URL", {
          mediaUrl,
          status: error?.response?.status,
          message: error?.message,
        });
      }
    }

    return null;
  }

  private async fetchMediaFromEvolution(message: ParsedWebhookMessage, mimeType: string) {
    if (!message.messageId) {
      return null;
    }

    const key = asRecord(asRecord(asRecord(message.raw).data).key);
    const requestMessage = {
      key: {
        id: message.messageId,
        remoteJid: asString(key.remoteJid) ?? message.conversationId ?? undefined,
        fromMe: typeof key.fromMe === "boolean" ? key.fromMe : message.fromMe,
      },
    };
    const transport = await this.resolveEvolutionTransport(message.instanceName);

    try {
      const { data } = await axios.post(
        `${transport.apiUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(transport.instanceName)}`,
        {
          message: requestMessage,
          convertToMp4: false,
        },
        {
          headers: this.evolutionHeaders(transport.apiKey),
          timeout: 20000,
        }
      );

      const base64 = this.extractBase64FromEvolutionResponse(data);
      if (!base64) {
        console.warn("[crm-ai] Evolution nao retornou base64 para a midia", { messageId: message.messageId });
        return null;
      }

      const buffer = decodeBase64Payload(base64);
      if (buffer.length === 0 || isProbablyTextPayload(buffer)) {
        console.warn("[crm-ai] Base64 retornado pela Evolution nao parece midia binaria", {
          messageId: message.messageId,
          bytes: buffer.length,
        });
        return null;
      }

      return {
        mimeType,
        buffer,
      };
    } catch (error: any) {
      console.warn("[crm-ai] Falha ao buscar midia na Evolution", {
        messageId: message.messageId,
        status: error?.response?.status,
        data: error?.response?.data,
        message: error?.message,
      });
    }

    return null;
  }

  private extractBase64FromEvolutionResponse(payload: unknown): string | null {
    if (typeof payload === "string") {
      return payload.trim().length > 0 ? payload : null;
    }

    if (!payload || typeof payload !== "object") {
      return null;
    }

    const record = payload as Record<string, unknown>;
    for (const key of ["base64", "media", "file", "data"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value;
      }
    }

    for (const value of Object.values(record)) {
      const nested = this.extractBase64FromEvolutionResponse(value);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  private isSameUrlOrigin(value: string, baseUrl: string) {
    try {
      return new URL(value).origin === new URL(baseUrl).origin;
    } catch {
      return false;
    }
  }

  private getFileExtensionFromMimeType(mimeType: string, fallback: string) {
    const normalized = mimeType.toLowerCase();
    if (normalized.includes("ogg")) return "ogg";
    if (normalized.includes("mpeg")) return "mpeg";
    if (normalized.includes("mp3")) return "mp3";
    if (normalized.includes("mp4")) return "mp4";
    if (normalized.includes("wav")) return "wav";
    if (normalized.includes("webm")) return "webm";
    if (normalized.includes("m4a")) return "m4a";
    if (normalized.includes("jpeg")) return "jpg";
    if (normalized.includes("png")) return "png";
    return fallback;
  }

  private async sendWhatsAppMessage(
    instanceName: string,
    phone: string,
    content: string,
    context?: {
      acesId?: number;
      leadId?: string | null;
      agentId?: string | null;
      sourceType?: string;
    }
  ) {
    const recipient = resolveWhatsappRecipient(phone);
    const transport = await this.resolveEvolutionTransport(instanceName, context?.acesId);

    try {
      await axios.post(
        `${transport.apiUrl}/message/sendText/${encodeURIComponent(transport.instanceName)}`,
        {
          number: recipient.jid,
          text: content,
          delay: 1000,
        },
        {
          headers: { apikey: transport.apiKey },
        }
      );
    } catch (error) {
      console.error("[crm-ai] Falha ao enviar mensagem na Evolution:", {
        acesId: context?.acesId ?? null,
        leadId: context?.leadId ?? null,
        agentId: context?.agentId ?? null,
        sourceType: context?.sourceType ?? null,
        instanceName,
        providerInstanceName: transport.instanceName,
        phoneRaw: phone,
        phoneNormalized: recipient.normalized,
        phoneFinal: recipient.finalNumber,
        phone: recipient.jid,
        error: axios.isAxiosError(error) ? error.response?.data ?? error.message : error,
      });
      throw buildExternalRequestError(error, "Falha ao enviar mensagem na Evolution");
    }
  }

  private async sendReplyBlocks(params: {
    agent: AgentRow;
    lead: LeadRow;
    blocks: string[];
    sourceType: "ai" | "human";
    createdBy?: string | null;
  }) {
    const blocks = params.blocks.map((item) => item.trim()).filter(Boolean);
    if (blocks.length === 0) {
      return;
    }

    const instanceName = params.agent.instance_name || params.lead.instancia;
    const phone = requireValue(params.lead.contact_phone, "Lead sem telefone para envio");
    const resolvedInstance = requireValue(instanceName, "Instancia de envio nao definida");
    const outboundOrigin: OutboundEchoOrigin = params.sourceType === "human" ? "manual" : "ai";

    for (const [index, block] of blocks.entries()) {
      const sentAt = new Date().toISOString();
      const conversationId = `${params.sourceType}:${Date.now()}:${index}`;

      await this.registerOutboundEcho({
        acesId: params.lead.aces_id,
        leadId: params.lead.id,
        origin: outboundOrigin,
        conversationId,
        referenceId: conversationId,
        instanceName: resolvedInstance,
        phone,
        content: block,
        sentAt,
      });

      await this.sendWhatsAppMessage(resolvedInstance, phone, block, {
        acesId: params.lead.aces_id,
        leadId: params.lead.id,
        agentId: params.agent.id,
        sourceType: params.sourceType,
      });

      await this.saveMessage({
        leadId: params.lead.id,
        acesId: params.lead.aces_id,
        content: block,
        direction: "outbound",
        sourceType: params.sourceType,
        instanceName: resolvedInstance,
        createdBy: params.createdBy ?? null,
        conversationId,
        sentAt,
      });

      if (index < blocks.length - 1) {
        await wait(900);
      }
    }
  }

  private getHandoffConfig(agent: AgentRow) {
    const instruction = asString(agent.handoff_prompt);
    const targetPhone = asString(agent.handoff_target_phone);

    return {
      enabled: Boolean(agent.handoff_enabled && instruction && targetPhone),
      instruction,
      targetPhone,
    };
  }

  private buildHandoffNotification(
    agent: AgentRow,
    lead: LeadRow,
    response: StructuredModelResponse,
    messages: MessageRow[]
  ) {
    const latestLeadMessage = [...messages]
      .reverse()
      .find((message) => message.source_type === "lead")?.content;

    const reason =
      response.handoff_reason.trim() ||
      response.reason.trim() ||
      "Condicao de handoff atendida pela IA.";

    return [
      "[Handoff IA]",
      `Agente: ${agent.name}`,
      `Instancia: ${agent.instance_name}`,
      `Lead: ${lead.name?.trim() || "Sem nome"}`,
      `Telefone: ${lead.contact_phone || "Nao informado"}`,
      lead.last_city ? `Cidade: ${lead.last_city}` : null,
      `Motivo: ${reason}`,
      latestLeadMessage
        ? `Ultima mensagem do lead: ${truncateText(latestLeadMessage, 500)}`
        : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  private async triggerHandoff(
    agent: AgentRow,
    lead: LeadRow,
    response: StructuredModelResponse,
    messages: MessageRow[]
  ): Promise<HandoffExecutionResult> {
    const config = this.getHandoffConfig(agent);

    if (!config.enabled || !config.targetPhone || !response.should_handoff) {
      return {
        triggered: false,
        targetPhone: null,
        reason: response.handoff_reason.trim(),
        notification: null,
      };
    }

    const notification = this.buildHandoffNotification(agent, lead, response, messages);
    await this.sendWhatsAppMessage(agent.instance_name, config.targetPhone, notification, {
      acesId: agent.aces_id,
      leadId: lead.id,
      agentId: agent.id,
      sourceType: "handoff",
    });

    return {
      triggered: true,
      targetPhone: config.targetPhone,
      reason:
        response.handoff_reason.trim() ||
        response.reason.trim() ||
        "Condicao de handoff atendida pela IA.",
      notification,
    };
  }

  private async classifyConversation(
    agent: AgentRow,
    lead: LeadRow,
    rules: Array<{ stage: StageRow; rule: StageRuleRow }>,
    tags: TagRow[],
    messages: MessageRow[]
  ): Promise<GeminiExecutionResult<StructuredModelResponse>> {
    const handoffConfig = this.getHandoffConfig(agent);
    const temporalContext = buildNativeTemporalContext();
    const conversation = messages
      .map((message) => `${message.source_type === "lead" ? "Lead" : "Operacao"}: ${truncateText(message.content, 600)}`)
      .join("\n");

    const stages = rules.map(({ stage, rule }) => ({
      id: stage.id,
      nome: stage.name,
      categoria: stage.category,
      prioridade: rule.priority,
      objetivo: rule.goal_description,
      sinais_positivos: rule.positive_signals,
      sinais_negativos: rule.negative_signals,
      exemplos: rule.example_phrases,
      terminal: rule.is_terminal,
    }));

    const tagCatalog = tags.map((tag) => ({
      id: tag.id,
      nome: tag.name,
      urgencia: tag.urgencia,
      quando_usar: tag.usage_description ?? "",
    }));

    const prompt = [
      "Voce e um worker interno de analise operacional do CRM.",
      "Sua tarefa nao e responder ao lead. Sua tarefa e analisar a conversa, sugerir decisoes estruturadas e auditar o motivo.",
      "O modelo do agente de atendimento e separado deste worker; nao use este worker para controlar o tom final da resposta enviada ao lead.",
      "",
      "Retorne JSON puro com as chaves: reply_blocks, stage_decision, tag_decisions, attendance_summary, lead_verification, native_followup, confidence, reason, should_apply_stage, should_pause, should_handoff, handoff_reason.",
      "reply_blocks deve ser sempre [] neste worker. A resposta ao lead sera gerada em chamada separada pelo modelo do agente de atendimento.",
      "stage_decision deve conter stage_id e reason.",
      "tag_decisions deve ser uma lista de objetos com tag_id, should_apply, reason e confidence. Use apenas ids de tags disponiveis e nunca crie tags novas.",
      "attendance_summary deve conter text, reason e confidence. text deve resumir o ultimo atendimento em ate 700 caracteres.",
      "lead_verification deve conter checked=true quando a conversa foi analisada.",
      "native_followup e uma ferramenta nativa e oculta de retorno do agente; ela existe para todos os agentes e nao depende de configuracao do usuario.",
      "native_followup deve conter should_schedule, needs_clarification, scheduled_at, requested_text, message_text, confidence e reason.",
      "Use native_followup.should_schedule=true quando o lead pedir claramente para chamar depois, como daqui a pouco, amanha as 10, depois das 18, mais tarde ou semana que vem com horario/periodo claro.",
      "Use scheduled_at em ISO 8601 com offset do fuso America/Sao_Paulo. Nunca use datas passadas e nunca agende alem de 30 dias.",
      "Padroes: daqui a pouco = agora + 15 minutos; depois das 18 = hoje 18:00 se ainda nao passou, senao agora + 15 minutos; manha = 09:00; tarde = 14:00; noite/depois das 18 = 18:00.",
      "Se o lead disser apenas amanha ou semana que vem sem horario ou periodo claro, native_followup.needs_clarification=true, should_schedule=false e reply_blocks deve perguntar qual horario prefere.",
      `Mensagem padrao para message_text quando for agendar: ${AGENT_FOLLOWUP_DEFAULT_MESSAGE}`,
      "Aplique etapa apenas se houver confianca alta e se a etapa fizer sentido no funil existente.",
      "Aplique tags apenas quando a conversa bater claramente com o campo quando_usar da tag.",
      "should_handoff deve ser true apenas quando a condicao de handoff estiver claramente atendida.",
      "handoff_reason deve explicar objetivamente por que o handoff foi acionado. Se nao houver handoff, deixe handoff_reason vazio.",
      "",
      `Contexto temporal nativo: ${JSON.stringify(temporalContext)}`,
      "",
      `Agente de atendimento configurado: ${JSON.stringify({
        id: agent.id,
        nome: agent.name,
        modelo_resposta: agent.model,
        prompt: truncateText(agent.system_prompt, 3000),
      })}`,
      "",
      `Lead atual: ${JSON.stringify({
        id: lead.id,
        nome: lead.name,
        telefone: lead.contact_phone,
        status_atual: lead.status,
        stage_id_atual: lead.stage_id,
        cidade: lead.last_city,
      })}`,
      "",
      `Etapas disponiveis: ${JSON.stringify(stages)}`,
      "",
      `Tags disponiveis: ${JSON.stringify(tagCatalog)}`,
      "",
      `Configuracao de handoff: ${JSON.stringify({
        enabled: handoffConfig.enabled,
        instruction: handoffConfig.instruction ?? null,
        target_phone_configured: Boolean(handoffConfig.targetPhone),
      })}`,
      "",
      `Historico recente:\n${conversation}`,
    ].join("\n");

    const { result, modelName, usedFallback, attempt } = await this.generateGeminiContent(
      this.crmAnalysisWorkerModel,
      prompt
    );
    const text = result.response.text();
    const parsed = parseStructuredJson(text);
    const usage = asRecord((result.response as unknown as JsonRecord).usageMetadata);

    return {
      parsed,
      rawText: text,
      modelName,
      usedFallback,
      attempt,
      tokensIn: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : null,
      tokensOut: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null,
    };
  }

  private async generateAgentReply(
    agent: AgentRow,
    lead: LeadRow,
    messages: MessageRow[],
    analysis: StructuredModelResponse,
    executionContext: {
      nativeFollowupShouldSchedule: boolean;
      nativeFollowupNeedsClarification: boolean;
      handoffTriggered: boolean;
    }
  ): Promise<GeminiExecutionResult<ReplyModelResponse>> {
    const conversation = messages
      .map((message) => `${message.source_type === "lead" ? "Lead" : "Operacao"}: ${truncateText(message.content, 600)}`)
      .join("\n");

    const prompt = [
      agent.system_prompt,
      "",
      "Voce e o agente de atendimento que responde ao lead pelo WhatsApp.",
      "A analise operacional do CRM ja foi feita por um worker interno. Nao altere etapa, tags, resumo, check ou follow-up.",
      "Retorne JSON puro apenas com a chave reply_blocks.",
      "reply_blocks deve ser uma lista de 0 a 3 mensagens curtas, naturais e prontas para envio no WhatsApp.",
      "Se nao houver resposta util ou segura para enviar agora, retorne {\"reply_blocks\":[]}.",
      "Se houver handoff humano acionado, prefira nao responder ao lead, a menos que a propria conversa exija uma confirmacao curta.",
      "",
      `Lead atual: ${JSON.stringify({
        id: lead.id,
        nome: lead.name,
        telefone: lead.contact_phone,
        status_atual: lead.status,
        cidade: lead.last_city,
      })}`,
      "",
      `Analise operacional ja aplicada/avaliada: ${JSON.stringify({
        confidence: analysis.confidence,
        reason: analysis.reason,
        should_pause: analysis.should_pause,
        should_handoff: analysis.should_handoff,
        handoff_reason: analysis.handoff_reason,
        stage_decision: analysis.stage_decision,
        attendance_summary: analysis.attendance_summary,
        lead_verification: analysis.lead_verification,
        native_followup: analysis.native_followup,
        native_followup_should_schedule: executionContext.nativeFollowupShouldSchedule,
        native_followup_needs_clarification: executionContext.nativeFollowupNeedsClarification,
        handoff_triggered: executionContext.handoffTriggered,
      })}`,
      "",
      `Historico recente:\n${conversation}`,
    ].join("\n");

    const responseModel = agent.model?.trim() || AgentManager.DEFAULT_CUSTOMER_AGENT_MODEL;
    const { result, modelName, usedFallback, attempt } = await this.generateGeminiContent(responseModel, prompt);
    const text = result.response.text();
    const parsed = parseReplyJson(text);
    const usage = asRecord((result.response as unknown as JsonRecord).usageMetadata);

    return {
      parsed,
      rawText: text,
      modelName,
      usedFallback,
      attempt,
      tokensIn: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : null,
      tokensOut: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null,
    };
  }

  private async applyStageDecision(
    agent: AgentRow,
    lead: LeadRow,
    response: StructuredModelResponse,
    validStageIds: Set<string>
  ) {
    if (!response.should_apply_stage || !response.stage_decision.stage_id) {
      return {
        appliedStageId: null,
        changed: false,
        skippedReason: "stage_not_requested",
      };
    }

    if (!validStageIds.has(response.stage_decision.stage_id)) {
      return {
        appliedStageId: null,
        changed: false,
        skippedReason: "invalid_stage_id",
      };
    }

    if (response.confidence < agent.auto_apply_threshold) {
      return {
        appliedStageId: null,
        changed: false,
        skippedReason: "below_threshold",
      };
    }

    if (lead.stage_id === response.stage_decision.stage_id) {
      return {
        appliedStageId: lead.stage_id,
        changed: false,
        skippedReason: "already_in_stage",
      };
    }

    const { error } = await this.serviceClient.rpc("service_move_lead_to_stage", {
      p_lead_id: lead.id,
      p_stage_id: response.stage_decision.stage_id,
      p_aces_id: lead.aces_id,
    });

    if (error) {
      throw new HttpError(500, "Nao foi possivel mover o lead de etapa pela IA", error);
    }

    await this.upsertLeadState(agent.id, lead.id, {
      last_classified_stage_id: response.stage_decision.stage_id,
      last_confidence: response.confidence,
      status: response.should_pause ? "paused" : "active",
    });

    return {
      appliedStageId: response.stage_decision.stage_id,
      changed: true,
      skippedReason: null,
    };
  }

  private async applyCrmDecisions(params: {
    agent: AgentRow;
    lead: LeadRow;
    response: StructuredModelResponse;
    tags: TagRow[];
    validStageIds: Set<string>;
  }): Promise<CrmDecisionApplication> {
    const { agent, lead, response, tags, validStageIds } = params;
    const checkedAt = new Date().toISOString();
    const stageResult = await this.applyStageDecision(agent, lead, response, validStageIds);
    const tagById = new Map(tags.map((tag) => [tag.id, tag]));
    const selectedTagIds = new Set<string>();
    const rejectedTagIds = new Set<string>();
    const skippedTagDecisions: JsonRecord[] = [];

    for (const decision of response.tag_decisions) {
      if (!decision.tag_id || !tagById.has(decision.tag_id)) {
        if (decision.tag_id) {
          rejectedTagIds.add(decision.tag_id);
        }
        skippedTagDecisions.push({
          tag_id: decision.tag_id,
          reason: "invalid_tag_id",
          model_reason: decision.reason,
          confidence: decision.confidence,
        });
        continue;
      }

      if (!decision.should_apply) {
        skippedTagDecisions.push({
          tag_id: decision.tag_id,
          reason: "not_requested",
          model_reason: decision.reason,
          confidence: decision.confidence,
        });
        continue;
      }

      if (decision.confidence < agent.auto_apply_threshold) {
        rejectedTagIds.add(decision.tag_id);
        skippedTagDecisions.push({
          tag_id: decision.tag_id,
          reason: "below_threshold",
          model_reason: decision.reason,
          confidence: decision.confidence,
        });
        continue;
      }

      selectedTagIds.add(decision.tag_id);
    }

    const appliedTagIds = Array.from(selectedTagIds);
    if (appliedTagIds.length > 0) {
      const { error } = await this.serviceClient
        .from("lead_tags")
        .upsert(
          appliedTagIds.map((tagId) => ({
            lead_id: lead.id,
            tag_id: tagId,
          })),
          { onConflict: "lead_id,tag_id", ignoreDuplicates: true }
        );

      if (error) {
        throw new HttpError(500, "Nao foi possivel aplicar as tags sugeridas pela IA", error);
      }
    }

    const nextNotes = upsertAiSummaryBlock(
      lead.notes,
      response.attendance_summary.text,
      checkedAt
    );
    const summaryUpdated = nextNotes !== (lead.notes ?? null);

    const leadUpdate: JsonRecord = {
      check: checkedAt,
      updated_at: checkedAt,
    };

    if (summaryUpdated) {
      leadUpdate.notes = nextNotes;
    }

    const { error: leadUpdateError } = await this.serviceClient
      .from("leads")
      .update(leadUpdate)
      .eq("id", lead.id)
      .eq("aces_id", lead.aces_id);

    if (leadUpdateError) {
      throw new HttpError(
        500,
        "Nao foi possivel atualizar resumo/verificacao do lead pela IA",
        leadUpdateError
      );
    }

    const audit = {
      stage: {
        suggested_stage_id: response.stage_decision.stage_id,
        applied_stage_id: stageResult.appliedStageId,
        changed: stageResult.changed,
        skipped_reason: stageResult.skippedReason,
        reason: response.stage_decision.reason,
        confidence: response.confidence,
      },
      tags: {
        applied_tag_ids: appliedTagIds,
        rejected_tag_ids: Array.from(rejectedTagIds),
        skipped: skippedTagDecisions,
      },
      attendance_summary: {
        updated: summaryUpdated,
        reason: response.attendance_summary.reason,
        confidence: response.attendance_summary.confidence,
      },
      lead_verification: {
        checked_at: checkedAt,
        reason: response.lead_verification.reason,
      },
    };

    return {
      appliedStageId: stageResult.appliedStageId,
      stageChanged: stageResult.changed,
      appliedTagIds,
      rejectedTagIds: Array.from(rejectedTagIds),
      summaryUpdated,
      leadCheckedAt: checkedAt,
      changed: stageResult.changed || appliedTagIds.length > 0 || summaryUpdated || Boolean(checkedAt),
      audit,
    };
  }

  private async applyNativeFollowup(params: {
    agent: AgentRow;
    lead: LeadRow;
    response: StructuredModelResponse;
    latestInbound: LatestLeadInboundMessage | null;
  }): Promise<NativeFollowupApplication> {
    const { agent, lead, response, latestInbound } = params;
    const decision = response.native_followup;
    const latestLeadText = latestInbound?.content ?? decision.requested_text;
    const needsClarification =
      decision.needs_clarification || leadMessageNeedsFollowupTimeClarification(latestLeadText);

    if (needsClarification) {
      return {
        scheduled: false,
        taskId: null,
        dueAt: null,
        duplicated: false,
        needsClarification: true,
        skippedReason: "needs_clarification",
        audit: {
          requested_text: decision.requested_text || latestLeadText,
          reason: decision.reason,
          confidence: decision.confidence,
        },
      };
    }

    if (!decision.should_schedule) {
      return {
        scheduled: false,
        taskId: null,
        dueAt: null,
        duplicated: false,
        needsClarification: false,
        skippedReason: "not_requested",
        audit: {
          requested_text: decision.requested_text,
          reason: decision.reason,
          confidence: decision.confidence,
        },
      };
    }

    if (decision.confidence < AGENT_FOLLOWUP_MIN_CONFIDENCE) {
      return {
        scheduled: false,
        taskId: null,
        dueAt: null,
        duplicated: false,
        needsClarification: false,
        skippedReason: "below_threshold",
        audit: {
          requested_text: decision.requested_text || latestLeadText,
          reason: decision.reason,
          confidence: decision.confidence,
          threshold: AGENT_FOLLOWUP_MIN_CONFIDENCE,
        },
      };
    }

    if (!decision.scheduled_at) {
      return {
        scheduled: false,
        taskId: null,
        dueAt: null,
        duplicated: false,
        needsClarification: false,
        skippedReason: "scheduled_at_missing",
        audit: {
          requested_text: decision.requested_text || latestLeadText,
          reason: decision.reason,
          confidence: decision.confidence,
        },
      };
    }

    const dueAtMs = Date.parse(decision.scheduled_at);
    const now = new Date();
    const maxDueAt = addDays(now, AGENT_FOLLOWUP_MAX_DAYS);

    if (!Number.isFinite(dueAtMs)) {
      return {
        scheduled: false,
        taskId: null,
        dueAt: null,
        duplicated: false,
        needsClarification: false,
        skippedReason: "invalid_scheduled_at",
        audit: {
          scheduled_at: decision.scheduled_at,
          requested_text: decision.requested_text || latestLeadText,
          reason: decision.reason,
          confidence: decision.confidence,
        },
      };
    }

    const dueAt = new Date(dueAtMs);
    if (dueAt.getTime() <= now.getTime()) {
      return {
        scheduled: false,
        taskId: null,
        dueAt: dueAt.toISOString(),
        duplicated: false,
        needsClarification: false,
        skippedReason: "scheduled_at_in_past",
        audit: {
          scheduled_at: decision.scheduled_at,
          requested_text: decision.requested_text || latestLeadText,
          reason: decision.reason,
          confidence: decision.confidence,
        },
      };
    }

    if (dueAt.getTime() > maxDueAt.getTime()) {
      return {
        scheduled: false,
        taskId: null,
        dueAt: dueAt.toISOString(),
        duplicated: false,
        needsClarification: false,
        skippedReason: "beyond_max_horizon",
        audit: {
          scheduled_at: decision.scheduled_at,
          max_followup_days: AGENT_FOLLOWUP_MAX_DAYS,
          requested_text: decision.requested_text || latestLeadText,
          reason: decision.reason,
          confidence: decision.confidence,
        },
      };
    }

    const requestedMessageId = latestInbound?.id ?? null;
    const idempotencyKey = [
      "agent_followup",
      agent.id,
      lead.id,
      requestedMessageId ?? latestInbound?.sent_at ?? dueAt.toISOString(),
    ].join(":");
    const messageText = decision.message_text.trim() || AGENT_FOLLOWUP_DEFAULT_MESSAGE;

    const payload = {
      lead_id: lead.id,
      opportunity_id: null,
      aces_id: lead.aces_id,
      due_at: dueAt.toISOString(),
      completed: false,
      notes: "Follow-up nativo criado pelo agente IA",
      lead_name: lead.name,
      lead_phone: lead.contact_phone,
      created_by: agent.created_by,
      agent_id: agent.id,
      source: "agent_followup",
      status: "pending",
      idempotency_key: idempotencyKey,
      requested_message_id: requestedMessageId,
      requested_text: decision.requested_text || latestLeadText,
      message_text: messageText,
      metadata: {
        timezone: AGENT_FOLLOWUP_TIMEZONE,
        reason: decision.reason,
        confidence: decision.confidence,
        created_by_agent_name: agent.name,
        source: "native_followup",
      },
    };

    const { data, error } = await this.serviceClient
      .from("follow_up_tasks")
      .insert(payload)
      .select("id, due_at")
      .single();

    if (error) {
      if (isSupabaseUniqueViolation(error)) {
        const { data: existing, error: existingError } = await this.serviceClient
          .from("follow_up_tasks")
          .select("id, due_at")
          .eq("source", "agent_followup")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();

        if (existingError) {
          throw buildSupabaseOperationError(
            existingError,
            "Nao foi possivel consultar follow-up nativo ja existente"
          );
        }

        const existingRecord = asRecord(existing);
        return {
          scheduled: false,
          taskId: asString(existingRecord.id),
          dueAt: asString(existingRecord.due_at),
          duplicated: true,
          needsClarification: false,
          skippedReason: "duplicate_inbound",
          audit: {
            idempotency_key: idempotencyKey,
            requested_message_id: requestedMessageId,
            requested_text: decision.requested_text || latestLeadText,
            scheduled_at: dueAt.toISOString(),
            reason: decision.reason,
            confidence: decision.confidence,
          },
        };
      }

      throw buildSupabaseOperationError(error, "Nao foi possivel criar follow-up nativo do agente");
    }

    const record = asRecord(data);
    return {
      scheduled: true,
      taskId: asString(record.id),
      dueAt: asString(record.due_at) ?? dueAt.toISOString(),
      duplicated: false,
      needsClarification: false,
      skippedReason: null,
      audit: {
        idempotency_key: idempotencyKey,
        requested_message_id: requestedMessageId,
        requested_text: decision.requested_text || latestLeadText,
        message_text: messageText,
        scheduled_at: dueAt.toISOString(),
        reason: decision.reason,
        confidence: decision.confidence,
      },
    };
  }

  private async queueBufferedProcessing(agent: AgentRow, leadId: string, message: ParsedWebhookMessage) {
    const bufferKey = `crm-ai:buffer:${agent.id}:${leadId}`;
    if (this.redis) {
      await this.redis.rpush(bufferKey, JSON.stringify(message));
      const scheduleKey = `${bufferKey}:scheduled`;
      const scheduled = await this.redis.set(scheduleKey, "1", "PX", agent.buffer_wait_ms + 5000, "NX");
      if (scheduled === "OK") {
        setTimeout(() => {
          this.flushBufferedConversation(agent.id, leadId).catch((error) => {
            console.error("[crm-ai] Falha ao processar buffer Redis:", error);
          });
        }, agent.buffer_wait_ms);
      }
      return;
    }

    const entries = this.memoryBuffers.get(bufferKey) ?? [];
    entries.push(message);
    this.memoryBuffers.set(bufferKey, entries);

    if (this.memoryTimers.has(bufferKey)) {
      return;
    }

    const timer = setTimeout(() => {
      this.memoryTimers.delete(bufferKey);
      this.flushBufferedConversation(agent.id, leadId).catch((error) => {
        console.error("[crm-ai] Falha ao processar buffer em memoria:", error);
      });
    }, agent.buffer_wait_ms);

    this.memoryTimers.set(bufferKey, timer);
  }

  private async consumeBufferedEntries(agentId: string, leadId: string) {
    const bufferKey = `crm-ai:buffer:${agentId}:${leadId}`;

    if (this.redis) {
      const rawItems = await this.redis.lrange(bufferKey, 0, -1);
      await this.redis.del(bufferKey, `${bufferKey}:scheduled`);
      return rawItems.map((item) => JSON.parse(item) as ParsedWebhookMessage);
    }

    const items = this.memoryBuffers.get(bufferKey) ?? [];
    this.memoryBuffers.delete(bufferKey);
    return items;
  }

  private async flushBufferedConversation(agentId: string, leadId: string) {
    const agent = await this.getAgentById(agentId);
    const bufferedEntries = await this.consumeBufferedEntries(agentId, leadId);

    const lead = await this.loadLeadById(leadId, agent.aces_id, agent.created_by);
    const aiState = await this.resolveLeadAiState(lead.id, agent, lead.instancia);
    if (!aiState.enabled) {
      return;
    }

    const leadState = await this.getLeadState(agent.id, lead.id);
    const latestInbound = await this.fetchLatestLeadInboundMessage(lead.id);
    if (
      !this.shouldAnalyzeLead(
        latestInbound?.sent_at ?? null,
        leadState?.last_processed_message_at ?? null
      )
    ) {
      return;
    }

    const inactivityRemainingMs = this.getCrmAnalysisInactivityRemainingMs(latestInbound?.sent_at ?? null);
    if (inactivityRemainingMs > 0) {
      this.scheduleCrmAnalysisAfterInactivity(agent.id, lead.id, inactivityRemainingMs);
      return;
    }

    const rules = await this.getStageRulesForAgent(agent);
    const tags = await this.getTagsForAccount(agent.aces_id);
    const conversation = await this.fetchRecentConversation(lead.id);
    const temporalContext = buildNativeTemporalContext();
    const inboundMessages = bufferedEntries
      .map((entry) => entry.messageId)
      .filter((item): item is string => Boolean(item));
    if (inboundMessages.length === 0 && latestInbound?.id) {
      inboundMessages.push(latestInbound.id);
    }

    try {
      const result = await this.classifyConversation(agent, lead, rules, tags, conversation);
      const validStageIds = new Set(rules.map(({ stage }) => stage.id));
      const suggestedStageId =
        result.parsed.stage_decision.stage_id && validStageIds.has(result.parsed.stage_decision.stage_id)
          ? result.parsed.stage_decision.stage_id
          : null;
      const replyResult = await this.generateAgentReply(agent, lead, conversation, result.parsed, {
        nativeFollowupShouldSchedule: result.parsed.native_followup.should_schedule,
        nativeFollowupNeedsClarification: result.parsed.native_followup.needs_clarification,
        handoffTriggered: result.parsed.should_handoff,
      });
      result.parsed.reply_blocks = replyResult.parsed.reply_blocks;
      const crmApplication = await this.applyCrmDecisions({
        agent,
        lead,
        response: result.parsed,
        tags,
        validStageIds,
      });
      const nativeFollowupApplication = await this.applyNativeFollowup({
        agent,
        lead,
        response: result.parsed,
        latestInbound,
      });
      const handoffResult = await this.triggerHandoff(agent, lead, result.parsed, conversation);
      if (nativeFollowupApplication.needsClarification && result.parsed.reply_blocks.length === 0) {
        result.parsed.reply_blocks.push(AGENT_FOLLOWUP_CLARIFICATION_REPLY);
      } else if (nativeFollowupApplication.scheduled && result.parsed.reply_blocks.length === 0) {
        result.parsed.reply_blocks.push("Combinado. Vou te chamar no horario combinado por aqui.");
      }
      const shouldFreezeLead = result.parsed.should_pause || handoffResult.triggered;
      let freezeUntil: string | null = null;
      const processedAt = latestInbound?.sent_at ?? bufferedEntries[bufferedEntries.length - 1]?.sentAt ?? new Date().toISOString();
      const lastAiReplyAt = result.parsed.reply_blocks.length > 0 ? new Date().toISOString() : null;
      const tokensIn =
        result.tokensIn === null && replyResult.tokensIn === null
          ? null
          : (result.tokensIn ?? 0) + (replyResult.tokensIn ?? 0);
      const tokensOut =
        result.tokensOut === null && replyResult.tokensOut === null
          ? null
          : (result.tokensOut ?? 0) + (replyResult.tokensOut ?? 0);

      if (result.parsed.reply_blocks.length > 0) {
        await this.sendReplyBlocks({
          agent,
          lead,
          blocks: result.parsed.reply_blocks,
          sourceType: "ai",
        });
      }

      if (shouldFreezeLead) {
        freezeUntil = await this.freezeLead(
          agent,
          lead.id,
          "ai_policy",
          bufferedEntries[bufferedEntries.length - 1]?.messageId ?? null,
        );
        await this.upsertLeadState(agent.id, lead.id, {
          last_processed_message_at: processedAt,
          last_inbound_at: processedAt,
          last_ai_reply_at: lastAiReplyAt,
          last_classified_stage_id: crmApplication.appliedStageId ?? null,
          last_confidence: result.parsed.confidence,
          status: "paused",
        });
      } else {
        await this.upsertLeadState(agent.id, lead.id, {
          last_processed_message_at: processedAt,
          last_inbound_at: processedAt,
          last_ai_reply_at: lastAiReplyAt,
          last_classified_stage_id: crmApplication.appliedStageId ?? null,
          last_confidence: result.parsed.confidence,
          status: "active",
        });
      }

      await this.createRun({
        agentId: agent.id,
        leadId: lead.id,
        messageHistoryIds: inboundMessages,
        inputSnapshot: {
          lead,
          bufferedEntries,
          rules,
          tags,
          latest_inbound: latestInbound,
          previous_ai_state: leadState,
          temporal_context: temporalContext,
        },
        outputSnapshot: {
          raw_model_response: result.rawText,
          model_name: result.modelName,
          used_fallback_model: result.usedFallback,
          generation_attempt: result.attempt,
          analysis_raw_model_response: result.rawText,
          analysis_model_name: result.modelName,
          analysis_used_fallback_model: result.usedFallback,
          analysis_generation_attempt: result.attempt,
          reply_raw_model_response: replyResult.rawText,
          reply_model_name: replyResult.modelName,
          reply_used_fallback_model: replyResult.usedFallback,
          reply_generation_attempt: replyResult.attempt,
          structured: result.parsed,
          crm_application: crmApplication.audit,
          native_followup: {
            scheduled: nativeFollowupApplication.scheduled,
            task_id: nativeFollowupApplication.taskId,
            due_at: nativeFollowupApplication.dueAt,
            duplicated: nativeFollowupApplication.duplicated,
            needs_clarification: nativeFollowupApplication.needsClarification,
            skipped_reason: nativeFollowupApplication.skippedReason,
            audit: nativeFollowupApplication.audit,
          },
          handoff: handoffResult,
          freeze_until: freezeUntil,
        },
        suggestedStageId,
        appliedStageId: crmApplication.appliedStageId,
        confidence: result.parsed.confidence,
        actionTaken: crmApplication.stageChanged
          ? "stage_applied"
          : handoffResult.triggered
            ? "manual_pause"
            : result.parsed.reply_blocks.length > 0
              ? "reply_only"
              : crmApplication.changed
                ? "crm_updated"
                : "none",
        tokensIn,
        tokensOut,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida na execucao da IA";
      await this.upsertLeadState(agent.id, lead.id, {
        status: "error",
      });

      await this.createRun({
        agentId: agent.id,
        leadId: lead.id,
        messageHistoryIds: inboundMessages,
        inputSnapshot: {
          bufferedEntries,
        },
        outputSnapshot: {},
        actionTaken: "failed",
        error: message,
      });

      throw error;
    }
  }

  async processEvolutionWebhook(payload: WebhookPayload) {
    const event = asString(asRecord(payload).event)?.toLowerCase();
    if (event && event !== "messages.upsert") {
      return { ignored: true, reason: `Evento ${event} ignorado` };
    }

    if (this.isGroupWebhookPayload(payload)) {
      return { ignored: true, reason: "Mensagem de grupo ignorada" };
    }

    const parsedMessage = this.parseWebhookPayload(payload);
    const instance = await this.resolveInstanceForEvolutionWebhook(parsedMessage.instanceName);
    if (!instance) {
      return { ignored: true, reason: "Instancia nao cadastrada no CRM" };
    }

    const message: ParsedWebhookMessage = {
      ...parsedMessage,
      instanceName: instance.instancia,
      raw: {
        ...parsedMessage.raw,
        crm_local_instance: instance.instancia,
        crm_remote_instance: parsedMessage.instanceName,
      },
    };

    const agent = await this.getAnyAgentByInstance(message.instanceName, instance.aces_id);
    const normalizedContent = await this.normalizeInboundContent(message);
    const duplicated = await this.dedupeIncomingMessage(message.messageId);
    if (duplicated) {
      return { ignored: true, reason: "Mensagem duplicada" };
    }

    if (message.fromMe) {
      const matchedOutbound = await this.matchOutboundEcho(
        message.instanceName,
        message.phone,
        normalizedContent,
      );
      if (matchedOutbound) {
        const echoMessageId = await this.ensureOutboundEchoVisible({
          acesId: instance.aces_id,
          leadId: matchedOutbound.leadId,
          instanceName: message.instanceName,
          content: normalizedContent,
          sentAt: message.sentAt,
          conversationId: matchedOutbound.conversationId ?? message.conversationId,
          origin: matchedOutbound.origin,
        });
        await this.tryPersistWebhookMediaAttachment({
          acesId: instance.aces_id,
          leadId: matchedOutbound.leadId,
          messageId: echoMessageId,
          message,
        });

        if (matchedOutbound.origin !== "manual") {
          await this.repairAutomationFreezeForLead(
            matchedOutbound.leadId,
            `echo:${matchedOutbound.origin}:${matchedOutbound.referenceId ?? matchedOutbound.conversationId ?? message.messageId ?? "unknown"}`,
          );
        }

        return {
          ignored: true,
          reason:
            matchedOutbound.origin === "manual"
              ? "Echo de mensagem manual do backend"
              : matchedOutbound.origin === "automation"
                ? "Echo de mensagem da automacao ignorado"
                : matchedOutbound.origin === "calendar_followup"
                  ? "Echo de follow-up do calendario ignorado"
                  : "Echo de mensagem da IA ignorado",
        };
      }

      const lead = await this.findOrCreateLead(
        instance.aces_id,
        message.phone,
        message.instanceName,
        null,
        agent?.created_by ?? null
      );

      const fallbackMatch = await this.matchRecentOutboundMessageFallback(
        lead.id,
        message.instanceName,
        normalizedContent,
      );
      if (fallbackMatch) {
        await this.invalidateChatMessagesCache(instance.aces_id, lead.id);
        await this.tryPersistWebhookMediaAttachment({
          acesId: instance.aces_id,
          leadId: lead.id,
          messageId: fallbackMatch.messageId,
          message,
        });

        if (fallbackMatch.sourceType !== "manual") {
          await this.repairAutomationFreezeForLead(
            lead.id,
            `fallback_echo:${fallbackMatch.sourceType}:${fallbackMatch.conversationId ?? fallbackMatch.messageId ?? message.messageId ?? "unknown"}`,
          );
        }

        console.warn("[crm-ai] Echo outbound reconhecido via fallback local:", {
          leadId: lead.id,
          instanceName: message.instanceName,
          sourceType: fallbackMatch.sourceType,
          messageId: message.messageId,
          conversationId: fallbackMatch.conversationId,
        });

        return {
          ignored: true,
          reason:
            fallbackMatch.sourceType === "manual"
              ? "Echo de mensagem manual reconhecido por fallback"
              : fallbackMatch.sourceType === "automation"
                ? "Echo de mensagem da automacao reconhecido por fallback"
                : "Echo de mensagem da IA reconhecido por fallback",
        };
      }

      const savedMessage = await this.saveMessage({
        leadId: lead.id,
        acesId: instance.aces_id,
        content: normalizedContent,
        direction: "outbound",
        sourceType: "human",
        instanceName: message.instanceName,
        conversationId: message.conversationId,
        sentAt: message.sentAt,
      });
      await this.tryPersistWebhookMediaAttachment({
        acesId: instance.aces_id,
        leadId: lead.id,
        messageId: savedMessage.id,
        message,
      });

      const aiState = await this.resolveLeadAiState(lead.id, agent, message.instanceName);
      let freezeUntil: string | null = null;
      if (agent && aiState.reason !== "manual_off") {
        freezeUntil = await this.freezeLead(
          agent,
          lead.id,
          "human_webhook",
          message.messageId ?? message.conversationId ?? null,
        );
        await this.createRun({
          agentId: agent.id,
          leadId: lead.id,
          inputSnapshot: {
            reason: "manual_handoff_from_evolution",
            payload: message.raw,
          },
          outputSnapshot: {
            freeze_until: freezeUntil,
          },
          actionTaken: "manual_pause",
        });
      }

      return {
        success: true,
        leadId: lead.id,
        agentId: agent?.id ?? null,
        capturedOnly: !aiState.enabled,
        reason:
          freezeUntil
            ? "Handoff humano detectado"
            : aiState.reason === "manual_off"
              ? "Mensagem humana registrada com IA desligada para este lead"
              : aiState.reason === "global_inactive"
                ? "Mensagem humana registrada com agente global desligado"
                : aiState.reason === "no_agent"
                  ? "Mensagem humana registrada sem agente configurado"
                  : "Mensagem humana registrada",
        freezeUntil,
      };
    }

    const lead = await this.findOrCreateLead(
      instance.aces_id,
      message.phone,
      message.instanceName,
      message.pushName,
      agent?.created_by ?? null
    );
    const savedMessage = await this.saveMessage({
      leadId: lead.id,
      acesId: instance.aces_id,
      content: normalizedContent,
      direction: "inbound",
      sourceType: "lead",
      instanceName: message.instanceName,
      conversationId: message.conversationId,
      sentAt: message.sentAt,
    });
    await this.tryPersistWebhookMediaAttachment({
      acesId: instance.aces_id,
      leadId: lead.id,
      messageId: savedMessage.id,
      message,
    });

    const aiState = await this.resolveLeadAiState(lead.id, agent, message.instanceName);

    if (!agent || !aiState.enabled) {
      return {
        success: true,
        leadId: lead.id,
        queued: false,
        agentId: agent?.id ?? null,
        capturedOnly: true,
        reason:
          aiState.reason === "manual_off"
            ? "Mensagem registrada com IA desligada para este lead"
            : aiState.reason === "auto_pause"
              ? "Mensagem registrada com IA pausada por atendimento humano"
              : aiState.reason === "global_inactive"
                ? "Mensagem registrada com agente global desligado"
                : "Mensagem registrada sem agente configurado",
      };
    }

    await this.upsertLeadState(agent.id, lead.id, {
      last_inbound_at: message.sentAt,
      status: "active",
    });

    await this.queueBufferedProcessing(agent, lead.id, {
      ...message,
      content: normalizedContent,
      messageId: savedMessage.id,
    });

    return {
      success: true,
      leadId: lead.id,
      queued: true,
      agentId: agent.id,
      bypassingGlobalInactive: aiState.bypassingGlobalInactive,
    };
  }

  async createChatAttachmentUploadUrl(context: AuthContext, input: ChatAttachmentUploadUrlInput) {
    const leadId = String(input.leadId ?? "").trim();
    if (!isUuid(leadId)) {
      throw new HttpError(400, "leadId invalido");
    }

    const fileName = String(input.fileName ?? "").trim();
    if (!fileName) {
      throw new HttpError(400, "fileName e obrigatorio");
    }

    const mimeType = normalizeMimeType(String(input.mimeType ?? ""));
    const resolvedKind = resolveAttachmentKind(mimeType);
    if (!resolvedKind) {
      throw new HttpError(400, "MIME type nao permitido para anexos do chat");
    }

    if (input.kind !== resolvedKind) {
      throw new HttpError(400, "kind nao corresponde ao MIME type informado");
    }

    const fileSize = Number(input.fileSize);
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > CHAT_ATTACHMENT_MAX_FILE_SIZE) {
      throw new HttpError(400, "Tamanho do arquivo invalido para anexos do chat");
    }

    const lead = await this.loadLeadById(leadId, context.acesId, context.crmUserId);
    const instanceName = input.instanceName?.trim() || lead.instancia;
    if (!instanceName) {
      throw new HttpError(400, "Nenhuma instancia de envio foi definida para este lead");
    }

    await this.ensureInstanceOwnership(context.acesId, instanceName, context.crmUserId);

    const now = new Date();
    const messageId = randomUUID();
    const attachmentId = randomUUID();
    const intentId = randomUUID();
    const storagePath = buildAttachmentStoragePath({
      acesId: context.acesId,
      leadId,
      messageId,
      attachmentId,
      fileName,
    });
    const intentExpiresAt = addMinutes(now, this.chatUploadIntentTtlMinutes).toISOString();

    const { error: insertError } = await this.serviceClient
      .from("message_attachment_upload_intents")
      .insert({
        id: intentId,
        message_id: messageId,
        attachment_id: attachmentId,
        aces_id: context.acesId,
        lead_id: leadId,
        kind: resolvedKind,
        mime_type: mimeType,
        storage_bucket: CHAT_ATTACHMENTS_BUCKET,
        storage_path: storagePath,
        file_name: sanitizeStorageFileName(fileName),
        file_size: Math.floor(fileSize),
        status: "issued",
        intent_expires_at: intentExpiresAt,
      });

    if (insertError) {
      throw new HttpError(500, "Nao foi possivel registrar a intencao de upload", insertError);
    }

    const { data, error } = await this.serviceClient.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data?.signedUrl) {
      await this.markUploadIntentStatus(intentId, "failed");
      throw new HttpError(500, "Nao foi possivel gerar URL assinada de upload", error);
    }

    return {
      success: true,
      bucket: CHAT_ATTACHMENTS_BUCKET,
      storagePath,
      messageId,
      attachmentId,
      uploadUrl: data.signedUrl,
      uploadToken: data.token,
      intentExpiresAt,
      maxFileSize: CHAT_ATTACHMENT_MAX_FILE_SIZE,
      mimeType,
      kind: resolvedKind,
    };
  }

  async listChatMessages(context: AuthContext, leadIdInput: string) {
    const leadId = String(leadIdInput ?? "").trim();
    if (!isUuid(leadId)) {
      throw new HttpError(400, "leadId invalido");
    }

    const lead = await this.loadLeadById(leadId, context.acesId, context.crmUserId);
    const cacheKey = this.chatMessagesCacheKey(context.acesId, lead.id);

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          try {
            return { success: true, messages: JSON.parse(cached) as ChatMessageResponse[] };
          } catch {
            await this.redis.del(cacheKey);
          }
        }
      } catch (error) {
        console.warn("[crm-ai] Falha ao consultar cache de mensagens do chat:", {
          acesId: context.acesId,
          leadId: lead.id,
          error: extractExternalErrorMessage(error) ?? (error instanceof Error ? error.message : error),
        });
      }
    }

    const { data: messagesData, error: messagesError } = await this.serviceClient
      .from("message_history")
      .select(
        "id, lead_id, aces_id, content, direction, source_type, instance, created_by, sent_at, conversation_id, provider_status"
      )
      .eq("lead_id", lead.id)
      .eq("aces_id", context.acesId)
      .order("sent_at", { ascending: true })
      .order("id", { ascending: true });

    if (messagesError) {
      throw new HttpError(500, "Nao foi possivel carregar mensagens do chat", messagesError);
    }

    const messages = (messagesData ?? []) as MessageRow[];
    const messageIds = messages.map((message) => message.id);
    const createdByIds = Array.from(
      new Set(messages.map((message) => message.created_by).filter((value): value is string => Boolean(value)))
    );
    const userNames = new Map<string, string | null>();

    if (createdByIds.length > 0) {
      const { data: usersData, error: usersError } = await this.serviceClient
        .from("users")
        .select("id, name")
        .in("id", createdByIds);

      if (usersError) {
        throw new HttpError(500, "Nao foi possivel carregar remetentes do chat", usersError);
      }

      for (const user of (usersData ?? []) as Array<{ id: string; name: string | null }>) {
        userNames.set(user.id, user.name);
      }
    }

    const attachmentsByMessageId = new Map<string, ChatMessageAttachmentResponse[]>();
    if (messageIds.length > 0) {
      const { data: attachmentsData, error: attachmentsError } = await this.serviceClient
        .from("message_attachments")
        .select("id, message_id, kind, mime_type, file_name, file_size, storage_path, expires_at, storage_deleted_at")
        .eq("lead_id", lead.id)
        .eq("aces_id", context.acesId)
        .in("message_id", messageIds)
        .order("created_at", { ascending: true });

      if (attachmentsError) {
        throw new HttpError(500, "Nao foi possivel carregar anexos do chat", attachmentsError);
      }

      const nowMs = Date.now();
      for (const attachment of (attachmentsData ?? []) as MessageAttachmentRow[]) {
        const expired = attachment.expires_at ? new Date(attachment.expires_at).getTime() <= nowMs : false;
        let downloadUrl: string | null = null;

        if (!attachment.storage_deleted_at && !expired) {
          try {
            downloadUrl = await this.createSignedDownloadUrl(attachment.storage_path);
          } catch (error) {
            console.warn("[crm-ai] Falha ao gerar URL assinada de anexo do chat:", {
              attachmentId: attachment.id,
              messageId: attachment.message_id,
              error: extractExternalErrorMessage(error) ?? (error instanceof Error ? error.message : error),
            });
          }
        }

        const current = attachmentsByMessageId.get(attachment.message_id) ?? [];
        current.push({
          id: attachment.id,
          kind: attachment.kind,
          mimeType: attachment.mime_type,
          fileName: attachment.file_name ?? "attachment",
          fileSize: attachment.file_size ?? 0,
          downloadUrl,
          expiresAt: attachment.expires_at,
          storageDeletedAt: attachment.storage_deleted_at,
        });
        attachmentsByMessageId.set(attachment.message_id, current);
      }
    }

    const responseMessages: ChatMessageResponse[] = messages.map((message) => ({
      id: message.id,
      leadId: message.lead_id,
      content: message.content,
      direction: message.direction,
      directionCode: message.direction.toLowerCase() === "outbound" ? 2 : 1,
      sentAt: message.sent_at,
      leadName: lead.name ?? "",
      senderName: message.created_by ? userNames.get(message.created_by) ?? null : null,
      providerStatus: message.provider_status ?? null,
      attachments: attachmentsByMessageId.get(message.id) ?? [],
    }));

    const latestMessageSentAtMs = messages.reduce((latest, message) => {
      const sentAtMs = Date.parse(message.sent_at);
      return Number.isFinite(sentAtMs) ? Math.max(latest, sentAtMs) : latest;
    }, 0);
    const shouldSkipCache =
      latestMessageSentAtMs > 0 &&
      Math.abs(Date.now() - latestMessageSentAtMs) < AgentManager.CHAT_RECENT_MESSAGE_CACHE_BYPASS_MS;

    if (this.redis && !shouldSkipCache) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(responseMessages), "EX", this.chatCacheTtlSeconds);
      } catch (error) {
        console.warn("[crm-ai] Falha ao gravar cache de mensagens do chat:", {
          acesId: context.acesId,
          leadId: lead.id,
          error: extractExternalErrorMessage(error) ?? (error instanceof Error ? error.message : error),
        });
      }
    }

    return { success: true, messages: responseMessages };
  }

  private async loadIssuedUploadIntent(params: {
    acesId: number;
    leadId: string;
    messageId: string;
    attachmentId: string;
    storagePath: string;
  }) {
    const { data, error } = await this.serviceClient
      .from("message_attachment_upload_intents")
      .select(
        "id, message_id, attachment_id, aces_id, lead_id, kind, mime_type, storage_bucket, storage_path, file_name, file_size, status, intent_expires_at"
      )
      .eq("aces_id", params.acesId)
      .eq("lead_id", params.leadId)
      .eq("message_id", params.messageId)
      .eq("attachment_id", params.attachmentId)
      .eq("storage_path", params.storagePath)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel validar a intencao de upload", error);
    }

    if (!data) {
      throw new HttpError(404, "Intencao de upload nao encontrada");
    }

    const intent = data as UploadIntentRow;
    if (intent.status !== "issued") {
      throw new HttpError(409, "Intencao de upload nao esta disponivel para envio");
    }

    if (new Date(intent.intent_expires_at).getTime() <= Date.now()) {
      await this.markUploadIntentStatus(intent.id, "expired");
      throw new HttpError(410, "Intencao de upload expirada");
    }

    return intent;
  }

  private async markUploadIntentStatus(
    intentId: string,
    status: UploadIntentRow["status"]
  ) {
    const { error } = await this.serviceClient
      .from("message_attachment_upload_intents")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", intentId);

    if (error) {
      throw new HttpError(500, "Nao foi possivel atualizar a intencao de upload", error);
    }
  }

  private async messageHasAttachment(messageId: string) {
    const { data, error } = await this.serviceClient
      .from("message_attachments")
      .select("id")
      .eq("message_id", messageId)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel verificar anexos existentes da mensagem", error);
    }

    return Boolean(data);
  }

  private getDefaultWebhookMediaMimeType(kind: "audio" | "image") {
    return kind === "audio" ? "audio/ogg" : "image/jpeg";
  }

  private getWebhookMediaFileName(message: ParsedWebhookMessage, mimeType: string) {
    const data = asRecord(message.raw.data);
    const payloadMessage = asRecord(data.message);
    const mediaPayload =
      message.mediaKind === "audio"
        ? asRecord(payloadMessage.audioMessage)
        : asRecord(payloadMessage.imageMessage);
    const documentPayload = asRecord(payloadMessage.documentMessage);
    const providedFileName =
      asString(mediaPayload.fileName) ??
      asString(mediaPayload.file_name) ??
      asString(documentPayload.fileName) ??
      asString(documentPayload.file_name);

    if (providedFileName) {
      return providedFileName;
    }

    const extension = this.getFileExtensionFromMimeType(
      mimeType,
      message.mediaKind === "audio" ? "ogg" : "jpg"
    );
    const messageSuffix = message.messageId ? sanitizeStorageFileName(message.messageId) : String(Date.now());
    return `whatsapp-${message.mediaKind}-${messageSuffix}.${extension}`;
  }

  private async insertStoredMessageAttachment(params: {
    attachmentId: string;
    messageId: string;
    acesId: number;
    leadId: string;
    kind: ChatAttachmentKind;
    mimeType: string;
    storagePath: string;
    fileName: string;
    fileSize: number;
  }) {
    const { error } = await this.serviceClient
      .from("message_attachments")
      .insert({
        id: params.attachmentId,
        message_id: params.messageId,
        aces_id: params.acesId,
        lead_id: params.leadId,
        kind: params.kind,
        mime_type: params.mimeType,
        storage_bucket: CHAT_ATTACHMENTS_BUCKET,
        storage_path: params.storagePath,
        file_name: params.fileName,
        file_size: params.fileSize,
        expires_at:
          params.kind === "image"
            ? addDays(new Date(), CHAT_IMAGE_RETENTION_DAYS).toISOString()
            : null,
      });

    if (error) {
      throw new HttpError(500, "Nao foi possivel registrar o anexo da mensagem", error);
    }
  }

  private async persistWebhookMediaAttachment(params: {
    acesId: number;
    leadId: string;
    messageId: string;
    message: ParsedWebhookMessage;
  }) {
    const mediaKind = params.message.mediaKind;
    if (!mediaKind) {
      return null;
    }

    const alreadyHasAttachment = await this.messageHasAttachment(params.messageId);
    if (alreadyHasAttachment) {
      return null;
    }

    const media = await this.resolveMediaBytes(params.message);
    if (!media) {
      return null;
    }

    const normalizedMediaMimeType = normalizeMimeType(media.mimeType);
    const normalizedPayloadMimeType = normalizeMimeType(params.message.mediaMimeType ?? "");
    const resolvedMediaKind = resolveAttachmentKind(normalizedMediaMimeType);
    const resolvedPayloadKind = resolveAttachmentKind(normalizedPayloadMimeType);
    const mimeType =
      resolvedMediaKind === mediaKind
        ? normalizedMediaMimeType
        : resolvedPayloadKind === mediaKind
          ? normalizedPayloadMimeType
          : this.getDefaultWebhookMediaMimeType(mediaKind);

    if (resolveAttachmentKind(mimeType) !== mediaKind) {
      throw new HttpError(400, "MIME type de midia do webhook nao permitido para anexos do chat");
    }

    const fileSize = media.buffer.byteLength;
    if (fileSize <= 0 || fileSize > CHAT_ATTACHMENT_MAX_FILE_SIZE) {
      throw new HttpError(400, "Tamanho da midia do webhook invalido para anexos do chat");
    }

    const attachmentId = randomUUID();
    const fileName = sanitizeStorageFileName(this.getWebhookMediaFileName(params.message, mimeType));
    const storagePath = buildAttachmentStoragePath({
      acesId: params.acesId,
      leadId: params.leadId,
      messageId: params.messageId,
      attachmentId,
      fileName,
    });

    const { error: uploadError } = await this.serviceClient.storage
      .from(CHAT_ATTACHMENTS_BUCKET)
      .upload(storagePath, media.buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      throw new HttpError(500, "Nao foi possivel salvar midia do webhook no Storage", uploadError);
    }

    await this.insertStoredMessageAttachment({
      attachmentId,
      messageId: params.messageId,
      acesId: params.acesId,
      leadId: params.leadId,
      kind: mediaKind,
      mimeType,
      storagePath,
      fileName,
      fileSize,
    });
    await this.invalidateChatMessagesCache(params.acesId, params.leadId);

    return attachmentId;
  }

  private async tryPersistWebhookMediaAttachment(params: {
    acesId: number;
    leadId: string | null;
    messageId: string | null;
    message: ParsedWebhookMessage;
  }) {
    if (!params.leadId || !params.messageId || !params.message.mediaKind) {
      return null;
    }

    try {
      return await this.persistWebhookMediaAttachment({
        acesId: params.acesId,
        leadId: params.leadId,
        messageId: params.messageId,
        message: params.message,
      });
    } catch (error) {
      console.warn("[crm-ai] Falha ao persistir midia do webhook no chat:", {
        acesId: params.acesId,
        leadId: params.leadId,
        messageId: params.message.messageId ?? params.messageId,
        mediaKind: params.message.mediaKind,
        error: extractExternalErrorMessage(error) ?? (error instanceof Error ? error.message : error),
      });
      return null;
    }
  }

  private async insertMessageAttachment(params: {
    attachmentId: string;
    messageId: string;
    acesId: number;
    leadId: string;
    intent: UploadIntentRow;
  }) {
    const { error } = await this.serviceClient
      .from("message_attachments")
      .insert({
        id: params.attachmentId,
        message_id: params.messageId,
        aces_id: params.acesId,
        lead_id: params.leadId,
        kind: params.intent.kind,
        mime_type: params.intent.mime_type,
        storage_bucket: CHAT_ATTACHMENTS_BUCKET,
        storage_path: params.intent.storage_path,
        file_name: params.intent.file_name,
        file_size: params.intent.file_size,
        expires_at:
          params.intent.kind === "image"
            ? addDays(new Date(), CHAT_IMAGE_RETENTION_DAYS).toISOString()
            : null,
      });

    if (error) {
      throw new HttpError(500, "Nao foi possivel registrar o anexo da mensagem", error);
    }
  }

  private buildManualFallbackAgent(context: AuthContext, instanceName: string): AgentRow {
    return {
      id: "manual",
      aces_id: context.acesId,
      instance_name: instanceName,
      name: "Envio manual",
      system_prompt: DEFAULT_SYSTEM_MESSAGE,
      provider: "gemini",
      model: AgentManager.DEFAULT_CUSTOMER_AGENT_MODEL,
      is_active: false,
      buffer_wait_ms: 15000,
      human_pause_minutes: 60,
      auto_apply_threshold: 0.85,
      handoff_enabled: false,
      handoff_prompt: null,
      handoff_target_phone: null,
      created_by: context.crmUserId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private async pauseAgentAfterManualSend(params: {
    context: AuthContext;
    configuredAgent: AgentRow | null;
    lead: LeadRow;
    aiState: { reason: LeadAiReason } | null;
  }) {
    if (!params.configuredAgent || params.aiState?.reason === "manual_off") {
      return;
    }

    const freezeUntil = await this.freezeLead(
      params.configuredAgent,
      params.lead.id,
      "manual_send",
      params.context.crmUserId,
    );
    await this.createRun({
      agentId: params.configuredAgent.id,
      leadId: params.lead.id,
      inputSnapshot: {
        source: "manual_send",
        crm_user_id: params.context.crmUserId,
      },
      outputSnapshot: {
        freeze_until: freezeUntil,
      },
      actionTaken: "manual_pause",
    });
  }

  private async sendManualAttachmentMessage(params: {
    context: AuthContext;
    lead: LeadRow;
    instanceName: string;
    configuredAgent: AgentRow | null;
    aiState: { reason: LeadAiReason } | null;
    content: string;
    attachment: ChatAttachmentSendInput;
  }) {
    const attachment = params.attachment;
    if (!isUuid(attachment.messageId) || !isUuid(attachment.attachmentId)) {
      throw new HttpError(400, "Identificadores do anexo invalidos");
    }

    const mimeType = normalizeMimeType(attachment.mimeType);
    const resolvedKind = resolveAttachmentKind(mimeType);
    if (!resolvedKind || resolvedKind !== attachment.kind) {
      throw new HttpError(400, "MIME type do anexo invalido");
    }

    const intent = await this.loadIssuedUploadIntent({
      acesId: params.context.acesId,
      leadId: params.lead.id,
      messageId: attachment.messageId,
      attachmentId: attachment.attachmentId,
      storagePath: attachment.storagePath,
    });

    if (
      intent.kind !== attachment.kind ||
      intent.mime_type !== mimeType ||
      intent.file_size !== Math.floor(Number(attachment.fileSize)) ||
      intent.file_name !== sanitizeStorageFileName(attachment.fileName)
    ) {
      throw new HttpError(400, "Dados do anexo nao conferem com a intencao de upload");
    }

    await this.assertStorageObjectExists(intent.storage_path);
    const mediaUrl = await this.createSignedDownloadUrl(intent.storage_path);
    const phone = requireValue(params.lead.contact_phone, "Lead sem telefone para envio");
    const caption = params.content.trim();
    const messageContent = buildAttachmentContent(intent.kind, caption);
    const sentAt = new Date().toISOString();
    const conversationId = `manual-media:${Date.now()}`;
    const providerInput: SendMediaInput = {
      instanceName: params.instanceName,
      to: phone,
      mediaUrl,
      mimeType: intent.mime_type,
      fileName: intent.file_name,
      kind: intent.kind,
      caption: caption || null,
      sourceType: "manual",
    };

    let providerResult: SendResult;
    try {
      const transport = await this.resolveEvolutionTransport(params.instanceName, params.context.acesId);
      const provider = new EvolutionWhatsAppProvider({
        evolutionApiUrl: transport.apiUrl,
        evolutionApiKey: transport.apiKey,
      });
      providerResult = await provider.sendMedia({
        ...providerInput,
        instanceName: transport.instanceName,
      });
    } catch (error) {
      const providerFailure = summarizeWhatsAppProviderFailure(error);
      await this.saveMessage({
        id: intent.message_id,
        leadId: params.lead.id,
        acesId: params.context.acesId,
        content: messageContent,
        direction: "outbound",
        sourceType: "human",
        instanceName: params.instanceName,
        createdBy: params.context.crmUserId,
        conversationId,
        sentAt,
        provider: "evolution",
        providerMessageId: null,
        providerStatus: "failed",
        providerErrorCode: providerFailure.errorCode,
        providerErrorMessage: providerFailure.errorMessage,
        providerPayloadSummary: providerFailure.payloadSummary,
      });
      await this.insertMessageAttachment({
        attachmentId: intent.attachment_id,
        messageId: intent.message_id,
        acesId: params.context.acesId,
        leadId: params.lead.id,
        intent,
      });
      await this.markUploadIntentStatus(intent.id, "failed");
      await this.invalidateChatMessagesCache(params.context.acesId, params.lead.id);
      throw new HttpError(
        providerFailure.statusCode,
        `Falha ao enviar midia na Evolution: ${providerFailure.errorMessage}`,
        providerFailure.payloadSummary
      );
    }

    await this.saveMessage({
      id: intent.message_id,
      leadId: params.lead.id,
      acesId: params.context.acesId,
      content: messageContent,
      direction: "outbound",
      sourceType: "human",
      instanceName: params.instanceName,
      createdBy: params.context.crmUserId,
      conversationId,
      sentAt,
      provider: providerResult.provider,
      providerMessageId: providerResult.providerMessageId,
      providerStatus: providerResult.providerStatus,
      providerPayloadSummary: providerResult.raw ?? null,
    });
    await this.insertMessageAttachment({
      attachmentId: intent.attachment_id,
      messageId: intent.message_id,
      acesId: params.context.acesId,
      leadId: params.lead.id,
      intent,
    });
    await this.markUploadIntentStatus(intent.id, "consumed");
    await this.invalidateChatMessagesCache(params.context.acesId, params.lead.id);
    await this.pauseAgentAfterManualSend({
      context: params.context,
      configuredAgent: params.configuredAgent,
      lead: params.lead,
      aiState: params.aiState,
    });

    return { success: true, messageId: intent.message_id, attachmentId: intent.attachment_id };
  }

  async sendManualMessage(context: AuthContext, input: SendManualMessageInput) {
    const content = input.content?.trim() ?? "";
    if (!content && !input.attachment) {
      throw new HttpError(400, "Mensagem vazia");
    }

    const lead = await this.loadLeadById(input.leadId, context.acesId, context.crmUserId);
    const instanceName = input.instanceName?.trim() || lead.instancia;

    if (!instanceName) {
      throw new HttpError(400, "Nenhuma instancia de envio foi definida para este lead");
    }

    await this.ensureInstanceOwnership(context.acesId, instanceName, context.crmUserId);

    const configuredAgent = await this.getAnyAgentByInstance(instanceName, context.acesId, context.crmUserId);
    const aiState = configuredAgent
      ? await this.resolveLeadAiState(lead.id, configuredAgent, instanceName)
      : null;

    if (input.attachment) {
      return this.sendManualAttachmentMessage({
        context,
        lead,
        instanceName,
        configuredAgent,
        aiState,
        content,
        attachment: input.attachment,
      });
    }

    await this.sendReplyBlocks({
      agent: configuredAgent ?? this.buildManualFallbackAgent(context, instanceName),
      lead,
      blocks: [content],
      sourceType: "human",
      createdBy: context.crmUserId,
    });

    await this.pauseAgentAfterManualSend({ context, configuredAgent, lead, aiState });

    return { success: true };
  }

  async testHandoff(context: AuthContext, input: TestHandoffInput) {
    this.ensureAdmin(context);

    const instanceName = this.sanitizeInstanceName(input.instanceName);
    await this.ensureInstanceOwnership(context.acesId, instanceName, context.crmUserId);

    if (!input.targetPhone?.trim()) {
      throw new HttpError(400, "Numero do handoff e obrigatorio");
    }

    const recipient = resolveWhatsappRecipient(input.targetPhone);
    const message = [
      "Teste de handoff da IA",
      `Agente: ${input.agentName?.trim() || "Agente IA"}`,
      `Instancia: ${instanceName}`,
      input.handoffPrompt?.trim()
        ? `Regra configurada: ${truncateText(input.handoffPrompt.trim(), 280)}`
        : null,
      "Se voce recebeu esta mensagem, o envio do handoff esta funcionando.",
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    await this.sendWhatsAppMessage(instanceName, input.targetPhone, message, {
      acesId: context.acesId,
      sourceType: "handoff_test",
    });

    return {
      success: true,
      normalizedNumber: recipient.finalNumber,
    };
  }

  validateWebhookSecret(headerValue?: string | null) {
    if (!this.config.evolutionWebhookSecret) {
      return true;
    }

    const provided = headerValue?.replace(/^Bearer\s+/i, "").trim();
    return provided === this.config.evolutionWebhookSecret;
  }

  private isGroupWebhookPayload(payload: WebhookPayload) {
    const root = asRecord(payload);
    const data = asRecord(root.data);
    const key = asRecord(data.key);
    const remoteJid =
      asString(key.remoteJid) ?? asString(data.remoteJid) ?? asString(root.remoteJid);

    const explicitGroupFlag = [
      asBoolean(root.isGroup),
      asBoolean(data.isGroup),
      asBoolean(key.isGroup),
      asBoolean(asRecord(root.chat).isGroup),
      asBoolean(asRecord(data.chat).isGroup),
      asBoolean(asRecord(root.sender).isGroup),
      asBoolean(asRecord(data.sender).isGroup),
    ].find((value): value is boolean => value !== null);

    if (explicitGroupFlag !== undefined) {
      return explicitGroupFlag;
    }

    if (remoteJid?.endsWith("@g.us")) {
      return true;
    }

    const participant =
      asString(key.participant) ??
      asString(data.participant) ??
      asString(root.participant) ??
      asString(asRecord(data.sender).participant);

    if (participant && remoteJid?.includes("-")) {
      return true;
    }

    return false;
  }

  async dispose() {
    if (this.redis) {
      await this.redis.quit();
    }

    for (const timer of this.memoryTimers.values()) {
      clearTimeout(timer);
    }
    this.memoryTimers.clear();
    this.memoryBuffers.clear();
  }
}
