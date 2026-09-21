import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentManager,
  DEFAULT_AI_AUDIO_SELECTION_RATE,
  MAX_AI_AUDIO_SELECTION_RATE,
  normalizeAiAudioSelectionRate,
  resolveAudioDispatchFailure,
  shouldSelectAiAudio,
} from "../sdr-agent-gemini.js";

test("nao libera fallback de texto depois que o audio foi despachado", () => {
  assert.equal(resolveAudioDispatchFailure(true), "delivered_requires_reconciliation");
});

test("libera fallback antes do despacho do audio", () => {
  assert.equal(resolveAudioDispatchFailure(false), "fallback_to_text");
});

test("normaliza a frequencia de audio como fracao entre 0 e 1", () => {
  assert.equal(normalizeAiAudioSelectionRate(undefined), DEFAULT_AI_AUDIO_SELECTION_RATE);
  assert.equal(normalizeAiAudioSelectionRate(0), 0);
  assert.equal(normalizeAiAudioSelectionRate(0.125), 0.125);
  assert.equal(normalizeAiAudioSelectionRate(MAX_AI_AUDIO_SELECTION_RATE), MAX_AI_AUDIO_SELECTION_RATE);
  assert.throws(() => normalizeAiAudioSelectionRate(-0.01), /entre 0% e 22,5%/);
  assert.throws(() => normalizeAiAudioSelectionRate(0.226), /entre 0% e 22,5%/);
});

test("pedido explicito de audio ignora o sorteio da frequencia", () => {
  assert.equal(shouldSelectAiAudio({
    runId: "run",
    agentId: "agent",
    leadId: "lead",
    rate: 0,
    eligible: true,
    explicitAudioRequest: true,
  }), true);
  assert.equal(shouldSelectAiAudio({
    runId: "run",
    agentId: "agent",
    leadId: "lead",
    rate: 1,
    eligible: false,
    explicitAudioRequest: true,
  }), false);
});

test("configuracao de audio persiste readiness e habilitacao atomicamente", async () => {
  const manager = Object.create(AgentManager.prototype) as any;
  const updates: Array<Record<string, unknown>> = [];
  const current = {
    id: "tool-audio",
    config: {},
    is_enabled: false,
    readiness: "needs_config",
  };

  manager.ensureAdmin = () => undefined;
  manager.getAgentForAccount = async () => ({ id: "agent-audio" });
  manager.elevenLabsTtsEnabled = true;
  manager.elevenLabsApiKey = "test-key";
  manager.validateElevenLabsVoice = async () => undefined;
  manager.syncPlatformToolReadiness = async () => undefined;
  manager.syncDataToolReadiness = async () => undefined;
  manager.listAgentTools = async () => [{ key: "ai_audio", is_enabled: true, readiness: "ready" }];
  manager.agentsClient = {
    from: (table: string) => {
      if (table !== "agent_tools") throw new Error(`unexpected table: ${table}`);
      let updateEqCalls = 0;
      return {
        select: () => ({
          eq: function eq() { return this; },
          maybeSingle: async () => ({ data: current, error: null }),
        }),
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          return {
            eq: function eq() {
              updateEqCalls += 1;
              return updateEqCalls >= 2 ? Promise.resolve({ error: null }) : this;
            },
          };
        },
      };
    },
  };

  await manager.updateAgentTool(
    { acesId: 1, crmUserId: "admin", role: "ADMIN", accessToken: "token" },
    "agent-audio",
    "ai_audio",
    { config: { voiceId: "voice-1" } },
  );

  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.readiness, "ready");
  assert.equal(updates[0]?.is_enabled, true);
  assert.equal((updates[0]?.config as Record<string, unknown>)?.voiceId, "voice-1");
});
