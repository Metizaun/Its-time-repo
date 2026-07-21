import assert from "node:assert/strict";
import test from "node:test";

import {
  extractProviderQuickReplySelection,
  normalizeQuickReplyMessages,
  parseQuickReplyPrompt,
} from "../chat-quick-replies.js";

const OPTIONS_SUFFIX =
  " | [Já realizei o pagamento.] | [Quero o valor atualizado.] | [Preciso negociar o débito]";

test("reconhece globalmente os botoes no final dos templates 10d e 15d", () => {
  const tenDays = parseQuickReplyPrompt(
    `Prezado(a) Rubens,\nVencimento: 04/07/2026 Valor: R$ 270,00\nMe informe como posso auxiliar:${OPTIONS_SUFFIX}`,
  );
  const fifteenDays = parseQuickReplyPrompt(
    `AVISO URGENTE!\nParcelas em aberto: Maria\nMe informe como posso auxiliar:${OPTIONS_SUFFIX}`,
  );

  for (const parsed of [tenDays, fifteenDays]) {
    assert.ok(parsed);
    assert.equal(parsed.options.length, 3);
    assert.equal(parsed.options[0]?.title, "Já realizei o pagamento.");
    assert.equal(parsed.options[2]?.title, "Preciso negociar o débito");
    assert.doesNotMatch(parsed.content, /\|\s*\[/u);
  }
});

test("nao converte colchetes comuns no corpo da mensagem", () => {
  assert.equal(parseQuickReplyPrompt("Documento [boleto] recebido normalmente."), null);
  assert.equal(parseQuickReplyPrompt("Status | [pendente] com observacao depois."), null);
});

test("extrai selecao e contexto do callback Gupshup v2", () => {
  const selection = extractProviderQuickReplySelection({
    app: "DemoApp",
    version: 2,
    type: "message",
    payload: {
      id: "incoming-id",
      type: "text",
      payload: { text: "Preciso negociar o débito", type: "button" },
      context: { id: "wamid-original", gsId: "gs-original" },
    },
  });

  assert.equal(selection?.selectedOption.title, "Preciso negociar o débito");
  assert.deepEqual(selection?.contextMessageIds, ["gs-original", "wamid-original"]);
});

test("extrai selecao e contexto do callback interativo Gupshup v3", () => {
  const selection = extractProviderQuickReplySelection({
    _gupshupMetaMessage: {
      type: "interactive",
      interactive: {
        type: "button_reply",
        button_reply: { id: "negociar", title: "Preciso negociar o débito" },
      },
      context: { id: "wamid-original", gs_id: "gs-original" },
    },
  });

  assert.equal(selection?.selectedOption.id, "negociar");
  assert.equal(selection?.selectedOption.title, "Preciso negociar o débito");
  assert.deepEqual(selection?.contextMessageIds, ["gs-original", "wamid-original"]);
});

test("liga a escolha do cliente a mensagem enviada e atualiza o historico", () => {
  const normalized = normalizeQuickReplyMessages([
    {
      id: "outbound-message",
      content: `Me informe como posso auxiliar:${OPTIONS_SUFFIX}`,
      direction: "outbound",
      provider_message_id: "gs-original",
    },
    {
      id: "inbound-message",
      content: "Preciso negociar o débito",
      direction: "inbound",
      provider_payload_summary: {
        chatInteraction: {
          kind: "quick_reply_selection",
          id: "negociar",
          title: "Preciso negociar o débito",
          contextMessageIds: ["gs-original"],
        },
      },
    },
  ]);

  assert.equal(normalized.get("outbound-message")?.content, "Me informe como posso auxiliar:");
  assert.deepEqual(normalized.get("inbound-message")?.quickReply, {
    kind: "selection",
    selectedOption: { id: "negociar", title: "Preciso negociar o débito" },
    replyToMessageId: "outbound-message",
  });
});

test("usa a ultima opcao compativel como fallback para payload historico", () => {
  const normalized = normalizeQuickReplyMessages([
    {
      id: "outbound-message",
      content: `Me informe como posso auxiliar:${OPTIONS_SUFFIX}`,
      direction: "outbound",
    },
    {
      id: "inbound-message",
      content: "Ja realizei o pagamento",
      direction: "inbound",
    },
  ]);

  assert.deepEqual(normalized.get("inbound-message")?.quickReply, {
    kind: "selection",
    selectedOption: { id: "quick-reply-1", title: "Já realizei o pagamento." },
    replyToMessageId: "outbound-message",
  });
});
