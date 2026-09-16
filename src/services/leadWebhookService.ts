import {
  getCrmBackend,
  patchCrmBackend,
  postCrmBackend,
} from "@/services/crmBackend";

export type LeadWebhookConnectionStatus = "active" | "paused";

export type LeadWebhookConnection = {
  id: string;
  publicId: string;
  name: string;
  agentId: string | null;
  agentName: string | null;
  instanceName: string | null;
  defaultStageId: string | null;
  defaultStageName: string | null;
  status: LeadWebhookConnectionStatus;
  acceptMedia: boolean;
  ready: boolean;
  configurationIssue: string | null;
  webhookUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type LeadWebhookConnectionInput = {
  name: string;
  agentId: string;
  defaultStageId: string;
  acceptMedia?: boolean;
};

type ListResponse = { connections?: LeadWebhookConnection[] };
type ConnectionResponse = { connection: LeadWebhookConnection };
type SecretResponse = {
  secret: string;
  displayedOnce: boolean;
  previousSecretValidForHours?: number;
};

export async function listLeadWebhookConnections() {
  const response = await getCrmBackend<ListResponse>(
    "/api/admin/integrations/leads",
  );
  return response.connections ?? [];
}

export async function createLeadWebhookConnection(
  input: LeadWebhookConnectionInput,
) {
  return postCrmBackend<ConnectionResponse & SecretResponse>(
    "/api/admin/integrations/leads",
    input,
  );
}

export async function updateLeadWebhookConnection(
  id: string,
  input: Partial<LeadWebhookConnectionInput> & {
    status?: LeadWebhookConnectionStatus;
  },
) {
  const response = await patchCrmBackend<ConnectionResponse>(
    `/api/admin/integrations/leads/${encodeURIComponent(id)}`,
    input,
  );
  return response.connection;
}

export async function rotateLeadWebhookSecret(id: string) {
  return postCrmBackend<SecretResponse>(
    `/api/admin/integrations/leads/${encodeURIComponent(id)}/rotate-secret`,
    {},
  );
}
