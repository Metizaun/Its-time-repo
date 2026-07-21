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
