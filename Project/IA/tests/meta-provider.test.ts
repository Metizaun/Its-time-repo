import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

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

test("converte contrato neutro em componentes body e header da Meta", async () => {
  const originalPost = axios.post;
  let sentBody: any = null;
  axios.post = (async (_url: string, body: unknown) => {
    sentBody = body;
    return { data: { messages: [{ id: "wamid.test" }] } };
  }) as typeof axios.post;
  try {
    const provider = new MetaWhatsAppProvider({
      mode: "live",
      graphApiVersion: "v20.0",
      resolveChannel: async (instanceName) => ({
        instanceName,
        phoneNumberId: "123",
        accessTokenSecretRef: "META_TEST_TOKEN",
      }),
      resolveSecret: async () => "token",
    });
    await provider.sendTemplate({
      instanceName: "meta-demo",
      to: "11999999999",
      templateId: "provider-id",
      templateName: "retomada",
      languageCode: "pt_BR",
      bodyParameters: ["Mensagem criada pela IA"],
      headerMedia: { kind: "image", url: "https://cdn.example.com/image.png" },
      sourceType: "automation",
    });
    assert.deepEqual(sentBody.template.components, [
      { type: "header", parameters: [{ type: "image", image: { link: "https://cdn.example.com/image.png" } }] },
      { type: "body", parameters: [{ type: "text", text: "Mensagem criada pela IA" }] },
    ]);
  } finally {
    axios.post = originalPost;
  }
});
