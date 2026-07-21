import assert from "node:assert/strict";
import test from "node:test";

import {
  applyGupshupTemplateParameters,
  renderExecutionMessage,
  renderExecutionTemplateParameters,
  requiresGupshupTemplateForAutomation,
} from "../automation-worker.js";

function executionWith(template: string) {
  return {
    execution_id: "00000000-0000-4000-8000-000000000001",
    lead_id: "00000000-0000-4000-8000-000000000002",
    aces_id: 5,
    instance_name: "dr-oculos",
    phone: "5511999999999",
    lead_name: "RUBENS AURELIO REIS",
    city: null,
    lead_status: "Novo",
    template,
    step_label: "Cobranca",
    funnel_name: "Atrasado",
    scheduled_at: "2026-07-14T11:00:00.000Z",
    attempt_count: 0,
    rb_next_due_date: "2026-07-04",
    rb_total_amount: 66.67,
  };
}

test("renderiza aliases legados de vencimento e valor no texto direto", () => {
  const message = renderExecutionMessage(
    executionWith("Vencimento: {DtVencimento}. Valor: {valor_liquido}.")
  );

  assert.equal(message, "Vencimento: 04/07/2026. Valor: 66,67.");
});

test("continua rejeitando variaveis realmente desconhecidas", () => {
  assert.throws(
    () => renderExecutionMessage(executionWith("Valor: {variavel_inexistente}.")),
    /Mensagem contem variavel nao resolvida/
  );
});

test("monta os parametros de cobranca na ordem e com valor monetario", () => {
  const params = renderExecutionTemplateParameters({
    ...executionWith("Mensagem de cobranca"),
    gupshup_template_params: ["nome", "DtVencimento", "Vl_liquido"],
  });

  assert.deepEqual(params, ["Rubens", "04/07/2026", "R$ 66,67"]);
});

test("renderiza o historico da Gupshup por ocorrencia entre cabecalho e corpo", () => {
  const rendered = applyGupshupTemplateParameters(
    "Prezado(a) {{1}}\nVencimento: {{1}} Valor: {{2}}",
    ["Rubens", "04/07/2026", "R$ 66,67"]
  );

  assert.equal(rendered, "Prezado(a) Rubens\nVencimento: 04/07/2026 Valor: R$ 66,67");
});

test("bloqueia follow-up Gupshup no limite de 24 horas e libera template", () => {
  const evaluatedAt = new Date("2026-07-20T18:00:00.000Z");

  assert.equal(
    requiresGupshupTemplateForAutomation(
      "gupshup",
      false,
      "2026-07-19T18:00:00.001Z",
      evaluatedAt,
    ),
    false,
  );
  assert.equal(
    requiresGupshupTemplateForAutomation(
      "gupshup",
      false,
      "2026-07-19T18:00:00.000Z",
      evaluatedAt,
    ),
    true,
  );
  assert.equal(
    requiresGupshupTemplateForAutomation("gupshup", false, null, evaluatedAt),
    true,
  );
  assert.equal(
    requiresGupshupTemplateForAutomation("gupshup", true, null, evaluatedAt),
    false,
  );
  assert.equal(
    requiresGupshupTemplateForAutomation("evolution", false, null, evaluatedAt),
    false,
  );
});
