import assert from "node:assert/strict";
import test from "node:test";

import { AgendaInboundError, AgendaInboundService } from "../agenda-sync/inbound-service.js";
import { signWebhook } from "../integrations/webhook-security.js";

const publicId = "a".repeat(48);
const connectionId = "99747000-0000-4000-8000-000000000001";
const eventId = "a9749000-0000-4000-8000-000000000001";
const appointmentId = "99748000-0000-4000-8000-000000000001";
const secret = "inbound-secret-for-tests";

function envelope(eventType = "appointment.status_reported") {
  return {
    schemaVersion: "1.0",
    eventId,
    eventType,
    occurredAt: "2026-09-12T16:00:00.000Z",
    resource: eventType === "appointment.status_reported" ? {
      appointmentId,
      status: "no_show",
      reason: "Paciente nao compareceu",
      reportedAt: "2026-09-12T16:00:00.000Z",
      baseResourceVersion: 7,
      metadata: { source: "reception" },
    } : { futureField: true },
  };
}

function setup(options: { connectionStatus?: string; rpcResponse?: Record<string, unknown>; withinRateLimit?: boolean } = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const rateCalls: Array<Record<string, unknown>> = [];
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() {
      return {
        data: { id: connectionId, aces_id: 9974, status: options.connectionStatus ?? "active" },
        error: null,
      };
    },
  };
  const agenda = {
    from() { return query; },
    async rpc(name: string, args: Record<string, unknown>) {
      if (name === "consume_inbound_rate_limit") {
        rateCalls.push(args);
        return { data: options.withinRateLimit ?? true, error: null };
      }
      calls.push(args);
      return {
        data: options.rpcResponse ?? {
          responseStatus: 202,
          eventId,
          accepted: true,
          duplicate: false,
          resourceVersion: 8,
        },
        error: null,
      };
    },
  };
  const connections = {
    agenda,
    async getCredentialSecrets() { return [secret, "previous-secret"]; },
  };
  return {
    calls,
    rateCalls,
    service: new AgendaInboundService(connections as never),
  };
}

function signedInput(payload: unknown, idempotencyKey = eventId) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    publicConnectionId: publicId,
    rawBody,
    idempotencyKey,
    timestamp,
    signature: signWebhook(secret, timestamp, rawBody),
  };
}

test("valida assinatura e encaminha status conhecido para a transacao", async () => {
  const { service, calls } = setup();
  const result = await service.process(signedInput(envelope()));

  assert.equal(result.status, 202);
  assert.deepEqual(result.body, {
    eventId,
    accepted: true,
    duplicate: false,
    resourceVersion: 8,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].p_public_connection_id, publicId);
  assert.equal(calls[0].p_appointment_id, appointmentId);
  assert.equal(calls[0].p_base_resource_version, 7);
  assert.equal(calls[0].p_status, "no_show");
  assert.match(String(calls[0].p_payload_hash), /^[0-9a-f]{64}$/);
});

test("rejeita assinatura invalida antes de interpretar ou persistir o corpo", async () => {
  const { service, calls } = setup();
  const input = signedInput(envelope());
  input.signature = signWebhook("wrong-secret", input.timestamp, input.rawBody);

  await assert.rejects(service.process(input), (error: unknown) => {
    assert.ok(error instanceof AgendaInboundError);
    assert.equal(error.status, 401);
    assert.equal(error.code, "invalid_signature");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("exige Idempotency-Key UUID identico ao eventId", async () => {
  const { service, calls } = setup();
  const input = signedInput(envelope(), "99749000-0000-4000-8000-000000000002");

  await assert.rejects(service.process(input), (error: unknown) => {
    assert.ok(error instanceof AgendaInboundError);
    assert.equal(error.status, 400);
    assert.equal(error.code, "invalid_idempotency_key");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("evento futuro desconhecido e encaminhado sem campos de status", async () => {
  const { service, calls } = setup({
    rpcResponse: { responseStatus: 200, eventId, ignored: true, duplicate: false },
  });
  const result = await service.process(signedInput(envelope("appointment.future_event")));

  assert.equal(result.status, 200);
  assert.equal(result.body.accepted, false);
  assert.equal(result.body.ignored, true);
  assert.equal(calls[0].p_appointment_id, null);
  assert.equal(calls[0].p_status, null);
});

test("conexao pausada autentica a requisicao mas nao processa o evento", async () => {
  const { service, calls } = setup({ connectionStatus: "paused" });

  await assert.rejects(service.process(signedInput(envelope())), (error: unknown) => {
    assert.ok(error instanceof AgendaInboundError);
    assert.equal(error.status, 503);
    assert.equal(error.code, "connection_unavailable");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("comparacao do Idempotency-Key e byte a byte", async () => {
  const { service, calls } = setup();
  const payload = envelope();
  payload.eventId = eventId.toUpperCase();

  await assert.rejects(service.process(signedInput(payload, eventId)), (error: unknown) => {
    assert.ok(error instanceof AgendaInboundError);
    assert.equal(error.code, "invalid_idempotency_key");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("normaliza conflitos transacionais para o schema publico de erro", async () => {
  const { service } = setup({
    rpcResponse: {
      responseStatus: 409,
      code: "stale_resource_version",
      eventId,
      currentResourceVersion: 9,
    },
  });
  const result = await service.process(signedInput(envelope()));

  assert.equal(result.status, 409);
  assert.equal(result.body.error, "Evento da Agenda nao foi aceito");
  assert.equal(result.body.code, "stale_resource_version");
});

test("limita por conexao e IP antes de buscar ou validar o segredo", async () => {
  const { service, calls, rateCalls } = setup({ withinRateLimit: false });
  await assert.rejects(service.process({ ...signedInput(envelope()), clientIp: "203.0.113.8" }), (error: unknown) => {
    assert.ok(error instanceof AgendaInboundError);
    assert.equal(error.status, 429);
    assert.equal(error.code, "rate_limit_exceeded");
    return true;
  });
  assert.equal(calls.length, 0);
  assert.equal(rateCalls.length, 1);
  assert.equal(rateCalls[0].p_ip, "203.0.113.8");
  assert.equal(rateCalls[0].p_limit, 120);
});
