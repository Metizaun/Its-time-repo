import "./load-env.js";

import { fileURLToPath } from "node:url";
import { startAgendaDeliveryWorker } from "./agenda-sync/delivery-worker.js";
import { startAgendaResyncWorker } from "./agenda-sync/resync-worker.js";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} nao configurada`);
  return value;
}

export function runAgendaDeliveryWorker() {
  const common = {
    supabaseUrl: required("SUPABASE_URL"), serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  };
  const delivery = startAgendaDeliveryWorker({
    ...common,
    encryptionKey: required("AGENDA_SECRETS_ENCRYPTION_KEY"),
    encryptionKeyVersion: required("AGENDA_SECRETS_ENCRYPTION_KEY_VERSION"),
    pollMs: Number(process.env.AGENDA_WORKER_POLL_MS ?? 2_000),
    batchSize: Number(process.env.AGENDA_WORKER_BATCH_SIZE ?? 20),
    leaseSeconds: Number(process.env.AGENDA_WORKER_LEASE_SECONDS ?? 60),
    timeoutMs: Number(process.env.AGENDA_WORKER_HTTP_TIMEOUT_MS ?? 10_000),
    maxResponseBytes: Number(process.env.AGENDA_WORKER_MAX_RESPONSE_BYTES ?? 65_536),
  });
  const resync = startAgendaResyncWorker({
    ...common,
    pollMs: Number(process.env.AGENDA_RESYNC_WORKER_POLL_MS ?? 2_000),
    batchSize: Number(process.env.AGENDA_RESYNC_WORKER_BATCH_SIZE ?? 100),
    leaseSeconds: Number(process.env.AGENDA_RESYNC_WORKER_LEASE_SECONDS ?? 60),
  });
  return { delivery, resync };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runAgendaDeliveryWorker();
