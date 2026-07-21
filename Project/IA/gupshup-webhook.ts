import { createClient } from "@supabase/supabase-js";

import type { ParsedWebhookMessage } from "./sdr-agent-gemini.js";

type GupshupWebhookConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  processInboundMessage: (
    acesId: number,
    message: ParsedWebhookMessage
  ) => Promise<unknown>;
};

type GupshupChannelContext = {
  id: string;
  acesId: number;
  instanceName: string;
};

type ProviderMessageContext = {
  id: string;
  aces_id: number | null;
};

type ChannelLookup = {
  appName: string | null;
  appId: string | null;
  phoneNumber: string | null;
};

type ParsedInboundEvent = {
  kind: "inbound";
  lookup: ChannelLookup;
  message: Omit<ParsedWebhookMessage, "instanceName">;
};

type ParsedStatusEvent = {
  kind: "status";
  lookup: ChannelLookup;
  providerMessageId: string;
  rawStatus: string;
  eventTimestamp: string;
  destination: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  raw: Record<string, unknown>;
};

export type ParsedGupshupWebhookEvent = ParsedInboundEvent | ParsedStatusEvent;

export type GupshupWebhookResult = {
  success: true;
  processed: number;
  ignored: number;
  results: unknown[];
};

export class GupshupWebhookProcessor {
  private readonly crmClient;
  private readonly metaClient;
  private readonly gupshupClient;

  constructor(private readonly config: GupshupWebhookConfig) {
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    this.crmClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "crm" },
      ...options,
    });
    this.metaClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "meta" },
      ...options,
    });
    this.gupshupClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "gupshup" },
      ...options,
    });
  }

  async processWebhook(payload: unknown): Promise<GupshupWebhookResult> {
    const events = parseGupshupWebhookPayload(payload);
    let processed = 0;
    let ignored = 0;
    const results: unknown[] = [];

    for (const event of events) {
      const channel = await this.resolveChannel(event.lookup);
      if (channel && event.lookup.appId) {
        await this.syncChannelAppId(channel.id, event.lookup.appId);
      }
      if (event.kind === "inbound") {
        if (!channel) {
          ignored += 1;
          results.push({ ignored: true, reason: "Canal Gupshup ativo nao identificado" });
          continue;
        }

        const result = await this.config.processInboundMessage(channel.acesId, {
          ...event.message,
          instanceName: channel.instanceName,
          raw: {
            ...event.message.raw,
            gupshupChannelId: channel.id,
            crmInstanceName: channel.instanceName,
          },
        });
        const wasIgnored = asRecord(result).ignored === true;
        processed += wasIgnored ? 0 : 1;
        ignored += wasIgnored ? 1 : 0;
        results.push(result);
        continue;
      }

      const handled = await this.processStatusEvent(event, channel);
      processed += handled ? 1 : 0;
      ignored += handled ? 0 : 1;
      results.push(
        handled
          ? { success: true, status: event.rawStatus }
          : { ignored: true, reason: "Status sem mensagem ou canal correspondente" }
      );
    }

    if (events.length === 0) ignored = 1;
    return { success: true, processed, ignored, results };
  }

  private async processStatusEvent(
    event: ParsedStatusEvent,
    channel: GupshupChannelContext | null
  ) {
    const providerStatus = normalizeGupshupStatus(event.rawStatus);
    if (!providerStatus) return false;

    const message = await this.findMessageByProviderId(event.providerMessageId);
    const acesId = message?.aces_id ? Number(message.aces_id) : channel?.acesId ?? null;
    if (!acesId) return false;

    const payloadSummary = {
      providerMessageId: event.providerMessageId,
      status: event.rawStatus,
      destination: event.destination,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
      gupshupChannelId: channel?.id ?? null,
    };
    const statusUpdate = {
      provider_status: providerStatus,
      provider_error_code: event.errorCode,
      provider_error_message: event.errorMessage,
      provider_payload_summary: payloadSummary,
    };

    const updates = await Promise.all([
      this.crmClient
        .from("message_history")
        .update(statusUpdate)
        .eq("provider", "gupshup")
        .eq("provider_message_id", event.providerMessageId),
      this.crmClient
        .from("automation_executions")
        .update(statusUpdate)
        .eq("provider", "gupshup")
        .eq("provider_message_id", event.providerMessageId),
      this.crmClient
        .from("follow_up_tasks")
        .update(statusUpdate)
        .eq("provider", "gupshup")
        .eq("provider_message_id", event.providerMessageId),
    ]);
    const updateError = updates.find((result) => result.error)?.error;
    if (updateError) throw updateError;

    const { error: eventError } = await this.metaClient
      .from("whatsapp_provider_status_events")
      .upsert(
        {
          aces_id: acesId,
          channel_id: null,
          provider: "gupshup",
          provider_message_id: event.providerMessageId,
          status: providerStatus,
          event_timestamp: event.eventTimestamp,
          provider_error_code: event.errorCode,
          provider_error_message: event.errorMessage,
          payload_summary: payloadSummary,
        },
        {
          onConflict: "provider,provider_message_id,status,event_timestamp",
          ignoreDuplicates: true,
        }
      );
    if (eventError) throw eventError;

    return true;
  }

  private async findMessageByProviderId(
    providerMessageId: string
  ): Promise<ProviderMessageContext | null> {
    const { data, error } = await this.crmClient
      .from("message_history")
      .select("id, aces_id")
      .eq("provider", "gupshup")
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();
    if (error) throw error;
    return (data as ProviderMessageContext | null) ?? null;
  }

  private async resolveChannel(lookup: ChannelLookup): Promise<GupshupChannelContext | null> {
    const filters: Array<{ column: "app_name" | "app_id" | "phone_number"; value: string }> = [];
    if (lookup.appName) filters.push({ column: "app_name", value: lookup.appName });
    if (lookup.appId) filters.push({ column: "app_id", value: lookup.appId });
    if (lookup.phoneNumber) {
      const digits = normalizePhone(lookup.phoneNumber);
      if (digits) filters.push({ column: "phone_number", value: digits });
    }

    for (const filter of filters) {
      const { data, error } = await this.gupshupClient
        .from("channel")
        .select("id, aces_id, instance_name")
        .eq(filter.column, filter.value)
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        return {
          id: String(data.id),
          acesId: Number(data.aces_id),
          instanceName: String(data.instance_name),
        };
      }
    }

    return null;
  }

  private async syncChannelAppId(channelId: string, appId: string) {
    const normalizedAppId = appId.trim();
    if (!normalizedAppId) {
      return;
    }

    const { error } = await this.gupshupClient
      .from("channel")
      .update({ app_id: normalizedAppId, updated_at: new Date().toISOString() })
      .eq("id", channelId);

    if (error) {
      throw error;
    }
  }
}

