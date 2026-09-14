import { type SupabaseClient } from "@supabase/supabase-js";

import { AgendaContractError, agendaPayloadHash, parseAgendaInboundEnvelope } from "./contract.js";
import { AgendaConnectionService } from "./connection-service.js";
import { verifyWebhook, WebhookAuthError } from "../integrations/webhook-security.js";

type InboundConnection = { id: string; aces_id: number; status: string };

export class AgendaInboundError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AgendaInboundError";
  }
}

function uuidHeader(value: string | undefined) {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function publicConnectionId(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{48}$/.test(normalized)) {
    throw new AgendaInboundError("Conexao ou assinatura invalida", "invalid_connection", 401);
  }
  return normalized;
}

export class AgendaInboundService {
  private readonly agenda: SupabaseClient<any, "agenda_sync", any>;

  constructor(private readonly connections: AgendaConnectionService) {
    this.agenda = connections.agenda;
  }

  async process(input: {
    publicConnectionId: string;
    rawBody: Buffer;
    idempotencyKey?: string;
    timestamp?: string;
    signature?: string;
    clientIp?: string;
  }) {
    const publicId = publicConnectionId(input.publicConnectionId);
    const connection = await this.resolveConnection(publicId);
    if (!connection) {
      throw new AgendaInboundError("Conexao ou assinatura invalida", "invalid_connection", 401);
    }
    const { data: withinLimit, error: limitError } = await this.agenda.rpc("consume_inbound_rate_limit", {
      p_aces_id: connection.aces_id,
      p_connection_id: connection.id,
      p_ip: input.clientIp ?? "unknown",
      p_limit: Math.min(Math.max(Number(process.env.AGENDA_INBOUND_RATE_LIMIT_PER_MINUTE ?? 120), 1), 10_000),
    });
    if (limitError) {
      throw new AgendaInboundError("Falha ao validar limite de requisicoes", "inbound_processing_failed", 500);
    }
    if (!withinLimit) {
      throw new AgendaInboundError("Limite de requisicoes excedido", "rate_limit_exceeded", 429);
    }
    const secrets = await this.connections.getCredentialSecrets(connection.aces_id, connection.id, "inbound");
    if (!secrets.length) {
      throw new AgendaInboundError("Conexao ou assinatura invalida", "invalid_connection", 401);
    }
    try {
      verifyWebhook({
        rawBody: input.rawBody,
        timestamp: input.timestamp,
        signature: input.signature,
        secrets,
      });
    } catch (error) {
      if (error instanceof WebhookAuthError) {
        throw new AgendaInboundError(error.message, error.code, 401);
      }
      throw error;
    }
    if (connection.status !== "active") {
      throw new AgendaInboundError("Conexao temporariamente indisponivel", "connection_unavailable", 503);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody.toString("utf8"));
    } catch {
      throw new AgendaInboundError("JSON invalido", "invalid_json", 400);
    }

    let parsed;
    try {
      parsed = parseAgendaInboundEnvelope(payload);
    } catch (error) {
      if (error instanceof AgendaContractError) {
        throw new AgendaInboundError(error.message, error.code, 400, { field: error.field ?? null });
      }
      throw error;
    }
    const rawEventId = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).eventId
      : undefined;
    const idempotencyKey = input.idempotencyKey;
    if (!uuidHeader(idempotencyKey) || idempotencyKey !== rawEventId) {
      throw new AgendaInboundError(
        "Idempotency-Key deve ser igual ao eventId",
        "invalid_idempotency_key",
        400,
      );
    }

    const resource = parsed.kind === "known" ? parsed.envelope.resource : null;
    const { data, error } = await this.agenda.rpc("process_inbound_event", {
      p_public_connection_id: publicId,
      p_event_id: parsed.envelope.eventId,
      p_event_type: parsed.envelope.eventType,
      p_payload_hash: agendaPayloadHash(payload),
      p_appointment_id: resource?.appointmentId ?? null,
      p_base_resource_version: resource?.baseResourceVersion ?? null,
      p_status: resource?.status ?? null,
      p_reason: resource?.reason ?? null,
      p_reported_at: resource?.reportedAt ?? null,
      p_metadata: resource?.metadata ?? {},
    });
    if (error) throw new AgendaInboundError("Falha ao processar evento", "inbound_processing_failed", 500);
    const response = data as Record<string, unknown> | null;
    if (!response || typeof response.responseStatus !== "number") {
      throw new AgendaInboundError("Resposta transacional invalida", "inbound_processing_failed", 500);
    }
    const { responseStatus, ...rawResponseBody } = response;
    const body = responseStatus === 200 && rawResponseBody.ignored === true
      ? { accepted: false, ...rawResponseBody }
      : responseStatus >= 400 && typeof rawResponseBody.error !== "string"
        ? { error: "Evento da Agenda nao foi aceito", ...rawResponseBody }
        : rawResponseBody;
    return { status: responseStatus, body };
  }

  private async resolveConnection(publicId: string): Promise<InboundConnection | null> {
    const { data, error } = await this.agenda.from("connections")
      .select("id,aces_id,status").eq("public_id", publicId).maybeSingle();
    if (error) throw new AgendaInboundError("Falha ao localizar conexao", "inbound_processing_failed", 500);
    return data as InboundConnection | null;
  }
}
