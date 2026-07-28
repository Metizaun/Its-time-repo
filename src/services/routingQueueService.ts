import { getCrmBackend, postCrmBackend } from "@/services/crmBackend";

export type RoutingQueueStatus = "waiting" | "claimed" | "closed" | "cancelled";

export type RoutingQueueItem = {
  routingEventId: string;
  leadId: string;
  leadName: string;
  companyId: string | null;
  companyName: string | null;
  status: RoutingQueueStatus;
  reason: string | null;
  createdAt: string;
  claimedByUserId: string | null;
  claimedByName: string | null;
  isRecipient: boolean;
  canClaim: boolean;
};

function mapQueueItem(item: Record<string, unknown>): RoutingQueueItem {
  return {
    routingEventId: String(item.routing_event_id),
    leadId: String(item.lead_id),
    leadName: String(item.lead_name ?? "Lead"),
    companyId: item.empresa_id ? String(item.empresa_id) : null,
    companyName: item.empresa_name ? String(item.empresa_name) : null,
    status: String(item.queue_status) as RoutingQueueStatus,
    reason: item.reason ? String(item.reason) : null,
    createdAt: String(item.created_at),
    claimedByUserId: item.claimed_by_user_id ? String(item.claimed_by_user_id) : null,
    claimedByName: item.claimed_by_name ? String(item.claimed_by_name) : null,
    isRecipient: item.is_recipient === true,
    canClaim: item.can_claim === true,
  };
}

export async function listRoutingQueue() {
  const response = await getCrmBackend<{ items: Array<Record<string, unknown>> }>(
    "/api/routing-queue?limit=100",
  );
  return (response.items ?? []).map(mapQueueItem);
}

export async function claimRoutingEvent(eventId: string) {
  return postCrmBackend<{ result: Record<string, unknown> }>(
    `/api/routing-queue/${encodeURIComponent(eventId)}/claim`,
    {},
  );
}

export async function reassignRoutingEvent(eventId: string, userId: string) {
  return postCrmBackend<{ result: Record<string, unknown> }>(
    `/api/routing-queue/${encodeURIComponent(eventId)}/reassign`,
    { userId },
  );
}

export async function closeRoutingEvent(eventId: string) {
  return postCrmBackend<{ result: Record<string, unknown> }>(
    `/api/routing-queue/${encodeURIComponent(eventId)}/close`,
    {},
  );
}

