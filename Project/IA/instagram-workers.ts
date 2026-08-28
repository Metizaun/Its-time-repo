import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { InstagramApiError } from "./instagram-api-client.js";
import { fromPostgresBytea, toPostgresBytea } from "./instagram-crypto.js";
import { InstagramService } from "./instagram-service.js";

type WorkerStop = () => void;
const INSTAGRAM_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const INSTAGRAM_MEDIA_HOST_SUFFIXES = [
  "instagram.com",
  "cdninstagram.com",
  "facebook.com",
  "fbcdn.net",
  "fbsbx.com",
];

const INSTAGRAM_MEDIA_MIME_TYPES = {
  image: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  audio: new Set(["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/opus", "audio/wav", "audio/webm", "video/mp4"]),
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function isAllowedInstagramMediaUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return url.protocol === "https:" && !url.username && !url.password && INSTAGRAM_MEDIA_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

function mediaExtension(kind: "image" | "audio", mimeType: string) {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
    "audio/wav": "wav",
    "audio/webm": "webm",
  };
  return extensions[mimeType] ?? (kind === "image" ? "jpg" : "audio");
}

export async function downloadInstagramMedia(input: {
  url: string;
  kind: "image" | "audio";
}) {
  let currentUrl = input.url;
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    if (!isAllowedInstagramMediaUrl(currentUrl)) {
      throw Object.assign(new Error("URL de midia Instagram nao permitida"), { code: "instagram_media_url_blocked" });
    }
    const response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: `${input.kind}/*` },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === 3) {
        throw Object.assign(new Error("Redirecionamento de midia Instagram invalido"), { code: "instagram_media_redirect_invalid" });
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!response.ok) {
      throw Object.assign(new Error("Falha ao baixar midia Instagram"), { code: `instagram_media_http_${response.status}` });
    }
    const responseMimeType = String(response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!INSTAGRAM_MEDIA_MIME_TYPES[input.kind].has(responseMimeType)) {
      throw Object.assign(new Error("MIME de midia Instagram nao permitido"), { code: "instagram_media_mime_unsupported" });
    }
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > INSTAGRAM_MEDIA_MAX_BYTES) {
      throw Object.assign(new Error("Midia Instagram acima do limite"), { code: "instagram_media_too_large" });
    }
    if (!response.body) {
      throw Object.assign(new Error("Midia Instagram sem corpo"), { code: "instagram_media_empty" });
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > INSTAGRAM_MEDIA_MAX_BYTES) {
        await reader.cancel();
        throw Object.assign(new Error("Midia Instagram acima do limite"), { code: "instagram_media_too_large" });
      }
      chunks.push(Buffer.from(value));
    }
    if (totalBytes === 0) {
      throw Object.assign(new Error("Midia Instagram vazia"), { code: "instagram_media_empty" });
    }
    const data = Buffer.concat(chunks, totalBytes);
    const mimeType = input.kind === "audio" && responseMimeType === "video/mp4"
      ? "audio/mp4"
      : responseMimeType;
    return { data, mimeType, extension: mediaExtension(input.kind, mimeType) };
  }
  throw Object.assign(new Error("Midia Instagram indisponivel"), { code: "instagram_media_unavailable" });
}

export function safeErrorCode(error: unknown) {
  if (error instanceof InstagramApiError) return `meta_${error.details.code ?? error.details.status}`;
  const code = asRecord(error).code;
  return typeof code === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(code)
    ? code
    : "instagram_processing_failed";
}

