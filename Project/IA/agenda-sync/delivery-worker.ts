import { randomUUID } from "node:crypto";
import https from "node:https";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { AesGcmSecretCipher, fromPostgresBytea } from "../integrations/secret-cipher.js";
import { resolvePublicWebhookTarget, UnsafeWebhookUrlError, type WebhookDnsLookup } from "../integrations/safe-webhook-url.js";
import { signWebhook } from "../integrations/webhook-security.js";

export type AgendaDeliveryRow = {
  id: string; connection_id: string; aces_id: number; event_id: string;
  event_type: string; envelope: Record<string, unknown>; attempt_count: number;
};

type DeliveryTarget = { outbound_url: string; status: string };
type Credential = { ciphertext: unknown; iv: unknown; auth_tag: unknown; key_version: string };
export type HttpResult = { status: number; retryAfter?: string; responseExcerpt?: string };

export function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function isRetryableDeliveryError(error: unknown) {
  return !(error instanceof UnsafeWebhookUrlError)
    && (!(error instanceof Error) || error.message !== "AGENDA_RESPONSE_TOO_LARGE");
}

export function retryDelayMs(attempt: number, random = Math.random) {
  const base = Math.min(60 * 60_000, 15_000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + random() * 0.5));
}

export function retryAt(input: { attempt: number; retryAfter?: string; nowMs?: number; random?: () => number }) {
  const now = input.nowMs ?? Date.now();
  if (input.retryAfter) {
    const seconds = Number(input.retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return new Date(now + Math.min(seconds * 1_000, 86_400_000));
    const date = Date.parse(input.retryAfter);
    if (Number.isFinite(date) && date > now) return new Date(Math.min(date, now + 86_400_000));
  }
  return new Date(now + retryDelayMs(input.attempt, input.random));
}

export async function postSignedAgendaWebhook(input: {
  url: string; body: Buffer; eventId: string; secret: string; timeoutMs: number;
  maxResponseBytes: number; lookup?: WebhookDnsLookup;
}): Promise<HttpResult> {
  const target = await resolvePublicWebhookTarget(input.url, { lookup: input.lookup });
  const address = target.addresses[0];
  if (!address) throw new Error("AGENDA_DNS_EMPTY");
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const signature = signWebhook(input.secret, timestamp, input.body);
  return new Promise((resolve, reject) => {
    const request = https.request(target.url, {
      method: "POST",
      servername: target.url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      headers: {
        "content-type": "application/json",
        "content-length": input.body.byteLength,
        "idempotency-key": input.eventId,
        "x-agenda-timestamp": timestamp,
        "x-agenda-signature": signature,
        "user-agent": "Its-Time-Agenda-Universal/1.0",
      },
    }, (response) => {
      let received = 0;
      response.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received > input.maxResponseBytes) request.destroy(new Error("AGENDA_RESPONSE_TOO_LARGE"));
      });
      response.on("end", () => resolve({
        status: response.statusCode ?? 502,
        retryAfter: Array.isArray(response.headers["retry-after"])
          ? response.headers["retry-after"][0] : response.headers["retry-after"],
        responseExcerpt: response.statusMessage?.replace(/[\r\n\t]/g, " ").slice(0, 200),
      }));
    });
    request.setTimeout(input.timeoutMs, () => request.destroy(new Error("AGENDA_HTTP_TIMEOUT")));
    request.on("error", reject);
    request.end(input.body);
  });
}

