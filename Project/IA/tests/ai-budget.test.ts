import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AiBudgetBlockedError,
  aiBudgetInternals,
  checkAiBudget,
  invalidateAiBudgetCache,
  requireAiBudget,
} from "../ai-budget.js";

function clientWithRpc(rpc: () => Promise<{ data: unknown; error: unknown }>) {
  return { rpc } as unknown as SupabaseClient<any, any, any>;
}

test("cacheia a decisao por conta e invalida sob demanda", async () => {
  aiBudgetInternals.cache.clear();
  let calls = 0;
  const client = clientWithRpc(async () => {
    calls += 1;
    return { data: { allowed: true, status: "ok", consumed_brl: 2, budget_brl: 10, pct: 20 }, error: null };
  });
  await checkAiBudget(client, 10);
  await checkAiBudget(client, 10);
  assert.equal(calls, 1);
  invalidateAiBudgetCache(10);
  await checkAiBudget(client, 10);
  assert.equal(calls, 2);
});

test("falha de consulta libera em fail-open", async () => {
  aiBudgetInternals.cache.clear();
  const decision = await checkAiBudget(clientWithRpc(async () => ({ data: null, error: new Error("offline") })), 11);
  assert.equal(decision.allowed, true);
  assert.equal(decision.status, "fail_open");
});

test("guard rejeita uma nova chamada quando o teto foi atingido", async () => {
  aiBudgetInternals.cache.clear();
  const client = clientWithRpc(async () => ({
    data: { allowed: false, status: "blocked", consumed_brl: 100, budget_brl: 100, pct: 100 },
    error: null,
  }));
  await assert.rejects(() => requireAiBudget(client, 12), AiBudgetBlockedError);
});
