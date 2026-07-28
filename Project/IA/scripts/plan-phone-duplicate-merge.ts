import { createClient } from "@supabase/supabase-js";

import { normalizePhoneIdentity } from "../phone-normalization.js";

type LeadCandidate = {
  id: string;
  aces_id: number;
  contact_phone: string;
  instancia: string | null;
  last_message_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function timestamp(value: string | null): number {
  return value ? Date.parse(value) || 0 : 0;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchActiveLeads(): Promise<LeadCandidate[]> {
  const leads: LeadCandidate[] = [];
  const pageSize = 1_000;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .schema("crm")
      .from("leads")
      .select(
        "id,aces_id,contact_phone,instancia,last_message_at,updated_at,created_at",
      )
      .eq("view", true)
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`crm.leads: ${error.message}`);
    const page = (data ?? []) as LeadCandidate[];
    leads.push(...page);
    if (page.length < pageSize) break;
  }

  return leads;
}

async function fetchLeadIds(
  schema: string,
  table: string,
  leadIds: string[],
): Promise<string[]> {
  const result: string[] = [];
  const pageSize = 1_000;

  for (const leadIdChunk of chunks(leadIds, 50)) {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .schema(schema)
        .from(table)
        .select("lead_id")
        .in("lead_id", leadIdChunk)
        .range(offset, offset + pageSize - 1);

      if (error) throw new Error(`${schema}.${table}: ${error.message}`);
      const page = (data ?? []) as Array<{ lead_id: string | null }>;
      result.push(...page.flatMap((row) => (row.lead_id ? [row.lead_id] : [])));
      if (page.length < pageSize) break;
    }
  }

  return result;
}

async function fetchOptionalLeadIds(
  schema: string,
  table: string,
  leadIds: string[],
): Promise<string[]> {
  try {
    return await fetchLeadIds(schema, table, leadIds);
  } catch (error) {
    if (error instanceof Error && error.message.includes("schema cache")) return [];
    throw error;
  }
}

async function fetchAiStateRows(
  leadIds: string[],
): Promise<Array<{ agent_id: string; lead_id: string }>> {
  const result: Array<{ agent_id: string; lead_id: string }> = [];

  for (const leadIdChunk of chunks(leadIds, 50)) {
    const { data, error } = await supabase
      .schema("agents")
      .from("ai_lead_state")
      .select("agent_id,lead_id")
      .in("lead_id", leadIdChunk);
    if (error) throw new Error(`agents.ai_lead_state: ${error.message}`);
    result.push(...((data ?? []) as Array<{ agent_id: string; lead_id: string }>));
  }

  return result;
}

