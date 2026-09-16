import assert from "node:assert/strict";
import test from "node:test";
import type { AxiosInstance } from "axios";

import {
  HttpMetaGraphValidator,
  MetaBootstrapError,
  MetaBootstrapService,
  toOperationalMetaChannel,
  type MetaBootstrapInput,
  type MetaBootstrapRepository,
  type MetaGraphValidator,
} from "../meta-bootstrap-service.js";

const input: MetaBootstrapInput = {
  acesId: 7,
  instanceName: "meta-pilot",
  wabaId: "waba-1",
  phoneNumberId: "phone-1",
  businessId: "business-1",
  accessTokenSecretRef: "META_PILOT_ACCESS_TOKEN",
  appSecretRef: "META_APP_SECRET",
  webhookVerifyTokenSecretRef: "META_WEBHOOK_VERIFY_TOKEN",
  actorId: "operator@test",
};

function buildRepository() {
  const calls = { bootstrap: 0, auditFailure: 0 };
  const repository: MetaBootstrapRepository = {
    validateTarget: async () => undefined,
    bootstrapChannel: async () => {
      calls.bootstrap += 1;
      return {
        id: "channel-1",
        instance_name: "meta-pilot",
        waba_id: "waba-1",
        display_phone_number: "+55 11 99999-0000",
        status: "draft",
        last_template_sync_at: null,
        created_at: "2026-08-28T12:00:00.000Z",
        updated_at: "2026-08-28T12:00:00.000Z",
      };
    },
    auditValidationFailure: async () => {
      calls.auditFailure += 1;
    },
  };
  return { repository, calls };
}

test("bootstrap valida ativos antes de persistir e retorna somente dados operacionais", async () => {
  const { repository, calls } = buildRepository();
  const graphValidator: MetaGraphValidator = {
    validateAssets: async () => ({
      wabaName: "WABA Piloto",
      displayPhoneNumber: "+55 11 99999-0000",
      verifiedName: "Empresa Piloto",
    }),
  };
  const secrets = new Map([
    ["META_PILOT_ACCESS_TOKEN", "access-token-sensitive"],
    ["META_APP_SECRET", "app-secret-sensitive"],
    ["META_WEBHOOK_VERIFY_TOKEN", "verify-token-sensitive"],
  ]);
  const service = new MetaBootstrapService({
    supabaseUrl: "http://127.0.0.1:55321",
    supabaseServiceRoleKey: "service-role-test",
    graphApiVersion: "v26.0",
    metaAppId: "123456789",
    resolveSecret: (secretRef) => secrets.get(secretRef) ?? null,
    repository,
    graphValidator,
  });

  const result = await service.bootstrap(input);

  assert.equal(calls.bootstrap, 1);
  assert.equal(calls.auditFailure, 0);
  assert.deepEqual(Object.keys(result.channel).sort(), [
    "createdAt",
    "displayPhoneNumber",
    "health",
    "id",
    "instanceName",
    "lastTemplateSyncAt",
    "status",
    "updatedAt",
    "wabaId",
  ]);
  assert.equal(JSON.stringify(result).includes("access-token-sensitive"), false);
  assert.equal(JSON.stringify(result).includes("app-secret-sensitive"), false);
  assert.equal(JSON.stringify(result).includes("META_PILOT_ACCESS_TOKEN"), false);
});

test("falha de validacao externa nao persiste configuracao parcial", async () => {
  const { repository, calls } = buildRepository();
  const graphValidator: MetaGraphValidator = {
    validateAssets: async () => {
      throw new MetaBootstrapError("META_PHONE_NOT_IN_WABA", "Numero nao pertence ao WABA");
    },
  };
  const service = new MetaBootstrapService({
    supabaseUrl: "http://127.0.0.1:55321",
    supabaseServiceRoleKey: "service-role-test",
    graphApiVersion: "v26.0",
    metaAppId: "123456789",
    resolveSecret: () => "configured-secret",
    repository,
    graphValidator,
  });

  await assert.rejects(
    service.bootstrap(input),
    (error: unknown) =>
      error instanceof MetaBootstrapError && error.code === "META_PHONE_NOT_IN_WABA",
  );
  assert.equal(calls.bootstrap, 0);
  assert.equal(calls.auditFailure, 1);
});

test("DTO operacional ignora campos sensiveis presentes na linha de banco", () => {
  const channel = toOperationalMetaChannel({
    id: "channel-1",
    instance_name: "meta-pilot",
    waba_id: "waba-1",
    display_phone_number: "+55 11 99999-0000",
    status: "active",
    last_template_sync_at: null,
    created_at: "2026-08-28T12:00:00.000Z",
    updated_at: "2026-08-28T12:00:00.000Z",
    access_token_secret_ref: "META_PILOT_ACCESS_TOKEN",
    app_secret_ref: "META_APP_SECRET",
    webhook_verify_token: "META_WEBHOOK_VERIFY_TOKEN",
  } as Parameters<typeof toOperationalMetaChannel>[0] & Record<string, unknown>);

  assert.equal(channel.health, "healthy");
  assert.equal("accessTokenSecretRef" in channel, false);
  assert.equal("appSecretRef" in channel, false);
  assert.equal("webhookVerifyToken" in channel, false);
});

test("validador Graph rejeita token sem as duas permissoes obrigatorias", async () => {
  const http = {
    get: async () => ({
      data: {
        data: {
          is_valid: true,
          app_id: "123456789",
          scopes: ["whatsapp_business_management"],
        },
      },
    }),
  } as unknown as AxiosInstance;
  const validator = new HttpMetaGraphValidator("v26.0", "123456789", http);

  await assert.rejects(
    validator.validateAssets(
      { wabaId: "waba-1", phoneNumberId: "phone-1", businessId: null },
      { accessToken: "sensitive-token", appSecret: "sensitive-secret" },
    ),
    (error: unknown) =>
      error instanceof MetaBootstrapError && error.code === "META_PERMISSIONS_MISSING",
  );
});
