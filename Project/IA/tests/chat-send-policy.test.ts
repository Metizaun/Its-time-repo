import assert from "node:assert/strict";
import test from "node:test";

import { buildChatSendPolicy } from "../chat-send-policy.js";

const EVALUATED_AT = new Date("2026-07-20T18:00:00.000Z");

test("mantem texto livre na Gupshup antes de completar 24 horas", () => {
  const policy = buildChatSendPolicy(
    "gupshup",
    "2026-07-19T18:00:00.001Z",
    EVALUATED_AT,
  );

  assert.equal(policy.mode, "freeform");
  assert.equal(policy.remainingMs, 1);
  assert.equal(policy.windowExpiresAt, "2026-07-20T18:00:00.001Z");
});

test("exige template na Gupshup ao completar exatamente 24 horas", () => {
  const policy = buildChatSendPolicy(
    "gupshup",
    "2026-07-19T18:00:00.000Z",
    EVALUATED_AT,
  );

  assert.equal(policy.mode, "template_required");
  assert.equal(policy.remainingMs, 0);
});

test("exige template na Gupshup quando nao existe inbound valido", () => {
  assert.equal(
    buildChatSendPolicy("gupshup", null, EVALUATED_AT).mode,
    "template_required",
  );
  assert.equal(
    buildChatSendPolicy("gupshup", "data-invalida", EVALUATED_AT).mode,
    "template_required",
  );
  assert.equal(
    buildChatSendPolicy("gupshup", "2026-07-20T18:01:00.000Z", EVALUATED_AT)
      .mode,
    "template_required",
  );
});

test("nao aplica a janela Gupshup aos demais provedores", () => {
  for (const provider of ["evolution", "meta"] as const) {
    const policy = buildChatSendPolicy(provider, null, EVALUATED_AT);
    assert.equal(policy.mode, "freeform");
    assert.equal(policy.remainingMs, null);
  }
});

test("Instagram permite texto comum antes de completar 24 horas", () => {
  const policy = buildChatSendPolicy(
    "instagram",
    "2026-07-19T18:00:00.001Z",
    EVALUATED_AT,
  );

  assert.equal(policy.mode, "freeform");
  assert.equal(policy.supportsAttachments, true);
  assert.deepEqual(policy.supportedAttachmentKinds, ["image", "audio"]);
  assert.equal(policy.remainingMs, 1);
  assert.equal(policy.windowExpiresAt, "2026-07-26T18:00:00.001Z");
});

test("Instagram usa atendimento humano entre 24 horas e 7 dias sem alterar a regra Gupshup", () => {
  const policy = buildChatSendPolicy(
    "instagram",
    "2026-07-19T18:00:00.000Z",
    EVALUATED_AT,
  );

  assert.equal(policy.mode, "human_agent");
  assert.equal(policy.supportsAttachments, true);
  assert.deepEqual(policy.supportedAttachmentKinds, ["image", "audio"]);
  assert.equal(policy.remainingMs, 6 * 24 * 60 * 60 * 1000);
  assert.equal(policy.windowExpiresAt, "2026-07-26T18:00:00.000Z");
  assert.equal(buildChatSendPolicy("gupshup", "2026-07-19T18:00:00.000Z", EVALUATED_AT).mode, "template_required");
});

test("Instagram fecha o composer sem inbound valido ou apos 7 dias", () => {
  assert.equal(buildChatSendPolicy("instagram", null, EVALUATED_AT).mode, "closed");
  assert.equal(
    buildChatSendPolicy("instagram", "2026-07-13T18:00:00.000Z", EVALUATED_AT).mode,
    "closed",
  );
});

test("documentos continuam bloqueados apenas no Instagram", () => {
  const instagram = buildChatSendPolicy("instagram", "2026-07-20T17:00:00.000Z", EVALUATED_AT);
  const evolution = buildChatSendPolicy("evolution", null, EVALUATED_AT);
  assert.equal(instagram.supportedAttachmentKinds.includes("document"), false);
  assert.equal(evolution.supportedAttachmentKinds.includes("document"), true);
});
