const CRM_BACKEND_URL = (import.meta.env.VITE_CRM_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ?? "";

type SendManualMessageParams = {
  accessToken: string;
  leadId: string;
  message: string;
  instanceName?: string | null;
};

export const sendToWebhook = async ({
  accessToken,
  leadId,
  message,
  instanceName,
}: SendManualMessageParams) => {
  const endpoint = `${CRM_BACKEND_URL}/api/chat/send-manual`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      leadId,
      content: message,
      instanceName: instanceName || null,
    }),
  });

  if (!response.ok) {
    let errorMessage = "Falha ao enviar mensagem pelo backend do CRM";

    try {
      const payload = await response.json();
      if (payload?.error) {
        errorMessage = String(payload.error);
      }
    } catch {
      // Mantem a mensagem default quando a resposta nao vier em JSON.
    }

    throw new Error(errorMessage);
  }

  return response.json();
};
