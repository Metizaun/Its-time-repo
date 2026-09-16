import assert from "node:assert/strict";
import test from "node:test";

import { parseLeadWebhookPayload } from "../lead-webhook-service.js";
import { signWebhook, verifyWebhook, WebhookAuthError } from "../integrations/webhook-security.js";

test("normaliza o payload de entrada sem colocar dados de roteamento no contrato", () => {
  const payload = parseLeadWebhookPayload({
    name: " Maria Silva ",
    phone: "+55 (11) 99999-9999",
    email: " MARIA@EXAMPLE.COM ",
    observation: " Interesse em multifocais. ",
    tags: ["multifocal", "MULTIFOCAL", "campanha-maio"],
  });

  assert.deepEqual(payload, {
    name: "Maria Silva",
    phone: "11999999999",
    email: "maria@example.com",
    observation: "Interesse em multifocais.",
    tags: ["multifocal", "campanha-maio"],
    media: null,
  });
});

test("aceita somente o contrato de imagem do webhook", () => {
  const payload = parseLeadWebhookPayload({
    name: "Maria",
    phone: "5511999999999",
    media: { type: "image", url: "https://cdn.example.com/image.webp", caption: "Produto" },
  });
  assert.deepEqual(payload.media, {
    type: "image",
    url: "https://cdn.example.com/image.webp",
    caption: "Produto",
  });
  assert.throws(
    () => parseLeadWebhookPayload({ name: "Maria", phone: "5511999999999", media: { type: "video", url: "https://example.com/a.mp4" } }),
    /somente imagens/,
  );
});

test("rejeita tentativa de informar agente ou empresa no payload", () => {
  assert.throws(
    () => parseLeadWebhookPayload({ name: "Maria", phone: "5511999999999", agentId: "outro-agente" }),
    /Campos nao permitidos no webhook/,
  );
});

test("valida assinatura HMAC com timestamp e corpo bruto", () => {
  const secret = "lead-webhook-secret";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = Buffer.from('{"name":"Maria","phone":"5511999999999"}');
  const signature = signWebhook(secret, timestamp, rawBody);

  assert.equal(verifyWebhook({ rawBody, timestamp, signature, secrets: [secret] }), true);
  const invalidSignature = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
  assert.throws(
    () => verifyWebhook({ rawBody, timestamp, signature: invalidSignature, secrets: [secret] }),
    (error: unknown) => error instanceof WebhookAuthError && error.code === "invalid_signature",
  );
});
