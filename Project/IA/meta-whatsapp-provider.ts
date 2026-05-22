import axios from "axios";
import { randomUUID } from "node:crypto";

import {
  summarizeProviderPayload,
  toBrazilE164Phone,
  type SendResult,
  type SendTemplateInput,
  type SendTextInput,
  WhatsAppProviderError,
  type WhatsAppProvider,
} from "./whatsapp-provider.js";

export type MetaProviderMode = "mock" | "live";

export type MetaChannelConfig = {
  instanceName: string;
  phoneNumberId: string | null;
  accessTokenSecretRef: string | null;
  accessToken?: string | null;
};

export type MetaWhatsAppProviderConfig = {
  mode: MetaProviderMode;
  graphApiVersion: string;
  resolveChannel: (instanceName: string) => Promise<MetaChannelConfig | null>;
  resolveSecret?: (secretRef: string) => Promise<string | null> | string | null;
};

export class MetaWhatsAppProvider implements WhatsAppProvider {
  constructor(private readonly config: MetaWhatsAppProviderConfig) {}

  async sendText(input: SendTextInput): Promise<SendResult> {
    const channel = await this.requireChannel(input.instanceName);
    const to = toBrazilE164Phone(input.to);

    if (this.config.mode === "mock") {
      return buildMockResult("text", input.instanceName, to);
    }

    const accessToken = await this.requireAccessToken(channel);
    try {
      const response = await axios.post(
        this.messagesUrl(channel),
        {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: {
            body: input.text,
            preview_url: false,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      return buildGraphSendResult(response.data);
    } catch (error) {
      throw buildMetaProviderError(error);
    }
  }

  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    const channel = await this.requireChannel(input.instanceName);
    const to = toBrazilE164Phone(input.to);

    if (this.config.mode === "mock") {
      return buildMockResult("template", input.instanceName, to);
    }

    const accessToken = await this.requireAccessToken(channel);
    try {
      const response = await axios.post(
        this.messagesUrl(channel),
        {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: input.templateName,
            language: {
              code: input.languageCode,
            },
            components: buildTemplateComponents(input.parameters),
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      return buildGraphSendResult(response.data);
    } catch (error) {
      throw buildMetaProviderError(error);
    }
  }

  private async requireChannel(instanceName: string) {
    const channel = await this.config.resolveChannel(instanceName);
    if (!channel) {
      throw new WhatsAppProviderError("Canal Meta nao configurado para a instancia", {
        provider: "meta",
        kind: "permanent",
      });
    }

    if (this.config.mode !== "mock" && !channel.phoneNumberId) {
      throw new WhatsAppProviderError("phone_number_id Meta ausente", {
        provider: "meta",
        kind: "permanent",
      });
    }

    return channel;
  }

  private async requireAccessToken(channel: MetaChannelConfig) {
    const directToken = channel.accessToken?.trim();
    if (directToken) {
      return directToken;
    }

    const secretRef = channel.accessTokenSecretRef?.trim();
    if (!secretRef || !this.config.resolveSecret) {
      throw new WhatsAppProviderError("Access token Meta nao configurado", {
        provider: "meta",
        kind: "permanent",
      });
    }

    const token = await this.config.resolveSecret(secretRef);
    if (!token?.trim()) {
      throw new WhatsAppProviderError("Access token Meta nao resolvido", {
        provider: "meta",
        kind: "permanent",
      });
    }

    return token.trim();
  }

  private messagesUrl(channel: MetaChannelConfig) {
    return `https://graph.facebook.com/${this.config.graphApiVersion}/${channel.phoneNumberId}/messages`;
  }
}

function buildTemplateComponents(parameters: string[]) {
  if (parameters.length === 0) {
    return [];
  }

  return [
    {
      type: "body",
      parameters: parameters.map((text) => ({
        type: "text",
        text,
      })),
    },
  ];
}

function buildMockResult(kind: "text" | "template", instanceName: string, to: string): SendResult {
  return {
    provider: "meta",
    providerMessageId: `mock_wamid_${randomUUID()}`,
    providerStatus: "accepted",
    raw: {
      mode: "mock",
      kind,
      instanceName,
      to,
    },
  };
}

function buildGraphSendResult(value: unknown): SendResult {
  const providerMessageId = extractMetaMessageId(value);
  return {
    provider: "meta",
    providerMessageId,
    providerStatus: "accepted",
    raw: summarizeProviderPayload(value),
  };
}

function extractMetaMessageId(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const root = value as Record<string, unknown>;
  const messages = Array.isArray(root.messages) ? root.messages : [];
  const first = messages[0];
  if (typeof first !== "object" || first === null) {
    return null;
  }

  const id = (first as Record<string, unknown>).id;
  return typeof id === "string" && id.trim() ? id : null;
}

function buildMetaProviderError(error: unknown) {
  const statusCode = axios.isAxiosError(error) ? error.response?.status ?? null : null;
  const errorCode = extractGraphErrorCode(error);
  const payload = axios.isAxiosError(error) ? error.response?.data ?? error.message : error;
  const kind =
    statusCode !== null && [429, 500, 502, 503, 504].includes(statusCode)
      ? "transient"
      : "permanent";

  return new WhatsAppProviderError(extractGraphErrorMessage(error), {
    provider: "meta",
    kind,
    statusCode,
    errorCode,
    payloadSummary: summarizeProviderPayload(payload),
  });
}

function extractGraphErrorCode(error: unknown) {
  const payload = axios.isAxiosError(error) ? error.response?.data : null;
  const graphError = typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>).error
    : null;
  if (typeof graphError !== "object" || graphError === null) {
    return null;
  }

  const code = (graphError as Record<string, unknown>).code;
  return typeof code === "number" || typeof code === "string" ? String(code) : null;
}

function extractGraphErrorMessage(error: unknown) {
  const payload = axios.isAxiosError(error) ? error.response?.data : null;
  const graphError = typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>).error
    : null;
  if (typeof graphError === "object" && graphError !== null) {
    const message = (graphError as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) {
      return `Falha ao enviar mensagem na Meta: ${message}`;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return `Falha ao enviar mensagem na Meta: ${error.message}`;
  }

  return "Falha ao enviar mensagem na Meta";
}
