import { supabase } from "@/integrations/supabase/client";
import {
  createGupshupTemplate,
  listGupshupTemplates,
  type CreateGupshupTemplateInput,
  type GupshupTemplate,
} from "@/services/gupshupTemplateService";
import { deleteCrmBackend, getCrmBackend, patchCrmBackend, postCrmBackend } from "@/services/crmBackend";

export type CollectionSource = {
  id: string; public_id: string; name: string; source_type: string;
  delivery_mode: "pull" | "push" | "file"; default_ingestion_mode: "snapshot" | "incremental";
  status: "active" | "paused" | "error" | "disabled"; timezone: string;
  stale_after_minutes: number; capabilities: Record<string, unknown>; config: Record<string, unknown>;
  last_success_at: string | null; last_error_at: string | null; last_error_code: string | null;
  resolved_dispatcher: "canonical" | "legacy_rb" | "paused" | null;
};

export type CollectionHealth = {
  sources: { active: number; stale: number; error: number };
  cases: { eligible: number; paused: number; error: number };
  outbox: { pending: number; processing: number; failed: number };
  dispatcher: "legacy_rb" | "canonical" | "paused";
};

export type CollectionImport = {
  id: string; source_connection_id: string; original_file_name: string; file_kind: string;
  file_size: number; status: string; mode: string | null; preview_summary: Record<string, unknown>;
  failure_summary: Record<string, unknown>; created_at: string; published_at: string | null;
};

export type CollectionIngestion = {
  id: string; source_connection_id: string; mode: string; status: string;
  received_count: number; created_count: number; updated_count: number;
  unchanged_count: number; not_present_count: number; error_summary: Record<string, unknown>;
  created_at: string;
};

export type CollectionConfiguration = {
  runtime: { active_dispatcher: CollectionHealth["dispatcher"] } | null;
  bindings: Array<Record<string, unknown>>;
  sourceBindings: Array<{ journey_rule_id: string; source_connection_id: string }>;
  rules: Array<Record<string, unknown>>;
  cases: Array<{ communication_status: string; source_freshness: string; total_open_amount: number }>;
  tools: Array<{ id: string; agent_id: string; readiness: string; is_enabled: boolean }>;
  funnels: Array<{ id: string; name: string; instance_name: string; is_active: boolean }>;
  pipelines: Array<{ id: string; name: string; description?: string; is_active: boolean; classifier_key?: string | null }>;
  onboarding: CollectionOnboardingSetup[];
  migrations: Array<Record<string, unknown>>;
};

export type CollectionOnboardingSetup = {
  source: CollectionSource;
  prepared: boolean;
  status: "draft" | "ready" | "active" | "paused" | "attention";
  sendingEnabled: boolean;
  pending: string[];
  nextAction: string;
  instance?: { name: string; provider: string | null; status: string | null; phoneNumber: string | null };
  agent?: { id: string; name: string; instance_name: string; is_active: boolean; provider?: string; model?: string };
  tool?: { id: string; agent_id: string; tool_key: string; is_enabled: boolean; readiness: string };
  pipeline?: { id: string; name: string; description?: string; is_active: boolean };
  funnel?: { id: string; name: string; instance_name: string; is_active: boolean };
  journeyRule?: { id: string; timing_relation: string; days_offset: number; is_active: boolean };
  messages?: CollectionMessage[];
  message?: {
    id: string; label: string; message_template: string; is_active: boolean;
    position?: number;
    collection_timing_relation?: CollectionTimingRelation | null;
    collection_days_offset?: number | null;
    gupshup_template_id?: string | null; gupshup_template_name?: string | null;
    gupshup_template_language?: string | null; gupshup_template_params?: string[] | null;
    template_provider?: "meta" | "gupshup" | null; template_status?: string | null;
    template_rejection_reason?: string | null;
  };
  onboarding?: Record<string, unknown>;
};

export type CollectionTimingRelation = "before_due" | "on_due" | "after_due";

export type CollectionMessage = {
  id: string;
  funnel_id?: string;
  position: number;
  label: string;
  message_template: string;
  is_active: boolean;
  collection_timing_relation?: CollectionTimingRelation | null;
  collection_days_offset?: number | null;
  gupshup_template_id?: string | null;
  gupshup_template_name?: string | null;
  gupshup_template_language?: string | null;
  gupshup_template_params?: string[] | null;
  template_provider?: "meta" | "gupshup" | null;
  template_status?: string | null;
  template_rejection_reason?: string | null;
};

