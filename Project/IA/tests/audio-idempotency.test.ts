import assert from "node:assert/strict";
import test from "node:test";
import { resolveAudioDispatchFailure } from "../sdr-agent-gemini.js";

test("nao libera fallback de texto depois que o audio foi despachado", () => {
  assert.equal(resolveAudioDispatchFailure(true), "delivered_requires_reconciliation");
});

test("libera fallback antes do despacho do audio", () => {
  assert.equal(resolveAudioDispatchFailure(false), "fallback_to_text");
});
