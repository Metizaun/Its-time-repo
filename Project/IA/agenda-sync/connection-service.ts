import { randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  AesGcmSecretCipher,
  fromPostgresBytea,
  toPostgresBytea,
} from "../integrations/secret-cipher.js";
import {
  resolvePublicWebhookTarget,
  UnsafeWebhookUrlError,
  type WebhookDnsLookup,
} from "../integrations/safe-webhook-url.js";

export type AgendaScopeMode = "all_resources" | "selected_scope";
export type AgendaCredentialDirection = "inbound" | "outbound";
export type AgendaConnectionOperation = "activate" | "pause" | "resume" | "disable";

export type AgendaConnectionInput = {
  name: string;
  outboundUrl: string;
  scopeMode: AgendaScopeMode;
  unitIds?: string[];
  assignmentIds?: string[];
  defaultTimezone?: string;
};

type AgendaConnectionRow = Record<string, unknown> & {
  id: string;
  public_id: string;
  aces_id: number;
  name: string;
  outbound_url: string;
  scope_mode: AgendaScopeMode;
  status: string;
  default_timezone: string;
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

export class AgendaAdminError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AgendaAdminError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredText(value: unknown, field: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new AgendaAdminError(`${field} e obrigatorio`, "AGENDA_FIELD_REQUIRED", 400);
  if (text.length > maxLength) throw new AgendaAdminError(`${field} excede ${maxLength} caracteres`, "AGENDA_FIELD_TOO_LONG", 400);
  return text;
}

function uuidList(value: unknown, field: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1_000) {
    throw new AgendaAdminError(`${field} deve ser uma lista com ate 1000 UUIDs`, "AGENDA_SCOPE_INVALID", 400);
  }
  const values = [...new Set(value.map((item) => String(item).trim().toLowerCase()))];
  if (values.some((item) => !UUID_PATTERN.test(item))) {
    throw new AgendaAdminError(`${field} contem UUID invalido`, "AGENDA_SCOPE_INVALID", 400);
  }
  return values;
}

function connectionUuid(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new AgendaAdminError("Identificador de conexao invalido", "AGENDA_CONNECTION_ID_INVALID", 400);
  }
  return normalized;
}

function timezone(value: unknown) {
  const candidate = requiredText(value ?? "America/Sao_Paulo", "defaultTimezone", 100);
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: candidate }).format();
  } catch {
    throw new AgendaAdminError("defaultTimezone invalido", "AGENDA_TIMEZONE_INVALID", 400);
  }
  return candidate;
}

function mapDatabaseError(error: { message?: string; code?: string }) {
  const message = String(error.message ?? "");
  const known: Array<[string, number, string]> = [
    ["AGENDA_ADMIN_FORBIDDEN", 403, "Administrador sem permissao para esta conta"],
    ["AGENDA_CONNECTION_NOT_FOUND", 404, "Conexao de agenda nao encontrada"],
    ["AGENDA_CREDENTIAL_NOT_FOUND", 404, "Credencial de agenda nao encontrada"],
    ["AGENDA_CONNECTION_ACTIVE_UPDATE_FORBIDDEN", 409, "Pause a conexao antes de alterar URL ou escopo"],
    ["AGENDA_CONNECTION_ACTIVATION_REQUIRES_TEST", 409, "A conexao precisa concluir um teste antes da ativacao"],
    ["AGENDA_CONNECTION_SCOPE_EMPTY", 409, "Selecione ao menos uma unidade ou local independente"],
    ["AGENDA_CONNECTION_PAUSE_FORBIDDEN", 409, "A conexao nao pode ser pausada no estado atual"],
    ["AGENDA_RESOLUTION_REASON_REQUIRED", 400, "Informe o motivo da decisao"],
    ["AGENDA_DEAD_LETTER_NOT_FOUND", 404, "Dead letter nao encontrada"],
    ["AGENDA_DEAD_LETTER_NOT_HEAD", 409, "Resolva primeiro a entrega anterior da fila"],
    ["AGENDA_RESOLUTION_INVALID", 400, "Resolucao de dead letter invalida"],
    ["AGENDA_RESYNC_RUNS_ONE_ACTIVE_IDX", 409, "Ja existe uma ressincronizacao em andamento"],
    ["AGENDA_RESYNC", 409, "A ressincronizacao nao pode ser iniciada neste estado"],
    ["AGENDA_APPOINTMENT_NOT_FOUND", 404, "Agendamento nao encontrado"],
    ["AGENDA_APPOINTMENT_NOT_TERMINAL", 409, "Apenas estados finais podem ser corrigidos"],
    ["AGENDA_APPOINTMENT_OUT_OF_SCOPE", 403, "Agendamento fora do escopo da conexao"],
    ["AGENDA_CORRECTION_INVALID", 400, "Status ou motivo de correcao invalido"],
    ["AGENDA_SCOPE_UNIT_INVALID", 422, "Uma unidade nao pertence a esta conta"],
    ["AGENDA_SCOPE_ASSIGNMENT_INVALID", 422, "Um local independente nao pertence a esta conta"],
  ];
  const match = known.find(([code]) => message.includes(code));
  if (match) return new AgendaAdminError(match[2], match[0], match[1]);
  if (error.code === "23505") return new AgendaAdminError("Registro de agenda duplicado", "AGENDA_CONFLICT", 409);
  if (["22023", "23503", "23514"].includes(String(error.code))) {
    return new AgendaAdminError("Configuracao de agenda invalida", "AGENDA_CONFIGURATION_INVALID", 422);
  }
  return new AgendaAdminError("Falha ao operar a conexao de agenda", "AGENDA_DATABASE_ERROR", 500);
}

