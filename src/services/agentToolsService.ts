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
