import { createHash, randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  normalizePhoneForStorage,
  normalizePhoneIdentity,
} from "./phone-normalization.js";
import {
  AesGcmSecretCipher,
  fromPostgresBytea,
  toPostgresBytea,
} from "./integrations/secret-cipher.js";
import {
  verifyWebhook,
  WebhookAuthError,
} from "./integrations/webhook-security.js";
import {
  inspectPublicImage,
  PublicImageInspectionError,
} from "./integrations/public-image-inspector.js";

export type LeadWebhookConnectionStatus = "active" | "paused";

export type LeadWebhookConnection = {
  id: string;
  publicId: string;
  name: string;
  agentId: string | null;
  agentName: string | null;
  instanceName: string | null;
  defaultStageId: string | null;
  defaultStageName: string | null;
  status: LeadWebhookConnectionStatus;
  acceptMedia: boolean;
  ready: boolean;
  configurationIssue: string | null;
  webhookUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type LeadWebhookAdminInput = {
  name?: unknown;
  agentId?: unknown;
  defaultStageId?: unknown;
  status?: unknown;
  acceptMedia?: unknown;
};

export type LeadWebhookPayload = {
  name: string;
  phone: string;
  email: string | null;
  observation: string | null;
  tags: string[];
  media: {
    type: "image";
    url: string;
    caption: string | null;
  } | null;
};

export type LeadWebhookProcessResult = {
  status: number;
  body: Record<string, unknown>;
};

type ConnectionRow = {
  id: string;
  public_id: string;
  aces_id: number;
  name: string;
  agent_id: string | null;
  default_stage_id: string | null;
  status: LeadWebhookConnectionStatus;
  accept_media: boolean;
  created_at: string;
  updated_at: string;
};

type AgentRow = {
  id: string;
  aces_id: number;
  name: string;
  instance_name: string | null;
  agent_type: "primary" | "subagent";
  is_active: boolean;
};

type StageRow = {
  id: string;
  aces_id: number;
  name: string;
};

type CredentialRow = {
  ciphertext: unknown;
  iv: unknown;
  auth_tag: unknown;
  key_version: string;
  previous_ciphertext: unknown | null;
  previous_iv: unknown | null;
  previous_auth_tag: unknown | null;
  previous_key_version: string | null;
  previous_valid_until: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_PAYLOAD_FIELDS = new Set([
  "name",
  "phone",
  "email",
  "observation",
  "tags",
  "media",
]);

export class LeadWebhookError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LeadWebhookError";
  }
}

function requiredText(value: unknown, field: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text)
    throw new LeadWebhookError(
      `${field} e obrigatorio`,
      "LEAD_WEBHOOK_FIELD_REQUIRED",
      400,
    );
  if (text.length > maxLength) {
    throw new LeadWebhookError(
      `${field} excede ${maxLength} caracteres`,
      "LEAD_WEBHOOK_FIELD_TOO_LONG",
      400,
    );
  }
  return text;
}

function uuid(value: unknown, field: string) {
  const normalized = requiredText(value, field, 100).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new LeadWebhookError(
      `${field} invalido`,
      "LEAD_WEBHOOK_UUID_INVALID",
      400,
    );
  }
  return normalized;
}

function mapDatabaseError(error: { code?: string; message?: string }) {
  const message = String(error.message ?? "");
  if (error.code === "23505") {
    return new LeadWebhookError(
      "Ja existe uma conexao com este nome",
      "LEAD_WEBHOOK_CONNECTION_CONFLICT",
      409,
    );
  }
  if (error.code === "23503" || error.code === "23514") {
    return new LeadWebhookError(
      "Configuracao de webhook invalida",
      "LEAD_WEBHOOK_CONFIGURATION_INVALID",
      422,
    );
  }
  return new LeadWebhookError(
    message || "Falha ao operar a conexao de leads",
    "LEAD_WEBHOOK_DATABASE_ERROR",
    500,
  );
}

