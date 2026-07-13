import assert from "node:assert/strict";
import test from "node:test";

import { parseGupshupWebhookPayload } from "../gupshup-webhook.js";

test("normaliza mensagem de texto no formato Gupshup v2", () => {
  const events = parseGupshupWebhookPayload({
    app: "DemoApp",
    timestamp: 1718003620228,
    version: 2,
    type: "message",
    payload: {
      id: "wamid-v2",
      source: "5511999999999",
      type: "text",
      payload: { text: "Ola" },
      sender: { phone: "5511999999999", name: "Lucas" },
    },
  });

  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event?.kind, "inbound");
  if (event?.kind !== "inbound") return;
  assert.equal(event.lookup.appName, "DemoApp");
  assert.equal(event.message.content, "Ola");
  assert.equal(event.message.phone, "5511999999999");
  assert.equal(event.message.provider, "gupshup");
});

test("normaliza imagem e documento no formato Gupshup v2", () => {
  const image = parseGupshupWebhookPayload({
    app: "DemoApp",
    version: 2,
    type: "message",
    payload: {
      id: "image-v2",
      source: "5511999999999",
      type: "image",
      payload: {
        url: "https://filemanager.gupshup.io/image",
        contentType: "image/jpeg",
        caption: "Receita",
      },
    },
  })[0];
  const document = parseGupshupWebhookPayload({
    app: "DemoApp",
    version: 2,
    type: "message",
    payload: {
      id: "file-v2",
      source: "5511999999999",
      type: "file",
      payload: {
        url: "https://filemanager.gupshup.io/file",
        contentType: "application/pdf",
        name: "receita.pdf",
      },
    },
  })[0];

  assert.equal(image?.kind === "inbound" ? image.message.mediaKind : null, "image");
  assert.equal(image?.kind === "inbound" ? image.message.content : null, "Receita");
  assert.equal(document?.kind === "inbound" ? document.message.mediaKind : null, "document");
  assert.equal(document?.kind === "inbound" ? document.message.fileName : null, "receita.pdf");
});

test("normaliza mensagens e status no formato Meta v3", () => {
  const events = parseGupshupWebhookPayload({
    object: "whatsapp_business_account",
    gs_app_id: "gupshup-app-id",
    entry: [
      {
        id: "app-or-waba-id",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { display_phone_number: "5562920000407" },
              contacts: [{ wa_id: "5511999999999", profile: { name: "Lucas" } }],
              messages: [
                {
                  from: "5511999999999",
                  id: "wamid-v3",
                  timestamp: "1718003620",
                  type: "document",
                  document: {
                    mime_type: "application/pdf",
                    filename: "pedido.pdf",
                    url: "https://filemanager.gupshup.io/pedido",
                  },
                },
              ],
              statuses: [
                {
                  id: "gs-message-id",
                  status: "delivered",
                  timestamp: "1718003621",
                  recipient_id: "5511999999999",
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.equal(events.length, 2);
  const inbound = events.find((event) => event.kind === "inbound");
  const status = events.find((event) => event.kind === "status");
  assert.equal(inbound?.kind === "inbound" ? inbound.message.mediaKind : null, "document");
  assert.equal(inbound?.kind === "inbound" ? inbound.message.pushName : null, "Lucas");
  assert.equal(inbound?.lookup.appId, "gupshup-app-id");
  assert.equal(inbound?.lookup.phoneNumber, "5562920000407");
  assert.equal(status?.kind === "status" ? status.rawStatus : null, "delivered");
});