function publicConnection(row: AgendaConnectionRow, unitIds: string[] = [], assignmentIds: string[] = []) {
  return {
    id: row.id,
    publicId: row.public_id,
    name: row.name,
    outboundUrl: row.outbound_url,
    scopeMode: row.scope_mode,
    unitIds,
    assignmentIds,
    status: row.status,
    defaultTimezone: row.default_timezone,
    testedAt: row.tested_at ?? null,
    resyncStartedAt: row.resync_started_at ?? null,
    resyncCompletedAt: row.resync_completed_at ?? null,
    lastDeliveredAt: row.last_delivered_at ?? null,
    lastErrorAt: row.last_error_at ?? null,
    lastErrorCode: row.last_error_code ?? null,
    lastErrorMessage: row.last_error_message ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AgendaConnectionService {
  readonly agenda: SupabaseClient<any, "agenda_sync", any>;
  private readonly encryptionKey?: string;
  private readonly encryptionKeyVersion?: string;
  private readonly dnsLookup?: WebhookDnsLookup;

  constructor(config: {
    supabaseUrl: string;
    serviceRoleKey: string;
    encryptionKey?: string;
    encryptionKeyVersion?: string;
    dnsLookup?: WebhookDnsLookup;
  }) {
    this.agenda = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "agenda_sync" },
    });
    this.encryptionKey = config.encryptionKey;
    this.encryptionKeyVersion = config.encryptionKeyVersion?.trim() || undefined;
    this.dnsLookup = config.dnsLookup;
  }

  private cipher() {
    const key = this.encryptionKey?.trim() || process.env.AGENDA_SECRETS_ENCRYPTION_KEY?.trim();
    if (!key) {
      throw new AgendaAdminError(
        "AGENDA_SECRETS_ENCRYPTION_KEY nao configurada",
        "AGENDA_ENCRYPTION_NOT_CONFIGURED",
        503,
      );
    }
    return new AesGcmSecretCipher(
      key,
      this.encryptionKeyVersion || process.env.AGENDA_SECRETS_ENCRYPTION_KEY_VERSION?.trim() || "v1",
      "AGENDA_SECRETS_ENCRYPTION_KEY",
      "AGENDA_SECRETS_ENCRYPTION_KEY_VERSION",
    );
  }

  private async validatedInput(input: AgendaConnectionInput) {
    const name = requiredText(input.name, "name", 200);
    let target;
    try {
      target = await resolvePublicWebhookTarget(
        requiredText(input.outboundUrl, "outboundUrl", 2_048),
        { lookup: this.dnsLookup },
      );
    } catch (error) {
      if (error instanceof UnsafeWebhookUrlError) {
        throw new AgendaAdminError(error.message, `AGENDA_${error.code.toUpperCase()}`, 400);
      }
      throw error;
    }
    const scopeMode = input.scopeMode;
    if (scopeMode !== "all_resources" && scopeMode !== "selected_scope") {
      throw new AgendaAdminError("scopeMode invalido", "AGENDA_SCOPE_INVALID", 400);
    }
    const unitIds = uuidList(input.unitIds, "unitIds");
    const assignmentIds = uuidList(input.assignmentIds, "assignmentIds");
    if (scopeMode === "all_resources" && (unitIds.length > 0 || assignmentIds.length > 0)) {
      throw new AgendaAdminError("all_resources nao aceita selecoes", "AGENDA_SCOPE_INVALID", 400);
    }
    return {
      name,
      outboundUrl: target.url.toString(),
      scopeMode,
      unitIds,
      assignmentIds,
      defaultTimezone: timezone(input.defaultTimezone),
    };
  }

  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.agenda.rpc(name, args);
    if (error) throw mapDatabaseError(error);
    return data as T;
  }

  async listConnections(acesId: number) {
    const { data, error } = await this.agenda.from("connections").select("*")
      .eq("aces_id", acesId).order("created_at", { ascending: false });
    if (error) throw mapDatabaseError(error);
    return Promise.all((data ?? []).map((row) => this.hydrateConnection(row as AgendaConnectionRow)));
  }

  async getConnection(acesId: number, connectionId: string) {
    const id = connectionUuid(connectionId);
    const { data, error } = await this.agenda.from("connections").select("*")
      .eq("aces_id", acesId).eq("id", id).maybeSingle();
    if (error) throw mapDatabaseError(error);
    return data ? this.hydrateConnection(data as AgendaConnectionRow) : null;
  }

  private async hydrateConnection(row: AgendaConnectionRow) {
    const [units, assignments, metrics, resync] = await Promise.all([
      this.agenda.from("connection_units").select("unit_id")
        .eq("aces_id", row.aces_id).eq("connection_id", row.id),
      this.agenda.from("connection_assignments").select("assignment_id")
        .eq("aces_id", row.aces_id).eq("connection_id", row.id),
      this.agenda.rpc("connection_metrics", { p_aces_id: row.aces_id, p_connection_id: row.id }),
      this.agenda.from("resync_runs")
        .select("id,status,stage,snapshot_count,delta_count,started_at,completed_at,error_code,error_message")
        .eq("aces_id", row.aces_id).eq("connection_id", row.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (units.error) throw mapDatabaseError(units.error);
    if (assignments.error) throw mapDatabaseError(assignments.error);
    if (metrics.error) throw mapDatabaseError(metrics.error);
    if (resync.error) throw mapDatabaseError(resync.error);
    return {
      ...publicConnection(
      row,
      (units.data ?? []).map((item) => String(item.unit_id)),
      (assignments.data ?? []).map((item) => String(item.assignment_id)),
      ),
      metrics: Array.isArray(metrics.data) ? metrics.data[0] ?? null : metrics.data ?? null,
      resync: resync.data ?? null,
    };
  }

  async createConnection(acesId: number, actorId: string, input: AgendaConnectionInput) {
    const normalized = await this.validatedInput(input);
    const inboundSecret = randomBytes(32).toString("base64url");
    const outboundSecret = randomBytes(32).toString("base64url");
    const cipher = this.cipher();
    const inbound = cipher.encrypt(inboundSecret);
    const outbound = cipher.encrypt(outboundSecret);
    const connectionId = await this.rpc<string>("create_connection", {
      p_aces_id: acesId,
      p_actor_id: actorId,
      p_name: normalized.name,
      p_outbound_url: normalized.outboundUrl,
      p_scope_mode: normalized.scopeMode,
      p_unit_ids: normalized.unitIds,
      p_assignment_ids: normalized.assignmentIds,
      p_default_timezone: normalized.defaultTimezone,
      p_inbound_ciphertext: toPostgresBytea(inbound.ciphertext),
      p_inbound_iv: toPostgresBytea(inbound.iv),
      p_inbound_auth_tag: toPostgresBytea(inbound.authTag),
      p_inbound_key_version: inbound.keyVersion,
      p_outbound_ciphertext: toPostgresBytea(outbound.ciphertext),
      p_outbound_iv: toPostgresBytea(outbound.iv),
      p_outbound_auth_tag: toPostgresBytea(outbound.authTag),
      p_outbound_key_version: outbound.keyVersion,
    });
    const connection = await this.getConnection(acesId, connectionId);
    if (!connection) throw new AgendaAdminError("Conexao criada mas nao localizada", "AGENDA_CONNECTION_NOT_FOUND", 500);
    return { connection, inboundSecret, outboundSecret };
  }

  async updateConnection(acesId: number, actorId: string, connectionId: string, patch: Partial<AgendaConnectionInput>) {
    const id = connectionUuid(connectionId);
    const current = await this.getConnection(acesId, id);
    if (!current) throw new AgendaAdminError("Conexao de agenda nao encontrada", "AGENDA_CONNECTION_NOT_FOUND", 404);
    const normalized = await this.validatedInput({
      name: patch.name ?? current.name,
      outboundUrl: patch.outboundUrl ?? current.outboundUrl,
      scopeMode: patch.scopeMode ?? current.scopeMode,
      unitIds: patch.unitIds ?? current.unitIds,
      assignmentIds: patch.assignmentIds ?? current.assignmentIds,
      defaultTimezone: patch.defaultTimezone ?? current.defaultTimezone,
    });
    await this.rpc<boolean>("update_connection", {
      p_aces_id: acesId, p_actor_id: actorId, p_connection_id: id,
      p_name: normalized.name, p_outbound_url: normalized.outboundUrl,
      p_scope_mode: normalized.scopeMode, p_unit_ids: normalized.unitIds,
      p_assignment_ids: normalized.assignmentIds, p_default_timezone: normalized.defaultTimezone,
    });
    return this.getConnection(acesId, id);
  }

  async rotateCredential(acesId: number, actorId: string, connectionId: string, direction: AgendaCredentialDirection) {
    const id = connectionUuid(connectionId);
    if (direction !== "inbound" && direction !== "outbound") {
      throw new AgendaAdminError("Direcao de credencial invalida", "AGENDA_CREDENTIAL_DIRECTION_INVALID", 400);
    }
    const secret = randomBytes(32).toString("base64url");
    const encrypted = this.cipher().encrypt(secret);
    await this.rpc<boolean>("rotate_connection_credential", {
      p_aces_id: acesId, p_actor_id: actorId, p_connection_id: id,
      p_direction: direction, p_ciphertext: toPostgresBytea(encrypted.ciphertext),
      p_iv: toPostgresBytea(encrypted.iv), p_auth_tag: toPostgresBytea(encrypted.authTag),
      p_key_version: encrypted.keyVersion,
    });
    return secret;
  }

  async getCredentialSecrets(acesId: number, connectionId: string, direction: AgendaCredentialDirection) {
    const id = connectionUuid(connectionId);
    const { data, error } = await this.agenda.from("credentials")
      .select("ciphertext,iv,auth_tag,key_version,previous_ciphertext,previous_iv,previous_auth_tag,previous_key_version,previous_valid_until")
      .eq("aces_id", acesId).eq("connection_id", id).eq("direction", direction).maybeSingle();
    if (error) throw mapDatabaseError(error);
    if (!data) return [];
    const row = data as CredentialRow;
    const cipher = this.cipher();
    const secrets = [cipher.decrypt({
      ciphertext: fromPostgresBytea(row.ciphertext), iv: fromPostgresBytea(row.iv),
      authTag: fromPostgresBytea(row.auth_tag), keyVersion: row.key_version,
    })];
    if (row.previous_ciphertext && row.previous_iv && row.previous_auth_tag && row.previous_key_version
      && row.previous_valid_until && Date.parse(row.previous_valid_until) > Date.now()) {
      secrets.push(cipher.decrypt({
        ciphertext: fromPostgresBytea(row.previous_ciphertext), iv: fromPostgresBytea(row.previous_iv),
        authTag: fromPostgresBytea(row.previous_auth_tag), keyVersion: row.previous_key_version,
      }));
    }
    return secrets;
  }

  async queueTest(acesId: number, actorId: string, connectionId: string) {
    const id = connectionUuid(connectionId);
    const eventId = await this.rpc<string>("enqueue_connection_test", {
      p_aces_id: acesId, p_actor_id: actorId, p_connection_id: id,
    });
    return { eventId, status: "pending" as const };
  }

  async operate(acesId: number, actorId: string, connectionId: string, operation: AgendaConnectionOperation) {
    const id = connectionUuid(connectionId);
    const status = await this.rpc<string>("set_connection_operation", {
      p_aces_id: acesId, p_actor_id: actorId, p_connection_id: id, p_operation: operation,
    });
    if (operation === "activate") {
      const runId = await this.rpc<string>("start_resync", {
        p_aces_id: acesId, p_actor_id: actorId, p_connection_id: id,
        p_reason: "Ativacao inicial",
      });
      return { status, runId };
    }
    return { status };
  }

  async startResync(acesId: number, actorId: string, connectionId: string, reason: unknown) {
    const id = connectionUuid(connectionId);
    const runId = await this.rpc<string>("start_resync", {
      p_aces_id: acesId, p_actor_id: actorId, p_connection_id: id,
      p_reason: requiredText(reason ?? "Ressincronizacao manual", "reason", 2_000),
    });
    return { runId, status: "syncing" as const };
  }

  async getScopeOptions(acesId: number) {
    const crm = this.agenda.schema("crm");
    const calendar = this.agenda.schema("calendar");
    const [units, assignments] = await Promise.all([
      crm.from("empresas").select("id,name,city,state,is_active").eq("aces_id", acesId).order("name"),
      calendar.from("professional_locations")
        .select("id,location_name,is_active,professional_id,professionals(name)")
        .eq("aces_id", acesId).is("empresa_id", null).order("location_name"),
    ]);
    if (units.error) throw mapDatabaseError(units.error);
    if (assignments.error) throw mapDatabaseError(assignments.error);
    return { units: units.data ?? [], assignments: assignments.data ?? [] };
  }

  async listDeliveries(acesId: number, connectionId: string, options: {
    limit?: number; eventType?: string; outcome?: string; from?: string; to?: string; before?: string;
  } = {}) {
    const id = connectionUuid(connectionId);
    const safeLimit = Math.min(Math.max(Math.trunc(options.limit ?? 100) || 100, 1), 200);
    let query = this.agenda.from("deliveries").select("*")
      .eq("aces_id", acesId).eq("connection_id", id);
    if (options.outcome) query = query.eq("outcome", requiredText(options.outcome, "outcome", 50));
    if (options.from) query = query.gte("created_at", options.from);
    if (options.to) query = query.lte("created_at", options.to);
    if (options.before) query = query.lt("created_at", options.before);
    if (options.eventType) query = query.eq("event_type", requiredText(options.eventType, "eventType", 100));
    const { data, error } = await query.order("created_at", { ascending: false }).limit(safeLimit);
    if (error) throw mapDatabaseError(error);
    return data ?? [];
  }

  async listDeadLetters(acesId: number, connectionId: string, limit = 100) {
    const id = connectionUuid(connectionId);
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 100, 1), 200);
    const { data, error } = await this.agenda.from("outbox")
      .select("id,event_id,event_type,resource_type,resource_id,resource_version,sequence,attempt_count,dead_lettered_at,last_http_status,last_error_code,last_error_message")
      .eq("aces_id", acesId).eq("connection_id", id).eq("status", "dead_letter")
      .order("sequence", { ascending: true }).limit(safeLimit);
    if (error) throw mapDatabaseError(error);
    return data ?? [];
  }

  async getMetrics(acesId: number, connectionId: string) {
    const id = connectionUuid(connectionId);
    const { data, error } = await this.agenda.rpc("connection_metrics", {
      p_aces_id: acesId, p_connection_id: id,
    });
    if (error) throw mapDatabaseError(error);
    const metrics = Array.isArray(data) ? data[0] : data;
    if (!metrics) throw new AgendaAdminError("Conexao de agenda nao encontrada", "AGENDA_CONNECTION_NOT_FOUND", 404);
    return metrics;
  }

  async listAudit(acesId: number, connectionId: string, limit = 100, before?: string) {
    const id = connectionUuid(connectionId);
    let query = this.agenda.from("connection_audit").select("id,actor_id,action,details,created_at")
      .eq("aces_id", acesId).eq("connection_id", id);
    if (before) query = query.lt("created_at", before);
    const { data, error } = await query.order("created_at", { ascending: false })
      .limit(Math.min(Math.max(Math.trunc(limit) || 100, 1), 200));
    if (error) throw mapDatabaseError(error);
    return data ?? [];
  }

  async resolveDeadLetter(acesId: number, actorId: string, connectionId: string,
    outboxId: string, resolution: "retry" | "skip", reason: unknown) {
    const result = await this.rpc<string>("resolve_dead_letter", {
      p_aces_id: acesId, p_actor_id: actorId, p_connection_id: connectionUuid(connectionId),
      p_outbox_id: connectionUuid(outboxId), p_resolution: resolution,
      p_reason: requiredText(reason, "reason", 2_000),
    });
    return { resolution: result };
  }

  async correctAppointmentStatus(acesId: number, actorId: string, connectionId: string,
    appointmentId: string, status: unknown, reason: unknown) {
    const normalizedStatus = requiredText(status, "status", 20);
    if (!["cancelled", "done", "no_show"].includes(normalizedStatus)) {
      throw new AgendaAdminError("Status de correcao invalido", "AGENDA_CORRECTION_INVALID", 400);
    }
    const resourceVersion = await this.rpc<number>("correct_appointment_status", {
      p_aces_id: acesId, p_actor_id: actorId, p_connection_id: connectionUuid(connectionId),
      p_appointment_id: connectionUuid(appointmentId), p_status: normalizedStatus,
      p_reason: requiredText(reason, "reason", 2_000),
    });
    return { status: normalizedStatus, resourceVersion };
  }
}
