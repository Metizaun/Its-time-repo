const CRM_BACKEND_URL =
  (import.meta.env.VITE_CRM_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export type LeadAiReason =
  | "active"
  | "manual_off"
  | "auto_pause"
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
}: LeadAiRequestParams): Promise<LeadAiControlState> {
  const response = await fetch(`${CRM_BACKEND_URL}/api/chat/leads/${leadId}/ai-state`, {
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
}: UpdateLeadAiRequestParams): Promise<LeadAiControlState> {
  const response = await fetch(`${CRM_BACKEND_URL}/api/chat/leads/${leadId}/ai-state`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ enabled }),
  });

  if (!response.ok) {
    await parseApiError(response);
  }

  return response.json();
}
