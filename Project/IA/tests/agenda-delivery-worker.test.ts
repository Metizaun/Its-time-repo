import assert from "node:assert/strict";
import test from "node:test";

import { isRetryableDeliveryError, isRetryableStatus, retryAt, retryDelayMs } from "../agenda-sync/delivery-worker.js";
import { UnsafeWebhookUrlError } from "../integrations/safe-webhook-url.js";

test("classifica somente falhas temporarias para retry", () => {
  for (const status of [408, 425, 429, 500, 502, 599]) assert.equal(isRetryableStatus(status), true);
  for (const status of [400, 401, 403, 404, 409, 422]) assert.equal(isRetryableStatus(status), false);
});

test("SSRF e resposta excessiva sao permanentes; rede e temporaria", () => {
  assert.equal(isRetryableDeliveryError(new UnsafeWebhookUrlError("privado", "private_address")), false);
  assert.equal(isRetryableDeliveryError(new Error("AGENDA_RESPONSE_TOO_LARGE")), false);
  assert.equal(isRetryableDeliveryError(new Error("ECONNRESET")), true);
});

test("backoff exponencial tem jitter e limite de uma hora", () => {
  assert.equal(retryDelayMs(1, () => 0), 11_250);
  assert.equal(retryDelayMs(2, () => 0.5), 30_000);
  assert.equal(retryDelayMs(20, () => 0.5), 3_600_000);
});

test("Retry-After em segundos ou data tem precedencia e limite de 24 horas", () => {
  const now = Date.parse("2026-09-11T12:00:00Z");
  assert.equal(retryAt({ attempt: 1, retryAfter: "120", nowMs: now }).toISOString(), "2026-09-11T12:02:00.000Z");
  assert.equal(retryAt({ attempt: 1, retryAfter: "2026-09-11T12:05:00Z", nowMs: now }).toISOString(), "2026-09-11T12:05:00.000Z");
  assert.equal(retryAt({ attempt: 1, retryAfter: "999999", nowMs: now }).toISOString(), "2026-09-12T12:00:00.000Z");
});
