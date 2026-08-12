import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExternalForwardingNotification,
  shouldFreezeAfterHandoff,
} from "../sdr-agent-gemini.js";

test("encaminhamento externo monta a notificacao com os dados do lead", () => {
  const notification = buildExternalForwardingNotification({
    agentName: "Silvana - Oticas Cardeal",
    destinationName: "Gerente Santa Cruz",
    leadName: "Maria",
    leadPhone: "5599999999999",
    reason: "Cliente pediu apoio do gerente.",
    summary: "Cliente quer confirmar uma condicao comercial.",
  });

  assert.match(notification, /Novo lead encaminhado/);
  assert.match(notification, /Lead: Maria/);
  assert.match(notification, /WhatsApp do lead: 5599999999999/);
  assert.match(notification, /Cliente pediu apoio do gerente/);
});

test("encaminhamento externo nunca congela o lead", () => {
  assert.equal(
    shouldFreezeAfterHandoff(true, {
      triggered: true,
      mode: "external_notification",
    }),
    false,
  );
  assert.equal(
    shouldFreezeAfterHandoff(false, {
      triggered: false,
      mode: "external_notification",
    }),
    false,
  );
});

test("demais handoffs preservam o comportamento de pausa", () => {
  assert.equal(
    shouldFreezeAfterHandoff(false, {
      triggered: true,
      mode: "internal_company",
    }),
    true,
  );
  assert.equal(
    shouldFreezeAfterHandoff(true, {
      triggered: false,
      mode: null,
    }),
    true,
  );
});
