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
  kind: "image" | "audio" | "document";
  caption?: string | null;
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

  if (typeof value === "string") {
    return value.slice(0, 500);
  }

  if (typeof value !== "object") {
    return value;
  }

  try {
    const json = JSON.stringify(value);
    return JSON.parse(json.slice(0, 2000));
  } catch {
    return { type: "unserializable" };
  }
}