export type CollectionOfficialTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  body: string;
  params: string[];
  rejectionReason?: string | null;
};

export async function listCollectionSources() {
  const result = await getCrmBackend<{ sources: CollectionSource[] }>("/api/collections/sources");
  return result.sources;
}

export async function getCollectionHealth() {
  const result = await getCrmBackend<{ health: CollectionHealth }>("/api/collections/health");
  return result.health;
}

export async function getCollectionConfiguration() {
  return getCrmBackend<CollectionConfiguration>("/api/collections/configuration");
}

export async function getCollectionOnboarding(sourceId: string) {
  const result = await getCrmBackend<{ setup: CollectionOnboardingSetup }>(`/api/collections/onboarding/${sourceId}`);
  return result.setup;
}

export async function prepareCollectionOnboarding(input: {
  sourceConnectionId: string;
  instanceName?: string | null;
  pipelineId?: string | null;
  createNewPipeline?: boolean;
}) {
  const result = await postCrmBackend<{ setup: CollectionOnboardingSetup }>(
    "/api/collections/onboarding/prepare", input,
  );
  return result.setup;
}

export async function updateCollectionMessage(
  sourceId: string,
  messageId: string,
  input: {
    label: string;
    messageTemplate: string;
    timingRelation: CollectionTimingRelation;
    daysOffset: number;
    template?: {
    provider: "meta" | "gupshup";
    id?: string | null;
    name: string;
    language?: string | null;
    status?: string | null;
    params?: string[] | null;
    rejectionReason?: string | null;
    } | null;
  },
) {
  const result = await patchCrmBackend<{ setup: CollectionOnboardingSetup }>(
    `/api/collections/onboarding/${sourceId}/messages/${messageId}`,
    input,
  );
  return result.setup;
}

export async function createCollectionMessage(
  sourceId: string,
  input: {
    label: string;
    messageTemplate: string;
    timingRelation: CollectionTimingRelation;
    daysOffset: number;
    template?: {
      provider: "meta" | "gupshup";
      id?: string | null;
      name: string;
      language?: string | null;
      status?: string | null;
      params?: string[] | null;
      rejectionReason?: string | null;
    } | null;
  },
) {
  const result = await postCrmBackend<{ setup: CollectionOnboardingSetup }>(
    `/api/collections/onboarding/${sourceId}/messages`, input,
  );
  return result.setup;
}

export async function listCollectionOfficialTemplates(
  instanceName: string,
  provider: "meta" | "gupshup",
) {
  if (provider === "gupshup") {
    const result = await listGupshupTemplates(instanceName);
    return (result.templates ?? []).map(normalizeGupshupTemplate);
  }
  const result = await getCrmBackend<{
    templates: Array<{
      id: string; metaTemplateId: string | null; name: string; language: string;
      status: string; components: unknown; rejectionReason: string | null;
    }>;
  }>(`/api/meta/templates?instanceName=${encodeURIComponent(instanceName)}`);
  return (result.templates ?? []).map((template) => normalizeMetaTemplate(template));
}

export async function createCollectionOfficialTemplate(input: {
  provider: "meta" | "gupshup";
  instanceName: string;
  name: string;
  body: string;
  language?: string;
  example?: string;
}) {
  if (input.provider === "gupshup") {
    const result = await createGupshupTemplate({
      instanceName: input.instanceName,
      elementName: input.name,
      content: input.body,
      languageCode: input.language ?? "pt_BR",
      category: "UTILITY",
      templateType: "TEXT",
      example: input.example ?? "Mariana,249.90,10/09/2026",
    } satisfies CreateGupshupTemplateInput);
    return normalizeGupshupTemplate(result.template);
  }
  const components = [{ type: "BODY", text: input.body }];
  const result = await postCrmBackend<{
    template: {
      id?: string | null; meta_template_id?: string | null; name: string; language: string;
      status: string; components_json?: unknown; components?: unknown; rejection_reason?: string | null;
    };
  }>("/api/meta/templates", {
    instanceName: input.instanceName,
    name: input.name,
    language: input.language ?? "pt_BR",
    category: "UTILITY",
    components,
  });
  return normalizeMetaTemplate(result.template);
}

