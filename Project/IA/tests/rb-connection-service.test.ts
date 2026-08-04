import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  RbConnectionService,
  type RbConnectionRecord,
} from "../rb-connection-service.js";

const connection: RbConnectionRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  aces_id: 5,
  rb_aces_id: 50,
  rb_base_url: "https://app.registrobase.com.br:32077",
  rb_token_api: "rb_test-key",
  rb_empresa_ids: [],
  is_active: true,
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

test("assina JWT HS256 compativel com o contrato receptivo RB", () => {
  const secret = "segredo-de-teste-comprido";
  const service = new RbConnectionService({
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseServiceRoleKey: "service-role-test",
    jwtSecret: secret,
  });
  const startedAt = Math.floor(Date.now() / 1000);
  const { token, exp } = service.signWebhookToken(connection, 1);
  const [encodedHeader, encodedPayload, signature] = token.split(".");

  assert.deepEqual(JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")), {
    alg: "HS256",
    typ: "JWT",
  });
  assert.deepEqual(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")), {
    connection_id: connection.id,
    internal_aces_id: 5,
    aces_id: 50,
    emp_id: 1,
    exp,
  });
  assert.equal(
    signature,
    createHmac("sha256", secret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url"),
  );
  assert.ok(exp >= startedAt + 299 && exp <= startedAt + 301);
});

test("recusa emitir token sem segredo configurado", () => {
  const service = new RbConnectionService({
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseServiceRoleKey: "service-role-test",
  });

  assert.throws(() => service.signWebhookToken(connection, 1), /RB_WEBHOOK_JWT_SECRET/);
});

test("autentica a conexao somente pelo aces_id do RB", async () => {
  const filters: Array<[string, number | boolean]> = [];
  const query = {
    select() {
      return this;
    },
    eq(field: string, value: number | boolean) {
      filters.push([field, value]);
      return this;
    },
    maybeSingle: async () => ({ data: connection, error: null }),
  };
  const service = new RbConnectionService({
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseServiceRoleKey: "service-role-test",
  });
  (service as any).rbClient = { from: () => query };

  const result = await service.authenticate({ rbAcesId: 50 });

  assert.equal(result, connection);
  assert.deepEqual(filters, [
    ["rb_aces_id", 50],
    ["is_active", true],
  ]);
});

test("retorna nulo quando o aces_id do RB nao esta cadastrado", async () => {
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle: async () => ({ data: null, error: null }),
  };
  const service = new RbConnectionService({
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseServiceRoleKey: "service-role-test",
  });
  (service as any).rbClient = { from: () => query };

  assert.equal(await service.authenticate({ rbAcesId: 123 }), null);
});

test("usa somente a URL oficial configurada no backend para cobranca", async () => {
  const service = new RbConnectionService({
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseServiceRoleKey: "service-role-test",
    rbApiBaseUrl: "https://rb-oficial.example/api/",
  });
  (service as any).assertAgent = async () => undefined;
  (service as any).rbClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            not: () => ({
              maybeSingle: async () => ({
                data: {
                  rb_token_api: "rb_test-key",
                  rb_empresa_ids: ["1"],
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  };

  const config = await service.resolveBillingConfig(5, "agent-1");
  assert.equal(config?.rb_base_url, "https://rb-oficial.example/api");
});
