import assert from "node:assert/strict";
import test from "node:test";
import { AgentManager, resolveAudioDispatchFailure } from "../sdr-agent-gemini.js";

test("nao libera fallback de texto depois que o audio foi despachado", () => {
  assert.equal(resolveAudioDispatchFailure(true), "delivered_requires_reconciliation");
});

test("libera fallback antes do despacho do audio", () => {
  assert.equal(resolveAudioDispatchFailure(false), "fallback_to_text");
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
