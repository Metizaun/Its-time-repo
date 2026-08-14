import type OpenAI from "openai";
import {
  openAiUsageLineItems,
  tokenLineItems,
  type AiUsageLineItem,
} from "./ai-costs.js";

export type CentralAiProvider = "openai" | "google_gemini";

export type CentralAiExecutionResult<TParsed> = {
  parsed: TParsed;
  rawText: string;
  provider: CentralAiProvider;
  providerRequestId: string | null;
  modelName: string;
  usedFallback: boolean;
  attempt: number;
  tokensIn: number | null;
  tokensOut: number | null;
  usageLineItems: AiUsageLineItem[];
};

export type UnparsedFallbackResult = {
  rawText: string;
  modelName: string;
  attempt: number;
  tokensIn: number | null;
  tokensOut: number | null;
  usageLineItems?: AiUsageLineItem[];
};

type GenerateCentralStructuredResponseInput<TParsed> = {
  openai: OpenAI | null;
  openaiModel: string;
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  parse: (text: string) => TParsed;
  fallback: () => Promise<UnparsedFallbackResult>;
  onPrimaryError?: (error: unknown) => void;
  onUsage?: (result: CentralAiExecutionResult<TParsed>) => Promise<void> | void;
};

const nullableStringSchema = {
  anyOf: [{ type: "string" }, { type: "null" }],
};

const confidenceSchema = {
  type: "number",
  minimum: 0,
  maximum: 1,
};

export const CRM_ANALYSIS_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reply_blocks: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
    },
    stage_decision: {
      type: "object",
      properties: {
        stage_id: nullableStringSchema,
        reason: { type: "string" },
      },
      required: ["stage_id", "reason"],
      additionalProperties: false,
    },
    tag_decisions: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          tag_id: nullableStringSchema,
          should_apply: { type: "boolean" },
          reason: { type: "string" },
          confidence: confidenceSchema,
        },
        required: ["tag_id", "should_apply", "reason", "confidence"],
        additionalProperties: false,
      },
    },
    attendance_summary: {
      type: "object",
      properties: {
        text: { type: "string" },
        reason: { type: "string" },
        confidence: confidenceSchema,
      },
      required: ["text", "reason", "confidence"],
      additionalProperties: false,
    },
    lead_verification: {
      type: "object",
      properties: {
        checked: { type: "boolean" },
        reason: { type: "string" },
      },
      required: ["checked", "reason"],
      additionalProperties: false,
    },
    native_followup: {
      type: "object",
      properties: {
        should_schedule: { type: "boolean" },
        needs_clarification: { type: "boolean" },
        scheduled_at: nullableStringSchema,
        requested_text: { type: "string" },
        message_text: { type: "string" },
        confidence: confidenceSchema,
        reason: { type: "string" },
      },
      required: [
        "should_schedule",
        "needs_clarification",
        "scheduled_at",
        "requested_text",
        "message_text",
        "confidence",
        "reason",
      ],
      additionalProperties: false,
    },
    visagism: {
      type: "object",
      properties: {
        requested: { type: "boolean" },
        desired_perception_answer: nullableStringSchema,
        desired_feeling_answer: nullableStringSchema,
        should_start: { type: "boolean" },
        reason: { type: "string" },
      },
      required: [
        "requested",
        "desired_perception_answer",
        "desired_feeling_answer",
        "should_start",
        "reason",
      ],
      additionalProperties: false,
    },
    agenda_request: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: [
            "none",
            "company_info",
            "professionals",
            "price",
            "availability",
            "book",
            "reschedule",
            "cancel",
          ],
        },
        companyQuery: nullableStringSchema,
        professionalQuery: nullableStringSchema,
        serviceQuery: nullableStringSchema,
        dateFrom: nullableStringSchema,
        dateTo: nullableStringSchema,
        period: {
          anyOf: [
            { type: "string", enum: ["morning", "afternoon", "evening"] },
            { type: "null" },
          ],
        },
        optionReference: nullableStringSchema,
        confirmation: {
          type: "string",
          enum: ["unknown", "yes", "no"],
        },
      },
      required: [
        "intent",
        "companyQuery",
        "professionalQuery",
        "serviceQuery",
        "dateFrom",
        "dateTo",
        "period",
        "optionReference",
        "confirmation",
      ],
      additionalProperties: false,
    },
    confidence: confidenceSchema,
    reason: { type: "string" },
    should_apply_stage: { type: "boolean" },
    should_pause: { type: "boolean" },
    should_handoff: { type: "boolean" },
    handoff_reason: { type: "string" },
    forwarding_destination_key: nullableStringSchema,
    subagent_key: nullableStringSchema,
    return_to_parent: { type: "boolean" },
    complete_after_reply: { type: "boolean" },
  },
  required: [
    "reply_blocks",
    "stage_decision",
    "tag_decisions",
    "attendance_summary",
    "lead_verification",
    "native_followup",
    "visagism",
    "agenda_request",
    "confidence",
    "reason",
    "should_apply_stage",
    "should_pause",
    "should_handoff",
    "handoff_reason",
    "forwarding_destination_key",
    "subagent_key",
    "return_to_parent",
    "complete_after_reply",
  ],
  additionalProperties: false,
};

export const AGENT_REPLY_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    reply_blocks: {
      type: "array",
      items: { type: "string" },
      maxItems: 3,
    },
    media_asset_key: nullableStringSchema,
  },
  required: ["reply_blocks", "media_asset_key"],
  additionalProperties: false,
};

export async function generateCentralStructuredResponse<TParsed>(
  input: GenerateCentralStructuredResponseInput<TParsed>,
): Promise<CentralAiExecutionResult<TParsed>> {
  let selected: CentralAiExecutionResult<TParsed>;
  try {
    if (!input.openai) {
      throw new Error("OPENAI_API_KEY nao configurada no backend");
    }

    const response = await input.openai.responses.create({
      model: input.openaiModel,
      input: input.prompt,
      store: false,
      reasoning: { effort: "low" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: input.schema,
        },
      },
      max_output_tokens: input.maxOutputTokens,
    });

    const rawText = response.output_text.trim();
    if (!rawText) {
      throw new Error(`OpenAI retornou resposta vazia (status=${response.status})`);
    }

    selected = {
      parsed: input.parse(rawText),
      rawText,
      provider: "openai",
      providerRequestId: response.id,
      modelName: response.model || input.openaiModel,
      usedFallback: false,
      attempt: 1,
      tokensIn: response.usage?.input_tokens ?? null,
      tokensOut: response.usage?.output_tokens ?? null,
      usageLineItems: openAiUsageLineItems(response.usage),
    };
  } catch (error) {
    input.onPrimaryError?.(error);
    const fallback = await input.fallback();
    selected = {
      parsed: input.parse(fallback.rawText),
      rawText: fallback.rawText,
      provider: "google_gemini",
      providerRequestId: null,
      modelName: fallback.modelName,
      usedFallback: true,
      attempt: fallback.attempt,
      tokensIn: fallback.tokensIn,
      tokensOut: fallback.tokensOut,
      usageLineItems: fallback.usageLineItems ?? tokenLineItems(
        fallback.tokensIn,
        fallback.tokensOut,
      ),
    };
  }

  if (input.onUsage) {
    try {
      await input.onUsage(selected);
    } catch (error) {
      console.warn("[central-ai] Falha de telemetria apos conclusao do provider:", {
        provider: selected.provider,
        model: selected.modelName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return selected;
}
