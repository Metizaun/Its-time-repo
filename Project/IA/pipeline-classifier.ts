import { GoogleGenerativeAI } from "@google/generative-ai";

type JsonRecord = Record<string, unknown>;

export type PipelineClassifierStage = {
  id: string;
  name: string;
  category: string;
  position: number;
  semanticKey: string | null;
  classifierDestination: boolean;
  description: string;
  positiveSignals: unknown[];
  negativeSignals: unknown[];
  examples: unknown[];
};

export type PipelineClassifierMessage = {
  id: string;
  content: string;
  direction: string;
  sourceType: string;
  sentAt: string;
};

export type PipelineClassificationInput = {
  mode: "full" | "incremental";
  lead: {
    id: string;
    name: string | null;
    currentStageId: string | null;
  };
  pipeline: {
    id: string;
    name: string;
  };
  stages: PipelineClassifierStage[];
  messages: PipelineClassifierMessage[];
  previousSummary: string;
  previousConfidence: number | null;
  originStage: {
    id: string;
    name: string;
  } | null;
  cutoffAt: string;
};

export type PipelineClassificationResult = {
  summary: string;
  suggestedStageId: string | null;
  shouldApplyStage: boolean;
  confidence: number;
  reason: string;
  evidence: string;
  modelName: string;
  tokensInput: number | null;
  tokensOutput: number | null;
  rawDecision: JsonRecord;
};

export type PipelineClassifierConfig = {
  apiKey: string;
  modelName?: string;
  fallbackModels?: string[];
  maxRetries?: number;
  retryBaseDelayMs?: number;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampConfidence(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.min(1, numberValue));
}

function cleanJson(text: string) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");
}

function normalizeStageName(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR");
}

export function isPipelineClassifierDestination(
  stage: Pick<PipelineClassifierStage, "name"> &
    Partial<Pick<PipelineClassifierStage, "classifierDestination">>,
) {
  const normalizedName = normalizeStageName(stage.name);
  return (
    stage.classifierDestination !== false &&
    normalizedName !== "atendimento" &&
    normalizedName !== "em atendimento"
  );
}

