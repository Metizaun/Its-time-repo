import { createHash, randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  isOriginAllowed,
  normalizeDomain,
  validateBrazilianPhone,
  validateVisitorName,
} from "./website-widget-validation.js";

export type WebsiteWidgetConnectionStatus = "active" | "paused";

export type WebsiteWidgetConnection = {
  id: string;
  publicKey: string;
  name: string;
  agentId: string | null;
  agentName: string | null;
  instanceName: string;
  welcomeMessage: string | null;
  theme: Record<string, unknown>;
  allowedDomains: string[];
  status: WebsiteWidgetConnectionStatus;
  ready: boolean;
  configurationIssue: string | null;
  embedSnippet: string;
  createdAt: string;
  updatedAt: string;
};

export type WebsiteWidgetAdminInput = {
  name?: unknown;
  agentId?: unknown;
  welcomeMessage?: unknown;
  theme?: unknown;
  allowedDomains?: unknown;
  status?: unknown;
};

export type WebsiteWidgetInboundResult = {
  queued: boolean;
  inboundMessageId: string | null;
  reason?: string;
};

/**
 * Everything the widget needs from the agent runtime. Keeping it as a port lets
 * this service stay free of CRM internals and be unit tested without Supabase.
 */
export type WebsiteWidgetAgentPort = {
  ensureLead(
    acesId: number,
    input: { phone: string; name: string; instanceName: string },
  ): Promise<{ leadId: string }>;
  processInbound(
    acesId: number,
    input: { leadId: string; instanceName: string; messagingConnectionId: string; content: string },
  ): Promise<WebsiteWidgetInboundResult>;
  requeueReply(
    acesId: number,
    input: {
      leadId: string;
      instanceName: string;
      messagingConnectionId: string;
      content: string;
      messageId: string | null;
    },
  ): Promise<{ queued: boolean; reason?: string }>;
  saveAgentMessage(
    acesId: number,
    input: { leadId: string; instanceName: string; messagingConnectionId: string; content: string },
  ): Promise<void>;
};

export type WebsiteWidgetServiceConfig = {
  supabaseUrl: string;
  serviceRoleKey: string;
  agent: WebsiteWidgetAgentPort;
  publicBaseUrl?: string;
  apiBaseUrl?: string;
  sessionIdleMinutes?: number;
  replyTimeoutSeconds?: number;
  maxReplyAttempts?: number;
  messageRateLimitPerMinute?: number;
  pollRateLimitPerMinute?: number;
};

export type WebsiteWidgetRequestContext = {
  origin: string | null;
  ip: string | null;
};

export type WebsiteWidgetMessage = {
  id: string;
  content: string;
  direction: "inbound" | "outbound";
  sentAt: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MESSAGE_MAX_LENGTH = 2000;
const DEFAULT_WELCOME = "Oi! Como posso ajudar?";
const HANDOFF_FALLBACK =
  "Tive um problema para responder agora, mas sua mensagem foi registrada e um atendente vai continuar com voce por este canal.";

export class WebsiteWidgetError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "WebsiteWidgetError";
  }
}

type ConnectionRow = {
  id: string;
  public_key: string;
  aces_id: number;
  name: string;
  agent_id: string | null;
  instance_name: string;
  messaging_connection_id: string;
  welcome_message: string | null;
  theme: Record<string, unknown> | null;
  allowed_domains: string[] | null;
  status: WebsiteWidgetConnectionStatus;
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

type SessionRow = {
  id: string;
  aces_id: number;
  connection_id: string;
  lead_id: string;
  status: "active" | "ended";
  last_seen_at: string;
};

function requiredText(value: unknown, field: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new WebsiteWidgetError(
      `${field} e obrigatorio`,
      "WEBSITE_WIDGET_FIELD_REQUIRED",
      400,
    );
  }
  if (text.length > maxLength) {
    throw new WebsiteWidgetError(
      `${field} excede ${maxLength} caracteres`,
      "WEBSITE_WIDGET_FIELD_TOO_LONG",
      400,
    );
  }
  return text;
}

function uuid(value: unknown, field: string) {
  const normalized = requiredText(value, field, 100).toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new WebsiteWidgetError(
      `${field} invalido`,
      "WEBSITE_WIDGET_UUID_INVALID",
      400,
    );
  }
  return normalized;
}

