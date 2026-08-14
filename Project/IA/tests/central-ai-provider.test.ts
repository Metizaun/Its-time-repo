import assert from "node:assert/strict";
import test from "node:test";
import type OpenAI from "openai";

import {
  AGENT_REPLY_RESPONSE_SCHEMA,
  generateCentralStructuredResponse,
} from "../central-ai-provider.js";

function fakeOpenAi(create: (request: Record<string, unknown>) => Promise<unknown>) {
  return {
    responses: { create },
  } as unknown as OpenAI;
}

test("uses GPT-5.6 Luna as the primary central provider", async () => {
  const capturedRequests: Record<string, unknown>[] = [];
  let fallbackCalls = 0;
  const openai = fakeOpenAi(async (request) => {
    capturedRequests.push(request);
    return {
      id: "resp_test",
      model: "gpt-5.6-luna",
      status: "completed",
      output_text: JSON.stringify({ reply_blocks: ["Olá!"], media_asset_key: null }),
      usage: { input_tokens: 25, output_tokens: 8 },
    };
  });

  const result = await generateCentralStructuredResponse({
    openai,
    openaiModel: "gpt-5.6-luna",
    prompt: "Responda ao cliente.",
    schemaName: "whatsapp_agent_reply",
    schema: AGENT_REPLY_RESPONSE_SCHEMA,
    maxOutputTokens: 1200,
    parse: JSON.parse,
    fallback: async () => {
      fallbackCalls += 1;
      throw new Error("fallback nao deveria ser chamado");
    },
  });

  assert.equal(result.provider, "openai");
  assert.equal(result.modelName, "gpt-5.6-luna");
  assert.equal(result.providerRequestId, "resp_test");
  assert.equal(result.usedFallback, false);
  assert.equal(result.tokensIn, 25);
  assert.equal(result.tokensOut, 8);
  assert.equal(fallbackCalls, 0);
  assert.equal(capturedRequests[0]?.model, "gpt-5.6-luna");
  assert.equal(capturedRequests[0]?.store, false);
  assert.deepEqual(capturedRequests[0]?.reasoning, { effort: "low" });
});

test("falls back to Gemini when the OpenAI request fails", async () => {
  let primaryError: unknown = null;
  const openai = fakeOpenAi(async () => {
    throw new Error("OpenAI indisponivel");
  });

  const result = await generateCentralStructuredResponse({
    openai,
    openaiModel: "gpt-5.6-luna",
    prompt: "Responda ao cliente.",
    schemaName: "whatsapp_agent_reply",
    schema: AGENT_REPLY_RESPONSE_SCHEMA,
    maxOutputTokens: 1200,
    parse: JSON.parse,
    fallback: async () => ({
      rawText: JSON.stringify({ reply_blocks: ["Resposta Gemini"], media_asset_key: null }),
      modelName: "gemini-2.5-flash",
      attempt: 1,
      tokensIn: 30,
      tokensOut: 10,
    }),
    onPrimaryError: (error) => {
      primaryError = error;
    },
  });

  assert.ok(primaryError instanceof Error);
  assert.equal(result.provider, "google_gemini");
  assert.equal(result.modelName, "gemini-2.5-flash");
  assert.equal(result.providerRequestId, null);
  assert.equal(result.usedFallback, true);
  assert.deepEqual(result.parsed, {
    reply_blocks: ["Resposta Gemini"],
    media_asset_key: null,
  });
});

test("falls back to Gemini when OpenAI returns invalid JSON", async () => {
  const openai = fakeOpenAi(async () => ({
    id: "resp_invalid",
    model: "gpt-5.6-luna",
    status: "completed",
    output_text: "nao e json",
    usage: { input_tokens: 10, output_tokens: 3 },
  }));

  const result = await generateCentralStructuredResponse({
    openai,
    openaiModel: "gpt-5.6-luna",
    prompt: "Responda ao cliente.",
    schemaName: "whatsapp_agent_reply",
    schema: AGENT_REPLY_RESPONSE_SCHEMA,
    maxOutputTokens: 1200,
    parse: JSON.parse,
    fallback: async () => ({
      rawText: JSON.stringify({ reply_blocks: ["Fallback válido"], media_asset_key: null }),
      modelName: "gemini-2.5-flash-lite",
      attempt: 2,
      tokensIn: 20,
      tokensOut: 6,
    }),
  });

  assert.equal(result.provider, "google_gemini");
  assert.equal(result.usedFallback, true);
  assert.equal(result.attempt, 2);
});

test("telemetry failure never invokes fallback or repeats the provider call", async () => {
  let providerCalls = 0;
  let fallbackCalls = 0;
  const openai = fakeOpenAi(async () => {
    providerCalls += 1;
    return {
      id: "resp_metering",
      model: "gpt-5.6-luna",
      status: "completed",
      output_text: JSON.stringify({ reply_blocks: ["Resposta unica"], media_asset_key: null }),
      usage: { input_tokens: 10, output_tokens: 4 },
    };
  });

  const result = await generateCentralStructuredResponse({
    openai,
    openaiModel: "gpt-5.6-luna",
    prompt: "Responda.",
    schemaName: "whatsapp_agent_reply",
    schema: AGENT_REPLY_RESPONSE_SCHEMA,
    maxOutputTokens: 1200,
    parse: JSON.parse,
    fallback: async () => {
      fallbackCalls += 1;
      throw new Error("fallback indevido");
    },
    onUsage: async () => {
      throw new Error("banco temporariamente indisponivel");
    },
  });

  assert.equal(result.provider, "openai");
  assert.equal(providerCalls, 1);
  assert.equal(fallbackCalls, 0);
});