export function parsePipelineClassificationResponse(
  rawText: string,
  stages: Array<
    Pick<PipelineClassifierStage, "id"> &
      Partial<Pick<PipelineClassifierStage, "name" | "classifierDestination">>
  >,
) {
  const parsed = asRecord(JSON.parse(cleanJson(rawText)));
  const validStageIds = new Set(
    stages
      .filter(
        (stage) =>
          stage.classifierDestination !== false &&
          (stage.name === undefined ||
            isPipelineClassifierDestination({
              name: stage.name,
              classifierDestination: stage.classifierDestination,
            })),
      )
      .map((stage) => stage.id),
  );
  const requestedStageId = asString(parsed.suggested_stage_id) || null;
  const suggestedStageId =
    requestedStageId && validStageIds.has(requestedStageId)
      ? requestedStageId
      : null;

  return {
    summary: asString(parsed.summary).slice(0, 1200),
    suggestedStageId,
    shouldApplyStage:
      Boolean(parsed.should_apply_stage) && suggestedStageId !== null,
    confidence: clampConfidence(parsed.confidence),
    reason: asString(parsed.reason).slice(0, 2000),
    evidence: asString(parsed.evidence).slice(0, 2000),
    rawDecision: parsed,
  };
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function conversationRole(message: PipelineClassifierMessage) {
  if (message.sourceType === "lead" || message.direction === "inbound")
    return "LEAD";
  if (message.sourceType === "human") return "ATENDENTE";
  if (message.sourceType === "ai") return "IA";
  if (message.sourceType === "automation") return "AUTOMACAO";
  return "OPERACAO";
}

function buildConversation(messages: PipelineClassifierMessage[]) {
  const lines = messages.map((message) => {
    const content = message.content.trim().slice(0, 4000);
    return `[${message.sentAt}] ${conversationRole(message)}: ${content}`;
  });
  const full = lines.join("\n");
  const maxCharacters = 500_000;
  if (full.length <= maxCharacters) return full;

  const prefix = full.slice(0, 100_000);
  const suffix = full.slice(-(maxCharacters - 100_200));
  return `${prefix}\n[CONTEUDO INTERMEDIARIO OMITIDO POR LIMITE OPERACIONAL]\n${suffix}`;
}

export function buildPipelineClassificationPrompt(
  input: PipelineClassificationInput,
) {
  const currentStage =
    input.stages.find((stage) => stage.id === input.lead.currentStageId) ??
    null;
  const stages = input.stages
    .filter(isPipelineClassifierDestination)
    .map((stage) => ({
      id: stage.id,
      name: stage.name,
      category: stage.category,
      position: stage.position,
      semantic_key: stage.semanticKey,
      description: stage.description,
      positive_signals: stage.positiveSignals,
      negative_signals: stage.negativeSignals,
      examples: stage.examples,
    }));

  if (stages.length === 0) {
    throw new Error("Pipeline sem etapa permitida para classificacao");
  }

  return [
    "Você é o classificador interno pós-conversa do pipeline CRM. Não responda ao lead.",
    "A análise só é executada depois da janela de inatividade; portanto, a conversa já não está ativa neste momento.",
    "A etapa operacional Em atendimento não é um destino permitido e não aparece em Etapas permitidas.",
    "Escolha exatamente um suggested_stage_id entre as Etapas permitidas.",
    "Quando houver Etapa de origem, ela representa onde o lead estava antes da nova mensagem abrir este atendimento.",
    "Se a conversa nova nao trouxer evidencia suficiente para mudar o funil, devolva o lead para a Etapa de origem.",
    "Analise o contexto e a intenção real, nunca palavras isoladas.",
    "Dê maior peso às mensagens recentes e às mensagens do lead. Mensagens automáticas da empresa não comprovam avanço do lead.",
    "Não considere silêncio como rejeição e não invente intenção, compromisso ou fato ausente.",
    "Siga esta prioridade de decisão:",
    "1. Compromisso explícito de comprar, visitar, agendar, reservar, aceitar orçamento ou prosseguir: etapa semântica won/Fechado.",
    "2. Recusa explícita, desistência, bloqueio, compra em outro lugar ou impossibilidade definitiva: etapa semântica lost/Perdido.",
    "3. Conversa encerrada após pedido ou envio de preço, orçamento, parcelas ou condições: etapa semântica quote/Orçamento.",
    "4. Interesse comercial anterior interrompido sem decisão, sem foco principal em preço e sem rejeição: etapa semântica remarketing/Remarketing.",
    "5. Use etapas personalizadas somente quando a descrição e as evidências fornecidas corresponderem claramente ao caso.",
    "Novo só é válido quando o histórico inteiro está vazio. Como esta execução possui mensagens, normalmente não será a escolha correta.",
    "Fechado exige decisão ou compromisso claro; curiosidade, interesse vago, talvez ou 'vou pensar' não bastam.",
    "Perdido exige rejeição clara ou impossibilidade real; ausência de resposta nunca basta.",
    "Se a etapa escolhida for diferente da etapa atual, use should_apply_stage=true. Se for a mesma, use false.",
    "Retorne somente JSON válido com summary, suggested_stage_id, should_apply_stage, confidence, reason e evidence.",
    "confidence deve estar entre 0 e 1.",
    "summary deve consolidar a conversa inteira em até 1200 caracteres.",
    "reason deve explicar objetivamente a regra aplicada; evidence deve citar de forma curta a mensagem determinante.",
    "No modo incremental, combine o resumo anterior com as mensagens novas; não trate o trecho incremental como se fosse todo o histórico.",
    "",
    `Modo: ${input.mode}`,
    `Cutoff: ${input.cutoffAt}`,
    `Pipeline: ${JSON.stringify(input.pipeline)}`,
    `Lead: ${JSON.stringify(input.lead)}`,
    `Etapa atual: ${currentStage ? JSON.stringify({ id: currentStage.id, name: currentStage.name, semantic_key: currentStage.semanticKey }) : "(não encontrada)"}`,
    `Etapa de origem: ${input.originStage ? JSON.stringify(input.originStage) : "(sem origem registrada)"}`,
    `Resumo anterior: ${input.previousSummary || "(sem resumo anterior)"}`,
    `Confiança anterior: ${input.previousConfidence ?? "(sem confiança anterior)"}`,
    `Etapas permitidas: ${JSON.stringify(stages)}`,
    "",
    `Mensagens ${input.mode === "full" ? "da conversa" : "novas"}:`,
    buildConversation(input.messages),
  ].join("\n");
}

export class PipelineClassifier {
  private readonly gemini: GoogleGenerativeAI;
  private readonly models: string[];
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(config: PipelineClassifierConfig) {
    this.gemini = new GoogleGenerativeAI(config.apiKey);
    this.models = [
      config.modelName?.trim() || "gemini-3.1-flash-lite",
      ...(config.fallbackModels ?? [])
        .map((model) => model.trim())
        .filter(Boolean),
    ].filter((model, index, values) => values.indexOf(model) === index);
    const configuredMaxRetries = Number(config.maxRetries);
    const configuredRetryBaseDelayMs = Number(config.retryBaseDelayMs);
    this.maxRetries = Number.isFinite(configuredMaxRetries)
      ? Math.max(1, Math.floor(configuredMaxRetries))
      : 3;
    this.retryBaseDelayMs = Number.isFinite(configuredRetryBaseDelayMs)
      ? Math.max(250, configuredRetryBaseDelayMs)
      : 1000;
  }

  async classify(
    input: PipelineClassificationInput,
  ): Promise<PipelineClassificationResult> {
    const prompt = buildPipelineClassificationPrompt(input);
    let lastError: unknown = null;

    for (const modelName of this.models) {
      const model = this.gemini.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1200,
          responseMimeType: "application/json",
        },
      });

      for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
        try {
          const result = await model.generateContent(prompt);
          const rawText = result.response.text();
          const decision = parsePipelineClassificationResponse(
            rawText,
            input.stages,
          );
          const usage = asRecord(
            (result.response as unknown as JsonRecord).usageMetadata,
          );

          return {
            ...decision,
            modelName,
            tokensInput:
              typeof usage.promptTokenCount === "number"
                ? usage.promptTokenCount
                : null,
            tokensOutput:
              typeof usage.candidatesTokenCount === "number"
                ? usage.candidatesTokenCount
                : null,
          };
        } catch (error) {
          lastError = error;
          if (attempt < this.maxRetries) {
            await wait(this.retryBaseDelayMs * 2 ** (attempt - 1));
          }
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Nao foi possivel classificar a conversa");
  }
}