function mapDatabaseError(error: { code?: string; message?: string }) {
  if (error.code === "23505") {
    return new WebsiteWidgetError(
      "Ja existe um agente de site com este nome",
      "WEBSITE_WIDGET_CONNECTION_CONFLICT",
      409,
    );
  }
  if (error.code === "23503" || error.code === "23514") {
    return new WebsiteWidgetError(
      "Configuracao do agente de site invalida",
      "WEBSITE_WIDGET_CONFIGURATION_INVALID",
      422,
    );
  }
  return new WebsiteWidgetError(
    String(error.message ?? "") || "Falha ao operar o agente de site",
    "WEBSITE_WIDGET_DATABASE_ERROR",
    500,
  );
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseAllowedDomains(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[\s,;]+/);
  const domains = new Set<string>();
  for (const entry of list) {
    const domain = normalizeDomain(entry);
    if (!domain) {
      throw new WebsiteWidgetError(
        `Endereco de site invalido: ${String(entry)}`,
        "WEBSITE_WIDGET_DOMAIN_INVALID",
        400,
      );
    }
    domains.add(domain);
  }
  return [...domains];
}

export function embedSnippetFor(
  widgetBaseUrl: string | undefined,
  apiBaseUrl: string | undefined,
  publicKey: string,
) {
  const host = (widgetBaseUrl ?? "").replace(/\/$/, "");
  const api = (apiBaseUrl ?? "").replace(/\/$/, "");
  return `<script src="${host}/widget.js" data-widget-key="${publicKey}" data-api="${api}" async></script>`;
}

export class WebsiteWidgetService {
  private readonly crm: SupabaseClient<any, any, any>;
  private readonly agents: SupabaseClient<any, any, any>;
  private readonly agent: WebsiteWidgetAgentPort;
  private readonly publicBaseUrl: string | undefined;
  private readonly apiBaseUrl: string | undefined;
  private readonly sessionIdleMinutes: number;
  private readonly replyTimeoutSeconds: number;
  private readonly maxReplyAttempts: number;
  private readonly messageRateLimit: number;
  private readonly pollRateLimit: number;

  constructor(config: WebsiteWidgetServiceConfig) {
    const options = {
      auth: { persistSession: false, autoRefreshToken: false },
    };
    this.crm = createClient(config.supabaseUrl, config.serviceRoleKey, {
      ...options,
      db: { schema: "crm" },
    });
    this.agents = createClient(config.supabaseUrl, config.serviceRoleKey, {
      ...options,
      db: { schema: "agents" },
    });
    this.agent = config.agent;
    this.publicBaseUrl = config.publicBaseUrl;
    this.apiBaseUrl = config.apiBaseUrl;
    this.sessionIdleMinutes = config.sessionIdleMinutes ?? 10;
    this.replyTimeoutSeconds = config.replyTimeoutSeconds ?? 90;
    this.maxReplyAttempts = config.maxReplyAttempts ?? 3;
    this.messageRateLimit = config.messageRateLimitPerMinute ?? 30;
    this.pollRateLimit = config.pollRateLimitPerMinute ?? 120;
  }

  // ---------------------------------------------------------------- public API

  async getPublicConfig(publicKey: string, context: WebsiteWidgetRequestContext) {
    const connection = await this.requireLiveConnection(publicKey, context);
    return {
      welcomeMessage: connection.welcome_message?.trim() || DEFAULT_WELCOME,
      theme: connection.theme ?? {},
    };
  }

