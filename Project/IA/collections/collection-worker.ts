import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { normalizePhoneIdentity, normalizePhoneForStorage } from "../phone-normalization.js";
import { CollectionIngestionService } from "./ingestion-service.js";
import { CollectionSpreadsheetService } from "./spreadsheet-service.js";
import { RbCanonicalService } from "./rb-collection-service.js";

type OutboxRow = {
  id: string;
  aces_id: number;
  topic: string;
  aggregate_id: string;
  attempt_count: number;
  payload: Record<string, unknown>;
};

type EligibleDecision = {
  case_id: string;
  aces_id: number;
  source_connection_id: string;
  journey_rule_id: string;
  funnel_id: string;
  message_id: string;
  customer_phone: string;
  priority: number;
  most_overdue_days: number;
  total_open_amount: number | string;
  local_date: string;
};

type CaseRow = {
  id: string;
  aces_id: number;
  source_connection_id: string;
  creditor_external_id: string;
  lead_id: string | null;
  customer_name: string;
  customer_phone: string;
  communication_status: string;
  source_freshness: string;
  open_receivables_count: number;
};

type BindingRow = {
  id: string;
  agent_tool_id: string;
  creditor_external_id: string | null;
  priority: number;
};

function retryDelaySeconds(attemptCount: number) {
  return Math.min(3600, 15 * 2 ** Math.max(0, Math.min(attemptCount - 1, 8)));
}

