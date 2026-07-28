import { createClient } from "@supabase/supabase-js";

import { normalizePhoneIdentity } from "../phone-normalization.js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function countRows(schema: string, table: string): Promise<number> {
  const { count, error } = await supabase
    .schema(schema)
    .from(table)
    .select("*", { count: "exact", head: true });

  if (error) throw new Error(`${schema}.${table}: ${error.message}`);
  return count ?? 0;
}

async function countDuplicateActivePhoneGroups(): Promise<{
  activeLeadsScanned: number;
  duplicateGroups: number;
  duplicateLeadsBeyondCanonical: number;
  multiInstanceGroups: number;
  maxGroupSize: number;
}> {
  const pageSize = 1_000;
  const groups = new Map<string, { count: number; instances: Set<string> }>();
  let activeLeadsScanned = 0;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .schema("crm")
      .from("leads")
      .select("aces_id,contact_phone,instancia")
      .eq("view", true)
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`crm.leads: ${error.message}`);

    const rows = data ?? [];
    for (const row of rows) {
      const phoneIdentity = normalizePhoneIdentity(row.contact_phone);
      if (!phoneIdentity) continue;

      const tenantPhoneIdentity = `${row.aces_id}:${phoneIdentity}`;
      const group = groups.get(tenantPhoneIdentity) ?? {
        count: 0,
        instances: new Set<string>(),
      };
      group.count += 1;
      if (row.instancia) group.instances.add(row.instancia);
      groups.set(tenantPhoneIdentity, group);
    }

    activeLeadsScanned += rows.length;
    if (rows.length < pageSize) break;
  }

  const duplicateGroups = Array.from(groups.values()).filter((group) => group.count > 1);

  return {
    activeLeadsScanned,
    duplicateGroups: duplicateGroups.length,
    duplicateLeadsBeyondCanonical: duplicateGroups.reduce(
      (total, group) => total + group.count - 1,
      0,
    ),
    multiInstanceGroups: duplicateGroups.filter((group) => group.instances.size > 1).length,
    maxGroupSize: duplicateGroups.reduce((largest, group) => Math.max(largest, group.count), 0),
  };
}

async function main(): Promise<void> {
  const phoneCheck = await countDuplicateActivePhoneGroups();
  const result = {
    active_leads_scanned: phoneCheck.activeLeadsScanned,
    duplicate_active_phone_groups: phoneCheck.duplicateGroups,
    duplicate_active_leads_beyond_canonical: phoneCheck.duplicateLeadsBeyondCanonical,
    duplicate_groups_spanning_instances: phoneCheck.multiInstanceGroups,
    largest_duplicate_group: phoneCheck.maxGroupSize,
    calendar_events: await countRows("calendar", "events"),
    routing_events: await countRows("crm", "routing_events"),
    ai_agents: await countRows("agents", "ai_agents"),
    rb_lead_metadata: await countRows("rb", "lead_metadata"),
  };

  console.log(JSON.stringify(result));

  if (phoneCheck.duplicateGroups > 0) {
    throw new Error(
      "Existem leads ativos com identidade telefonica duplicada; resolva antes do db push.",
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`predeploy_data_check_failed=${message}`);
  process.exitCode = 1;
});