export function parseGupshupWebhookPayload(payload: unknown): ParsedGupshupWebhookEvent[] {
  const root = asRecord(payload);
  const version = Number(root.version);
  const type = asString(root.type);

  if (version === 2 || type === "message" || type === "message-event") {
    const event = type === "message"
      ? parseV2InboundEvent(root)
      : type === "message-event"
        ? parseV2StatusEvent(root)
        : null;
    return event ? [event] : [];
  }

  return parseMetaV3Events(root);
}

function parseV2InboundEvent(root: Record<string, unknown>): ParsedInboundEvent | null {
  const message = asRecord(root.payload);
  const sender = asRecord(message.sender);
  const media = asRecord(message.payload);
  const phone = asString(sender.phone) ?? asString(message.source);
  const providerMessageId = asString(message.id);
  if (!phone || !providerMessageId) return null;

  const messageType = (asString(message.type) ?? "").toLowerCase();
  const mediaKind = resolveMediaKind(messageType);
  const content = extractV2Content(messageType, message, media);

  return {
    kind: "inbound",
    lookup: {
      appName: asString(root.app),
      appId: asString(root.appId) ?? asString(root.app_id),
      phoneNumber: null,
    },
    message: {
      provider: "gupshup",
      fromMe: false,
      phone: normalizePhone(phone),
      content,
      messageId: providerMessageId,
      conversationId: normalizePhone(phone),
      sentAt: timestampToIso(message.timestamp ?? root.timestamp),
      pushName: asString(sender.name),
      mediaKind,
      mediaMimeType:
        asString(media.contentType) ??
        asString(media["content-type"]) ??
        asString(media.mimeType) ??
        defaultMimeType(mediaKind),
      mediaBase64: asString(media.base64),
      mediaUrl: asString(media.url) ?? (mediaKind ? asString(media.text) : null),
      mediaUrlExpiresAt: optionalTimestampToIso(media.urlExpiry),
      fileName:
        asString(media.name) ?? asString(media.fileName) ?? asString(media.filename),
      messageType,
      raw: root,
    },
  };
}

function parseV2StatusEvent(root: Record<string, unknown>): ParsedStatusEvent | null {
  const event = asRecord(root.payload);
  const details = asRecord(event.payload);
  const providerMessageId = asString(event.gsId) ?? asString(event.id);
  const rawStatus = asString(event.type);
  if (!providerMessageId || !rawStatus) return null;

  return {
    kind: "status",
    lookup: {
      appName: asString(root.app),
      appId: asString(root.appId) ?? asString(root.app_id),
      phoneNumber: null,
    },
    providerMessageId,
    rawStatus,
    eventTimestamp: timestampToIso(root.timestamp ?? event.timestamp ?? event.ts),
    destination: asString(event.destination),
    errorCode: asScalarString(details.code),
    errorMessage: asString(details.reason) ?? asString(details.message),
    raw: root,
  };
}

