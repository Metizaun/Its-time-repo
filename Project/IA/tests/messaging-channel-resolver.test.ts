import assert from "node:assert/strict";
import test from "node:test";

import {
  MessagingChannelResolver,
  parseMessagingChannelBinding,
} from "../messaging-channel-resolver.js";
import { MessagingChannelConfigurationError } from "../messaging-channel.js";
import { MessagingDispatcher } from "../messaging-dispatcher.js";

test("normaliza bindings dos quatro providers sem fallback", () => {
  for (const provider of ["evolution", "meta", "gupshup"] as const) {
    const binding = parseMessagingChannelBinding({
      id: `channel-${provider}`,
      aces_id: 1,
      instance_name: `instance-${provider}`,
      channel_type: "whatsapp",
      provider,
      capability: "full",
      status: "active",
    });
    assert.equal(binding.provider, provider);
  }

  const instagram = parseMessagingChannelBinding({
    id: "channel-instagram",
    aces_id: 1,
    instance_name: "instance-instagram",
    channel_type: "instagram",
    provider: "instagram",
    capability: "manual_only",
    status: "active",
  });
  assert.equal(instagram.provider, "instagram");
});

test("rejeita provider ausente ou incompatível em vez de usar Evolution", () => {
  for (const row of [
    {
      id: "missing-provider",
      aces_id: 1,
      instance_name: "missing-provider",
      channel_type: "whatsapp",
      capability: "full",
      status: "active",
    },
    {
      id: "invalid-pair",
      aces_id: 1,
      instance_name: "invalid-pair",
      channel_type: "instagram",
      provider: "evolution",
      capability: "manual_only",
      status: "active",
    },
  ]) {
    assert.throws(
      () => parseMessagingChannelBinding(row),
      (error: unknown) =>
        error instanceof MessagingChannelConfigurationError &&
        error.code === "INVALID_CHANNEL_CONFIGURATION"
    );
  }
});

test("resolver WhatsApp bloqueia um binding Instagram antes do provider", async () => {
  const row = {
    id: "channel-instagram",
    aces_id: 7,
    instance_name: "instagram-test",
    channel_type: "instagram",
    provider: "instagram",
    capability: "manual_only",
    status: "active",
  };
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  const client = { from: () => query } as any;
  const resolver = new MessagingChannelResolver(client);

  await assert.rejects(
    resolver.resolveWhatsAppProvider(7, "instagram-test"),
    (error: unknown) =>
      error instanceof MessagingChannelConfigurationError &&
      error.code === "CHANNEL_TYPE_MISMATCH"
  );
});

test("dispatcher roteia Meta sem fallback para Evolution e propaga o tenant", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const metaProvider = {
    sendText: async (input: Record<string, unknown>) => {
      calls.push(input);
      return {
        provider: "meta" as const,
        providerMessageId: "wamid.dispatcher-test",
        providerStatus: "accepted" as const,
        raw: { provider: "meta" },
      };
    },
  };
  const dispatcher = new MessagingDispatcher(
    {
      resolve: async (acesId: number, instanceName: string) => ({
        id: "meta-binding",
        acesId,
        instanceName,
        channelType: "whatsapp" as const,
        provider: "meta" as const,
        capability: "full" as const,
        status: "active" as const,
      }),
    } as any,
    {
      getProvider: (providerName: string) => {
        assert.equal(providerName, "meta");
        return metaProvider;
      },
    } as any,
    null,
  );

  const result = await dispatcher.dispatchText({
    acesId: 22,
    instanceName: "meta-pilot",
    leadId: "lead-1",
    phone: "11999999999",
    text: "Teste de roteamento",
    source: "ai",
  });

  assert.equal(result.provider, "meta");
  assert.equal(result.providerMessageId, "wamid.dispatcher-test");
  assert.equal(calls[0]?.acesId, 22);
  assert.equal(calls[0]?.instanceName, "meta-pilot");
  assert.equal(calls[0]?.sourceType, "ai");
});
