import {
  deleteCrmBackend,
  getCrmBackend,
  patchCrmBackend,
  postCrmBackend,
} from "@/services/crmBackend";

export type AgentToolReadiness = "ready" | "needs_config" | "unavailable";

export type AgentTemplateTool = {
  key: string;
  version: number;
  name: string;
  description: string;
  icon: string;
  readiness: AgentToolReadiness;
  enabled: boolean;
};

export type AgentTemplate = {
  key: string;
  version: number;
  name: string;
  description: string;
  niche: string | null;
  defaults: Record<string, unknown>;
  tools: AgentTemplateTool[];
};

export type AgentTool = AgentTemplateTool & {
  id: string;
  config: Record<string, unknown>;
  lastValidatedAt: string | null;
};

export type AudioVoice = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  previewUrl: string | null;
  attributes: Record<string, unknown>;
};

export type AudioVoicePage = {
  voices: AudioVoice[];
  hasMore: boolean;
  nextPageToken: string | null;
};

export type RbBillingBootstrapResponse = {
  tool: AgentTool | null;
  pipeline?: { id: string; name: string; description: string | null };
  stages?: Array<{ id: string; name: string }>;
  stageMapping?: Record<string, string>;
};

export type ToolMediaAsset = {
  id: string;
  asset_key: string;
  display_name: string;
  description: string;
  usage_instruction: string;
  source_type: "https" | "google_drive";
  source_url: string;
  media_kind: "image" | "document";
  file_name: string | null;
  default_caption: string | null;
  is_active: boolean;
};

export type VisagismCatalogItem = {
  id: string;
  product_code: string;
  recommendation_description: string;
  attributes: Record<string, unknown>;
  source_url: string;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  is_active: boolean;
  display_order: number;
};

export type LensPriceRule = {
  id: string;
  displayName: string;
  lensCategory: "single_vision" | "multifocal";
  minSphere: number;
  maxSphere: number;
  maxAbsCylinder: number;
  minAddition: number | null;
  maxAddition: number | null;
  priceCents: number;
  currency: "BRL";
  priority: number;
  isActive: boolean;
};

export type ForwardingDestination = {
  id: string;
  destination_key: string;
  display_name: string;
  mode: "external_notification" | "agent" | "internal_company";
  target_phone: string | null;
  target_agent_id: string | null;
  empresa_id: string | null;
  context_instruction: string;
  is_active: boolean;
  seller_ids: string[];
};

export type ForwardingSetup = {
  destinations: ForwardingDestination[];
  companies: Array<{ id: string; cnpj: string; name: string; city: string; state: string }>;
  sellers: Array<{ id: string; name: string | null; email: string }>;
  memberships: Array<{ empresa_id: string; crm_user_id: string }>;
  agents: Array<{ id: string; name: string; instance_name: string; is_active: boolean }>;
};

export async function listAgentTemplates() {
  const response = await getCrmBackend<{ templates?: AgentTemplate[] }>(
    "/api/agent-templates"
  );
  return response.templates ?? [];
}

export async function listAgentTools(agentId: string) {
  const response = await getCrmBackend<{ tools?: AgentTool[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools`
  );
  return response.tools ?? [];
}

export async function updateAgentTool(
  agentId: string,
  toolKey: string,
  input: {
    isEnabled?: boolean;
    config?: Record<string, unknown>;
  }
) {
  const response = await patchCrmBackend<{ tool: AgentTool | null }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(toolKey)}`,
    input
  );
  return response.tool;
}

export async function listAudioVoices(agentId: string, input: { search?: string; nextPageToken?: string | null } = {}) {
  const params = new URLSearchParams({ pageSize: "20" });
  if (input.search?.trim()) params.set("search", input.search.trim());
  if (input.nextPageToken) params.set("nextPageToken", input.nextPageToken);
  return getCrmBackend<AudioVoicePage>(`/api/agents/${encodeURIComponent(agentId)}/audio/voices?${params}`);
}

export async function listToolMediaAssets(agentId: string) {
  const response = await getCrmBackend<{ assets?: ToolMediaAsset[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/send_media/assets`
  );
  return response.assets ?? [];
}

export async function saveToolMediaAsset(
  agentId: string,
  input: {
    assetKey: string;
    displayName: string;
    description?: string;
    usageInstruction?: string;
    sourceUrl: string;
    mediaKind: "image" | "document";
    fileName?: string | null;
    defaultCaption?: string | null;
  }
) {
  const response = await postCrmBackend<{ asset: ToolMediaAsset }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/send_media/assets`,
    input
  );
  return response.asset;
}

export async function deactivateToolMediaAsset(agentId: string, assetId: string) {
  return deleteCrmBackend<{ success: boolean }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/send_media/assets/${encodeURIComponent(assetId)}`
  );
}

export async function listVisagismCatalog(agentId: string) {
  const response = await getCrmBackend<{ catalog?: VisagismCatalogItem[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/visagism/catalog`
  );
  return response.catalog ?? [];
}

export async function saveVisagismCatalogItem(
  agentId: string,
  input: {
    id?: string;
    productCode: string;
    recommendationDescription: string;
    attributes?: Record<string, unknown>;
    sourceUrl: string;
    displayOrder: number;
    isActive: boolean;
  }
) {
  const response = await postCrmBackend<{ item: VisagismCatalogItem }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/visagism/catalog`,
    input
  );
  return response.item;
}

export async function deactivateVisagismCatalogItem(agentId: string, itemId: string) {
  return deleteCrmBackend<{ success: boolean }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/visagism/catalog/${encodeURIComponent(itemId)}`
  );
}

export async function listLensPriceRules(agentId: string) {
  const response = await getCrmBackend<{ rules?: LensPriceRule[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/prescription_analyst/lens-price-rules`
  );
  return response.rules ?? [];
}

export async function saveLensPriceRule(agentId: string, input: Omit<LensPriceRule, "id" | "currency"> & { id?: string }) {
  const response = await postCrmBackend<{ rule: LensPriceRule }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/prescription_analyst/lens-price-rules`,
    input
  );
  return response.rule;
}

export async function deactivateLensPriceRule(agentId: string, ruleId: string) {
  return deleteCrmBackend<{ success: boolean }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/prescription_analyst/lens-price-rules/${encodeURIComponent(ruleId)}`
  );
}

export async function bootstrapRbBilling(agentId: string, mode: "dr_oculos" | "generic") {
  const response = await postCrmBackend<RbBillingBootstrapResponse>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/rb_billing/bootstrap`,
    { mode }
  );
  return response;
}

export async function runRbBillingNow(agentId: string) {
  return postCrmBackend<{ success: boolean; result: unknown }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/rb_billing/run-now`,
    {}
  );
}

export async function getForwardingSetup(agentId: string) {
  return getCrmBackend<ForwardingSetup>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/forwarding/setup`,
  );
}

export async function saveForwardingDestination(
  agentId: string,
  input: {
    destinationKey: string;
    displayName: string;
    mode: "agent" | "internal_company";
    targetAgentId?: string | null;
    empresaId?: string | null;
    sellerIds?: string[];
    contextInstruction: string;
  },
) {
  const response = await postCrmBackend<{ destination: ForwardingDestination }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/forwarding/destinations`,
    input,
  );
  return response.destination;
}

export async function deactivateForwardingDestination(agentId: string, destinationId: string) {
  return deleteCrmBackend<{ success: boolean }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/forwarding/destinations/${encodeURIComponent(destinationId)}`,
  );
}
