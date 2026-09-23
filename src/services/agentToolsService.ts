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
  preview_url?: string | null;
  source_url?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  is_active: boolean;
  display_order: number;
};

export type MediaCatalog = { id: string; parent_id: string | null; name: string };
export type AgentMediaAsset = {
  id: string; title: string; description: string; search_terms: string[]; attributes: Record<string, unknown>;
  preview_url: string | null; file_name: string; send_enabled: boolean; origin: "send_media" | "visagism";
  catalog_ids: string[]; disabled_at?: string | null; purge_after?: string | null;
};
export type AgentMediaCatalogState = { catalogs: MediaCatalog[]; assets: AgentMediaAsset[]; limit: number; used: number };

export type VisagismAnalysis = {
  product_name: string;
  color: string;
  shape: string;
  material: string;
  style: string;
  recommended_face_shapes: string[];
  recommended_personality_traits: string[];
  recommended_perception: string[];
  recommended_style_profiles: string[];
  recommendation_description: string;
};

export type VisagismAnalysisDraft = {
  draftId: string;
  previewUrl: string;
  analysis: VisagismAnalysis;
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

export type OpticalCatalogProduct = {
  id: string;
  lensCategory: "single_vision" | "multifocal";
  displayName: string;
  brand: string | null;
  treatments: string[];
  description: string | null;
  priceCents: number;
  currency: "BRL";
  isActive: boolean;
};

export type StoreGeocodeStatus = "pending" | "ready" | "failed" | "needs_review";

export type StoreHours = Record<string, Array<{ opensAt: string; closesAt: string }>>;

export type StoreLocatorStore = {
  id: string;
  folderId: string | null;
  displayName: string;
  addressLine: string;
  addressNumber: string | null;
  addressComplement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string | null;
  weeklyHours: StoreHours;
  hoursExceptions: Array<Record<string, unknown>>;
  hoursNotes: string | null;
  formattedAddress: string | null;
  geocodeStatus: StoreGeocodeStatus;
  geocodeAccuracy: string | null;
  geocodeError: string | null;
  geocodedAt: string | null;
  isActive: boolean;
  aiVisible: boolean;
  isVisibleForAgent: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StoreLocatorStoreInput = {
  id?: string;
  folderId?: string | null;
  displayName: string;
  addressLine: string;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  phone?: string | null;
  weeklyHours?: StoreHours;
  hoursExceptions?: Array<Record<string, unknown>>;
  hoursNotes?: string | null;
  isActive?: boolean;
};

export type StoreLocatorFolder = {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type LeadStorePreference = {
  id: string;
  preferenceType: "favorite" | "secondary";
  confirmedBy: "lead" | "operator";
  confirmedAt: string;
  store: StoreLocatorStore | null;
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
    draftId?: string;
    productCode: string;
    recommendationDescription: string;
    attributes?: Record<string, unknown>;
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

export async function listAgentMediaCatalog(agentId: string) {
  return getCrmBackend<AgentMediaCatalogState>(`/api/agents/${encodeURIComponent(agentId)}/tools/send_media/catalog`);
}
export async function saveAgentMediaCatalog(agentId: string, input: { id?: string; name: string; parentId?: string | null }) {
  return postCrmBackend<{ catalog: MediaCatalog }>(`/api/agents/${encodeURIComponent(agentId)}/tools/send_media/catalogs`, input);
}
export async function deleteAgentMediaCatalog(agentId: string, catalogId: string) {
  return deleteCrmBackend<{ success: boolean }>(`/api/agents/${encodeURIComponent(agentId)}/tools/send_media/catalogs/${encodeURIComponent(catalogId)}`);
}
export async function saveAgentMediaAsset(agentId: string, input: { id?: string; title: string; description: string; searchTerms: string[]; catalogIds: string[]; sendEnabled: boolean }) {
  return patchCrmBackend<{ asset: AgentMediaAsset }>(`/api/agents/${encodeURIComponent(agentId)}/tools/send_media/assets/${encodeURIComponent(input.id ?? "")}`, input);
}
export async function analyzeAgentMedia(agentId: string, input: { fileName: string; mimeType: string; base64: string }) {
  return postCrmBackend<{ draft: Omit<AgentMediaAsset, "id" | "catalog_ids" | "send_enabled" | "origin"> & { draftId: string } }>(`/api/agents/${encodeURIComponent(agentId)}/tools/send_media/analyze`, input);
}
export async function listArchivedAgentMedia(agentId: string) {
  return getCrmBackend<{ assets: AgentMediaAsset[] }>(`/api/agents/${encodeURIComponent(agentId)}/tools/send_media/trash`);
}
export async function archiveAgentMedia(agentId: string, assetId: string) {
  return deleteCrmBackend<{ success: boolean }>(`/api/agents/${encodeURIComponent(agentId)}/tools/send_media/catalog/assets/${encodeURIComponent(assetId)}`);
}
export async function restoreAgentMedia(agentId: string, assetId: string) {
  return postCrmBackend<{ success: boolean }>(`/api/agents/${encodeURIComponent(agentId)}/tools/send_media/catalog/assets/${encodeURIComponent(assetId)}/restore`, {});
}

export async function listStoreLocatorStores(
  agentId: string,
  input: { search?: string; status?: "all" | "active" | "inactive" | "pending" } = {},
) {
  const params = new URLSearchParams();
  if (input.search?.trim()) params.set("search", input.search.trim());
  if (input.status && input.status !== "all") params.set("status", input.status);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const response = await getCrmBackend<{ stores?: StoreLocatorStore[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/store_locator/stores${suffix}`,
  );
  return response.stores ?? [];
}

export async function listStoreLocatorFolders(agentId: string) {
  const response = await getCrmBackend<{ folders?: StoreLocatorFolder[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/store_locator/folders`,
  );
  return response.folders ?? [];
}

export async function createStoreLocatorFolder(agentId: string, name: string) {
  const response = await postCrmBackend<{ folder: StoreLocatorFolder }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/store_locator/folders`,
    { name },
  );
  return response.folder;
}

export async function renameStoreLocatorFolder(agentId: string, folderId: string, name: string) {
  const response = await patchCrmBackend<{ folder: StoreLocatorFolder }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/store_locator/folders/${encodeURIComponent(folderId)}`,
    { name },
  );
  return response.folder;
}

export async function deleteStoreLocatorFolder(agentId: string, folderId: string) {
  return deleteCrmBackend<{ success: boolean }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/store_locator/folders/${encodeURIComponent(folderId)}`,
  );
}

export async function saveStoreLocatorStore(agentId: string, input: StoreLocatorStoreInput) {
  const response = await postCrmBackend<{ store: StoreLocatorStore }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/store_locator/stores`,
    input,
  );
  return response.store;
}

export async function setStoreLocatorStoreVisibility(agentId: string, storeId: string, isVisible: boolean) {
  const response = await patchCrmBackend<{ store: StoreLocatorStore }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/store_locator/stores/${encodeURIComponent(storeId)}/visibility`,
    { isVisible },
  );
  return response.store;
}

export async function setStoreLocatorStoreFolder(agentId: string, storeId: string, folderId: string | null) {
  const response = await patchCrmBackend<{ store: StoreLocatorStore }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/store_locator/stores/${encodeURIComponent(storeId)}/folder`,
    { folderId },
  );
  return response.store;
}

export async function getLeadStorePreferences(leadId: string) {
  const response = await getCrmBackend<{ preferences?: LeadStorePreference[] }>(
    `/api/leads/${encodeURIComponent(leadId)}/store-preferences`,
  );
  return response.preferences ?? [];
}

export async function analyzeVisagismCatalogItem(
  agentId: string,
  input: {
    productCode: string;
    fileName: string;
    mimeType: string;
    base64: string;
  }
) {
  const response = await postCrmBackend<{ draft: VisagismAnalysisDraft }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/visagism/analyze`,
    input
  );
  return response.draft;
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

export async function listOpticalCatalogProducts(agentId: string) {
  const response = await getCrmBackend<{ products?: OpticalCatalogProduct[] }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/prescription_analyst/catalog`,
  );
  return response.products ?? [];
}

export async function saveOpticalCatalogProduct(
  agentId: string,
  input: Omit<OpticalCatalogProduct, "id" | "currency"> & { id?: string },
) {
  const response = await postCrmBackend<{ product: OpticalCatalogProduct }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/prescription_analyst/catalog`,
    input,
  );
  return response.product;
}

export async function deactivateOpticalCatalogProduct(agentId: string, productId: string) {
  return deleteCrmBackend<{ success: boolean }>(
    `/api/agents/${encodeURIComponent(agentId)}/tools/prescription_analyst/catalog/${encodeURIComponent(productId)}`,
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
    mode: "external_notification" | "agent" | "internal_company";
    targetPhone?: string | null;
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
