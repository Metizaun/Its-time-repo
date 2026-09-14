import assert from "node:assert/strict";
import test from "node:test";

import {
  enforceAgendaCompanyAddress,
  isSecureAgendaCompanyMatch,
} from "../sdr-agent-gemini.js";

const agendaData = {
  company: {
    id: "campo-largo-id",
    name: "Saúde Perfeita - Campo Largo",
    address: "RUA XV DE NOVEMBRO, 229 - Shopping XV SALA 23, 2º andar",
    city: "Campo Largo",
    state: "PR",
    postalCode: "83601030",
  },
};

test("an address question is answered with the selected company's official data", () => {
  const reply = enforceAgendaCompanyAddress({
    reply_blocks: ["O endereço completo da unidade não foi disponibilizado no sistema."],
    media_asset_key: null,
  }, agendaData, "Qual é o endereço da unidade?");

  assert.deepEqual(reply.reply_blocks, [
    "A unidade Saúde Perfeita - Campo Largo fica em RUA XV DE NOVEMBRO, 229 - Shopping XV SALA 23, 2º andar - Campo Largo/PR - CEP 83601030.",
  ]);
});

test("official address data is not forced outside the configured customer process", () => {
  const original = {
    reply_blocks: ["Seu horário foi confirmado."],
    media_asset_key: null,
  };
  assert.deepEqual(
    enforceAgendaCompanyAddress(original, agendaData, "Obrigado"),
    original,
  );
});

test("a false missing-address claim is corrected even without a repeated question", () => {
  const reply = enforceAgendaCompanyAddress({
    reply_blocks: ["Agendamento concluído.", "A localização não foi informada."],
    media_asset_key: null,
  }, agendaData, "Pode confirmar?");

  assert.equal(reply.reply_blocks.length, 2);
  assert.match(reply.reply_blocks[0], /RUA XV DE NOVEMBRO, 229/);
  assert.equal(reply.reply_blocks[1], "Agendamento concluído.");
});

test("only a high-scoring and clearly dominant company match is accepted silently", () => {
  assert.equal(isSecureAgendaCompanyMatch({ match_score: 1 }, null), true);
  assert.equal(isSecureAgendaCompanyMatch({ match_score: 0.995 }, { match_score: 0.8 }), true);
  assert.equal(isSecureAgendaCompanyMatch({ match_score: 0.95 }, null), false);
  assert.equal(isSecureAgendaCompanyMatch({ match_score: 0.99 }, { match_score: 0.94 }), false);
});
