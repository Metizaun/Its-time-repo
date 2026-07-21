import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPipelineClassificationPrompt,
  parsePipelineClassificationResponse,
  type PipelineClassifierStage,
} from "../pipeline-classifier.js";

const stages = [{ id: "entrada" }, { id: "negociacao" }];

test("aceita apenas etapa pertencente ao pipeline informado", () => {
  const result = parsePipelineClassificationResponse(
    JSON.stringify({
      summary: "Lead pediu preco e prazo.",
      suggested_stage_id: "outro-pipeline",
      should_apply_stage: true,
      confidence: 0.97,
      reason: "Interesse comercial.",
    }),
    stages,
  );

  assert.equal(result.suggestedStageId, null);
  assert.equal(result.shouldApplyStage, false);
  assert.equal(result.confidence, 0.97);
});

test("normaliza JSON cercado por markdown e limita confianca", () => {
  const result = parsePipelineClassificationResponse(
    `\`\`\`json
{"summary":"Resumo consolidado","suggested_stage_id":"negociacao","should_apply_stage":true,"confidence":7,"reason":"Evidencia suficiente"}
\`\`\``,
    stages,
  );

  assert.equal(result.summary, "Resumo consolidado");
  assert.equal(result.suggestedStageId, "negociacao");
  assert.equal(result.shouldApplyStage, true);
  assert.equal(result.confidence, 1);
});

test("nao aplica etapa quando o modelo recomenda apenas sugestao", () => {
  const result = parsePipelineClassificationResponse(
    JSON.stringify({
      summary: "Conversa ainda inconclusiva.",
      suggested_stage_id: "entrada",
      should_apply_stage: false,
      confidence: "invalida",
      reason: "Sem evidencia de avancar.",
    }),
    stages,
  );

  assert.equal(result.suggestedStageId, "entrada");
  assert.equal(result.shouldApplyStage, false);
  assert.equal(result.confidence, 0);
});

test("rejeita Em atendimento como destino mesmo quando o modelo devolve seu id", () => {
  const result = parsePipelineClassificationResponse(
    JSON.stringify({
      summary: "Conversa encerrada depois de uma pergunta.",
      suggested_stage_id: "atendimento",
      should_apply_stage: true,
      confidence: 0.99,
      reason: "Modelo tentou manter atendimento.",
      evidence: "Posso ajudar em algo mais?",
    }),
    [
      {
        id: "atendimento",
        name: "Em atendimento",
        classifierDestination: true,
      },
      {
        id: "remarketing",
        name: "Remarketing",
        classifierDestination: true,
      },
    ],
  );

  assert.equal(result.suggestedStageId, null);
  assert.equal(result.shouldApplyStage, false);
});

test("prompt pos-conversa omite etapa operacional das opcoes permitidas", () => {
  const pipelineStages: PipelineClassifierStage[] = [
    {
      id: "atendimento",
      name: "Em atendimento",
      category: "Aberto",
      position: 1,
      semanticKey: "active_service",
      classifierDestination: false,
      description: "Conversa ativa.",
      positiveSignals: [],
      negativeSignals: [],
      examples: [],
    },
    {
      id: "remarketing",
      name: "Remarketing",
      category: "Aberto",
      position: 5,
      semanticKey: "remarketing",
      classifierDestination: true,
      description: "Interesse interrompido.",
      positiveSignals: [],
      negativeSignals: [],
      examples: [],
    },
  ];

  const prompt = buildPipelineClassificationPrompt({
    mode: "full",
    lead: {
      id: "lead-1",
      name: "Lead teste",
      currentStageId: "atendimento",
    },
    pipeline: { id: "pipeline-1", name: "Pipeline principal" },
    stages: pipelineStages,
    messages: [
      {
        id: "message-1",
        content: "Vou pensar e retorno.",
        direction: "inbound",
        sourceType: "lead",
        sentAt: "2026-07-16T12:00:00.000Z",
      },
    ],
    previousSummary: "",
    previousConfidence: null,
    originStage: { id: "remarketing", name: "Remarketing" },
    cutoffAt: "2026-07-16T14:00:00.000Z",
  });

  const allowedStagesLine = prompt
    .split("\n")
    .find((line) => line.startsWith("Etapas permitidas:"));

  assert.ok(allowedStagesLine);
  assert.match(prompt, /Etapa de origem:/);
  assert.match(prompt, /devolva o lead para a Etapa de origem/);
  assert.doesNotMatch(allowedStagesLine, /atendimento/);
  assert.match(allowedStagesLine, /remarketing/);
  assert.match(prompt, /conversa já não está ativa/);
});
