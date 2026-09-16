import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { automationAiMessageInternals } from "../automation-ai-message-service.js";

test("valida resposta estruturada e limite efetivo da mensagem", () => {
  assert.deepEqual(
    automationAiMessageInternals.parseMessage('{"message":" Ola, Maria! "}', 40),
    { message: "Ola, Maria!" },
  );
  assert.throws(
    () => automationAiMessageInternals.parseMessage('{"message":"mensagem longa"}', 5),
    /excedeu/,
  );
});

test("migração mantém receipt como identidade e unicidade por funil e etapa", async () => {
  const sql = await readFile(new URL("../../../supabase/migrations/20260915190000_automation_ai_webhook_messages.sql", import.meta.url), "utf8");
  assert.match(sql, /automation_enrollments_webhook_receipt_idx[\s\S]*funnel_id, source_webhook_receipt_id/);
  assert.match(sql, /automation_executions_webhook_receipt_step_idx[\s\S]*source_webhook_receipt_id, step_id/);
  assert.doesNotMatch(sql, /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?crm\.lead_webhook_events/i);
  assert.match(sql, /lead_webhook_received_at/);
  assert.match(sql, /rpc_finalize_lead_webhook_receipt/);
});

test("contextos extensos são truncados antes de chegar ao modelo", () => {
  const result = automationAiMessageInternals.clipped("x".repeat(5_000), 4_000);
  assert.equal(result?.length, 4_001);
  assert.match(result ?? "", /…$/);
});