  async startSession(
    publicKey: string,
    context: WebsiteWidgetRequestContext,
    input: { name?: unknown; phone?: unknown },
  ) {
    const connection = await this.requireLiveConnection(publicKey, context);
    await this.enforceRateLimit(connection.id, context.ip, this.messageRateLimit);

    const name = validateVisitorName(input.name);
    if (!name.ok) {
      throw new WebsiteWidgetError(name.error.message, name.error.code, 422);
    }
    const phone = validateBrazilianPhone(input.phone);
    if (!phone.ok) {
      throw new WebsiteWidgetError(phone.error.message, phone.error.code, 422);
    }

    const { leadId } = await this.agent.ensureLead(connection.aces_id, {
      phone: phone.value,
      name: name.value,
      instanceName: connection.instance_name,
    });

    const token = randomBytes(32).toString("base64url");
    const { data, error } = await this.crm
      .from("website_widget_sessions")
      .insert({
        aces_id: connection.aces_id,
        connection_id: connection.id,
        lead_id: leadId,
        token_hash: hashToken(token),
        origin_domain: normalizeDomain(context.origin),
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw mapDatabaseError(error);

    return {
      sessionToken: token,
      sessionId: data.id as string,
      welcomeMessage: connection.welcome_message?.trim() || DEFAULT_WELCOME,
      cursor: new Date().toISOString(),
    };
  }

  async postMessage(
    publicKey: string,
    context: WebsiteWidgetRequestContext,
    input: { sessionToken?: unknown; text?: unknown },
  ) {
    const connection = await this.requireLiveConnection(publicKey, context);
    await this.enforceRateLimit(connection.id, context.ip, this.messageRateLimit);
    const session = await this.requireSession(connection, input.sessionToken);
    const text = requiredText(input.text, "text", MESSAGE_MAX_LENGTH);

    const result = await this.agent.processInbound(connection.aces_id, {
      leadId: session.lead_id,
      instanceName: connection.instance_name,
      messagingConnectionId: connection.messaging_connection_id,
      content: text,
    });

    await this.touchSession(session.id);

    // Durable record of "this visitor is waiting", so a dropped in-memory timer
    // can be retried instead of leaving the chat silent forever.
    if (result.queued) {
      const { error } = await this.crm.from("website_widget_reply_jobs").insert({
        aces_id: connection.aces_id,
        session_id: session.id,
        lead_id: session.lead_id,
        inbound_message_id: result.inboundMessageId,
        next_attempt_at: new Date(
          Date.now() + this.replyTimeoutSeconds * 1000,
        ).toISOString(),
      });
      if (error) throw mapDatabaseError(error);
    }

    return {
      accepted: true,
      awaitingReply: result.queued,
      reason: result.queued ? null : (result.reason ?? null),
    };
  }

  async pollMessages(
    publicKey: string,
    context: WebsiteWidgetRequestContext,
    input: { sessionToken?: unknown; cursor?: unknown },
  ) {
    const connection = await this.requireLiveConnection(publicKey, context);
    await this.enforceRateLimit(connection.id, context.ip, this.pollRateLimit);
    const session = await this.requireSession(connection, input.sessionToken);
    await this.touchSession(session.id);

    const cursor = this.parseCursor(input.cursor);
    const messages = await this.readMessages(
      session.lead_id,
      connection.messaging_connection_id,
      cursor,
    );
    const awaitingReply = await this.advancePendingReply(connection, session);

    return {
      messages,
      cursor: messages.length > 0 ? messages[messages.length - 1].sentAt : cursor,
      awaitingReply,
    };
  }

  async endSession(
    publicKey: string,
    context: WebsiteWidgetRequestContext,
    input: { sessionToken?: unknown },
  ) {
    const connection = await this.requireLiveConnection(publicKey, context);
    const session = await this.requireSession(connection, input.sessionToken);
    await this.closeSession(session.id, "closed");
    return { ended: true };
  }

  /**
   * Used by the CRM when an operator moves the conversation to WhatsApp, so the
   * agent stops replying into a widget the visitor can no longer see.
   */
  async endSessionsForLead(acesId: number, leadId: string, reason: "whatsapp_handoff") {
    const { error } = await this.crm
      .from("website_widget_sessions")
      .update({ status: "ended", ended_reason: reason })
      .eq("aces_id", acesId)
      .eq("lead_id", leadId)
      .eq("status", "active");
    if (error) throw mapDatabaseError(error);
    return { ended: true };
  }

  async getLiveSessionForLead(acesId: number, leadId: string, customerConversationId?: string | null) {
    let websiteConnectionId: string | null = null;
    if (customerConversationId) {
      const { data: conversation, error: conversationError } = await this.crm
        .from("customer_conversations")
        .select("connection_id")
        .eq("id", customerConversationId)
        .eq("aces_id", acesId)
        .eq("lead_id", leadId)
        .maybeSingle();
      if (conversationError) throw mapDatabaseError(conversationError);
      if (!conversation) return null;

      const { data: websiteConnection, error: websiteConnectionError } = await this.crm
        .from("website_widget_connections")
        .select("id")
        .eq("aces_id", acesId)
        .eq("messaging_connection_id", conversation.connection_id)
        .maybeSingle();
      if (websiteConnectionError) throw mapDatabaseError(websiteConnectionError);
      websiteConnectionId = typeof websiteConnection?.id === "string" ? websiteConnection.id : null;
      if (!websiteConnectionId) return null;
    }

    let query = this.crm
      .from("website_widget_sessions")
      .select("id, aces_id, connection_id, lead_id, status, last_seen_at")
      .eq("aces_id", acesId)
      .eq("lead_id", leadId)
      .eq("status", "active")
      .gte("last_seen_at", this.idleThreshold())
      .order("last_seen_at", { ascending: false })
      .limit(1);
    if (websiteConnectionId) query = query.eq("connection_id", websiteConnectionId);
    const { data, error } = await query.maybeSingle();
    if (error) throw mapDatabaseError(error);
    return (data as SessionRow | null) ?? null;
  }

  // --------------------------------------------------------------- reply retry

  private async advancePendingReply(connection: ConnectionRow, session: SessionRow) {
    const pending = await this.oldestPendingJob(session.id);
    if (!pending) return false;

    // The answer may have gone out through another channel after the session
    // went idle. Checking every channel stops a retry from answering twice.
    if (await this.hasAnswerSince(session.lead_id, connection.messaging_connection_id, pending.created_at)) {
      await this.resolvePendingJobs(session.id);
      return false;
    }

    const { data, error } = await this.crm.rpc("claim_website_widget_reply_job", {
      p_session_id: session.id,
      p_max_attempts: this.maxReplyAttempts,
      p_backoff_seconds: this.replyTimeoutSeconds,
    });
    if (error) throw mapDatabaseError(error);

    const claimed = Array.isArray(data) ? data[0] : data;
    if (claimed) {
      await this.retryReply(connection, session, claimed);
    }

    return true;
  }

  private async retryReply(
    connection: ConnectionRow,
    session: SessionRow,
    job: { id: string; inbound_message_id: string | null; attempts: number },
  ) {
    const original = job.inbound_message_id
      ? await this.readMessageContent(job.inbound_message_id)
      : null;

    if (!original) {
      await this.exhaustJob(connection, session, job.id, "Mensagem original indisponivel");
      return;
    }

    try {
      // Re-arming the existing message, never re-sending it: a second
      // processInbound would store the visitor's message twice.
      await this.agent.requeueReply(connection.aces_id, {
        leadId: session.lead_id,
        instanceName: connection.instance_name,
        messagingConnectionId: connection.messaging_connection_id,
        content: original,
        messageId: job.inbound_message_id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (job.attempts >= this.maxReplyAttempts) {
        await this.exhaustJob(connection, session, job.id, message);
        return;
      }
      await this.crm
        .from("website_widget_reply_jobs")
        .update({ last_error: message })
        .eq("id", job.id);
    }
  }

  /**
   * Last resort so the visitor is never left staring at an empty chat: record an
   * answer in the same website conversation, without changing channels.
   */
  private async exhaustJob(
    connection: ConnectionRow,
    session: SessionRow,
    jobId: string,
    reason: string,
  ) {
    await this.agent.saveAgentMessage(connection.aces_id, {
      leadId: session.lead_id,
      instanceName: connection.instance_name,
      messagingConnectionId: connection.messaging_connection_id,
      content: HANDOFF_FALLBACK,
    });
    await this.crm
      .from("website_widget_reply_jobs")
      .update({ status: "exhausted", last_error: reason })
      .eq("id", jobId);
  }

  private async resolvePendingJobs(sessionId: string) {
    const { error } = await this.crm
      .from("website_widget_reply_jobs")
      .update({ status: "answered" })
      .eq("session_id", sessionId)
      .eq("status", "pending");
    if (error) throw mapDatabaseError(error);
  }

  private async oldestPendingJob(sessionId: string) {
    const { data, error } = await this.crm
      .from("website_widget_reply_jobs")
      .select("id, created_at")
      .eq("session_id", sessionId)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    return (data as { id: string; created_at: string } | null) ?? null;
  }

  private async hasAnswerSince(leadId: string, messagingConnectionId: string, since: string) {
    const conversationId = await this.findWebsiteConversationId(leadId, messagingConnectionId);
    if (!conversationId) return false;

    const { data, error } = await this.crm
      .from("message_history")
      .select("id")
      .eq("lead_id", leadId)
      .eq("customer_conversation_id", conversationId)
      .eq("direction", "outbound")
      .gte("sent_at", since)
      .limit(1)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    return Boolean(data);
  }

  // -------------------------------------------------------------------- shared

  private idleThreshold() {
    return new Date(Date.now() - this.sessionIdleMinutes * 60_000).toISOString();
  }

  private parseCursor(value: unknown) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return new Date(0).toISOString();
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new WebsiteWidgetError(
        "cursor invalido",
        "WEBSITE_WIDGET_CURSOR_INVALID",
        400,
      );
    }
    return parsed.toISOString();
  }

  /**
   * Restricted to messages of this channel on purpose. The visitor only proved
   * they can type a phone number, so anything the business sent to that contact
   * over WhatsApp must never surface in the website chat.
   */
  private async readMessages(
    leadId: string,
    messagingConnectionId: string,
    cursor: string,
  ): Promise<WebsiteWidgetMessage[]> {
    const conversationId = await this.findWebsiteConversationId(leadId, messagingConnectionId);
    if (!conversationId) return [];

    const { data, error } = await this.crm
      .from("message_history")
      .select("id, content, direction, sent_at")
      .eq("lead_id", leadId)
      .eq("customer_conversation_id", conversationId)
      .gt("sent_at", cursor)
      .order("sent_at", { ascending: true })
      .limit(50);
    if (error) throw mapDatabaseError(error);

    return (data ?? []).map((row: any) => ({
      id: String(row.id),
      content: String(row.content ?? ""),
      direction: row.direction === "outbound" ? "outbound" : "inbound",
      sentAt: String(row.sent_at),
    }));
  }

  private async findWebsiteConversationId(leadId: string, messagingConnectionId: string) {
    const { data, error } = await this.crm
      .from("customer_conversations")
      .select("id")
      .eq("lead_id", leadId)
      .eq("connection_id", messagingConnectionId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    return typeof data?.id === "string" ? data.id : null;
  }

  private async readMessageContent(messageId: string) {
    const { data, error } = await this.crm
      .from("message_history")
      .select("content")
      .eq("id", messageId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    const content = data?.content;
    return typeof content === "string" && content.trim() ? content : null;
  }

  private async touchSession(sessionId: string) {
    const { error } = await this.crm
      .from("website_widget_sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", sessionId);
    if (error) throw mapDatabaseError(error);
  }

  private async closeSession(sessionId: string, reason: "closed" | "expired") {
    const { error } = await this.crm
      .from("website_widget_sessions")
      .update({ status: "ended", ended_reason: reason })
      .eq("id", sessionId)
      .eq("status", "active");
    if (error) throw mapDatabaseError(error);
  }

  private async requireSession(connection: ConnectionRow, token: unknown) {
    const raw = requiredText(token, "sessionToken", 200);
    const { data, error } = await this.crm
      .from("website_widget_sessions")
      .select("id, aces_id, connection_id, lead_id, status, last_seen_at")
      .eq("token_hash", hashToken(raw))
      .eq("connection_id", connection.id)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);

    const session = (data as SessionRow | null) ?? null;
    if (!session || session.status !== "active") {
      throw new WebsiteWidgetError(
        "Sessao do chat expirada",
        "WEBSITE_WIDGET_SESSION_EXPIRED",
        410,
      );
    }
    return session;
  }

  private async requireLiveConnection(
    publicKey: string,
    context: WebsiteWidgetRequestContext,
  ) {
    const key = requiredText(publicKey, "publicKey", 200);
    const { data, error } = await this.crm
      .from("website_widget_connections")
      .select("*")
      .eq("public_key", key)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);

    const connection = (data as ConnectionRow | null) ?? null;
    if (!connection) {
      throw new WebsiteWidgetError(
        "Agente de site nao encontrado",
        "WEBSITE_WIDGET_CONNECTION_NOT_FOUND",
        404,
      );
    }
    if (connection.status !== "active") {
      throw new WebsiteWidgetError(
        "Este agente de site esta pausado",
        "WEBSITE_WIDGET_CONNECTION_PAUSED",
        409,
      );
    }
    if (!isOriginAllowed(context.origin, connection.allowed_domains ?? [])) {
      throw new WebsiteWidgetError(
        "Este site nao esta autorizado a usar o agente",
        "WEBSITE_WIDGET_ORIGIN_NOT_ALLOWED",
        403,
      );
    }
    return connection;
  }

  private async enforceRateLimit(connectionId: string, ip: string | null, limit: number) {
    const { data, error } = await this.crm.rpc("consume_website_widget_rate_limit", {
      p_connection_id: connectionId,
      p_ip: ip,
      p_limit: limit,
    });
    if (error) throw mapDatabaseError(error);
    if (data === false) {
      throw new WebsiteWidgetError(
        "Muitas mensagens em pouco tempo. Tente novamente em instantes.",
        "WEBSITE_WIDGET_RATE_LIMITED",
        429,
      );
    }
  }

  // --------------------------------------------------------------------- admin

  async listConnections(acesId: number) {
    const { data, error } = await this.crm
      .from("website_widget_connections")
      .select("*")
      .eq("aces_id", acesId)
      .order("created_at", { ascending: false });
    if (error) throw mapDatabaseError(error);

    const rows = (data ?? []) as ConnectionRow[];
    const agentIds = [
      ...new Set(rows.map((row) => row.agent_id).filter((value): value is string => Boolean(value))),
    ];
    const agentsById = new Map<string, AgentRow>();
    if (agentIds.length > 0) {
      const { data: agentRows, error: agentError } = await this.agents
        .from("ai_agents")
        .select("id,aces_id,name,instance_name,agent_type,is_active")
        .eq("aces_id", acesId)
        .in("id", agentIds);
      if (agentError) throw mapDatabaseError(agentError);
      for (const agent of (agentRows ?? []) as AgentRow[]) {
        agentsById.set(agent.id, agent);
      }
    }

    return rows.map((row) =>
      this.toPublicConnection(row, row.agent_id ? (agentsById.get(row.agent_id) ?? null) : null),
    );
  }

  async createConnection(acesId: number, actorId: string, input: WebsiteWidgetAdminInput) {
    const name = requiredText(input.name, "name", 200);
    const agentId = uuid(input.agentId, "agentId");
    const agent = await this.requireAgent(acesId, agentId);
    const allowedDomains = parseAllowedDomains(input.allowedDomains);
    if (allowedDomains.length === 0) {
      throw new WebsiteWidgetError(
        "Informe ao menos um site autorizado",
        "WEBSITE_WIDGET_DOMAIN_REQUIRED",
        400,
      );
    }

    const publicKey = randomBytes(24).toString("base64url");
    const { data, error } = await this.crm
      .from("website_widget_connections")
      .insert({
        public_key: publicKey,
        aces_id: acesId,
        name,
        agent_id: agentId,
        instance_name: agent.instance_name,
        welcome_message: this.optionalText(input.welcomeMessage, 500),
        theme: this.parseTheme(input.theme),
        allowed_domains: allowedDomains,
        status: "active",
        created_by: actorId,
      })
      .select("*")
      .single();
    if (error) throw mapDatabaseError(error);

    return { connection: this.toPublicConnection(data as ConnectionRow, agent) };
  }

  async updateConnection(acesId: number, connectionId: string, input: WebsiteWidgetAdminInput) {
    const id = uuid(connectionId, "id");
    const current = await this.getConnection(acesId, id);

    const patch: Record<string, unknown> = {};
    if ("name" in input) patch.name = requiredText(input.name, "name", 200);
    if ("welcomeMessage" in input) {
      patch.welcome_message = this.optionalText(input.welcomeMessage, 500);
    }
    if ("theme" in input) patch.theme = this.parseTheme(input.theme);
    if ("allowedDomains" in input) {
      const allowedDomains = parseAllowedDomains(input.allowedDomains);
      if (allowedDomains.length === 0) {
        throw new WebsiteWidgetError(
          "Informe ao menos um site autorizado",
          "WEBSITE_WIDGET_DOMAIN_REQUIRED",
          400,
        );
      }
      patch.allowed_domains = allowedDomains;
    }
    if ("status" in input) {
      if (input.status !== "active" && input.status !== "paused") {
        throw new WebsiteWidgetError(
          "status deve ser active ou paused",
          "WEBSITE_WIDGET_STATUS_INVALID",
          400,
        );
      }
      patch.status = input.status;
    }

    let agent: AgentRow | null = null;
    if ("agentId" in input) {
      const agentId = uuid(input.agentId, "agentId");
      agent = await this.requireAgent(acesId, agentId);
      patch.agent_id = agentId;
      patch.instance_name = agent.instance_name;
    }

    if (Object.keys(patch).length === 0) {
      return this.toPublicConnection(current, await this.findAgent(acesId, current.agent_id));
    }

    const { data, error } = await this.crm
      .from("website_widget_connections")
      .update(patch)
      .eq("id", id)
      .eq("aces_id", acesId)
      .select("*")
      .single();
    if (error) throw mapDatabaseError(error);

    const row = data as ConnectionRow;
    return this.toPublicConnection(row, agent ?? (await this.findAgent(acesId, row.agent_id)));
  }

  async rotatePublicKey(acesId: number, connectionId: string) {
    const id = uuid(connectionId, "id");
    await this.getConnection(acesId, id);

    const { data, error } = await this.crm
      .from("website_widget_connections")
      .update({ public_key: randomBytes(24).toString("base64url") })
      .eq("id", id)
      .eq("aces_id", acesId)
      .select("*")
      .single();
    if (error) throw mapDatabaseError(error);

    const row = data as ConnectionRow;
    return this.toPublicConnection(row, await this.findAgent(acesId, row.agent_id));
  }

  async deleteConnection(acesId: number, connectionId: string) {
    const id = uuid(connectionId, "id");
    await this.getConnection(acesId, id);
    const { error } = await this.crm
      .from("website_widget_connections")
      .delete()
      .eq("id", id)
      .eq("aces_id", acesId);
    if (error) throw mapDatabaseError(error);
    return { deleted: true };
  }

  private async getConnection(acesId: number, id: string) {
    const { data, error } = await this.crm
      .from("website_widget_connections")
      .select("*")
      .eq("id", id)
      .eq("aces_id", acesId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    if (!data) {
      throw new WebsiteWidgetError(
        "Agente de site nao encontrado",
        "WEBSITE_WIDGET_CONNECTION_NOT_FOUND",
        404,
      );
    }
    return data as ConnectionRow;
  }

  private async findAgent(acesId: number, agentId: string | null) {
    if (!agentId) return null;
    const { data, error } = await this.agents
      .from("ai_agents")
      .select("id,aces_id,name,instance_name,agent_type,is_active")
      .eq("id", agentId)
      .eq("aces_id", acesId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    return (data as AgentRow | null) ?? null;
  }

  private async requireAgent(acesId: number, agentId: string) {
    const agent = await this.findAgent(acesId, agentId);
    if (!agent || agent.agent_type !== "primary" || !agent.instance_name?.trim()) {
      throw new WebsiteWidgetError(
        "Escolha um agente ativo com canal proprio",
        "WEBSITE_WIDGET_AGENT_UNAVAILABLE",
        409,
      );
    }
    return agent;
  }

  private optionalText(value: unknown, maxLength: number) {
    if (value === undefined || value === null || value === "") return null;
    return requiredText(value, "welcomeMessage", maxLength);
  }

  private parseTheme(value: unknown) {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new WebsiteWidgetError(
        "theme deve ser um objeto",
        "WEBSITE_WIDGET_THEME_INVALID",
        400,
      );
    }
    return value as Record<string, unknown>;
  }

  private toPublicConnection(row: ConnectionRow, agent: AgentRow | null): WebsiteWidgetConnection {
    const issue = !agent
      ? "Agente removido"
      : agent.agent_type !== "primary"
        ? "O agente nao possui canal proprio"
        : !agent.is_active
          ? "Agente inativo"
          : !agent.instance_name?.trim()
            ? "Agente sem instancia"
            : (row.allowed_domains ?? []).length === 0
              ? "Nenhum site autorizado"
              : null;

    return {
      id: row.id,
      publicKey: row.public_key,
      name: row.name,
      agentId: row.agent_id,
      agentName: agent?.name ?? null,
      instanceName: row.instance_name,
      welcomeMessage: row.welcome_message,
      theme: row.theme ?? {},
      allowedDomains: row.allowed_domains ?? [],
      status: row.status,
      ready: !issue,
      configurationIssue: issue,
      embedSnippet: embedSnippetFor(this.publicBaseUrl, this.apiBaseUrl, row.public_key),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
