import {
  WebhookAuthError,
  signWebhook,
  verifyWebhook,
  type WebhookVerificationInput,
} from "../integrations/webhook-security.js";

export type { WebhookVerificationInput };

export class CollectionWebhookAuthError extends WebhookAuthError {
  constructor(message: string, readonly code: string) {
    super(message, code);
    this.name = "CollectionWebhookAuthError";
  }
}

export function signCollectionWebhook(secret: string, timestamp: string, rawBody: Buffer | string) {
  return signWebhook(secret, timestamp, rawBody);
}

export function verifyCollectionWebhook(input: WebhookVerificationInput) {
  try {
    return verifyWebhook(input);
  } catch (error) {
    if (error instanceof WebhookAuthError) {
      throw new CollectionWebhookAuthError(error.message, error.code);
    }
    throw error;
  }
}
