import assert from "node:assert/strict";
import test from "node:test";

import {
  MessagingChannelResolver,
  parseMessagingChannelBinding,
} from "../messaging-channel-resolver.js";
import { MessagingChannelConfigurationError } from "../messaging-channel.js";

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
