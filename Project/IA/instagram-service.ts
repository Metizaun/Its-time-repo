import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { InstagramApiClient, InstagramApiError } from "./instagram-api-client.js";
import {
  fromPostgresBytea,
  InstagramTokenCipher,
  createSignedOAuthState,
  sha256,
  toPostgresBytea,
  verifySignedOAuthState,
} from "./instagram-crypto.js";

type AdminContext = {
  acesId: number;
  crmUserId: string;
  role: string;
};

export type InstagramServiceConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  appId?: string;
  appSecret?: string;
  graphApiVersion?: string;
  encryptionKey?: string;
  encryptionKeyVersion?: string;
  backendPublicUrl?: string;
  frontendPublicUrl?: string;
  enabled?: boolean;
  outboundEnabled?: boolean;
};

const INSTAGRAM_STANDARD_WINDOW_MS = 24 * 60 * 60 * 1000;
const INSTAGRAM_HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const INSTAGRAM_MEDIA_DELIVERY_TTL_MS = 15 * 60 * 1000;

export function evaluateInstagramHumanAgentWindow(lastInboundAt: string | null | undefined, evaluatedAtMs = Date.now()) {
  const inboundMs = lastInboundAt ? Date.parse(lastInboundAt) : Number.NaN;
  const elapsedMs = evaluatedAtMs - inboundMs;
  if (!Number.isFinite(inboundMs) || elapsedMs < 0 || elapsedMs >= INSTAGRAM_HUMAN_AGENT_WINDOW_MS) {
    return { isOpen: false, tag: null };
  }

  return {
    isOpen: true,
    tag: elapsedMs >= INSTAGRAM_STANDARD_WINDOW_MS ? "HUMAN_AGENT" as const : null,
  };
}

export class InstagramServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 400,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "InstagramServiceError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireText(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new InstagramServiceError(`${name} nao configurada`, "INSTAGRAM_CONFIGURATION", 503);
  return normalized;
}

function normalizePublicBaseUrl(value: string | undefined, name: string) {
  const normalized = requireText(value, name).replace(/\/$/, "");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new InstagramServiceError(`${name} invalida`, "INSTAGRAM_CONFIGURATION", 503);
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new InstagramServiceError(`${name} deve usar HTTPS`, "INSTAGRAM_CONFIGURATION", 503);
  }
  return normalized;
}

