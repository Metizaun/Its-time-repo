import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

import { MetaWhatsAppProvider } from "../meta-whatsapp-provider.js";

test("bloqueia outbound Meta quando a flag do ambiente esta desligada", async () => {
  const provider = new MetaWhatsAppProvider({
    mode: "mock",
    graphApiVersion: "v20.0",
    outboundEnabled: false,
    resolveChannel: async () => null,
  });

  await assert.rejects(
    provider.sendText({
      acesId: 1,
      instanceName: "meta-demo",
      to: "11999999999",
      text: "Teste",
      sourceType: "manual",
    }),
    /Envio Meta WhatsApp desabilitado/,
  );
});

test("envia audio pelo provider Meta em modo mock", async () => {
  let resolvedAcesId: number | null = null;
  const provider = new MetaWhatsAppProvider({
    mode: "mock",
    graphApiVersion: "v20.0",
    resolveChannel: async (instanceName, acesId) => {
      resolvedAcesId = acesId;
      return {
        instanceName,
      phoneNumberId: null,
      accessTokenSecretRef: null,
      };
    },
  });

  const result = await provider.sendVoiceNote({
    acesId: 42,
    instanceName: "meta-demo",
    to: "11999999999",
    mediaUrl: "https://example.com/audio.mp3",
    sourceType: "ai",
  });

  assert.equal(result.provider, "meta");
  assert.equal(resolvedAcesId, 42);
  assert.equal(result.providerStatus, "accepted");
  assert.match(result.providerMessageId ?? "", /^mock_wamid_/);
  assert.deepEqual(result.raw, {
    mode: "mock",
    kind: "audio",
    instanceName: "meta-demo",
    to: "5511999999999",
  });
});

test("envia texto Meta pelo phone_number_id do tenant e persiste o wamid retornado", async () => {
  const originalPost = axios.post;
  const calls: Array<{ url: string; body: unknown; config: unknown }> = [];
  axios.post = (async (url: string, body: unknown, config: unknown) => {
    calls.push({ url, body, config });
    return { data: { messages: [{ id: "wamid.meta-123" }] } };
  }) as typeof axios.post;

  try {
    const provider = new MetaWhatsAppProvider({
      mode: "live",
      graphApiVersion: "v25.0",
      outboundEnabled: true,
      resolveChannel: async (instanceName, acesId) => {
        assert.equal(instanceName, "meta-prod");
        assert.equal(acesId, 99);
        return {
          instanceName,
          phoneNumberId: "phone-number-99",
          accessTokenSecretRef: "META_TEST_TOKEN",
        };
      },
      resolveSecret: (secretRef) => secretRef === "META_TEST_TOKEN" ? "token-meta-test" : null,
    });

    const result = await provider.sendText({
      acesId: 99,
      instanceName: "meta-prod",
      to: "11999999999",
      text: "Mensagem Meta",
      sourceType: "manual",
    });

    assert.equal(calls[0]?.url, "https://graph.facebook.com/v25.0/phone-number-99/messages");
    assert.deepEqual(calls[0]?.body, {
      messaging_product: "whatsapp",
      to: "5511999999999",
      type: "text",
      text: { body: "Mensagem Meta", preview_url: false },
    });
    assert.deepEqual(calls[0]?.config, {
      headers: {
        Authorization: "Bearer token-meta-test",
        "Content-Type": "application/json",
      },
    });
    assert.equal(result.provider, "meta");
    assert.equal(result.providerMessageId, "wamid.meta-123");
    assert.equal(result.providerStatus, "accepted");
  } finally {
    axios.post = originalPost;
  }
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
      acesId: 1,
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

test("exige tenant para qualquer envio Meta", async () => {
  let resolveCalls = 0;
  const provider = new MetaWhatsAppProvider({
    mode: "mock",
    graphApiVersion: "v25.0",
    resolveChannel: async () => {
      resolveCalls += 1;
      return null;
    },
  });

  await assert.rejects(
    provider.sendText({
      acesId: 0,
      instanceName: "meta-demo",
      to: "11999999999",
      text: "Sem tenant",
      sourceType: "manual",
    }),
    /Tenant obrigatorio para enviar pela Meta/,
  );
  assert.equal(resolveCalls, 0);
});