function mapRpcError(error: { code?: string; message?: string }) {
  const message = String(error.message ?? "");
  const known: Record<string, [string, number, string]> = {
    LEAD_WEBHOOK_REQUEST_INVALID: [
      "Requisicao de lead invalida",
      400,
      "LEAD_WEBHOOK_REQUEST_INVALID",
    ],
    LEAD_WEBHOOK_CONNECTION_NOT_FOUND: [
      "Conexao de leads nao encontrada",
      404,
      "LEAD_WEBHOOK_CONNECTION_NOT_FOUND",
    ],
    LEAD_WEBHOOK_CONNECTION_PAUSED: [
      "A conexao de leads esta pausada",
      409,
      "LEAD_WEBHOOK_CONNECTION_PAUSED",
    ],
    LEAD_WEBHOOK_IDEMPOTENCY_CONFLICT: [
      "A chave de idempotencia ja foi usada com outro evento",
      409,
      "LEAD_WEBHOOK_IDEMPOTENCY_CONFLICT",
    ],
    LEAD_WEBHOOK_AGENT_UNAVAILABLE: [
      "O agente da conexao nao esta disponivel",
      409,
      "LEAD_WEBHOOK_AGENT_UNAVAILABLE",
    ],
    LEAD_WEBHOOK_STAGE_UNAVAILABLE: [
      "A etapa padrao da conexao nao esta disponivel",
      409,
      "LEAD_WEBHOOK_STAGE_UNAVAILABLE",
    ],
    LEAD_WEBHOOK_PHONE_INVALID: [
      "Telefone do lead invalido",
      422,
      "LEAD_WEBHOOK_PHONE_INVALID",
    ],
  };
  const match = Object.entries(known).find(([code]) => message.includes(code));
  if (match) return new LeadWebhookError(match[1][0], match[1][2], match[1][1]);
  return new LeadWebhookError(
    "Nao foi possivel registrar o lead",
    "LEAD_WEBHOOK_DATABASE_ERROR",
    500,
  );
}

function normalizeEmail(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new LeadWebhookError(
      "email deve ser texto",
      "LEAD_WEBHOOK_EMAIL_INVALID",
      400,
    );
  }
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new LeadWebhookError(
      "email invalido",
      "LEAD_WEBHOOK_EMAIL_INVALID",
      400,
    );
  }
  return email;
}

function normalizeTags(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) {
    throw new LeadWebhookError(
      "tags deve ser uma lista com ate 50 itens",
      "LEAD_WEBHOOK_TAGS_INVALID",
      400,
    );
  }
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      throw new LeadWebhookError(
        "cada tag deve ser texto",
        "LEAD_WEBHOOK_TAGS_INVALID",
        400,
      );
    }
    const tag = item.trim();
    if (!tag || tag.length > 100) {
      throw new LeadWebhookError(
        "cada tag deve ter entre 1 e 100 caracteres",
        "LEAD_WEBHOOK_TAGS_INVALID",
        400,
      );
    }
    const key = tag.toLocaleLowerCase("pt-BR");
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

function normalizeMedia(value: unknown): LeadWebhookPayload["media"] {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LeadWebhookError("media deve ser um objeto", "LEAD_WEBHOOK_MEDIA_INVALID", 400);
  }
  const media = value as Record<string, unknown>;
  const unsupported = Object.keys(media).filter((key) => !["type", "url", "caption"].includes(key));
  if (unsupported.length > 0 || media.type !== "image") {
    throw new LeadWebhookError("media aceita somente imagens", "LEAD_WEBHOOK_MEDIA_INVALID", 400);
  }
  const url = requiredText(media.url, "media.url", 2_048);
  let caption: string | null = null;
  if (media.caption !== undefined && media.caption !== null) {
    if (typeof media.caption !== "string" || media.caption.length > 4_000) {
      throw new LeadWebhookError("media.caption invalida", "LEAD_WEBHOOK_MEDIA_INVALID", 400);
    }
    caption = media.caption.trim() || null;
  }
  return { type: "image", url, caption };
}

