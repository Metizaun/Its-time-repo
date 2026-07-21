import assert from "node:assert/strict";
import test from "node:test";

import {
  allowsEvolutionMediaFallback,
  downloadGupshupMedia,
  GupshupMediaDownloadError,
  prefetchGupshupInboundMedia,
} from "../gupshup-media-downloader.js";

const mediaUrl =
  "https://filemanager.gupshup.io/wa/app/wa/media/id?download=false";
const publicLookup = async () => [{ address: "8.8.8.8" }];

function arrayBufferFrom(value: string | number[]) {
  return typeof value === "string"
    ? Uint8Array.from(Buffer.from(value)).buffer
    : Uint8Array.from(value).buffer;
}

function assertDownloadErrorKind(
  error: unknown,
  expectedKind: GupshupMediaDownloadError["kind"],
) {
  assert.ok(error instanceof GupshupMediaDownloadError);
  assert.equal(error.kind, expectedKind);
  return true;
}

test("baixa midia Gupshup uma vez sem enviar API key", async () => {
  let requests = 0;
  const media = await downloadGupshupMedia(
    {
      mediaUrl,
      expectedMimeType: "image/jpeg",
      maxBytes: 1024,
    },
    {
      lookupHost: publicLookup,
      request: async (_url, config) => {
        requests += 1;
        assert.equal(config.headers, undefined);
        return {
          status: 200,
          headers: { "content-type": "image/jpeg" },
          data: arrayBufferFrom([0xff, 0xd8, 0xff, 0x01]),
        };
      },
    },
  );

  assert.equal(requests, 1);
  assert.equal(media.mimeType, "image/jpeg");
  assert.deepEqual([...media.buffer], [0xff, 0xd8, 0xff, 0x01]);
});

test("prefetch Gupshup resolve uma vez e bloqueia fallback Evolution", async () => {
  let resolutions = 0;
  const resolved = { mimeType: "image/jpeg", buffer: Buffer.from([1, 2, 3]) };
  const prefetched = await prefetchGupshupInboundMedia(
    "gupshup",
    true,
    async () => {
      resolutions += 1;
      return resolved;
    },
  );

  assert.equal(resolutions, 1);
  assert.equal(prefetched, resolved);
  assert.equal(allowsEvolutionMediaFallback("gupshup"), false);
  assert.equal(allowsEvolutionMediaFallback("evolution"), true);
  assert.equal(allowsEvolutionMediaFallback("meta"), true);
});

test("nao prefetcha providers fora do escopo", async () => {
  let resolutions = 0;
  const result = await prefetchGupshupInboundMedia(
    "evolution",
    true,
    async () => {
      resolutions += 1;
      return null;
    },
  );
  assert.equal(result, undefined);
  assert.equal(resolutions, 0);
});

test("rejeita URL expirada antes do request", async () => {
  let requests = 0;
  await assert.rejects(
    downloadGupshupMedia(
      {
        mediaUrl,
        mediaUrlExpiresAt: "2026-01-01T00:00:00.000Z",
        expectedMimeType: "image/jpeg",
        maxBytes: 1024,
      },
      {
        now: () => Date.parse("2026-01-02T00:00:00.000Z"),
        lookupHost: publicLookup,
        request: async () => {
          requests += 1;
          throw new Error("nao deveria executar");
        },
      },
    ),
    (error) => assertDownloadErrorKind(error, "expired_url"),
  );
  assert.equal(requests, 0);
});

