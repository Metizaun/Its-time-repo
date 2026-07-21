import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

import { GupshupWhatsAppProvider } from "../gupshup-whatsapp-provider.js";

test("usa endpoints e campos atuais da API WhatsApp Gupshup", async () => {
  const calls: Array<{ url: string; body: string; config: unknown }> = [];
  const originalPost = axios.post;
  axios.post = (async (url: string, body: string, config: unknown) => {
    calls.push({ url, body, config });
    return { data: { status: "submitted", messageId: `message-${calls.length}` } };
  }) as typeof axios.post;

  try {
    const provider = new GupshupWhatsAppProvider({
      apiKey: "test-api-key",
      appName: "TestApp",
      phoneNumber: "+55 (11) 90000-0000",
    });

    const textResult = await provider.sendText({
      instanceName: "test-instance",
      to: "(11) 98888-7777",
      text: "Ola",
      sourceType: "ai",
    });
    const templateResult = await provider.sendTemplate({
      instanceName: "test-instance",
      to: "(11) 98888-7777",
      templateName: "template-id",
      languageCode: "pt_BR",
      parameters: ["Lucas"],
      sourceType: "automation",
    });
    await provider.sendMedia({
      instanceName: "test-instance",
      to: "(11) 98888-7777",
      mediaUrl: "https://example.com/catalogo.pdf",
      mimeType: "application/pdf",
      fileName: "catalogo.pdf",
      kind: "document",
      sourceType: "manual",
    });
    await provider.sendMedia({
      instanceName: "test-instance",
      to: "(11) 98888-7777",
      mediaUrl: "https://example.com/produto.png",
      mimeType: "image/png",
      fileName: "produto.png",
      kind: "image",
      caption: "Produto",
      sourceType: "ai",
    });
    await provider.sendVoiceNote({
      instanceName: "test-instance",
      to: "(11) 98888-7777",
      mediaUrl: "https://example.com/audio.mp3",
      sourceType: "ai",
    });
    await provider.sendMedia({
      instanceName: "test-instance",
      to: "(11) 98888-7777",
      mediaUrl: "https://example.com/cabecalho.png",
      mimeType: "image/png",
      fileName: "cabecalho.png",
      kind: "image",
      templateName: "template-image-id",
      templateParameters: ["Lucas"],
      sourceType: "automation",
    });
    await provider.sendMedia({
      instanceName: "test-instance",
      to: "(11) 98888-7777",
      mediaUrl: "https://example.com/apresentacao.mp4",
      mimeType: "video/mp4",
      fileName: "apresentacao.mp4",
      kind: "video",
      templateName: "template-video-id",
      templateParameters: [],
      sourceType: "automation",
    });
    await provider.sendMedia({
      instanceName: "test-instance",
      to: "(11) 98888-7777",
      mediaUrl: "https://example.com/proposta.pdf",
      mimeType: "application/pdf",
      fileName: "proposta.pdf",
      kind: "document",
      templateName: "template-document-id",
      templateParameters: ["Lucas", "Hoje"],
      sourceType: "automation",
    });

    assert.equal(calls[0]?.url, "https://api.gupshup.io/wa/api/v1/msg");
    const textBody = new URLSearchParams(calls[0]?.body);
    assert.equal(textBody.get("source"), "5511900000000");
    assert.equal(textBody.get("destination"), "5511988887777");
    assert.deepEqual(JSON.parse(textBody.get("message") ?? "{}"), {
      type: "text",
      text: "Ola",
    });

    assert.equal(calls[1]?.url, "https://api.gupshup.io/wa/api/v1/template/msg");
    const templateBody = new URLSearchParams(calls[1]?.body);
    assert.equal(templateBody.get("message"), null);
    assert.deepEqual(JSON.parse(templateBody.get("template") ?? "{}"), {
      id: "template-id",
      params: ["Lucas"],
    });
    assert.equal(textResult.providerStatus, "accepted");
    assert.equal(templateResult.providerMessageId, "message-2");
    assert.deepEqual(JSON.parse(new URLSearchParams(calls[2]?.body).get("message") ?? "{}"), {
      type: "file",
      url: "https://example.com/catalogo.pdf",
      filename: "catalogo.pdf",
    });
    assert.deepEqual(JSON.parse(new URLSearchParams(calls[3]?.body).get("message") ?? "{}"), {
      type: "image",
      originalUrl: "https://example.com/produto.png",
      previewUrl: "https://example.com/produto.png",
      caption: "Produto",
    });
    assert.deepEqual(JSON.parse(new URLSearchParams(calls[4]?.body).get("message") ?? "{}"), {
      type: "audio",
      url: "https://example.com/audio.mp3",
    });
    const imageTemplateBody = new URLSearchParams(calls[5]?.body);
    assert.equal(calls[5]?.url, "https://api.gupshup.io/wa/api/v1/template/msg");
    assert.deepEqual(JSON.parse(imageTemplateBody.get("template") ?? "{}"), {
      id: "template-image-id",
      params: ["Lucas"],
    });
    assert.deepEqual(JSON.parse(imageTemplateBody.get("message") ?? "{}"), {
      type: "image",
      image: { link: "https://example.com/cabecalho.png" },
    });

    const videoTemplateBody = new URLSearchParams(calls[6]?.body);
    assert.equal(calls[6]?.url, "https://api.gupshup.io/wa/api/v1/template/msg");
    assert.deepEqual(JSON.parse(videoTemplateBody.get("message") ?? "{}"), {
      type: "video",
      video: { link: "https://example.com/apresentacao.mp4" },
    });

    const documentTemplateBody = new URLSearchParams(calls[7]?.body);
    assert.equal(calls[7]?.url, "https://api.gupshup.io/wa/api/v1/template/msg");
    assert.deepEqual(JSON.parse(documentTemplateBody.get("message") ?? "{}"), {
      type: "document",
      document: {
        link: "https://example.com/proposta.pdf",
        filename: "proposta.pdf",
      },
    });
  } finally {
    axios.post = originalPost;
  }
});
