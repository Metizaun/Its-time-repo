import assert from "node:assert/strict";
import test from "node:test";

import {
  CollectionValidationError,
  validateCanonicalEnvelope,
} from "../collections/domain.js";
import {
  CollectionWebhookAuthError,
  signCollectionWebhook,
  verifyCollectionWebhook,
} from "../collections/webhook-security.js";

const connectionId = "40000000-0000-4000-8000-000000000001";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0",
    connectionId,
    ingestionId: "security-test",
    mode: "incremental",
    occurredAt: "2026-09-04T12:00:00-03:00",
    records: [{
      schemaVersion: "1.0",
      source: { connectionId, sourceUpdatedAt: "2026-09-04T12:00:00-03:00" },
      customer: { externalId: "customer-1", name: "Cliente", phone: "41999990001" },
      creditor: { externalId: "creditor-1", name: "Loja" },
      receivable: {
        externalId: "title-1", remainingAmount: "10.00", currency: "BRL",
        dueDate: "2026-09-01", status: "open",
      },
    }],
    ...overrides,
  };
}

test("webhook rejeita timestamp ou assinatura ausentes", () => {
  const rawBody = Buffer.from("{}");
  const validTimestamp = "1788534000";
  assert.throws(
    () => verifyCollectionWebhook({ rawBody, timestamp: undefined, signature: "sha256=" + "a".repeat(64), secrets: ["secret"] }),
    (error: unknown) => error instanceof CollectionWebhookAuthError && error.code === "invalid_timestamp",
  );
  assert.throws(
    () => verifyCollectionWebhook({ rawBody, timestamp: validTimestamp, signature: undefined, secrets: ["secret"], nowMs: Number(validTimestamp) * 1000 }),
    (error: unknown) => error instanceof CollectionWebhookAuthError && error.code === "missing_signature",
  );
});

test("webhook só aceita assinatura do corpo bruto e segredo dentro da janela", () => {
  const timestamp = "1788534000";
  const rawBody = Buffer.from('{"records":[]}');
  const signature = signCollectionWebhook("old-secret", timestamp, rawBody);
  assert.equal(verifyCollectionWebhook({
    rawBody, timestamp, signature, secrets: ["new-secret", "old-secret"], nowMs: Number(timestamp) * 1000,
  }), true);
  assert.throws(
    () => verifyCollectionWebhook({ rawBody, timestamp, signature, secrets: ["old-secret"], nowMs: Number(timestamp) * 1000 + 301_000 }),
    (error: unknown) => error instanceof CollectionWebhookAuthError && error.code === "replay_window_exceeded",
  );
});

test("contrato rejeita URL de pagamento insegura e metadata privilegiada", () => {
  assert.throws(
    () => validateCanonicalEnvelope({ ...envelope(), records: [{
      ...(envelope().records as Array<Record<string, unknown>>)[0],
      payment: { paymentUrl: "http://example.test/pay" },
    }] }, { expectedConnectionId: connectionId }),
    (error: unknown) => error instanceof CollectionValidationError && error.code === "invalid_payment_url",
  );
  assert.throws(
    () => validateCanonicalEnvelope({ ...envelope(), records: [{
      ...(envelope().records as Array<Record<string, unknown>>)[0],
      metadata: { lead_id: "attacker-controlled" },
    }] }, { expectedConnectionId: connectionId }),
    (error: unknown) => error instanceof CollectionValidationError && error.code === "forbidden_external_field",
  );
});

test("contrato rejeita decimal, data, status e excesso de registros", () => {
  const base = (envelope().records as Array<Record<string, unknown>>)[0];
  for (const [field, value, code] of [
    ["remainingAmount", "-1.00", "invalid_decimal"],
    ["dueDate", "01/09/2026", "invalid_date"],
    ["status", "paid", "invalid_financial_status"],
  ] as const) {
    const receivable = { ...(base.receivable as Record<string, unknown>) };
    if (field === "dueDate" || field === "status") receivable[field] = value;
    else receivable.remainingAmount = value;
    assert.throws(
      () => validateCanonicalEnvelope({ ...envelope(), records: [{ ...base, receivable }] }, { expectedConnectionId: connectionId }),
      (error: unknown) => error instanceof CollectionValidationError && error.code === code,
    );
  }
  assert.throws(
    () => validateCanonicalEnvelope({ ...envelope(), records: Array.from({ length: 3 }, () => base) }, {
      expectedConnectionId: connectionId, maxRecords: 2,
    }),
    (error: unknown) => error instanceof CollectionValidationError && error.code === "records_limit",
  );
});
