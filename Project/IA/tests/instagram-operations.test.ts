import assert from "node:assert/strict";
import test from "node:test";

import { InstagramApiClient, InstagramApiError } from "../instagram-api-client.js";
import { evaluateInstagramHumanAgentWindow, InstagramService } from "../instagram-service.js";
import { downloadInstagramMedia, isAllowedInstagramMediaUrl, safeErrorCode } from "../instagram-workers.js";

test("normaliza erros da Meta para codigo seguro sem payload sensivel", () => {
  const error = new InstagramApiError("token-secreto-nao-deve-aparecer", {
    status: 429,
    code: "RATE_LIMIT",
    subcode: null,
    transient: true,
  });

  assert.equal(safeErrorCode(error), "meta_RATE_LIMIT");
  assert.doesNotMatch(safeErrorCode(error), /token-secreto/);
});

test("descarta codigos arbitrarios e nunca usa mensagem como codigo", () => {
  assert.equal(safeErrorCode({ code: "valid-code_1" }), "valid-code_1");
  assert.equal(safeErrorCode({ code: "token=super-secret" }), "instagram_processing_failed");
  assert.equal(safeErrorCode(new Error("payload sensivel")), "instagram_processing_failed");
});

test("marca somente atendimento humano Instagram entre 24 horas e 7 dias", () => {
  const evaluatedAtMs = Date.parse("2026-07-20T18:00:00.000Z");

  assert.deepEqual(
    evaluateInstagramHumanAgentWindow("2026-07-20T17:59:59.999Z", evaluatedAtMs),
    { isOpen: true, tag: null },
  );
  assert.deepEqual(
    evaluateInstagramHumanAgentWindow("2026-07-19T18:00:00.000Z", evaluatedAtMs),
    { isOpen: true, tag: "HUMAN_AGENT" },
  );
  assert.deepEqual(
    evaluateInstagramHumanAgentWindow("2026-07-13T18:00:00.000Z", evaluatedAtMs),
    { isOpen: false, tag: null },
  );
});

test("envia a tag HUMAN_AGENT somente quando o atendimento humano a solicita", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestBodies: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message_id: "mid.1", recipient_id: "igsid.1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new InstagramApiClient("app-id", "app-secret", "v26.0");
  await client.sendText({
    accessToken: "token-de-teste",
    igUserId: "ig-user",
    recipientId: "igsid",
    text: "Atendimento humano",
    tag: "HUMAN_AGENT",
  });
  await client.sendText({
    accessToken: "token-de-teste",
    igUserId: "ig-user",
    recipientId: "igsid",
    text: "Mensagem comum",
  });

  assert.deepEqual(requestBodies, [
    {
      recipient: { id: "igsid" },
      message: { text: "Atendimento humano" },
      tag: "HUMAN_AGENT",
    },
    {
      recipient: { id: "igsid" },
      message: { text: "Mensagem comum" },
    },
  ]);
});

test("envia foto e audio no payload oficial sem aceitar video", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestBodies: unknown[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message_id: "mid.media" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new InstagramApiClient("app-id", "app-secret", "v26.0");
  await client.sendMedia({
    accessToken: "token-de-teste",
    igUserId: "ig-user",
    recipientId: "igsid",
    kind: "image",
    mediaUrl: "https://storage.example/photo.jpg?token=assinado",
  });
  await client.sendMedia({
    accessToken: "token-de-teste",
    igUserId: "ig-user",
    recipientId: "igsid",
    kind: "audio",
    mediaUrl: "https://storage.example/audio.ogg?token=assinado",
    tag: "HUMAN_AGENT",
  });

  assert.deepEqual(requestBodies, [
    { recipient: { id: "igsid" }, message: { attachment: { type: "image", payload: { url: "https://storage.example/photo.jpg?token=assinado" } } } },
    { recipient: { id: "igsid" }, message: { attachment: { type: "audio", payload: { url: "https://storage.example/audio.ogg?token=assinado" } } }, tag: "HUMAN_AGENT" },
  ]);
});

test("download inbound aceita apenas HTTPS da infraestrutura Meta", () => {
  assert.equal(isAllowedInstagramMediaUrl("https://lookaside.fbsbx.com/ig_messaging_cdn/file"), true);
  assert.equal(isAllowedInstagramMediaUrl("https://scontent.cdninstagram.com/file"), true);
  assert.equal(isAllowedInstagramMediaUrl("http://lookaside.fbsbx.com/file"), false);
  assert.equal(isAllowedInstagramMediaUrl("https://fbsbx.com.evil.example/file"), false);
  assert.equal(isAllowedInstagramMediaUrl("https://127.0.0.1/file"), false);
});

test("normaliza video/mp4 entregue pela Meta somente quando o webhook declarou audio", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(Buffer.from("audio-mp4"), {
    status: 200,
    headers: { "Content-Type": "video/mp4", "Content-Length": "9" },
  })) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const audio = await downloadInstagramMedia({
    url: "https://lookaside.fbsbx.com/ig_messaging_cdn/audio",
    kind: "audio",
  });
  assert.equal(audio.mimeType, "audio/mp4");
  assert.equal(audio.extension, "m4a");
  await assert.rejects(
    downloadInstagramMedia({
      url: "https://lookaside.fbsbx.com/ig_messaging_cdn/video",
      kind: "image",
    }),
    (error: unknown) => (error as { code?: string }).code === "instagram_media_mime_unsupported",
  );
});

test("gera entrega HTTPS opaca para o Storage local e rejeita token adulterado", async () => {
  const service = new InstagramService({
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseServiceRoleKey: "service-role-de-teste",
    appSecret: "app-secret-de-teste",
    backendPublicUrl: "https://instagram-dev-api.example.com",
  });
  const url = service.createMediaDeliveryUrl({
    acesId: 7,
    attachmentId: "70000000-0000-4000-8000-000000000001",
  });
  assert.match(url, /^https:\/\/instagram-dev-api\.example\.com\/api\/instagram\/media\//);
  assert.doesNotMatch(url, /127\.0\.0\.1|chat-attachments|storage\/v1/);
  await assert.rejects(
    service.downloadMediaDelivery(`${url.split("/").pop()}adulterado`),
    (error: unknown) => (error as { code?: string }).code === "INSTAGRAM_MEDIA_LINK_INVALID",
  );
});
