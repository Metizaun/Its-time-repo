import assert from "node:assert/strict";
import test from "node:test";

import { AgendaResyncWorker } from "../agenda-sync/resync-worker.js";

test("worker processa lotes ate esvaziar e finaliza execucoes", async () => {
  const calls: string[] = [];
  let batches = 2;
  const worker = new AgendaResyncWorker({
    supabaseUrl: "http://localhost", serviceRoleKey: "test", batchSize: 100,
    client: {
      async rpc(name: string) {
        calls.push(name);
        if (name === "claim_resync_batch") return { data: batches-- > 0 ? { processed: 100 } : null, error: null };
        return { data: 1, error: null };
      },
    } as never,
  });
  await worker.processCycle();
  assert.deepEqual(calls, ["claim_resync_batch", "claim_resync_batch", "claim_resync_batch", "finalize_resyncs"]);
});

test("worker libera o ciclo depois de erro para permitir recuperacao por lease", async () => {
  let attempts = 0;
  const worker = new AgendaResyncWorker({
    supabaseUrl: "http://localhost", serviceRoleKey: "test",
    client: {
      async rpc() {
        attempts += 1;
        if (attempts === 1) return { data: null, error: new Error("database unavailable") };
        return { data: null, error: null };
      },
    } as never,
  });
  await assert.rejects(worker.processCycle(), /database unavailable/);
  await worker.processCycle();
  assert.equal(attempts, 3);
});
