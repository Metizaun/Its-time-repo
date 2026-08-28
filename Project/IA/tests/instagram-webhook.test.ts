import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  InstagramWebhookProcessor,
  parseInstagramWebhookPayload,
} from "../instagram-webhook.js";

test("normaliza somente o texto necessario da DM Instagram", () => {
  const [event] = parseInstagramWebhookPayload({
    object: "instagram",
    entry: [{
      id: "ig-account-1",
      time: 1_800_000_000,
      messaging: [{
        sender: { id: "igsid-1" },
        recipient: { id: "ig-account-1" },
        timestamp: 1_800_000_001_000,
        message: { mid: "message-1", text: "Ola", attachments: [{ type: "image" }] },
      }],
    }],
  });

  assert.deepEqual(event, {
    eventKey: "instagram:ig-account-1:message-1",
    externalAccountId: "ig-account-1",
    eventType: "message_text",
    providerMessageId: "message-1",
    senderId: "igsid-1",
    recipientId: "ig-account-1",
    text: "Ola",
    attachment: null,
    timestamp: "2027-01-15T08:00:01.000Z",
    ignoredReason: null,
  });
});

test("normaliza foto e audio e continua ignorando echo e anexos desconhecidos", () => {
  const events = parseInstagramWebhookPayload({
    entry: [{
      id: "ig-account-1",
      messaging: [
        { sender: { id: "igsid-1" }, message: { mid: "echo-1", text: "Oi", is_echo: true } },
        { sender: { id: "igsid-2" }, message: { mid: "image-1", attachments: [{ type: "image", payload: { url: "https://lookaside.fbsbx.com/image" } }] } },
        { sender: { id: "igsid-3" }, message: { mid: "audio-1", attachments: [{ type: "audio", payload: { url: "https://lookaside.fbsbx.com/audio" } }] } },
        { sender: { id: "igsid-4" }, message: { mid: "video-1", attachments: [{ type: "video", payload: { url: "https://lookaside.fbsbx.com/video" } }] } },
      ],
    }],
  });

  assert.deepEqual(events.map((event) => [event.eventType, event.ignoredReason]), [
    ["unsupported", "echo"],
    ["message_media", null],
    ["message_media", null],
    ["unsupported", "unsupported_event"],
  ]);
  assert.deepEqual(events[1].attachment, { kind: "image", url: "https://lookaside.fbsbx.com/image" });
  assert.deepEqual(events[2].attachment, { kind: "audio", url: "https://lookaside.fbsbx.com/audio" });
});

test("valida X-Hub-Signature-256 sobre o corpo original", () => {
  const secret = "app-secret-de-teste";
  const rawBody = Buffer.from('{"entry":[]}');
  const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const processor = new InstagramWebhookProcessor({
    supabaseUrl: "http://127.0.0.1:55321",
    supabaseServiceRoleKey: "teste",
    appSecret: secret,
  });

  assert.equal(processor.verifySignature(rawBody, signature), true);
  assert.equal(processor.verifySignature(Buffer.from('{"entry":[1]}'), signature), false);
  assert.equal(processor.verifySignature(rawBody, "sha256=invalida"), false);
  assert.equal(processor.verifySignature(rawBody, undefined), false);
});
