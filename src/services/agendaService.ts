import { deleteCrmBackend, getCrmBackend, patchCrmBackend, postCrmBackend } from "@/services/crmBackend";

const base = "/api/admin/integrations/agenda/v1/connections";

export type AgendaConnectionStatus = "draft" | "syncing" | "active" | "paused" | "error" | "disabled";
export type AgendaConnection = {
  id: string;
  publicId: string;
  name: string;
  outboundUrl: string;
  scopeMode: "all_resources" | "selected_scope";
  unitIds: string[];
  assignmentIds: string[];
  status: AgendaConnectionStatus;
  defaultTimezone: string;
  testedAt: string | null;
  resyncStartedAt: string | null;
  resyncCompletedAt: string | null;
  lastDeliveredAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  metrics?: AgendaMetrics | null;
  resync?: AgendaResync | null;
};

export type AgendaMetrics = {
  pending_count?: number;
  dead_letter_count?: number;
  delivered_count?: number;
  retry_count?: number;
  average_duration_ms?: number | null;
};
export type AgendaResync = {
  id: string; status: string; stage: string; snapshot_count: number; delta_count: number;
  started_at: string; completed_at: string | null; error_code: string | null; error_message: string | null;
};
export type AgendaScopeOptions = {
  units: Array<{ id: string; name: string; city: string; state: string; is_active: boolean }>;
  assignments: Array<{ id: string; location_name: string; is_active: boolean; professional_id: string; professionals?: { name?: string } | null }>;
};
export type AgendaConnectionInput = Pick<AgendaConnection, "name" | "outboundUrl" | "scopeMode" | "unitIds" | "assignmentIds" | "defaultTimezone">;
export type AgendaSecrets = { inboundSecret: string; outboundSecret: string };
export type AgendaDelivery = Record<string, unknown> & { id: string; event_id: string; outcome: string; created_at: string; http_status?: number | null };
export type AgendaDeadLetter = Record<string, unknown> & { id: string; event_id: string; event_type: string; sequence: number; dead_lettered_at: string; last_error_message?: string | null };
export type AgendaAudit = { id: string; actor_id: string | null; action: string; details: Record<string, unknown>; created_at: string };

function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") query.set(key, String(value));
  const rendered = query.toString();
  return rendered ? `?${rendered}` : "";
}

export async function listAgendaConnections() {
  return (await getCrmBackend<{ connections: AgendaConnection[] }>(base)).connections;
}

export async function getAgendaScopeOptions() {
  return getCrmBackend<AgendaScopeOptions>(`${base}/scope-options`);
}

export async function createAgendaConnection(input: AgendaConnectionInput) {
  return postCrmBackend<{ connection: AgendaConnection } & AgendaSecrets>(base, input);
}

export async function updateAgendaConnection(id: string, input: Partial<AgendaConnectionInput>) {
  return (await patchCrmBackend<{ connection: AgendaConnection }>(`${base}/${id}`, input)).connection;
}

export async function rotateAgendaCredential(id: string, direction: "inbound" | "outbound") {
  return (await postCrmBackend<{ secret: string }>(`${base}/${id}/credentials/${direction}/rotate`, {})).secret;
}

export async function operateAgendaConnection(id: string, operation: "test" | "activate" | "pause" | "resume") {
  return postCrmBackend<Record<string, unknown>>(`${base}/${id}/${operation}`, {});
}

export async function disableAgendaConnection(id: string) {
  return deleteCrmBackend<Record<string, unknown>>(`${base}/${id}`);
}

export async function startAgendaResync(id: string, reason: string) {
  return postCrmBackend<{ runId: string; status: "syncing" }>(`${base}/${id}/resync`, { reason });
}

export async function listAgendaDeliveries(id: string, filters: { eventType?: string; outcome?: string; before?: string; from?: string; to?: string; limit?: number } = {}) {
  return (await getCrmBackend<{ deliveries: AgendaDelivery[] }>(`${base}/${id}/deliveries${queryString(filters)}`)).deliveries;
}

export async function listAgendaDeadLetters(id: string) {
  return (await getCrmBackend<{ deadLetters: AgendaDeadLetter[] }>(`${base}/${id}/dead-letters`)).deadLetters;
}

export async function listAgendaAudit(id: string, before?: string) {
  return (await getCrmBackend<{ audit: AgendaAudit[] }>(`${base}/${id}/audit${queryString({ before })}`)).audit;
}

export async function resolveAgendaDeadLetter(id: string, outboxId: string, resolution: "retry" | "skip", reason: string) {
  return postCrmBackend<Record<string, unknown>>(`${base}/${id}/dead-letters/${outboxId}/${resolution}`, { reason });
}

export async function correctAgendaAppointmentStatus(id: string, appointmentId: string,
  status: "cancelled" | "done" | "no_show", reason: string) {
  return postCrmBackend<{ status: string; resourceVersion: number }>(
    `${base}/${id}/appointments/${appointmentId}/correct-status`, { status, reason },
  );
}
