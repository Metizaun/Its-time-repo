import assert from "node:assert/strict";
import test from "node:test";

import {
  requirePipelineWorkerEnabled,
  PipelineWorkerRuntimeStatus,
  startPipelineWorkerIfEnabled,
} from "../pipeline-worker-runtime.js";

test("production requires the pipeline worker flag to be true", () => {
  assert.throws(
    () =>
      requirePipelineWorkerEnabled({
        nodeEnv: "production",
      }),
    /PIPELINE_WORKER_ENABLED=true/,
  );
  assert.throws(
    () =>
      requirePipelineWorkerEnabled({
        nodeEnv: "production",
        pipelineWorkerEnabled: "false",
      }),
    /PIPELINE_WORKER_ENABLED=true/,
  );
  let startCalls = 0;
  const stopWorker = startPipelineWorkerIfEnabled(
    requirePipelineWorkerEnabled({
      nodeEnv: "production",
      pipelineWorkerEnabled: "true",
    }),
    () => {
      startCalls += 1;
      return () => {};
    },
  );

  assert.equal(startCalls, 1);
  assert.equal(typeof stopWorker, "function");
});

test("non-production environments can keep the pipeline worker disabled", () => {
  assert.equal(
    requirePipelineWorkerEnabled({
      nodeEnv: "development",
    }),
    false,
  );
});

test("health status reports worker start and the latest cycle", () => {
  const worker = new PipelineWorkerRuntimeStatus(true);
  assert.deepEqual(worker.getStatus(), {
    enabled: true,
    started: false,
    lastCycleAt: null,
  });

  worker.markStarted();
  worker.markCycleStarted(new Date("2026-09-29T20:00:00.000Z"));
  assert.deepEqual(worker.getStatus(), {
    enabled: true,
    started: true,
    lastCycleAt: "2026-09-29T20:00:00.000Z",
  });

  worker.markStopped();
  assert.equal(worker.getStatus().started, false);
});