test("classifica media ID invalido e autenticacao sem expor credenciais", async () => {
  for (const scenario of [
    {
      status: 400,
      body: '{"status":"error","message":"Invalid Media Id"}',
      kind: "invalid_media_id",
    },
    {
      status: 400,
      body: '{"status":"error","message":"Invalid URL"}',
      kind: "invalid_url",
    },
    { status: 401, body: '{"message":"Unauthorized"}', kind: "authentication" },
    { status: 403, body: '{"message":"Forbidden"}', kind: "authentication" },
  ] as const) {
    await assert.rejects(
      downloadGupshupMedia(
        { mediaUrl, expectedMimeType: "image/jpeg", maxBytes: 1024 },
        {
          lookupHost: publicLookup,
          request: async (_url, config) => {
            assert.equal(config.headers, undefined);
            return {
              status: scenario.status,
              headers: { "content-type": "application/json" },
              data: arrayBufferFrom(scenario.body),
            };
          },
        },
      ),
      (error) => assertDownloadErrorKind(error, scenario.kind),
    );
  }
});

test("classifica timeout, conteudo textual, MIME incompativel e tamanho excedido", async () => {
  await assert.rejects(
    downloadGupshupMedia(
      { mediaUrl, expectedMimeType: "image/jpeg", maxBytes: 1024 },
      {
        lookupHost: publicLookup,
        request: async () => {
          throw Object.assign(new Error("timeout of 15000ms exceeded"), {
            code: "ECONNABORTED",
          });
        },
      },
    ),
    (error) => assertDownloadErrorKind(error, "timeout"),
  );

  await assert.rejects(
    downloadGupshupMedia(
      { mediaUrl, expectedMimeType: "image/jpeg", maxBytes: 1024 },
      {
        lookupHost: publicLookup,
        request: async () => ({
          status: 200,
          headers: { "content-type": "image/jpeg" },
          data: arrayBufferFrom('{"message":"not media"}'),
        }),
      },
    ),
    (error) => assertDownloadErrorKind(error, "invalid_content"),
  );

  await assert.rejects(
    downloadGupshupMedia(
      { mediaUrl, expectedMimeType: "image/jpeg", maxBytes: 1024 },
      {
        lookupHost: publicLookup,
        request: async () => ({
          status: 200,
          headers: { "content-type": "audio/ogg" },
          data: arrayBufferFrom([1, 2, 3]),
        }),
      },
    ),
    (error) => assertDownloadErrorKind(error, "incompatible_mime"),
  );

  await assert.rejects(
    downloadGupshupMedia(
      { mediaUrl, expectedMimeType: "image/jpeg", maxBytes: 2 },
      {
        lookupHost: publicLookup,
        request: async () => ({
          status: 200,
          headers: { "content-type": "image/jpeg" },
          data: arrayBufferFrom([1, 2, 3]),
        }),
      },
    ),
    (error) => assertDownloadErrorKind(error, "too_large"),
  );
});

test("rejeita hosts, credenciais e redirecionamentos fora do File Manager", async () => {
  for (const unsafeUrl of [
    "http://filemanager.gupshup.io/media/id",
    "https://user:password@filemanager.gupshup.io/media/id",
    "https://example.com/media/id",
  ]) {
    await assert.rejects(
      downloadGupshupMedia(
        { mediaUrl: unsafeUrl, expectedMimeType: "image/jpeg", maxBytes: 1024 },
        { lookupHost: publicLookup },
      ),
      (error) => assertDownloadErrorKind(error, "unsafe_url"),
    );
  }

  let requests = 0;
  await assert.rejects(
    downloadGupshupMedia(
      { mediaUrl, expectedMimeType: "image/jpeg", maxBytes: 1024 },
      {
        lookupHost: publicLookup,
        request: async () => {
          requests += 1;
          return {
            status: 302,
            headers: { location: "https://example.com/stolen" },
            data: arrayBufferFrom(""),
          };
        },
      },
    ),
    (error) => assertDownloadErrorKind(error, "unsafe_url"),
  );
  assert.equal(requests, 1);
});

test("rejeita resolucao DNS privada", async () => {
  await assert.rejects(
    downloadGupshupMedia(
      { mediaUrl, expectedMimeType: "image/jpeg", maxBytes: 1024 },
      { lookupHost: async () => [{ address: "127.0.0.1" }] },
    ),
    (error) => assertDownloadErrorKind(error, "unsafe_url"),
  );
});
