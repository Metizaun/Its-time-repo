import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { EvolutionWhatsAppProvider } from "../evolution-whatsapp-provider.js";

test("envia a simulacao como imagem pelo provider Evolution", async () => {
  let receivedPath = "";
  let receivedKey = "";
  let receivedBody: Record<string, unknown> = {};
  const server = createServer((request, response) => {
    receivedPath = request.url ?? "";
    receivedKey = String(request.headers.apikey ?? "");
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ key: { id: "provider-message-1" } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as AddressInfo;
    const provider = new EvolutionWhatsAppProvider({
      evolutionApiUrl: `http://127.0.0.1:${address.port}`,
      evolutionApiKey: "test-key",
    });
    const result = await provider.sendMedia({
      instanceName: "Lavie",
      to: "5511999999999",
      mediaUrl: "https://example.test/signed-output.png",
      mimeType: "image/png",
      fileName: "visagism-run.png",
      kind: "image",
      caption: "Aqui esta a armacao que mais combina com voce!",
      sourceType: "ai",
    });

    assert.equal(result.providerMessageId, "provider-message-1");
    assert.equal(receivedPath, "/message/sendMedia/Lavie");
    assert.equal(receivedKey, "test-key");
    assert.equal(receivedBody.mediatype, "image");
    assert.equal(receivedBody.mimetype, "image/png");
    assert.equal(receivedBody.fileName, "visagism-run.png");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
