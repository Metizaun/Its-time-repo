import axios from "axios";

import {
  summarizeProviderPayload,
  toBrazilE164Phone,
  type SendMediaInput,
  type SendResult,
  type SendTemplateInput,
  type SendTextInput,
  type SendVoiceNoteInput,
  WhatsAppProviderError,
  type WhatsAppProvider,
} from "./whatsapp-provider.js";

const GUPSHUP_API_BASE = "https://api.gupshup.io/wa/api/v1";
const GUPSHUP_REQUEST_TIMEOUT_MS = 15_000;

export type GupshupWhatsAppProviderConfig = {
  apiKey: string;
  appName: string;
  phoneNumber: string;
};

export class GupshupWhatsAppProvider implements WhatsAppProvider {
  constructor(private readonly config: GupshupWhatsAppProviderConfig) {}

  async sendText(input: SendTextInput): Promise<SendResult> {
    return this.sendMessage(input.to, { type: "text", text: input.text });
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    const message = this.buildMediaMessage(input);
    if (input.templateName?.trim()) {
      return this.sendTemplateMessage(
        input.to,
        {
          id: input.templateName.trim(),
          params: input.templateParameters ?? [],
        },
        message
      );
    }

    return this.sendMessage(input.to, message);
  }

  private buildMediaMessage(input: SendMediaInput) {
    if (input.kind === "image") {
      return {
        type: "image",
        originalUrl: input.mediaUrl,
        previewUrl: input.mediaUrl,
        ...(input.caption?.trim() ? { caption: input.caption.trim() } : {}),
      };
    }

    if (input.kind === "audio") {
      return { type: "audio", url: input.mediaUrl };
    }

    return {
      type: "file",
      url: input.mediaUrl,
      filename: input.fileName,
    };
  }

  async sendVoiceNote(input: SendVoiceNoteInput): Promise<SendResult> {
    return this.sendMessage(input.to, { type: "audio", url: input.mediaUrl });
  }

  private async sendMessage(toPhone: string, message: Record<string, unknown>): Promise<SendResult> {
    const to = toBrazilE164Phone(toPhone);
    const source = toBrazilE164Phone(this.config.phoneNumber);
    try {
      const params = new URLSearchParams({
        channel: "whatsapp",
        source,
        destination: to,
        "src.name": this.config.appName,
        message: JSON.stringify(message),
      });

      const response = await axios.post(`${GUPSHUP_API_BASE}/msg`, params.toString(), {
        headers: {
          accept: "application/json",
          apikey: this.config.apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: GUPSHUP_REQUEST_TIMEOUT_MS,
      });

      return {
        provider: "gupshup",
        providerMessageId: extractGupshupMessageId(response.data),
        providerStatus: "accepted",
        raw: summarizeProviderPayload(response.data),
      };
    } catch (error) {
      throw buildGupshupProviderError(error);
    }
  }

  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    return this.sendTemplateMessage(input.to, {
      id: input.templateName,
      params: input.parameters,
    });
  }

  private async sendTemplateMessage(
    toPhone: string,
    template: { id: string; params: string[] },
    message?: Record<string, unknown>
  ): Promise<SendResult> {
    const to = toBrazilE164Phone(toPhone);
    const source = toBrazilE164Phone(this.config.phoneNumber);
    try {
      const params = new URLSearchParams({
        channel: "whatsapp",
        source,
        destination: to,
        "src.name": this.config.appName,
        template: JSON.stringify(template),
      });

      if (message) {
        params.set("message", JSON.stringify(message));
      }

      const response = await axios.post(`${GUPSHUP_API_BASE}/template/msg`, params.toString(), {
        headers: {
          accept: "application/json",
          apikey: this.config.apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: GUPSHUP_REQUEST_TIMEOUT_MS,
      });

      return {
        provider: "gupshup",
        providerMessageId: extractGupshupMessageId(response.data),
        providerStatus: "accepted",
        raw: summarizeProviderPayload(response.data),
      };
    } catch (error) {
      throw buildGupshupProviderError(error);
    }
  }
}

function extractGupshupMessageId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const root = value as Record<string, unknown>;
  const messageId = root.messageId ?? root.message_id;
  if (typeof messageId === "string" && messageId.trim()) return messageId.trim();
  const message = root.message as Record<string, unknown> | null;
  if (typeof message === "object" && message !== null) {
    const id = message.id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

function buildGupshupProviderError(error: unknown): WhatsAppProviderError {
  const statusCode = axios.isAxiosError(error) ? error.response?.status ?? null : null;
  const errorCode = axios.isAxiosError(error) && typeof error.code === "string"
    ? error.code.toUpperCase() : null;
  const payload = axios.isAxiosError(error) ? error.response?.data ?? error.message : error;
  const kind =
    statusCode !== null && [429, 500, 502, 503, 504].includes(statusCode)
      ? "transient"
      : errorCode !== null && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(errorCode)
        ? "transient"
        : "permanent";

  return new WhatsAppProviderError("Falha ao enviar mensagem na Gupshup", {
    provider: "gupshup",
    kind,
    statusCode,
    errorCode,
    payloadSummary: summarizeProviderPayload(payload),
  });
}
