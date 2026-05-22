import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type MetaWebhookProcessorConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  verifyToken: string;
  appSecret: string | null;
};

type MetaChannelContext = {
  id: string;
  acesId: number;
  instanceName: string;
};

type MetaWebhookResult = {
  success: true;
  processed: number;
  ignored: number;
};

export class MetaWebhookProcessor {
  private readonly serviceClient: SupabaseClient<any, any, any>;

  constructor(private readonly config: MetaWebhookProcessorConfig) {
    this.serviceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "crm" },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  verifyChallenge(query: Record<string, unknown>) {
    const mode = asString(query["hub.mode"]);
    const token = asString(query["hub.verify_token"]);
    const challenge = asString(query["hub.challenge"]);

    if (mode === "subscribe" && token === this.config.verifyToken && challenge) {
      return challenge;
    }

    return null;
  }

  verifySignature(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody || !signature || !this.config.appSecret) {
      return false;
    }

    const expected = `sha256=${createHmac("sha256", this.config.appSecret)
      .update(rawBody)
      .digest("hex")}`;
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    return (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  async processWebhook(payload: unknown): Promise<MetaWebhookResult> {
    const root = asRecord(payload);
    const entries: unknown[] = Array.isArray(root.entry) ? root.entry : [];
    let processed = 0;
    let ignored = 0;

    for (const entry of entries) {
      const entryRecord = asRecord(entry);
      const changes: unknown[] = Array.isArray(entryRecord.changes) ? entryRecord.changes : [];
      for (const change of changes) {
        const value = asRecord(asRecord(change).value);
        const phoneNumberId = asString(asRecord(value.metadata).phone_number_id);
        const channel = phoneNumberId ? await this.findChannelByPhoneNumberId(phoneNumberId) : null;
        const messages = Array.isArray(value.messages) ? value.messages : [];
        const statuses = Array.isArray(value.statuses) ? value.statuses : [];

        for (const message of messages) {
          const handled = channel
            ? await this.processInboundMessage(channel, asRecord(message))
            : false;
          handled ? processed += 1 : ignored += 1;
        }

        for (const status of statuses) {
          const handled = await this.processStatusEvent(channel, asRecord(status));
          handled ? processed += 1 : ignored += 1;
        }
      }
    }

    return { success: true, processed, ignored };
  }

  private async findChannelByPhoneNumberId(phoneNumberId: string): Promise<MetaChannelContext | null> {
    const { data, error } = await this.serviceClient
      .from("whatsapp_meta_channels")
      .select("id, aces_id, instance_name")
      .eq("phone_number_id", phoneNumberId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      id: String(data.id),
      acesId: Number(data.aces_id),
      instanceName: String(data.instance_name),
    };
  }

  private async processInboundMessage(channel: MetaChannelContext, message: Record<string, unknown>) {
    const providerMessageId = asString(message.id);
    const from = asString(message.from);
    if (!providerMessageId || !from) {
      return false;
    }

    const duplicate = await this.findMessageByProviderId(providerMessageId);
    if (duplicate) {
      return false;
    }

    const lead = await this.findLeadByPhone(channel, from);
    if (!lead) {
      return false;
    }

    const sentAt = timestampToIso(asString(message.timestamp));
    const content = extractInboundContent(message);
    const { error } = await this.serviceClient.from("message_history").insert({
      lead_id: lead.id,
      aces_id: channel.acesId,
      content,
      direction: "inbound",
      source_type: "lead",
      instance: channel.instanceName,
      conversation_id: from,
      sent_at: sentAt,
      provider: "meta",
      provider_message_id: providerMessageId,
      provider_status: "received",
      provider_payload_summary: summarizeInboundMessage(message),
    });

    if (error) {
      throw error;
    }

    await this.serviceClient
      .from("leads")
      .update({
        last_message_at: sentAt,
        updated_at: new Date().toISOString(),
        instancia: channel.instanceName,
      })
      .eq("id", lead.id)
      .eq("aces_id", channel.acesId);

    return true;
  }

  private async processStatusEvent(
    channel: MetaChannelContext | null,
    status: Record<string, unknown>
  ) {
    const providerMessageId = asString(status.id);
    const providerStatus = normalizeProviderStatus(asString(status.status));
    if (!providerMessageId || !providerStatus) {
      return false;
    }

    const message = await this.findMessageByProviderId(providerMessageId);
    const acesId = message?.aces_id ? Number(message.aces_id) : channel?.acesId ?? null;
    if (!acesId) {
      return false;
    }

    const eventTimestamp = timestampToIso(asString(status.timestamp));
    const errorInfo = extractStatusError(status);
    const payloadSummary = summarizeStatusEvent(status);

    const { error: eventError } = await this.serviceClient
      .from("whatsapp_provider_status_events")
      .upsert(
        {
          aces_id: acesId,
          channel_id: channel?.id ?? null,
          provider: "meta",
          provider_message_id: providerMessageId,
          status: providerStatus,
          event_timestamp: eventTimestamp,
          provider_error_code: errorInfo.code,
          provider_error_message: errorInfo.message,
          payload_summary: payloadSummary,
        },
        {
          onConflict: "provider,provider_message_id,status,event_timestamp",
          ignoreDuplicates: true,
        }
      );

    if (eventError) {
      throw eventError;
    }

    await this.serviceClient
      .from("message_history")
      .update({
        provider_status: providerStatus,
        provider_error_code: errorInfo.code,
        provider_error_message: errorInfo.message,
        provider_payload_summary: payloadSummary,
      })
      .eq("provider", "meta")
      .eq("provider_message_id", providerMessageId);

    await this.serviceClient
      .from("automation_executions")
      .update({
        provider_status: providerStatus,
        provider_error_code: errorInfo.code,
        provider_error_message: errorInfo.message,
        provider_payload_summary: payloadSummary,
      })
      .eq("provider", "meta")
      .eq("provider_message_id", providerMessageId);

    return true;
  }

  private async findMessageByProviderId(providerMessageId: string) {
    const { data, error } = await this.serviceClient
      .from("message_history")
      .select("id, aces_id")
      .eq("provider", "meta")
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data as { id: string; aces_id: number | null } | null;
  }

  private async findLeadByPhone(channel: MetaChannelContext, phone: string) {
    const variants = phoneVariants(phone);
    const scopedLead = await this.queryLeadByPhone(channel, variants, true);
    if (scopedLead) {
      return scopedLead;
    }

    return this.queryLeadByPhone(channel, variants, false);
  }

  private async queryLeadByPhone(
    channel: MetaChannelContext,
    variants: string[],
    instanceScoped: boolean
  ) {
    let query = this.serviceClient
      .from("leads")
      .select("id")
      .eq("aces_id", channel.acesId)
      .in("contact_phone", variants)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (instanceScoped) {
      query = query.eq("instancia", channel.instanceName);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw error;
    }

    return data as { id: string } | null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function phoneVariants(phone: string) {
  const digits = phone.replace(/\D/g, "");
  const variants = new Set<string>([digits]);
  if (digits.startsWith("55") && digits.length > 11) {
    variants.add(digits.slice(2));
  } else if (digits.length <= 11) {
    variants.add(`55${digits}`);
  }

  return Array.from(variants).filter(Boolean);
}

function timestampToIso(timestamp: string | null) {
  if (!timestamp) {
    return new Date().toISOString();
  }

  const numeric = Number(timestamp);
  if (Number.isFinite(numeric)) {
    return new Date(numeric * 1000).toISOString();
  }

  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function extractInboundContent(message: Record<string, unknown>) {
  const type = asString(message.type);
  if (type === "text") {
    return asString(asRecord(message.text).body) ?? "[mensagem sem texto]";
  }

  if (type === "button") {
    return asString(asRecord(message.button).text) ?? "[botao recebido]";
  }

  if (type === "interactive") {
    const interactive = asRecord(message.interactive);
    const buttonReply = asRecord(interactive.button_reply);
    const listReply = asRecord(interactive.list_reply);
    return (
      asString(buttonReply.title) ??
      asString(buttonReply.id) ??
      asString(listReply.title) ??
      asString(listReply.id) ??
      "[interacao recebida]"
    );
  }

  return type ? `[${type} recebido]` : "[mensagem recebida]";
}

function normalizeProviderStatus(status: string | null) {
  if (!status) {
    return null;
  }

  const normalized = status.toLowerCase();
  return ["sent", "delivered", "read", "failed"].includes(normalized) ? normalized : normalized;
}

function extractStatusError(status: Record<string, unknown>) {
  const errors = Array.isArray(status.errors) ? status.errors : [];
  const first = asRecord(errors[0]);
  return {
    code: asString(first.code),
    message: asString(first.message) ?? asString(first.title),
  };
}

function summarizeInboundMessage(message: Record<string, unknown>) {
  return {
    id: asString(message.id),
    from: asString(message.from),
    type: asString(message.type),
    timestamp: asString(message.timestamp),
  };
}

function summarizeStatusEvent(status: Record<string, unknown>) {
  const conversation = asRecord(status.conversation);
  const pricing = asRecord(status.pricing);
  const errorInfo = extractStatusError(status);
  return {
    id: asString(status.id),
    status: asString(status.status),
    timestamp: asString(status.timestamp),
    recipient_id: asString(status.recipient_id),
    conversation_id: asString(conversation.id),
    pricing_category: asString(pricing.category),
    error_code: errorInfo.code,
    error_message: errorInfo.message,
  };
}
