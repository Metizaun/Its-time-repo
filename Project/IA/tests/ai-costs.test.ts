import assert from "node:assert/strict";
import test from "node:test";

import { openAiUsageLineItems, tokenLineItems } from "../ai-costs.js";

test("separa tokens de entrada e saida em line items", () => {
  assert.deepEqual(tokenLineItems(120, 35), [
    { metric: "input_text_token", quantity: 120 },
    { metric: "output_token", quantity: 35 },
  ]);
});

test("preserva chamada sem usage como evento unrated", () => {
  assert.deepEqual(tokenLineItems(null, null), [
    {
      metric: "request",
      quantity: 1,
      metadata: { token_usage_missing: true },
    },
  ]);
});

test("separa cache, audio, imagem e output do usage OpenAI", () => {
  assert.deepEqual(openAiUsageLineItems({
    input_tokens: 140,
    output_tokens: 35,
    input_tokens_details: {
      cached_tokens: 40,
      audio_tokens: 20,
      image_tokens: 30,
      text_tokens: 50,
    },
    output_tokens_details: { image_tokens: 10 },
  }), [
    { metric: "input_text_token", quantity: 50 },
    { metric: "cached_input_text_token", quantity: 40 },
    { metric: "input_audio_token", quantity: 20 },
    { metric: "input_image_token", quantity: 30 },
    { metric: "output_image_token", quantity: 10 },
    { metric: "output_token", quantity: 25 },
  ]);
});

test("usa duracao quando transcricao nao devolve tokens", () => {
  assert.deepEqual(openAiUsageLineItems(null, { durationSeconds: 90, modality: "audio" }), [
    { metric: "audio_minute", quantity: 1.5 },
  ]);
});