export class AgendaDeliveryWorker {
  private readonly agenda: SupabaseClient<any, "agenda_sync", any>;
  private readonly workerId = `agenda-${process.pid}-${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly config: {
    supabaseUrl: string; serviceRoleKey: string; encryptionKey: string; encryptionKeyVersion: string;
    pollMs?: number; batchSize?: number; leaseSeconds?: number; timeoutMs?: number;
    maxResponseBytes?: number; lookup?: WebhookDnsLookup;
    transport?: typeof postSignedAgendaWebhook;
  }) {
    this.agenda = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }, db: { schema: "agenda_sync" },
    });
  }

  start() {
    if (this.timer) return this;
    const pollMs = Math.max(this.config.pollMs ?? 2_000, 250);
    this.timer = setInterval(() => void this.processCycle().catch((error) => this.log("cycle_failed", error)), pollMs);
    void this.processCycle().catch((error) => this.log("initial_cycle_failed", error));
    console.log("[agenda-worker] started", { workerId: this.workerId, pollMs });
    return this;
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async processCycle() {
    if (this.running) return;
    this.running = true;
    try {
      while (true) {
        const { data, error } = await this.agenda.rpc("claim_delivery", {
          p_worker_id: this.workerId,
          p_lease_seconds: Math.min(Math.max(this.config.leaseSeconds ?? 60, 10), 600),
          p_limit: Math.min(Math.max(this.config.batchSize ?? 20, 1), 100),
        });
        if (error) throw error;
        const rows = (data ?? []) as AgendaDeliveryRow[];
        if (!rows.length) break;
        await Promise.all(rows.map((row) => this.deliver(row)));
      }
    } finally { this.running = false; }
  }

  private async deliver(row: AgendaDeliveryRow) {
    const startedAt = new Date();
    const leaseMs = (this.config.leaseSeconds ?? 60) * 1_000;
    const renewal = setInterval(() => void this.agenda.rpc("renew_delivery_lease", {
      p_outbox_id: row.id, p_worker_id: this.workerId,
      p_lease_seconds: Math.min(Math.max(this.config.leaseSeconds ?? 60, 10), 600),
    }), Math.max(5_000, Math.floor(leaseMs / 2)));
    try {
      const [{ data: connection, error: connectionError }, { data: credential, error: credentialError }] = await Promise.all([
        this.agenda.from("connections").select("outbound_url,status").eq("id", row.connection_id)
          .eq("aces_id", row.aces_id).single(),
        this.agenda.from("credentials").select("ciphertext,iv,auth_tag,key_version")
          .eq("connection_id", row.connection_id).eq("aces_id", row.aces_id).eq("direction", "outbound").single(),
      ]);
      if (connectionError) throw connectionError;
      if (credentialError) throw credentialError;
      const target = connection as DeliveryTarget;
      if (!target.outbound_url) throw new Error("AGENDA_OUTBOUND_URL_MISSING");
      const encrypted = credential as Credential;
      const secret = new AesGcmSecretCipher(this.config.encryptionKey, this.config.encryptionKeyVersion,
        "AGENDA_SECRETS_ENCRYPTION_KEY", "AGENDA_SECRETS_ENCRYPTION_KEY_VERSION").decrypt({
        ciphertext: fromPostgresBytea(encrypted.ciphertext), iv: fromPostgresBytea(encrypted.iv),
        authTag: fromPostgresBytea(encrypted.auth_tag), keyVersion: encrypted.key_version,
      });
      const result = await (this.config.transport ?? postSignedAgendaWebhook)({
        url: target.outbound_url, body: Buffer.from(JSON.stringify(row.envelope)), eventId: row.event_id,
        secret, timeoutMs: this.config.timeoutMs ?? 10_000,
        maxResponseBytes: this.config.maxResponseBytes ?? 65_536, lookup: this.config.lookup,
      });
      if (result.status >= 200 && result.status < 300) {
        const { error } = await this.agenda.rpc("finish_delivery", {
          p_outbox_id: row.id, p_worker_id: this.workerId, p_started_at: startedAt.toISOString(),
          p_duration_ms: Date.now() - startedAt.getTime(), p_http_status: result.status,
          p_response_excerpt: result.responseExcerpt ?? null,
        });
        if (error) throw error;
        this.log("delivered", undefined, row, { status: result.status });
        return;
      }
      await this.fail(row, startedAt, result.status, `http_${result.status}`,
        `Parceiro respondeu HTTP ${result.status}`, isRetryableStatus(result.status), result.retryAfter);
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 120) : "network_error";
      await this.fail(row, startedAt, null, code, "Falha de rede ou seguranca no destino", isRetryableDeliveryError(error));
    } finally { clearInterval(renewal); }
  }

  private async fail(row: AgendaDeliveryRow, startedAt: Date, status: number | null, code: string,
    message: string, retryable: boolean, retryAfter?: string) {
    const next = retryAt({ attempt: row.attempt_count, retryAfter });
    const { data, error } = await this.agenda.rpc("fail_delivery", {
      p_outbox_id: row.id, p_worker_id: this.workerId, p_started_at: startedAt.toISOString(),
      p_duration_ms: Date.now() - startedAt.getTime(), p_http_status: status,
      p_error_code: code, p_error_message: message, p_retryable: retryable,
      p_retry_at: retryable ? next.toISOString() : null,
    });
    if (error) throw error;
    this.log(String(data), undefined, row, { status, code });
  }

  private log(action: string, error?: unknown, row?: AgendaDeliveryRow, extra?: Record<string, unknown>) {
    const detail = error instanceof Error ? error.message : error ? String(error) : undefined;
    console.log("[agenda-worker]", { action, workerId: this.workerId, connectionId: row?.connection_id,
      eventId: row?.event_id, error: detail, ...extra });
  }
}

export function startAgendaDeliveryWorker(config: ConstructorParameters<typeof AgendaDeliveryWorker>[0]) {
  return new AgendaDeliveryWorker(config).start();
}
