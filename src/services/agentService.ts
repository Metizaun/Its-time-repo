const CRM_BACKEND_URL = (import.meta.env.VITE_CRM_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ?? "";

type AuthHeadersInput = {
  accessToken: string;
};

export type AgentSummary = {
  id: string;
  name: string;
  instanceName: string;
  systemPrompt: string;
  isActive: boolean;
  model: string;
};

type BackendResponse<T> = T & {
  error?: string;
};

function buildHeaders(accessToken: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
}

async function parseResponse<T>(response: Response): Promise<BackendResponse<T>> {
  let payload: BackendResponse<T> = {} as BackendResponse<T>;

  try {
    payload = (await response.json()) as BackendResponse<T>;
  } catch {
    // Resposta sem JSON.
  }

  if (!response.ok) {
    throw new Error(payload.error || "Falha ao comunicar com o backend de agentes");
  }

  return payload;
}

function mapAgent(agent: any): AgentSummary {
  return {
    id: String(agent.id),
    name: String(agent.name ?? ""),
    instanceName: String(agent.instance_name ?? ""),
    systemPrompt: String(agent.system_prompt ?? ""),
    isActive: Boolean(agent.is_active),
    model: String(agent.model ?? ""),
  };
}

export async function listAgents({ accessToken }: AuthHeadersInput) {
  const response = await fetch(`${CRM_BACKEND_URL}/api/agents`, {
    method: "GET",
    headers: buildHeaders(accessToken),
  });

  const payload = await parseResponse<{ success: boolean; agents: any[] }>(response);
  return {
    success: payload.success,
    agents: (payload.agents ?? []).map(mapAgent),
  };
}

export async function updateAgentPrompt({
  accessToken,
  agentId,
  systemPrompt,
}: AuthHeadersInput & {
  agentId: string;
  systemPrompt: string;
}) {
  const response = await fetch(`${CRM_BACKEND_URL}/api/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    headers: buildHeaders(accessToken),
    body: JSON.stringify({ systemPrompt }),
  });

  const payload = await parseResponse<{ success: boolean; agent: any }>(response);

  return {
    success: payload.success,
    agent: mapAgent(payload.agent),
  };
}

export async function createAgent({
  accessToken,
  name,
  instanceName,
  systemPrompt,
}: AuthHeadersInput & {
  name: string;
  instanceName: string;
  systemPrompt?: string;
}) {
  const response = await fetch(`${CRM_BACKEND_URL}/api/agents`, {
    method: "POST",
    headers: buildHeaders(accessToken),
    body: JSON.stringify({
      name,
      instanceName,
      systemPrompt,
    }),
  });

  const payload = await parseResponse<{ success: boolean; agent: any }>(response);

  return {
    success: payload.success,
    agent: mapAgent(payload.agent),
  };
}
