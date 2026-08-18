export type WhatsAppProviderName = "evolution" | "meta" | "gupshup";

export type WhatsAppSourceType = "manual" | "ai" | "automation" | "system";

export type SendTextInput = {
  instanceName: string;
  to: string;
  text: string;
  sourceType: WhatsAppSourceType;
};

export type SendTemplateInput = {
  instanceName: string;
  to: string;
  templateName: string;
  languageCode: string;
  parameters: string[];
  sourceType: WhatsAppSourceType;
};

export type SendMediaInput = {
  instanceName: string;
  to: string;
  mediaUrl: string;
  mimeType: string;
  fileName: string;
  kind: "image" | "video" | "audio" | "document";
  caption?: string | null;
  templateName?: string | null;
  languageCode?: string | null;
  templateParameters?: string[];
  sourceType: WhatsAppSourceType;
};

export type SendVoiceNoteInput = {
  instanceName: string;
  to: string;
  mediaUrl: string;
  sourceType: WhatsAppSourceType;
};

export type SendResult = {
  provider: WhatsAppProviderName;
  providerMessageId: string | null;
  providerStatus: "accepted" | "sent" | "failed";
  raw?: unknown;
};

export interface WhatsAppProvider {
  sendText(input: SendTextInput): Promise<SendResult>;
  sendTemplate(input: SendTemplateInput): Promise<SendResult>;
  sendMedia?(input: SendMediaInput): Promise<SendResult>;
  sendVoiceNote?(input: SendVoiceNoteInput): Promise<SendResult>;
}

export class WhatsAppProviderError extends Error {
  constructor(
    message: string,
    public readonly options: {
      provider: WhatsAppProviderName;
      kind: "transient" | "permanent";
      statusCode?: number | null;
      errorCode?: string | null;
      payloadSummary?: unknown;
    }
  ) {
    super(message);
    this.name = "WhatsAppProviderError";
  }

  get provider() {
    return this.options.provider;
  }

  get kind() {
    return this.options.kind;
  }

  get statusCode() {
    return this.options.statusCode ?? null;
  }

  get errorCode() {
    return this.options.errorCode ?? null;
  }

  get payloadSummary() {
    return this.options.payloadSummary ?? null;
  }
}

export function normalizePhoneDigits(phone: string) {
  return phone.replace(/\D/g, "");
}

export function toBrazilE164Phone(phone: string) {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 10 || digits.length > 15) {
    throw new WhatsAppProviderError("Numero de WhatsApp invalido", {
      provider: "meta",
      kind: "permanent",
    });
  }

  if (digits.startsWith("55") && digits.length > 11) {
    return digits;
  }

  return digits.length <= 11 ? `55${digits}` : digits;
}

export function toEvolutionJid(phone: string) {
  return `${toBrazilE164Phone(phone)}@s.whatsapp.net`;
}

export function summarizeProviderPayload(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const pruned = pruneProviderPayload(value, new WeakSet<object>());
  const json = safeStringify(pruned);
  if (json && json.length <= PROVIDER_PAYLOAD_MAX_JSON_LENGTH) {
    return pruned;
  }

  const essential = extractEssentialProviderPayload(pruned);
  return {
    ...essential,
    _truncated: true,
    _originalLength: json?.length ?? null,
  };
}

const PROVIDER_PAYLOAD_MAX_JSON_LENGTH = 32_000;
const PROVIDER_PAYLOAD_MAX_STRING_LENGTH = 8_000;
const PROVIDER_PAYLOAD_MAX_THUMBNAIL_LENGTH = 24_000;
const PROVIDER_PAYLOAD_MAX_ARRAY_ITEMS = 50;
const OMITTED_PROVIDER_PAYLOAD_KEYS = new Set([
  "mediakey",
  "fileencsha256",
  "filesha256",
  "directpath",
  "streamingmetadata",
]);

function pruneProviderPayload(value: unknown, seen: WeakSet<object>, key = ""): unknown {
  if (key.toLowerCase() === "jpegthumbnail") {
    const thumbnail = normalizeProviderThumbnail(value);
    if (thumbnail) {
      return thumbnail.length <= PROVIDER_PAYLOAD_MAX_THUMBNAIL_LENGTH
        ? thumbnail
        : `${thumbnail.slice(0, PROVIDER_PAYLOAD_MAX_THUMBNAIL_LENGTH)}...[truncated]`;
    }
  }

  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const limit = key.toLowerCase() === "jpegthumbnail"
      ? PROVIDER_PAYLOAD_MAX_THUMBNAIL_LENGTH
      : PROVIDER_PAYLOAD_MAX_STRING_LENGTH;
    return value.length <= limit ? value : `${value.slice(0, limit)}...[truncated]`;
  }

  if (typeof value !== "object") {
    return String(value);
  }

  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return undefined;
  }

  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, PROVIDER_PAYLOAD_MAX_ARRAY_ITEMS)
      .map((item) => pruneProviderPayload(item, seen, key))
      .filter((item) => item !== undefined);
  }

  const result: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = entryKey.toLowerCase();
    if (
      OMITTED_PROVIDER_PAYLOAD_KEYS.has(normalizedKey) ||
      (normalizedKey.includes("base64") && normalizedKey !== "jpegthumbnail") ||
      normalizedKey === "buffer" ||
      normalizedKey === "buffers"
    ) {
      continue;
    }
    const next = pruneProviderPayload(entryValue, seen, entryKey);
    if (next !== undefined) result[entryKey] = next;
  }
  return result;
}

function normalizeProviderThumbnail(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64");
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString("base64");

  const record = asProviderRecord(value);
  if (record.type !== "Buffer" || !Array.isArray(record.data)) return null;
  const bytes = record.data.filter(
    (item): item is number => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 255,
  );
  return bytes.length === record.data.length ? Buffer.from(bytes).toString("base64") : null;
}

function extractEssentialProviderPayload(value: unknown): Record<string, unknown> {
  const root = asProviderRecord(value);
  const data = asProviderRecord(root.data);
  const message = stripProviderThumbnails(asProviderRecord(data.message));
  const essentialData: Record<string, unknown> = {};
  for (const key of ["key", "messageType", "pushName", "messageTimestamp", "messageData"]) {
    if (data[key] !== undefined) essentialData[key] = data[key];
  }
  if (Object.keys(message).length > 0) essentialData.message = message;

  const result: Record<string, unknown> = {};
  for (const key of ["event", "instance", "instanceName", "messageType", "messageId", "status", "error"]) {
    if (root[key] !== undefined) result[key] = root[key];
  }
  if (Object.keys(essentialData).length > 0) result.data = essentialData;
  return result;
}

function stripProviderThumbnails(value: Record<string, unknown>): Record<string, unknown> {
  const json = safeStringify(value);
  if (!json || json.length <= PROVIDER_PAYLOAD_MAX_JSON_LENGTH / 2) return value;

  const removeThumbnails = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(removeThumbnails);
    if (!current || typeof current !== "object") return current;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (key.toLowerCase() === "jpegthumbnail") continue;
      result[key] = removeThumbnails(child);
    }
    return result;
  };
  return asProviderRecord(removeThumbnails(value));
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function asProviderRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
