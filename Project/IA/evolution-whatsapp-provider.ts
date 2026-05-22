import axios from "axios";

import {
  summarizeProviderPayload,
  toEvolutionJid,
  type SendResult,
  type SendTemplateInput,
  type SendTextInput,
  WhatsAppProviderError,
  type WhatsAppProvider,
} from "./whatsapp-provider.js";

export type EvolutionWhatsAppProviderConfig = {
  evolutionApiUrl: string;
  evolutionApiKey: string;
};

export class EvolutionWhatsAppProvider implements WhatsAppProvider {
  constructor(private readonly config: EvolutionWhatsAppProviderConfig) {}

  async sendText(input: SendTextInput): Promise<SendResult> {
    try {
      const response = await axios.post(
        `${this.config.evolutionApiUrl}/message/sendText/${encodeURIComponent(input.instanceName)}`,
        {
          number: toEvolutionJid(input.to),
          text: input.text,
          delay: 1000,
        },
        {
          headers: { apikey: this.config.evolutionApiKey },
        }
      );

      return {
        provider: "evolution",
        providerMessageId: extractEvolutionMessageId(response.data),
        providerStatus: "sent",
        raw: summarizeProviderPayload(response.data),
      };
    } catch (error) {
      throw buildEvolutionProviderError(error);
    }
  }

  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    return this.sendText({
      instanceName: input.instanceName,
      to: input.to,
      text: input.parameters.length > 0 ? input.parameters.join(" ") : input.templateName,
      sourceType: input.sourceType,
    });
  }
}

function extractEvolutionMessageId(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const root = value as Record<string, unknown>;
  const key = typeof root.key === "object" && root.key !== null
    ? (root.key as Record<string, unknown>)
    : null;
  const candidates = [
    root.id,
    root.messageId,
    root.message_id,
    root.keyId,
    key?.id,
  ];

  const found = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  return typeof found === "string" ? found : null;
}

function buildEvolutionProviderError(error: unknown) {
  const statusCode = axios.isAxiosError(error) ? error.response?.status ?? null : null;
  const errorCode =
    axios.isAxiosError(error) && typeof error.code === "string" ? error.code.toUpperCase() : null;
  const payload = axios.isAxiosError(error) ? error.response?.data ?? error.message : error;
  const kind =
    statusCode !== null && [429, 500, 502, 503, 504].includes(statusCode)
      ? "transient"
      : errorCode !== null && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(errorCode)
        ? "transient"
        : "permanent";

  return new WhatsAppProviderError("Falha ao enviar mensagem na Evolution", {
    provider: "evolution",
    kind,
    statusCode,
    errorCode,
    payloadSummary: summarizeProviderPayload(payload),
  });
}
