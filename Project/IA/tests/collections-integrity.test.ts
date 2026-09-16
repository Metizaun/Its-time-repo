import assert from "node:assert/strict";
import test from "node:test";

import { CollectionService } from "../collections/collection-service.js";

test("rotacao de credencial usa RPC transacional e nao expoe o segredo", async () => {
  const previousKey = process.env.COLLECTION_SECRETS_ENCRYPTION_KEY;
  const previousVersion = process.env.COLLECTION_SECRETS_ENCRYPTION_KEY_VERSION;
  process.env.COLLECTION_SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.COLLECTION_SECRETS_ENCRYPTION_KEY_VERSION = "v1";

  try {
    const service = Object.create(CollectionService.prototype) as CollectionService;
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    (service as any).collections = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: "credential-id", error: null };
      },
    };

    await service.storeCredential(5, "10000000-0000-4000-8000-000000000001", "webhook_hmac", "secret-value");

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, "rotate_source_credential");
    assert.equal(calls[0]?.args.p_credential_type, "webhook_hmac");
    assert.match(String(calls[0]?.args.p_ciphertext), /^\\x[0-9a-f]+$/i);
    assert.match(String(calls[0]?.args.p_iv), /^\\x[0-9a-f]{24}$/i);
    assert.match(String(calls[0]?.args.p_auth_tag), /^\\x[0-9a-f]{32}$/i);
    assert.notEqual(calls[0]?.args.p_ciphertext, "secret-value");
  } finally {
    if (previousKey === undefined) delete process.env.COLLECTION_SECRETS_ENCRYPTION_KEY;
    else process.env.COLLECTION_SECRETS_ENCRYPTION_KEY = previousKey;
    if (previousVersion === undefined) delete process.env.COLLECTION_SECRETS_ENCRYPTION_KEY_VERSION;
    else process.env.COLLECTION_SECRETS_ENCRYPTION_KEY_VERSION = previousVersion;
  }
});
