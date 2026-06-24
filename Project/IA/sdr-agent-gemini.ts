import axios from "axios";
import Redis from "ioredis";
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
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
  temperature: number;
  buffer_wait_ms: number;
  human_pause_minutes: number;
  auto_apply_threshold: number;
  handoff_enabled: boolean;
  handoff_prompt: string | null;
  handoff_target_phone: string | null;
  template_key: string | null;
  template_version: number | null;
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

type VisagismCatalogItemRow = {
  id: string;
  aces_id: number;
  product_code: string;
  recommendation_description: string;
  attributes: JsonRecord;
  source_url: string;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export type LensCategory = "single_vision" | "multifocal";

export type LensPriceRule = {
  id: string;
  displayName: string;
  lensCategory: LensCategory;
  minSphere: number;
  maxSphere: number;
  maxAbsCylinder: number;
  minAddition: number | null;
  maxAddition: number | null;
  priceCents: number;
  currency: "BRL";
  priority: number;
  isActive: boolean;
};

export type NormalizedPrescription = {
  odSphere: number | null;
  odCylinder: number | null;
  odAxis: number | null;
  oeSphere: number | null;
  oeCylinder: number | null;
  oeAxis: number | null;
  addition: number | null;
};

type PrescriptionExtraction = NormalizedPrescription & {
  distancePd: number | null;
  nearPd: number | null;
  patientName: string | null;
  prescriberName: string | null;
  prescriberRegistration: string | null;
  prescriptionDate: string | null;
  expiresAt: string | null;
  observations: string | null;
  confidence: number;
  isPrescription: boolean;
};

export type OpticsImageKind = "prescription" | "face" | "product" | "document" | "other";

export type FaceAnalysis = {
  faceShape: string | null;
  summary: string | null;
  hair: string | null;
  skinTone: string | null;
  visualFeatures: string[];
};

export type OpticsImageAnalysis = {
  kind: OpticsImageKind;
  evidence: string[];
  prescription: PrescriptionExtraction | null;
  face: FaceAnalysis | null;
};

type VisagismLeadAnswerRow = {
  question_key: string;
  answer_text: string | null;
  answer_value: JsonRecord | null;
  answered_at: string;
};

type VisagismRunSnapshot = {
  desiredPerception: string | null;
  desiredFeeling: string | null;
  selectedItemId: string | null;
  analysis: JsonRecord;
  image: JsonRecord;
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

type InstanceAccessMembershipRow = {
  instance_name: string;
  crm_user_id: string;
  access_level: string;
  is_active: boolean;
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
  como_quer_ser_percebido: string | null;
  qual_imagem_passar: string | null;
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
  temperature?: number;
  bufferWaitMs?: number;
  humanPauseMinutes?: number;
  autoApplyThreshold?: number;
  isActive?: boolean;
  handoffEnabled?: boolean;
  handoffPrompt?: string;
  handoffTargetPhone?: string;
  templateKey?: string | null;
};

type UpdateAgentInput = Partial<CreateAgentInput>;

type UpdateAgentToolInput = {
  isEnabled?: boolean;
  config?: JsonRecord;
};

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

type VisagismDecision = {
  requested: boolean;
  desired_perception_answer: string | null;
  desired_feeling_answer: string | null;
  should_start: boolean;
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
  visagism: VisagismDecision;
};

type ReplyModelResponse = {
  reply_blocks: string[];
  media_asset_key: string | null;
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
  mode: "external_notification" | "agent" | null;
  targetPhone: string | null;
  targetAgentId: string | null;
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
  elevenLabsApiKey?: string;
  elevenLabsDefaultVoiceId?: string;
  elevenLabsModel?: string;
  elevenLabsOutputFormat?: string;
  elevenLabsTtsEnabled?: boolean;
  visagismToolEnabled?: boolean;
  visagismInternalRuntimeEnabled?: boolean;
  visagismAnalysisWorkerModel?: string;
  visagismMatchingWorkerModel?: string;
  visagismImageWorkerModel?: string;
  prescriptionWorkerEnabled?: boolean;
  prescriptionWorkerModel?: string;
  toolMediaAllowedHosts?: string[];
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

export function resolveAudioDispatchFailure(dispatched: boolean) {
  return dispatched ? "delivered_requires_reconciliation" : "fallback_to_text";
}

export function pickVisagismCatalogItem(params: {
  catalog: Array<{ id: string; displayOrder: number; productCode: string }>;
  excludedItemId?: string | null;
  priorSelectedItemId?: string | null;
}) {
  const excluded = params.excludedItemId ?? params.priorSelectedItemId ?? null;
  const ordered = [...params.catalog].sort((left, right) => {
    if (left.displayOrder !== right.displayOrder) return left.displayOrder - right.displayOrder;
    return left.productCode.localeCompare(right.productCode);
  });

  const eligible = ordered.filter((item) => item.id !== excluded);
  if (eligible.length > 0) {
    return eligible[0] ?? null;
  }
  return ordered[0] ?? null;
}

export function resolveVisagismIdempotencyAction(
  existingStatus: string | null,
  ready: boolean
): "create" | "resume" | "return_existing" {
  if (!existingStatus) return "create";
  return existingStatus === "waiting_input" && ready ? "resume" : "return_existing";
}

export function createVisagismEditRequest<T>(model: string, prompt: string, image: T[]) {
  if (image.length !== 2) {
    throw new Error("Visagismo exige exatamente a foto do lead e a imagem da armacao");
  }
  return { model, image, prompt, size: "1024x1024" as const };
}

export async function invokeVisagismImageEdit<TRequest, TResponse>(
  edit: (request: TRequest) => Promise<TResponse>,
  request: TRequest
) {
  return edit(request);
}

export function getPrescriptionValidationErrors(prescription: NormalizedPrescription) {
  const errors: string[] = [];
  if (prescription.odSphere === null && prescription.odCylinder === null) errors.push("od_missing");
  if (prescription.oeSphere === null && prescription.oeCylinder === null) errors.push("oe_missing");
  if (prescription.odCylinder !== null && prescription.odCylinder !== 0 && prescription.odAxis === null) {
    errors.push("od_axis_missing");
  }
  if (prescription.oeCylinder !== null && prescription.oeCylinder !== 0 && prescription.oeAxis === null) {
    errors.push("oe_axis_missing");
  }
  for (const [key, axis] of [["od_axis", prescription.odAxis], ["oe_axis", prescription.oeAxis]] as const) {
    if (axis !== null && (!Number.isInteger(axis) || axis < 0 || axis > 180)) errors.push(`${key}_invalid`);
  }
  return errors;
}

export function matchLensPriceRule(
  prescription: NormalizedPrescription,
  rules: LensPriceRule[]
): LensPriceRule | null {
  if (getPrescriptionValidationErrors(prescription).length > 0) return null;
  const category: LensCategory = (prescription.addition ?? 0) > 0 ? "multifocal" : "single_vision";
  const spheres = [prescription.odSphere, prescription.oeSphere].filter(
    (value): value is number => value !== null
  );
  const cylinders = [prescription.odCylinder, prescription.oeCylinder].filter(
    (value): value is number => value !== null
  );

  return [...rules]
    .filter((rule) => {
      if (!rule.isActive || rule.lensCategory !== category) return false;
      if (spheres.some((value) => value < rule.minSphere || value > rule.maxSphere)) return false;
      if (cylinders.some((value) => Math.abs(value) > rule.maxAbsCylinder)) return false;
      if (category === "multifocal") {
        const addition = prescription.addition;
        if (addition === null || rule.minAddition === null || rule.maxAddition === null) return false;
        if (addition < rule.minAddition || addition > rule.maxAddition) return false;
      }
      return true;
    })
    .sort((left, right) => left.priority - right.priority || left.displayName.localeCompare(right.displayName))[0] ?? null;
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
  const visagism = asRecord(parsed.visagism);

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
    visagism: {
      requested: visagism.requested === true,
      desired_perception_answer: asString(visagism.desired_perception_answer),
      desired_feeling_answer: asString(visagism.desired_feeling_answer),
      should_start: visagism.should_start === true,
      reason: asString(visagism.reason) ?? "",
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
    media_asset_key: parsed.media_asset_key ? String(parsed.media_asset_key).trim() : null,
  };
}

function parseNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePrescriptionRecord(parsed: JsonRecord): PrescriptionExtraction {
  const nullableText = (value: unknown) => asString(value);
  const nullableDate = (value: unknown) => {
    const date = asString(value);
    return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  };
  return {
    odSphere: parseNullableNumber(parsed.od_sphere),
    odCylinder: parseNullableNumber(parsed.od_cylinder),
    odAxis: parseNullableNumber(parsed.od_axis),
    oeSphere: parseNullableNumber(parsed.oe_sphere),
    oeCylinder: parseNullableNumber(parsed.oe_cylinder),
    oeAxis: parseNullableNumber(parsed.oe_axis),
    addition: parseNullableNumber(parsed.addition),
    distancePd: parseNullableNumber(parsed.distance_pd),
    nearPd: parseNullableNumber(parsed.near_pd),
    patientName: nullableText(parsed.patient_name),
    prescriberName: nullableText(parsed.prescriber_name),
    prescriberRegistration: nullableText(parsed.prescriber_registration),
    prescriptionDate: nullableDate(parsed.prescription_date),
    expiresAt: nullableDate(parsed.expires_at),
    observations: nullableText(parsed.observations),
    confidence: clampConfidence(parsed.confidence),
    isPrescription: parsed.is_prescription === true,
  };
}

export function parseOpticsImageAnalysis(text: string): OpticsImageAnalysis {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
  const parsed = asRecord(JSON.parse(cleaned));
  const rawKind = asString(parsed.kind);
  const kind: OpticsImageKind =
    rawKind === "prescription" || rawKind === "face" || rawKind === "product" || rawKind === "document"
      ? rawKind
      : parsed.is_prescription === true
        ? "prescription"
        : "other";
  const prescriptionRecord = Object.keys(asRecord(parsed.prescription)).length > 0
    ? asRecord(parsed.prescription)
    : parsed;
  const faceRecord = asRecord(parsed.face);

  return {
    kind,
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence.map((item) => truncateText(String(item).trim(), 160)).filter(Boolean).slice(0, 8)
      : [],
    prescription:
      kind === "prescription"
        ? parsePrescriptionRecord({ ...prescriptionRecord, is_prescription: true })
        : null,
    face:
      kind === "face"
        ? {
            faceShape: asString(faceRecord.face_shape),
            summary: asString(faceRecord.summary),
            hair: asString(faceRecord.hair),
            skinTone: asString(faceRecord.skin_tone),
            visualFeatures: Array.isArray(faceRecord.visual_features)
              ? faceRecord.visual_features
                  .map((item) => truncateText(String(item).trim(), 120))
                  .filter(Boolean)
                  .slice(0, 10)
              : [],
          }
        : null,
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

export function isTransientVisagismError(error: unknown) {
  if (error instanceof WhatsAppProviderError) {
    return error.kind === "transient" && error.statusCode !== null;
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    return status === 408 || status === 429 || (typeof status === "number" && status >= 500);
  }
  const message = extractExternalErrorMessage(error) ?? (error instanceof Error ? error.message : "");
  return /\b(408|429|500|502|503|504)\b/i.test(message) || /temporar|timeout|unavailable|try again/i.test(message);
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
  private readonly agentsClient: SupabaseClient<any, any, any>;
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
  private readonly elevenLabsApiKey: string | null;
  private readonly elevenLabsDefaultVoiceId: string | null;
  private readonly elevenLabsModel: string;
  private readonly elevenLabsOutputFormat: string;
  private readonly elevenLabsTtsEnabled: boolean;
  private readonly visagismToolEnabled: boolean;
  private readonly visagismInternalRuntimeEnabled: boolean;
  private readonly visagismAnalysisWorkerModel: string;
  private readonly visagismMatchingWorkerModel: string;
  private readonly visagismImageWorkerModel: string;
  private readonly prescriptionWorkerEnabled: boolean;
  private readonly prescriptionWorkerModel: string;
  private readonly toolMediaAllowedHosts: Set<string>;

  constructor(private readonly config: ServiceConfig) {
    this.authClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "crm" },
    });

    this.serviceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "crm" },
    });

    this.agentsClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "agents" },
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
    this.elevenLabsApiKey = config.elevenLabsApiKey?.trim() || null;
    this.elevenLabsDefaultVoiceId = config.elevenLabsDefaultVoiceId?.trim() || null;
    this.elevenLabsModel = config.elevenLabsModel?.trim() || "eleven_flash_v2_5";
    this.elevenLabsOutputFormat = config.elevenLabsOutputFormat?.trim() || "mp3_44100_128";
    this.elevenLabsTtsEnabled = config.elevenLabsTtsEnabled === true;
    this.visagismToolEnabled = config.visagismToolEnabled === true;
    this.visagismInternalRuntimeEnabled = config.visagismInternalRuntimeEnabled !== false;
    this.visagismAnalysisWorkerModel = config.visagismAnalysisWorkerModel?.trim() || "gemini-2.5-flash";
    this.visagismMatchingWorkerModel = config.visagismMatchingWorkerModel?.trim() || "gemini-2.5-flash";
    this.visagismImageWorkerModel = config.visagismImageWorkerModel?.trim() || "gpt-image-1";
    this.prescriptionWorkerEnabled = config.prescriptionWorkerEnabled !== false;
    this.prescriptionWorkerModel = config.prescriptionWorkerModel?.trim() || "gemini-2.5-flash";
    this.toolMediaAllowedHosts = new Set(
      [
        "drive.google.com",
        "docs.google.com",
        "googleusercontent.com",
        ...(config.toolMediaAllowedHosts ?? []),
      ]
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean)
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
      const { data, error } = await this.serviceClient
        .from("instance_access_memberships")
        .select("instance_name")
        .eq("aces_id", acesId)
        .eq("instance_name", instanceName)
        .eq("crm_user_id", ownerId)
        .eq("is_active", true)
        .maybeSingle<InstanceAccessMembershipRow>();

      if (error) {
        throw new HttpError(500, "Nao foi possivel validar o compartilhamento da instancia", error);
      }

      if (!data) {
        throw new HttpError(403, "Instancia nao pertence ao usuario atual");
      }
    }

    return existing;
  }

  private async getAccessibleInstanceNames(acesId: number, crmUserId?: string | null) {
    if (!crmUserId) {
      return new Set<string>();
    }

    const [{ data: ownedInstances, error: ownedError }, { data: sharedMemberships, error: sharedError }] =
      await Promise.all([
        this.serviceClient
          .from("instance")
          .select("instancia")
          .eq("aces_id", acesId)
          .eq("created_by", crmUserId),
        this.serviceClient
          .from("instance_access_memberships")
          .select("instance_name")
          .eq("aces_id", acesId)
          .eq("crm_user_id", crmUserId)
          .eq("is_active", true),
      ]);

    if (ownedError) {
      throw new HttpError(500, "Nao foi possivel listar as instancias do usuario", ownedError);
    }

    if (sharedError) {
      throw new HttpError(500, "Nao foi possivel listar os compartilhamentos de instancia", sharedError);
    }

    const accessibleInstances = new Set<string>();
    for (const row of (ownedInstances ?? []) as Array<{ instancia: string }>) {
      accessibleInstances.add(String(row.instancia));
    }
    for (const row of (sharedMemberships ?? []) as Array<{ instance_name: string }>) {
      accessibleInstances.add(String(row.instance_name));
    }

    return accessibleInstances;
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
    const { data, error } = await this.agentsClient
      .from("ai_agents")
      .select("*")
      .eq("id", agentId)
      .eq("aces_id", acesId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar o agente", error);
    }

    if (!data) {
      throw new HttpError(404, "Agente nao encontrado");
    }

    if (ownerId && data.created_by !== ownerId) {
      const { data: membership, error: membershipError } = await this.serviceClient
        .from("instance_access_memberships")
        .select("instance_name")
        .eq("aces_id", acesId)
        .eq("instance_name", data.instance_name)
        .eq("crm_user_id", ownerId)
        .eq("is_active", true)
        .maybeSingle<InstanceAccessMembershipRow>();

      if (membershipError) {
        throw new HttpError(500, "Nao foi possivel validar o compartilhamento do agente", membershipError);
      }

      if (!membership) {
        throw new HttpError(404, "Agente nao encontrado");
      }
    }

    return data as AgentRow;
  }

  private async getAgentById(agentId: string) {
    const { data, error } = await this.agentsClient
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
    let query = this.agentsClient
      .from("ai_agents")
      .select("*")
      .eq("instance_name", instanceName);

    if (typeof acesId === "number") {
      query = query.eq("aces_id", acesId);
    }

    const { data, error } = await query
      .order("is_active", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel localizar o agente da instancia", error);
    }

    const agent = (data as AgentRow | null) ?? null;
    if (!agent) {
      return null;
    }

    if (ownerId && agent.created_by !== ownerId) {
      const { data: membership, error: membershipError } = await this.serviceClient
        .from("instance_access_memberships")
        .select("instance_name")
        .eq("aces_id", typeof acesId === "number" ? acesId : agent.aces_id)
        .eq("instance_name", instanceName)
        .eq("crm_user_id", ownerId)
        .eq("is_active", true)
        .maybeSingle<InstanceAccessMembershipRow>();

      if (membershipError) {
        throw new HttpError(500, "Nao foi possivel validar o compartilhamento do agente", membershipError);
      }

      if (!membership) {
        return null;
      }
    }

    return agent;
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
    const { data: currentRules, error } = await this.agentsClient
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

    const { error: insertError } = await this.agentsClient.from("ai_stage_rules").insert(missing);
    if (insertError) {
      throw new HttpError(500, "Nao foi possivel criar as regras iniciais de etapa", insertError);
    }
  }

  async listAgents(context: AuthContext) {
    this.ensureAdmin(context);
    const accessibleInstances = await this.getAccessibleInstanceNames(context.acesId, context.crmUserId);

    const { data, error } = await this.agentsClient
      .from("ai_agents")
      .select("*")
      .eq("aces_id", context.acesId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new HttpError(500, "Nao foi possivel listar os agentes", error);
    }

    return ((data ?? []) as AgentRow[]).filter(
      (agent) => accessibleInstances.has(agent.instance_name)
    );
  }

  async listAgentTemplates(context: AuthContext) {
    this.ensureAdmin(context);

    const [{ data: templates, error: templateError }, { data: templateTools, error: toolError }, { data: definitions, error: definitionError }] =
      await Promise.all([
        this.agentsClient
          .from("agent_templates")
          .select("*")
          .eq("is_active", true)
          .order("display_name", { ascending: true })
          .order("version", { ascending: false }),
        this.agentsClient
          .from("agent_template_tools")
          .select("*")
          .order("display_order", { ascending: true }),
        this.agentsClient
          .from("tool_definitions")
          .select("tool_key, version, display_name, description, icon")
          .eq("is_active", true),
      ]);

    const firstError = templateError ?? toolError ?? definitionError;
    if (firstError) {
      throw new HttpError(500, "Nao foi possivel carregar os templates de agentes", firstError);
    }

    const latestTemplates = new Map<string, any>();
    for (const template of templates ?? []) {
      if (!latestTemplates.has(String(template.template_key))) {
        latestTemplates.set(String(template.template_key), template);
      }
    }

    const definitionMap = new Map(
      (definitions ?? []).map((definition) => [
        `${String(definition.tool_key)}:${Number(definition.version)}`,
        definition,
      ])
    );

    return Array.from(latestTemplates.values()).map((template) => ({
      key: String(template.template_key),
      version: Number(template.version),
      name: String(template.display_name),
      description: String(template.description),
      niche: template.niche ? String(template.niche) : null,
      defaults: asRecord(template.agent_defaults),
      tools: (templateTools ?? [])
        .filter(
          (binding) =>
            binding.template_key === template.template_key &&
            Number(binding.template_version) === Number(template.version)
        )
        .map((binding) => {
          const definition = definitionMap.get(
            `${String(binding.tool_key)}:${Number(binding.tool_version)}`
          );
          return {
            key: String(binding.tool_key),
            version: Number(binding.tool_version),
            name: String(definition?.display_name ?? binding.tool_key),
            description: String(definition?.description ?? ""),
            icon: String(definition?.icon ?? "wrench"),
            readiness: String(binding.default_readiness),
            enabled: Boolean(binding.default_enabled),
          };
        }),
    }));
  }

  private async syncPlatformToolReadiness(agentId: string, acesId: number) {
    const { data: audioTool, error } = await this.agentsClient
      .from("agent_tools")
      .select("id, config, is_enabled")
      .eq("agent_id", agentId)
      .eq("aces_id", acesId)
      .eq("tool_key", "ai_audio")
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel validar a Tool de audio", error);
    }

    if (!audioTool) return;

    const currentConfig = asRecord(audioTool.config);
    const voiceId = asString(currentConfig.voiceId) ?? this.elevenLabsDefaultVoiceId;
    const ready = Boolean(this.elevenLabsTtsEnabled && this.elevenLabsApiKey && voiceId);
    const readiness = this.elevenLabsTtsEnabled ? (ready ? "ready" : "needs_config") : "unavailable";

    const { error: updateError } = await this.agentsClient
      .from("agent_tools")
      .update({
        readiness,
        is_enabled: ready ? Boolean(audioTool.is_enabled) : false,
        config: {
          ...currentConfig,
          selectionRate:
            typeof currentConfig.selectionRate === "number" ? currentConfig.selectionRate : 0.018,
          voiceId: voiceId ?? null,
        },
        last_validated_at: new Date().toISOString(),
      })
      .eq("id", audioTool.id)
      .eq("aces_id", acesId);

    if (updateError) {
      throw new HttpError(500, "Nao foi possivel atualizar a prontidao da Tool de audio", updateError);
    }
  }

  private async syncDataToolReadiness(agentId: string, acesId: number) {
    const { data: bindings, error } = await this.agentsClient
      .from("agent_tools")
      .select("id, tool_key, is_enabled")
      .eq("agent_id", agentId)
      .eq("aces_id", acesId)
      .in("tool_key", ["forwarding", "send_media"]);

    if (error) {
      throw new HttpError(500, "Nao foi possivel validar as Tools do agente", error);
    }

    for (const binding of bindings ?? []) {
      const table = binding.tool_key === "forwarding" ? "forwarding_destinations" : "tool_media_assets";
      const { count, error: countError } = await this.agentsClient
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("aces_id", acesId)
        .eq("agent_tool_id", binding.id)
        .eq("is_active", true);

      if (countError) {
        throw new HttpError(500, `Nao foi possivel validar a Tool ${binding.tool_key}`, countError);
      }

      const ready = Number(count ?? 0) > 0;
      const { error: updateError } = await this.agentsClient
        .from("agent_tools")
        .update({
          readiness: ready ? "ready" : "needs_config",
          is_enabled: ready ? Boolean(binding.is_enabled) : false,
          last_validated_at: new Date().toISOString(),
        })
        .eq("id", binding.id)
        .eq("aces_id", acesId);

      if (updateError) {
        throw new HttpError(500, `Nao foi possivel atualizar a Tool ${binding.tool_key}`, updateError);
      }
    }
  }

  private async syncLegacyHandoffTool(agent: AgentRow) {
    const instruction = asString(agent.handoff_prompt);
    const targetPhone = asString(agent.handoff_target_phone);
    const { data: current, error: currentError } = await this.agentsClient
      .from("agent_tools")
      .select("id")
      .eq("agent_id", agent.id)
      .eq("tool_key", "forwarding")
      .maybeSingle();

    if (currentError) {
      throw new HttpError(500, "Nao foi possivel sincronizar o encaminhamento", currentError);
    }

    if (!current && !instruction && !targetPhone) return;

    const ready = Boolean(instruction && targetPhone);
    const { data: binding, error: bindingError } = await this.agentsClient
      .from("agent_tools")
      .upsert(
        {
          aces_id: agent.aces_id,
          agent_id: agent.id,
          tool_key: "forwarding",
          tool_version: 1,
          is_enabled: Boolean(agent.handoff_enabled && ready),
          readiness: ready ? "ready" : "needs_config",
          config: { migratedFromLegacyHandoff: true },
          last_validated_at: new Date().toISOString(),
        },
        { onConflict: "agent_id,tool_key" }
      )
      .select("id")
      .single();

    if (bindingError) {
      throw new HttpError(500, "Nao foi possivel salvar a Tool de encaminhamento", bindingError);
    }

    if (targetPhone) {
      const { error: destinationError } = await this.agentsClient
        .from("forwarding_destinations")
        .upsert(
          {
            aces_id: agent.aces_id,
            agent_tool_id: binding.id,
            destination_key: "legacy-handoff",
            display_name: "Atendimento humano",
            mode: "external_notification",
            target_phone: targetPhone,
            target_agent_id: null,
            context_instruction: instruction,
            is_active: true,
          },
          { onConflict: "agent_tool_id,destination_key" }
        );

      if (destinationError) {
        throw new HttpError(500, "Nao foi possivel salvar o destino do encaminhamento", destinationError);
      }
    } else if (binding.id) {
      await this.agentsClient
        .from("forwarding_destinations")
        .update({ is_active: false })
        .eq("agent_tool_id", binding.id)
        .eq("destination_key", "legacy-handoff");
    }
  }

  private async refreshDerivedAgentState(agent: AgentRow) {
    const results = await Promise.allSettled([
      this.syncMissingStageRules(agent),
      this.syncLegacyHandoffTool(agent),
    ]);

    for (const result of results) {
      if (result.status === "rejected") {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.warn("[crm-ai] Falha ao sincronizar estado derivado do agente:", reason);
      }
    }
  }

  async createAgent(context: AuthContext, input: CreateAgentInput) {
    this.ensureAdmin(context);

    if (!input.name?.trim()) {
      throw new HttpError(400, "Nome do agente e obrigatorio");
    }

    if (!input.instanceName?.trim()) {
      throw new HttpError(400, "Instancia do agente e obrigatoria");
    }

    const instanceName = input.instanceName.trim();
    await this.ensureInstanceOwnership(context.acesId, instanceName, context.crmUserId);

    if (input.templateKey?.trim()) {
      const { data, error } = await this.agentsClient
        .rpc("create_agent_from_template", {
          p_aces_id: context.acesId,
          p_created_by: context.crmUserId,
          p_instance_name: instanceName,
          p_name: input.name.trim(),
          p_system_prompt: input.systemPrompt?.trim() || DEFAULT_SYSTEM_MESSAGE,
          p_model: input.model?.trim() || AgentManager.DEFAULT_CUSTOMER_AGENT_MODEL,
          p_temperature: input.temperature ?? 0.4,
          p_template_key: input.templateKey.trim(),
          p_is_active: input.isActive ?? true,
        })
        .single();

      if (error) {
        throw new HttpError(500, "Nao foi possivel criar o agente pelo template", error);
      }

      const agent = data as AgentRow;
      await this.syncMissingStageRules(agent);
      await this.syncPlatformToolReadiness(agent.id, agent.aces_id);
      return agent;
    }

    const payload = {
      aces_id: context.acesId,
      instance_name: instanceName,
      name: input.name.trim(),
      system_prompt: input.systemPrompt?.trim() || DEFAULT_SYSTEM_MESSAGE,
      provider: input.provider ?? "gemini",
      model: input.model?.trim() || AgentManager.DEFAULT_CUSTOMER_AGENT_MODEL,
      is_active: input.isActive ?? true,
      temperature: input.temperature ?? 0.4,
      buffer_wait_ms: input.bufferWaitMs ?? 15000,
      human_pause_minutes: input.humanPauseMinutes ?? 60,
      auto_apply_threshold: input.autoApplyThreshold ?? 0.85,
      handoff_enabled: input.handoffEnabled ?? false,
      handoff_prompt: input.handoffPrompt?.trim() || null,
      handoff_target_phone: input.handoffTargetPhone?.trim() || null,
      created_by: context.crmUserId,
    };

    const { data, error } = await this.agentsClient
      .from("ai_agents")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw new HttpError(500, "Nao foi possivel criar o agente", error);
    }

    const agent = data as AgentRow;
    await this.refreshDerivedAgentState(agent);
    return agent;
  }

  async deleteAgent(context: AuthContext, agentId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);

    const { error } = await this.agentsClient
      .from("ai_agents")
      .delete()
      .eq("id", agentId)
      .eq("aces_id", context.acesId);

    if (error) {
      throw new HttpError(500, "Nao foi possivel apagar o agente", error);
    }

    return { success: true };
  }

  async listAgentTools(context: AuthContext, agentId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    await this.syncPlatformToolReadiness(agentId, context.acesId);
    await this.syncDataToolReadiness(agentId, context.acesId);

    const [{ data: bindings, error: bindingError }, { data: definitions, error: definitionError }] =
      await Promise.all([
        this.agentsClient
          .from("agent_tools")
          .select("*")
          .eq("agent_id", agentId)
          .eq("aces_id", context.acesId)
          .order("created_at", { ascending: true }),
        this.agentsClient
          .from("tool_definitions")
          .select("tool_key, version, display_name, description, icon")
          .eq("is_active", true),
      ]);

    const firstError = bindingError ?? definitionError;
    if (firstError) {
      throw new HttpError(500, "Nao foi possivel carregar as Tools do agente", firstError);
    }

    const definitionMap = new Map(
      (definitions ?? []).map((definition) => [
        `${String(definition.tool_key)}:${Number(definition.version)}`,
        definition,
      ])
    );

    return (bindings ?? []).map((binding) => {
      const definition = definitionMap.get(
        `${String(binding.tool_key)}:${Number(binding.tool_version)}`
      );
      return {
        id: String(binding.id),
        key: String(binding.tool_key),
        version: Number(binding.tool_version),
        name: String(definition?.display_name ?? binding.tool_key),
        description: String(definition?.description ?? ""),
        icon: String(definition?.icon ?? "wrench"),
        enabled: Boolean(binding.is_enabled),
        readiness: String(binding.readiness),
        config: asRecord(binding.config),
        lastValidatedAt: binding.last_validated_at ? String(binding.last_validated_at) : null,
      };
    });
  }

  async updateAgentTool(
    context: AuthContext,
    agentId: string,
    toolKey: string,
    input: UpdateAgentToolInput
  ) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);

    const { data: current, error: currentError } = await this.agentsClient
      .from("agent_tools")
      .select("*")
      .eq("agent_id", agentId)
      .eq("aces_id", context.acesId)
      .eq("tool_key", toolKey)
      .maybeSingle();

    if (currentError) {
      throw new HttpError(500, "Nao foi possivel carregar a Tool", currentError);
    }

    if (!current) {
      throw new HttpError(404, "Tool nao instalada neste agente");
    }

    if (input.isEnabled === true && current.readiness !== "ready") {
      throw new HttpError(409, "Conclua a configuracao da Tool antes de ativa-la");
    }

    const payload: JsonRecord = {};
    if (input.isEnabled !== undefined) payload.is_enabled = input.isEnabled;
    if (input.config !== undefined) payload.config = { ...asRecord(current.config), ...input.config };

    const { error } = await this.agentsClient
      .from("agent_tools")
      .update(payload)
      .eq("id", current.id)
      .eq("aces_id", context.acesId);

    if (error) {
      throw new HttpError(500, "Nao foi possivel atualizar a Tool", error);
    }

    await this.syncPlatformToolReadiness(agentId, context.acesId);
    await this.syncDataToolReadiness(agentId, context.acesId);
    const tools = await this.listAgentTools(context, agentId);
    return tools.find((tool) => tool.key === toolKey) ?? null;
  }

  async listLensPriceRules(context: AuthContext, agentId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    const binding = await this.getAgentToolBinding(context.acesId, agentId, "prescription_analyst");
    const { data, error } = await this.serviceClient
      .from("lens_price_rules")
      .select("*")
      .eq("aces_id", context.acesId)
      .eq("agent_tool_id", binding.id)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new HttpError(500, "Nao foi possivel listar as regras de lentes", error);
    return (data ?? []).map((row: Record<string, unknown>) => this.mapLensPriceRule(row));
  }

  async upsertLensPriceRule(
    context: AuthContext,
    agentId: string,
    input: Omit<LensPriceRule, "id" | "currency"> & { id?: string | null }
  ) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    const binding = await this.getAgentToolBinding(context.acesId, agentId, "prescription_analyst");
    if (!input.displayName.trim()) throw new HttpError(400, "Informe o nome da regra");
    if (input.minSphere > input.maxSphere) throw new HttpError(400, "A esfera minima deve ser menor que a maxima");
    if (input.maxAbsCylinder < 0 || input.priceCents < 0 || input.priority < 0) {
      throw new HttpError(400, "Cilindro, preco e prioridade nao podem ser negativos");
    }
    if (input.lensCategory === "multifocal" &&
      (input.minAddition === null || input.maxAddition === null || input.minAddition > input.maxAddition)) {
      throw new HttpError(400, "Informe uma faixa de adicao valida para lentes multifocais");
    }

    const payload = {
      id: input.id ?? undefined,
      aces_id: context.acesId,
      agent_tool_id: binding.id,
      display_name: input.displayName.trim(),
      lens_category: input.lensCategory,
      min_sphere: input.minSphere,
      max_sphere: input.maxSphere,
      max_abs_cylinder: input.maxAbsCylinder,
      min_addition: input.lensCategory === "multifocal" ? input.minAddition : null,
      max_addition: input.lensCategory === "multifocal" ? input.maxAddition : null,
      price_cents: input.priceCents,
      currency: "BRL",
      priority: input.priority,
      is_active: input.isActive,
    };
    const result = input.id
      ? await this.serviceClient.from("lens_price_rules").update(payload)
          .eq("id", input.id).eq("aces_id", context.acesId).eq("agent_tool_id", binding.id).select("*").single()
      : await this.serviceClient.from("lens_price_rules").insert(payload).select("*").single();
    const { data, error } = result;
    if (error) throw new HttpError(500, "Nao foi possivel salvar a regra de lentes", error);
    await this.refreshPrescriptionToolReadiness(context.acesId, binding.id);
    return this.mapLensPriceRule(data);
  }

  async deactivateLensPriceRule(context: AuthContext, agentId: string, ruleId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    const binding = await this.getAgentToolBinding(context.acesId, agentId, "prescription_analyst");
    const { error } = await this.serviceClient.from("lens_price_rules")
      .update({ is_active: false })
      .eq("id", ruleId)
      .eq("aces_id", context.acesId)
      .eq("agent_tool_id", binding.id);
    if (error) throw new HttpError(500, "Nao foi possivel desativar a regra de lentes", error);
    await this.refreshPrescriptionToolReadiness(context.acesId, binding.id);
    return { success: true };
  }

  private async getAgentToolBinding(acesId: number, agentId: string, toolKey: string) {
    const { data, error } = await this.agentsClient.from("agent_tools")
      .select("id")
      .eq("aces_id", acesId)
      .eq("agent_id", agentId)
      .eq("tool_key", toolKey)
      .maybeSingle();
    if (error) throw new HttpError(500, "Nao foi possivel carregar a Tool", error);
    if (!data) throw new HttpError(404, "Tool nao instalada neste agente");
    return data;
  }

  private mapLensPriceRule(row: Record<string, unknown>): LensPriceRule {
    return {
      id: String(row.id),
      displayName: String(row.display_name),
      lensCategory: row.lens_category === "multifocal" ? "multifocal" : "single_vision",
      minSphere: Number(row.min_sphere),
      maxSphere: Number(row.max_sphere),
      maxAbsCylinder: Number(row.max_abs_cylinder),
      minAddition: row.min_addition === null ? null : Number(row.min_addition),
      maxAddition: row.max_addition === null ? null : Number(row.max_addition),
      priceCents: Number(row.price_cents),
      currency: "BRL",
      priority: Number(row.priority),
      isActive: Boolean(row.is_active),
    };
  }

  private async refreshPrescriptionToolReadiness(acesId: number, bindingId: string) {
    const { error: updateError } = await this.agentsClient.from("agent_tools")
      .update({ readiness: "ready", last_validated_at: new Date().toISOString() })
      .eq("id", bindingId)
      .eq("aces_id", acesId);
    if (updateError) throw new HttpError(500, "Nao foi possivel atualizar o Analista", updateError);
  }

  async listVisagismCatalog(context: AuthContext, agentId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);

    const { data, error } = await this.agentsClient
      .from("visagism_catalog_items")
      .select("*")
      .eq("aces_id", context.acesId)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new HttpError(500, "Nao foi possivel listar o catalogo de visagismo", error);
    return (data ?? []) as VisagismCatalogItemRow[];
  }

  async upsertVisagismCatalogItem(
    context: AuthContext,
    agentId: string,
    input: {
      id?: string | null;
      productCode: string;
      recommendationDescription: string;
      attributes?: JsonRecord;
      sourceUrl: string;
      displayOrder?: number;
      isActive?: boolean;
    }
  ) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);

    const payload = {
      id: input.id ?? undefined,
      aces_id: context.acesId,
      product_code: input.productCode.trim(),
      recommendation_description: input.recommendationDescription.trim(),
      attributes: input.attributes ?? {},
      source_url: input.sourceUrl.trim(),
      display_order: input.displayOrder ?? 0,
      is_active: input.isActive ?? true,
    };

    const { data, error } = await this.agentsClient
      .from("visagism_catalog_items")
      .upsert(payload, { onConflict: "aces_id,product_code" })
      .select("*")
      .single();
    if (error) throw new HttpError(500, "Nao foi possivel salvar o item do catalogo", error);
    return data;
  }

  async deactivateVisagismCatalogItem(context: AuthContext, agentId: string, itemId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    const { error } = await this.agentsClient
      .from("visagism_catalog_items")
      .update({ is_active: false })
      .eq("id", itemId)
      .eq("aces_id", context.acesId);
    if (error) throw new HttpError(500, "Nao foi possivel desativar o item do catalogo", error);
    return { success: true };
  }

  async listVisagismRuns(context: AuthContext, agentId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    const { data, error } = await this.agentsClient
      .from("agent_tool_runs")
      .select("id, agent_id, lead_id, status, attempt_count, input_snapshot, output_snapshot, error_message, created_at, updated_at, started_at, completed_at")
      .eq("aces_id", context.acesId)
      .eq("agent_id", agentId)
      .eq("tool_key", "visagism")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new HttpError(500, "Nao foi possivel listar as execucoes de visagismo", error);
    return data ?? [];
  }

  async getVisagismRun(context: AuthContext, agentId: string, runId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    const { data, error } = await this.agentsClient
      .from("agent_tool_runs")
      .select("id, agent_id, lead_id, status, attempt_count, input_snapshot, output_snapshot, error_message, created_at, updated_at, started_at, completed_at")
      .eq("id", runId)
      .eq("aces_id", context.acesId)
      .eq("agent_id", agentId)
      .eq("tool_key", "visagism")
      .maybeSingle();
    if (error) throw new HttpError(500, "Nao foi possivel carregar a execucao de visagismo", error);
    if (!data) throw new HttpError(404, "Execucao de visagismo nao encontrada");
    return data;
  }

  async startVisagismRun(
    context: AuthContext,
    agentId: string,
    input: {
      leadId: string;
      sourceMessageId?: string | null;
      excludedItemId?: string | null;
    }
  ) {
    this.ensureAdmin(context);
    const agent = await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    const lead = await this.loadLeadById(input.leadId, context.acesId, context.crmUserId);
    return this.startVisagismRunInternal({
      agent,
      lead,
      sourceMessageId: input.sourceMessageId ?? null,
      excludedItemId: input.excludedItemId ?? null,
      faceAnalysis: null,
    });
  }

  async listToolMediaAssets(context: AuthContext, agentId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    const { data: binding, error: bindingError } = await this.agentsClient
      .from("agent_tools")
      .select("id")
      .eq("agent_id", agentId)
      .eq("aces_id", context.acesId)
      .eq("tool_key", "send_media")
      .maybeSingle();

    if (bindingError) throw new HttpError(500, "Nao foi possivel carregar a Tool Enviar midia", bindingError);
    if (!binding) throw new HttpError(404, "Tool Enviar midia nao instalada");

    const { data, error } = await this.agentsClient
      .from("tool_media_assets")
      .select("id, asset_key, display_name, description, usage_instruction, source_type, source_url, media_kind, mime_type, file_name, default_caption, is_active, created_at")
      .eq("aces_id", context.acesId)
      .eq("agent_tool_id", binding.id)
      .order("display_name", { ascending: true });

    if (error) throw new HttpError(500, "Nao foi possivel listar os materiais", error);
    return data ?? [];
  }

  async upsertToolMediaAsset(
    context: AuthContext,
    agentId: string,
    input: {
      assetKey: string;
      displayName: string;
      description?: string;
      usageInstruction?: string;
      sourceUrl: string;
      mediaKind: "image" | "document";
      fileName?: string | null;
      defaultCaption?: string | null;
    }
  ) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);

    const assetKey = input.assetKey.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(assetKey)) {
      throw new HttpError(400, "Use uma chave simples com letras, numeros, _ ou -");
    }
    if (!input.displayName.trim()) throw new HttpError(400, "Nome do material e obrigatorio");
    const safeUrl = (await this.assertSafeMediaUrl(input.sourceUrl.trim())).toString();

    const { data: binding, error: bindingError } = await this.agentsClient
      .from("agent_tools")
      .select("id")
      .eq("agent_id", agentId)
      .eq("aces_id", context.acesId)
      .eq("tool_key", "send_media")
      .maybeSingle();

    if (bindingError) throw new HttpError(500, "Nao foi possivel carregar a Tool Enviar midia", bindingError);
    if (!binding) throw new HttpError(404, "Tool Enviar midia nao instalada");

    const sourceType = safeUrl.includes("drive.google.com") ? "google_drive" : "https";
    const { data, error } = await this.agentsClient
      .from("tool_media_assets")
      .upsert(
        {
          aces_id: context.acesId,
          agent_tool_id: binding.id,
          asset_key: assetKey,
          display_name: input.displayName.trim(),
          description: input.description?.trim() || "",
          usage_instruction: input.usageInstruction?.trim() || "",
          source_type: sourceType,
          source_url: safeUrl,
          media_kind: input.mediaKind,
          file_name: input.fileName?.trim() || null,
          default_caption: input.defaultCaption?.trim() || null,
          is_active: true,
        },
        { onConflict: "agent_tool_id,asset_key" }
      )
      .select("*")
      .single();

    if (error) throw new HttpError(500, "Nao foi possivel salvar o material", error);
    await this.syncDataToolReadiness(agentId, context.acesId);
    return data;
  }

  async deactivateToolMediaAsset(context: AuthContext, agentId: string, assetId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);

    const { error } = await this.agentsClient
      .from("tool_media_assets")
      .update({ is_active: false })
      .eq("id", assetId)
      .eq("aces_id", context.acesId);

    if (error) throw new HttpError(500, "Nao foi possivel desativar o material", error);
    await this.syncDataToolReadiness(agentId, context.acesId);
    return { success: true };
  }

  async listForwardingDestinations(context: AuthContext, agentId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);

    const { data: binding, error: bindingError } = await this.agentsClient
      .from("agent_tools")
      .select("id")
      .eq("agent_id", agentId)
      .eq("aces_id", context.acesId)
      .eq("tool_key", "forwarding")
      .maybeSingle();

    if (bindingError) throw new HttpError(500, "Nao foi possivel carregar a Tool Encaminhar", bindingError);
    if (!binding) throw new HttpError(404, "Tool Encaminhar nao instalada");

    const { data, error } = await this.agentsClient
      .from("forwarding_destinations")
      .select("id, destination_key, display_name, mode, target_phone, target_agent_id, context_instruction, is_active, created_at, updated_at")
      .eq("aces_id", context.acesId)
      .eq("agent_tool_id", binding.id)
      .order("display_name", { ascending: true });

    if (error) throw new HttpError(500, "Nao foi possivel listar os destinos", error);
    return data ?? [];
  }

  async upsertForwardingDestination(
    context: AuthContext,
    agentId: string,
    input: {
      destinationKey: string;
      displayName: string;
      mode: "external_notification" | "agent";
      targetPhone?: string | null;
      targetAgentId?: string | null;
      contextInstruction: string;
    }
  ) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);

    const destinationKey = input.destinationKey.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(destinationKey)) {
      throw new HttpError(400, "Use uma chave simples com letras, numeros, _ ou -");
    }
    if (!input.displayName.trim()) throw new HttpError(400, "Nome do destino e obrigatorio");
    if (!input.contextInstruction.trim()) {
      throw new HttpError(400, "Instrucao de encaminhamento e obrigatoria");
    }

    let targetPhone: string | null = null;
    let targetAgentId: string | null = null;
    if (input.mode === "external_notification") {
      const recipient = resolveWhatsappRecipient(input.targetPhone?.trim() ?? "");
      targetPhone = recipient.finalNumber;
    } else {
      targetAgentId = input.targetAgentId?.trim() || null;
      if (!targetAgentId) throw new HttpError(400, "Agente de destino e obrigatorio");
      if (targetAgentId === agentId) throw new HttpError(400, "O agente nao pode encaminhar para si mesmo");
      await this.getAgentForAccount(targetAgentId, context.acesId, context.crmUserId);
    }

    const { data: binding, error: bindingError } = await this.agentsClient
      .from("agent_tools")
      .select("id")
      .eq("agent_id", agentId)
      .eq("aces_id", context.acesId)
      .eq("tool_key", "forwarding")
      .maybeSingle();

    if (bindingError) throw new HttpError(500, "Nao foi possivel carregar a Tool Encaminhar", bindingError);
    if (!binding) throw new HttpError(404, "Tool Encaminhar nao instalada");

    const { data, error } = await this.agentsClient
      .from("forwarding_destinations")
      .upsert(
        {
          aces_id: context.acesId,
          agent_tool_id: binding.id,
          destination_key: destinationKey,
          display_name: input.displayName.trim(),
          mode: input.mode,
          target_phone: targetPhone,
          target_agent_id: targetAgentId,
          context_instruction: input.contextInstruction.trim(),
          is_active: true,
        },
        { onConflict: "agent_tool_id,destination_key" }
      )
      .select("*")
      .single();

    if (error) throw new HttpError(500, "Nao foi possivel salvar o destino", error);
    await this.syncDataToolReadiness(agentId, context.acesId);
    return data;
  }

  async deactivateForwardingDestination(
    context: AuthContext,
    agentId: string,
    destinationId: string
  ) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);

    const { error } = await this.agentsClient
      .from("forwarding_destinations")
      .update({ is_active: false })
      .eq("id", destinationId)
      .eq("aces_id", context.acesId);

    if (error) throw new HttpError(500, "Nao foi possivel desativar o destino", error);
    await this.syncDataToolReadiness(agentId, context.acesId);
    return { success: true };
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
    if (input.temperature !== undefined) payload.temperature = input.temperature;
    if (input.bufferWaitMs !== undefined) payload.buffer_wait_ms = input.bufferWaitMs;
    if (input.humanPauseMinutes !== undefined) payload.human_pause_minutes = input.humanPauseMinutes;
    if (input.autoApplyThreshold !== undefined) payload.auto_apply_threshold = input.autoApplyThreshold;
    if (input.handoffEnabled !== undefined) payload.handoff_enabled = input.handoffEnabled;
    if (input.handoffPrompt !== undefined) payload.handoff_prompt = input.handoffPrompt.trim() || null;
    if (input.handoffTargetPhone !== undefined) payload.handoff_target_phone = input.handoffTargetPhone.trim() || null;

    const { data, error } = await this.agentsClient
      .from("ai_agents")
      .update(payload)
      .eq("id", agentId)
      .eq("aces_id", context.acesId)
      .select("*")
      .single();

    if (error) {
      throw new HttpError(500, "Nao foi possivel atualizar o agente", error);
    }

    const agent = data as AgentRow;
    await this.refreshDerivedAgentState(agent);
    return agent;
  }

  async getStageRules(context: AuthContext, agentId: string) {
    this.ensureAdmin(context);
    const agent = await this.getAgentForAccount(agentId, context.acesId, context.crmUserId);
    await this.syncMissingStageRules(agent);

    const stages = await this.getStagesForAccount(context.acesId);
    const { data, error } = await this.agentsClient
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
      const { error } = await this.agentsClient
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
    const { data, error } = await this.agentsClient
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

    let query = this.agentsClient
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

    const { error } = await this.agentsClient.from("ai_lead_state").upsert(
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
    const accessibleInstances = await this.getAccessibleInstanceNames(context.acesId, context.crmUserId);

    const { data, error } = await this.agentsClient
      .from("instance")
      .select(
        "instancia, aces_id, created_by, color, token, status, created_at, setup_status, setup_started_at, setup_expires_at, operation_lock_until, last_error, connection_mode, remote_evolution_url, remote_instance_name, remote_webhook_connected_at"
      )
      .eq("aces_id", context.acesId)
      .or("setup_status.is.null,setup_status.neq.cancelled")
      .order("created_at", { ascending: false });

    if (error) {
      throw new HttpError(500, "Nao foi possivel listar as instancias", error);
    }

    const rows = (data ?? []) as InstanceRow[];
    const visibleRows = rows.filter((instance) => accessibleInstances.has(instance.instancia));
    const leadCounts = await this.buildLeadCountMap(context.acesId, visibleRows);

    return visibleRows.map((instance): InstanceListItem => {
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

    if (existingRow) {
      await this.ensureInstanceOwnership(context.acesId, instanceName, context.crmUserId);
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
          .eq("aces_id", context.acesId);

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
    senderAgentId?: string | null;
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
      sender_agent_id: params.senderAgentId ?? null,
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
      })
      .eq("id", params.leadId)
      .eq("aces_id", params.acesId);

    await this.invalidateChatMessagesCache(params.acesId, params.leadId);

    return data as MessageRow;
  }

  private async loadLeadById(leadId: string, acesId: number, ownerId?: string | null) {
    let query = this.serviceClient
      .from("leads")
      .select("id, aces_id, owner_id, name, contact_phone, status, stage_id, instancia, last_city, notes, check, como_quer_ser_percebido, qual_imagem_passar, last_message_at, updated_at")
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

  private async hasActiveLeadInstanceMembership(
    acesId: number,
    leadId: string,
    instanceName: string
  ) {
    const { data, error } = await this.serviceClient
      .from("lead_instance_memberships")
      .select("id")
      .eq("aces_id", acesId)
      .eq("lead_id", leadId)
      .eq("instance_name", instanceName)
      .eq("is_active", true)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel validar o vinculo da instancia com o lead", error);
    }

    return Boolean(data);
  }

  private async loadLeadForAgent(agent: AgentRow, leadId: string) {
    const lead = await this.loadLeadById(leadId, agent.aces_id);
    const isPrimaryInstance = lead.instancia === agent.instance_name;
    const isAdditionalInstance = isPrimaryInstance
      ? false
      : await this.hasActiveLeadInstanceMembership(agent.aces_id, lead.id, agent.instance_name);

    if (!isPrimaryInstance && !isAdditionalInstance) {
      throw new HttpError(403, "Agente nao autorizado para este lead");
    }

    return lead;
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
    const { data, error } = await this.agentsClient
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
    const { error } = await this.agentsClient.from("ai_lead_state").upsert(
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
    runId?: string;
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
    const { error } = await this.agentsClient.from("ai_runs").insert({
      id: payload.runId ?? randomUUID(),
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

  private async getEnabledAgentTool(agent: AgentRow, toolKey: string) {
    const { data, error } = await this.agentsClient
      .from("agent_tools")
      .select("*")
      .eq("agent_id", agent.id)
      .eq("aces_id", agent.aces_id)
      .eq("tool_key", toolKey)
      .eq("is_enabled", true)
      .eq("readiness", "ready")
      .maybeSingle();

    if (error) {
      throw new HttpError(500, `Nao foi possivel carregar a Tool ${toolKey}`, error);
    }

    return data;
  }

  private async listAvailableMediaAssets(agent: AgentRow) {
    const binding = await this.getEnabledAgentTool(agent, "send_media");
    if (!binding) return [];

    const { data, error } = await this.agentsClient
      .from("tool_media_assets")
      .select("asset_key, display_name, description, usage_instruction")
      .eq("aces_id", agent.aces_id)
      .eq("agent_tool_id", binding.id)
      .eq("is_active", true)
      .order("display_name", { ascending: true });

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar os materiais do agente", error);
    }

    return data ?? [];
  }

  private async enqueueBiEvent(params: {
    acesId: number;
    aggregateType: string;
    aggregateId?: string | null;
    eventType: string;
    payload: JsonRecord;
  }) {
    const { error } = await this.serviceClient.from("bi_outbox").insert({
      aces_id: params.acesId,
      aggregate_type: params.aggregateType,
      aggregate_id: params.aggregateId ?? null,
      event_type: params.eventType,
      payload: params.payload,
    });

    if (error) {
      console.warn("[crm-ai] Falha ao publicar evento para o BI:", {
        eventType: params.eventType,
        aggregateId: params.aggregateId ?? null,
        error,
      });
    }
  }

  private isAudioEligible(text: string) {
    const normalized = text.trim();
    return (
      normalized.length >= 20 &&
      normalized.length <= 800 &&
      !/(?:https?:\/\/|www\.)/i.test(normalized) &&
      !/```|\b(?:otp|token|codigo de verificacao)\b/i.test(normalized)
    );
  }

  private shouldSelectAudio(runId: string, agentId: string, leadId: string, rate: number) {
    const normalizedRate = Math.min(Math.max(rate, 0), 1);
    const sample = createHash("sha256")
      .update(`${runId}:${agentId}:${leadId}`)
      .digest()
      .readUInt32BE(0) % 10_000;

    return sample < Math.round(normalizedRate * 10_000);
  }

  private async generateElevenLabsAudio(text: string, voiceId: string) {
    if (!this.elevenLabsApiKey || !this.elevenLabsTtsEnabled) {
      throw new Error("ElevenLabs nao configurada");
    }

    const response = await axios.post<ArrayBuffer>(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        text,
        model_id: this.elevenLabsModel,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": this.elevenLabsApiKey,
        },
        params: { output_format: this.elevenLabsOutputFormat },
        responseType: "arraybuffer",
        timeout: 15_000,
      }
    );

    const buffer = Buffer.from(response.data);
    if (buffer.byteLength === 0 || buffer.byteLength > CHAT_ATTACHMENT_MAX_FILE_SIZE) {
      throw new Error("Audio gerado pela ElevenLabs possui tamanho invalido");
    }

    return buffer;
  }

  private async sendWhatsAppVoiceNote(
    instanceName: string,
    phone: string,
    mediaUrl: string,
    acesId: number
  ): Promise<SendResult> {
    const recipient = resolveWhatsappRecipient(phone);
    const transport = await this.resolveEvolutionTransport(instanceName, acesId);

    try {
      const response = await axios.post(
        `${transport.apiUrl}/message/sendWhatsAppAudio/${encodeURIComponent(transport.instanceName)}`,
        {
          number: recipient.jid,
          audio: mediaUrl,
          delay: 1000,
          encoding: true,
        },
        { headers: { apikey: transport.apiKey } }
      );
      const root = asRecord(response.data);
      const key = asRecord(root.key);
      const providerMessageId =
        asString(root.id) ?? asString(root.messageId) ?? asString(key.id) ?? null;

      return {
        provider: "evolution",
        providerMessageId,
        providerStatus: "sent",
        raw: summarizeProviderPayload(response.data),
      };
    } catch (error) {
      throw buildExternalRequestError(error, "Falha ao enviar audio na Evolution");
    }
  }

  private async trySendAiAudio(params: {
    agent: AgentRow;
    lead: LeadRow;
    runId: string;
    blocks: string[];
  }) {
    const binding = await this.getEnabledAgentTool(params.agent, "ai_audio");
    if (!binding) return false;

    const text = params.blocks.join("\n\n").trim();
    const config = asRecord(binding.config);
    const voiceId = asString(config.voiceId) ?? this.elevenLabsDefaultVoiceId;
    const selectionRate =
      typeof config.selectionRate === "number" ? config.selectionRate : 0.018;
    const eligible = Boolean(voiceId && this.isAudioEligible(text));
    const selected = eligible
      ? this.shouldSelectAudio(params.runId, params.agent.id, params.lead.id, selectionRate)
      : false;

    await this.enqueueBiEvent({
      acesId: params.agent.aces_id,
      aggregateType: "lead",
      aggregateId: params.lead.id,
      eventType: "tool.ai_audio.decision",
      payload: {
        lead_id: params.lead.id,
        agent_id: params.agent.id,
        tool_key: "ai_audio",
        eligible,
        selected,
        rate: selectionRate,
        run_id: params.runId,
      },
    });

    if (!selected || !voiceId) return false;

    let toolRunId: string = randomUUID();
    const idempotencyKey = `${params.runId}:ai_audio`;
    const { error: runError } = await this.agentsClient.from("agent_tool_runs").insert({
      id: toolRunId,
      aces_id: params.agent.aces_id,
      agent_id: params.agent.id,
      agent_tool_id: binding.id,
      lead_id: params.lead.id,
      tool_key: "ai_audio",
      status: "running",
      idempotency_key: idempotencyKey,
      attempt_count: 1,
      provider: "elevenlabs",
      model: this.elevenLabsModel,
      input_snapshot: { character_count: text.length },
      started_at: new Date().toISOString(),
    });

    if (runError?.code === "23505") {
      const { data: existing, error: existingError } = await this.agentsClient
        .from("agent_tool_runs")
        .select("id, status, attempt_count")
        .eq("aces_id", params.agent.aces_id)
        .eq("idempotency_key", idempotencyKey)
        .single();

      if (existingError) {
        throw new HttpError(500, "Nao foi possivel recuperar a execucao da Tool de audio", existingError);
      }

      if (existing.status === "succeeded") return true;
      if (existing.status === "running") {
        throw new HttpError(409, "A Tool de audio ja esta em execucao");
      }

      toolRunId = String(existing.id);
      const { error: retryError } = await this.agentsClient
        .from("agent_tool_runs")
        .update({
          status: "running",
          attempt_count: Number(existing.attempt_count ?? 0) + 1,
          started_at: new Date().toISOString(),
          completed_at: null,
          error_message: null,
        })
        .eq("id", toolRunId);

      if (retryError) {
        throw new HttpError(500, "Nao foi possivel repetir a Tool de audio", retryError);
      }
    } else if (runError) {
      throw new HttpError(500, "Nao foi possivel iniciar a Tool de audio", runError);
    }

    const messageId = randomUUID();
    const attachmentId = randomUUID();
    const fileName = `audio-${params.runId}.mp3`;
    const storagePath = buildAttachmentStoragePath({
      acesId: params.agent.aces_id,
      leadId: params.lead.id,
      messageId,
      attachmentId,
      fileName,
    });
    const conversationId = `ai-audio:${params.runId}`;
    const instanceName = requireValue(
      params.agent.instance_name || params.lead.instancia,
      "Instancia de envio nao definida"
    );
    const phone = requireValue(params.lead.contact_phone, "Lead sem telefone para envio");
    let uploaded = false;
    let dispatched = false;

    try {
      const audio = await this.generateElevenLabsAudio(text, voiceId);
      const { error: uploadError } = await this.serviceClient.storage
        .from(CHAT_ATTACHMENTS_BUCKET)
        .upload(storagePath, audio, { contentType: "audio/mpeg", upsert: false });

      if (uploadError) {
        throw new HttpError(500, "Nao foi possivel salvar o audio gerado", uploadError);
      }
      uploaded = true;

      const mediaUrl = await this.createSignedDownloadUrl(storagePath);
      await this.registerOutboundEcho({
        acesId: params.lead.aces_id,
        leadId: params.lead.id,
        origin: "ai",
        conversationId,
        referenceId: toolRunId,
        instanceName,
        phone,
        content: text,
        sentAt: new Date().toISOString(),
      });

      const providerResult = await this.sendWhatsAppVoiceNote(
        instanceName,
        phone,
        mediaUrl,
        params.agent.aces_id
      );
      dispatched = true;
      const sentAt = new Date().toISOString();
      await this.saveMessage({
        id: messageId,
        leadId: params.lead.id,
        acesId: params.lead.aces_id,
        content: text,
        direction: "outbound",
        sourceType: "ai",
        instanceName,
        conversationId,
        sentAt,
        provider: providerResult.provider,
        providerMessageId: providerResult.providerMessageId,
        providerStatus: providerResult.providerStatus,
        providerPayloadSummary: providerResult.raw,
        senderAgentId: params.agent.id,
      });
      await this.insertStoredMessageAttachment({
        attachmentId,
        messageId,
        acesId: params.lead.aces_id,
        leadId: params.lead.id,
        kind: "audio",
        mimeType: "audio/mpeg",
        storagePath,
        fileName,
        fileSize: audio.byteLength,
      });

      await this.agentsClient
        .from("agent_tool_runs")
        .update({
          status: "succeeded",
          output_snapshot: { message_id: messageId, attachment_id: attachmentId },
          completed_at: sentAt,
        })
        .eq("id", toolRunId);

      await this.enqueueBiEvent({
        acesId: params.agent.aces_id,
        aggregateType: "tool_run",
        aggregateId: toolRunId,
        eventType: "tool.ai_audio.succeeded",
        payload: {
          tool_run_id: toolRunId,
          lead_id: params.lead.id,
          agent_id: params.agent.id,
          character_count: text.length,
        },
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida na Tool de audio";

      if (resolveAudioDispatchFailure(dispatched) === "delivered_requires_reconciliation") {
        await this.agentsClient
          .from("agent_tool_runs")
          .update({
            status: "succeeded",
            output_snapshot: {
              delivery_dispatched: true,
              persistence_complete: false,
              message_id: messageId,
              attachment_id: attachmentId,
            },
            error_message: truncateText(`Persistencia incompleta apos despacho: ${message}`, 1000),
            completed_at: new Date().toISOString(),
          })
          .eq("id", toolRunId);
        await this.enqueueBiEvent({
          acesId: params.agent.aces_id,
          aggregateType: "tool_run",
          aggregateId: toolRunId,
          eventType: "tool.ai_audio.delivery_persistence_failed",
          payload: {
            tool_run_id: toolRunId,
            lead_id: params.lead.id,
            agent_id: params.agent.id,
            error: truncateText(message, 500),
            audio_dispatched: true,
          },
        });
        return true;
      }

      await this.agentsClient
        .from("agent_tool_runs")
        .update({
          status: "failed",
          error_message: truncateText(message, 1000),
          completed_at: new Date().toISOString(),
        })
        .eq("id", toolRunId);
      await this.enqueueBiEvent({
        acesId: params.agent.aces_id,
        aggregateType: "tool_run",
        aggregateId: toolRunId,
        eventType: "tool.ai_audio.fallback_to_text",
        payload: {
          tool_run_id: toolRunId,
          lead_id: params.lead.id,
          agent_id: params.agent.id,
          error: truncateText(message, 500),
          audio_dispatched: dispatched,
        },
      });

      if (uploaded && !dispatched) {
        await this.serviceClient.storage.from(CHAT_ATTACHMENTS_BUCKET).remove([storagePath]);
      }

      return false;
    }
  }

  private isPrivateNetworkAddress(address: string): boolean {
    if (isIP(address) === 4) {
      const [a, b] = address.split(".").map(Number);
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a >= 224
      );
    }

    if (isIP(address) === 6) {
      const normalized = address.toLowerCase();
      if (normalized.startsWith("::ffff:")) {
        return this.isPrivateNetworkAddress(normalized.slice(7));
      }
      return (
        normalized === "::" ||
        normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe8") ||
        normalized.startsWith("fe9") ||
        normalized.startsWith("fea") ||
        normalized.startsWith("feb")
      );
    }

    return true;
  }

  private isAllowedMediaHost(hostname: string) {
    const normalized = hostname.toLowerCase();
    return Array.from(this.toolMediaAllowedHosts).some(
      (allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`)
    );
  }

  private async assertSafeMediaUrl(value: string) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("URL de midia invalida");
    }

    if (parsed.protocol !== "https:") {
      throw new Error("A midia deve usar HTTPS");
    }
    if (parsed.username || parsed.password || !this.isAllowedMediaHost(parsed.hostname)) {
      throw new Error("Host de midia nao autorizado");
    }

    const addresses = await lookup(parsed.hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((entry) => this.isPrivateNetworkAddress(entry.address))) {
      throw new Error("Destino de midia nao permitido");
    }

    return parsed;
  }

  private normalizeRegisteredMediaUrl(value: string) {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== "drive.google.com") return parsed.toString();

    const pathMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/i);
    const fileId = pathMatch?.[1] ?? parsed.searchParams.get("id");
    if (!fileId) return parsed.toString();

    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  }

  private detectRegisteredMedia(buffer: Buffer) {
    if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
      return { mimeType: "application/pdf", kind: "document" as const, extension: "pdf" };
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mimeType: "image/jpeg", kind: "image" as const, extension: "jpg" };
    }
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer.subarray(1, 4).toString("ascii") === "PNG"
    ) {
      return { mimeType: "image/png", kind: "image" as const, extension: "png" };
    }
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return { mimeType: "image/webp", kind: "image" as const, extension: "webp" };
    }

    throw new Error("O arquivo nao e uma imagem ou PDF permitido");
  }

  private async downloadRegisteredMedia(sourceUrl: string) {
    let currentUrl = this.normalizeRegisteredMediaUrl(sourceUrl);

    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      await this.assertSafeMediaUrl(currentUrl);
      const response = await axios.get<ArrayBuffer>(currentUrl, {
        responseType: "arraybuffer",
        timeout: 20_000,
        maxRedirects: 0,
        maxContentLength: CHAT_ATTACHMENT_MAX_FILE_SIZE,
        maxBodyLength: CHAT_ATTACHMENT_MAX_FILE_SIZE,
        validateStatus: (status) => status >= 200 && status < 400,
      });

      if (response.status >= 300) {
        const location = asString(response.headers.location);
        if (!location || redirectCount === 3) {
          throw new Error("Redirecionamento de midia invalido");
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const buffer = Buffer.from(response.data);
      if (buffer.byteLength === 0 || buffer.byteLength > CHAT_ATTACHMENT_MAX_FILE_SIZE) {
        throw new Error("Tamanho do arquivo invalido");
      }

      return { buffer, ...this.detectRegisteredMedia(buffer) };
    }

    throw new Error("Nao foi possivel baixar o material cadastrado");
  }

  private async executeConfiguredMedia(params: {
    agent: AgentRow;
    lead: LeadRow;
    runId: string;
    assetKey: string;
  }) {
    const binding = await this.getEnabledAgentTool(params.agent, "send_media");
    if (!binding) {
      return { succeeded: false, error: "Tool Enviar midia nao esta ativa" };
    }

    const { data: asset, error: assetError } = await this.agentsClient
      .from("tool_media_assets")
      .select("*")
      .eq("aces_id", params.agent.aces_id)
      .eq("agent_tool_id", binding.id)
      .eq("asset_key", params.assetKey)
      .eq("is_active", true)
      .maybeSingle();

    if (assetError) {
      throw new HttpError(500, "Nao foi possivel carregar o material selecionado", assetError);
    }
    if (!asset) {
      return { succeeded: false, error: "Material nao encontrado ou desativado" };
    }

    const toolRunId = randomUUID();
    const idempotencyKey = `${params.runId}:send_media:${params.assetKey}`;
    const { error: runError } = await this.agentsClient.from("agent_tool_runs").insert({
      id: toolRunId,
      aces_id: params.agent.aces_id,
      agent_id: params.agent.id,
      agent_tool_id: binding.id,
      lead_id: params.lead.id,
      tool_key: "send_media",
      status: "running",
      idempotency_key: idempotencyKey,
      attempt_count: 1,
      provider: "evolution",
      input_snapshot: { asset_key: params.assetKey },
      started_at: new Date().toISOString(),
    });

    if (runError?.code === "23505") {
      const { data: existing } = await this.agentsClient
        .from("agent_tool_runs")
        .select("status")
        .eq("aces_id", params.agent.aces_id)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      return existing?.status === "succeeded"
        ? { succeeded: true, duplicated: true }
        : { succeeded: false, error: "Envio deste material ja esta em processamento" };
    }
    if (runError) {
      throw new HttpError(500, "Nao foi possivel iniciar a Tool Enviar midia", runError);
    }

    let storagePath: string | null = null;
    let dispatched = false;
    try {
      const downloaded = await this.downloadRegisteredMedia(String(asset.source_url));
      const messageId = randomUUID();
      const attachmentId = randomUUID();
      const configuredName = asString(asset.file_name);
      const fileName = sanitizeStorageFileName(
        configuredName ?? `${String(asset.asset_key)}.${downloaded.extension}`
      );
      storagePath = buildAttachmentStoragePath({
        acesId: params.agent.aces_id,
        leadId: params.lead.id,
        messageId,
        attachmentId,
        fileName,
      });

      const { error: uploadError } = await this.serviceClient.storage
        .from(CHAT_ATTACHMENTS_BUCKET)
        .upload(storagePath, downloaded.buffer, {
          contentType: downloaded.mimeType,
          upsert: false,
        });
      if (uploadError) {
        throw new HttpError(500, "Nao foi possivel salvar o material no historico", uploadError);
      }

      const mediaUrl = await this.createSignedDownloadUrl(storagePath);
      const phone = requireValue(params.lead.contact_phone, "Lead sem telefone para envio");
      const instanceName = requireValue(
        params.agent.instance_name || params.lead.instancia,
        "Instancia de envio nao definida"
      );
      const transport = await this.resolveEvolutionTransport(instanceName, params.agent.aces_id);
      const provider = new EvolutionWhatsAppProvider({
        evolutionApiUrl: transport.apiUrl,
        evolutionApiKey: transport.apiKey,
      });
      const caption = asString(asset.default_caption);
      const providerResult = await provider.sendMedia({
        instanceName: transport.instanceName,
        to: phone,
        mediaUrl,
        mimeType: downloaded.mimeType,
        fileName,
        kind: downloaded.kind,
        caption,
        sourceType: "ai",
      });
      dispatched = true;
      const sentAt = new Date().toISOString();
      await this.saveMessage({
        id: messageId,
        leadId: params.lead.id,
        acesId: params.lead.aces_id,
        content: buildAttachmentContent(downloaded.kind, caption ?? ""),
        direction: "outbound",
        sourceType: "ai",
        instanceName,
        conversationId: `ai-media:${params.runId}:${params.assetKey}`,
        sentAt,
        provider: providerResult.provider,
        providerMessageId: providerResult.providerMessageId,
        providerStatus: providerResult.providerStatus,
        providerPayloadSummary: providerResult.raw,
        senderAgentId: params.agent.id,
      });
      await this.insertStoredMessageAttachment({
        attachmentId,
        messageId,
        acesId: params.lead.aces_id,
        leadId: params.lead.id,
        kind: downloaded.kind,
        mimeType: downloaded.mimeType,
        storagePath,
        fileName,
        fileSize: downloaded.buffer.byteLength,
      });

      await this.agentsClient
        .from("agent_tool_runs")
        .update({
          status: "succeeded",
          output_snapshot: { message_id: messageId, attachment_id: attachmentId },
          completed_at: sentAt,
        })
        .eq("id", toolRunId);
      await this.enqueueBiEvent({
        acesId: params.agent.aces_id,
        aggregateType: "tool_run",
        aggregateId: toolRunId,
        eventType: "tool.send_media.succeeded",
        payload: {
          tool_run_id: toolRunId,
          lead_id: params.lead.id,
          agent_id: params.agent.id,
          asset_key: params.assetKey,
          media_kind: downloaded.kind,
        },
      });

      return { succeeded: true, messageId, assetKey: params.assetKey };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida ao enviar material";
      if (storagePath && !dispatched) {
        await this.serviceClient.storage.from(CHAT_ATTACHMENTS_BUCKET).remove([storagePath]);
      }
      await this.agentsClient
        .from("agent_tool_runs")
        .update({
          status: "failed",
          error_message: truncateText(message, 1000),
          completed_at: new Date().toISOString(),
        })
        .eq("id", toolRunId);
      await this.enqueueBiEvent({
        acesId: params.agent.aces_id,
        aggregateType: "tool_run",
        aggregateId: toolRunId,
        eventType: "tool.send_media.failed",
        payload: {
          tool_run_id: toolRunId,
          lead_id: params.lead.id,
          agent_id: params.agent.id,
          asset_key: params.assetKey,
          error: truncateText(message, 500),
        },
      });
      return dispatched
        ? { succeeded: true, persistenceFailed: true, error: message }
        : { succeeded: false, error: message };
    }
  }

  private async sendReplyBlocks(params: {
    agent: AgentRow;
    lead: LeadRow;
    blocks: string[];
    sourceType: "ai" | "human";
    createdBy?: string | null;
    runId?: string;
    hasMediaAttachment?: boolean;
  }) {
    const blocks = params.blocks.map((item) => item.trim()).filter(Boolean);
    if (blocks.length === 0) {
      return null;
    }

    if (params.sourceType === "ai" && params.runId && !params.hasMediaAttachment) {
      const sentAsAudio = await this.trySendAiAudio({
        agent: params.agent,
        lead: params.lead,
        runId: params.runId,
        blocks,
      });
      if (sentAsAudio) return "audio" as const;
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
        senderAgentId: params.sourceType === "ai" ? params.agent.id : null,
      });

      if (index < blocks.length - 1) {
        await wait(900);
      }
    }

    return "text" as const;
  }

  private async getHandoffConfig(agent: AgentRow) {
    const { data: binding, error: bindingError } = await this.agentsClient
      .from("agent_tools")
      .select("id, is_enabled, readiness")
      .eq("agent_id", agent.id)
      .eq("aces_id", agent.aces_id)
      .eq("tool_key", "forwarding")
      .maybeSingle();

    if (bindingError) {
      throw new HttpError(500, "Nao foi possivel carregar a Tool de encaminhamento", bindingError);
    }

    if (binding?.is_enabled && binding.readiness === "ready") {
      const { data: destination, error: destinationError } = await this.agentsClient
        .from("forwarding_destinations")
        .select("mode, target_phone, target_agent_id, context_instruction")
        .eq("agent_tool_id", binding.id)
        .eq("aces_id", agent.aces_id)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (destinationError) {
        throw new HttpError(500, "Nao foi possivel carregar o destino do encaminhamento", destinationError);
      }

      if (destination) {
        return {
          enabled: true,
          instruction: asString(destination.context_instruction),
          targetPhone: asString(destination.target_phone),
          targetAgentId: asString(destination.target_agent_id),
          mode: destination.mode === "agent" ? ("agent" as const) : ("external_notification" as const),
          source: "tool" as const,
        };
      }
    }

    const instruction = asString(agent.handoff_prompt);
    const targetPhone = asString(agent.handoff_target_phone);

    return {
      enabled: Boolean(agent.handoff_enabled && instruction && targetPhone),
      instruction,
      targetPhone,
      targetAgentId: null,
      mode: "external_notification" as const,
      source: "legacy" as const,
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

  private async transferLeadToAgent(params: {
    sourceAgent: AgentRow;
    targetAgentId: string;
    lead: LeadRow;
    reason: string;
    notification: string;
    sourceMessageId: string | null;
  }): Promise<HandoffExecutionResult> {
    const targetAgent = await this.getAgentById(params.targetAgentId);
    if (targetAgent.aces_id !== params.sourceAgent.aces_id) {
      throw new HttpError(403, "O agente de destino pertence a outra conta");
    }
    if (targetAgent.id === params.sourceAgent.id) {
      throw new HttpError(400, "O agente nao pode encaminhar para si mesmo");
    }
    if (!targetAgent.is_active) {
      throw new HttpError(409, "O agente de destino esta desativado");
    }

    const { data: reverseSession, error: reverseError } = await this.agentsClient
      .from("agent_transfer_sessions")
      .select("id")
      .eq("aces_id", params.sourceAgent.aces_id)
      .eq("lead_id", params.lead.id)
      .eq("source_agent_id", targetAgent.id)
      .eq("target_agent_id", params.sourceAgent.id)
      .eq("status", "active")
      .maybeSingle();

    if (reverseError) {
      throw new HttpError(500, "Nao foi possivel validar o ciclo de encaminhamento", reverseError);
    }
    if (reverseSession) {
      return {
        triggered: false,
        mode: "agent",
        targetPhone: null,
        targetAgentId: targetAgent.id,
        reason: "Encaminhamento bloqueado para evitar um ciclo entre agentes.",
        notification: null,
      };
    }

    const { data: activeSession, error: activeSessionError } = await this.agentsClient
      .from("agent_transfer_sessions")
      .select("id")
      .eq("aces_id", params.sourceAgent.aces_id)
      .eq("lead_id", params.lead.id)
      .eq("source_agent_id", params.sourceAgent.id)
      .eq("target_agent_id", targetAgent.id)
      .eq("status", "active")
      .maybeSingle();

    if (activeSessionError) {
      throw new HttpError(500, "Nao foi possivel validar o encaminhamento existente", activeSessionError);
    }
    if (activeSession) {
      return {
        triggered: true,
        mode: "agent",
        targetPhone: null,
        targetAgentId: targetAgent.id,
        reason: params.reason,
        notification: "O lead ja possui um encaminhamento ativo para este agente.",
      };
    }

    const sessionId = randomUUID();
    const { error: sessionError } = await this.agentsClient
      .from("agent_transfer_sessions")
      .insert({
        id: sessionId,
        aces_id: params.sourceAgent.aces_id,
        lead_id: params.lead.id,
        source_agent_id: params.sourceAgent.id,
        target_agent_id: targetAgent.id,
        source_message_id: params.sourceMessageId,
        status: "active",
        context_snapshot: {
          reason: params.reason,
          source_agent_name: params.sourceAgent.name,
          target_agent_name: targetAgent.name,
          notification: truncateText(params.notification, 1200),
        },
        cooldown_until: new Date(Date.now() + 30 * 60_000).toISOString(),
      });

    if (sessionError) {
      if (sessionError.code === "23505") {
        return {
          triggered: true,
          mode: "agent",
          targetPhone: null,
          targetAgentId: targetAgent.id,
          reason: params.reason,
          notification: "O encaminhamento ja foi iniciado em outra execucao.",
        };
      }
      throw new HttpError(500, "Nao foi possivel iniciar o encaminhamento entre agentes", sessionError);
    }

    const { data: existingMembership, error: membershipLookupError } = await this.serviceClient
      .from("lead_instance_memberships")
      .select("id, is_active")
      .eq("aces_id", params.sourceAgent.aces_id)
      .eq("lead_id", params.lead.id)
      .eq("instance_name", targetAgent.instance_name)
      .maybeSingle();

    if (membershipLookupError) {
      await this.agentsClient
        .from("agent_transfer_sessions")
        .update({ status: "failed", ended_at: new Date().toISOString() })
        .eq("id", sessionId);
      throw new HttpError(500, "Nao foi possivel validar a instancia de destino", membershipLookupError);
    }

    const { error: membershipError } = await this.serviceClient
      .from("lead_instance_memberships")
      .upsert(
        {
          aces_id: params.sourceAgent.aces_id,
          lead_id: params.lead.id,
          instance_name: targetAgent.instance_name,
          source_agent_id: params.sourceAgent.id,
          reason: params.reason,
          is_active: true,
          revoked_at: null,
          authorized_at: new Date().toISOString(),
        },
        { onConflict: "lead_id,instance_name" }
      );

    if (membershipError) {
      await this.agentsClient
        .from("agent_transfer_sessions")
        .update({ status: "failed", ended_at: new Date().toISOString() })
        .eq("id", sessionId);
      throw new HttpError(500, "Nao foi possivel autorizar a instancia de destino", membershipError);
    }

    const leadName = params.lead.name?.trim();
    const introduction = leadName
      ? `Ola, ${leadName}! Sou ${targetAgent.name}. Recebi seu atendimento de ${params.sourceAgent.name} e vou continuar com voce por aqui.`
      : `Ola! Sou ${targetAgent.name}. Recebi seu atendimento de ${params.sourceAgent.name} e vou continuar com voce por aqui.`;

    try {
      await this.sendReplyBlocks({
        agent: targetAgent,
        lead: params.lead,
        blocks: [introduction],
        sourceType: "ai",
        runId: `transfer:${sessionId}`,
        hasMediaAttachment: true,
      });
    } catch (error) {
      await this.agentsClient
        .from("agent_transfer_sessions")
        .update({ status: "failed", ended_at: new Date().toISOString() })
        .eq("id", sessionId);

      if (!existingMembership?.is_active) {
        await this.serviceClient
          .from("lead_instance_memberships")
          .update({ is_active: false, revoked_at: new Date().toISOString() })
          .eq("aces_id", params.sourceAgent.aces_id)
          .eq("lead_id", params.lead.id)
          .eq("instance_name", targetAgent.instance_name);
      }
      throw error;
    }

    await this.enqueueBiEvent({
      acesId: params.sourceAgent.aces_id,
      aggregateType: "lead",
      aggregateId: params.lead.id,
      eventType: "tool.forwarding.agent.succeeded",
      payload: {
        lead_id: params.lead.id,
        agent_id: params.sourceAgent.id,
        target_agent_id: targetAgent.id,
        transfer_session_id: sessionId,
        tool_key: "forwarding",
        status: "succeeded",
      },
    });

    return {
      triggered: true,
      mode: "agent",
      targetPhone: null,
      targetAgentId: targetAgent.id,
      reason: params.reason,
      notification: introduction,
    };
  }

  private async triggerHandoff(
    agent: AgentRow,
    lead: LeadRow,
    response: StructuredModelResponse,
    messages: MessageRow[]
  ): Promise<HandoffExecutionResult> {
    const config = await this.getHandoffConfig(agent);
    const reason =
      response.handoff_reason.trim() ||
      response.reason.trim() ||
      "Condicao de handoff atendida pela IA.";

    if (!config.enabled || !response.should_handoff) {
      return {
        triggered: false,
        mode: null,
        targetPhone: null,
        targetAgentId: null,
        reason: response.handoff_reason.trim(),
        notification: null,
      };
    }

    const notification = this.buildHandoffNotification(agent, lead, response, messages);
    const sourceMessageId = [...messages]
      .reverse()
      .find((message) => message.source_type === "lead")?.id ?? null;

    if (config.mode === "agent" && config.targetAgentId) {
      return this.transferLeadToAgent({
        sourceAgent: agent,
        targetAgentId: config.targetAgentId,
        lead,
        reason,
        notification,
        sourceMessageId,
      });
    }

    if (!config.targetPhone) {
      return {
        triggered: false,
        mode: config.mode,
        targetPhone: null,
        targetAgentId: config.targetAgentId,
        reason: "Destino de encaminhamento incompleto.",
        notification: null,
      };
    }

    await this.sendWhatsAppMessage(agent.instance_name, config.targetPhone, notification, {
      acesId: agent.aces_id,
      leadId: lead.id,
      agentId: agent.id,
      sourceType: "handoff",
    });

    await this.enqueueBiEvent({
      acesId: agent.aces_id,
      aggregateType: "lead",
      aggregateId: lead.id,
      eventType: "tool.forwarding.external_notification.succeeded",
      payload: {
        lead_id: lead.id,
        agent_id: agent.id,
        tool_key: "forwarding",
        status: "succeeded",
        source_message_id: sourceMessageId,
      },
    });

    return {
      triggered: true,
      mode: "external_notification",
      targetPhone: config.targetPhone,
      targetAgentId: null,
      reason,
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
    const handoffConfig = await this.getHandoffConfig(agent);
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
      "Retorne JSON puro com as chaves: reply_blocks, stage_decision, tag_decisions, attendance_summary, lead_verification, native_followup, visagism, confidence, reason, should_apply_stage, should_pause, should_handoff, handoff_reason.",
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
      "visagism deve conter requested, desired_perception_answer, desired_feeling_answer, should_start e reason.",
      "Marque visagism.requested=true somente quando o lead pedir recomendacao, simulacao ou prova virtual de armacao.",
      "Extraia desired_perception_answer apenas quando o lead responder como quer ser percebido pelas pessoas.",
      "Extraia desired_feeling_answer apenas quando o lead responder quais valores ou caracteristicas representam quem ele e.",
      "Nao confunda descricao tecnica de uma imagem com resposta de qualificacao. Use null quando nao houver resposta explicita.",
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
        mode: handoffConfig.mode,
        instruction: handoffConfig.instruction ?? null,
        target_phone_configured: Boolean(handoffConfig.targetPhone),
        target_agent_configured: Boolean(handoffConfig.targetAgentId),
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
      visagism: JsonRecord;
    }
  ): Promise<GeminiExecutionResult<ReplyModelResponse>> {
    const mediaAssets = await this.listAvailableMediaAssets(agent);
    const conversation = messages
      .map((message) => `${message.source_type === "lead" ? "Lead" : "Operacao"}: ${truncateText(message.content, 600)}`)
      .join("\n");

    const prompt = [
      agent.system_prompt,
      "",
      "Voce e o agente de atendimento que responde ao lead pelo WhatsApp.",
      "A analise operacional do CRM ja foi feita por um worker interno. Nao altere etapa, tags, resumo, check ou follow-up.",
      "Retorne JSON puro apenas com as chaves reply_blocks e media_asset_key.",
      "reply_blocks deve ser uma lista de 0 a 3 mensagens curtas, naturais e prontas para envio no WhatsApp.",
      "media_asset_key deve ser null ou uma chave exata da lista de materiais disponiveis.",
      "Escolha um material apenas quando o lead pedir ou quando ele for claramente util para a resposta. Nunca invente URL ou chave.",
      "Se nao houver resposta util ou segura para enviar agora, retorne {\"reply_blocks\":[]}.",
      "Se houver handoff humano acionado, prefira nao responder ao lead, a menos que a propria conversa exija uma confirmacao curta.",
      "Se o visagismo estiver waiting_input, pergunte somente o campo faltante indicado. Se estiver succeeded, nao envie texto adicional porque a imagem ja foi enviada.",
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
        visagism: executionContext.visagism,
      })}`,
      "",
      `Materiais disponiveis: ${JSON.stringify(mediaAssets)}`,
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

  private async shouldAnalyzeOpticsImage(agent: AgentRow | null, message: ParsedWebhookMessage) {
    if (!agent || message.mediaKind !== "image" || agent.template_key !== "optics-consultant") return false;
    const [prescription, visagism] = await Promise.all([
      this.prescriptionWorkerEnabled ? this.getEnabledAgentTool(agent, "prescription_analyst") : null,
      this.visagismToolEnabled ? this.getEnabledAgentTool(agent, "visagism") : null,
    ]);
    return Boolean(prescription || visagism);
  }

  private formatPrescriptionContext(
    extraction: PrescriptionExtraction,
    rule: LensPriceRule | null,
    status: "parsed" | "needs_new_image" | "failed",
    handoffRequired: boolean
  ) {
    return [
      "[ANALISE_DE_RECEITUARIO]",
      `status=${status}`,
      `confianca=${extraction.confidence.toFixed(2)}`,
      `od=esf ${extraction.odSphere ?? "?"}; cil ${extraction.odCylinder ?? "?"}; eixo ${extraction.odAxis ?? "?"}`,
      `oe=esf ${extraction.oeSphere ?? "?"}; cil ${extraction.oeCylinder ?? "?"}; eixo ${extraction.oeAxis ?? "?"}`,
      `adicao=${extraction.addition ?? "nao informada"}`,
      rule ? `regra=${rule.displayName}; preco_centavos=${rule.priceCents}; moeda=${rule.currency}` : "regra_de_preco=nao_encontrada",
      extraction.observations ? `observacoes=${truncateText(extraction.observations, 300)}` : null,
      handoffRequired ? "handoff_humano_recomendado=true" : null,
      status !== "parsed" ? "instrucao=solicitar uma nova foto nitida e completa do receituario" : null,
      "[/ANALISE_DE_RECEITUARIO]",
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  private formatOpticsImageContext(analysis: OpticsImageAnalysis) {
    if (analysis.kind === "face" && analysis.face) {
      return [
        "[ANALISE_DE_IMAGEM_OTICA]",
        "kind=face",
        analysis.face.faceShape ? `formato_facial=${analysis.face.faceShape}` : null,
        analysis.face.summary ? `resumo=${truncateText(analysis.face.summary, 300)}` : null,
        analysis.face.hair ? `cabelo=${truncateText(analysis.face.hair, 120)}` : null,
        analysis.face.skinTone ? `tom_de_pele=${truncateText(analysis.face.skinTone, 120)}` : null,
        analysis.face.visualFeatures.length > 0
          ? `caracteristicas=${analysis.face.visualFeatures.join("; ")}`
          : null,
        "[/ANALISE_DE_IMAGEM_OTICA]",
      ].filter((line): line is string => Boolean(line)).join("\n");
    }

    return [
      "[ANALISE_DE_IMAGEM_OTICA]",
      `kind=${analysis.kind}`,
      analysis.evidence.length > 0 ? `evidencias=${analysis.evidence.join("; ")}` : null,
      "[/ANALISE_DE_IMAGEM_OTICA]",
    ].filter((line): line is string => Boolean(line)).join("\n");
  }

  private async processPrescriptionImage(
    agent: AgentRow,
    lead: LeadRow,
    message: ParsedWebhookMessage
  ) {
    if (!message.messageId || !(await this.shouldAnalyzeOpticsImage(agent, message))) return null;

    const binding = await this.getEnabledAgentTool(agent, "prescription_analyst");
    if (!binding) return null;
    const occurrenceKey = `message:${message.messageId}`;
    const idempotencyKey = `prescription:${lead.id}:${occurrenceKey}`;
    const { data: existing } = await this.agentsClient
      .from("agent_tool_runs")
      .select("id, status, output_snapshot")
      .eq("aces_id", agent.aces_id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      const context = asString(asRecord(existing.output_snapshot).agent_context);
      if (context) {
        await this.serviceClient.from("message_history").update({ content: context })
          .eq("id", message.messageId).eq("aces_id", agent.aces_id).eq("lead_id", lead.id);
      }
      return context;
    }

    const { data: attachment, error: attachmentError } = await this.serviceClient
      .from("message_attachments")
      .select("id, storage_bucket, storage_path, mime_type")
      .eq("aces_id", agent.aces_id)
      .eq("lead_id", lead.id)
      .eq("message_id", message.messageId)
      .eq("kind", "image")
      .limit(1)
      .maybeSingle();
    if (attachmentError) throw new HttpError(500, "Nao foi possivel carregar o receituario", attachmentError);
    if (!attachment) return null;

    const toolRunId = randomUUID();
    const startedAt = new Date();
    const { error: runError } = await this.agentsClient.from("agent_tool_runs").insert({
      id: toolRunId,
      aces_id: agent.aces_id,
      agent_id: agent.id,
      agent_tool_id: binding.id,
      lead_id: lead.id,
      tool_key: "prescription_analyst",
      status: "running",
      idempotency_key: idempotencyKey,
      attempt_count: 1,
      provider: "google",
      model: this.prescriptionWorkerModel,
      input_snapshot: { occurrence_key: occurrenceKey, source_message_id: message.messageId, source_attachment_id: attachment.id },
      started_at: startedAt.toISOString(),
    });
    if (runError) throw new HttpError(500, "Nao foi possivel iniciar a leitura do receituario", runError);

    try {
      const { data: file, error: downloadError } = await this.serviceClient.storage
        .from(String(attachment.storage_bucket))
        .download(String(attachment.storage_path));
      if (downloadError || !file) throw new HttpError(500, "Nao foi possivel baixar o receituario", downloadError);
      const buffer = Buffer.from(await file.arrayBuffer());
      const prompt = [
        "Voce e um worker optico multimodal. Analise esta imagem uma unica vez e retorne somente JSON valido.",
        "Classifique kind como prescription, face, product, document ou other e inclua evidence como lista curta.",
        "Se kind=prescription, preencha prescription com confidence, od_sphere, od_cylinder, od_axis, oe_sphere, oe_cylinder, oe_axis, addition, distance_pd, near_pd, patient_name, prescriber_name, prescriber_registration, prescription_date, expires_at e observations.",
        "Nao invente valores ilegíveis. Use null. Normalize graus com sinal e ponto decimal, eixos entre 0 e 180 e datas YYYY-MM-DD.",
        "Se kind=face, preencha face com face_shape, summary, hair, skin_tone e visual_features. Nao diagnostique nem infira atributos sensiveis.",
        "Para campos que nao pertencem ao kind identificado, use null.",
      ].join("\n");
      const { result, modelName, usedFallback, attempt } = await this.generateGeminiContent(
        this.prescriptionWorkerModel,
        [prompt, { inlineData: { mimeType: String(attachment.mime_type || "image/jpeg"), data: buffer.toString("base64") } }]
      );
      const rawText = result.response.text();
      const analysis = parseOpticsImageAnalysis(rawText);
      if (analysis.kind !== "prescription" || !analysis.prescription) {
        const agentContext = this.formatOpticsImageContext(analysis);
        await this.serviceClient.from("message_history").update({ content: agentContext })
          .eq("id", message.messageId).eq("aces_id", agent.aces_id).eq("lead_id", lead.id);
        await this.agentsClient.from("agent_tool_runs").update({
          status: "cancelled",
          output_snapshot: {
            image_analysis: analysis,
            agent_context: agentContext,
            raw_model_response: rawText,
            model_name: modelName,
            used_fallback_model: usedFallback,
            generation_attempt: attempt,
          },
          completed_at: new Date().toISOString(),
        }).eq("id", toolRunId).eq("aces_id", agent.aces_id);
        await this.invalidateChatMessagesCache(agent.aces_id, lead.id);
        return analysis;
      }
      const extraction = analysis.prescription;
      const validationErrors = extraction.isPrescription
        ? getPrescriptionValidationErrors(extraction)
        : ["not_a_prescription"];
      const valid = validationErrors.length === 0 && extraction.confidence >= 0.75;
      const status = valid ? "parsed" : "needs_new_image";
      const { data: ruleRows, error: rulesError } = await this.serviceClient.from("lens_price_rules")
        .select("*").eq("aces_id", agent.aces_id).eq("agent_tool_id", binding.id).eq("is_active", true);
      if (rulesError) throw new HttpError(500, "Nao foi possivel carregar regras de lentes", rulesError);
      const matchedRule = valid
        ? matchLensPriceRule(extraction, (ruleRows ?? []).map((row: Record<string, unknown>) => this.mapLensPriceRule(row)))
        : null;
      const { count: priorFailures } = await this.agentsClient.from("agent_tool_runs")
        .select("id", { count: "exact", head: true }).eq("aces_id", agent.aces_id).eq("lead_id", lead.id)
        .eq("tool_key", "prescription_analyst").eq("status", "waiting_input");
      const handoffRequired = !valid && Number(priorFailures ?? 0) >= 1;
      const agentContext = this.formatPrescriptionContext(extraction, matchedRule, status, handoffRequired);
      const outputSnapshot = {
        occurrence_key: occurrenceKey,
        extraction,
        validation_errors: validationErrors,
        matched_rule: matchedRule,
        handoff_required: handoffRequired,
        agent_context: agentContext,
        raw_model_response: rawText,
        model_name: modelName,
        used_fallback_model: usedFallback,
        generation_attempt: attempt,
      };
      const { error: prescriptionError } = await this.serviceClient.from("receituarios").insert({
        lead_id: lead.id,
        aces_id: agent.aces_id,
        source_message_id: message.messageId,
        source_attachment_id: attachment.id,
        agent_tool_run_id: toolRunId,
        occurrence_key: occurrenceKey,
        status,
        od_sphere: extraction.odSphere,
        od_cylinder: extraction.odCylinder,
        od_axis: extraction.odAxis,
        oe_sphere: extraction.oeSphere,
        oe_cylinder: extraction.oeCylinder,
        oe_axis: extraction.oeAxis,
        addition: extraction.addition,
        distance_pd: extraction.distancePd,
        near_pd: extraction.nearPd,
        patient_name: extraction.patientName,
        prescriber_name: extraction.prescriberName,
        prescriber_registration: extraction.prescriberRegistration,
        prescription_date: extraction.prescriptionDate,
        expires_at: extraction.expiresAt,
        observacoes: extraction.observations,
        analysis_model: modelName,
        raw_extraction: outputSnapshot,
        extraction_confidence: extraction.confidence,
        matched_lens_price_rule_id: matchedRule?.id ?? null,
        quoted_price_cents: matchedRule?.priceCents ?? null,
      });
      if (prescriptionError) throw new HttpError(500, "Nao foi possivel salvar o receituario", prescriptionError);
      await this.serviceClient.from("message_history").update({ content: agentContext })
        .eq("id", message.messageId).eq("aces_id", agent.aces_id).eq("lead_id", lead.id);
      await this.agentsClient.from("agent_tool_runs").update({
        status: valid ? "succeeded" : "waiting_input",
        output_snapshot: outputSnapshot,
        completed_at: new Date().toISOString(),
      }).eq("id", toolRunId).eq("aces_id", agent.aces_id);
      await this.enqueueBiEvent({
        acesId: agent.aces_id,
        aggregateType: "agent_tool_run",
        aggregateId: toolRunId,
        eventType: valid ? "tool.prescription_analyst.succeeded" : "tool.prescription_analyst.needs_new_image",
        payload: {
          tool_key: "prescription_analyst", tool_run_id: toolRunId, agent_id: agent.id, lead_id: lead.id,
          status: valid ? "succeeded" : "waiting_input", duration_ms: Date.now() - startedAt.getTime(),
          confidence: extraction.confidence, matched_rule_id: matchedRule?.id ?? null, handoff_required: handoffRequired,
        },
      });
      await this.invalidateChatMessagesCache(agent.aces_id, lead.id);
      return analysis;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Falha ao analisar receituario";
      await this.agentsClient.from("agent_tool_runs").update({
        status: "failed", error_code: "prescription_analysis_failed", error_message: errorMessage,
        completed_at: new Date().toISOString(),
      }).eq("id", toolRunId).eq("aces_id", agent.aces_id);
      await this.enqueueBiEvent({
        acesId: agent.aces_id, aggregateType: "agent_tool_run", aggregateId: toolRunId,
        eventType: "tool.prescription_analyst.failed",
        payload: { tool_key: "prescription_analyst", tool_run_id: toolRunId, agent_id: agent.id, lead_id: lead.id, status: "failed", error: errorMessage },
      });
      throw error;
    }
  }

  private async processBufferedOpticsImages(agent: AgentRow, lead: LeadRow, entries: ParsedWebhookMessage[]) {
    const analyses = new Map<string, OpticsImageAnalysis>();
    for (const entry of entries) {
      if (entry.mediaKind !== "image" || !entry.messageId) continue;
      try {
        const analysis = await this.processPrescriptionImage(agent, lead, entry);
        if (analysis && typeof analysis === "object") analyses.set(entry.messageId, analysis);
      } catch {
        // Preserve the conversation even if the internal visual worker is temporarily unavailable.
      }
    }
    return analyses;
  }

  private async findLatestFaceMessageId(acesId: number, leadId: string) {
    const { data, error } = await this.serviceClient.from("message_history")
      .select("id")
      .eq("aces_id", acesId)
      .eq("lead_id", leadId)
      .eq("direction", "inbound")
      .like("content", "%kind=face%")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new HttpError(500, "Nao foi possivel localizar a foto de rosto do lead", error);
    return data?.id ? String(data.id) : null;
  }

  private async applyVisagismDecision(params: {
    agent: AgentRow;
    lead: LeadRow;
    decision: VisagismDecision;
    latestInbound: LatestLeadInboundMessage | null;
    bufferedEntries: ParsedWebhookMessage[];
    imageAnalyses: Map<string, OpticsImageAnalysis>;
  }) {
    if (params.agent.template_key !== "optics-consultant") {
      return { status: "not_applicable" as const };
    }

    const answers = await this.persistVisagismLeadAnswers({
      agent: params.agent,
      lead: params.lead,
      decision: params.decision,
      sourceMessageId: params.latestInbound?.id ?? null,
    });
    const binding = await this.getEnabledAgentTool(params.agent, "visagism");
    if (!this.visagismToolEnabled || !this.visagismInternalRuntimeEnabled || !binding) {
      return { status: "unavailable" as const };
    }
    if (!params.decision.requested && !params.decision.should_start) {
      return { status: "idle" as const };
    }

    const answerKeys = new Set(answers.map((answer) => answer.question_key));
    const missingAnswerKeys = ["desired_perception", "desired_feeling"].filter((key) => !answerKeys.has(key));
    const currentFaceEntry = [...params.bufferedEntries].reverse().find((entry) => {
      const analysis = entry.messageId ? params.imageAnalyses.get(entry.messageId) : null;
      return analysis?.kind === "face";
    });
    const sourceMessageId = currentFaceEntry?.messageId ?? await this.findLatestFaceMessageId(params.agent.aces_id, params.lead.id);
    const faceAnalysis = currentFaceEntry?.messageId
      ? params.imageAnalyses.get(currentFaceEntry.messageId)?.face ?? null
      : null;

    if (missingAnswerKeys.length > 0 || !sourceMessageId) {
      return {
        status: "waiting_input" as const,
        missingAnswerKeys,
        missingImage: !sourceMessageId,
      };
    }

    return this.startVisagismRunInternal({
      agent: params.agent,
      lead: params.lead,
      sourceMessageId,
      excludedItemId: null,
      faceAnalysis,
    });
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

    const lead = await this.loadLeadForAgent(agent, leadId);
    const aiState = await this.resolveLeadAiState(lead.id, agent, agent.instance_name);
    if (!aiState.enabled) {
      return;
    }

    const opticsImageAnalyses = await this.processBufferedOpticsImages(agent, lead, bufferedEntries);

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
    const runId = latestInbound?.id ?? randomUUID();

    try {
      const result = await this.classifyConversation(agent, lead, rules, tags, conversation);
      const validStageIds = new Set(rules.map(({ stage }) => stage.id));
      const suggestedStageId =
        result.parsed.stage_decision.stage_id && validStageIds.has(result.parsed.stage_decision.stage_id)
          ? result.parsed.stage_decision.stage_id
          : null;
      const visagismApplication = await this.applyVisagismDecision({
        agent,
        lead,
        decision: result.parsed.visagism,
        latestInbound,
        bufferedEntries,
        imageAnalyses: opticsImageAnalyses,
      });
      const replyResult = await this.generateAgentReply(agent, lead, conversation, result.parsed, {
        nativeFollowupShouldSchedule: result.parsed.native_followup.should_schedule,
        nativeFollowupNeedsClarification: result.parsed.native_followup.needs_clarification,
        handoffTriggered: result.parsed.should_handoff,
        visagism: asRecord(visagismApplication),
      });
      result.parsed.reply_blocks = replyResult.parsed.reply_blocks;
      const visagismRecord = asRecord(visagismApplication);
      if (visagismRecord.status === "succeeded") {
        result.parsed.reply_blocks = [];
      } else if (visagismRecord.status === "waiting_input") {
        const missing = Array.isArray(visagismRecord.missingAnswerKeys)
          ? visagismRecord.missingAnswerKeys.map(String)
          : [];
        result.parsed.reply_blocks = missing.includes("desired_perception")
          ? ["Como voce quer ser percebido pelas pessoas?"]
          : missing.includes("desired_feeling")
            ? ["Quais valores ou caracteristicas melhor representam quem voce realmente e?"]
            : visagismRecord.missingImage === true
              ? ["Para fazer a simulacao, envie uma foto frontal, bem iluminada e sem cortes no rosto."]
              : result.parsed.reply_blocks;
      }
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
      if (nativeFollowupApplication.needsClarification && result.parsed.reply_blocks.length === 0) {
        result.parsed.reply_blocks.push(AGENT_FOLLOWUP_CLARIFICATION_REPLY);
      } else if (nativeFollowupApplication.scheduled && result.parsed.reply_blocks.length === 0) {
        result.parsed.reply_blocks.push("Combinado. Vou te chamar no horario combinado por aqui.");
      }
      let freezeUntil: string | null = null;
      const processedAt = latestInbound?.sent_at ?? bufferedEntries[bufferedEntries.length - 1]?.sentAt ?? new Date().toISOString();
      const lastAiReplyAt =
        result.parsed.reply_blocks.length > 0 || replyResult.parsed.media_asset_key
          ? new Date().toISOString()
          : null;
      const tokensIn =
        result.tokensIn === null && replyResult.tokensIn === null
          ? null
          : (result.tokensIn ?? 0) + (replyResult.tokensIn ?? 0);
      const tokensOut =
        result.tokensOut === null && replyResult.tokensOut === null
          ? null
          : (result.tokensOut ?? 0) + (replyResult.tokensOut ?? 0);
      const requestedMediaKey = replyResult.parsed.media_asset_key;

      let deliveryFormat: "audio" | "text" | null = null;
      if (result.parsed.reply_blocks.length > 0) {
        deliveryFormat = await this.sendReplyBlocks({
          agent,
          lead,
          blocks: result.parsed.reply_blocks,
          sourceType: "ai",
          runId,
          hasMediaAttachment: Boolean(requestedMediaKey),
        });
      }

      let mediaDelivery:
        | { succeeded: boolean; error?: string; duplicated?: boolean; messageId?: string; assetKey?: string }
        | null = null;
      if (requestedMediaKey) {
        mediaDelivery = await this.executeConfiguredMedia({
          agent,
          lead,
          runId,
          assetKey: requestedMediaKey,
        });

        if (!mediaDelivery.succeeded && result.parsed.reply_blocks.length === 0) {
          deliveryFormat = await this.sendReplyBlocks({
            agent,
            lead,
            blocks: ["Nao consegui enviar esse material agora. Posso tentar novamente em instantes."],
            sourceType: "ai",
            runId,
            hasMediaAttachment: true,
          });
        }
      }

      const handoffResult = await this.triggerHandoff(agent, lead, result.parsed, conversation);
      const shouldFreezeLead = result.parsed.should_pause || handoffResult.triggered;

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
        runId,
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
          reply_media_asset_key: requestedMediaKey,
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
          delivery_format: deliveryFormat,
          media_delivery: mediaDelivery,
          visagism: visagismApplication,
          freeze_until: freezeUntil,
        },
        suggestedStageId,
        appliedStageId: crmApplication.appliedStageId,
        confidence: result.parsed.confidence,
        actionTaken: crmApplication.stageChanged
          ? "stage_applied"
          : handoffResult.triggered
            ? "manual_pause"
            : result.parsed.reply_blocks.length > 0 || mediaDelivery?.succeeded
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
        runId,
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

    const candidateAgent = await this.getAnyAgentByInstance(message.instanceName, instance.aces_id);
    const duplicated = await this.dedupeIncomingMessage(message.messageId);
    if (duplicated) {
      return { ignored: true, reason: "Mensagem duplicada" };
    }

    const existingLeadForRouting = await this.findLeadByPhone(instance.aces_id, message.phone);
    const isPrimaryInstance =
      !existingLeadForRouting || existingLeadForRouting.instancia === message.instanceName;
    const hasAdditionalMembership =
      existingLeadForRouting && !isPrimaryInstance
        ? await this.hasActiveLeadInstanceMembership(
            instance.aces_id,
            existingLeadForRouting.id,
            message.instanceName
          )
        : false;
    const instanceAuthorized = isPrimaryInstance || hasAdditionalMembership;
    const agent = instanceAuthorized ? candidateAgent : null;
    const ownerIdForLead = hasAdditionalMembership ? null : agent?.created_by ?? null;
    const normalizedContent = await this.shouldAnalyzeOpticsImage(agent, message)
      ? "[imagem recebida para analise optica]"
      : await this.normalizeInboundContent(message);

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
        ownerIdForLead
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
      ownerIdForLead
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
      temperature: 0.4,
      buffer_wait_ms: 15000,
      human_pause_minutes: 60,
      auto_apply_threshold: 0.85,
      handoff_enabled: false,
      handoff_prompt: null,
      handoff_target_phone: null,
      template_key: null,
      template_version: null,
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

  private async loadVisagismLeadAnswers(acesId: number, leadId: string) {
    const { data, error } = await this.serviceClient
      .from("lead_tool_answers")
      .select("question_key, answer_text, answer_value, answered_at")
      .eq("aces_id", acesId)
      .eq("lead_id", leadId)
      .eq("tool_key", "visagism")
      .in("question_key", ["desired_perception", "desired_feeling"])
      .order("answered_at", { ascending: true });
    if (error) throw new HttpError(500, "Nao foi possivel carregar as respostas de visagismo", error);
    return (data ?? []) as VisagismLeadAnswerRow[];
  }

  private async persistVisagismLeadAnswers(params: {
    agent: AgentRow;
    lead: LeadRow;
    decision: VisagismDecision;
    sourceMessageId: string | null;
  }) {
    const existingAnswers = await this.loadVisagismLeadAnswers(params.agent.aces_id, params.lead.id);
    const existingKeys = new Set(existingAnswers.map((answer) => answer.question_key));
    const candidates = [
      {
        questionKey: "desired_perception",
        answer:
          params.decision.desired_perception_answer ??
          (existingKeys.has("desired_perception") ? null : params.lead.como_quer_ser_percebido),
      },
      {
        questionKey: "desired_feeling",
        answer:
          params.decision.desired_feeling_answer ??
          (existingKeys.has("desired_feeling") ? null : params.lead.qual_imagem_passar),
      },
    ].filter((item): item is { questionKey: string; answer: string } => Boolean(item.answer?.trim()));

    if (candidates.length > 0) {
      const answeredAt = new Date().toISOString();
      const { error } = await this.serviceClient.from("lead_tool_answers").upsert(
        candidates.map((item) => ({
          aces_id: params.agent.aces_id,
          lead_id: params.lead.id,
          tool_key: "visagism",
          question_key: item.questionKey,
          answer_text: item.answer.trim(),
          answer_value: null,
          source_message_id: params.sourceMessageId,
          answered_at: answeredAt,
        })),
        { onConflict: "aces_id,lead_id,tool_key,question_key" }
      );
      if (error) throw new HttpError(500, "Nao foi possivel salvar a qualificacao do visagismo", error);
    }

    const legacyUpdates: JsonRecord = {};
    if (params.decision.desired_perception_answer) {
      legacyUpdates.como_quer_ser_percebido = params.decision.desired_perception_answer;
    }
    if (params.decision.desired_feeling_answer) {
      legacyUpdates.qual_imagem_passar = params.decision.desired_feeling_answer;
    }
    if (Object.keys(legacyUpdates).length > 0) {
      const { error } = await this.serviceClient.from("leads").update(legacyUpdates)
        .eq("id", params.lead.id).eq("aces_id", params.agent.aces_id);
      if (error) throw new HttpError(500, "Nao foi possivel espelhar a qualificacao legada", error);
    }

    return this.loadVisagismLeadAnswers(params.agent.aces_id, params.lead.id);
  }

  private async findLatestVisagismSelection(acesId: number, leadId: string) {
    const { data, error } = await this.agentsClient
      .from("agent_tool_runs")
      .select("output_snapshot")
      .eq("aces_id", acesId)
      .eq("lead_id", leadId)
      .eq("tool_key", "visagism")
      .eq("status", "succeeded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new HttpError(500, "Nao foi possivel carregar a ultima selecao de visagismo", error);
    const snapshot = asRecord(data?.output_snapshot);
    return {
      selectedItemId: asString(snapshot.selected_item_id),
    };
  }

  private async listActiveVisagismCatalog(acesId: number) {
    const { data, error } = await this.agentsClient
      .from("visagism_catalog_items")
      .select("*")
      .eq("aces_id", acesId)
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new HttpError(500, "Nao foi possivel carregar o catalogo ativo de visagismo", error);
    return (data ?? []) as VisagismCatalogItemRow[];
  }

  private async matchVisagismCatalogItem(params: {
    catalog: VisagismCatalogItemRow[];
    answers: VisagismLeadAnswerRow[];
    faceAnalysis: FaceAnalysis | null;
    excludedItemId: string | null;
    priorSelectedItemId: string | null;
  }) {
    const excluded = new Set(
      [params.excludedItemId, params.priorSelectedItemId].filter((id): id is string => Boolean(id))
    );
    const alternatives = params.catalog.filter((item) => !excluded.has(item.id));
    const eligible = alternatives.length > 0 ? alternatives : params.catalog;
    if (eligible.length === 0) return null;

    const fallback = pickVisagismCatalogItem({
      catalog: eligible.map((item) => ({
        id: item.id,
        productCode: item.product_code,
        displayOrder: item.display_order,
      })),
    });
    const fallbackItem = eligible.find((item) => item.id === fallback?.id) ?? eligible[0];

    try {
      const prompt = [
        "Voce seleciona uma unica armacao para um atendimento de visagismo.",
        "Retorne somente JSON com selected_item_id e reason.",
        "O selected_item_id deve ser exatamente um ID da lista recebida.",
        `Analise facial: ${JSON.stringify(params.faceAnalysis)}`,
        `Qualificacao: ${JSON.stringify(params.answers.map((answer) => ({ question: answer.question_key, answer: answer.answer_text })))}`,
        `Catalogo permitido: ${JSON.stringify(eligible.map((item) => ({
          item_id: item.id,
          product: item.product_code,
          description: item.recommendation_description,
          attributes: item.attributes,
        })))}`,
      ].join("\n");
      const { result, modelName } = await this.generateGeminiContent(this.visagismMatchingWorkerModel, prompt);
      const parsed = asRecord(JSON.parse(result.response.text().trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "")));
      const selectedId = asString(parsed.selected_item_id);
      const selected = eligible.find((item) => item.id === selectedId);
      if (!selected) throw new Error("Worker selecionou item fora do catalogo autorizado");
      return { item: selected, modelName, reason: asString(parsed.reason), usedFallback: false };
    } catch (error) {
      return {
        item: fallbackItem,
        modelName: this.visagismMatchingWorkerModel,
        reason: `fallback_deterministico:${truncateText(error instanceof Error ? error.message : "erro desconhecido", 200)}`,
        usedFallback: true,
      };
    }
  }

  private async startVisagismRunInternal(params: {
    agent: AgentRow;
    lead: LeadRow;
    sourceMessageId: string | null;
    excludedItemId: string | null;
    faceAnalysis: FaceAnalysis | null;
  }) {
    if (!this.visagismToolEnabled || !this.visagismInternalRuntimeEnabled) {
      throw new HttpError(409, "Visagismo interno esta desativado por feature flag");
    }
    const binding = await this.getEnabledAgentTool(params.agent, "visagism");
    if (!binding) throw new HttpError(409, "Tool Visagismo precisa estar pronta e habilitada");

    const [answers, sourceAttachment, catalog, previousSelection] = await Promise.all([
      this.loadVisagismLeadAnswers(params.agent.aces_id, params.lead.id),
      this.loadLatestLeadImageAttachment(params.agent.aces_id, params.lead.id, params.sourceMessageId),
      this.listActiveVisagismCatalog(params.agent.aces_id),
      this.findLatestVisagismSelection(params.agent.aces_id, params.lead.id),
    ]);
    const ready = Boolean(sourceAttachment && answers.length >= 2 && catalog.length > 0);
    const idempotencyKey = `visagism:${params.lead.id}:${sourceAttachment?.messageId ?? "no-image"}`;
    const { data: existing, error: existingError } = await this.agentsClient
      .from("agent_tool_runs")
      .select("id, status, attempt_count, output_snapshot, error_message")
      .eq("aces_id", params.agent.aces_id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError) throw new HttpError(500, "Nao foi possivel verificar execucao duplicada", existingError);
    const idempotencyAction = resolveVisagismIdempotencyAction(existing?.status ?? null, ready);
    if (existing && idempotencyAction === "return_existing") {
      return {
        runId: String(existing.id),
        status: String(existing.status) as "waiting_input" | "running" | "succeeded" | "failed",
        selectedItemId: asString(asRecord(existing.output_snapshot).selected_item_id),
        duplicated: true,
        error: asString(existing.error_message),
      };
    }

    const toolRunId = existing ? String(existing.id) : randomUUID();
    const inputSnapshot = {
      source_message_id: sourceAttachment?.messageId ?? null,
      source_attachment_path: sourceAttachment?.storagePath ?? null,
      answers,
      face_analysis: params.faceAnalysis,
      catalog_item_ids: catalog.map((item) => item.id),
      excluded_item_id: params.excludedItemId,
    };
    if (existing && idempotencyAction === "resume") {
      const { error } = await this.agentsClient.from("agent_tool_runs").update({
        status: "running",
        input_snapshot: inputSnapshot,
        error_code: null,
        error_message: null,
        started_at: new Date().toISOString(),
        completed_at: null,
      }).eq("id", toolRunId).eq("aces_id", params.agent.aces_id).eq("status", "waiting_input");
      if (error) throw new HttpError(500, "Nao foi possivel retomar a execucao de visagismo", error);
    } else {
      const { error: insertError } = await this.agentsClient.from("agent_tool_runs").insert({
        id: toolRunId,
        aces_id: params.agent.aces_id,
        agent_id: params.agent.id,
        agent_tool_id: binding.id,
        lead_id: params.lead.id,
        tool_key: "visagism",
        status: ready ? "running" : "waiting_input",
        idempotency_key: idempotencyKey,
        attempt_count: 1,
        provider: "internal",
        model: `${this.visagismAnalysisWorkerModel}/${this.visagismMatchingWorkerModel}/${this.visagismImageWorkerModel}`,
        input_snapshot: inputSnapshot,
        queued_at: new Date().toISOString(),
        started_at: ready ? new Date().toISOString() : null,
      });
      if (insertError?.code === "23505") {
        const { data: raced } = await this.agentsClient.from("agent_tool_runs")
          .select("id, status, output_snapshot").eq("aces_id", params.agent.aces_id)
          .eq("idempotency_key", idempotencyKey).maybeSingle();
        return {
          runId: String(raced?.id),
          status: String(raced?.status ?? "running") as "waiting_input" | "running" | "succeeded" | "failed",
          selectedItemId: asString(asRecord(raced?.output_snapshot).selected_item_id),
          duplicated: true,
        };
      }
      if (insertError) throw new HttpError(500, "Nao foi possivel iniciar a execucao de visagismo", insertError);
    }

    await this.enqueueBiEvent({
      acesId: params.agent.aces_id,
      aggregateType: "tool_run",
      aggregateId: toolRunId,
      eventType: ready ? "tool.visagism.started" : "tool.visagism.waiting_input",
      payload: {
        tool_key: "visagism",
        tool_run_id: toolRunId,
        lead_id: params.lead.id,
        agent_id: params.agent.id,
        status: ready ? "running" : "waiting_input",
        missing_source_image: !sourceAttachment,
        missing_answers: answers.length < 2,
        missing_catalog: catalog.length === 0,
      },
    });
    if (!ready || !sourceAttachment) return { runId: toolRunId, status: "waiting_input" as const };

    const match = await this.matchVisagismCatalogItem({
      catalog,
      answers,
      faceAnalysis: params.faceAnalysis,
      excludedItemId: params.excludedItemId,
      priorSelectedItemId: previousSelection.selectedItemId,
    });
    if (!match) return { runId: toolRunId, status: "waiting_input" as const };

    await this.enqueueBiEvent({
      acesId: params.agent.aces_id,
      aggregateType: "tool_run",
      aggregateId: toolRunId,
      eventType: "tool.visagism.product_selected",
      payload: {
        tool_key: "visagism",
        tool_run_id: toolRunId,
        lead_id: params.lead.id,
        agent_id: params.agent.id,
        status: "selected",
        selected_item_id: match.item.id,
        matching_model: match.modelName,
        matching_fallback: match.usedFallback,
      },
    });
    return this.executeVisagismRun({
      toolRunId,
      agent: params.agent,
      lead: params.lead,
      sourceAttachment,
      answers,
      faceAnalysis: params.faceAnalysis,
      selectedItem: match.item,
      matching: { modelName: match.modelName, reason: match.reason, usedFallback: match.usedFallback },
    });
  }

  private async loadLatestLeadImageAttachment(
    acesId: number,
    leadId: string,
    sourceMessageId?: string | null
  ) {
    let query = this.serviceClient
      .from("message_attachments")
      .select("message_id, storage_bucket, storage_path, file_name, mime_type, file_size, created_at")
      .eq("aces_id", acesId)
      .eq("lead_id", leadId)
      .eq("kind", "image")
      .order("created_at", { ascending: false })
      .limit(1);

    if (sourceMessageId) {
      query = query.eq("message_id", sourceMessageId);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw new HttpError(500, "Nao foi possivel carregar a imagem do lead", error);
    if (!data) return null;
    return {
      messageId: String(data.message_id),
      storagePath: String(data.storage_path),
      fileName: String(data.file_name ?? "source.jpg"),
      mimeType: String(data.mime_type ?? "image/jpeg"),
      fileSize: Number(data.file_size ?? 0),
    };
  }

  private async renderVisagismImage(params: {
    sourceAttachment: { storagePath: string; mimeType: string; fileName: string };
    selectedItem: VisagismCatalogItemRow;
    answers: VisagismLeadAnswerRow[];
    faceAnalysis: FaceAnalysis | null;
  }) {
    if (!this.openai || !this.visagismInternalRuntimeEnabled) {
      throw new Error("Runtime interno de visagismo nao configurado");
    }

    const perception =
      params.answers.find((answer) => answer.question_key === "desired_perception")?.answer_text ??
      "";
    const feeling =
      params.answers.find((answer) => answer.question_key === "desired_feeling")?.answer_text ?? "";
    const prompt = [
      "Edite a foto do cliente para experimentar a armacao indicada.",
      "Mantenha o rosto, pele, pose e cenario da foto original o mais fiéis possivel.",
      "Nao invente objetos, textos ou pessoas adicionais.",
      "Substitua os oculos existentes pela armacao selecionada quando houver oculos na imagem.",
      "A primeira imagem e a foto do cliente. A segunda imagem e a armacao exata que deve ser aplicada.",
      "Nao devolva a foto original sem a armacao e nao substitua a armacao por outro modelo.",
      `Armacao selecionada: ${params.selectedItem.product_code}.`,
      `Descricao da armacao: ${params.selectedItem.recommendation_description}.`,
      params.faceAnalysis ? `Analise facial: ${JSON.stringify(params.faceAnalysis)}.` : null,
      perception ? `Percepcao desejada: ${perception}.` : null,
      feeling ? `Sensacao desejada: ${feeling}.` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join(" ");

    const imagesApi = this.openai.images;

    const [{ data: sourceFile, error: sourceError }, frame] = await Promise.all([
      this.serviceClient.storage.from(CHAT_ATTACHMENTS_BUCKET).download(params.sourceAttachment.storagePath),
      this.downloadRegisteredMedia(params.selectedItem.source_url),
    ]);
    if (sourceError || !sourceFile) throw new HttpError(500, "Nao foi possivel baixar a foto do visagismo", sourceError);
    if (frame.kind !== "image") throw new Error("O item selecionado nao possui uma imagem de armacao valida");
    const sourceBuffer = Buffer.from(await sourceFile.arrayBuffer());
    if (sourceBuffer.byteLength === 0 || sourceBuffer.byteLength > CHAT_ATTACHMENT_MAX_FILE_SIZE) {
      throw new Error("Tamanho da foto do visagismo invalido");
    }
    const imageInputs = await Promise.all([
      toFile(sourceBuffer, params.sourceAttachment.fileName, { type: params.sourceAttachment.mimeType }),
      toFile(frame.buffer, `${params.selectedItem.product_code}.${frame.extension}`, { type: frame.mimeType }),
    ]);
    const request = createVisagismEditRequest(this.visagismImageWorkerModel, prompt, imageInputs);
    const response = await invokeVisagismImageEdit(
      (input) => imagesApi.edit(input),
      request
    );

    const item = response?.data?.[0];
    const base64 = asString(item?.b64_json) ?? null;
    const url = asString(item?.url) ?? null;
    if (!base64 && !url) {
      throw new Error("A imagem gerada pelo worker nao retornou conteudo");
    }

    if (base64) {
      const generated = Buffer.from(base64, "base64");
      if (generated.byteLength === 0) throw new Error("Worker retornou imagem vazia");
      return generated;
    }

    const fetched = await axios.get<ArrayBuffer>(url!, { responseType: "arraybuffer", timeout: 30000 });
    const generated = Buffer.from(fetched.data);
    if (generated.byteLength === 0) throw new Error("Worker retornou imagem vazia");
    return generated;
  }

  private async executeVisagismRun(params: {
    toolRunId: string;
    agent: AgentRow;
    lead: LeadRow;
    sourceAttachment: { storagePath: string; mimeType: string; fileName: string; messageId: string };
    answers: VisagismLeadAnswerRow[];
    faceAnalysis: FaceAnalysis | null;
    selectedItem: VisagismCatalogItemRow;
    matching: { modelName: string; reason: string | null; usedFallback: boolean };
  }) {
    const snapshot: VisagismRunSnapshot = {
      desiredPerception:
        params.answers.find((answer) => answer.question_key === "desired_perception")?.answer_text ??
        null,
      desiredFeeling:
        params.answers.find((answer) => answer.question_key === "desired_feeling")?.answer_text ??
        null,
      selectedItemId: params.selectedItem.id,
      analysis: {
        answers_count: params.answers.length,
        source_message_id: params.sourceAttachment.messageId,
        face: params.faceAnalysis,
        matching: params.matching,
      },
      image: {},
    };

    let generated: Buffer;
    let outputStoragePath: string | null = null;
    let dispatched = false;
    let retryUsed = false;
    try {
      try {
        generated = await this.renderVisagismImage({
          sourceAttachment: params.sourceAttachment,
          selectedItem: params.selectedItem,
          answers: params.answers,
          faceAnalysis: params.faceAnalysis,
        });
      } catch (firstError) {
        if (!isTransientVisagismError(firstError)) throw firstError;
        retryUsed = true;
        await this.agentsClient.from("agent_tool_runs").update({ attempt_count: 2 }).eq("id", params.toolRunId);
        generated = await this.renderVisagismImage({
          sourceAttachment: params.sourceAttachment,
          selectedItem: params.selectedItem,
          answers: params.answers,
          faceAnalysis: params.faceAnalysis,
        });
      }

      await this.enqueueBiEvent({
        acesId: params.agent.aces_id,
        aggregateType: "tool_run",
        aggregateId: params.toolRunId,
        eventType: "tool.visagism.image_generated",
        payload: {
          tool_key: "visagism",
          tool_run_id: params.toolRunId,
          lead_id: params.lead.id,
          agent_id: params.agent.id,
          status: "generated",
          selected_item_id: params.selectedItem.id,
          image_model: this.visagismImageWorkerModel,
        },
      });

      const messageId = randomUUID();
      const attachmentId = randomUUID();
      const fileName = `visagism-${params.toolRunId}.png`;
      const storagePath = buildAttachmentStoragePath({
        acesId: params.agent.aces_id,
        leadId: params.lead.id,
        messageId,
        attachmentId,
        fileName,
      });

      const { error: uploadError } = await this.serviceClient.storage
        .from(CHAT_ATTACHMENTS_BUCKET)
        .upload(storagePath, generated, { contentType: "image/png", upsert: false });
      if (uploadError) throw new HttpError(500, "Nao foi possivel salvar a imagem de visagismo", uploadError);
      outputStoragePath = storagePath;

      const mediaUrl = await this.createSignedDownloadUrl(storagePath);
      const phone = requireValue(params.lead.contact_phone, "Lead sem telefone para envio do visagismo");
      const instanceName = requireValue(
        params.agent.instance_name || params.lead.instancia,
        "Instancia de envio nao definida"
      );
      const transport = await this.resolveEvolutionTransport(instanceName, params.agent.aces_id);
      const provider = new EvolutionWhatsAppProvider({
        evolutionApiUrl: transport.apiUrl,
        evolutionApiKey: transport.apiKey,
      });
      const caption = "Aqui esta a armacao que mais combina com voce!";
      const sendInput: SendMediaInput = {
        instanceName: transport.instanceName,
        to: phone,
        mediaUrl,
        mimeType: "image/png",
        fileName,
        kind: "image",
        caption,
        sourceType: "ai",
      };
      let providerResult: SendResult;
      try {
        providerResult = await provider.sendMedia(sendInput);
      } catch (firstError) {
        if (retryUsed || !isTransientVisagismError(firstError)) throw firstError;
        retryUsed = true;
        await this.agentsClient.from("agent_tool_runs").update({ attempt_count: 2 }).eq("id", params.toolRunId);
        providerResult = await provider.sendMedia(sendInput);
      }
      dispatched = true;
      const sentAt = new Date().toISOString();
      await this.saveMessage({
        id: messageId,
        leadId: params.lead.id,
        acesId: params.lead.aces_id,
        content: caption,
        direction: "outbound",
        sourceType: "ai",
        instanceName,
        conversationId: `ai-visagism:${params.toolRunId}`,
        sentAt,
        provider: providerResult.provider,
        providerMessageId: providerResult.providerMessageId,
        providerStatus: providerResult.providerStatus,
        providerPayloadSummary: {
          tool_key: "visagism",
          selected_item_id: params.selectedItem.id,
          matching_model: params.matching.modelName,
          provider: summarizeProviderPayload(providerResult.raw),
        },
        senderAgentId: params.agent.id,
      });
      await this.insertStoredMessageAttachment({
        attachmentId,
        messageId,
        acesId: params.lead.aces_id,
        leadId: params.lead.id,
        kind: "image",
        mimeType: "image/png",
        storagePath,
        fileName,
        fileSize: generated.byteLength,
      });
      await this.agentsClient
        .from("agent_tool_runs")
        .update({
          status: "succeeded",
          output_snapshot: {
            ...snapshot,
            output_message_id: messageId,
            output_attachment_id: attachmentId,
            selected_item_id: params.selectedItem.id,
          },
          completed_at: sentAt,
        })
        .eq("id", params.toolRunId);

      const { count: simulationsCount } = await this.agentsClient.from("agent_tool_runs")
        .select("id", { count: "exact", head: true })
        .eq("aces_id", params.agent.aces_id)
        .eq("lead_id", params.lead.id)
        .eq("tool_key", "visagism")
        .eq("status", "succeeded");

      await this.enqueueBiEvent({
        acesId: params.agent.aces_id,
        aggregateType: "tool_run",
        aggregateId: params.toolRunId,
        eventType: "tool.visagism.sent",
        payload: {
          tool_key: "visagism",
          tool_run_id: params.toolRunId,
          lead_id: params.lead.id,
          agent_id: params.agent.id,
          status: "succeeded",
          selected_item_id: params.selectedItem.id,
          facts: [
            snapshot.desiredPerception
              ? { namespace: "visagism", fact_key: "desired_perception", value_type: "text", value: snapshot.desiredPerception }
              : null,
            snapshot.desiredFeeling
              ? { namespace: "visagism", fact_key: "desired_feeling", value_type: "text", value: snapshot.desiredFeeling }
              : null,
            params.faceAnalysis?.faceShape
              ? { namespace: "face", fact_key: "shape", value_type: "text", value: params.faceAnalysis.faceShape }
              : null,
            { namespace: "visagism", fact_key: "selected_product_id", value_type: "text", value: params.selectedItem.id },
            { namespace: "visagism", fact_key: "simulations_count", value_type: "numeric", value: Number(simulationsCount ?? 1) },
          ].filter(Boolean),
        },
      });

      return { runId: params.toolRunId, status: "succeeded" as const, selectedItemId: params.selectedItem.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida no visagismo";
      if (outputStoragePath && !dispatched) {
        await this.serviceClient.storage.from(CHAT_ATTACHMENTS_BUCKET).remove([outputStoragePath]);
      }
      await this.agentsClient
        .from("agent_tool_runs")
        .update({
          status: "failed",
          error_message: truncateText(message, 1000),
          output_snapshot: snapshot,
          completed_at: new Date().toISOString(),
        })
        .eq("id", params.toolRunId);
      await this.enqueueBiEvent({
        acesId: params.agent.aces_id,
        aggregateType: "tool_run",
        aggregateId: params.toolRunId,
        eventType: "tool.visagism.failed",
        payload: {
          tool_key: "visagism",
          tool_run_id: params.toolRunId,
          lead_id: params.lead.id,
          agent_id: params.agent.id,
          status: "failed",
          error: truncateText(message, 500),
        },
      });
      return { runId: params.toolRunId, status: "failed" as const, error: message };
    }
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
