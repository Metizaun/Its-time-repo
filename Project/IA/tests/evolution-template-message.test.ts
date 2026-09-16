import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { executeEvolutionTemplateBackfill } from "../evolution-template-backfill.js";
import { fileURLToPath } from "node:url";

import {
  extractEvolutionFirstTouchAttribution,
  inferLeadNameFromEvolutionTemplate,
  inspectEvolutionWebhookContent,
} from "../evolution-webhook-content.js";
import {
  AgentManager,
  buildEvolutionProviderPayloadSummary,
  parseEvolutionWebhookPayload,
  type WebhookPayload,
} from "../sdr-agent-gemini.js";
import { summarizeProviderPayload } from "../whatsapp-provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readFixture(): WebhookPayload {
  return JSON.parse(
    readFileSync(path.join(__dirname, "../fixtures/evolution/webhook-template-image-lid.json"), "utf8"),
  ) as WebhookPayload;
}

test("interpreta template Evolution aninhado com texto, imagem, botoes e JID original", () => {
  const payload = readFixture();
  const parsed = parseEvolutionWebhookPayload(payload);
  const inspected = inspectEvolutionWebhookContent(payload);

  assert.equal(parsed.phone, "5562999990000");
  assert.equal(parsed.conversationId, "5562999990000@s.whatsapp.net");
  assert.equal(parsed.content, "Olá, Daniel! Temos uma condição especial para o seu próximo exame.");
  assert.equal(parsed.mediaKind, "image");
  assert.equal(parsed.mediaUrl, "https://mmg.whatsapp.net/example/image.enc");
  assert.equal(parsed.mediaThumbnailBase64, "/9j/");
  assert.equal(parsed.fileName, "campanha-exame.jpg");
  assert.equal((parsed.raw.data as Record<string, any>).key.remoteJid, "987654321012345@lid");
  assert.equal(inspected.templateCard?.templateId, "campanha_exame_2026");
  assert.deepEqual(inspected.templateCard?.buttons.map((button) => button.kind), ["url", "quick_reply", "call"]);
});

test("resume payload por estrutura sem remover template ou gerar JSON invalido", () => {
  const payload = readFixture();
  (payload.data as Record<string, any>).message.templateMessage.hydratedTemplate.imageMessage.base64 = "A".repeat(50_000);
  const summary = summarizeProviderPayload(payload) as Record<string, any>;
  const serialized = JSON.stringify(summary);

  assert.ok(serialized.length <= 32_500);
  assert.equal(summary.data.message.templateMessage.templateId, "campanha_exame_2026");
  assert.equal(summary.data.message.templateMessage.hydratedTemplate.imageMessage.base64, undefined);
  assert.equal(summary.data.message.templateMessage.hydratedTemplate.imageMessage.mediaKey, undefined);
  assert.equal(summary.data.message.templateMessage.hydratedTemplate.imageMessage.jpegThumbnail, "/9j/");
  assert.doesNotThrow(() => JSON.parse(serialized));
});

test("preserva thumbnail binario como base64 limitado e remove os demais buffers", () => {
  const payload = readFixture();
  const image = (payload.data as Record<string, any>).message.templateMessage.hydratedTemplate.imageMessage;
  image.jpegThumbnail = Uint8Array.from([0xff, 0xd8, 0xff]);
  image.buffer = Uint8Array.from([1, 2, 3]);

  const summary = summarizeProviderPayload(payload) as Record<string, any>;
  const summarizedImage = summary.data.message.templateMessage.hydratedTemplate.imageMessage;
  assert.equal(summarizedImage.jpegThumbnail, "/9j/");
  assert.equal(summarizedImage.buffer, undefined);
});

