import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectPublicImage,
  PublicImageInspectionError,
  revalidatePublicImage,
} from "../integrations/public-image-inspector.js";

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("test-image"),
]);
const lookup = async () => [{ address: "8.8.8.8", family: 4 }];

test("inspeciona imagem publica e persiste somente metadados", async () => {
  const snapshot = await inspectPublicImage(
    { url: "https://cdn.example.com/photo.png", caption: " legenda " },
    {
      lookup,
      now: () => new Date("2026-09-15T12:00:00.000Z"),
      request: async () => ({ status: 200, headers: { "content-type": "image/png" }, data: png }),
    },
  );
  assert.equal(snapshot.mimeType, "image/png");
  assert.equal(snapshot.sizeBytes, png.length);
  assert.equal(snapshot.caption, "legenda");
  assert.match(snapshot.sha256, /^[a-f0-9]{64}$/);
  assert.equal("buffer" in snapshot, false);
});

test("valida DNS publico novamente em cada redirecionamento", async () => {
  let requestCount = 0;
  let lookupCount = 0;
  const snapshot = await inspectPublicImage(
    { url: "https://one.example/image" },
    {
      lookup: async () => {
        lookupCount += 1;
        return [{ address: "1.1.1.1", family: 4 }];
      },
      request: async () => {
        requestCount += 1;
        return requestCount === 1
          ? { status: 302, headers: { location: "https://two.example/image.png" }, data: new ArrayBuffer(0) }
          : { status: 200, headers: { "content-type": "image/png" }, data: png };
      },
    },
  );
  assert.equal(snapshot.finalUrl, "https://two.example/image.png");
  assert.equal(lookupCount, 2);
});

test("rejeita DNS privado e MIME declarado falso", async () => {
  await assert.rejects(
    inspectPublicImage({ url: "https://private.example/image.png" }, {
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      request: async () => ({ status: 200, headers: { "content-type": "image/png" }, data: png }),
    }),
    (error: unknown) => error instanceof PublicImageInspectionError && error.code === "private_address",
  );
  await assert.rejects(
    inspectPublicImage({ url: "https://cdn.example/image.jpg" }, {
      lookup,
      request: async () => ({ status: 200, headers: { "content-type": "image/jpeg" }, data: png }),
    }),
    (error: unknown) => error instanceof PublicImageInspectionError && error.code === "invalid_mime",
  );
});

test("revalidacao bloqueia imagem cujo hash mudou", async () => {
  const original = await inspectPublicImage({ url: "https://cdn.example/image.png" }, {
    lookup,
    request: async () => ({ status: 200, headers: { "content-type": "image/png" }, data: png }),
  });
  await assert.rejects(
    revalidatePublicImage(original, {
      lookup,
      request: async () => ({
        status: 200,
        headers: { "content-type": "image/png" },
        data: Buffer.concat([png, Buffer.from("changed")]),
      }),
    }),
    (error: unknown) => error instanceof PublicImageInspectionError && error.code === "hash_changed",
  );
});