export class CollectionWorker {
  private readonly collections: SupabaseClient<any, "collections", any>;
  private readonly root: SupabaseClient;
  private readonly crm: SupabaseClient<any, "crm", any>;
  private readonly agents: SupabaseClient<any, "agents", any>;
  private readonly spreadsheets: CollectionSpreadsheetService;
  private readonly rbCanonical: RbCanonicalService;
  private readonly workerId = `collection-${process.pid}-${randomUUID()}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly config: {
    supabaseUrl: string;
    serviceRoleKey: string;
    pollMs?: number;
    batchSize?: number;
  }) {
    const auth = { persistSession: false, autoRefreshToken: false };
    this.root = createClient(config.supabaseUrl, config.serviceRoleKey, { auth });
    this.collections = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth, db: { schema: "collections" },
    });
    this.crm = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth, db: { schema: "crm" },
    });
    this.agents = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth, db: { schema: "agents" },
    });
    this.spreadsheets = new CollectionSpreadsheetService(
      this.root,
      this.collections,
      new CollectionIngestionService(this.collections),
    );
    this.rbCanonical = new RbCanonicalService({
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
      mockFixturePath: process.env.RB_BILLING_MOCK_FIXTURE_PATH?.trim() || null,
    });
  }

  start() {
    if (this.timer) return this;
    const pollMs = Math.max(this.config.pollMs ?? 5_000, 1_000);
    this.timer = setInterval(() => void this.processCycle().catch((error) => {
      console.error("[collection-worker] cycle_failed", { workerId: this.workerId, error });
    }), pollMs);
    void this.processCycle().catch((error) => {
      console.error("[collection-worker] initial_cycle_failed", { workerId: this.workerId, error });
    });
    console.log("[collection-worker] started", { workerId: this.workerId, pollMs });
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async processCycle() {
    if (this.running) return;
    this.running = true;
    try {
      await this.enforceImportRetention();
      await this.processDuePullSources();
      const { error: staleError } = await this.collections.rpc("mark_stale_sources");
      if (staleError) throw staleError;
      while (true) {
        const { data, error } = await this.collections.rpc("claim_outbox", {
          p_worker_id: this.workerId,
          p_limit: Math.min(Math.max(this.config.batchSize ?? 50, 1), 500),
          p_lease_seconds: 120,
        });
        if (error) throw error;
        const rows = (data ?? []) as OutboxRow[];
        if (rows.length === 0) break;
        for (const row of rows) await this.processOutboxItem(row);
      }
      await this.evaluateEligibleCases();
    } finally {
      this.running = false;
    }
  }

  private async enforceImportRetention() {
    const { data, error } = await this.collections.rpc("claim_expired_spreadsheet_imports", {
      p_limit: 100,
    });
    if (error) throw error;
    for (const item of (data ?? []) as Array<{
      id: string; storage_bucket: string; storage_path: string;
    }>) {
      const { error: storageError } = await this.root.storage
        .from(item.storage_bucket || "collection-imports").remove([item.storage_path]);
      if (storageError) {
        console.error("[collection-worker] import_retention_failed", {
          workerId: this.workerId, importId: item.id, error: storageError.message,
        });
        continue;
      }
      const { error: completeError } = await this.collections.rpc("complete_import_file_retention", {
        p_import_id: item.id,
      });
      if (completeError) throw completeError;
    }
    const { error: detailsError } = await this.collections.rpc("clear_expired_import_error_details");
    if (detailsError) throw detailsError;
  }

  private async processDuePullSources() {
    const { data, error } = await this.collections.rpc("claim_due_pull_sources", {
      p_worker_id: this.workerId,
      p_limit: 10,
      p_lease_seconds: 900,
    });
    if (error) throw error;
    for (const source of (data ?? []) as Array<{ id: string; source_type: string }>) {
      try {
        if (source.source_type === "rb") await this.rbCanonical.pull(source.id);
        else throw new Error(`Adaptador pull nao registrado: ${source.source_type}`);
        const { error: completeError } = await this.collections.rpc("complete_source_pull", {
          p_source_connection_id: source.id,
          p_worker_id: this.workerId,
        });
        if (completeError) throw completeError;
      } catch (pullError) {
        const message = pullError instanceof Error ? pullError.message : String(pullError);
        console.error("[collection-worker] pull_source_failed", {
          workerId: this.workerId, sourceConnectionId: source.id, error: message,
        });
        await this.collections.rpc("fail_source_pull", {
          p_source_connection_id: source.id,
          p_worker_id: this.workerId,
          p_error_code: message.slice(0, 120),
        });
      }
    }
  }

  private async processOutboxItem(row: OutboxRow) {
    try {
      if (row.topic === "case.reevaluate") await this.prepareCase(row.aggregate_id);
      else if (row.topic === "spreadsheet.publish") {
        const payload = row.payload ?? {};
        await this.spreadsheets.processQueuedPublish({
          acesId: row.aces_id,
          importId: row.aggregate_id,
          mode: payload.mode === "snapshot" ? "snapshot" : "incremental",
          scope: (payload.scope ?? {}) as Record<string, unknown>,
          confirmValidRowsOnly: payload.confirmValidRowsOnly === true,
        });
      }
      const { error } = await this.collections.rpc("complete_outbox", {
        p_id: row.id, p_worker_id: this.workerId,
      });
      if (error) throw error;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida";
      console.error("[collection-worker] outbox_item_failed", {
        workerId: this.workerId, outboxId: row.id, topic: row.topic, error: message,
      });
      if (row.topic === "spreadsheet.publish") {
        await this.spreadsheets.markPublishFailed(row.aces_id, row.aggregate_id, error);
      }
      await this.collections.rpc("fail_outbox", {
        p_id: row.id, p_worker_id: this.workerId, p_error: message,
        p_retry_seconds: retryDelaySeconds(row.attempt_count), p_max_attempts: 8,
      });
    }
  }

  private async prepareCase(caseId: string) {
    const { data, error } = await this.collections.from("cases").select("*")
      .eq("id", caseId).maybeSingle();
    if (error) throw error;
    if (!data) return;
    const collectionCase = data as CaseRow;
    if (collectionCase.source_freshness !== "fresh" || collectionCase.open_receivables_count <= 0
      || ["paused", "in_service", "completed", "stale", "error"].includes(collectionCase.communication_status)) {
      const { error: cancelError } = await this.collections.rpc("cancel_pending_for_case", {
        p_case_id: collectionCase.id,
        p_reason: `Caso nao comunicavel: ${collectionCase.communication_status}`,
      });
      if (cancelError) throw cancelError;
      return;
    }
    await this.ensureCaseLead(collectionCase);
  }

  private async resolveBinding(collectionCase: CaseRow) {
    const { data, error } = await this.collections.from("agent_source_bindings")
      .select("id, agent_tool_id, creditor_external_id, priority")
      .eq("aces_id", collectionCase.aces_id)
      .eq("source_connection_id", collectionCase.source_connection_id)
      .eq("is_enabled", true);
    if (error) throw error;
    const bindings = (data ?? []) as BindingRow[];
    const scoped = bindings.filter((item) => item.creditor_external_id === collectionCase.creditor_external_id);
    const candidates = (scoped.length > 0 ? scoped : bindings.filter((item) => item.creditor_external_id === null))
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
    if (candidates.length === 0) return { binding: null, conflict: false };
    if (candidates.length > 1 && candidates[0].priority === candidates[1].priority) {
      return { binding: null, conflict: true };
    }
    return { binding: candidates[0], conflict: false };
  }

  private async ensureCaseLead(collectionCase: CaseRow) {
    const route = await this.resolveBinding(collectionCase);
    if (route.conflict || !route.binding) {
      await this.collections.from("cases").update({
        communication_status: "eligible",
        pause_reason: route.conflict ? "Conflito entre vinculos de agente" : "Aguardando configuracao da cobranca",
      }).eq("id", collectionCase.id).eq("aces_id", collectionCase.aces_id);
      return null;
    }
    const { data: tool, error: toolError } = await this.agents.from("agent_tools")
      .select("id, agent_id, is_enabled, readiness, tool_key")
      .eq("id", route.binding.agent_tool_id).eq("aces_id", collectionCase.aces_id).maybeSingle();
    if (toolError) throw toolError;
    if (!tool || tool.tool_key !== "collection_orchestration" || !tool.is_enabled || tool.readiness !== "ready") {
      await this.collections.from("cases").update({
        communication_status: "eligible",
        pause_reason: "Aguardando ativacao do agente de cobranca",
      }).eq("id", collectionCase.id).eq("aces_id", collectionCase.aces_id);
      return null;
    }
    const { data: agent, error: agentError } = await this.agents.from("ai_agents")
      .select("id, instance_name, is_active").eq("id", tool.agent_id)
      .eq("aces_id", collectionCase.aces_id).maybeSingle();
    if (agentError) throw agentError;
    if (!agent?.is_active || !agent.instance_name) {
      await this.collections.from("cases").update({
        communication_status: "eligible",
        pause_reason: "Aguardando ativacao do agente de cobranca",
      }).eq("id", collectionCase.id).eq("aces_id", collectionCase.aces_id);
      return null;
    }

    let leadId = collectionCase.lead_id;
    if (leadId) {
      const { data: linkedLead, error: linkedError } = await this.crm.from("leads")
        .select("id, instancia, view").eq("id", leadId).eq("aces_id", collectionCase.aces_id).maybeSingle();
      if (linkedError) throw linkedError;
      if (!linkedLead?.view || linkedLead.instancia !== agent.instance_name) {
        await this.collections.from("cases").update({ communication_status: "error",
          pause_reason: "Lead vinculado a outra instancia" })
          .eq("id", collectionCase.id).eq("aces_id", collectionCase.aces_id);
        return null;
      }
      return leadId;
    }

    const identity = normalizePhoneIdentity(collectionCase.customer_phone);
    if (!identity) throw new Error("Telefone do caso nao possui identidade valida");
    const { data: existing, error: existingError } = await this.crm.from("leads")
      .select("id, instancia").eq("aces_id", collectionCase.aces_id)
      .eq("phone_identity", identity).eq("view", true)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (existingError) throw existingError;
    if (existing && existing.instancia !== agent.instance_name) {
      await this.collections.from("cases").update({ communication_status: "error",
        pause_reason: "Contato ja pertence a outra instancia" })
        .eq("id", collectionCase.id).eq("aces_id", collectionCase.aces_id);
      return null;
    }
    if (existing) leadId = existing.id;
    else {
      const { data: created, error: createError } = await this.crm.from("leads").insert({
        aces_id: collectionCase.aces_id,
        name: collectionCase.customer_name,
        contact_phone: normalizePhoneForStorage(collectionCase.customer_phone),
        status: "Novo", stage_id: null, instancia: agent.instance_name, view: true,
        Fonte: "Cobranca",
      }).select("id").single();
      if (createError) throw createError;
      leadId = created.id;
    }
    const { error: updateError } = await this.collections.from("cases")
      .update({ lead_id: leadId, pause_reason: null })
      .eq("id", collectionCase.id).eq("aces_id", collectionCase.aces_id);
    if (updateError) throw updateError;
    return leadId;
  }

  private async evaluateEligibleCases() {
    const { data, error } = await this.collections.rpc("list_eligible_decisions", { p_limit: 5000 });
    if (error) throw error;
    const decisions = (data ?? []) as EligibleDecision[];
    const bestByContact = new Map<string, EligibleDecision>();
    for (const decision of decisions) {
      const phoneIdentity = normalizePhoneIdentity(decision.customer_phone);
      if (!phoneIdentity) continue;
      const key = `${decision.aces_id}:${phoneIdentity}:${decision.local_date}:${decision.message_id}`;
      const existing = bestByContact.get(key);
      const preferred = !existing
        || decision.priority > existing.priority
        || (decision.priority === existing.priority && decision.most_overdue_days > existing.most_overdue_days)
        || (decision.priority === existing.priority && decision.most_overdue_days === existing.most_overdue_days
          && Number(decision.total_open_amount) > Number(existing.total_open_amount))
        || (decision.priority === existing.priority && decision.most_overdue_days === existing.most_overdue_days
          && Number(decision.total_open_amount) === Number(existing.total_open_amount)
          && decision.case_id.localeCompare(existing.case_id) < 0);
      if (preferred) bestByContact.set(key, decision);
    }
    for (const decision of bestByContact.values()) {
      const decisionKey = `collection:${decision.aces_id}:${decision.case_id}:${decision.journey_rule_id}:${decision.message_id}:${decision.local_date}`;
      const { error: enrollError } = await this.collections.rpc("enroll_collection_case", {
        p_case_id: decision.case_id,
        p_journey_rule_id: decision.journey_rule_id,
        p_decision_key: decisionKey,
        p_anchor_at: new Date().toISOString(),
        p_message_id: decision.message_id,
      });
      if (enrollError) throw enrollError;
    }
  }
}

export function startCollectionWorker(config: ConstructorParameters<typeof CollectionWorker>[0]) {
  return new CollectionWorker(config).start();
}
