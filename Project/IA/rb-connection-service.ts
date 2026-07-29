import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import { createClient } from "@supabase/supabase-js";

type RbConnectionStatus = "active" | "inactive";

type RbConnectionRow = {
  id: string;
  aces_id: number;
  rb_aces_id: number | null;
  rb_base_url: string;
  rb_token_api: string;
  rb_empresa_ids: unknown;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type RbConnectionServiceConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  jwtSecret?: string;
  rbApiBaseUrl?: string;
};

export type SaveRbConnectionInput = {
  id?: string | null;
  acesId: number;
  rbTokenApi?: string | null;
  rbEmpresaIds: string[];
  status: RbConnectionStatus;
};

export type RbWebhookTokenPayload = {
  connection_id: string;
  internal_aces_id: number;
  aces_id: number;
  emp_id: number;
  exp: number;
};

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function safeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function normalizeConnection(row: RbConnectionRow) {
  return {
    id: row.id,
    rbEmpresaIds: normalizeStringArray(row.rb_empresa_ids),
    status: row.is_active ? ("active" as const) : ("inactive" as const),
    hasTokenApi: Boolean(row.rb_token_api),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RbConnectionService {
  private readonly rbClient;
  private readonly agentsClient;
  private readonly jwtSecret: string | null;
  private readonly rbApiBaseUrl: string;

  constructor(config: RbConnectionServiceConfig) {
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    this.rbClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      ...options,
      db: { schema: "rb" },
    });
    this.agentsClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      ...options,
      db: { schema: "agents" },
    });
    this.jwtSecret = config.jwtSecret?.trim() || null;
    this.rbApiBaseUrl = (config.rbApiBaseUrl?.trim() || "https://app.registrobase.com.br:32077")
      .replace(/\/$/, "");
  }

  async listConnections(acesId: number) {
    const { data, error } = await this.rbClient
      .from("connections")
      .select("*")
      .eq("aces_id", acesId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as RbConnectionRow[]).map(normalizeConnection);
  }

  async saveConnection(input: SaveRbConnectionInput) {
    const existing = input.id
      ? await this.findById(input.id, input.acesId)
      : await this.findByAccount(input.acesId);
    const tokenApi = input.rbTokenApi?.trim() || existing?.rb_token_api || null;
    if (!tokenApi) {
      throw new Error("Token API do RB e obrigatorio");
    }
    const row = {
      id: existing?.id ?? undefined,
      aces_id: input.acesId,
      rb_base_url: this.rbApiBaseUrl,
      rb_token_api: tokenApi,
      rb_empresa_ids: input.rbEmpresaIds,
      is_active: input.status === "active",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.rbClient
      .from("connections")
      .upsert(row, { onConflict: "aces_id" })
      .select("*")
      .single();
    if (error) throw error;

    await this.syncAccountTools(input.acesId);
    return normalizeConnection(data as RbConnectionRow);
  }

  async deleteConnection(acesId: number, connectionId: string) {
    const { error } = await this.rbClient
      .from("connections")
      .delete()
      .eq("id", connectionId)
      .eq("aces_id", acesId);
    if (error) throw error;
    await this.syncAccountTools(acesId);
    return { success: true };
  }

  async authenticate(input: { rbAcesId: number; apiKey: string }) {
    const { data, error } = await this.rbClient
      .from("connections")
      .select("*")
      .eq("rb_token_api", input.apiKey)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const connection = data as RbConnectionRow;
    if (!safeEquals(input.apiKey, connection.rb_token_api)) return null;
    if (connection.rb_aces_id !== null) {
      return connection.rb_aces_id === input.rbAcesId ? connection : null;
    }

    const { data: boundConnection, error: bindError } = await this.rbClient
      .from("connections")
      .update({ rb_aces_id: input.rbAcesId, updated_at: new Date().toISOString() })
      .eq("id", connection.id)
      .is("rb_aces_id", null)
      .select("*")
      .maybeSingle();
    if (bindError?.code === "23505") return null;
    if (bindError) throw bindError;
    if (boundConnection) return boundConnection as RbConnectionRow;

    const refreshed = await this.findById(connection.id, connection.aces_id);
    return refreshed?.rb_aces_id === input.rbAcesId ? refreshed : null;
  }

  signWebhookToken(connection: RbConnectionRow, empId: number) {
    if (!this.jwtSecret) {
      throw new Error("RB_WEBHOOK_JWT_SECRET nao configurado");
    }
    if (!Number.isInteger(connection.rb_aces_id)) {
      throw new Error("Conexao Via RB ainda nao vinculada ao aces_id do RB");
    }
    const exp = Math.floor(Date.now() / 1000) + 300;
    const payload: RbWebhookTokenPayload = {
      connection_id: connection.id,
      internal_aces_id: connection.aces_id,
      aces_id: connection.rb_aces_id as number,
      emp_id: empId,
      exp,
    };
    const header = encodeJson({ alg: "HS256", typ: "JWT" });
    const body = encodeJson(payload);
    const signature = createHmac("sha256", this.jwtSecret)
      .update(`${header}.${body}`)
      .digest("base64url");
    return { token: `${header}.${body}.${signature}`, exp };
  }

  async verifyWebhookToken(token: string) {
    if (!this.jwtSecret) {
      throw new Error("RB_WEBHOOK_JWT_SECRET nao configurado");
    }
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) return null;
    const expected = createHmac("sha256", this.jwtSecret)
      .update(`${header}.${body}`)
      .digest("base64url");
    if (!safeEquals(signature, expected)) return null;

    let payload: RbWebhookTokenPayload;
    try {
      const decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as Record<string, unknown>;
      if (decodedHeader.alg !== "HS256") return null;
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as RbWebhookTokenPayload;
    } catch {
      return null;
    }
    if (
      !payload.connection_id
      || !Number.isInteger(payload.aces_id)
      || !Number.isInteger(payload.emp_id)
      || !Number.isInteger(payload.exp)
      || payload.exp <= Math.floor(Date.now() / 1000)
    ) return null;

    if (!Number.isInteger(payload.internal_aces_id)) return null;
    const connection = await this.findById(payload.connection_id, payload.internal_aces_id);
    if (!connection?.is_active) return null;
    if (connection.rb_aces_id !== payload.aces_id) return null;
    return { payload, connection };
  }

  async resolveBillingConfig(acesId: number, agentId: string) {
    await this.assertAgent(acesId, agentId);
    const { data, error } = await this.rbClient
      .from("connections")
      .select("rb_token_api, rb_empresa_ids")
      .eq("aces_id", acesId)
      .eq("is_active", true)
      .not("rb_token_api", "is", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      rb_base_url: this.rbApiBaseUrl,
      rb_token_api: String(data.rb_token_api),
      rb_empresa_ids: normalizeStringArray(data.rb_empresa_ids),
    };
  }

  private async findById(id: string, acesId: number) {
    const { data, error } = await this.rbClient
      .from("connections")
      .select("*")
      .eq("id", id)
      .eq("aces_id", acesId)
      .maybeSingle();
    if (error) throw error;
    return (data as RbConnectionRow | null) ?? null;
  }

  private async findByAccount(acesId: number) {
    const { data, error } = await this.rbClient
      .from("connections")
      .select("*")
      .eq("aces_id", acesId)
      .maybeSingle();
    if (error) throw error;
    return (data as RbConnectionRow | null) ?? null;
  }

  private async assertAgent(acesId: number, agentId: string) {
    const { data, error } = await this.agentsClient
      .from("ai_agents")
      .select("id")
      .eq("id", agentId)
      .eq("aces_id", acesId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Agente nao pertence a esta conta");
  }

  private async syncAccountTools(acesId: number) {
    const connection = await this.findByAccount(acesId);
    const companyIds = normalizeStringArray(connection?.rb_empresa_ids);
    const billingReady = Boolean(
      connection?.is_active
      && connection.rb_token_api
      && companyIds.length > 0,
    );
    const { count: catalogCount, error: catalogError } = await this.agentsClient
      .from("visagism_catalog_items")
      .select("id", { count: "exact", head: true })
      .eq("aces_id", acesId)
      .eq("is_active", true);
    if (catalogError) throw catalogError;
    const visagismReady = Boolean(connection?.is_active || Number(catalogCount ?? 0) > 0);

    const { data: tools, error: toolsError } = await this.agentsClient
      .from("agent_tools")
      .select("id, tool_key, config, is_enabled")
      .eq("aces_id", acesId)
      .in("tool_key", ["rb_billing", "visagism"]);
    if (toolsError) throw toolsError;

    for (const tool of tools ?? []) {
      const isBilling = tool.tool_key === "rb_billing";
      const ready = isBilling ? billingReady : visagismReady;
      const currentConfig = tool.config && typeof tool.config === "object"
        ? { ...tool.config as Record<string, unknown> }
        : {};
      if (isBilling) delete currentConfig.rb_token_api;
      const config = isBilling && billingReady
        ? { ...currentConfig, rb_mode: "live", rb_empresa_ids: companyIds }
        : currentConfig;
      const { error: updateError } = await this.agentsClient
        .from("agent_tools")
        .update({
          readiness: ready ? "ready" : "needs_config",
          is_enabled: ready ? Boolean(tool.is_enabled) : false,
          config,
          last_validated_at: new Date().toISOString(),
        })
        .eq("id", tool.id)
        .eq("aces_id", acesId);
      if (updateError) throw updateError;
    }
  }
}

export type RbConnectionRecord = RbConnectionRow;
