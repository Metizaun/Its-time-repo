import "./load-env.js";

import { fileURLToPath } from "node:url";
import { startMediaCleanupWorker } from "./media-cleanup-worker.js";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} nao configurada`);
  return value;
}

export function runMediaCleanupWorker() {
  return startMediaCleanupWorker({
    supabaseUrl: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    pollMs: Number(process.env.MEDIA_CLEANUP_WORKER_POLL_MS ?? 86_400_000),
    batchSize: Number(process.env.MEDIA_CLEANUP_WORKER_BATCH_SIZE ?? 100),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runMediaCleanupWorker();