function sanitizeReturnPath(value: string | null | undefined) {
  const normalized = value?.trim() || "/admin?section=instances";
  return /^\/[A-Za-z0-9/_?&=.%-]*$/.test(normalized) ? normalized : "/admin?section=instances";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function computeTokenSchedule(obtainedAt: Date, expiresInSeconds: number) {
  const expiresAt = new Date(obtainedAt.getTime() + Math.max(3600, expiresInSeconds) * 1000);
  const thirtyDays = new Date(obtainedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sevenDaysBeforeExpiry = new Date(expiresAt.getTime() - 7 * 24 * 60 * 60 * 1000);
  const nextRefreshAt = new Date(Math.max(
    obtainedAt.getTime() + 48 * 60 * 60 * 1000,
    Math.min(thirtyDays.getTime(), sevenDaysBeforeExpiry.getTime()),
  ));
  return { expiresAt, nextRefreshAt };
}

export class InstagramService {
  private readonly instagramClient: SupabaseClient<any, any, any>;
  private readonly crmClient: SupabaseClient<any, any, any>;
  private readonly api: InstagramApiClient | null;
  private readonly cipher: InstagramTokenCipher | null;

  constructor(private readonly config: InstagramServiceConfig) {
    this.instagramClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "instagram" },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.crmClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "crm" },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.api = config.appId?.trim() && config.appSecret?.trim()
      ? new InstagramApiClient(config.appId.trim(), config.appSecret.trim(), config.graphApiVersion ?? "v26.0")
      : null;
    this.cipher = config.encryptionKey?.trim()
      ? new InstagramTokenCipher(config.encryptionKey, config.encryptionKeyVersion?.trim() || "v1")
      : null;
  }

  isEnabled() {
    return this.config.enabled === true;
  }

  private requireRuntime() {
    if (!this.isEnabled()) {
      throw new InstagramServiceError("Canal Instagram ainda nao habilitado", "INSTAGRAM_DISABLED", 503);
    }
    if (!this.api || !this.cipher) {
      throw new InstagramServiceError("Configuracao segura do Instagram incompleta", "INSTAGRAM_CONFIGURATION", 503);
    }
    return { api: this.api, cipher: this.cipher };
  }

  private getRedirectUri() {
    const base = normalizePublicBaseUrl(this.config.backendPublicUrl, "CRM_BACKEND_PUBLIC_URL");
    return `${base}/api/instagram/oauth/callback`;
  }

  buildFrontendRedirect(returnPath: string, status: "connected" | "error") {
    const base = normalizePublicBaseUrl(this.config.frontendPublicUrl, "CRM_FRONTEND_PUBLIC_URL");
    const url = new URL(sanitizeReturnPath(returnPath), `${base}/`);
    url.searchParams.set("instagram", status);
    return url.toString();
  }

  createMediaDeliveryUrl(input: { acesId: number; attachmentId: string }) {
    if (!Number.isInteger(input.acesId) || input.acesId <= 0 || !isUuid(input.attachmentId)) {
      throw new InstagramServiceError("Anexo Instagram invalido", "INSTAGRAM_MEDIA_INVALID", 400);
    }
    const secret = requireText(this.config.appSecret, "INSTAGRAM_APP_SECRET");
    const payload = Buffer.from(JSON.stringify({
      acesId: input.acesId,
      attachmentId: input.attachmentId,
      expiresAt: Date.now() + INSTAGRAM_MEDIA_DELIVERY_TTL_MS,
    })).toString("base64url");
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");
    const base = normalizePublicBaseUrl(this.config.backendPublicUrl, "CRM_BACKEND_PUBLIC_URL");
    return `${base}/api/instagram/media/${payload}.${signature}`;
  }

  async downloadMediaDelivery(token: string) {
    const [payload, suppliedSignature, extra] = token.split(".");
    if (!payload || !suppliedSignature || extra) {
      throw new InstagramServiceError("Link de midia Instagram invalido", "INSTAGRAM_MEDIA_LINK_INVALID", 404);
    }
    const secret = requireText(this.config.appSecret, "INSTAGRAM_APP_SECRET");
    const expectedSignature = createHmac("sha256", secret).update(payload).digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(suppliedSignature, "base64url");
    } catch {
      throw new InstagramServiceError("Link de midia Instagram invalido", "INSTAGRAM_MEDIA_LINK_INVALID", 404);
    }
    if (supplied.length !== expectedSignature.length || !timingSafeEqual(supplied, expectedSignature)) {
      throw new InstagramServiceError("Link de midia Instagram invalido", "INSTAGRAM_MEDIA_LINK_INVALID", 404);
    }
    let decoded: Record<string, unknown>;
    try {
      decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      throw new InstagramServiceError("Link de midia Instagram invalido", "INSTAGRAM_MEDIA_LINK_INVALID", 404);
    }
    const acesId = Number(decoded.acesId);
    const attachmentId = typeof decoded.attachmentId === "string" ? decoded.attachmentId : "";
    const expiresAt = Number(decoded.expiresAt);
    if (
      !Number.isInteger(acesId) || acesId <= 0 || !isUuid(attachmentId) ||
      !Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
      expiresAt > Date.now() + INSTAGRAM_MEDIA_DELIVERY_TTL_MS + 60_000
    ) {
      throw new InstagramServiceError("Link de midia Instagram expirado", "INSTAGRAM_MEDIA_LINK_EXPIRED", 404);
    }
    const { data: intent, error: intentError } = await this.crmClient
      .from("message_attachment_upload_intents")
      .select("storage_bucket, storage_path, mime_type, file_name, status, intent_expires_at")
      .eq("aces_id", acesId)
      .eq("attachment_id", attachmentId)
      .in("status", ["issued", "consumed"])
      .maybeSingle();
    if (intentError || !intent || Date.parse(intent.intent_expires_at) <= Date.now()) {
      throw new InstagramServiceError("Midia Instagram indisponivel", "INSTAGRAM_MEDIA_NOT_FOUND", 404);
    }
    const { data, error } = await this.crmClient.storage
      .from(String(intent.storage_bucket))
      .download(String(intent.storage_path));
    if (error || !data) {
      throw new InstagramServiceError("Midia Instagram indisponivel", "INSTAGRAM_MEDIA_NOT_FOUND", 404);
    }
    return {
      data,
      mimeType: String(intent.mime_type),
      fileName: String(intent.file_name),
    };
  }

  async beginOAuth(context: AdminContext, input: { instanceName: string; returnPath?: string | null }) {
    const { api } = this.requireRuntime();
    if (context.role !== "ADMIN") {
      throw new InstagramServiceError("Apenas administradores podem conectar Instagram", "INSTAGRAM_ADMIN_REQUIRED", 403);
    }
    const instanceName = input.instanceName.trim();
    if (!instanceName || instanceName.length > 100) {
      throw new InstagramServiceError("Nome da instancia Instagram invalido", "INSTAGRAM_INSTANCE_INVALID");
    }
    const appSecret = requireText(this.config.appSecret, "INSTAGRAM_APP_SECRET");
    const { state, nonce } = createSignedOAuthState(appSecret);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const redirectUri = this.getRedirectUri();
    const { error } = await this.instagramClient.rpc("rpc_begin_oauth", {
      p_aces_id: context.acesId,
      p_instance_name: instanceName,
      p_initiated_by: context.crmUserId,
      p_state_hash: toPostgresBytea(sha256(state)),
      p_nonce_hash: toPostgresBytea(sha256(nonce)),
      p_return_path: sanitizeReturnPath(input.returnPath),
      p_redirect_uri: redirectUri,
      p_expires_at: expiresAt,
    });
    if (error) {
      throw new InstagramServiceError("Nao foi possivel iniciar a conexao Instagram", "INSTAGRAM_OAUTH_START", 409);
    }
    return { authorizationUrl: api.buildAuthorizationUrl(redirectUri, state), expiresAt };
  }

  async completeOAuth(input: { state: string; code: string }) {
    const { api, cipher } = this.requireRuntime();
    const appSecret = requireText(this.config.appSecret, "INSTAGRAM_APP_SECRET");
    const signed = verifySignedOAuthState(input.state, appSecret);
    if (!signed) {
      throw new InstagramServiceError("Estado OAuth invalido ou expirado", "INSTAGRAM_OAUTH_STATE", 400);
    }

    const { data, error } = await this.instagramClient.rpc("rpc_claim_oauth", {
      p_state_hash: toPostgresBytea(sha256(input.state)),
      p_authorization_code_hash: toPostgresBytea(sha256(input.code)),
    });
    if (error || !data) {
      const duplicate = await this.lookupCompletedOAuth(input.state, input.code);
      if (duplicate) return duplicate;
      throw new InstagramServiceError("Autorizacao Instagram expirada ou ja utilizada", "INSTAGRAM_OAUTH_REPLAY", 409);
    }

    const claim = asRecord(data);
    const stateId = String(claim.stateId ?? "");
    const returnPath = sanitizeReturnPath(String(claim.returnPath ?? ""));
    if (String(claim.nonceHash ?? "") !== sha256(signed.nonce).toString("hex")) {
      await this.failOAuth(stateId, "nonce_mismatch");
      throw new InstagramServiceError("Nonce OAuth invalido", "INSTAGRAM_OAUTH_NONCE", 400);
    }

    try {
      const redirectUri = String(claim.redirectUri ?? this.getRedirectUri());
      const shortLived = await api.exchangeAuthorizationCode(input.code.replace(/#_$/, ""), redirectUri);
      const longLived = await api.exchangeLongLivedToken(shortLived.accessToken);
      const profile = await api.getProfile(longLived.accessToken);
      await api.subscribeToWebhooks(longLived.accessToken, profile.id);
      const obtainedAt = new Date();
      const schedule = computeTokenSchedule(obtainedAt, longLived.expiresIn);
      const encrypted = cipher.encrypt(longLived.accessToken);
      const completed = await this.instagramClient.rpc("rpc_complete_oauth", {
        p_state_id: stateId,
        p_ig_user_id: profile.id || shortLived.userId,
        p_ig_username: profile.username,
        p_access_token_ciphertext: toPostgresBytea(encrypted.ciphertext),
        p_iv: toPostgresBytea(encrypted.iv),
        p_auth_tag: toPostgresBytea(encrypted.authTag),
        p_key_version: encrypted.keyVersion,
        p_token_obtained_at: obtainedAt.toISOString(),
        p_token_expires_at: schedule.expiresAt.toISOString(),
        p_next_refresh_at: schedule.nextRefreshAt.toISOString(),
      });
      if (completed.error || !completed.data) {
        throw new InstagramServiceError("Nao foi possivel concluir a conexao Instagram", "INSTAGRAM_OAUTH_PERSIST", 500);
      }
      return { ...asRecord(completed.data), returnPath };
    } catch (error) {
      await this.failOAuth(stateId, error instanceof InstagramApiError ? `meta_${error.details.code ?? error.details.status}` : "oauth_exchange_failed");
      if (error instanceof InstagramServiceError) throw error;
      if (error instanceof InstagramApiError) {
        throw new InstagramServiceError("A Meta recusou a autorizacao Instagram", "INSTAGRAM_OAUTH_META", 502, error.details.transient);
      }
      throw new InstagramServiceError("Falha ao concluir a autorizacao Instagram", "INSTAGRAM_OAUTH_CALLBACK", 500);
    }
  }

  private async lookupCompletedOAuth(state: string, code: string) {
    const { data } = await this.instagramClient
      .from("oauth_states")
      .select("return_path, completed_channel_id, status, authorization_code_hash")
      .eq("state_hash", toPostgresBytea(sha256(state)))
      .eq("status", "succeeded")
      .maybeSingle();
    const storedCodeHash = data?.authorization_code_hash
      ? fromPostgresBytea(data.authorization_code_hash).toString("hex")
      : null;
    return data && storedCodeHash === sha256(code).toString("hex")
      ? { channelId: data.completed_channel_id, returnPath: sanitizeReturnPath(data.return_path) }
      : null;
  }

  private async failOAuth(stateId: string, errorCode: string) {
    if (!stateId) return;
    await this.instagramClient.rpc("rpc_fail_oauth", { p_state_id: stateId, p_error_code: errorCode });
  }

  async listChannels(acesId: number) {
    const [{ data: bindings, error: bindingError }, { data: channels, error: channelError }] = await Promise.all([
      this.crmClient
        .from("instance_channels")
        .select("id, instance_name, status")
        .eq("aces_id", acesId)
        .eq("provider", "instagram"),
      this.instagramClient
        .from("channels")
        .select("channel_id, ig_user_id, ig_username, health_status, token_obtained_at, token_expires_at, last_refreshed_at, last_error_code, last_error_at")
        .eq("aces_id", acesId),
    ]);
    if (bindingError || channelError) {
      throw new InstagramServiceError("Nao foi possivel listar canais Instagram", "INSTAGRAM_CHANNEL_LIST", 500);
    }
    const byId = new Map((channels ?? []).map((channel) => [String(channel.channel_id), channel]));
    return (bindings ?? []).map((binding) => {
      const channel = byId.get(String(binding.id));
      return {
        channelId: String(binding.id),
        instanceName: String(binding.instance_name),
        status: String(binding.status),
        healthStatus: channel ? String(channel.health_status) : "pending",
        igUserId: channel ? String(channel.ig_user_id) : null,
        igUsername: channel?.ig_username ? String(channel.ig_username) : null,
        tokenObtainedAt: channel?.token_obtained_at ? String(channel.token_obtained_at) : null,
        tokenExpiresAt: channel?.token_expires_at ? String(channel.token_expires_at) : null,
        lastRefreshedAt: channel?.last_refreshed_at ? String(channel.last_refreshed_at) : null,
        lastErrorCode: channel?.last_error_code ? String(channel.last_error_code) : null,
        lastErrorAt: channel?.last_error_at ? String(channel.last_error_at) : null,
      };
    });
  }

  async disableChannel(context: AdminContext, channelId: string) {
    if (context.role !== "ADMIN") {
      throw new InstagramServiceError("Apenas administradores podem desativar canais Instagram", "INSTAGRAM_ADMIN_REQUIRED", 403);
    }
    if (!/^[0-9a-f-]{36}$/i.test(channelId)) {
      throw new InstagramServiceError("Canal Instagram invalido", "INSTAGRAM_CHANNEL_INVALID", 400);
    }
    const { data, error } = await this.instagramClient.rpc("rpc_disable_channel", {
      p_channel_id: channelId,
      p_aces_id: context.acesId,
      p_actor_id: context.crmUserId,
    });
    if (error || !data) {
      throw new InstagramServiceError("Nao foi possivel desativar o canal Instagram", "INSTAGRAM_CHANNEL_DISABLE", error?.code === "P0001" ? 404 : 500);
    }
    return asRecord(data);
  }

  async refreshChannel(context: AdminContext, channelId: string) {
    const { api, cipher } = this.requireRuntime();
    if (context.role !== "ADMIN") {
      throw new InstagramServiceError("Apenas administradores podem renovar canais Instagram", "INSTAGRAM_ADMIN_REQUIRED", 403);
    }
    if (!/^[0-9a-f-]{36}$/i.test(channelId)) {
      throw new InstagramServiceError("Canal Instagram invalido", "INSTAGRAM_CHANNEL_INVALID", 400);
    }

    const { data: currentChannel, error: currentChannelError } = await this.instagramClient
      .from("channels")
      .select("token_expires_at, health_status")
      .eq("channel_id", channelId)
      .eq("aces_id", context.acesId)
      .maybeSingle();
    if (currentChannelError) {
      throw new InstagramServiceError("Nao foi possivel consultar o canal Instagram", "INSTAGRAM_REFRESH_STATE", 500);
    }
    if (currentChannel?.health_status === "disabled") {
      throw new InstagramServiceError("O canal Instagram esta desativado", "INSTAGRAM_CHANNEL_DISABLED", 409);
    }
    if (currentChannel?.token_expires_at && Date.parse(String(currentChannel.token_expires_at)) <= Date.now()) {
      await this.instagramClient.rpc("rpc_mark_reconnect_required", {
        p_channel_id: channelId,
        p_aces_id: context.acesId,
        p_error_code: "token_expired",
      });
      await this.recordRefreshFailure(context.acesId, channelId, "token_expired", true, context.crmUserId);
      throw new InstagramServiceError("Reconecte a conta Instagram", "INSTAGRAM_RECONNECT_REQUIRED", 409);
    }

    const workerId = `instagram-manual-refresh:${context.crmUserId}:${channelId}`;
    const { data, error } = await this.instagramClient.rpc("rpc_claim_manual_token_refresh", {
      p_channel_id: channelId,
      p_aces_id: context.acesId,
      p_worker_id: workerId,
      p_min_token_age_hours: 24,
      p_lease_seconds: 120,
    });
    if (error) throw new InstagramServiceError("Nao foi possivel iniciar a renovacao Instagram", "INSTAGRAM_REFRESH_CLAIM", 409);
    const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
    if (!row) throw new InstagramServiceError("A renovacao ainda nao esta disponivel", "INSTAGRAM_REFRESH_NOT_DUE", 409);

    await this.recordRefreshAudit(context.acesId, channelId, context.crmUserId, "started");
    try {
      const currentToken = cipher.decrypt({
        ciphertext: fromPostgresBytea(row.access_token_ciphertext),
        iv: fromPostgresBytea(row.iv),
        authTag: fromPostgresBytea(row.auth_tag),
        keyVersion: String(row.key_version),
      });
      const refreshed = await api.refreshAccessToken(currentToken);
      const obtainedAt = new Date();
      const schedule = computeTokenSchedule(obtainedAt, refreshed.expiresIn);
      const encrypted = cipher.encrypt(refreshed.accessToken);
      const completed = await this.instagramClient.rpc("rpc_complete_token_refresh", {
        p_channel_id: channelId,
        p_worker_id: workerId,
        p_access_token_ciphertext: toPostgresBytea(encrypted.ciphertext),
        p_iv: toPostgresBytea(encrypted.iv),
        p_auth_tag: toPostgresBytea(encrypted.authTag),
        p_key_version: encrypted.keyVersion,
        p_token_expires_at: schedule.expiresAt.toISOString(),
        p_next_refresh_at: schedule.nextRefreshAt.toISOString(),
      });
      if (completed.error || completed.data !== true) throw completed.error ?? new Error("Lease de refresh Instagram expirada");
      await this.recordRefreshAudit(context.acesId, channelId, context.crmUserId, "succeeded");
      return { channelId, tokenExpiresAt: schedule.expiresAt.toISOString(), lastRefreshedAt: obtainedAt.toISOString() };
    } catch (refreshError) {
      const reconnectRequired = refreshError instanceof InstagramApiError && !refreshError.details.transient;
      const errorCode = refreshError instanceof InstagramApiError
        ? `meta_${refreshError.details.code ?? refreshError.details.status}`
        : "manual_refresh_failed";
      await this.instagramClient.rpc("rpc_fail_token_refresh", {
        p_channel_id: channelId,
        p_worker_id: workerId,
        p_error_code: errorCode,
        p_reconnect_required: reconnectRequired,
      });
      await this.recordRefreshFailure(context.acesId, channelId, errorCode, reconnectRequired, context.crmUserId);
      throw new InstagramServiceError(
        reconnectRequired ? "Reconecte a conta Instagram" : "Nao foi possivel renovar a conta Instagram",
        reconnectRequired ? "INSTAGRAM_RECONNECT_REQUIRED" : "INSTAGRAM_REFRESH_FAILED",
        409,
        !reconnectRequired,
      );
    }
  }

  private async recordRefreshAudit(acesId: number, channelId: string, actorId: string | null, outcome: "started" | "succeeded" | "failed", errorCode?: string) {
    const { error } = await this.instagramClient.from("admin_audit_events").insert({
      aces_id: acesId,
      channel_id: channelId,
      actor_id: actorId,
      action: "refresh",
      outcome,
      error_code: errorCode ?? null,
    });
    if (error) console.warn("[instagram-ops] Auditoria de refresh indisponivel", { errorCode: "instagram_audit_write_failed" });
  }

  async recordRefreshSuccess(acesId: number, channelId: string) {
    await this.recordRefreshAudit(acesId, channelId, null, "succeeded");
  }

  async recordRefreshFailure(acesId: number, channelId: string, errorCode: string, reconnectRequired: boolean, actorId: string | null = null) {
    await this.recordRefreshAudit(acesId, channelId, actorId, "failed", errorCode);
    const { error } = await this.instagramClient.rpc("rpc_record_refresh_alert", {
      p_channel_id: channelId,
      p_aces_id: acesId,
      p_error_code: errorCode,
      p_reconnect_required: reconnectRequired,
    });
    if (error) console.warn("[instagram-ops] Alerta de refresh indisponivel", { errorCode: "instagram_alert_write_failed" });
  }

  async getOperationalMetrics(acesId: number, sinceHours = 24) {
    const hours = Math.min(Math.max(Number.isFinite(sinceHours) ? sinceHours : 24, 1), 168);
    const { data, error } = await this.instagramClient.rpc("rpc_operational_metrics", {
      p_aces_id: acesId,
      p_since: new Date(Date.now() - hours * 60 * 60 * 1000).toISOString(),
    });
    if (error || !data) throw new InstagramServiceError("Nao foi possivel carregar as metricas Instagram", "INSTAGRAM_METRICS", 500);
    return data;
  }

  async getMessagingUserProfile(channelId: string, providerUserId: string) {
    const { api, cipher } = this.requireRuntime();
    const { data, error } = await this.instagramClient
      .from("channel_credentials")
      .select("access_token_ciphertext, iv, auth_tag, key_version")
      .eq("channel_id", channelId)
      .maybeSingle();
    if (error || !data) throw error ?? new Error("Credencial Instagram nao encontrada");
    const accessToken = cipher.decrypt({
      ciphertext: fromPostgresBytea(data.access_token_ciphertext),
      iv: fromPostgresBytea(data.iv),
      authTag: fromPostgresBytea(data.auth_tag),
      keyVersion: String(data.key_version),
    });
    return api.getMessagingUserProfile(accessToken, providerUserId);
  }

  private async resolveOutboundContext(input: {
    acesId: number;
    instanceName: string;
    leadId: string;
  }) {
    const { api, cipher } = this.requireRuntime();
    if (this.config.outboundEnabled !== true) {
      throw new InstagramServiceError("Envio Instagram ainda nao habilitado", "INSTAGRAM_OUTBOUND_DISABLED", 503);
    }
    const { data: binding, error: bindingError } = await this.crmClient
      .from("instance_channels")
      .select("id, status, capability")
      .eq("aces_id", input.acesId)
      .eq("instance_name", input.instanceName)
      .eq("provider", "instagram")
      .maybeSingle();
    if (bindingError || !binding || binding.status !== "active" || binding.capability === "disabled") {
      throw new InstagramServiceError("Canal Instagram inativo", "INSTAGRAM_CHANNEL_INACTIVE", 409);
    }

    const [identityResult, channelResult, inboundResult] = await Promise.all([
      this.crmClient
        .from("lead_channel_identities")
        .select("provider_user_id")
        .eq("aces_id", input.acesId)
        .eq("lead_id", input.leadId)
        .eq("channel_id", binding.id)
        .maybeSingle(),
      this.instagramClient
        .from("channels")
        .select("ig_user_id, health_status, token_expires_at")
        .eq("channel_id", binding.id)
        .eq("aces_id", input.acesId)
        .maybeSingle(),
      this.crmClient
        .from("message_history")
        .select("sent_at")
        .eq("aces_id", input.acesId)
        .eq("lead_id", input.leadId)
        .eq("instance", input.instanceName)
        .eq("provider", "instagram")
        .eq("direction", "inbound")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (identityResult.error || channelResult.error || inboundResult.error) {
      throw new InstagramServiceError("Nao foi possivel validar o envio Instagram", "INSTAGRAM_SEND_LOOKUP", 500);
    }
    const identity = identityResult.data;
    const channel = channelResult.data;
    if (!identity?.provider_user_id || !channel?.ig_user_id) {
      throw new InstagramServiceError("Identidade Instagram do lead nao encontrada", "INSTAGRAM_IDENTITY_MISSING", 409);
    }
    if (channel.health_status === "reconnect_required" || (channel.token_expires_at && Date.parse(channel.token_expires_at) <= Date.now())) {
      throw new InstagramServiceError("Reconecte a conta Instagram", "INSTAGRAM_RECONNECT_REQUIRED", 409);
    }
    const humanAgentWindow = evaluateInstagramHumanAgentWindow(inboundResult.data?.sent_at);
    if (!humanAgentWindow.isOpen) {
      throw new InstagramServiceError("A janela de atendimento Instagram foi encerrada", "INSTAGRAM_WINDOW_CLOSED", 409);
    }
    const { data: credential, error: credentialError } = await this.instagramClient
      .from("channel_credentials")
      .select("access_token_ciphertext, iv, auth_tag, key_version")
      .eq("channel_id", binding.id)
      .maybeSingle();
    if (credentialError || !credential) {
      throw new InstagramServiceError("Credencial Instagram indisponivel", "INSTAGRAM_CREDENTIAL_MISSING", 503);
    }
    const accessToken = cipher.decrypt({
      ciphertext: fromPostgresBytea(credential.access_token_ciphertext),
      iv: fromPostgresBytea(credential.iv),
      authTag: fromPostgresBytea(credential.auth_tag),
      keyVersion: String(credential.key_version),
    });
    return {
      api,
      accessToken,
      igUserId: String(channel.ig_user_id),
      recipientId: String(identity.provider_user_id),
      tag: humanAgentWindow.tag,
    };
  }

  async sendText(input: {
    acesId: number;
    instanceName: string;
    leadId: string;
    text: string;
    source: "human";
  }) {
    const text = input.text.trim();
    if (!text || text.length > 1_000) {
      throw new InstagramServiceError("Mensagem Instagram invalida", "INSTAGRAM_TEXT_INVALID", 400);
    }
    const outbound = await this.resolveOutboundContext(input);
    return outbound.api.sendText({
      accessToken: outbound.accessToken,
      igUserId: outbound.igUserId,
      recipientId: outbound.recipientId,
      text,
      ...(outbound.tag ? { tag: outbound.tag } : {}),
    });
  }

  async sendMedia(input: {
    acesId: number;
    instanceName: string;
    leadId: string;
    kind: "image" | "audio";
    mediaUrl: string;
    source: "human";
  }) {
    let mediaUrl: URL;
    try {
      mediaUrl = new URL(input.mediaUrl);
    } catch {
      throw new InstagramServiceError("URL da midia Instagram invalida", "INSTAGRAM_MEDIA_URL_INVALID", 400);
    }
    if (mediaUrl.protocol !== "https:") {
      throw new InstagramServiceError("A midia Instagram deve usar HTTPS", "INSTAGRAM_MEDIA_URL_INVALID", 400);
    }
    const outbound = await this.resolveOutboundContext(input);
    return outbound.api.sendMedia({
      accessToken: outbound.accessToken,
      igUserId: outbound.igUserId,
      recipientId: outbound.recipientId,
      kind: input.kind,
      mediaUrl: mediaUrl.toString(),
      ...(outbound.tag ? { tag: outbound.tag } : {}),
    });
  }

  getApiAndCipherForWorker() {
    return this.requireRuntime();
  }

  getInstagramClient() {
    return this.instagramClient;
  }
}
