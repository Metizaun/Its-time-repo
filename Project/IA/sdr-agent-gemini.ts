import axios from "axios";
import Redis from "ioredis";
import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export const DEFAULT_SYSTEM_MESSAGE = `Voce e um agente comercial via WhatsApp. Responda como humano, com linguagem natural, direta e cordial. Seja util, objetivo e claro. Nunca invente dados. Classifique o lead apenas nas etapas reais do funil fornecido.`;

export const DEFAULT_USER_MESSAGE_TEMPLATE = `Analise a conversa e retorne JSON valido seguindo o schema solicitado.`;

type JsonRecord = Record<string, unknown>;

type AuthContext = {
  accessToken: string;
  authUserId: string;
  crmUserId: string;
  acesId: number;
  role: string;
  name: string | null;
};

type AgentRow = {
  id: string;
  aces_id: number;
  instance_name: string;
  name: string;
  system_prompt: string;
  provider: "gemini";
  model: string;
  is_active: boolean;
  buffer_wait_ms: number;
  human_pause_minutes: number;
  auto_apply_threshold: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type StageRuleRow = {
  id: string;
  agent_id: string;
  stage_id: string;
  goal_description: string;
  positive_signals: string[];
  negative_signals: string[];
  example_phrases: string[];
  priority: number;
  is_terminal: boolean;
  created_at: string;
  updated_at: string;
};

type StageRow = {
  id: string;
  aces_id: number;
  name: string;
  category: string;
  position: number;
};

type InstanceSetupStatus = "pending_qr" | "connected" | "expired" | "cancelled";
type InstanceAction = "continue_setup" | "reconnect" | "sync_status" | "disconnect" | "delete";

type InstanceRow = {
  instancia: string;
  aces_id: number;
  color: string | null;
  token: string | null;
  status: string | null;
  created_at?: string;
  updated_at?: string;
  setup_status?: InstanceSetupStatus | null;
  setup_started_at?: string | null;
  setup_expires_at?: string | null;
  operation_lock_until?: string | null;
  last_error?: string | null;
};

type InstanceListItem = {
  instanceName: string;
  status: "connected" | "disconnected" | "connecting" | "error";
  setupStatus: InstanceSetupStatus;
  createdAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
  actions: InstanceAction[];
  color: string | null;
};

type LeadRow = {
  id: string;
  aces_id: number;
  name: string | null;
  contact_phone: string | null;
  status: string | null;
  stage_id: string | null;
  instancia: string | null;
  last_city: string | null;
  updated_at: string | null;
};

type MessageRow = {
  id: string;
  lead_id: string;
  aces_id: number;
  content: string;
  direction: string;
  source_type: string;
  instance: string | null;
  created_by: string | null;
  sent_at: string;
  conversation_id: string | null;
};

type AiRunRow = {
  id: string;
  created_at: string;
  confidence: number | null;
  action_taken: string;
  error: string | null;
  suggested_stage_id: string | null;
  applied_stage_id: string | null;
  output_snapshot: JsonRecord;
  input_snapshot: JsonRecord;
};

type ParsedWebhookMessage = {
  instanceName: string;
  fromMe: boolean;
  phone: string;
  content: string;
  messageId: string | null;
  conversationId: string | null;
  sentAt: string;
  pushName: string | null;
  mediaKind: "audio" | "image" | null;
  mediaMimeType: string | null;
  mediaBase64: string | null;
  mediaUrl: string | null;
  raw: JsonRecord;
};

export type WebhookPayload = JsonRecord;

type CreateAgentInput = {
  name: string;
  instanceName: string;
  systemPrompt?: string;
  model?: string;
  provider?: "gemini";
  bufferWaitMs?: number;
  humanPauseMinutes?: number;
  autoApplyThreshold?: number;
  isActive?: boolean;
};

type UpdateAgentInput = Partial<CreateAgentInput>;

type StageRuleInput = {
  stage_id: string;
  goal_description?: string;
  positive_signals?: string[];
  negative_signals?: string[];
  example_phrases?: string[];
  priority?: number;
  is_terminal?: boolean;
};

type SendManualMessageInput = {
  leadId: string;
  content: string;
  instanceName?: string | null;
};

type CreateInstanceInput = {
  instanceName: string;
};

type UpdateInstanceLifecycleInput = {
  status?: "connected" | "disconnected" | "connecting" | "error";
  setup_status?: InstanceSetupStatus;
  setup_started_at?: string | null;
  setup_expires_at?: string | null;
  operation_lock_until?: string | null;
  last_error?: string | null;
  token?: string | null;
};

type StructuredModelResponse = {
  reply_blocks: string[];
  stage_decision: {
    stage_id: string | null;
    reason: string;
  };
  confidence: number;
  reason: string;
  should_apply_stage: boolean;
  should_pause: boolean;
};

type ServiceConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  geminiApiKey?: string;
  redisUrl?: string;
  evolutionApiUrl: string;
  evolutionApiKey: string;
  evolutionWebhookSecret?: string;
  webhookPublicBaseUrl?: string;
};

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : {};
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePhone(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  if (clean.startsWith("55") && clean.length > 11) {
    return clean.slice(2);
  }
  return clean;
}

function phoneVariants(phone: string): string[] {
  const normalized = normalizePhone(phone);
  const variants = new Set<string>([normalized]);

  if (normalized.length <= 11) {
    variants.add(`55${normalized}`);
  }

  if (normalized.startsWith("55") && normalized.length > 11) {
    variants.add(normalized.slice(2));
  }

  return Array.from(variants).filter(Boolean);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function hashFingerprint(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function parseStructuredJson(text: string): StructuredModelResponse {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as Partial<StructuredModelResponse>;

  return {
    reply_blocks: Array.isArray(parsed.reply_blocks)
      ? parsed.reply_blocks.map((item) => String(item).trim()).filter(Boolean).slice(0, 4)
      : [],
    stage_decision: {
      stage_id: parsed.stage_decision?.stage_id ? String(parsed.stage_decision.stage_id) : null,
      reason: parsed.stage_decision?.reason ? String(parsed.stage_decision.reason) : "",
    },
    confidence:
      typeof parsed.confidence === "number"
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0,
    reason: parsed.reason ? String(parsed.reason) : "",
    should_apply_stage: Boolean(parsed.should_apply_stage),
    should_pause: Boolean(parsed.should_pause),
  };
}

function truncateText(text: string, maxLength: number) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new HttpError(400, message);
  }
  return value;
}

export class AgentManager {
  private static readonly INSTANCE_SETUP_TTL_HOURS = 24;
  private static readonly INSTANCE_OPERATION_LOCK_SECONDS = 45;

  private readonly authClient: SupabaseClient<any, any, any>;
  private readonly serviceClient: SupabaseClient<any, any, any>;
  private readonly redis: Redis | null;
  private readonly memoryBuffers = new Map<string, ParsedWebhookMessage[]>();
  private readonly memoryTimers = new Map<string, NodeJS.Timeout>();
  private readonly gemini: GoogleGenerativeAI | null;

