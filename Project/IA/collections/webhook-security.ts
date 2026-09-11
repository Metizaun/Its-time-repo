import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookVerificationInput = {
  rawBody: Buffer;
  timestamp: string | undefined;
  signature: string | undefined;
  secrets: string[];
  nowMs?: number;
  toleranceSeconds?: number;
};

export class CollectionWebhookAuthError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "CollectionWebhookAuthError";
  }
}

function parseSignature(value: string) {
  const match = value.trim().match(/^sha256=([0-9a-f]{64})$/i);
  return match ? Buffer.from(match[1], "hex") : null;
}

export function signCollectionWebhook(secret: string, timestamp: string, rawBody: Buffer | string) {
  return `sha256=${createHmac("sha256", secret).update(timestamp).update(".").update(rawBody).digest("hex")}`;
}

export function verifyCollectionWebhook(input: WebhookVerificationInput) {
  if (!input.timestamp || !/^\d{10,13}$/.test(input.timestamp)) {
    throw new CollectionWebhookAuthError("Timestamp ausente ou invalido", "invalid_timestamp");
  }
  if (!input.signature) {
    throw new CollectionWebhookAuthError("Assinatura ausente", "missing_signature");
  }
  const supplied = parseSignature(input.signature);
  if (!supplied) {
    throw new CollectionWebhookAuthError("Assinatura invalida", "invalid_signature");
  }
  const rawTimestamp = Number(input.timestamp);
  const timestampMs = input.timestamp.length === 10 ? rawTimestamp * 1000 : rawTimestamp;
  const toleranceMs = Math.max(input.toleranceSeconds ?? 300, 30) * 1000;
  if (Math.abs((input.nowMs ?? Date.now()) - timestampMs) > toleranceMs) {
    throw new CollectionWebhookAuthError("Requisicao fora da janela permitida", "replay_window_exceeded");
  }
  const valid = input.secrets.some((secret) => {
    const expected = createHmac("sha256", secret)
      .update(input.timestamp as string)
      .update(".")
      .update(input.rawBody)
      .digest();
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  });
  if (!valid) throw new CollectionWebhookAuthError("Assinatura invalida", "invalid_signature");
  return true;
}
