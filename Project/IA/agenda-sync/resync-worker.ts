import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class AgendaResyncWorker {
  private readonly agenda: SupabaseClient<any, "agenda_sync", any>;
  private readonly workerId = `agenda-resync-${process.pid}-${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly config: {
    supabaseUrl: string;
    serviceRoleKey: string;
    pollMs?: number;
    batchSize?: number;
    leaseSeconds?: number;
    client?: SupabaseClient<any, "agenda_sync", any>;
  }) {
    this.agenda = config.client ?? createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "agenda_sync" },
    });
  }

  start() {
    if (this.timer) return this;
    const pollMs = Math.max(this.config.pollMs ?? 2_000, 250);
    this.timer = setInterval(() => void this.processCycle().catch((error) => this.log("cycle_failed", error)), pollMs);
    void this.processCycle().catch((error) => this.log("initial_cycle_failed", error));
    this.log("started");
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async processCycle() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const { data, error } = await this.agenda.rpc("claim_resync_batch", {
          p_worker_id: this.workerId,
          p_lease_seconds: Math.min(Math.max(this.config.leaseSeconds ?? 60, 10), 600),
          p_limit: Math.min(Math.max(this.config.batchSize ?? 100, 1), 100),
        });
        if (error) throw error;
        if (!data) break;
        this.log("batch_processed", undefined, data as Record<string, unknown>);
      }
      const { data, error } = await this.agenda.rpc("finalize_resyncs");
      if (error) throw error;
      if (Number(data) > 0) this.log("runs_completed", undefined, { count: data });
    } finally {
      this.running = false;
    }
  }

  private log(action: string, error?: unknown, details?: Record<string, unknown>) {
    console.log("[agenda-resync-worker]", {
      action,
      workerId: this.workerId,
      error: error instanceof Error ? error.message : error ? String(error) : undefined,
      ...details,
    });
  }
}

export function startAgendaResyncWorker(config: ConstructorParameters<typeof AgendaResyncWorker>[0]) {
  return new AgendaResyncWorker(config).start();
}
