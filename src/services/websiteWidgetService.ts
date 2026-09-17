import {
  deleteCrmBackend,
  getCrmBackend,
  patchCrmBackend,
  postCrmBackend,
} from "./crmBackend";

const BASE = "/api/admin/integrations/website-widget";

export type WebsiteWidgetStatus = "active" | "paused";

export type WebsiteWidgetConnection = {
  id: string;
  publicKey: string;
  name: string;
  agentId: string | null;
  agentName: string | null;
  instanceName: string;
  welcomeMessage: string | null;
  theme: Record<string, unknown>;
  allowedDomains: string[];
  status: WebsiteWidgetStatus;
  ready: boolean;
  configurationIssue: string | null;
  embedSnippet: string;
  createdAt: string;
  updatedAt: string;
};

export type WebsiteWidgetInput = {
  name?: string;
  agentId?: string;
  welcomeMessage?: string | null;
  theme?: Record<string, unknown>;
  allowedDomains?: string[];
  status?: WebsiteWidgetStatus;
};

export async function listWebsiteWidgetConnections() {
  const response = await getCrmBackend<{ connections?: WebsiteWidgetConnection[] }>(BASE);
  return response.connections ?? [];
}

export async function createWebsiteWidgetConnection(input: WebsiteWidgetInput) {
  const response = await postCrmBackend<{ connection: WebsiteWidgetConnection }>(BASE, input);
  return response.connection;
}

export async function updateWebsiteWidgetConnection(id: string, input: WebsiteWidgetInput) {
  const response = await patchCrmBackend<{ connection: WebsiteWidgetConnection }>(
    `${BASE}/${id}`,
    input,
  );
  return response.connection;
}

export async function rotateWebsiteWidgetKey(id: string) {
  const response = await postCrmBackend<{ connection: WebsiteWidgetConnection }>(
    `${BASE}/${id}/rotate-key`,
    {},
  );
  return response.connection;
}

export async function deleteWebsiteWidgetConnection(id: string) {
  await deleteCrmBackend<{ deleted: boolean }>(`${BASE}/${id}`);
}

export async function getWebsiteSessionState(leadId: string) {
  const response = await getCrmBackend<{ live?: boolean }>(
    `/api/website-widget/leads/${leadId}/session`,
  );
  return Boolean(response.live);
}

export async function handoffWebsiteSessionToWhatsApp(leadId: string) {
  await postCrmBackend<{ ended: boolean }>(
    `/api/website-widget/leads/${leadId}/handoff-whatsapp`,
    {},
  );
}
