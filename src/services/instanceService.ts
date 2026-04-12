const CRM_BACKEND_URL = (import.meta.env.VITE_CRM_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ?? "";

type AuthHeadersInput = {
  accessToken: string;
};

type CreateInstanceInput = AuthHeadersInput & {
  instanceName: string;
};

export type AdminInstanceAction = "continue_setup" | "reconnect" | "sync_status" | "disconnect" | "delete";
export type AdminInstanceSetupStatus = "pending_qr" | "connected" | "expired" | "cancelled";
export type AdminInstanceStatus = "connected" | "disconnected" | "connecting" | "error";

export type AdminInstance = {
  instanceName: string;
  status: AdminInstanceStatus;
  setupStatus: AdminInstanceSetupStatus;
  createdAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
  actions: AdminInstanceAction[];
  color: string | null;
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
    throw new Error(payload.error || "Falha ao comunicar com o backend de instancias");
  }

  return payload;
}

export async function createInstanceWithQr({
  accessToken,
  instanceName,
}: CreateInstanceInput) {
  const response = await fetch(`${CRM_BACKEND_URL}/api/instances`, {
    method: "POST",
    headers: buildHeaders(accessToken),
    body: JSON.stringify({ instanceName }),
  });

  return parseResponse<{
    success: boolean;
    instanceName: string;
    qrCodeBase64: string | null;
    status: AdminInstanceStatus;
    setupStatus: AdminInstanceSetupStatus;
    expiresAt: string | null;
  }>(response);
}

export async function listAdminInstances({ accessToken }: AuthHeadersInput) {
  const response = await fetch(`${CRM_BACKEND_URL}/api/instances`, {
    method: "GET",
    headers: buildHeaders(accessToken),
  });

  return parseResponse<{
    success: boolean;
    instances: AdminInstance[];
  }>(response);
}

export async function refreshInstanceQrCode({
  accessToken,
  instanceName,
}: AuthHeadersInput & { instanceName: string }) {
  const encodedName = encodeURIComponent(instanceName);
  const response = await fetch(`${CRM_BACKEND_URL}/api/instances/${encodedName}/qrcode`, {
    method: "GET",
    headers: buildHeaders(accessToken),
  });

  return parseResponse<{
    success: boolean;
    instanceName: string;
    qrCodeBase64: string | null;
    status: AdminInstanceStatus;
    setupStatus: AdminInstanceSetupStatus;
  }>(response);
}

export async function reconnectInstanceWithQr({
  accessToken,
  instanceName,
}: AuthHeadersInput & { instanceName: string }) {
  const encodedName = encodeURIComponent(instanceName);
  const response = await fetch(`${CRM_BACKEND_URL}/api/instances/${encodedName}/reconnect`, {
    method: "POST",
    headers: buildHeaders(accessToken),
  });

  return parseResponse<{
    success: boolean;
    instanceName: string;
    qrCodeBase64: string | null;
    status: AdminInstanceStatus;
    setupStatus: AdminInstanceSetupStatus;
    expiresAt: string | null;
  }>(response);
}

export async function fetchInstanceStatus({
  accessToken,
  instanceName,
}: AuthHeadersInput & { instanceName: string }) {
  const encodedName = encodeURIComponent(instanceName);
  const response = await fetch(`${CRM_BACKEND_URL}/api/instances/${encodedName}/status`, {
    method: "GET",
    headers: buildHeaders(accessToken),
  });

  return parseResponse<{
    success: boolean;
    instanceName: string;
    state: string;
    status: AdminInstanceStatus;
    setupStatus: AdminInstanceSetupStatus;
  }>(response);
}

export async function syncInstanceStatus({
  accessToken,
  instanceName,
}: AuthHeadersInput & { instanceName: string }) {
  const encodedName = encodeURIComponent(instanceName);
  const response = await fetch(`${CRM_BACKEND_URL}/api/instances/${encodedName}/sync-status`, {
    method: "POST",
    headers: buildHeaders(accessToken),
  });

  return parseResponse<{
    success: boolean;
    instanceName: string;
    state: string;
    status: AdminInstanceStatus;
    setupStatus: AdminInstanceSetupStatus;
  }>(response);
}

export async function disconnectInstance({
  accessToken,
  instanceName,
}: AuthHeadersInput & { instanceName: string }) {
  const encodedName = encodeURIComponent(instanceName);
  const response = await fetch(`${CRM_BACKEND_URL}/api/instances/${encodedName}/disconnect`, {
    method: "POST",
    headers: buildHeaders(accessToken),
  });

  return parseResponse<{
    success: boolean;
    instanceName: string;
    status: AdminInstanceStatus;
    warning: string | null;
  }>(response);
}

export async function deleteInstance({
  accessToken,
  instanceName,
  hardDelete = false,
}: AuthHeadersInput & { instanceName: string; hardDelete?: boolean }) {
  const encodedName = encodeURIComponent(instanceName);
  const response = await fetch(`${CRM_BACKEND_URL}/api/instances/${encodedName}?hard=${hardDelete ? "true" : "false"}`, {
    method: "DELETE",
    headers: buildHeaders(accessToken),
  });

  return parseResponse<{
    success: boolean;
    instanceName: string;
    mode: "soft" | "hard";
    warning: string | null;
  }>(response);
}