export function parseLeadWebhookPayload(body: unknown): LeadWebhookPayload {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new LeadWebhookError(
      "Payload JSON invalido",
      "LEAD_WEBHOOK_PAYLOAD_INVALID",
      400,
    );
  }

  const payload = body as Record<string, unknown>;
  const unsupported = Object.keys(payload).filter(
    (key) => !ALLOWED_PAYLOAD_FIELDS.has(key),
  );
  if (unsupported.length > 0) {
    throw new LeadWebhookError(
      `Campos nao permitidos no webhook: ${unsupported.join(", ")}`,
      "LEAD_WEBHOOK_FIELDS_NOT_ALLOWED",
      400,
    );
  }

  const name = requiredText(payload.name, "name", 200);
  if (typeof payload.phone !== "string") {
    throw new LeadWebhookError(
      "phone e obrigatorio",
      "LEAD_WEBHOOK_FIELD_REQUIRED",
      400,
    );
  }
  const phone = normalizePhoneForStorage(payload.phone);
  if (!normalizePhoneIdentity(payload.phone) || phone.length > 50) {
    throw new LeadWebhookError(
      "phone invalido",
      "LEAD_WEBHOOK_PHONE_INVALID",
      422,
    );
  }

  let observation: string | null = null;
  if (payload.observation !== undefined && payload.observation !== null) {
    if (typeof payload.observation !== "string") {
      throw new LeadWebhookError(
        "observation deve ser texto",
        "LEAD_WEBHOOK_OBSERVATION_INVALID",
        400,
      );
    }
    observation = payload.observation.trim() || null;
    if (observation && observation.length > 10_000) {
      throw new LeadWebhookError(
        "observation excede 10000 caracteres",
        "LEAD_WEBHOOK_OBSERVATION_TOO_LONG",
        400,
      );
    }
  }

  return {
    name,
    phone,
    email: normalizeEmail(payload.email),
    observation,
    tags: normalizeTags(payload.tags),
    media: normalizeMedia(payload.media),
  };
}

function webhookPath(publicId: string) {
  return `/api/integrations/leads/v1/connections/${encodeURIComponent(publicId)}/events`;
}

function publicWebhookUrl(baseUrl: string | undefined, publicId: string) {
  const base = (baseUrl ?? "").trim().replace(/\/$/, "");
  return `${base}${webhookPath(publicId)}`;
}

export class LeadWebhookService {
  readonly crm: SupabaseClient<any, "crm", any>;
  readonly agents: SupabaseClient<any, "agents", any>;
  private readonly publicBaseUrl?: string;
  private readonly encryptionKey?: string;
  private readonly encryptionKeyVersion: string;

  constructor(config: {
    supabaseUrl: string;
    serviceRoleKey: string;
    publicBaseUrl?: string;
    encryptionKey?: string;
    encryptionKeyVersion?: string;
  }) {
    const clientOptions = {
      auth: { persistSession: false, autoRefreshToken: false },
    };
    this.crm = createClient(config.supabaseUrl, config.serviceRoleKey, {
      ...clientOptions,
      db: { schema: "crm" },
    });
    this.agents = createClient(config.supabaseUrl, config.serviceRoleKey, {
      ...clientOptions,
      db: { schema: "agents" },
    });
    this.publicBaseUrl = config.publicBaseUrl;
    this.encryptionKey = config.encryptionKey;
    this.encryptionKeyVersion = config.encryptionKeyVersion?.trim() || "v1";
  }

