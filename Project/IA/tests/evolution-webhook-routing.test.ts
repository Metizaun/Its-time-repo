import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentManager,
  decideInboundInstanceAuthorization,
  reserveIncomingMessageDedupe,
  type WebhookPayload,
} from "../sdr-agent-gemini.js";

class FakeRedis {
  private readonly values = new Map<string, string>();

  async set(key: string, value: string) {
    if (this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async eval(
    _script: string,
    _numberOfKeys: number,
    key: string,
    token: string,
  ) {
    if (this.values.get(key) !== token) return 0;
    this.values.delete(key);
    return 1;
  }
}

type DedupeRedis = Parameters<typeof reserveIncomingMessageDedupe>[0];

test("inbound verificado autoriza uma segunda instancia sem trocar a principal", async () => {
  const memberships: Array<Record<string, unknown>> = [];
  const savedMessages: Array<Record<string, unknown>> = [];
  const queuedMessages: Array<Record<string, unknown>> = [];
  const existingLead = {
    id: "43ed926a-7f5f-44a7-aea2-73939e288c15",
    aces_id: 5,
    instancia: "cobranca",
    interaction_mode: "auto",
  };
  const clara = { id: "51000000-0000-0000-0000-000000000001" };
  const manager: any = Object.create(AgentManager.prototype);

  manager.redis = new FakeRedis();
  manager.instancePhoneAllowlists = {};
  manager.resolveInstanceForEvolutionWebhook = async () => ({
    instancia: "comercial_droculos",
    aces_id: 5,
  });
  manager.findMessageByProviderMessageId = async () => null;
  manager.getAnyAgentByInstance = async () => clara;
  manager.findLeadByPhone = async () => existingLead;
  manager.hasActiveLeadInstanceMembership = async () => false;
  manager.serviceClient = {
    from(table: string) {
      assert.equal(table, "lead_instance_memberships");
      return {
        async upsert(row: Record<string, unknown>) {
          memberships.push(row);
          return { error: null };
        },
      };
    },
  };
  manager.shouldAnalyzeOpticsImage = async () => false;
  manager.normalizeInboundContent = async () => "Olá";
  manager.findOrCreateLead = async () => existingLead;
  manager.saveMessage = async (row: Record<string, unknown>) => {
    savedMessages.push(row);
    return { id: "51000000-0000-0000-0000-000000000002" };
  };
  manager.tryPersistWebhookMediaAttachment = async () => undefined;
  manager.resolveLeadAiState = async () => ({
    enabled: true,
    bypassingGlobalInactive: false,
  });
  manager.getLeadPipelineAiSettings = async () => ({ replyEnabled: true });
  manager.upsertLeadState = async () => undefined;
  manager.queueBufferedProcessing = async (
    _agent: unknown,
    _leadId: string,
    message: Record<string, unknown>,
  ) => {
    queuedMessages.push(message);
  };

  const payload: WebhookPayload = {
    event: "messages.upsert",
    instance: "comercial_droculos",
    data: {
      key: {
        remoteJid: "554199031152@s.whatsapp.net",
        fromMe: false,
        id: "3EB022A0AFD690F9A6F85F",
      },
      pushName: "lucas teste",
      message: { conversation: "Olá" },
      messageTimestamp: 1_765_721_964,
    },
  };

  const result = await manager.processEvolutionWebhook(payload);

  assert.equal(result.success, true);
  assert.equal(result.queued, true);
  assert.equal(result.agentId, clara.id);
  assert.equal(existingLead.instancia, "cobranca");
  assert.equal(savedMessages.length, 1);
  assert.equal(savedMessages[0]?.direction, "inbound");
  assert.equal(savedMessages[0]?.instanceName, "comercial_droculos");
  assert.equal(queuedMessages.length, 1);
  assert.deepEqual(memberships, [
    {
      aces_id: 5,
      lead_id: existingLead.id,
      instance_name: "comercial_droculos",
      source_agent_id: null,
      reason: "verified_inbound:evolution",
      is_active: true,
      revoked_at: null,
      authorized_at: memberships[0]?.authorized_at,
    },
  ]);
  assert.equal(typeof memberships[0]?.authorized_at, "string");
});

test("decisao de roteamento so cria membership quando ela ainda nao existe", () => {
  assert.deepEqual(
    decideInboundInstanceAuthorization({
      hasExistingLead: true,
      leadPrimaryInstance: "cobranca",
      inboundInstance: "comercial_droculos",
      hasActiveMembership: false,
    }),
    { authorized: true, shouldUpsertMembership: true },
  );

  assert.deepEqual(
    decideInboundInstanceAuthorization({
      hasExistingLead: true,
      leadPrimaryInstance: "cobranca",
      inboundInstance: "comercial_droculos",
      hasActiveMembership: true,
    }),
    { authorized: true, shouldUpsertMembership: false },
  );
});

test("falha libera a reserva; sucesso continua bloqueando repeticoes", async () => {
  const redis = new FakeRedis() as unknown as DedupeRedis;
  const first = await reserveIncomingMessageDedupe(
    redis,
    "provider-message-1",
    "scope",
  );
  assert.equal(first.duplicated, false);

  const concurrent = await reserveIncomingMessageDedupe(
    redis,
    "provider-message-1",
    "scope",
  );
  assert.equal(concurrent.duplicated, true);

  await first.release();
  const retryAfterFailure = await reserveIncomingMessageDedupe(
    redis,
    "provider-message-1",
    "scope",
  );
  assert.equal(retryAfterFailure.duplicated, false);

  const thirdDeliveryAfterSuccess = await reserveIncomingMessageDedupe(
    redis,
    "provider-message-1",
    "scope",
  );
  assert.equal(thirdDeliveryAfterSuccess.duplicated, true);
});
