import assert from "node:assert/strict";
import test from "node:test";

import { SecretCipher as CollectionSecretCipher } from "../collections/secret-cipher.js";
import { CollectionWebhookAuthError, signCollectionWebhook, verifyCollectionWebhook } from "../collections/webhook-security.js";
import { AesGcmSecretCipher } from "../integrations/secret-cipher.js";
import { isPublicIpAddress, resolvePublicWebhookTarget, UnsafeWebhookUrlError } from "../integrations/safe-webhook-url.js";
import { signWebhook, verifyWebhook, WebhookAuthError } from "../integrations/webhook-security.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64url");

test("AES-256-GCM cifra com IV aleatorio e autentica alteracoes", () => {
  const cipher = new AesGcmSecretCipher(encryptionKey, "v1", "TEST_KEY", "TEST_VERSION");
  const first = cipher.encrypt("agenda-secret");
  const second = cipher.encrypt("agenda-secret");
  assert.notDeepEqual(first.iv, second.iv);
  assert.equal(cipher.decrypt(first), "agenda-secret");
  const tampered = { ...first, authTag: Buffer.from(first.authTag) };
  tampered.authTag[0] = (tampered.authTag[0] ?? 0) ^ 1;
  assert.throws(() => cipher.decrypt(tampered));
});

test("wrapper de cobrancas permanece compativel com a cifra compartilhada", () => {
  const cipher = new CollectionSecretCipher(encryptionKey, "v1");
  assert.equal(cipher.decrypt(cipher.encrypt("collection-secret")), "collection-secret");
});

test("HMAC usa timestamp.rawBody e aceita segredo anterior", () => {
  const timestamp = "1789137000";
  const rawBody = Buffer.from('{"eventId":"test"}');
  const signature = signWebhook("previous", timestamp, rawBody);
  assert.equal(verifyWebhook({
    rawBody, timestamp, signature, secrets: ["current", "previous"], nowMs: Number(timestamp) * 1000,
  }), true);
});

test("HMAC rejeita replay e mudanca de um byte", () => {
  const timestamp = "1789137000";
  const signature = signWebhook("secret", timestamp, "body");
  assert.throws(
    () => verifyWebhook({ rawBody: Buffer.from("body"), timestamp, signature, secrets: ["secret"], nowMs: Number(timestamp) * 1000 + 301_000 }),
    (error: unknown) => error instanceof WebhookAuthError && error.code === "replay_window_exceeded",
  );
  assert.throws(
    () => verifyWebhook({ rawBody: Buffer.from("Body"), timestamp, signature, secrets: ["secret"], nowMs: Number(timestamp) * 1000 }),
    (error: unknown) => error instanceof WebhookAuthError && error.code === "invalid_signature",
  );
});

test("wrapper HMAC de cobrancas preserva erros publicos existentes", () => {
  const timestamp = "1789137000";
  const signature = signCollectionWebhook("secret", timestamp, "body");
  assert.throws(
    () => verifyCollectionWebhook({ rawBody: Buffer.from("changed"), timestamp, signature, secrets: ["secret"], nowMs: Number(timestamp) * 1000 }),
    (error: unknown) => error instanceof CollectionWebhookAuthError && error.code === "invalid_signature",
  );
});

test("classificacao de IP bloqueia faixas privadas e reservadas", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "100.64.0.1", "169.254.1.1", "172.20.1.1", "192.168.1.1", "::1", "fc00::1", "fe80::1", "2001:db8::1"]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("URL segura exige HTTPS sem credencial, fragmento ou host local", async () => {
  const lookup = async () => [{ address: "8.8.8.8", family: 4 }];
  await assert.rejects(() => resolvePublicWebhookTarget("http://partner.example/events", { lookup }), UnsafeWebhookUrlError);
  await assert.rejects(() => resolvePublicWebhookTarget("https://user:pass@partner.example/events", { lookup }), UnsafeWebhookUrlError);
  await assert.rejects(() => resolvePublicWebhookTarget("https://partner.example/events#secret", { lookup }), UnsafeWebhookUrlError);
  await assert.rejects(() => resolvePublicWebhookTarget("https://api.internal/events", { lookup }), UnsafeWebhookUrlError);
});

test("resolucao DNS rejeita resposta privada ou mista", async () => {
  await assert.rejects(
    () => resolvePublicWebhookTarget("https://partner.example/events", { lookup: async () => [{ address: "10.0.0.8", family: 4 }] }),
    (error: unknown) => error instanceof UnsafeWebhookUrlError && error.code === "private_address",
  );
  await assert.rejects(
    () => resolvePublicWebhookTarget("https://partner.example/events", { lookup: async () => [
      { address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 },
    ] }),
    (error: unknown) => error instanceof UnsafeWebhookUrlError && error.code === "private_address",
  );
});

test("resolucao DNS publica retorna enderecos que o worker podera fixar", async () => {
  const resolved = await resolvePublicWebhookTarget("https://partner.example/events", {
    lookup: async () => [
      { address: "8.8.8.8", family: 4 }, { address: "2606:4700:4700::1111", family: 6 },
    ],
  });
  assert.equal(resolved.url.toString(), "https://partner.example/events");
  assert.equal(resolved.addresses.length, 2);
});

test("falha de resolucao DNS e convertida em erro seguro", async () => {
  await assert.rejects(
    () => resolvePublicWebhookTarget("https://partner.example/events", {
      lookup: async () => { throw new Error("ENOTFOUND"); },
    }),
    (error: unknown) => error instanceof UnsafeWebhookUrlError && error.code === "dns_failed",
  );
});
