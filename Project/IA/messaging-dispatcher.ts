import { MessagingChannelResolver } from "./messaging-channel-resolver.js";
import type { MessagingProviderName, MessagingSource } from "./messaging-channel.js";
import { InstagramService } from "./instagram-service.js";
import { WhatsAppProviderRegistry } from "./whatsapp-provider-registry.js";

export type MessagingDispatchResult = {
  provider: MessagingProviderName;
  providerMessageId: string | null;
  providerStatus: "accepted" | "sent" | "failed";
  raw?: unknown;
};

export class MessagingDispatcher {
  constructor(
    private readonly channels: MessagingChannelResolver,
    private readonly whatsAppProviders: WhatsAppProviderRegistry,
    private readonly instagram: InstagramService | null,
  ) {}

  async dispatchText(input: {
    acesId: number;
    instanceName: string;
    leadId: string;
    phone: string | null;
    text: string;
    source: MessagingSource;
  }): Promise<MessagingDispatchResult> {
    const binding = await this.channels.resolve(input.acesId, input.instanceName);
    if (binding.provider === "instagram") {
      if (input.source !== "human") {
        throw new Error("Instagram esta disponivel somente para atendimento humano");
      }
      if (!this.instagram) throw new Error("Runtime Instagram indisponivel");
      const result = await this.instagram.sendText({
        acesId: input.acesId,
        instanceName: input.instanceName,
        leadId: input.leadId,
        text: input.text,
        source: "human",
      });
      return {
        provider: "instagram",
        providerMessageId: result.messageId,
        providerStatus: "sent",
        raw: result.tag ? { deliveryTag: result.tag } : undefined,
      };
    }

    if (!input.phone?.trim()) throw new Error("Lead sem telefone para envio WhatsApp");
    const provider = this.whatsAppProviders.getProvider(binding.provider);
    return provider.sendText({
      instanceName: input.instanceName,
      to: input.phone,
      text: input.text,
      sourceType: input.source === "human" ? "manual" : input.source,
    });
  }

  async dispatchMedia(input: {
    acesId: number;
    instanceName: string;
    leadId: string;
    phone: string | null;
    kind: "image" | "audio" | "document";
    mediaUrl: string;
    mimeType: string;
    fileName: string;
    caption: string | null;
    source: MessagingSource;
  }): Promise<MessagingDispatchResult> {
    const binding = await this.channels.resolve(input.acesId, input.instanceName);
    if (binding.provider === "instagram") {
      if (input.source !== "human") {
        throw new Error("Instagram esta disponivel somente para atendimento humano");
      }
      if (!this.instagram) throw new Error("Runtime Instagram indisponivel");
      if (input.kind === "document") throw new Error("Instagram aceita somente foto e audio");
      const result = await this.instagram.sendMedia({
        acesId: input.acesId,
        instanceName: input.instanceName,
        leadId: input.leadId,
        kind: input.kind,
        mediaUrl: input.mediaUrl,
        source: "human",
      });
      return {
        provider: "instagram",
        providerMessageId: result.messageId,
        providerStatus: "sent",
        raw: result.tag ? { deliveryTag: result.tag, mediaKind: input.kind } : { mediaKind: input.kind },
      };
    }

    if (!input.phone?.trim()) throw new Error("Lead sem telefone para envio WhatsApp");
    const provider = this.whatsAppProviders.getProvider(binding.provider);
    if (!provider.sendMedia) throw new Error(`Provider ${binding.provider} sem suporte a midia`);
    return provider.sendMedia({
      instanceName: input.instanceName,
      to: input.phone,
      mediaUrl: input.mediaUrl,
      mimeType: input.mimeType,
      fileName: input.fileName,
      kind: input.kind,
      caption: input.caption,
      sourceType: input.source === "human" ? "manual" : input.source,
    });
  }
}
