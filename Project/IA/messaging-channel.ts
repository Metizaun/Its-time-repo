import type { WhatsAppProviderName } from "./whatsapp-provider.js";

export type MessagingProviderName = WhatsAppProviderName | "instagram";

/** Every channel a stored message can arrive from. */
export type InboundProviderName = MessagingProviderName | "website";

export type MessagingChannelType = "whatsapp" | "instagram";

export type MessagingCapability = "manual_only" | "full" | "disabled";

export type MessagingChannelStatus =
  | "draft"
  | "active"
  | "disabled"
  | "error"
  | "reconnect_required";

export type MessagingSource = "human" | "ai" | "automation" | "system";

export type ConversationAddress =
  | { kind: "phone"; value: string }
  | { kind: "instagram_scoped_id"; value: string };

export type MessagingChannelBinding = {
  id: string;
  acesId: number;
  instanceName: string;
  channelType: MessagingChannelType;
  provider: MessagingProviderName;
  capability: MessagingCapability;
  status: MessagingChannelStatus;
};

export class MessagingChannelConfigurationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CHANNEL_NOT_CONFIGURED"
      | "INVALID_CHANNEL_CONFIGURATION"
      | "CHANNEL_INACTIVE"
      | "CHANNEL_TYPE_MISMATCH"
  ) {
    super(message);
    this.name = "MessagingChannelConfigurationError";
  }
}
