import "./load-env.js";

import { fileURLToPath } from "node:url";

import { startCollectionWorker } from "./collections/collection-worker.js";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} nao configurada`);
  return value;
}

export function runCollectionWorker() {
  return startCollectionWorker({
    supabaseUrl: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    pollMs: Number(process.env.COLLECTION_WORKER_POLL_MS ?? 5_000),
    batchSize: Number(process.env.COLLECTION_WORKER_BATCH_SIZE ?? 50),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runCollectionWorker();