test("separa templateCard da selecao de quick reply no resumo persistido", () => {
  const parsed = parseEvolutionWebhookPayload(readFixture());
  const summary = buildEvolutionProviderPayloadSummary(parsed) as Record<string, any>;

  assert.equal(summary.templateCard.templateId, "campanha_exame_2026");
  assert.equal(summary.templateCard.body, parsed.content);
  assert.equal(summary.chatInteraction, undefined);
});

test("extrai atribuicao e nome somente do padrao seguro de saudacao", () => {
  const payload = readFixture();
  const attribution = extractEvolutionFirstTouchAttribution({
    payload,
    providerMessageId: "TEMPLATE-IMAGE-LID-001",
    capturedAt: "2026-08-16T18:00:00.000Z",
  });

  assert.equal(attribution?.template_id, "campanha_exame_2026");
  assert.equal(attribution?.cta_url, "https://example.com/agendar");
  assert.equal(attribution?.ctwa_clid, "CTWA-ANON-001");
  assert.equal(inferLeadNameFromEvolutionTemplate(payload), "Daniel");

  const unsafe = structuredClone(payload) as Record<string, any>;
  unsafe.data.message.templateMessage.hydratedTemplate.hydratedContentText = "Olá, cliente! Confira a oferta.";
  assert.equal(inferLeadNameFromEvolutionTemplate(unsafe), null);
});

test("nao baixa URL .enc diretamente e usa thumbnail como fallback degradado", async () => {
  const parsed = parseEvolutionWebhookPayload(readFixture());
  const manager: any = Object.create(AgentManager.prototype);
  manager.resolveEvolutionTransport = async () => {
    throw new Error("URL .enc nao deveria iniciar download direto");
  };
  manager.fetchMediaFromEvolution = async () => null;

  const media = await manager.resolveMediaBytes(parsed);
  assert.equal(media.mimeType, "image/jpeg");
  assert.equal(media.degraded, true);
  assert.deepEqual(Array.from(media.buffer), [0xff, 0xd8, 0xff]);
});

test("atribuição usa compare-and-set e nunca sobrescreve primeiro toque existente", async () => {
  const parsed = parseEvolutionWebhookPayload(readFixture());
  const manager: any = Object.create(AgentManager.prototype);
  let updatePayload: Record<string, unknown> | null = null;
  let nullFilter: { column: string; value: unknown } | null = null;

  manager.serviceClient = {
    from(table: string) {
      assert.equal(table, "leads");
      let operation: "read" | "update" = "read";
      const query = {
        select() { return query; },
        update(payload: Record<string, unknown>) {
          operation = "update";
          updatePayload = payload;
          return query;
        },
        eq() { return query; },
        is(column: string, value: unknown) {
          nullFilter = { column, value };
          return query;
        },
        async maybeSingle() {
          return operation === "read"
            ? { data: { id: "lead-1", name: "Lead 5562999990000", contact_phone: "5562999990000" }, error: null }
            : { data: { id: "lead-1" }, error: null };
        },
      };
      return query;
    },
  };

  const persisted = await manager.persistEvolutionFirstTouchAttribution({
    acesId: 5,
    leadId: "lead-1",
    message: parsed,
  });

  assert.equal(persisted, true);
  assert.deepEqual(nullFilter, { column: "first_touch_attribution", value: null });
  const persistedPayload = (updatePayload ?? {}) as Record<string, unknown>;
  assert.equal(persistedPayload.Fonte, "WhatsApp Disparo");
  assert.equal(persistedPayload.Plataform, "Meta Template");
  assert.equal(persistedPayload.name, "Daniel");
});

test("backfill em dry-run lista candidatos sem executar reparo", async () => {
  let repairCalls = 0;
  const results = await executeEvolutionTemplateBackfill({
    apply: false,
    candidates: [{ messageId: "TEMPLATE-DRY-RUN-1", payload: readFixture() }],
    repairCandidate: async () => {
      repairCalls += 1;
      return { ignored: true };
    },
  });

  assert.equal(repairCalls, 0);
  assert.deepEqual(results, []);
});
