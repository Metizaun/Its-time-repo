import assert from "node:assert/strict";
import test from "node:test";

import {
  buildForwardingContextSnapshot,
  filterVerifiedForwardingFacts,
  generateAndDeliverForwardingOpening,
  readForwardingContextFacts,
  shouldSuppressSourceReplyAfterAgentForwarding,
} from "../sdr-agent-gemini.js";

test("fatos de encaminhamento exigem evidencia da fonte declarada", () => {
  const inheritedFacts = [{ label: "Empresa", value: "Clinica Central", source: "tool_result" as const }];
  const facts = filterVerifiedForwardingFacts(
    [
      { label: "Assunto", value: "consulta", source: "lead_message", evidence: "quero marcar uma consulta" },
      { label: "Horario", value: "segunda a sexta, das 9h as 18h", source: "agent_configuration", evidence: "segunda a sexta, das 9h as 18h" },
      { label: "Endereco", value: "Rua das Flores, 20", source: "tool_result", evidence: "Rua das Flores, 20" },
      { label: "Promessa", value: "consulta confirmada", source: "lead_message", evidence: "A IA disse que a consulta esta confirmada" },
      { label: "Empresa", value: "Clinica Central", source: "previous_handoff", evidence: "Clinica Central" },
    ],
    [
      { source: "lead_message", content: "quero marcar uma consulta" },
      { source: "agent_configuration", content: "Atendimento de segunda a sexta, das 9h as 18h." },
      { source: "tool_result", content: "{\"address\":\"Rua das Flores, 20\"}" },
    ],
    inheritedFacts,
  );

  assert.deepEqual(facts, [
    { label: "Empresa", value: "Clinica Central", source: "tool_result" },
    { label: "Assunto", value: "consulta", source: "lead_message" },
    { label: "Horario", value: "segunda a sexta, das 9h as 18h", source: "agent_configuration" },
    { label: "Endereco", value: "Rua das Flores, 20", source: "tool_result" },
  ]);
  assert.equal(JSON.stringify(facts).includes("A IA disse"), false);

  const snapshot = buildForwardingContextSnapshot(facts);
  assert.equal(JSON.stringify(snapshot).includes("evidence"), false);
  assert.equal(JSON.stringify(snapshot).includes("quero marcar"), false);
  assert.deepEqual(readForwardingContextFacts(snapshot), facts);
});

test("abertura contextual tenta novamente apos erro e envia uma unica resposta valida", async () => {
  const attempts: number[] = [];
  const fallback = "Ola! Sou Ana. Recebi seu atendimento de Bruno e vou continuar com voce por aqui.";
  const destinationMessages: string[] = [];
  const opening = await generateAndDeliverForwardingOpening(async (attempt) => {
    attempts.push(attempt);
    if (attempt === 1) throw new Error("falha temporaria do modelo");
    return ["Ola, Maria! Sou Ana, da equipe de consultas. Vi que voce quer agendar e vou continuar por aqui."];
  }, fallback, async (blocks) => destinationMessages.push(...blocks));
  const sourceShouldReply = !shouldSuppressSourceReplyAfterAgentForwarding({ triggered: true, mode: "agent" });

  assert.deepEqual(attempts, [1, 2]);
  assert.equal(opening.usedFallback, false);
  assert.equal(destinationMessages.length, 1);
  assert.match(destinationMessages[0], /quer agendar/);
  assert.equal(sourceShouldReply, false);
});

test("resposta vazia ou saudacao padrao tenta uma vez e entrega o fallback uma unica vez", async () => {
  let calls = 0;
  const fallback = "Ola! Sou Ana. Recebi seu atendimento de Bruno e vou continuar com voce por aqui.";
  const destinationMessages: string[] = [];
  const opening = await generateAndDeliverForwardingOpening(async () => {
    calls += 1;
    return calls === 1 ? [] : ["Ola! Como posso te ajudar?"];
  }, fallback, async (blocks) => destinationMessages.push(...blocks));

  assert.equal(calls, 2);
  assert.equal(opening.usedFallback, true);
  assert.deepEqual(opening.blocks, [fallback]);
  assert.deepEqual(destinationMessages, [fallback]);
});

test("somente um encaminhamento entre IAs concluido suprime a resposta da origem", () => {
  assert.equal(shouldSuppressSourceReplyAfterAgentForwarding({ triggered: true, mode: "agent" }), true);
  assert.equal(shouldSuppressSourceReplyAfterAgentForwarding({ triggered: false, mode: "agent" }), false);
  assert.equal(shouldSuppressSourceReplyAfterAgentForwarding({ triggered: true, mode: "external_notification" }), false);
  assert.equal(shouldSuppressSourceReplyAfterAgentForwarding({ triggered: true, mode: "internal_company" }), false);
});
