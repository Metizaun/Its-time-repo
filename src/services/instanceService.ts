const CRM_BACKEND_URL = (import.meta.env.VITE_CRM_BACKEND_URL as string | undefined)?.replace(/\/$/, "") ?? "";

type AuthHeadersInput = {
  accessToken: string;
};

export type InstanceConnectionMode = "local" | "external_webhook";

type CreateInstanceInput = AuthHeadersInput & {
  instanceName: string;
  connectWebhook?: boolean;
  remoteEvolutionUrl?: string;
  remoteApiKey?: string;
  remoteInstanceName?: string;
};

export type AdminInstanceAction = "continue_setup" | "reconnect" | "sync_status" | "disconnect" | "delete";
export type AdminInstanceSetupStatus = "pending_qr" | "connected" | "expired" | "cancelled";
export type AdminInstanceStatus = "connected" | "disconnected" | "connecting" | "error";

export type AdminInstance = {
  instanceName: string;
  status: AdminInstanceStatus;
  setupStatus: AdminInstanceSetupStatus;
  connectionMode: InstanceConnectionMode;
  createdAt: string | null;
  expiresAt: string | null;
  lastError: string | null;
  actions: AdminInstanceAction[];
  color: string | null;
  leadCount: number;
};

export type MetaChannelStatus = "draft" | "active" | "disabled" | "error";

export type AdminMetaChannel = {
  id: string;
  instanceName: string;
  wabaId: string | null;
  phoneNumberId: string | null;
  businessId: string | null;
  displayPhoneNumber: string | null;
  accessTokenSecretRef: string | null;
  appSecretRef: string | null;
  webhookVerifyToken: string | null;
  status: MetaChannelStatus;
  lastTemplateSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminMetaChannelSummary = {
  instanceName: string;
  provider: "evolution" | "meta" | "gupshup";
  metaChannelId: string | null;
  channel: AdminMetaChannel | null;
};

export type AdminMetaTemplate = {
  id: string;
  channelId: string;
  metaTemplateId: string | null;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown;
  variables: unknown;
  rejectionReason: string | null;
  lastSyncedAt: string;
};

export type GupshupChannelStatus = "draft" | "active" | "disabled";

export type AdminGupshupChannel = {
  id: string;
  instanceName: string;
  appId: string | null;
  appName: string;
  phoneNumber: string;
  status: GupshupChannelStatus;
  createdAt: string;
  updatedAt: string;
};

export type AdminGupshupChannelSummary = {
  instanceName: string;
  provider: "evolution" | "meta" | "gupshup";
  gupshupChannel: AdminGupshupChannel | null;
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

export async function createInstanceConnection({
  accessToken,
  instanceName,
  connectWebhook,
  remoteEvolutionUrl,
  remoteApiKey,
  remoteInstanceName,
}: CreateInstanceInput) {
  const response = await fetch(`${CRM_BACKEND_URL}/api/instances`, {
    method: "POST",
    headers: buildHeaders(accessToken),
    body: JSON.stringify({
      instanceName,
      connectWebhook: connectWebhook ?? false,
      remoteEvolutionUrl: remoteEvolutionUrl ?? null,
      remoteApiKey: remoteApiKey ?? null,
      remoteInstanceName: remoteInstanceName ?? null,
    }),
  });

  return parseResponse<{
    success: boolean;
    instanceName: string;
    qrCodeBase64: string | null;
    status: AdminInstanceStatus;
    setupStatus: AdminInstanceSetupStatus;
    connectionMode: InstanceConnectionMode;
    message?: string | null;
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
  leadAction = "none",
  transferToInstanceName,
  confirmationText,
}: AuthHeadersInput & {
  instanceName: string;
  hardDelete?: boolean;
  leadAction?: "none" | "transfer" | "delete";
  transferToInstanceName?: string | null;
  confirmationText?: string | null;
}) {
  const encodedName = encodeURIComponent(instanceName);
  const response = await fetch(`${CRM_BACKEND_URL}/api/instances/${encodedName}?hard=${hardDelete ? "true" : "false"}`, {
    method: "DELETE",
    headers: buildHeaders(accessToken),
    body: JSON.stringify({
      leadAction,
      transferToInstanceName: transferToInstanceName || null,
      confirmationText: confirmationText || null,
    }),
  });

  return parseResponse<{
    success: boolean;
    instanceName: string;
    mode: "soft" | "hard";
    leadAction: "none" | "transfer" | "delete";
    leadsAffected: number;
    transferTarget: string | null;
    warning: string | null;
  }>(response);
}

export async function listMetaChannels({ accessToken }: AuthHeadersInput) {
  const response = await fetch(`${CRM_BACKEND_URL}/api/meta/channels`, {
    method: "GET",
    headers: buildHeaders(accessToken),
  });

  return parseResponse<{
    success: boolean;
    channels: AdminMetaChannelSummary[];
  }>(response);
}

export async function listGupshupChannels({ accessToken }: AuthHeadersInput) {
  const response = await fetch(`${CRM_BACKEND_URL}/api/gupshup/channels`, {
    method: "GET",
    headers: buildHeaders(accessToken),
  });

  return parseResponse<{
    success: boolean;
    channels: AdminGupshupChannelSummary[];
  }>(response);
}

export async function upsertMetaChannel({
  accessToken,
  instanceName,
  wabaId,
  phoneNumberId,
  businessId,
  displayPhoneNumber,
  accessTokenSecretRef,
  appSecretRef,
  webhookVerifyToken,
  status,
}: AuthHeadersInput & {
  instanceName: string;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  businessId?: string | null;
  displayPhoneNumber?: string | null;
  accessTokenSecretRef?: string | null;
  appSecretRef?: string | null;
  webhookVerifyToken?: string | null;
  status?: MetaChannelStatus;
}) {
  const response = await fetch(`${CRM_BACKEND_URL}/api/meta/channels`, {
    method: "POST",
    headers: buildHeaders(accessToken),
    body: JSON.stringify({
      instanceName,
      wabaId,
      phoneNumberId,
      businessId,
      displayPhoneNumber,
      accessTokenSecretRef,
      appSecretRef,
      webhookVerifyToken,
      status,
    }),
  });

  return parseResponse<{
    success: boolean;
    channel: AdminMetaChannel;
  }>(response);
}

export async function syncMetaTemplates({
  accessToken,
  instanceName,
}: AuthHeadersInput & { instanceName: string }) {
  const response = await fetch(`${CRM_BACKEND_URL}/api/meta/templates/sync`, {
    method: "POST",
    headers: buildHeaders(accessToken),
    body: JSON.stringify({ instanceName }),
  });

  return parseResponse<{
    success: boolean;
    instanceName: string;
    mode: "mock" | "live";
    synced: number;
  }>(response);
}

export async function listMetaTemplates({
  accessToken,
  instanceName,
}: AuthHeadersInput & { instanceName: string }) {
  const encodedName = encodeURIComponent(instanceName);
  const response = await fetch(`${CRM_BACKEND_URL}/api/meta/templates?instanceName=${encodedName}`, {
    method: "GET",
    headers: buildHeaders(accessToken),
  });

  return parseResponse<{
    success: boolean;
    instanceName: string;
    channel: AdminMetaChannel | null;
    templates: AdminMetaTemplate[];
  }>(response);
}
