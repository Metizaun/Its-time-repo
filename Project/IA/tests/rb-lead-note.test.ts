import assert from "node:assert/strict";
import test from "node:test";

import { buildRbLeadNote, upsertRbLeadNote } from "../rb-lead-note.js";

const rbInput = {
  clieId: "12345",
  companyName: "Dr. Óculos — Loja 1",
  storeEmpId: "1",
  storeCnpj: "66972304000129",
};

test("formata os dados RB como uma nota simples", () => {
  assert.equal(
    buildRbLeadNote(rbInput),
    [
      "Dados do Registro Base",
      "",
      "Código RB: 12345",
      "Empresa: Dr. Óculos — Loja 1",
      "CNPJ: 66.972.304/0001-29",
    ].join("\n"),
  );
});

test("preserva observacoes e resumo da IA ao inserir os dados RB", () => {
  const existing = [
    "Preferência: contato pela manhã.",
    "",
    "<!-- AI_ATTENDANCE_SUMMARY_START -->",
    "Resumo IA (2026-07-29):",
    "Cliente pediu retorno.",
    "<!-- AI_ATTENDANCE_SUMMARY_END -->",
  ].join("\n");

  const next = upsertRbLeadNote(existing, rbInput);
  assert.match(next, /^Dados do Registro Base/);
  assert.match(next, /Preferência: contato pela manhã\./);
  assert.match(next, /Resumo IA \(2026-07-29\):/);
});

test("atualiza o bloco RB sem duplicar e preserva as demais notas", () => {
  const first = upsertRbLeadNote("Anotação manual", rbInput);
  const second = upsertRbLeadNote(first, {
    ...rbInput,
    clieId: "54321",
    companyName: "Dr. Óculos — Loja 2",
  });

  assert.equal((second.match(/Dados do Registro Base/g) ?? []).length, 1);
  assert.match(second, /Código RB: 54321/);
  assert.match(second, /Empresa: Dr. Óculos — Loja 2/);
  assert.match(second, /Anotação manual/);
});
