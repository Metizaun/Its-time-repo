import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseEvolutionWebhookPayload,
  resolveWebhookContactIdentity,
  type WebhookPayload,
} from "../sdr-agent-gemini.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readFixture(name: string): WebhookPayload {
  const fixturePath = path.join(__dirname, "../fixtures/evolution", name);
  return JSON.parse(readFileSync(fixturePath, "utf8")) as WebhookPayload;
}

test("payload legado com @s.whatsapp.net continua resolvendo o telefone", () => {
  const payload = readFixture("webhook-phone-jid.json");
  const parsed = parseEvolutionWebhookPayload(payload);

  assert.equal(parsed.phone, "555191234567");
  assert.equal(parsed.conversationId, "555191234567@s.whatsapp.net");
});

test("quando remoteJid vier com @lid, senderPn tem prioridade", () => {
  const payload = readFixture("webhook-lid-sender-pn.json");
  const identity = resolveWebhookContactIdentity(payload);
  const parsed = parseEvolutionWebhookPayload(payload);

  assert.equal(identity.phone, "555193269431");
  assert.equal(identity.usedField, "senderPn");
  assert.equal(parsed.phone, "555193269431");
  assert.equal(parsed.conversationId, "103899771998284@lid");
});

test("participantPn resolve o telefone quando senderPn nao vier", () => {
  const payload = readFixture("webhook-lid-participant-pn.json");
  const identity = resolveWebhookContactIdentity(payload);
  const parsed = parseEvolutionWebhookPayload(payload);

  assert.equal(identity.phone, "555191112222");
  assert.equal(identity.usedField, "participantPn");
  assert.equal(parsed.phone, "555191112222");
});

test("remoteJidAlt phone-based e usado quando nao houver senderPn ou participantPn", () => {
  const payload = readFixture("webhook-lid-remote-jid-alt.json");
  const identity = resolveWebhookContactIdentity(payload);
  const parsed = parseEvolutionWebhookPayload(payload);

  assert.equal(identity.phone, "555198887777");
  assert.equal(identity.usedField, "remoteJidAlt");
  assert.equal(parsed.phone, "555198887777");
});

test("payload com apenas @lid nao devolve telefone e preserva estado de lidOnly", () => {
  const payload = readFixture("webhook-lid-unresolved.json");
  const identity = resolveWebhookContactIdentity(payload);
  const parsed = parseEvolutionWebhookPayload(payload);

  assert.equal(identity.phone, null);
  assert.equal(identity.lidOnly, true);
  assert.equal(parsed.phone, null);
  assert.equal(parsed.conversationId, "403899771998284@lid");
  assert.equal(parsed.raw.senderLid, "403899771998284@lid");
});

test("entrada de anuncio com pushName nulo continua resolvendo o PN real", () => {
  const payload = readFixture("webhook-lid-ad-entry.json");
  const parsed = parseEvolutionWebhookPayload(payload);

  assert.equal(parsed.phone, "555194445555");
  assert.equal(parsed.pushName, null);
  assert.equal(parsed.content, "Oi, vi o anuncio");
});
