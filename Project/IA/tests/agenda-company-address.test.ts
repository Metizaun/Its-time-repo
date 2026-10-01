import assert from "node:assert/strict";
import test from "node:test";

import {
  enforceAgendaCompanyAddress,
  enrichStoreLocationWithKnownCity,
  isExplicitStoreConfirmationText,
  isSecureAgendaCompanyMatch,
  selectCalendarPoleStoreId,
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

test("a routed appointment pole returns its configured address override", () => {
  const routedPole = {
    company: {
      id: "viana-pole-id",
      name: "Marcílio de Noronha",
      address: "Av. Vitória, 47, CEP 29135-368, ao lado da Papelaria Beger, Marcílio de Noronha, Viana - ES",
      city: null,
      state: null,
      postalCode: null,
    },
  };
  const reply = enforceAgendaCompanyAddress({
    reply_blocks: ["Não tenho o endereço oficial disponível aqui para te passar com segurança."],
    media_asset_key: null,
  }, routedPole, "Pode me enviar o endereço, por gentileza?");

  assert.deepEqual(reply.reply_blocks, [
    "A unidade Marcílio de Noronha fica em Av. Vitória, 47, CEP 29135-368, ao lado da Papelaria Beger, Marcílio de Noronha, Viana - ES.",
  ]);
});

test("a confirmed calendar pole can be recovered from city and neighborhood text", () => {
  const stores = [
    {
      id: "vila-velha-centro",
      displayName: "Atacadão dos Óculos - Loja 28",
      addressLine: "Av. Jerônimo Monteiro",
      neighborhood: "Centro de Vila Velha",
      city: "Vila Velha",
      formattedAddress: "Av. Jerônimo Monteiro, 1395 - Centro de Vila Velha, Vila Velha - ES",
    },
    {
      id: "guarapari-centro",
      displayName: "Atacadão dos Óculos - Loja 29",
      addressLine: "Av. Joaquim da Silva Lima",
      neighborhood: "Centro",
      city: "Guarapari",
      formattedAddress: "Av. Joaquim da Silva Lima - Centro, Guarapari - ES",
    },
  ];

  assert.equal(
    selectCalendarPoleStoreId(
      "Sim, confirmo! Pode verificar sexta e sábado no Centro de Vila Velha.",
      stores,
    ),
    "vila-velha-centro",
  );
  assert.equal(
    selectCalendarPoleStoreId("No centro ou Glória, Vila Velha", stores),
    "vila-velha-centro",
  );
});

test("a city alone or an unknown neighborhood does not select an appointment pole", () => {
  const stores = [
    {
      id: "vila-velha-centro",
      displayName: "Atacadão dos Óculos - Loja 28",
      addressLine: "Av. Jerônimo Monteiro",
      neighborhood: "Centro de Vila Velha",
      city: "Vila Velha",
      formattedAddress: "Av. Jerônimo Monteiro, 1395 - Centro de Vila Velha, Vila Velha - ES",
    },
    {
      id: "vila-velha-itapua",
      displayName: "Atacadão dos Óculos - Loja 18",
      addressLine: "Rua Jair de Andrade",
      neighborhood: "Itapuã",
      city: "Vila Velha",
      formattedAddress: "Rua Jair de Andrade - Itapuã, Vila Velha - ES",
    },
  ];

  assert.equal(selectCalendarPoleStoreId("Pode ser em Vila Velha", stores), null);
  assert.equal(selectCalendarPoleStoreId("Prefiro a unidade da Glória", stores), null);
});

test("an explicit store number disambiguates stores in the same neighborhood", () => {
  const stores = [
    {
      id: "loja-28",
      displayName: "Atacadão dos Óculos - Loja 28",
      addressLine: "Av. Jerônimo Monteiro",
      neighborhood: "Centro de Vila Velha",
      city: "Vila Velha",
      formattedAddress: "Av. Jerônimo Monteiro, 1395 - Centro de Vila Velha, Vila Velha - ES",
    },
    {
      id: "loja-32",
      displayName: "Atacadão dos Óculos - Loja 32",
      addressLine: "Av. Jerônimo Monteiro",
      neighborhood: "Centro de Vila Velha",
      city: "Vila Velha",
      formattedAddress: "Av. Jerônimo Monteiro, 1326 - Centro de Vila Velha, Vila Velha - ES",
    },
  ];

  assert.equal(
    selectCalendarPoleStoreId("Atacadão dos Óculos - Loja 32, Centro de Vila Velha", stores),
    "loja-32",
  );
});

test("a natural positive reply confirms the pending store", () => {
  assert.equal(isExplicitStoreConfirmationText("Fica bom sim, qual o horário?"), true);
  assert.equal(isExplicitStoreConfirmationText("Sim, confirmo essa unidade"), true);
  assert.equal(isExplicitStoreConfirmationText("Não, prefiro outra unidade"), false);
  assert.equal(isExplicitStoreConfirmationText("Fico no aguardo"), false);
});

test("a short neighborhood reply inherits the city from the immediately recent context", () => {
  const stores = [{ city: "Vila Velha" }, { city: "Cariacica" }, { city: "Guarapari" }];
  assert.equal(
    enrichStoreLocationWithKnownCity(
      "No centro ou Glória",
      "Tem algum horário em Vila Velha? No centro ou Glória",
      stores,
    ),
    "No centro ou Glória, Vila Velha",
  );
  assert.equal(
    enrichStoreLocationWithKnownCity("Campo Grande, Cariacica", "", stores),
    "Campo Grande, Cariacica",
  );
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