function normalizeGupshupTemplate(template: GupshupTemplate): CollectionOfficialTemplate {
  const params = Array.from(template.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g))
    .map((match) => friendlyTemplateVariable(Number(match[1])));
  return {
    id: template.id,
    name: template.name,
    language: template.language || "pt_BR",
    status: template.status,
    body: template.body,
    params,
  };
}

function normalizeMetaTemplate(template: {
  id?: string | null; metaTemplateId?: string | null; meta_template_id?: string | null;
  name: string; language: string; status: string; components?: unknown; components_json?: unknown;
  rejectionReason?: string | null; rejection_reason?: string | null;
}): CollectionOfficialTemplate {
  const components = template.components ?? template.components_json;
  const body = Array.isArray(components)
    ? String((components.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "BODY") as Record<string, unknown> | undefined)?.text ?? "")
    : "";
  const params = Array.from(body.matchAll(/\{\{\s*(\d+)\s*\}\}/g))
    .map((match) => friendlyTemplateVariable(Number(match[1])));
  return {
    id: template.metaTemplateId ?? template.meta_template_id ?? template.id ?? "",
    name: template.name,
    language: template.language || "pt_BR",
    status: template.status,
    body,
    params,
    rejectionReason: template.rejectionReason ?? template.rejection_reason ?? null,
  };
}

function friendlyTemplateVariable(index: number) {
  return ["nome", "valor", "vencimento", "credor"][index - 1] ?? `variavel${index}`;
}

export async function activateCollectionSending(sourceId: string) {
  const result = await postCrmBackend<{ setup: CollectionOnboardingSetup }>(
    `/api/collections/onboarding/${sourceId}/activate`, {},
  );
  return result.setup;
}

export async function pauseCollectionSending(sourceId: string) {
  const result = await postCrmBackend<{ setup: CollectionOnboardingSetup }>(
    `/api/collections/onboarding/${sourceId}/pause`, {},
  );
  return result.setup;
}

export async function listCollectionImports() {
  const result = await getCrmBackend<{ imports: CollectionImport[] }>("/api/collections/imports");
  return result.imports;
}

export async function listCollectionIngestions() {
  const result = await getCrmBackend<{ ingestions: CollectionIngestion[] }>("/api/collections/ingestions");
  return result.ingestions;
}

export async function createCollectionSource(input: Record<string, unknown>) {
  return postCrmBackend<{ source: CollectionSource; secret?: string; displayedOnce?: boolean }>(
    "/api/collections/sources", input,
  );
}

export async function updateCollectionSource(id: string, input: Record<string, unknown>) {
  return patchCrmBackend<{ source: CollectionSource }>(`/api/collections/sources/${id}`, input);
}

export async function deleteCollectionSource(id: string) {
  return deleteCrmBackend<{ source: CollectionSource }>(`/api/collections/sources/${id}`);
}

export async function rotateCollectionSecret(id: string) {
  return postCrmBackend<{ secret: string; displayedOnce: boolean }>(
    `/api/collections/sources/${id}/rotate-secret`, {},
  );
}

export async function runCollectionSource(id: string) {
  return postCrmBackend(`/api/collections/sources/${id}/run`, {});
}

export async function createCollectionBinding(input: Record<string, unknown>) {
  return postCrmBackend("/api/collections/bindings", input);
}

export async function createCollectionJourney(input: Record<string, unknown>) {
  return postCrmBackend("/api/collections/journey-rules", input);
}

export async function createCollectionUpload(file: File, sourceConnectionId: string) {
  const intent = await postCrmBackend<{
    importId: string; storagePath: string; token: string;
  }>("/api/collections/imports/upload-intent", {
    sourceConnectionId, fileName: file.name, fileSize: file.size,
    mimeType: file.type || (file.name.toLowerCase().endsWith(".csv") ? "text/csv" :
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
  });
  const { error } = await supabase.storage.from("collection-imports")
    .uploadToSignedUrl(intent.storagePath, intent.token, file, {
      contentType: file.type || undefined,
    });
  if (error) throw error;
  return intent;
}

export async function previewCollectionImport(importId: string, input: Record<string, unknown>) {
  return postCrmBackend<{ preview: Record<string, unknown> }>(
    `/api/collections/imports/${importId}/preview`, input,
  );
}

export async function publishCollectionImport(importId: string, input: Record<string, unknown>) {
  return postCrmBackend(`/api/collections/imports/${importId}/publish`, input);
}
