import assert from "node:assert/strict";
import test from "node:test";

import { MetaWhatsAppProvider } from "../meta-whatsapp-provider.js";

test("envia audio pelo provider Meta em modo mock", async () => {
  const provider = new MetaWhatsAppProvider({
    mode: "mock",
    graphApiVersion: "v20.0",
    resolveChannel: async (instanceName) => ({
      instanceName,
      phoneNumberId: null,
      accessTokenSecretRef: null,
    }),
  });

  const result = await provider.sendVoiceNote({
    instanceName: "meta-demo",
    to: "11999999999",
    mediaUrl: "https://example.com/audio.mp3",
    sourceType: "ai",
  });

  assert.equal(result.provider, "meta");
  assert.equal(result.providerStatus, "accepted");
  assert.match(result.providerMessageId ?? "", /^mock_wamid_/);
  assert.deepEqual(result.raw, {
    mode: "mock",
    kind: "audio",
    instanceName: "meta-demo",
    to: "5511999999999",
  });
});
