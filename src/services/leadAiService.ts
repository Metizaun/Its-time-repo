const CRM_BACKEND_URL =
  (import.meta.env.VITE_CRM_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export type LeadAiReason =
  | "active"
  | "manual_off"
  | "auto_pause"
  | "human_handoff"
  | "global_inactive"
  | "no_agent";

export type LeadAiControlState = {
  success: true;
  leadId: string;
  instanceName: string | null;
  agentId: string | null;
  available: boolean;
  enabled: boolean;
  agentIsActive: boolean;
  manualAiEnabled: boolean | null;
  pausedUntil: string | null;
  bypassingGlobalInactive: boolean;
  reason: LeadAiReason;
};

type LeadAiRequestParams = {
  accessToken: string;
  leadId: string;
  instanceName?: string | null;
  conversationId?: string | null;
};

type UpdateLeadAiRequestParams = LeadAiRequestParams & {
  enabled: boolean;
};

async function parseApiError(response: Response) {
  let errorMessage = "Falha ao consultar o controle de IA do lead";

  try {
    const payload = await response.json();
    if (payload?.error) {
      errorMessage = String(payload.error);
    }
  } catch {
    // Mantem a mensagem padrao quando a resposta nao vier em JSON.
  }

  throw new Error(errorMessage);
}

export async function getLeadAiState({
  accessToken,
  leadId,
  instanceName,
  conversationId,
}: LeadAiRequestParams): Promise<LeadAiControlState> {
  const params = new URLSearchParams();
  if (instanceName?.trim()) params.set("instanceName", instanceName.trim());
  if (conversationId?.trim()) params.set("conversationId", conversationId.trim());
  const query = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${CRM_BACKEND_URL}/api/chat/leads/${leadId}/ai-state${query}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return response.json();
}

export async function updateLeadAiState({
  accessToken,
  leadId,
  enabled,
  instanceName,
  conversationId,
}: UpdateLeadAiRequestParams): Promise<LeadAiControlState> {
  const response = await fetch(`${CRM_BACKEND_URL}/api/chat/leads/${leadId}/ai-state`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      enabled,
      instanceName: instanceName ?? null,
      conversationId: conversationId ?? null,
    }),
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return response.json();
}