function startPollingWorker(operation: () => Promise<void>, pollMs: number): WorkerStop {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const run = async () => {
    if (stopped) return;
    try {
      await operation();
    } catch (error) {
      console.error("[instagram-worker] Ciclo falhou", { errorCode: safeErrorCode(error) });
    } finally {
      if (!stopped) timer = setTimeout(run, Math.max(500, pollMs));
    }
  };
  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export function startInstagramWebhookWorker(config: {
  enabled: boolean;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  service: InstagramService;
  pollMs?: number;
  batchSize?: number;
  onMessagePersisted?: (acesId: number, leadId: string) => Promise<void>;
}) {
  if (!config.enabled) return null;
  const workerId = `instagram-inbound:${process.pid}:${randomUUID()}`;
  const instagramClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    db: { schema: "instagram" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const crmClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    db: { schema: "crm" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const processEvent = async (event: Record<string, unknown>) => {
    const eventId = String(event.id);
    const payload = asRecord(event.normalized_payload);
    if (event.event_type !== "message_text" && event.event_type !== "message_media") {
      const completed = await instagramClient.rpc("rpc_complete_webhook_event", {
        p_event_id: eventId, p_worker_id: workerId, p_status: "ignored",
      });
      if (completed.error || completed.data !== true) {
        throw completed.error ?? new Error("Lease do evento Instagram expirada");
      }
      return;
    }
    const channelId = typeof event.channel_id === "string" ? event.channel_id : null;
    const acesId = Number(event.aces_id);
    const senderId = typeof payload.senderId === "string" ? payload.senderId : null;
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    const attachment = asRecord(payload.attachment);
    const mediaKind = attachment.kind === "image" || attachment.kind === "audio" ? attachment.kind : null;
    const mediaUrl = typeof attachment.url === "string" ? attachment.url.trim() : "";
    const providerMessageId = typeof payload.providerMessageId === "string" ? payload.providerMessageId : null;
    const isMediaEvent = event.event_type === "message_media";
    if (
      !channelId || !Number.isInteger(acesId) || !senderId || !providerMessageId ||
      (isMediaEvent ? !mediaKind || !mediaUrl : !text)
    ) {
      throw Object.assign(new Error("Evento Instagram incompleto"), { code: "instagram_event_incomplete" });
    }

    let profile: { name: string | null; username: string | null; profilePictureUrl: string | null } | null = null;
    try {
      profile = await config.service.getMessagingUserProfile(channelId, senderId);
    } catch (error) {
      console.warn("[instagram-worker] Perfil do remetente indisponivel", { errorCode: safeErrorCode(error) });
    }
    const leadName = profile?.name ?? (profile?.username ? `@${profile.username}` : null);

    const { data: leadResult, error: leadError } = await crmClient.rpc("rpc_find_or_create_channel_lead", {
      p_channel_id: channelId,
      p_provider_user_id: senderId,
      p_name: leadName,
      p_owner_id: null,
      p_stage_id: null,
      p_display_username: profile?.username ? `@${profile.username}` : null,
      p_profile_picture_url: profile?.profilePictureUrl ?? null,
    });
    if (leadError || !leadResult) throw leadError ?? new Error("Lead Instagram nao criado");
    const leadId = String(asRecord(leadResult).lead_id ?? "");
    const instanceName = String(asRecord(leadResult).instance_name ?? "");
    if (!leadId || !instanceName) throw new Error("Retorno de lead Instagram invalido");

    if (leadName) {
      const { error: nameUpdateError } = await crmClient
        .from("leads")
        .update({ name: leadName })
        .eq("id", leadId)
        .eq("aces_id", acesId)
        .in("name", ["Lead Instagram", ""]);
      if (nameUpdateError) throw nameUpdateError;
    }

    const { error: leadUpdateError } = await crmClient
      .from("leads")
      .update({ interaction_mode: "human" })
      .eq("id", leadId)
      .eq("aces_id", acesId);
    if (leadUpdateError) throw leadUpdateError;

    const sentAt = typeof payload.timestamp === "string" ? payload.timestamp : new Date().toISOString();
    const { data: existingMessage, error: existingError } = await crmClient
      .from("message_history")
      .select("id")
      .eq("aces_id", acesId)
      .eq("provider", "instagram")
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();
    if (existingError) throw existingError;

    const messageId = existingMessage?.id ? String(existingMessage.id) : randomUUID();
    if (!existingMessage) {
      const messageContent = isMediaEvent
        ? text || (mediaKind === "image" ? "[imagem recebida]" : "[audio recebido]")
        : text;
      const { error: insertError } = await crmClient.from("message_history").insert({
        id: messageId,
        lead_id: leadId,
        aces_id: acesId,
        content: messageContent,
        direction: "inbound",
        source_type: "lead",
        instance: instanceName,
        sent_at: sentAt,
        conversation_id: `instagram:${channelId}:${senderId}`,
        provider: "instagram",
        provider_message_id: providerMessageId,
        provider_status: "received",
        provider_payload_summary: { channelId, eventId, ...(mediaKind ? { mediaKind } : {}) },
      });
      if (insertError && insertError.code !== "23505") throw insertError;
    }

    if (isMediaEvent && mediaKind) {
      const { data: existingAttachment, error: attachmentLookupError } = await crmClient
        .from("message_attachments")
        .select("id")
        .eq("message_id", messageId)
        .maybeSingle();
      if (attachmentLookupError) throw attachmentLookupError;
      if (!existingAttachment) {
        const downloaded = await downloadInstagramMedia({ url: mediaUrl, kind: mediaKind });
        const attachmentId = randomUUID();
        const fileName = `instagram-${providerMessageId.replace(/[^A-Za-z0-9._-]/g, "-").slice(-60)}.${downloaded.extension}`;
        const storagePath = `${acesId}/${leadId}/${messageId}/${attachmentId}-${fileName}`;
        const { error: uploadError } = await crmClient.storage
          .from("chat-attachments")
          .upload(storagePath, downloaded.data, {
            contentType: downloaded.mimeType,
            upsert: false,
          });
        if (uploadError) throw uploadError;
        const { error: attachmentError } = await crmClient.from("message_attachments").insert({
          id: attachmentId,
          message_id: messageId,
          aces_id: acesId,
          lead_id: leadId,
          kind: mediaKind,
          mime_type: downloaded.mimeType,
          storage_bucket: "chat-attachments",
          storage_path: storagePath,
          file_name: fileName,
          file_size: downloaded.data.length,
          expires_at: mediaKind === "image"
            ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            : null,
        });
        if (attachmentError) {
          await crmClient.storage.from("chat-attachments").remove([storagePath]);
          throw attachmentError;
        }
      }
    }
    await config.onMessagePersisted?.(acesId, leadId);
    const completed = await instagramClient.rpc("rpc_complete_webhook_event", {
      p_event_id: eventId, p_worker_id: workerId, p_status: "processed",
    });
    if (completed.error || completed.data !== true) {
      throw completed.error ?? new Error("Lease do evento Instagram expirada");
    }
  };

  return startPollingWorker(async () => {
    const { data, error } = await instagramClient.rpc("rpc_claim_webhook_events", {
      p_worker_id: workerId,
      p_limit: Math.max(1, config.batchSize ?? 10),
      p_lease_seconds: 60,
    });
    if (error) throw error;
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      try {
        await processEvent(row);
      } catch (error) {
        const attemptCount = Number(row.attempt_count ?? 1);
        const failed = await instagramClient.rpc("rpc_fail_webhook_event", {
          p_event_id: String(row.id),
          p_worker_id: workerId,
          p_error_code: safeErrorCode(error),
          p_retry_delay_seconds: Math.min(1800, 15 * 2 ** Math.max(0, attemptCount - 1)),
        });
        if (failed.error) throw failed.error;
      }
    }
  }, config.pollMs ?? 1_000);
}

export function startInstagramTokenRefreshWorker(config: {
  enabled: boolean;
  service: InstagramService;
  pollMs?: number;
  batchSize?: number;
}) {
  if (!config.enabled) return null;
  const workerId = `instagram-refresh:${process.pid}:${randomUUID()}`;
  const client: SupabaseClient<any, any, any> = config.service.getInstagramClient();

  return startPollingWorker(async () => {
    const { api, cipher } = config.service.getApiAndCipherForWorker();
    const { data, error } = await client.rpc("rpc_claim_token_refreshes", {
      p_worker_id: workerId,
      p_limit: Math.max(1, config.batchSize ?? 5),
      p_lease_seconds: 120,
    });
    if (error) throw error;
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const channelId = String(row.channel_id);
      try {
        const currentToken = cipher.decrypt({
          ciphertext: fromPostgresBytea(row.access_token_ciphertext),
          iv: fromPostgresBytea(row.iv),
          authTag: fromPostgresBytea(row.auth_tag),
          keyVersion: String(row.key_version),
        });
        const refreshed = await api.refreshAccessToken(currentToken);
        const obtainedAt = Date.now();
        const expiresAt = new Date(obtainedAt + refreshed.expiresIn * 1000);
        const nextRefreshAt = new Date(Math.min(
          obtainedAt + 30 * 24 * 60 * 60 * 1000,
          expiresAt.getTime() - 7 * 24 * 60 * 60 * 1000,
        ));
        const encrypted = cipher.encrypt(refreshed.accessToken);
        const completed = await client.rpc("rpc_complete_token_refresh", {
          p_channel_id: channelId,
          p_worker_id: workerId,
          p_access_token_ciphertext: toPostgresBytea(encrypted.ciphertext),
          p_iv: toPostgresBytea(encrypted.iv),
          p_auth_tag: toPostgresBytea(encrypted.authTag),
          p_key_version: encrypted.keyVersion,
          p_token_expires_at: expiresAt.toISOString(),
          p_next_refresh_at: nextRefreshAt.toISOString(),
        });
        if (completed.error || completed.data !== true) {
          throw completed.error ?? new Error("Lease de refresh Instagram expirada");
        }
        await config.service.recordRefreshSuccess(Number(row.aces_id), channelId);
      } catch (error) {
        const reconnectRequired = error instanceof InstagramApiError && !error.details.transient;
        const errorCode = safeErrorCode(error);
        const failed = await client.rpc("rpc_fail_token_refresh", {
          p_channel_id: channelId,
          p_worker_id: workerId,
          p_error_code: errorCode,
          p_reconnect_required: reconnectRequired,
        });
        if (failed.error) throw failed.error;
        await config.service.recordRefreshFailure(Number(row.aces_id), channelId, errorCode, reconnectRequired);
      }
    }
  }, config.pollMs ?? 60_000);
}
