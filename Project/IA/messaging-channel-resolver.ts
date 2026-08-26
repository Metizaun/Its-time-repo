import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MessagingChannelConfigurationError,
  type MessagingCapability,
  type MessagingChannelBinding,
  type MessagingChannelStatus,
  type MessagingChannelType,
  type MessagingProviderName,
} from "./messaging-channel.js";
import type { WhatsAppProviderName } from "./whatsapp-provider.js";

const CHANNEL_TYPES = new Set<MessagingChannelType>(["whatsapp", "instagram"]);
const PROVIDERS = new Set<MessagingProviderName>(["evolution", "meta", "gupshup", "instagram"]);
const CAPABILITIES = new Set<MessagingCapability>(["manual_only", "full", "disabled"]);
const STATUSES = new Set<MessagingChannelStatus>([
  "draft",
  "active",
  "disabled",
  "error",
  "reconnect_required",
]);

type ChannelRow = {
  id?: unknown;
  aces_id?: unknown;
  instance_name?: unknown;
  channel_type?: unknown;
  provider?: unknown;
  capability?: unknown;
  status?: unknown;
};

export class MessagingChannelResolver {
  constructor(private readonly crmClient: SupabaseClient<any, any, any>) {}

  async resolve(acesId: number, instanceName: string): Promise<MessagingChannelBinding> {
    const normalizedInstanceName = instanceName.trim();
    if (!Number.isInteger(acesId) || acesId <= 0 || !normalizedInstanceName) {
      throw new MessagingChannelConfigurationError(
        "Tenant ou instancia de mensageria invalido",
        "INVALID_CHANNEL_CONFIGURATION"
      );
    }

    const { data, error } = await this.crmClient
      .from("instance_channels")
      .select("id, aces_id, instance_name, channel_type, provider, capability, status")
      .eq("aces_id", acesId)
      .eq("instance_name", normalizedInstanceName)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new MessagingChannelConfigurationError(
        `Canal nao configurado para a instancia ${normalizedInstanceName}`,
        "CHANNEL_NOT_CONFIGURED"
      );
    }

    const binding = parseMessagingChannelBinding(data as ChannelRow);
    if (binding.status !== "active" || binding.capability === "disabled") {
      throw new MessagingChannelConfigurationError(
        `Canal ${normalizedInstanceName} nao esta ativo`,
        "CHANNEL_INACTIVE"
      );
    }

    return binding;
  }

  async resolveWhatsAppProvider(acesId: number, instanceName: string): Promise<WhatsAppProviderName> {
    const binding = await this.resolve(acesId, instanceName);
    if (binding.channelType !== "whatsapp" || binding.provider === "instagram") {
      throw new MessagingChannelConfigurationError(
        `Instancia ${binding.instanceName} nao e um canal WhatsApp`,
        "CHANNEL_TYPE_MISMATCH"
      );
    }
    return binding.provider;
  }
}

export function parseMessagingChannelBinding(row: ChannelRow): MessagingChannelBinding {
  const id = asNonEmptyString(row.id);
  const instanceName = asNonEmptyString(row.instance_name);
  const acesId = typeof row.aces_id === "number" ? row.aces_id : Number(row.aces_id);
  const channelType = asNonEmptyString(row.channel_type) as MessagingChannelType | null;
  const provider = asNonEmptyString(row.provider) as MessagingProviderName | null;
  const capability = asNonEmptyString(row.capability) as MessagingCapability | null;
  const status = asNonEmptyString(row.status) as MessagingChannelStatus | null;

  if (
    !id ||
    !instanceName ||
    !Number.isInteger(acesId) ||
    acesId <= 0 ||
    !channelType ||
    !CHANNEL_TYPES.has(channelType) ||
    !provider ||
    !PROVIDERS.has(provider) ||
    !capability ||
    !CAPABILITIES.has(capability) ||
    !status ||
    !STATUSES.has(status) ||
    (channelType === "instagram" && provider !== "instagram") ||
    (channelType === "whatsapp" && provider === "instagram")
  ) {
    throw new MessagingChannelConfigurationError(
      "Binding de canal invalido no banco",
      "INVALID_CHANNEL_CONFIGURATION"
    );
  }

  return { id, acesId, instanceName, channelType, provider, capability, status };
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