async function main(): Promise<void> {
  const groups = new Map<string, LeadCandidate[]>();
  for (const lead of await fetchActiveLeads()) {
    const identity = normalizePhoneIdentity(lead.contact_phone);
    if (!identity) continue;
    const key = `${lead.aces_id}:${identity}`;
    groups.set(key, [...(groups.get(key) ?? []), lead]);
  }

  const duplicateGroups = Array.from(groups.values()).filter((group) => group.length > 1);
  const duplicateLeadIds = duplicateGroups.flat().map((lead) => lead.id);
  const rbLeadIds = new Set(
    await fetchLeadIds("rb", "lead_metadata", duplicateLeadIds),
  );
  const messageLeadIds = await fetchLeadIds("crm", "message_history", duplicateLeadIds);
  const tagLeadIds = await fetchLeadIds("crm", "lead_tags", duplicateLeadIds);
  const messageCounts = new Map<string, number>();
  for (const leadId of messageLeadIds) {
    messageCounts.set(leadId, (messageCounts.get(leadId) ?? 0) + 1);
  }

  let archivedLeads = 0;
  let movedMessages = 0;
  let copiedTags = 0;
  let groupsWithMultipleRbRecords = 0;
  const sourceLeadIds: string[] = [];
  const canonicalBySource = new Map<string, string>();

  for (const group of duplicateGroups) {
    const ranked = [...group].sort((left, right) => {
      const rbDifference = Number(rbLeadIds.has(right.id)) - Number(rbLeadIds.has(left.id));
      if (rbDifference !== 0) return rbDifference;
      const messageDifference =
        timestamp(right.last_message_at) - timestamp(left.last_message_at);
      if (messageDifference !== 0) return messageDifference;
      const updatedDifference = timestamp(right.updated_at) - timestamp(left.updated_at);
      if (updatedDifference !== 0) return updatedDifference;
      const createdDifference = timestamp(right.created_at) - timestamp(left.created_at);
      if (createdDifference !== 0) return createdDifference;
      return right.id.localeCompare(left.id);
    });

    const canonical = ranked[0];
    const sources = ranked.slice(1);
    sourceLeadIds.push(...sources.map((lead) => lead.id));
    for (const source of sources) canonicalBySource.set(source.id, canonical.id);
    archivedLeads += sources.length;
    movedMessages += sources.reduce(
      (total, lead) => total + (messageCounts.get(lead.id) ?? 0),
      0,
    );
    copiedTags += tagLeadIds.filter((leadId) => sources.some((lead) => lead.id === leadId)).length;
    if (group.filter((lead) => rbLeadIds.has(lead.id)).length > 1) {
      groupsWithMultipleRbRecords += 1;
    }

    if (group.some((lead) => rbLeadIds.has(lead.id)) && !rbLeadIds.has(canonical.id)) {
      throw new Error("Plano escolheu um lead sem RB apesar de existir metadata no grupo.");
    }
  }

  const [attachmentLeadIds, uploadIntentLeadIds, opportunityLeadIds] =
    await Promise.all([
      fetchLeadIds("crm", "message_attachments", sourceLeadIds),
      fetchLeadIds("crm", "message_attachment_upload_intents", sourceLeadIds),
      fetchLeadIds("crm", "opportunities", sourceLeadIds),
    ]);
  const relatedTables = [
    ["calendar", "events"],
    ["crm", "agendamentos"],
    ["crm", "follow_up_tasks"],
    ["crm", "receituarios"],
    ["crm", "routing_events"],
    ["crm", "notifications"],
    ["crm", "lead_remarketing"],
    ["crm", "lead_pipeline_analysis"],
    ["crm", "lead_automation_state"],
    ["crm", "automation_enrollments"],
    ["crm", "automation_executions"],
    ["crm", "lead_instance_memberships"],
    ["agents", "ai_lead_state"],
    ["agents", "ai_runs"],
  ] as const;
  const relatedCounts = Object.fromEntries(
    await Promise.all(
      relatedTables.map(async ([schema, table]) => [
        `${schema}.${table}`,
        (await fetchOptionalLeadIds(schema, table, sourceLeadIds)).length,
      ]),
    ),
  );
  const aiStateRows = await fetchAiStateRows(duplicateLeadIds);
  const aiStateKeys = new Set(
    aiStateRows.map((row) => `${row.agent_id}:${row.lead_id}`),
  );
  const sourceAiStates = aiStateRows.filter((row) => canonicalBySource.has(row.lead_id));
  const aiStateCollisions = sourceAiStates.filter((row) =>
    aiStateKeys.has(`${row.agent_id}:${canonicalBySource.get(row.lead_id)}`),
  ).length;
  const pipelineAnalysisLeadIds = new Set(
    await fetchLeadIds("crm", "lead_pipeline_analysis", duplicateLeadIds),
  );
  const sourcePipelineAnalyses = sourceLeadIds.filter((leadId) =>
    pipelineAnalysisLeadIds.has(leadId),
  );
  const pipelineAnalysisCollisions = sourcePipelineAnalyses.filter((leadId) =>
    pipelineAnalysisLeadIds.has(canonicalBySource.get(leadId) ?? ""),
  ).length;

  console.log(
    JSON.stringify({
      duplicate_groups: duplicateGroups.length,
      leads_to_archive_not_delete: archivedLeads,
      messages_to_move: movedMessages,
      attachments_to_move: attachmentLeadIds.length,
      upload_intents_to_move: uploadIntentLeadIds.length,
      opportunities_to_move: opportunityLeadIds.length,
      tags_to_copy: copiedTags,
      groups_with_multiple_rb_records: groupsWithMultipleRbRecords,
      ai_states_to_move: sourceAiStates.length - aiStateCollisions,
      ai_state_collisions_preserved_on_archived_leads: aiStateCollisions,
      pipeline_analyses_to_move:
        sourcePipelineAnalyses.length - pipelineAnalysisCollisions,
      pipeline_analysis_collisions_preserved_on_archived_leads:
        pipelineAnalysisCollisions,
      related_rows_remaining_on_archived_leads: relatedCounts,
    }),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`duplicate_plan_failed=${message}`);
  process.exitCode = 1;
});