  private cipher() {
    const key =
      this.encryptionKey?.trim() ||
      process.env.LEAD_WEBHOOK_SECRETS_ENCRYPTION_KEY?.trim() ||
      process.env.COLLECTION_SECRETS_ENCRYPTION_KEY?.trim();
    if (!key) {
      throw new LeadWebhookError(
        "LEAD_WEBHOOK_SECRETS_ENCRYPTION_KEY nao configurada",
        "LEAD_WEBHOOK_ENCRYPTION_NOT_CONFIGURED",
        503,
      );
    }
    return new AesGcmSecretCipher(
      key,
      process.env.LEAD_WEBHOOK_SECRETS_ENCRYPTION_KEY_VERSION?.trim() ||
        process.env.COLLECTION_SECRETS_ENCRYPTION_KEY_VERSION?.trim() ||
        this.encryptionKeyVersion,
      "LEAD_WEBHOOK_SECRETS_ENCRYPTION_KEY",
      "LEAD_WEBHOOK_SECRETS_ENCRYPTION_KEY_VERSION",
    );
  }

  private async getConnection(acesId: number, id: string) {
    const { data, error } = await this.crm
      .from("lead_webhook_connections")
      .select("*")
      .eq("aces_id", acesId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    return data as ConnectionRow | null;
  }

  private async getConnectionByPublicId(publicId: string) {
    const { data, error } = await this.crm
      .from("lead_webhook_connections")
      .select("*")
      .eq("public_id", publicId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    return data as ConnectionRow | null;
  }

  private async getAgent(acesId: number, agentId: string, strict = true) {
    const { data, error } = await this.agents
      .from("ai_agents")
      .select("id,aces_id,name,instance_name,agent_type,is_active")
      .eq("aces_id", acesId)
      .eq("id", agentId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    const agent = data as AgentRow | null;
    const valid = Boolean(
      agent &&
      agent.agent_type === "primary" &&
      agent.is_active &&
      agent.instance_name?.trim(),
    );
    if (!agent || (strict && !valid)) {
      throw new LeadWebhookError(
        "Selecione um agente primary ativo com instancia configurada",
        "LEAD_WEBHOOK_AGENT_INVALID",
        422,
      );
    }
    return agent;
  }

  private async getStage(acesId: number, stageId: string) {
    const { data, error } = await this.crm
      .from("pipeline_stages")
      .select("id,aces_id,name")
      .eq("aces_id", acesId)
      .eq("id", stageId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    if (!data) {
      throw new LeadWebhookError(
        "A etapa selecionada nao pertence a empresa atual",
        "LEAD_WEBHOOK_STAGE_INVALID",
        422,
      );
    }
    return data as StageRow;
  }

  private toPublicConnection(
    row: ConnectionRow,
    agent: AgentRow | null,
    stage: StageRow | null,
  ): LeadWebhookConnection {
    const issue = !agent
      ? "Agente removido"
      : agent.agent_type !== "primary"
        ? "O agente nao possui canal proprio"
        : !agent.is_active
          ? "Agente inativo"
          : !agent.instance_name?.trim()
            ? "Agente sem instancia"
            : !stage
              ? "Etapa removida"
              : null;
    return {
      id: row.id,
      publicId: row.public_id,
      name: row.name,
      agentId: row.agent_id,
      agentName: agent?.name ?? null,
      instanceName: agent?.instance_name ?? null,
      defaultStageId: row.default_stage_id,
      defaultStageName: stage?.name ?? null,
      status: row.status,
      acceptMedia: row.accept_media,
      ready: !issue,
      configurationIssue: issue,
      webhookUrl: publicWebhookUrl(this.publicBaseUrl, row.public_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listConnections(acesId: number) {
    const { data, error } = await this.crm
      .from("lead_webhook_connections")
      .select("*")
      .eq("aces_id", acesId)
      .order("created_at", { ascending: false });
    if (error) throw mapDatabaseError(error);

    const rows = (data ?? []) as ConnectionRow[];
    const agentIds = [
      ...new Set(
        rows
          .map((row) => row.agent_id)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const stageIds = [
      ...new Set(
        rows
          .map((row) => row.default_stage_id)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const [agentsResult, stagesResult] = await Promise.all([
      agentIds.length > 0
        ? this.agents
            .from("ai_agents")
            .select("id,aces_id,name,instance_name,agent_type,is_active")
            .eq("aces_id", acesId)
            .in("id", agentIds)
        : Promise.resolve({ data: [], error: null }),
      stageIds.length > 0
        ? this.crm
            .from("pipeline_stages")
            .select("id,aces_id,name")
            .eq("aces_id", acesId)
            .in("id", stageIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (agentsResult.error) throw mapDatabaseError(agentsResult.error);
    if (stagesResult.error) throw mapDatabaseError(stagesResult.error);
    const agentsById = new Map(
      (agentsResult.data as AgentRow[]).map((agent) => [agent.id, agent]),
    );
    const stagesById = new Map(
      (stagesResult.data as StageRow[]).map((stage) => [stage.id, stage]),
    );
    return rows.map((row) =>
      this.toPublicConnection(
        row,
        row.agent_id ? (agentsById.get(row.agent_id) ?? null) : null,
        row.default_stage_id
          ? (stagesById.get(row.default_stage_id) ?? null)
          : null,
      ),
    );
  }

  async createConnection(
    acesId: number,
    actorId: string,
    input: LeadWebhookAdminInput,
  ) {
    const name = requiredText(input.name, "name", 200);
    const agentId = uuid(input.agentId, "agentId");
    const defaultStageId = uuid(input.defaultStageId, "defaultStageId");
    const agent = await this.getAgent(acesId, agentId);
    const stage = await this.getStage(acesId, defaultStageId);
    const publicId = randomBytes(24).toString("base64url");
    const secret = randomBytes(32).toString("base64url");
    const encrypted = this.cipher().encrypt(secret);

    const { data: row, error } = await this.crm
      .from("lead_webhook_connections")
      .insert({
        public_id: publicId,
        aces_id: acesId,
        name,
        agent_id: agentId,
        default_stage_id: defaultStageId,
        status: "active",
        accept_media: input.acceptMedia === true,
        created_by: actorId,
      })
      .select("*")
      .single();
    if (error) throw mapDatabaseError(error);

    const { error: credentialError } = await this.crm
      .from("lead_webhook_credentials")
      .insert({
        connection_id: row.id,
        aces_id: acesId,
        ciphertext: toPostgresBytea(encrypted.ciphertext),
        iv: toPostgresBytea(encrypted.iv),
        auth_tag: toPostgresBytea(encrypted.authTag),
        key_version: encrypted.keyVersion,
      });
    if (credentialError) {
      await this.crm
        .from("lead_webhook_connections")
        .delete()
        .eq("id", row.id)
        .eq("aces_id", acesId);
      throw mapDatabaseError(credentialError);
    }

    return {
      connection: this.toPublicConnection(row as ConnectionRow, agent, stage),
      secret,
    };
  }

  async updateConnection(
    acesId: number,
    connectionId: string,
    input: LeadWebhookAdminInput,
  ) {
    const id = uuid(connectionId, "id");
    const current = await this.getConnection(acesId, id);
    if (!current)
      throw new LeadWebhookError(
        "Conexao de leads nao encontrada",
        "LEAD_WEBHOOK_CONNECTION_NOT_FOUND",
        404,
      );

    const name =
      "name" in input ? requiredText(input.name, "name", 200) : current.name;
    const agentId =
      "agentId" in input ? uuid(input.agentId, "agentId") : current.agent_id;
    const defaultStageId =
      "defaultStageId" in input
        ? uuid(input.defaultStageId, "defaultStageId")
        : current.default_stage_id;
    const status = "status" in input ? input.status : current.status;
    const acceptMedia = "acceptMedia" in input ? input.acceptMedia : current.accept_media;
    if (status !== "active" && status !== "paused") {
      throw new LeadWebhookError(
        "status deve ser active ou paused",
        "LEAD_WEBHOOK_STATUS_INVALID",
        400,
      );
    }
    if (typeof acceptMedia !== "boolean") {
      throw new LeadWebhookError("acceptMedia deve ser booleano", "LEAD_WEBHOOK_MEDIA_INVALID", 400);
    }

    if (!agentId) {
      throw new LeadWebhookError(
        "Selecione um agente primary ativo com instancia configurada",
        "LEAD_WEBHOOK_AGENT_INVALID",
        422,
      );
    }
    if (!defaultStageId) {
      throw new LeadWebhookError(
        "Selecione uma etapa padrao valida",
        "LEAD_WEBHOOK_STAGE_INVALID",
        422,
      );
    }
    const agent = await this.getAgent(acesId, agentId);
    const stage = await this.getStage(acesId, defaultStageId);
    const { data: row, error } = await this.crm
      .from("lead_webhook_connections")
      .update({
        name,
        agent_id: agentId,
        default_stage_id: defaultStageId,
        status,
        accept_media: acceptMedia,
      })
      .eq("id", id)
      .eq("aces_id", acesId)
      .select("*")
      .single();
    if (error) throw mapDatabaseError(error);
    return this.toPublicConnection(row as ConnectionRow, agent, stage);
  }

  async rotateSecret(acesId: number, connectionId: string) {
    const id = uuid(connectionId, "id");
    const current = await this.getConnection(acesId, id);
    if (!current)
      throw new LeadWebhookError(
        "Conexao de leads nao encontrada",
        "LEAD_WEBHOOK_CONNECTION_NOT_FOUND",
        404,
      );
    const secret = randomBytes(32).toString("base64url");
    const encrypted = this.cipher().encrypt(secret);
    const { data: credential, error: credentialError } = await this.crm
      .from("lead_webhook_credentials")
      .select("ciphertext,iv,auth_tag,key_version")
      .eq("connection_id", id)
      .eq("aces_id", acesId)
      .single();
    if (credentialError) throw mapDatabaseError(credentialError);

    const { error: updateError } = await this.crm
      .from("lead_webhook_credentials")
      .update({
        previous_ciphertext: credential.ciphertext,
        previous_iv: credential.iv,
        previous_auth_tag: credential.auth_tag,
        previous_key_version: credential.key_version,
        previous_valid_until: new Date(
          Date.now() + 24 * 60 * 60 * 1000,
        ).toISOString(),
        ciphertext: toPostgresBytea(encrypted.ciphertext),
        iv: toPostgresBytea(encrypted.iv),
        auth_tag: toPostgresBytea(encrypted.authTag),
        key_version: encrypted.keyVersion,
      })
      .eq("connection_id", id)
      .eq("aces_id", acesId);
    if (updateError) throw mapDatabaseError(updateError);
    return { secret, previousSecretValidForHours: 24 };
  }

  private async credentialSecrets(acesId: number, connectionId: string) {
    const { data, error } = await this.crm
      .from("lead_webhook_credentials")
      .select(
        "ciphertext,iv,auth_tag,key_version,previous_ciphertext,previous_iv,previous_auth_tag,previous_key_version,previous_valid_until",
      )
      .eq("connection_id", connectionId)
      .eq("aces_id", acesId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    if (!data)
      throw new LeadWebhookError(
        "Credencial da conexao nao encontrada",
        "LEAD_WEBHOOK_CREDENTIAL_NOT_FOUND",
        503,
      );

    const row = data as CredentialRow;
    const cipher = this.cipher();
    const secrets = [
      cipher.decrypt({
        ciphertext: fromPostgresBytea(row.ciphertext),
        iv: fromPostgresBytea(row.iv),
        authTag: fromPostgresBytea(row.auth_tag),
        keyVersion: row.key_version,
      }),
    ];
    if (
      row.previous_ciphertext &&
      row.previous_iv &&
      row.previous_auth_tag &&
      row.previous_key_version &&
      row.previous_valid_until &&
      Date.parse(row.previous_valid_until) > Date.now()
    ) {
      secrets.push(
        cipher.decrypt({
          ciphertext: fromPostgresBytea(row.previous_ciphertext),
          iv: fromPostgresBytea(row.previous_iv),
          authTag: fromPostgresBytea(row.previous_auth_tag),
          keyVersion: row.previous_key_version,
        }),
      );
    }
    return secrets;
  }

  async processWebhook(input: {
    publicConnectionId: string;
    rawBody: Buffer;
    idempotencyKey: string | undefined;
    timestamp: string | undefined;
    signature: string | undefined;
  }): Promise<LeadWebhookProcessResult> {
    const publicId = requiredText(
      input.publicConnectionId,
      "publicConnectionId",
      200,
    );
    const idempotencyKey = requiredText(
      input.idempotencyKey,
      "Idempotency-Key",
      200,
    );
    const connection = await this.getConnectionByPublicId(publicId);
    if (!connection)
      throw new LeadWebhookError(
        "Conexao de leads nao encontrada",
        "LEAD_WEBHOOK_CONNECTION_NOT_FOUND",
        404,
      );
    if (connection.status !== "active") {
      throw new LeadWebhookError(
        "A conexao de leads esta pausada",
        "LEAD_WEBHOOK_CONNECTION_PAUSED",
        409,
      );
    }

    let secrets: string[];
    try {
      secrets = await this.credentialSecrets(connection.aces_id, connection.id);
      verifyWebhook({
        rawBody: input.rawBody,
        timestamp: input.timestamp,
        signature: input.signature,
        secrets,
      });
    } catch (error) {
      if (error instanceof WebhookAuthError) {
        throw new LeadWebhookError(
          error.message,
          `LEAD_WEBHOOK_${error.code.toUpperCase()}`,
          401,
        );
      }
      if (error instanceof LeadWebhookError) throw error;
      throw new LeadWebhookError(
        "Credencial da conexao indisponivel",
        "LEAD_WEBHOOK_CREDENTIAL_ERROR",
        503,
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(input.rawBody.toString("utf8")) as unknown;
    } catch {
      throw new LeadWebhookError(
        "Payload JSON invalido",
        "LEAD_WEBHOOK_PAYLOAD_INVALID",
        400,
      );
    }
    const payload = parseLeadWebhookPayload(parsedBody);
    if (payload.media && !connection.accept_media) {
      throw new LeadWebhookError(
        "O recebimento de midia nao esta habilitado nesta conexao",
        "LEAD_WEBHOOK_MEDIA_DISABLED",
        422,
      );
    }
    let mediaSnapshot = null;
    if (payload.media) {
      try {
        mediaSnapshot = await inspectPublicImage({
          url: payload.media.url,
          caption: payload.media.caption,
        });
      } catch (error) {
        if (error instanceof PublicImageInspectionError) {
          throw new LeadWebhookError(
            error.message,
            `LEAD_WEBHOOK_MEDIA_${error.code.toUpperCase()}`,
            error.kind === "transient" ? 503 : 422,
          );
        }
        throw error;
      }
    }
    const payloadHash = createHash("sha256")
      .update(input.rawBody)
      .digest("hex");
    const { data, error } = await this.crm.rpc("rpc_ingest_lead_webhook", {
      p_public_id: publicId,
      p_idempotency_key: idempotencyKey,
      p_payload_hash: payloadHash,
      p_name: payload.name,
      p_contact_phone: payload.phone,
      p_email: payload.email,
      p_observation: payload.observation,
      p_tags: payload.tags,
    });
    if (error) throw mapRpcError(error);

    const { data: finalized, error: finalizeError } = await this.crm.rpc(
      "rpc_finalize_lead_webhook_receipt",
      {
        p_public_id: publicId,
        p_idempotency_key: idempotencyKey,
        p_payload_hash: payloadHash,
        p_media_snapshot: mediaSnapshot,
      },
    );
    if (finalizeError) throw mapRpcError(finalizeError);

    const body = (finalized ?? data ?? {}) as Record<string, unknown>;
    return {
      status: body.duplicate === true ? 200 : 202,
      body,
    };
  }
}
