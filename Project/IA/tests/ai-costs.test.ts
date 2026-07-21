import assert from "node:assert/strict";
import test from "node:test";

import { tokenLineItems } from "../ai-costs.js";

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