function parseMetaV3Events(root: Record<string, unknown>): ParsedGupshupWebhookEvent[] {
  const events: ParsedGupshupWebhookEvent[] = [];
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const rootGupshupAppId = asString(root.gs_app_id);

  for (const entryValue of entries) {
    const entry = asRecord(entryValue);
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const changeValue of changes) {
      const change = asRecord(changeValue);
      const value = asRecord(change.value);
      const metadata = asRecord(value.metadata);
      const lookup: ChannelLookup = {
        appName: asString(value.app) ?? asString(root.app),
        appId:
          asString(value.gs_app_id) ??
          rootGupshupAppId ??
          asString(value.app_id) ??
          asString(entry.id),
        phoneNumber:
          asString(metadata.display_phone_number) ?? asString(metadata.phone_number),
      };
      const contacts = Array.isArray(value.contacts) ? value.contacts.map(asRecord) : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];

      for (const messageValue of messages) {
        const message = asRecord(messageValue);
        const phone = normalizePhone(asString(message.from) ?? "");
        const providerMessageId = asString(message.id);
        if (!phone || !providerMessageId) continue;

        const messageType = (asString(message.type) ?? "").toLowerCase();
        const mediaKind = resolveMediaKind(messageType);
        const media = mediaKind ? asRecord(message[messageType]) : {};
        const contact = contacts.find((item) => normalizePhone(asString(item.wa_id) ?? "") === phone);
        const profile = asRecord(contact?.profile);

        events.push({
          kind: "inbound",
          lookup,
          message: {
            provider: "gupshup",
            fromMe: false,
            phone,
            content: extractMetaContent(messageType, message, media),
            messageId: providerMessageId,
            conversationId: phone,
            sentAt: timestampToIso(message.timestamp ?? root.timestamp),
            pushName: asString(profile.name),
            mediaKind,
            mediaMimeType:
              asString(media.mime_type) ?? asString(media.contentType) ?? defaultMimeType(mediaKind),
            mediaBase64: asString(media.base64),
            mediaUrl: asString(media.url) ?? asString(media.link),
            fileName: asString(media.filename) ?? asString(media.name),
            messageType,
            raw: { ...root, _gupshupMetaValue: value, _gupshupMetaMessage: message },
          },
        });
      }

      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const statusValue of statuses) {
        const status = asRecord(statusValue);
        const providerMessageId = asString(status.id);
        const rawStatus = asString(status.status);
        if (!providerMessageId || !rawStatus) continue;
        const errors = Array.isArray(status.errors) ? status.errors.map(asRecord) : [];
        const firstError = errors[0] ?? {};

        events.push({
          kind: "status",
          lookup,
          providerMessageId,
          rawStatus,
          eventTimestamp: timestampToIso(status.timestamp ?? root.timestamp),
          destination: asString(status.recipient_id),
          errorCode: asScalarString(firstError.code),
          errorMessage:
            asString(firstError.title) ??
            asString(firstError.message) ??
            asString(asRecord(firstError.error_data).details),
          raw: { ...root, _gupshupMetaValue: value, _gupshupMetaStatus: status },
        });
      }
    }
  }

  return events;
}

function extractV2Content(
  messageType: string,
  message: Record<string, unknown>,
  payload: Record<string, unknown>
) {
  if (messageType === "text" || messageType === "txt") {
    return asString(payload.text) ?? asString(message.text) ?? "[mensagem sem texto]";
  }
  return asString(payload.caption) ?? "";
}

function extractMetaContent(
  messageType: string,
  message: Record<string, unknown>,
  media: Record<string, unknown>
) {
  if (messageType === "text") return asString(asRecord(message.text).body) ?? "[mensagem sem texto]";
  if (messageType === "button") return asString(asRecord(message.button).text) ?? "[botao selecionado]";
  if (messageType === "interactive") {
    const interactive = asRecord(message.interactive);
    return (
      asString(asRecord(interactive.button_reply).title) ??
      asString(asRecord(interactive.list_reply).title) ??
      "[resposta interativa]"
    );
  }
  return asString(media.caption) ?? "";
}

function resolveMediaKind(type: string): "image" | "audio" | "document" | null {
  if (type === "image") return "image";
  if (type === "audio" || type === "voice") return "audio";
  if (type === "document" || type === "file") return "document";
  return null;
}

function defaultMimeType(kind: "image" | "audio" | "document" | null) {
  if (kind === "image") return "image/jpeg";
  if (kind === "audio") return "audio/ogg";
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asScalarString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asString(value);
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function timestampToIso(timestamp: unknown) {
  const numeric = typeof timestamp === "number" ? timestamp : Number(timestamp);
  if (Number.isFinite(numeric)) {
    const milliseconds = numeric >= 1_000_000_000_000 ? numeric : numeric * 1000;
    return new Date(milliseconds).toISOString();
  }

  if (typeof timestamp === "string") {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return new Date().toISOString();
}

function optionalTimestampToIso(timestamp: unknown) {
  if (timestamp === null || timestamp === undefined || timestamp === "") return null;
  const numeric = typeof timestamp === "number" ? timestamp : Number(timestamp);
  if (Number.isFinite(numeric)) {
    const milliseconds = numeric >= 1_000_000_000_000 ? numeric : numeric * 1000;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof timestamp === "string") {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return null;
}

function normalizeGupshupStatus(status: string): string | null {
  const statusMap: Record<string, string> = {
    enqueued: "sent",
    sent: "sent",
    delivered: "delivered",
    read: "read",
    failed: "failed",
  };
  return statusMap[status.toLowerCase()] ?? null;
}
