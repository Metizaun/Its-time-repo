import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { sha256 } from "./instagram-crypto.js";

type JsonRecord = Record<string, unknown>;

export type NormalizedInstagramWebhookEvent = {
  eventKey: string;
  externalAccountId: string;
  eventType: "message_text" | "message_media" | "unsupported";
  providerMessageId: string | null;
  senderId: string | null;
  recipientId: string | null;
  text: string | null;
  attachment: {
    kind: "image" | "audio";
    url: string;
  } | null;
  timestamp: string;
  ignoredReason: string | null;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeTimestamp(value: unknown) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric).toISOString();
  }
  return new Date().toISOString();
}

export function parseInstagramWebhookPayload(payload: unknown): NormalizedInstagramWebhookEvent[] {
  const root = asRecord(payload);
  const events: NormalizedInstagramWebhookEvent[] = [];
  for (const entryValue of asArray(root.entry)) {
    const entry = asRecord(entryValue);
    const entryAccountId = asString(entry.id);
    if (!entryAccountId) continue;

    for (const messagingValue of asArray(entry.messaging)) {
      const messaging = asRecord(messagingValue);
      const senderId = asString(asRecord(messaging.sender).id);
      const recipientId = asString(asRecord(messaging.recipient).id);
      const message = asRecord(messaging.message);
      const providerMessageId = asString(message.mid);
      const text = asString(message.text);
      const attachment = asArray(message.attachments)
        .map(asRecord)
        .map((item) => {
          const type = asString(item.type);
          const url = asString(asRecord(item.payload).url);
          return (type === "image" || type === "audio") && url
            ? { kind: type, url }
            : null;
        })
        .find((item): item is { kind: "image" | "audio"; url: string } => Boolean(item)) ?? null;
      const isEcho = message.is_echo === true;
      const timestamp = normalizeTimestamp(messaging.timestamp ?? entry.time);
      const supportedText = Boolean(providerMessageId && senderId && text && !isEcho);
      const supportedMedia = Boolean(providerMessageId && senderId && attachment && !isEcho);
      const fingerprint = providerMessageId ?? sha256(JSON.stringify({
        entryAccountId, senderId, recipientId, timestamp, message,
      })).toString("hex");
      events.push({
        eventKey: `instagram:${entryAccountId}:${fingerprint}`,
        externalAccountId: entryAccountId,
        eventType: supportedMedia ? "message_media" : supportedText ? "message_text" : "unsupported",
        providerMessageId,
        senderId,
        recipientId,
        text: supportedText || supportedMedia ? text : null,
        attachment: supportedMedia ? attachment : null,
        timestamp,
        ignoredReason: supportedText || supportedMedia ? null : isEcho ? "echo" : "unsupported_event",
      });
    }
  }
  return events;
}

export class InstagramWebhookProcessor {
  private readonly instagramClient: SupabaseClient<any, any, any>;

  constructor(config: {
    supabaseUrl: string;
    supabaseServiceRoleKey: string;
    appSecret?: string;
  }) {
    this.appSecret = config.appSecret?.trim() || null;
    this.instagramClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "instagram" },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private readonly appSecret: string | null;

  verifySignature(rawBody: Buffer | undefined, signatureHeader: string | undefined) {
    if (!this.appSecret || !rawBody || !signatureHeader?.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", this.appSecret).update(rawBody).digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
    } catch {
      return false;
    }
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  async persist(payload: unknown) {
    const events = parseInstagramWebhookPayload(payload);
    if (events.length === 0) return { accepted: 0, duplicateOrIgnored: 0 };

    const accountIds = [...new Set(events.map((event) => event.externalAccountId))];
    const { data: channels, error: channelError } = await this.instagramClient
      .from("channels")
      .select("channel_id, aces_id, ig_user_id")
      .in("ig_user_id", accountIds);
    if (channelError) throw channelError;
    const channelByAccount = new Map((channels ?? []).map((channel) => [String(channel.ig_user_id), channel]));
    const rows = events.map((event) => {
      const channel = channelByAccount.get(event.externalAccountId);
      return {
        event_key: event.eventKey,
        channel_id: channel?.channel_id ?? null,
        aces_id: channel?.aces_id ?? null,
        external_account_id: event.externalAccountId,
        event_type: event.eventType,
        payload_summary: {
          providerMessageId: event.providerMessageId,
          hasText: Boolean(event.text),
          mediaKind: event.attachment?.kind ?? null,
          hasMedia: Boolean(event.attachment),
          ignoredReason: event.ignoredReason,
        },
        normalized_payload: {
          providerMessageId: event.providerMessageId,
          senderId: event.senderId,
          recipientId: event.recipientId,
          text: event.text,
          attachment: event.attachment,
          timestamp: event.timestamp,
          ignoredReason: event.ignoredReason,
        },
        status: channel ? "pending" : "ignored",
        processed_at: channel ? null : new Date().toISOString(),
      };
    });
    const { data, error } = await this.instagramClient
      .from("webhook_events")
      .upsert(rows, { onConflict: "event_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    return { accepted: data?.length ?? 0, duplicateOrIgnored: rows.length - (data?.length ?? 0) };
  }
}