  constructor(private readonly config: ServiceConfig) {
    this.authClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "crm" },
    });

    this.serviceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "crm" },
    });

    this.redis = config.redisUrl ? new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
    this.gemini = config.geminiApiKey ? new GoogleGenerativeAI(config.geminiApiKey) : null;
  }

  async authenticate(authHeader?: string): Promise<AuthContext> {
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      throw new HttpError(401, "Token de acesso ausente");
    }

    const { data, error } = await this.authClient.auth.getUser(token);
    if (error || !data.user) {
      throw new HttpError(401, "Sessao invalida");
    }

    const { data: crmUser, error: crmError } = await this.serviceClient
      .from("users")
      .select("id, aces_id, role, name")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();

    if (crmError) {
      throw new HttpError(500, "Nao foi possivel validar o usuario CRM", crmError);
    }

    if (!crmUser) {
      throw new HttpError(403, "Usuario CRM nao encontrado");
    }

    return {
      accessToken: token,
      authUserId: data.user.id,
      crmUserId: String(crmUser.id),
      acesId: Number(crmUser.aces_id),
      role: String(crmUser.role),
      name: crmUser.name ? String(crmUser.name) : null,
    };
  }

  private ensureAdmin(context: AuthContext) {
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem gerenciar a IA");
    }
  }

  private sanitizeInstanceName(raw: string) {
    const normalized = raw.trim();
    if (!normalized) {
      throw new HttpError(400, "Nome da instancia e obrigatorio");
    }

    if (!/^[a-zA-Z0-9_-]{3,40}$/.test(normalized)) {
      throw new HttpError(
        400,
        "Nome invalido. Use apenas letras, numeros, _ e -, entre 3 e 40 caracteres."
      );
    }

    return normalized;
  }

  private evolutionHeaders() {
    return { apikey: this.config.evolutionApiKey };
  }

  private resolveInstanceWebhookUrl() {
    const base = this.config.webhookPublicBaseUrl?.trim().replace(/\/$/, "");
    if (!base) {
      return null;
    }

    return `${base}/api/webhook/evolution`;
  }

  private async ensureEvolutionWebhook(instanceName: string) {
    const webhookUrl = this.resolveInstanceWebhookUrl();
    if (!webhookUrl) {
      return { configured: false, reason: "WEBHOOK_PUBLIC_BASE_URL nao configurada" as const };
    }

    try {
      await axios.post(
        `${this.config.evolutionApiUrl}/webhook/set/${encodeURIComponent(instanceName)}`,
        {
          webhook: {
            enabled: true,
            url: webhookUrl,
            events: ["MESSAGES_UPSERT"],
          },
        },
        { headers: this.evolutionHeaders() }
      );

      return { configured: true as const };
    } catch (error: any) {
      throw new HttpError(
        502,
        `Nao foi possivel configurar webhook da instancia ${instanceName} na Evolution`,
        error?.response?.data ?? error?.message ?? error
      );
    }
  }

  private normalizeInstanceStatus(raw: string | null | undefined): "connected" | "disconnected" | "connecting" | "error" {
    const value = (raw ?? "").toLowerCase();
    if (value === "connected") return "connected";
    if (value === "connecting") return "connecting";
    if (value === "error") return "error";
    return "disconnected";
  }

  private deriveSetupStatus(instance: InstanceRow): InstanceSetupStatus {
    const normalizedStatus = this.normalizeInstanceStatus(instance.status);
    if (normalizedStatus === "connected") {
      return "connected";
    }

    const setupStatus = instance.setup_status ?? null;
    if (setupStatus === "cancelled" || setupStatus === "expired" || setupStatus === "pending_qr" || setupStatus === "connected") {
      if (setupStatus === "pending_qr" && instance.setup_expires_at) {
        const expired = new Date(instance.setup_expires_at).getTime() < Date.now();
        if (expired) {
          return "expired";
        }
      }
      return setupStatus;
    }

    return "pending_qr";
  }

  private buildInstanceActions(instance: InstanceRow, setupStatus: InstanceSetupStatus): InstanceAction[] {
    const status = this.normalizeInstanceStatus(instance.status);
    const actions: InstanceAction[] = ["sync_status", "delete"];

    if (status === "connected") {
      actions.push("disconnect");
      return actions;
    }

    if (setupStatus === "pending_qr" || setupStatus === "expired") {
      actions.push("continue_setup");
    }
    actions.push("reconnect");

    return actions;
  }

  private computeSetupExpirationIso(base = new Date()) {
    return addHours(base, AgentManager.INSTANCE_SETUP_TTL_HOURS).toISOString();
  }

  private async markExpiredPendingInstances(acesId: number) {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.serviceClient
      .from("instance")
      .update({
        setup_status: "expired",
        last_error: "Configuracao inicial expirada. Gere um novo QR code para concluir.",
      })
      .eq("aces_id", acesId)
      .eq("setup_status", "pending_qr")
      .lt("setup_expires_at", nowIso)
      .select("instancia");

    if (error) {
      throw new HttpError(500, "Nao foi possivel atualizar setups expirados", error);
    }

    for (const row of data ?? []) {
      await this.logInstanceEvent(acesId, String((row as JsonRecord).instancia), "expired");
    }
  }

  private async logInstanceEvent(
    acesId: number,
    instanceName: string,
    eventType: "created" | "qr_generated" | "connected" | "disconnected" | "reconnect" | "continue_setup" | "expired" | "deleted" | "error",
    payload: JsonRecord = {}
  ) {
    const { error } = await this.serviceClient.from("instance_events").insert({
      aces_id: acesId,
      instancia: instanceName,
      event_type: eventType,
      payload,
    });

    if (error) {
      console.warn("[crm-ai] Nao foi possivel registrar evento da instancia:", error);
    }
  }

  private async acquireInstanceLock(acesId: number, instanceName: string) {
    const { data, error } = await this.serviceClient.rpc("lock_instance_operation", {
      p_instance: instanceName,
      p_aces_id: acesId,
      p_lock_seconds: AgentManager.INSTANCE_OPERATION_LOCK_SECONDS,
    });

    if (error) {
      throw new HttpError(500, "Nao foi possivel bloquear operacao da instancia", error);
    }

    if (!data) {
      throw new HttpError(409, "Ja existe uma operacao em andamento para esta instancia. Tente novamente em instantes.");
    }
  }

  private async releaseInstanceLock(acesId: number, instanceName: string) {
    const { error } = await this.serviceClient.rpc("unlock_instance_operation", {
      p_instance: instanceName,
      p_aces_id: acesId,
    });

    if (error) {
      console.warn("[crm-ai] Falha ao liberar lock da instancia:", error);
    }
  }

  private async withInstanceLock<T>(acesId: number, instanceName: string, operation: () => Promise<T>) {
    await this.acquireInstanceLock(acesId, instanceName);
    try {
      return await operation();
    } finally {
      await this.releaseInstanceLock(acesId, instanceName);
    }
  }

  private async updateInstanceLifecycle(acesId: number, instanceName: string, payload: UpdateInstanceLifecycleInput) {
    const { error } = await this.serviceClient
      .from("instance")
      .update(payload)
      .eq("instancia", instanceName)
      .eq("aces_id", acesId);

    if (error) {
      throw new HttpError(500, "Nao foi possivel atualizar a instancia", error);
    }
  }

  private async fetchEvolutionConnectionState(instanceName: string) {
    const { data } = await axios.get(
      `${this.config.evolutionApiUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`,
      { headers: this.evolutionHeaders() }
    );

    const payload = asRecord(data);
    const state =
      asString(asRecord(payload.instance).state) ??
      asString(payload.state) ??
      "disconnected";

    const status = state.toLowerCase() === "open" ? "connected" : "disconnected";
    return { state, status: status as "connected" | "disconnected" };
  }

  private async tryRequestEvolution(
    candidates: Array<{ method: "get" | "post" | "delete"; path: string; body?: JsonRecord }>
  ) {
    let lastErrorPayload: unknown = null;
    for (const candidate of candidates) {
      try {
        const response = await axios.request({
          method: candidate.method,
          url: `${this.config.evolutionApiUrl}${candidate.path}`,
          data: candidate.body,
          headers: this.evolutionHeaders(),
          validateStatus: () => true,
        });

        if (response.status >= 200 && response.status < 300) {
          return { ok: true, data: response.data };
        }

        if (response.status === 404) {
          lastErrorPayload = response.data;
          continue;
        }

        lastErrorPayload = response.data;
      } catch (error: any) {
        lastErrorPayload = error?.response?.data ?? error?.message ?? error;
      }
    }

    return { ok: false, data: lastErrorPayload };
  }

  private async disconnectOnEvolution(instanceName: string) {
    const encoded = encodeURIComponent(instanceName);
    return this.tryRequestEvolution([
      { method: "delete", path: `/instance/logout/${encoded}` },
      { method: "post", path: `/instance/logout/${encoded}` },
      { method: "delete", path: `/instance/disconnect/${encoded}` },
      { method: "post", path: `/instance/disconnect/${encoded}` },
    ]);
  }

  private async deleteOnEvolution(instanceName: string) {
    const encoded = encodeURIComponent(instanceName);
    return this.tryRequestEvolution([
      { method: "delete", path: `/instance/delete/${encoded}` },
      { method: "post", path: `/instance/delete/${encoded}` },
      { method: "post", path: `/instance/delete`, body: { instanceName } },
    ]);
  }

  private async findInstanceByName(instanceName: string) {
    const { data, error } = await this.serviceClient
      .from("instance")
      .select(
        "instancia, aces_id, color, token, status, created_at, setup_status, setup_started_at, setup_expires_at, operation_lock_until, last_error"
      )
      .eq("instancia", instanceName)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel consultar a instancia", error);
    }

    return (data as InstanceRow | null) ?? null;
  }

  private async ensureInstanceOwnership(acesId: number, instanceName: string) {
    const existing = await this.findInstanceByName(instanceName);
    if (!existing) {
      throw new HttpError(404, "Instancia nao encontrada");
    }

    if (existing.aces_id !== acesId) {
      throw new HttpError(403, "Instancia nao pertence a sua conta");
    }

    return existing;
  }

  private async fetchQrCodeFromEvolution(instanceName: string) {
    const { data } = await axios.get(
      `${this.config.evolutionApiUrl}/instance/connect/${encodeURIComponent(instanceName)}`,
      { headers: this.evolutionHeaders() }
    );

    const payload = asRecord(data);
    return (
      asString(payload.base64) ??
      asString(asRecord(payload.qrcode).base64) ??
      asString(asRecord(payload.qrcode).code) ??
      null
    );
  }

  private async getAgentForAccount(agentId: string, acesId: number) {
    const { data, error } = await this.serviceClient
      .from("ai_agents")
      .select("*")
      .eq("id", agentId)
      .eq("aces_id", acesId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar o agente", error);
    }

    if (!data) {
      throw new HttpError(404, "Agente nao encontrado");
    }

    return data as AgentRow;
  }

  private async getAgentById(agentId: string) {
    const { data, error } = await this.serviceClient
      .from("ai_agents")
      .select("*")
      .eq("id", agentId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar o agente", error);
    }

    if (!data) {
      throw new HttpError(404, "Agente nao encontrado");
    }

    return data as AgentRow;
  }

  private async getActiveAgentByInstance(instanceName: string) {
    const { data, error } = await this.serviceClient
      .from("ai_agents")
      .select("*")
      .eq("instance_name", instanceName)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel localizar o agente da instancia", error);
    }

    return (data as AgentRow | null) ?? null;
  }

  private async getStagesForAccount(acesId: number) {
    const { data, error } = await this.serviceClient
      .from("pipeline_stages")
      .select("id, aces_id, name, category, position")
      .eq("aces_id", acesId)
      .order("position", { ascending: true });

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar as etapas do funil", error);
    }

    return ((data ?? []) as StageRow[]).sort((a, b) => a.position - b.position);
  }

  private async syncMissingStageRules(agent: AgentRow) {
    const stages = await this.getStagesForAccount(agent.aces_id);
    const { data: currentRules, error } = await this.serviceClient
      .from("ai_stage_rules")
      .select("stage_id")
      .eq("agent_id", agent.id);

    if (error) {
      throw new HttpError(500, "Nao foi possivel sincronizar as regras por etapa", error);
    }

    const existing = new Set((currentRules ?? []).map((item) => String(item.stage_id)));
    const missing = stages
      .filter((stage) => !existing.has(stage.id))
      .map((stage) => ({
        agent_id: agent.id,
        stage_id: stage.id,
        goal_description: "",
        positive_signals: [],
        negative_signals: [],
        example_phrases: [],
        priority: stage.position,
        is_terminal: stage.category !== "Aberto",
      }));

    if (missing.length === 0) {
      return;
    }

    const { error: insertError } = await this.serviceClient.from("ai_stage_rules").insert(missing);
    if (insertError) {
      throw new HttpError(500, "Nao foi possivel criar as regras iniciais de etapa", insertError);
    }
  }

  async listAgents(context: AuthContext) {
    this.ensureAdmin(context);

    const { data, error } = await this.serviceClient
      .from("ai_agents")
      .select("*")
      .eq("aces_id", context.acesId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new HttpError(500, "Nao foi possivel listar os agentes", error);
    }

    return (data ?? []) as AgentRow[];
  }

  async createAgent(context: AuthContext, input: CreateAgentInput) {
    this.ensureAdmin(context);

    if (!input.name?.trim()) {
      throw new HttpError(400, "Nome do agente e obrigatorio");
    }

    if (!input.instanceName?.trim()) {
      throw new HttpError(400, "Instancia do agente e obrigatoria");
    }

    const { data: instanceRow, error: instanceError } = await this.serviceClient
      .from("instance")
      .select("instancia")
      .eq("aces_id", context.acesId)
      .eq("instancia", input.instanceName.trim())
      .maybeSingle();

    if (instanceError) {
      throw new HttpError(500, "Nao foi possivel validar a instancia selecionada", instanceError);
    }

    if (!instanceRow) {
      throw new HttpError(400, "A instancia informada nao pertence a esta conta");
    }

    const payload = {
      aces_id: context.acesId,
      instance_name: input.instanceName.trim(),
      name: input.name.trim(),
      system_prompt: input.systemPrompt?.trim() || DEFAULT_SYSTEM_MESSAGE,
      provider: input.provider ?? "gemini",
      model: input.model?.trim() || "gemini-2.5-flash",
      is_active: input.isActive ?? true,
      buffer_wait_ms: input.bufferWaitMs ?? 15000,
      human_pause_minutes: input.humanPauseMinutes ?? 60,
      auto_apply_threshold: input.autoApplyThreshold ?? 0.85,
      created_by: context.crmUserId,
    };

    const { data, error } = await this.serviceClient
      .from("ai_agents")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw new HttpError(500, "Nao foi possivel criar o agente", error);
    }

    const agent = data as AgentRow;
    await this.syncMissingStageRules(agent);
    return agent;
  }

  async updateAgent(context: AuthContext, agentId: string, input: UpdateAgentInput) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId);

    const payload: JsonRecord = {};
    if (input.name !== undefined) payload.name = input.name.trim();
    if (input.instanceName !== undefined) payload.instance_name = input.instanceName.trim();
    if (input.systemPrompt !== undefined) payload.system_prompt = input.systemPrompt.trim();
    if (input.model !== undefined) payload.model = input.model.trim();
    if (input.provider !== undefined) payload.provider = input.provider;
    if (input.isActive !== undefined) payload.is_active = input.isActive;
    if (input.bufferWaitMs !== undefined) payload.buffer_wait_ms = input.bufferWaitMs;
    if (input.humanPauseMinutes !== undefined) payload.human_pause_minutes = input.humanPauseMinutes;
    if (input.autoApplyThreshold !== undefined) payload.auto_apply_threshold = input.autoApplyThreshold;

    const { data, error } = await this.serviceClient
      .from("ai_agents")
      .update(payload)
      .eq("id", agentId)
      .eq("aces_id", context.acesId)
      .select("*")
      .single();

    if (error) {
      throw new HttpError(500, "Nao foi possivel atualizar o agente", error);
    }

    const agent = data as AgentRow;
    await this.syncMissingStageRules(agent);
    return agent;
  }

  async getStageRules(context: AuthContext, agentId: string) {
    this.ensureAdmin(context);
    const agent = await this.getAgentForAccount(agentId, context.acesId);
    await this.syncMissingStageRules(agent);

    const stages = await this.getStagesForAccount(context.acesId);
    const { data, error } = await this.serviceClient
      .from("ai_stage_rules")
      .select("*")
      .eq("agent_id", agentId)
      .order("priority", { ascending: true });

    if (error) {
      throw new HttpError(500, "Nao foi possivel listar as regras por etapa", error);
    }

    const rules = (data ?? []) as StageRuleRow[];
    const ruleMap = new Map(rules.map((rule) => [rule.stage_id, rule]));

    return stages.map((stage) => ({
      stage,
      rule:
        ruleMap.get(stage.id) ?? ({
          id: "",
          agent_id: agentId,
          stage_id: stage.id,
          goal_description: "",
          positive_signals: [],
          negative_signals: [],
          example_phrases: [],
          priority: stage.position,
          is_terminal: stage.category !== "Aberto",
          created_at: "",
          updated_at: "",
        } satisfies StageRuleRow),
    }));
  }

  async saveStageRules(context: AuthContext, agentId: string, rules: StageRuleInput[]) {
    this.ensureAdmin(context);
    const agent = await this.getAgentForAccount(agentId, context.acesId);
    await this.syncMissingStageRules(agent);

    const stages = await this.getStagesForAccount(context.acesId);
    const validStageIds = new Set(stages.map((stage) => stage.id));

    const payload = rules.map((rule) => {
      if (!validStageIds.has(rule.stage_id)) {
        throw new HttpError(400, "Uma ou mais etapas nao pertencem a esta conta");
      }

      return {
        agent_id: agentId,
        stage_id: rule.stage_id,
        goal_description: rule.goal_description?.trim() ?? "",
        positive_signals: rule.positive_signals ?? [],
        negative_signals: rule.negative_signals ?? [],
        example_phrases: rule.example_phrases ?? [],
        priority: rule.priority ?? 0,
        is_terminal: rule.is_terminal ?? false,
      };
    });

    if (payload.length > 0) {
      const { error } = await this.serviceClient
        .from("ai_stage_rules")
        .upsert(payload, { onConflict: "agent_id,stage_id" });

      if (error) {
        throw new HttpError(500, "Nao foi possivel salvar as regras da IA", error);
      }
    }

    return this.getStageRules(context, agentId);
  }

  private async getStageRulesForAgent(agent: AgentRow) {
    await this.syncMissingStageRules(agent);
    const stages = await this.getStagesForAccount(agent.aces_id);
    const { data, error } = await this.serviceClient
      .from("ai_stage_rules")
      .select("*")
      .eq("agent_id", agent.id)
      .order("priority", { ascending: true });

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar as regras do agente", error);
    }

    const rules = (data ?? []) as StageRuleRow[];
    const rulesByStage = new Map(rules.map((rule) => [rule.stage_id, rule]));

    return stages.map((stage) => ({
      stage,
      rule:
        rulesByStage.get(stage.id) ??
        ({
          id: "",
          agent_id: agent.id,
          stage_id: stage.id,
          goal_description: "",
          positive_signals: [],
          negative_signals: [],
          example_phrases: [],
          priority: stage.position,
          is_terminal: stage.category !== "Aberto",
          created_at: "",
          updated_at: "",
        } satisfies StageRuleRow),
    }));
  }

  async listRuns(context: AuthContext, agentId: string, leadId?: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId);

    let query = this.serviceClient
      .from("ai_runs")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (leadId) {
      query = query.eq("lead_id", leadId);
    }

    const { data, error } = await query;
    if (error) {
      throw new HttpError(500, "Nao foi possivel listar as execucoes da IA", error);
    }

    return (data ?? []) as AiRunRow[];
  }

  async resumeLead(context: AuthContext, agentId: string, leadId: string) {
    this.ensureAdmin(context);
    await this.getAgentForAccount(agentId, context.acesId);

    const { error } = await this.serviceClient.from("ai_lead_state").upsert(
      {
        agent_id: agentId,
        lead_id: leadId,
        freeze_until: null,
        status: "active",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agent_id,lead_id" }
    );

    if (error) {
      throw new HttpError(500, "Nao foi possivel reativar o atendimento da IA", error);
    }

    return { success: true };
  }

  async listInstances(context: AuthContext) {
    this.ensureAdmin(context);
    await this.markExpiredPendingInstances(context.acesId);

    const { data, error } = await this.serviceClient
      .from("instance")
      .select(
        "instancia, aces_id, color, token, status, created_at, setup_status, setup_started_at, setup_expires_at, operation_lock_until, last_error"
      )
      .eq("aces_id", context.acesId)
      .or("setup_status.is.null,setup_status.neq.cancelled")
      .order("created_at", { ascending: false });

    if (error) {
      throw new HttpError(500, "Nao foi possivel listar as instancias", error);
    }

    return ((data ?? []) as InstanceRow[]).map((instance): InstanceListItem => {
      const setupStatus = this.deriveSetupStatus(instance);
      return {
        instanceName: instance.instancia,
        status: this.normalizeInstanceStatus(instance.status),
        setupStatus,
        createdAt: instance.created_at ?? null,
        expiresAt: instance.setup_expires_at ?? null,
        lastError: instance.last_error ?? null,
        actions: this.buildInstanceActions(instance, setupStatus),
        color: instance.color ?? null,
      };
    });
  }

  async createInstanceWithQr(context: AuthContext, input: CreateInstanceInput) {
    this.ensureAdmin(context);
    const instanceName = this.sanitizeInstanceName(input.instanceName);

    await this.markExpiredPendingInstances(context.acesId);
    const now = new Date();
    const setupExpiresAt = this.computeSetupExpirationIso(now);
    const existingRow = await this.findInstanceByName(instanceName);
    if (existingRow && existingRow.aces_id !== context.acesId) {
      throw new HttpError(409, "Nome de instancia indisponivel");
    }

    let existing = existingRow;
    let token = existing?.token ?? null;
    let qrCodeBase64: string | null = null;

    if (!existing) {
      try {
        const { data } = await axios.post(
          `${this.config.evolutionApiUrl}/instance/create`,
          {
            instanceName,
            qrcode: true,
            integration: "WHATSAPP-BAILEYS",
          },
          { headers: this.evolutionHeaders() }
        );

        const payload = asRecord(data);
        token = asString(asRecord(payload.hash).apikey);
        qrCodeBase64 =
          asString(asRecord(payload.qrcode).base64) ??
          asString(payload.base64) ??
          null;
      } catch (error: any) {
        const status = error?.response?.status as number | undefined;
        if (status !== 409) {
          throw new HttpError(
            502,
            "Falha ao criar instancia na Evolution",
            error?.response?.data ?? error?.message ?? error
          );
        }
      }
      const { error: insertError } = await this.serviceClient.from("instance").insert({
        instancia: instanceName,
        aces_id: context.acesId,
        token,
        status: "disconnected",
        setup_status: "pending_qr",
        setup_started_at: now.toISOString(),
        setup_expires_at: setupExpiresAt,
        last_error: null,
      });

      if (insertError) {
        throw new HttpError(500, "Nao foi possivel registrar a instancia no CRM", insertError);
      }

      await this.logInstanceEvent(context.acesId, instanceName, "created");
      if (qrCodeBase64) {
        await this.logInstanceEvent(context.acesId, instanceName, "qr_generated");
      }
    } else {
      await this.withInstanceLock(context.acesId, instanceName, async () => {
        await this.updateInstanceLifecycle(context.acesId, instanceName, {
          status: this.normalizeInstanceStatus(existing!.status),
          setup_status: existing?.status === "connected" ? "connected" : "pending_qr",
          setup_started_at: now.toISOString(),
          setup_expires_at: existing?.status === "connected" ? null : setupExpiresAt,
          last_error: null,
          token: token ?? null,
        });
      });
    }

    const currentStatus = this.normalizeInstanceStatus(existing?.status);
    if (existing && currentStatus !== "connected") {
      await this.logInstanceEvent(context.acesId, instanceName, "continue_setup");
    }
    if (!qrCodeBase64 && currentStatus !== "connected") {
      try {
        qrCodeBase64 = await this.fetchQrCodeFromEvolution(instanceName);
        await this.logInstanceEvent(context.acesId, instanceName, "qr_generated");
      } catch (error: any) {
        throw new HttpError(
          502,
          "Instancia registrada, mas nao foi possivel gerar QR code",
          error?.response?.data ?? error?.message ?? error
        );
      }
    }

    if (currentStatus !== "connected") {
      await this.updateInstanceLifecycle(context.acesId, instanceName, {
        status: "disconnected",
        setup_status: "pending_qr",
        setup_started_at: now.toISOString(),
        setup_expires_at: setupExpiresAt,
        last_error: null,
        token: token ?? null,
      });
    }

    const webhookSync = await this.ensureEvolutionWebhook(instanceName);
    if (!webhookSync.configured) {
      console.warn(`[crm-ai] Webhook da Evolution nao configurado automaticamente para ${instanceName}: ${webhookSync.reason}`);
    }

    return {
      success: true,
      instanceName,
      qrCodeBase64,
      status: currentStatus === "connected" ? "connected" : "disconnected",
      setupStatus: currentStatus === "connected" ? "connected" : "pending_qr",
      expiresAt: currentStatus === "connected" ? null : setupExpiresAt,
    };
  }

  async reconnectInstance(context: AuthContext, instanceNameRaw: string) {
    this.ensureAdmin(context);
    const instanceName = this.sanitizeInstanceName(instanceNameRaw);
    await this.markExpiredPendingInstances(context.acesId);
    await this.ensureInstanceOwnership(context.acesId, instanceName);

    return this.withInstanceLock(context.acesId, instanceName, async () => {
      const now = new Date();
      const setupExpiresAt = this.computeSetupExpirationIso(now);
      let qrCodeBase64: string | null = null;

      try {
        qrCodeBase64 = await this.fetchQrCodeFromEvolution(instanceName);
      } catch (error: any) {
        const creationAttempt = await this.tryRequestEvolution([
          {
            method: "post",
            path: "/instance/create",
            body: {
              instanceName,
              qrcode: true,
              integration: "WHATSAPP-BAILEYS",
            },
          },
        ]);

        if (!creationAttempt.ok) {
          throw new HttpError(
            502,
            "Nao foi possivel reconectar a instancia na Evolution",
            creationAttempt.data ?? error?.response?.data ?? error?.message ?? error
          );
        }

        qrCodeBase64 = asString(asRecord(asRecord(creationAttempt.data).qrcode).base64) ?? null;
      }

      await this.updateInstanceLifecycle(context.acesId, instanceName, {
        status: "disconnected",
        setup_status: "pending_qr",
        setup_started_at: now.toISOString(),
        setup_expires_at: setupExpiresAt,
        last_error: null,
      });

      await this.logInstanceEvent(context.acesId, instanceName, "reconnect");
      await this.logInstanceEvent(context.acesId, instanceName, "qr_generated");

      const webhookSync = await this.ensureEvolutionWebhook(instanceName);
      if (!webhookSync.configured) {
        console.warn(`[crm-ai] Webhook da Evolution nao configurado automaticamente para ${instanceName}: ${webhookSync.reason}`);
      }

      return {
        success: true,
        instanceName,
        qrCodeBase64,
        status: "disconnected" as const,
        setupStatus: "pending_qr" as const,
        expiresAt: setupExpiresAt,
      };
    });
  }

  async getInstanceQrCode(context: AuthContext, instanceNameRaw: string) {
    this.ensureAdmin(context);
    const instanceName = this.sanitizeInstanceName(instanceNameRaw);
    await this.ensureInstanceOwnership(context.acesId, instanceName);

    try {
      const qrCodeBase64 = await this.fetchQrCodeFromEvolution(instanceName);
      await this.updateInstanceLifecycle(context.acesId, instanceName, {
        status: "disconnected",
        setup_status: "pending_qr",
        setup_started_at: new Date().toISOString(),
        setup_expires_at: this.computeSetupExpirationIso(),
        last_error: null,
      });
      await this.logInstanceEvent(context.acesId, instanceName, "continue_setup");
      await this.logInstanceEvent(context.acesId, instanceName, "qr_generated");

      return {
        success: true,
        instanceName,
        qrCodeBase64,
        status: "disconnected" as const,
        setupStatus: "pending_qr" as const,
      };
    } catch (error: any) {
      throw new HttpError(
        502,
        "Nao foi possivel atualizar o QR code da instancia",
        error?.response?.data ?? error?.message ?? error
      );
    }
  }

  async getInstanceStatus(context: AuthContext, instanceNameRaw: string) {
    this.ensureAdmin(context);
    const instanceName = this.sanitizeInstanceName(instanceNameRaw);
    const instance = await this.ensureInstanceOwnership(context.acesId, instanceName);

    try {
      const { state, status } = await this.fetchEvolutionConnectionState(instanceName);
      const setupStatus =
        status === "connected"
          ? "connected"
          : this.deriveSetupStatus({ ...instance, status });

      await this.updateInstanceLifecycle(context.acesId, instanceName, {
        status,
        setup_status: setupStatus,
        setup_expires_at: status === "connected" ? null : instance.setup_expires_at ?? this.computeSetupExpirationIso(),
        last_error: null,
      });

      const webhookSync = await this.ensureEvolutionWebhook(instanceName);
      if (!webhookSync.configured) {
        console.warn(`[crm-ai] Webhook da Evolution nao configurado automaticamente para ${instanceName}: ${webhookSync.reason}`);
      }

      if (status === "connected") {
        await this.logInstanceEvent(context.acesId, instanceName, "connected");
      }

      return {
        success: true,
        instanceName,
        state,
        status,
        setupStatus,
      };
    } catch (error: any) {
      await this.updateInstanceLifecycle(context.acesId, instanceName, {
        status: "error",
        last_error: "Falha ao consultar estado na Evolution.",
      }).catch(() => {
        // falha de persistencia nao deve ocultar erro original
      });
      await this.logInstanceEvent(context.acesId, instanceName, "error", {
        reason: "status_sync_failed",
      });

      throw new HttpError(
        502,
        "Nao foi possivel consultar o status da instancia",
        error?.response?.data ?? error?.message ?? error
      );
    }
  }

  async disconnectInstance(context: AuthContext, instanceNameRaw: string) {
    this.ensureAdmin(context);
    const instanceName = this.sanitizeInstanceName(instanceNameRaw);
    await this.ensureInstanceOwnership(context.acesId, instanceName);

    return this.withInstanceLock(context.acesId, instanceName, async () => {
      const evolutionResult = await this.disconnectOnEvolution(instanceName);
      const remoteError = evolutionResult.ok ? null : JSON.stringify(evolutionResult.data ?? {});

      await this.updateInstanceLifecycle(context.acesId, instanceName, {
        status: "disconnected",
        last_error: remoteError,
      });
      await this.logInstanceEvent(context.acesId, instanceName, "disconnected", {
        evolution_ok: evolutionResult.ok,
      });

      return {
        success: true,
        instanceName,
        status: "disconnected" as const,
        warning: evolutionResult.ok ? null : "Instancia marcada como desconectada no CRM, mas a Evolution retornou erro.",
      };
    });
  }

  async deleteInstance(context: AuthContext, instanceNameRaw: string, options?: { hardDelete?: boolean }) {
    this.ensureAdmin(context);
    const instanceName = this.sanitizeInstanceName(instanceNameRaw);
    await this.ensureInstanceOwnership(context.acesId, instanceName);
    const hardDelete = options?.hardDelete ?? false;

    return this.withInstanceLock(context.acesId, instanceName, async () => {
      const evolutionResult = await this.deleteOnEvolution(instanceName);
      const remoteError = evolutionResult.ok ? null : JSON.stringify(evolutionResult.data ?? {});

      if (hardDelete) {
        const { error } = await this.serviceClient
          .from("instance")
          .delete()
          .eq("instancia", instanceName)
          .eq("aces_id", context.acesId);

        if (error) {
          throw new HttpError(500, "Nao foi possivel remover a instancia do CRM", error);
        }
      } else {
        await this.updateInstanceLifecycle(context.acesId, instanceName, {
          status: "disconnected",
          setup_status: "cancelled",
          setup_expires_at: null,
          last_error: remoteError,
        });
      }

      await this.logInstanceEvent(context.acesId, instanceName, "deleted", {
        hard_delete: hardDelete,
        evolution_ok: evolutionResult.ok,
      });

      return {
        success: true,
        instanceName,
        mode: hardDelete ? "hard" : "soft",
        warning: evolutionResult.ok ? null : "Instancia removida do CRM, mas a Evolution retornou erro durante exclusao.",
      };
    });
  }

  private getModel(modelName: string): GenerativeModel {
    if (!this.gemini) {
      throw new HttpError(500, "GEMINI_API_KEY nao configurada no backend");
    }

    return this.gemini.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json",
      },
    });
  }

  private async rememberOutbound(instanceName: string, phone: string, content: string) {
    const key = `crm-ai:outbound:${hashFingerprint([instanceName, normalizePhone(phone), content.trim()])}`;
    if (this.redis) {
      await this.redis.set(key, "1", "EX", 180);
      return;
    }
  }

  private async matchesRecentOutbound(instanceName: string, phone: string, content: string) {
    const key = `crm-ai:outbound:${hashFingerprint([instanceName, normalizePhone(phone), content.trim()])}`;
    if (!this.redis) {
      return false;
    }

    const value = await this.redis.get(key);
    return value === "1";
  }

  private async dedupeIncomingMessage(messageId: string | null) {
    if (!messageId || !this.redis) {
      return false;
    }

    const key = `crm-ai:inbound:${messageId}`;
    const stored = await this.redis.set(key, "1", "EX", 600, "NX");
    return stored !== "OK";
  }

  private async saveMessage(params: {
    leadId: string;
    acesId: number;
    content: string;
    direction: "inbound" | "outbound";
    sourceType: "lead" | "human" | "ai" | "automation" | "system";
    instanceName: string | null;
    createdBy?: string | null;
    conversationId?: string | null;
    sentAt?: string;
  }) {
    const payload = {
      lead_id: params.leadId,
      aces_id: params.acesId,
      content: params.content,
      direction: params.direction,
      source_type: params.sourceType,
      instance: params.instanceName,
      created_by: params.createdBy ?? null,
      conversation_id: params.conversationId ?? null,
      sent_at: params.sentAt ?? new Date().toISOString(),
    };

    const { data, error } = await this.serviceClient
      .from("message_history")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      throw new HttpError(500, "Nao foi possivel registrar a mensagem no CRM", error);
    }

    await this.serviceClient
      .from("leads")
      .update({
        last_message_at: payload.sent_at,
        updated_at: new Date().toISOString(),
        instancia: params.instanceName,
      })
      .eq("id", params.leadId)
      .eq("aces_id", params.acesId);

    return data as MessageRow;
  }

  private async loadLeadById(leadId: string, acesId: number) {
    const { data, error } = await this.serviceClient
      .from("leads")
      .select("id, aces_id, name, contact_phone, status, stage_id, instancia, last_city, updated_at")
      .eq("id", leadId)
      .eq("aces_id", acesId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar o lead", error);
    }

    if (!data) {
      throw new HttpError(404, "Lead nao encontrado");
    }

    return data as LeadRow;
  }

  private async findLeadByPhone(acesId: number, phone: string) {
    const variants = phoneVariants(phone);
    const { data, error } = await this.serviceClient
      .from("leads")
      .select("id, aces_id, name, contact_phone, status, stage_id, instancia, last_city, updated_at")
      .eq("aces_id", acesId)
      .in("contact_phone", variants)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel localizar o lead pelo telefone", error);
    }

    return (data as LeadRow | null) ?? null;
  }

  private async findOrCreateLead(acesId: number, phone: string, instanceName: string, pushName?: string | null) {
    const found = await this.findLeadByPhone(acesId, phone);
    if (found) {
      return found;
    }

    const stages = await this.getStagesForAccount(acesId);
    const defaultStage = stages.find((stage) => stage.category === "Aberto") ?? stages[0] ?? null;
    const preferredPhone = normalizePhone(phone);
    const name = pushName?.trim() || `Lead ${preferredPhone}`;

    const { data, error } = await this.serviceClient
      .from("leads")
      .insert({
        aces_id: acesId,
        name,
        contact_phone: preferredPhone,
        status: defaultStage?.name ?? "Novo",
        stage_id: defaultStage?.id ?? null,
        instancia: instanceName,
        view: true,
      })
      .select("id, aces_id, name, contact_phone, status, stage_id, instancia, last_city, updated_at")
      .single();

    if (error) {
      throw new HttpError(500, "Nao foi possivel criar o lead a partir da conversa", error);
    }

    return data as LeadRow;
  }

  private async fetchRecentConversation(leadId: string) {
    const { data, error } = await this.serviceClient
      .from("message_history")
      .select("id, lead_id, aces_id, content, direction, source_type, instance, created_by, sent_at, conversation_id")
      .eq("lead_id", leadId)
      .order("sent_at", { ascending: false })
      .limit(20);

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar o historico da conversa", error);
    }

    return ((data ?? []) as MessageRow[]).reverse();
  }

  private async getLeadState(agentId: string, leadId: string) {
    const { data, error } = await this.serviceClient
      .from("ai_lead_state")
      .select("*")
      .eq("agent_id", agentId)
      .eq("lead_id", leadId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel consultar o estado da IA para o lead", error);
    }

    return (data as JsonRecord | null) ?? null;
  }

  private async upsertLeadState(agentId: string, leadId: string, payload: JsonRecord) {
    const { error } = await this.serviceClient.from("ai_lead_state").upsert(
      {
        agent_id: agentId,
        lead_id: leadId,
        ...payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agent_id,lead_id" }
    );

    if (error) {
      throw new HttpError(500, "Nao foi possivel atualizar o estado da IA para o lead", error);
    }
  }

  private async freezeLead(agent: AgentRow, leadId: string) {
    const freezeUntil = new Date(Date.now() + agent.human_pause_minutes * 60_000).toISOString();
    await this.upsertLeadState(agent.id, leadId, {
      freeze_until: freezeUntil,
      status: "paused",
    });
    return freezeUntil;
  }

  private async createRun(payload: {
    agentId: string;
    leadId: string;
    messageHistoryIds?: string[];
    inputSnapshot?: JsonRecord;
    outputSnapshot?: JsonRecord;
    suggestedStageId?: string | null;
    appliedStageId?: string | null;
    confidence?: number | null;
    actionTaken?: "none" | "reply_only" | "stage_applied" | "manual_pause" | "failed";
    error?: string | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
  }) {
    const { error } = await this.serviceClient.from("ai_runs").insert({
      agent_id: payload.agentId,
      lead_id: payload.leadId,
      message_history_ids: payload.messageHistoryIds ?? [],
      input_snapshot: payload.inputSnapshot ?? {},
      output_snapshot: payload.outputSnapshot ?? {},
      suggested_stage_id: payload.suggestedStageId ?? null,
      applied_stage_id: payload.appliedStageId ?? null,
      confidence: payload.confidence ?? null,
      action_taken: payload.actionTaken ?? "none",
      error: payload.error ?? null,
      tokens_in: payload.tokensIn ?? null,
      tokens_out: payload.tokensOut ?? null,
    });

    if (error) {
      throw new HttpError(500, "Nao foi possivel registrar a execucao da IA", error);
    }
  }

  private parseWebhookPayload(payload: WebhookPayload): ParsedWebhookMessage {
    const root = asRecord(payload);
    const data = asRecord(root.data);
    const key = asRecord(data.key);
    const message = asRecord(data.message);
    const messageContext = asRecord(root.message ?? data.messageData ?? data);

    const instanceName =
      asString(root.instance) ??
      asString(root.instanceName) ??
      asString(data.instance) ??
      asString(data.instanceName) ??
      asString(asRecord(root.sender).instance) ??
      asString(asRecord(root.apikey).instance);

    const remoteJid = asString(key.remoteJid) ?? asString(data.remoteJid) ?? asString(root.remoteJid);
    const pushName = asString(data.pushName) ?? asString(root.pushName) ?? asString(asRecord(data.sender).pushName);
    const messageId = asString(key.id) ?? asString(root.messageId) ?? asString(data.messageId);
    const fromMe = Boolean(key.fromMe ?? data.fromMe ?? root.fromMe);
    const sentAtRaw = data.messageTimestamp ?? root.messageTimestamp ?? root.timestamp ?? Date.now();
    const sentAt =
      typeof sentAtRaw === "number"
        ? new Date(sentAtRaw * (sentAtRaw > 1_000_000_000_000 ? 1 : 1000)).toISOString()
        : new Date(String(sentAtRaw)).toISOString();

    const phoneCandidate =
      asString(remoteJid)?.replace(/@.+$/, "") ??
      asString(data.sender) ??
      asString(root.sender) ??
      asString(root.from) ??
      asString(data.from);

    const textCandidates = [
      asString(message.conversation),
      asString(asRecord(message.extendedTextMessage).text),
      asString(asRecord(message.imageMessage).caption),
      asString(asRecord(message.videoMessage).caption),
      asString(asRecord(root.text).text),
      asString(root.body),
      asString(data.body),
      asString(messageContext.content),
    ].filter((item): item is string => Boolean(item));

    const imageMessage = asRecord(message.imageMessage);
    const audioMessage = asRecord(message.audioMessage);
    const documentMessage = asRecord(message.documentMessage);
    const imageUrl = asString(imageMessage.url) ?? asString(asRecord(root.image).url);
    const imageBase64 = asString(imageMessage.base64) ?? asString(asRecord(root.image).base64);
    const audioUrl = asString(audioMessage.url) ?? asString(asRecord(root.audio).url) ?? asString(documentMessage.url);
    const audioBase64 =
      asString(audioMessage.base64) ?? asString(asRecord(root.audio).base64) ?? asString(documentMessage.base64);

    if (!instanceName) {
      throw new HttpError(400, "Webhook sem instancia identificavel");
    }

    if (!phoneCandidate) {
      throw new HttpError(400, "Webhook sem telefone identificavel");
    }

    return {
      instanceName,
      fromMe,
      phone: phoneCandidate,
      content: textCandidates[0] ?? "",
      messageId,
      conversationId: remoteJid ?? phoneCandidate,
      sentAt,
      pushName,
      mediaKind: audioBase64 || audioUrl ? "audio" : imageBase64 || imageUrl ? "image" : null,
      mediaMimeType:
        asString(audioMessage.mimetype) ??
        asString(imageMessage.mimetype) ??
        asString(documentMessage.mimetype) ??
        null,
      mediaBase64: audioBase64 ?? imageBase64 ?? null,
      mediaUrl: audioUrl ?? imageUrl ?? null,
      raw: root,
    };
  }

  private async normalizeInboundContent(message: ParsedWebhookMessage, agent?: AgentRow | null) {
    if (message.content.trim()) {
      return message.content.trim();
    }

    if (!message.mediaKind) {
      return "[mensagem sem texto]";
    }

    if (!this.gemini) {
      return message.mediaKind === "audio" ? "[audio recebido]" : "[imagem recebida]";
    }

    const mediaPart = await this.buildMediaPart(message);
    if (!mediaPart) {
      return message.mediaKind === "audio" ? "[audio recebido]" : "[imagem recebida]";
    }

    const model = this.getModel(agent?.model?.trim() || "gemini-2.5-flash");
    const prompt =
      message.mediaKind === "audio"
        ? "Transcreva em portugues brasileiro o conteudo principal deste audio de WhatsApp. Responda apenas com o texto transcrito."
        : "Descreva de forma objetiva o conteudo principal desta imagem recebida no WhatsApp. Responda apenas com a descricao.";

    const result = await model.generateContent([prompt, mediaPart]);
    return result.response.text().trim() || (message.mediaKind === "audio" ? "[audio recebido]" : "[imagem recebida]");
  }

  private async buildMediaPart(message: ParsedWebhookMessage) {
    if (message.mediaBase64 && message.mediaMimeType) {
      return {
        inlineData: {
          mimeType: message.mediaMimeType,
          data: message.mediaBase64,
        },
      };
    }

    if (message.mediaUrl && message.mediaMimeType) {
      const response = await axios.get<ArrayBuffer>(message.mediaUrl, {
        responseType: "arraybuffer",
      });

      return {
        inlineData: {
          mimeType: message.mediaMimeType,
          data: Buffer.from(response.data).toString("base64"),
        },
      };
    }

    return null;
  }

  private async sendWhatsAppMessage(instanceName: string, phone: string, content: string) {
    const cleanPhone = normalizePhone(phone);
    const number = cleanPhone.length <= 11 ? `55${cleanPhone}` : cleanPhone;

    await axios.post(
      `${this.config.evolutionApiUrl}/message/sendText/${instanceName}`,
      {
        number: `${number}@s.whatsapp.net`,
        text: content,
        delay: 1000,
      },
      {
        headers: { apikey: this.config.evolutionApiKey },
      }
    );
  }

  private async sendReplyBlocks(params: {
    agent: AgentRow;
    lead: LeadRow;
    blocks: string[];
    sourceType: "ai" | "human";
    createdBy?: string | null;
  }) {
    const blocks = params.blocks.map((item) => item.trim()).filter(Boolean);
    if (blocks.length === 0) {
      return;
    }

    const instanceName = params.agent.instance_name || params.lead.instancia;
    const phone = requireValue(params.lead.contact_phone, "Lead sem telefone para envio");
    const resolvedInstance = requireValue(instanceName, "Instancia de envio nao definida");

    for (const [index, block] of blocks.entries()) {
      await this.sendWhatsAppMessage(resolvedInstance, phone, block);
      await this.rememberOutbound(resolvedInstance, phone, block);

      await this.saveMessage({
        leadId: params.lead.id,
        acesId: params.lead.aces_id,
        content: block,
        direction: "outbound",
        sourceType: params.sourceType,
        instanceName: resolvedInstance,
        createdBy: params.createdBy ?? null,
        conversationId: `${params.sourceType}:${Date.now()}:${index}`,
      });

      if (index < blocks.length - 1) {
        await wait(900);
      }
    }
  }

  private async classifyConversation(agent: AgentRow, lead: LeadRow, rules: Array<{ stage: StageRow; rule: StageRuleRow }>, messages: MessageRow[]) {
    const model = this.getModel(agent.model);
    const conversation = messages
      .map((message) => `${message.source_type === "lead" ? "Lead" : "Operacao"}: ${truncateText(message.content, 600)}`)
      .join("\n");

    const stages = rules.map(({ stage, rule }) => ({
      id: stage.id,
      nome: stage.name,
      categoria: stage.category,
      prioridade: rule.priority,
      objetivo: rule.goal_description,
      sinais_positivos: rule.positive_signals,
      sinais_negativos: rule.negative_signals,
      exemplos: rule.example_phrases,
      terminal: rule.is_terminal,
    }));

    const prompt = [
      agent.system_prompt,
      "",
      "Retorne JSON puro com as chaves: reply_blocks, stage_decision, confidence, reason, should_apply_stage, should_pause.",
      "reply_blocks deve ser uma lista de 0 a 3 mensagens curtas de WhatsApp.",
      "stage_decision deve conter stage_id e reason.",
      "Aplique etapa apenas se houver confianca alta e se a etapa fizer sentido no funil existente.",
      "",
      `Lead atual: ${JSON.stringify({
        id: lead.id,
        nome: lead.name,
        telefone: lead.contact_phone,
        status_atual: lead.status,
        stage_id_atual: lead.stage_id,
        cidade: lead.last_city,
      })}`,
      "",
      `Etapas disponiveis: ${JSON.stringify(stages)}`,
      "",
      `Historico recente:\n${conversation}`,
    ].join("\n");

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = parseStructuredJson(text);
    const usage = asRecord((result.response as unknown as JsonRecord).usageMetadata);

    return {
      parsed,
      rawText: text,
      tokensIn: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : null,
      tokensOut: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null,
    };
  }

  private async applyStageDecision(agent: AgentRow, lead: LeadRow, response: StructuredModelResponse) {
    if (!response.should_apply_stage || !response.stage_decision.stage_id) {
      return null;
    }

    if (response.confidence < agent.auto_apply_threshold) {
      return null;
    }

    if (lead.stage_id === response.stage_decision.stage_id) {
      return lead.stage_id;
    }

    const { error } = await this.serviceClient.rpc("service_move_lead_to_stage", {
      p_lead_id: lead.id,
      p_stage_id: response.stage_decision.stage_id,
      p_aces_id: lead.aces_id,
    });

    if (error) {
      throw new HttpError(500, "Nao foi possivel mover o lead de etapa pela IA", error);
    }

    await this.upsertLeadState(agent.id, lead.id, {
      last_classified_stage_id: response.stage_decision.stage_id,
      last_confidence: response.confidence,
      status: response.should_pause ? "paused" : "active",
    });

    return response.stage_decision.stage_id;
  }

  private async queueBufferedProcessing(agent: AgentRow, leadId: string, message: ParsedWebhookMessage) {
    const bufferKey = `crm-ai:buffer:${agent.id}:${leadId}`;
    if (this.redis) {
      await this.redis.rpush(bufferKey, JSON.stringify(message));
      const scheduleKey = `${bufferKey}:scheduled`;
      const scheduled = await this.redis.set(scheduleKey, "1", "PX", agent.buffer_wait_ms + 5000, "NX");
      if (scheduled === "OK") {
        setTimeout(() => {
          this.flushBufferedConversation(agent.id, leadId).catch((error) => {
            console.error("[crm-ai] Falha ao processar buffer Redis:", error);
          });
        }, agent.buffer_wait_ms);
      }
      return;
    }

    const entries = this.memoryBuffers.get(bufferKey) ?? [];
    entries.push(message);
    this.memoryBuffers.set(bufferKey, entries);

    if (this.memoryTimers.has(bufferKey)) {
      return;
    }

    const timer = setTimeout(() => {
      this.memoryTimers.delete(bufferKey);
      this.flushBufferedConversation(agent.id, leadId).catch((error) => {
        console.error("[crm-ai] Falha ao processar buffer em memoria:", error);
      });
    }, agent.buffer_wait_ms);

    this.memoryTimers.set(bufferKey, timer);
  }

  private async consumeBufferedEntries(agentId: string, leadId: string) {
    const bufferKey = `crm-ai:buffer:${agentId}:${leadId}`;

    if (this.redis) {
      const rawItems = await this.redis.lrange(bufferKey, 0, -1);
      await this.redis.del(bufferKey, `${bufferKey}:scheduled`);
      return rawItems.map((item) => JSON.parse(item) as ParsedWebhookMessage);
    }

    const items = this.memoryBuffers.get(bufferKey) ?? [];
    this.memoryBuffers.delete(bufferKey);
    return items;
  }

  private async flushBufferedConversation(agentId: string, leadId: string) {
    const agent = await this.getAgentById(agentId);
    const bufferedEntries = await this.consumeBufferedEntries(agentId, leadId);
    if (bufferedEntries.length === 0) {
      return;
    }

    const lead = await this.loadLeadById(leadId, agent.aces_id);
    const leadState = await this.getLeadState(agent.id, lead.id);
    const freezeUntil = asString(leadState?.freeze_until);
    if (freezeUntil && new Date(freezeUntil) > new Date()) {
      return;
    }

    const rules = await this.getStageRulesForAgent(agent);
    const conversation = await this.fetchRecentConversation(lead.id);
    const inboundMessages = bufferedEntries.map((entry) => entry.messageId).filter((item): item is string => Boolean(item));

    try {
      const result = await this.classifyConversation(agent, lead, rules, conversation);
      const appliedStageId = await this.applyStageDecision(agent, lead, result.parsed);

      if (result.parsed.reply_blocks.length > 0) {
        await this.sendReplyBlocks({
          agent,
          lead,
          blocks: result.parsed.reply_blocks,
          sourceType: "ai",
        });
      }

      if (result.parsed.should_pause) {
        await this.freezeLead(agent, lead.id);
      } else {
        await this.upsertLeadState(agent.id, lead.id, {
          last_processed_message_at: bufferedEntries[bufferedEntries.length - 1]?.sentAt ?? new Date().toISOString(),
          last_inbound_at: bufferedEntries[bufferedEntries.length - 1]?.sentAt ?? new Date().toISOString(),
          last_ai_reply_at: result.parsed.reply_blocks.length > 0 ? new Date().toISOString() : null,
          last_classified_stage_id: appliedStageId ?? null,
          last_confidence: result.parsed.confidence,
          status: "active",
        });
      }

      await this.createRun({
        agentId: agent.id,
        leadId: lead.id,
        messageHistoryIds: inboundMessages,
        inputSnapshot: {
          lead,
          bufferedEntries,
          rules,
        },
        outputSnapshot: {
          raw_model_response: result.rawText,
          structured: result.parsed,
        },
        suggestedStageId: result.parsed.stage_decision.stage_id,
        appliedStageId,
        confidence: result.parsed.confidence,
        actionTaken: appliedStageId ? "stage_applied" : result.parsed.reply_blocks.length > 0 ? "reply_only" : "none",
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida na execucao da IA";
      await this.upsertLeadState(agent.id, lead.id, {
        status: "error",
      });

      await this.createRun({
        agentId: agent.id,
        leadId: lead.id,
        messageHistoryIds: inboundMessages,
        inputSnapshot: {
          bufferedEntries,
        },
        outputSnapshot: {},
        actionTaken: "failed",
        error: message,
      });

      throw error;
    }
  }

  async processEvolutionWebhook(payload: WebhookPayload) {
    const event = asString(asRecord(payload).event)?.toLowerCase();
    if (event && event !== "messages.upsert") {
      return { ignored: true, reason: `Evento ${event} ignorado` };
    }

    const message = this.parseWebhookPayload(payload);
    const instance = await this.findInstanceByName(message.instanceName);
    if (!instance) {
      return { ignored: true, reason: "Instancia nao cadastrada no CRM" };
    }

    const agent = await this.getActiveAgentByInstance(message.instanceName);
    const normalizedContent = await this.normalizeInboundContent(message, agent);
    const duplicated = await this.dedupeIncomingMessage(message.messageId);
    if (duplicated) {
      return { ignored: true, reason: "Mensagem duplicada" };
    }

    if (message.fromMe) {
      const isKnownOutbound = await this.matchesRecentOutbound(message.instanceName, message.phone, normalizedContent);
      if (isKnownOutbound) {
        return { ignored: true, reason: "Echo de mensagem ja enviada pelo backend" };
      }

      const lead = await this.findOrCreateLead(
        instance.aces_id,
        message.phone,
        message.instanceName,
        message.pushName
      );

      await this.saveMessage({
        leadId: lead.id,
        acesId: instance.aces_id,
        content: normalizedContent,
        direction: "outbound",
        sourceType: "human",
        instanceName: message.instanceName,
        conversationId: message.conversationId,
        sentAt: message.sentAt,
      });

      let freezeUntil: string | null = null;
      if (agent) {
        freezeUntil = await this.freezeLead(agent, lead.id);
        await this.createRun({
          agentId: agent.id,
          leadId: lead.id,
          inputSnapshot: {
            reason: "manual_handoff_from_evolution",
            payload: message.raw,
          },
          outputSnapshot: {
            freeze_until: freezeUntil,
          },
          actionTaken: "manual_pause",
        });
      }

      return {
        success: true,
        leadId: lead.id,
        agentId: agent?.id ?? null,
        capturedOnly: !agent,
        reason: agent ? "Handoff humano detectado" : "Mensagem humana registrada sem agente ativo",
        freezeUntil,
      };
    }

    const lead = await this.findOrCreateLead(
      instance.aces_id,
      message.phone,
      message.instanceName,
      message.pushName
    );
    const savedMessage = await this.saveMessage({
      leadId: lead.id,
      acesId: instance.aces_id,
      content: normalizedContent,
      direction: "inbound",
      sourceType: "lead",
      instanceName: message.instanceName,
      conversationId: message.conversationId,
      sentAt: message.sentAt,
    });

    if (!agent) {
      return {
        success: true,
        leadId: lead.id,
        queued: false,
        agentId: null,
        capturedOnly: true,
        reason: "Mensagem registrada sem agente ativo",
      };
    }

    await this.upsertLeadState(agent.id, lead.id, {
      last_inbound_at: message.sentAt,
      status: "active",
    });

    await this.queueBufferedProcessing(agent, lead.id, {
      ...message,
      content: normalizedContent,
      messageId: savedMessage.id,
    });

    return {
      success: true,
      leadId: lead.id,
      queued: true,
      agentId: agent.id,
    };
  }

  async sendManualMessage(context: AuthContext, input: SendManualMessageInput) {
    if (!input.content?.trim()) {
      throw new HttpError(400, "Mensagem vazia");
    }

    const lead = await this.loadLeadById(input.leadId, context.acesId);
    const instanceName = input.instanceName?.trim() || lead.instancia;

    if (!instanceName) {
      throw new HttpError(400, "Nenhuma instancia de envio foi definida para este lead");
    }

    const activeAgent = await this.getActiveAgentByInstance(instanceName);
    const effectiveAgent = activeAgent && activeAgent.aces_id === context.acesId ? activeAgent : null;

    await this.sendReplyBlocks({
      agent:
        effectiveAgent ??
        ({
          id: "manual",
          aces_id: context.acesId,
          instance_name: instanceName,
          name: "Envio manual",
          system_prompt: DEFAULT_SYSTEM_MESSAGE,
          provider: "gemini",
          model: "gemini-2.5-flash",
          is_active: false,
          buffer_wait_ms: 15000,
          human_pause_minutes: 60,
          auto_apply_threshold: 0.85,
          created_by: context.crmUserId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } satisfies AgentRow),
      lead,
      blocks: [input.content.trim()],
      sourceType: "human",
      createdBy: context.crmUserId,
    });

    if (effectiveAgent) {
      const freezeUntil = await this.freezeLead(effectiveAgent, lead.id);
      await this.createRun({
        agentId: effectiveAgent.id,
        leadId: lead.id,
        inputSnapshot: {
          source: "manual_send",
          crm_user_id: context.crmUserId,
        },
        outputSnapshot: {
          freeze_until: freezeUntil,
        },
        actionTaken: "manual_pause",
      });
    }

    return { success: true };
  }

  validateWebhookSecret(headerValue?: string | null) {
    if (!this.config.evolutionWebhookSecret) {
      return true;
    }

    const provided = headerValue?.replace(/^Bearer\s+/i, "").trim();
    return provided === this.config.evolutionWebhookSecret;
  }

  async dispose() {
    if (this.redis) {
      await this.redis.quit();
    }

    for (const timer of this.memoryTimers.values()) {
      clearTimeout(timer);
    }
    this.memoryTimers.clear();
    this.memoryBuffers.clear();
  }
}
