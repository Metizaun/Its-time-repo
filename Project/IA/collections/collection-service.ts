import { randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { fromBytea, SecretCipher, toBytea } from "./secret-cipher.js";

type SourceType = "rb" | "webhook" | "file" | string;

export type CollectionSourceInput = {
  name: string;
  sourceType: SourceType;
  deliveryMode: "pull" | "push" | "file";
  defaultIngestionMode: "snapshot" | "incremental";
  timezone?: string;
  staleAfterMinutes?: number;
  capabilities?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

type CredentialRow = {
  ciphertext: unknown;
  iv: unknown;
  auth_tag: unknown;
  key_version: string;
};

function requireEncryptionConfig() {
  const key = process.env.COLLECTION_SECRETS_ENCRYPTION_KEY?.trim();
  const version = process.env.COLLECTION_SECRETS_ENCRYPTION_KEY_VERSION?.trim() || "v1";
  if (!key) throw new Error("COLLECTION_SECRETS_ENCRYPTION_KEY nao configurada");
  return new SecretCipher(key, version);
}

function sourceCapabilities(sourceType: string, supplied: Record<string, unknown> = {}) {
  const defaults: Record<string, Record<string, unknown>> = {
    rb: {
      delivery: "pull", supportedModes: ["incremental"],
      supportsAuthoritativeSnapshot: false, suppliesFinancialStatus: true,
      suppliesPaymentInstructions: true,
    },
    webhook: {
      delivery: "push", supportedModes: ["snapshot", "incremental"],
      supportsAuthoritativeSnapshot: true, suppliesFinancialStatus: true,
      suppliesPaymentInstructions: true,
    },
    file: {
      delivery: "file", supportedModes: ["snapshot", "incremental"],
      supportsAuthoritativeSnapshot: true, suppliesFinancialStatus: true,
      suppliesPaymentInstructions: true,
    },
  };
  return { ...(defaults[sourceType] ?? {}), ...supplied };
}

export class CollectionService {
  readonly collections: SupabaseClient<any, "collections", any>;
  readonly crm: SupabaseClient<any, "crm", any>;
  readonly agents: SupabaseClient<any, "agents", any>;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    const auth = { persistSession: false, autoRefreshToken: false };
    this.collections = createClient(supabaseUrl, serviceRoleKey, { auth, db: { schema: "collections" } });
    this.crm = createClient(supabaseUrl, serviceRoleKey, { auth, db: { schema: "crm" } });
    this.agents = createClient(supabaseUrl, serviceRoleKey, { auth, db: { schema: "agents" } });
  }

  async listSources(acesId: number) {
    const { data, error } = await this.collections.from("source_connections")
      .select("id, public_id, name, source_type, delivery_mode, default_ingestion_mode, status, timezone, stale_after_minutes, capabilities, config, last_received_at, last_success_at, last_error_at, last_error_code, created_at, updated_at")
      .eq("aces_id", acesId).order("created_at", { ascending: false });
    if (error) throw error;
    const sources = data ?? [];
    const resolved = await Promise.all(sources.map(async (source) => {
      const { data: dispatcher, error: dispatcherError } = await this.collections.rpc("resolve_source_dispatcher", {
        p_source_connection_id: source.id,
      });
      if (dispatcherError) throw dispatcherError;
      return { ...source, resolved_dispatcher: dispatcher as string | null };
    }));
    return resolved;
  }

  async getSource(acesId: number, sourceId: string) {
    const { data, error } = await this.collections.from("source_connections")
      .select("id, public_id, aces_id, name, source_type, delivery_mode, default_ingestion_mode, status, timezone, stale_after_minutes, capabilities, config, last_received_at, last_success_at, last_error_at, last_error_code, created_at, updated_at")
      .eq("aces_id", acesId).eq("id", sourceId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async getSourceByPublicId(publicId: string) {
    const { data, error } = await this.collections.from("source_connections")
      .select("id, public_id, aces_id, name, source_type, delivery_mode, default_ingestion_mode, status, timezone, stale_after_minutes, capabilities, config")
      .eq("public_id", publicId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async createSource(acesId: number, createdBy: string | null, input: CollectionSourceInput) {
    const publicId = randomBytes(18).toString("base64url");
    const row = {
      public_id: publicId,
      aces_id: acesId,
      name: input.name.trim(),
      source_type: input.sourceType,
      delivery_mode: input.deliveryMode,
      default_ingestion_mode: input.defaultIngestionMode,
      timezone: input.timezone?.trim() || "America/Sao_Paulo",
      stale_after_minutes: input.staleAfterMinutes ?? 1440,
      capabilities: sourceCapabilities(input.sourceType, input.capabilities),
      config: input.config ?? {},
      created_by: createdBy,
    };
    const { data, error } = await this.collections.from("source_connections").insert(row)
      .select("id, public_id, name, source_type, delivery_mode, default_ingestion_mode, status, timezone, stale_after_minutes, capabilities, config, created_at, updated_at")
      .single();
    if (error) throw error;
    let secret: string | undefined;
    if (input.sourceType === "webhook") {
      secret = randomBytes(32).toString("base64url");
      try {
        await this.storeCredential(acesId, data.id, "webhook_hmac", secret);
      } catch (error) {
        const { error: cleanupError } = await this.collections.from("source_connections")
          .delete().eq("aces_id", acesId).eq("id", data.id);
        if (cleanupError) {
          console.error("[collections] source_credential_cleanup_failed", {
            sourceConnectionId: data.id,
            acesId,
            error: cleanupError.message,
          });
        }
        throw error;
      }
    }
    return { source: data, secret };
  }

  async updateSource(acesId: number, sourceId: string, input: Partial<CollectionSourceInput> & { status?: string }) {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.defaultIngestionMode !== undefined) patch.default_ingestion_mode = input.defaultIngestionMode;
    if (input.timezone !== undefined) patch.timezone = input.timezone.trim();
    if (input.staleAfterMinutes !== undefined) patch.stale_after_minutes = input.staleAfterMinutes;
    if (input.capabilities !== undefined) patch.capabilities = input.capabilities;
    if (input.config !== undefined) patch.config = input.config;
    if (input.status !== undefined) patch.status = input.status;
    const { data, error } = await this.collections.from("source_connections").update(patch)
      .eq("aces_id", acesId).eq("id", sourceId)
      .select("id, public_id, name, source_type, delivery_mode, default_ingestion_mode, status, timezone, stale_after_minutes, capabilities, config, last_success_at, last_error_at, last_error_code, updated_at")
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async disableSource(acesId: number, sourceId: string) {
    return this.updateSource(acesId, sourceId, { status: "disabled" });
  }

  async storeCredential(acesId: number, sourceId: string, type: "rb_token" | "webhook_hmac", secret: string) {
    const cipher = requireEncryptionConfig();
    const encrypted = cipher.encrypt(secret);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await this.collections.rpc("rotate_source_credential", {
      p_aces_id: acesId,
      p_source_connection_id: sourceId,
      p_credential_type: type,
      p_ciphertext: toBytea(encrypted.ciphertext),
      p_iv: toBytea(encrypted.iv),
      p_auth_tag: toBytea(encrypted.authTag),
      p_key_version: encrypted.keyVersion,
      p_valid_until: expiresAt,
    });
    if (error) throw error;
  }

  async rotateWebhookSecret(acesId: number, sourceId: string) {
    const source = await this.getSource(acesId, sourceId);
    if (!source || source.source_type !== "webhook") throw new Error("Fonte webhook nao encontrada");
    const secret = randomBytes(32).toString("base64url");
    await this.storeCredential(acesId, sourceId, "webhook_hmac", secret);
    return secret;
  }

  async getCredentialSecrets(acesId: number, sourceId: string, type: "rb_token" | "webhook_hmac") {
    const { data, error } = await this.collections.from("source_credentials")
      .select("ciphertext, iv, auth_tag, key_version, status, valid_until")
      .eq("aces_id", acesId).eq("source_connection_id", sourceId)
      .eq("credential_type", type).in("status", ["current", "previous"]);
    if (error) throw error;
    const cipher = requireEncryptionConfig();
    return (data ?? []).filter((row: any) => row.status === "current" || !row.valid_until || Date.parse(row.valid_until) > Date.now())
      .map((row: CredentialRow) => cipher.decrypt({
        ciphertext: fromBytea(row.ciphertext), iv: fromBytea(row.iv),
        authTag: fromBytea(row.auth_tag), keyVersion: row.key_version,
      }));
  }

  async listIngestions(acesId: number, sourceId?: string) {
    let query = this.collections.from("ingestion_runs").select("*").eq("aces_id", acesId)
      .order("created_at", { ascending: false }).limit(100);
    if (sourceId) query = query.eq("source_connection_id", sourceId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }
}
