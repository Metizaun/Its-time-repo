import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { RbClient, type RbBillingJourneyKind, type RbBillingRecord } from "../rb-client.js";
import { RbCollectionAdapter } from "./adapters/rb-adapter.js";
import { CollectionService } from "./collection-service.js";
import { CollectionIngestionService } from "./ingestion-service.js";

type LegacyConnection = {
  id: string;
  aces_id: number;
  rb_aces_id: number | null;
  rb_base_url: string;
  rb_token_api: string;
  rb_empresa_ids: unknown;
  is_active: boolean;
  billing_enabled: boolean;
};

type CanonicalSource = {
  id: string;
  aces_id: number;
  timezone: string;
  config: Record<string, unknown>;
  status: string;
};

type LegacyMetadata = {
  lead_id: string;
  aces_id: number;
  clie_id: string | null;
  cpf_cnpj: string | null;
  store_emp_id: string | null;
  store_emp_cpf_cnpj: string | null;
  titles: unknown;
  last_sync_at: string | null;
  pix_key: string | null;
};

const PAYMENT_METHODS: Record<string, "cash" | "card" | "bank_transfer" | "pix" | "store_credit" | "boleto" | "other"> = {
  "1": "cash", "2": "card", "4": "bank_transfer", "6": "store_credit",
  "7": "pix", "8": "store_credit", "9": "boleto",
};

function strings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value))
    .map(([key, item]) => [String(key).trim(), String(item ?? "").trim()])
    .filter(([key, item]) => Boolean(key && item)));
}

function localDate(timezone: string, value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

export class RbCanonicalService {
  private readonly rb: SupabaseClient<any, "rb", any>;
  private readonly crm: SupabaseClient<any, "crm", any>;
  private readonly agents: SupabaseClient<any, "agents", any>;
  private readonly collectionService: CollectionService;
  private readonly ingestion: CollectionIngestionService;
  private readonly adapter = new RbCollectionAdapter();

  constructor(private readonly config: { supabaseUrl: string; serviceRoleKey: string; mockFixturePath?: string | null }) {
    const auth = { persistSession: false, autoRefreshToken: false };
    this.rb = createClient(config.supabaseUrl, config.serviceRoleKey, { auth, db: { schema: "rb" } });
    this.crm = createClient(config.supabaseUrl, config.serviceRoleKey, { auth, db: { schema: "crm" } });
    this.agents = createClient(config.supabaseUrl, config.serviceRoleKey, { auth, db: { schema: "agents" } });
    this.collectionService = new CollectionService(config.supabaseUrl, config.serviceRoleKey);
    this.ingestion = new CollectionIngestionService(this.collectionService.collections);
  }

  private async legacyConnection(acesId: number, requireBillingEnabled = true) {
    let query = this.rb.from("connections").select("*")
      .eq("aces_id", acesId).eq("is_active", true);
    if (requireBillingEnabled) query = query.eq("billing_enabled", true);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data as LegacyConnection | null;
  }

  async ensureCanonicalConnection(acesId: number, options: { refreshCredential?: boolean; requireBillingEnabled?: boolean } = {}) {
    const legacy = await this.legacyConnection(acesId, options.requireBillingEnabled ?? true);
    if (!legacy?.rb_token_api) throw new Error("Conexao RB ativa nao encontrada");
    const { data: preparedSource, error: prepareError } = await this.collectionService.collections.rpc("prepare_rb_source", {
      p_aces_id: acesId,
      p_legacy_connection_id: legacy.id,
      p_config: {
        rbAcesId: legacy.rb_aces_id,
        baseUrl: legacy.rb_base_url,
        empresaIds: strings(legacy.rb_empresa_ids),
        rbMode: "live",
        triggerTime: "08:00",
      },
      p_capabilities: this.adapter.capabilities,
    });
    if (prepareError) throw prepareError;
    let source = preparedSource as CanonicalSource;

    const syncedConfig = {
      ...record(source.config),
      legacyConnectionId: legacy.id,
      rbAcesId: legacy.rb_aces_id,
      baseUrl: legacy.rb_base_url,
      empresaIds: strings(legacy.rb_empresa_ids),
      rbMode: "live",
      triggerTime: record(source.config).triggerTime ?? "08:00",
    };
    const { data: syncedSource, error: sourceSyncError } = await this.collectionService.collections
      .from("source_connections").update({ config: syncedConfig })
      .eq("id", source.id).eq("aces_id", acesId).select("*").single();
    if (sourceSyncError) throw sourceSyncError;
    source = syncedSource as CanonicalSource;

    const { count, error: credentialError } = await this.collectionService.collections
      .from("source_credentials").select("id", { count: "exact", head: true })
      .eq("aces_id", acesId).eq("source_connection_id", source.id)
      .eq("credential_type", "rb_token").eq("status", "current");
    if (credentialError) throw credentialError;
    if (!count || options.refreshCredential) {
      await this.collectionService.storeCredential(acesId, source.id, "rb_token", legacy.rb_token_api);
    }
    return source;
  }

  async setBillingState(acesId: number, enabled: boolean) {
    if (enabled) {
      await this.prepareCanonicalSource(acesId);
    }
    const { error } = await this.collectionService.collections.rpc("set_rb_billing_state", {
      p_aces_id: acesId,
      p_enabled: enabled,
    });
    if (error) throw error;
    const { data: source, error: sourceError } = await this.collectionService.collections
      .from("source_connections").select("*")
      .eq("aces_id", acesId).eq("source_type", "rb").maybeSingle();
    if (sourceError) throw sourceError;
    return source as CanonicalSource | null;
  }

  /**
   * Prepares the canonical RB source without enabling collection sends.
   * The integrated onboarding owns the explicit sending switch; this method
   * only makes the source available for ingestion and canonical dispatch.
   */
  async prepareCanonicalSource(acesId: number) {
    const source = await this.ensureCanonicalConnection(acesId, {
      refreshCredential: true,
      requireBillingEnabled: false,
    });
    const sourceConfig = record(source.config);
    if (source.status !== "active" || sourceConfig.dispatcherMode !== "canonical") {
      await this.assertNoLegacyProcessing(acesId);
    }
    await this.convertLegacyJourneys(acesId, source.id);
    const refreshedSource = await this.collectionService.getSource(acesId, source.id);
    if (!refreshedSource) throw new Error("Fonte canonica RB nao encontrada apos a preparacao");
    const { data, error } = await this.collectionService.collections.from("source_connections")
      .update({
        status: "active",
        config: { ...record(refreshedSource.config), dispatcherMode: "canonical" },
      })
      .eq("id", source.id).eq("aces_id", acesId)
      .select("*").single();
    if (error) throw error;
    return data as CanonicalSource;
  }

  private async assertNoLegacyProcessing(acesId: number) {
    const { data: executions, error: executionError } = await this.crm
      .from("automation_executions")
      .select("id, funnel_id")
      .eq("aces_id", acesId)
      .eq("status", "processing");
    if (executionError) throw executionError;
    const funnelIds = (executions ?? []).map((execution) => String(execution.funnel_id)).filter(Boolean);
    if (funnelIds.length === 0) return;
    const { data: funnels, error: funnelError } = await this.crm
      .from("automation_funnels")
      .select("id")
      .eq("aces_id", acesId)
      .eq("entry_source", "rb")
      .in("id", funnelIds);
    if (funnelError) throw funnelError;
    if ((funnels?.length ?? 0) > 0) {
      throw new Error("Cobranca RB aguardando a conclusao de uma execucao legada em processamento");
    }
  }

  private async rbClient(source: CanonicalSource) {
    const [token] = await this.collectionService.getCredentialSecrets(source.aces_id, source.id, "rb_token");
    if (!token) throw new Error("Credencial RB canonica ausente");
    const config = record(source.config);
    return new RbClient({
      mode: config.rbMode === "mock" ? "mock" : "live",
      baseUrl: String(config.baseUrl ?? "https://app.registrobase.com.br:32077"),
      tokenApi: token,
      empresaIds: strings(config.empresaIds),
      mockFixturePath: this.config.mockFixturePath,
    });
  }

  private async source(sourceId: string, acesId?: number) {
    let query = this.collectionService.collections.from("source_connections").select("*")
      .eq("id", sourceId).eq("source_type", "rb");
    if (acesId !== undefined) query = query.eq("aces_id", acesId);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Fonte RB canonica nao encontrada");
    return data as CanonicalSource;
  }

  async pull(sourceId: string, acesId?: number) {
    const source = await this.source(sourceId, acesId);
    const { data: dispatcher, error: dispatcherError } = await this.collectionService.collections.rpc(
      "resolve_source_dispatcher",
      { p_source_connection_id: source.id },
    );
    if (dispatcherError) throw dispatcherError;
    if (dispatcher !== "canonical") {
      throw new Error("Fonte RB aguardando ativacao automatica ou regularizacao operacional");
    }
    if (source.status !== "active") throw new Error("Fonte RB nao esta ativa");
    if (!await this.legacyConnection(source.aces_id)) throw new Error("Cobranca RB esta pausada");
    const client = await this.rbClient(source);
    const { data: bindings, error: bindingError } = await this.collectionService.collections
      .from("journey_source_bindings").select("journey_rule_id")
      .eq("source_connection_id", source.id).eq("aces_id", source.aces_id);
    if (bindingError) throw bindingError;
    const ruleIds = (bindings ?? []).map((item: any) => item.journey_rule_id);
    let rules: any[] = [];
    if (ruleIds.length > 0) {
      const { data, error } = await this.collectionService.collections.from("journey_rules")
        .select("id, timing_relation, days_offset").eq("aces_id", source.aces_id)
        .eq("is_active", true).in("id", ruleIds);
      if (error) throw error;
      rules = data ?? [];
    }
    if (rules.length === 0) {
      rules = [
        { timing_relation: "before_due", days_offset: 2 },
        { timing_relation: "on_due", days_offset: 0 },
        { timing_relation: "after_due", days_offset: 1 },
        { timing_relation: "after_due", days_offset: 4 },
        { timing_relation: "after_due", days_offset: 15 },
      ];
    }

    const today = localDate(source.timezone);
    const summaries: unknown[] = [];
    const seen = new Set<string>();
    for (const rule of rules) {
      const kind: RbBillingJourneyKind = rule.timing_relation === "after_due" ? "charge" : "reminder";
      const offset = rule.timing_relation === "on_due" ? 0 : Number(rule.days_offset ?? 0);
      const partition = `${rule.timing_relation}:${offset}`;
      if (seen.has(partition)) continue;
      seen.add(partition);
      const rows = await client.fetchTitlesForRule(kind, offset, today);
      const companyPix = await this.listCompanyPix(source.aces_id, rows);
      const pixByCreditor = this.resolvePixByCreditor(rows, companyPix, stringRecord(record(source.config).trustedPixByCreditor));
      const occurredAt = new Date().toISOString();
      const envelope = await this.adapter.map({
        records: rows,
        sourcePartition: partition,
        paymentMethodById: PAYMENT_METHODS,
        pixByCreditor,
      }, {
        connectionId: source.id,
        timezone: source.timezone,
        occurredAt,
        ingestionId: `rb:${source.id}:${today}:${partition}`,
      });
      if (envelope.records.length === 0) {
        summaries.push({ partition, receivedCount: 0, skipped: true });
        continue;
      }
      summaries.push(await this.ingestion.ingest(envelope, {
        idempotencyKey: envelope.ingestionId,
        maxRecords: 50_000,
      }));
    }
    await this.collectionService.collections.from("source_connections").update({
      config: { ...record(source.config), lastPullAt: new Date().toISOString(), lastPullLocalDate: today },
    }).eq("id", source.id).eq("aces_id", source.aces_id);
    const shadow = await this.recordShadowComparison(source);
    return { sourceConnectionId: source.id, localDate: today, partitions: summaries, shadow };
  }

  private async recordShadowComparison(source: CanonicalSource) {
    const { data: dispatcher, error: dispatcherError } = await this.collectionService.collections.rpc(
      "resolve_source_dispatcher",
      { p_source_connection_id: source.id },
    );
    if (dispatcherError) throw dispatcherError;
    if (dispatcher !== "legacy_rb") return null;
    const comparison = await this.compare(source.aces_id, source.id);
    const hasDifference = comparison.differences.cases !== 0
      || comparison.differences.titles !== 0 || Math.abs(comparison.differences.balance) >= 0.01;
    const { data: run, error } = await this.collectionService.collections.from("rb_migration_runs").insert({
      aces_id: source.aces_id,
      source_connection_id: source.id,
      phase: "shadow",
      status: hasDifference ? "requires_review" : "succeeded",
      legacy_counts: comparison.legacy,
      canonical_counts: comparison.canonical,
      differences: comparison.differences,
      conflict_report: [],
      completed_at: new Date().toISOString(),
    }).select("id, status").single();
    if (error) throw error;
    return { ...run, ...comparison };
  }

  async backfill(acesId: number) {
    const source = await this.ensureCanonicalConnection(acesId, { requireBillingEnabled: false });
    const { data: run, error: runError } = await this.collectionService.collections
      .from("rb_migration_runs").insert({ aces_id: acesId, source_connection_id: source.id, phase: "backfill" })
      .select("id").single();
    if (runError) throw runError;
    try {
      const { data: metadata, error: metadataError } = await this.rb.from("lead_metadata")
        .select("*").eq("aces_id", acesId);
      if (metadataError) throw metadataError;
      const companyPix = await this.listCompanyPix(acesId, (metadata ?? []).map((item: LegacyMetadata) => ({
        EMP_CPFCNPJ: item.store_emp_cpf_cnpj,
      }) as RbBillingRecord));
      const leadIds = (metadata ?? []).map((item: LegacyMetadata) => item.lead_id);
      const leadsById = new Map<string, any>();
      for (let index = 0; index < leadIds.length; index += 200) {
        const { data: leads, error } = await this.crm.from("leads")
          .select("id, name, contact_phone").eq("aces_id", acesId).in("id", leadIds.slice(index, index + 200));
        if (error) throw error;
        for (const lead of leads ?? []) leadsById.set(lead.id, lead);
      }

      let acceptedTitles = 0;
      const conflicts: Array<Record<string, unknown>> = [];
      for (const item of (metadata ?? []) as LegacyMetadata[]) {
        const lead = leadsById.get(item.lead_id);
        const titles = Array.isArray(item.titles) ? item.titles.map(record) : [];
        if (!lead?.contact_phone || !item.clie_id) {
          conflicts.push({ leadId: item.lead_id, code: "missing_customer_identity" });
          continue;
        }
        const rows: RbBillingRecord[] = titles.map((title) => ({
          sourceBucket: "legacy_backfill",
          ACES_ID: acesId,
          CLIE_ID: item.clie_id,
          CLIE_NOMEPRINC: lead.name,
          CLIE_NOMESEC: null,
          CLIE_CPFCNPJ: item.cpf_cnpj,
          CLIE_FONE: lead.contact_phone,
          FIN_VLLIQUIDO: typeof title.amount === "number" ? title.amount : String(title.amount ?? "0"),
          DtVencimento: String(title.due_date ?? ""),
          DiasVenc: title.days_due as number | null,
          PGTO_IDORIGEM: title.payment_type_id as string | null,
          FORMA_ID: title.payment_type_id as string | null,
          EMP_ID: String(title.store_emp_id ?? item.store_emp_id ?? ""),
          EMP_CPFCNPJ: String(title.store_emp_cpf_cnpj ?? item.store_emp_cpf_cnpj ?? ""),
          Titulo: String(title.titulo ?? ""),
        }));
        if (rows.length === 0) continue;
        try {
          const envelope = await this.adapter.map({
            records: rows,
            sourcePartition: "legacy_backfill",
            pixByCreditor: this.resolvePixByCreditor(rows, companyPix, item.pix_key && item.store_emp_id
              ? { [item.store_emp_id]: item.pix_key } : {}),
            paymentMethodById: PAYMENT_METHODS,
          }, {
            connectionId: source.id,
            timezone: source.timezone,
            occurredAt: item.last_sync_at ?? new Date().toISOString(),
            ingestionId: `rb-backfill:${source.id}:${item.lead_id}`,
          });
          await this.ingestion.ingest(envelope, { idempotencyKey: envelope.ingestionId, maxRecords: 50_000 });
          acceptedTitles += envelope.records.length;
          const { error: linkError } = await this.collectionService.collections.from("cases")
            .update({ lead_id: item.lead_id }).eq("aces_id", acesId)
            .eq("source_connection_id", source.id).eq("external_customer_id", item.clie_id);
          if (linkError) throw linkError;
        } catch (error) {
          conflicts.push({ leadId: item.lead_id, code: "backfill_record_failed",
            message: error instanceof Error ? error.message : String(error) });
        }
      }
      await this.convertLegacyJourneys(acesId, source.id);
      const comparison = await this.compare(acesId, source.id);
      const status = conflicts.length > 0 || comparison.differences.balance !== 0
        ? "requires_review" : "succeeded";
      await this.collectionService.collections.from("rb_migration_runs").update({
        status, legacy_counts: comparison.legacy, canonical_counts: comparison.canonical,
        differences: comparison.differences, conflict_report: conflicts,
        completed_at: new Date().toISOString(),
      }).eq("id", run.id);
      return { migrationRunId: run.id, sourceConnectionId: source.id, acceptedTitles, conflicts, ...comparison };
    } catch (error) {
      await this.collectionService.collections.from("rb_migration_runs").update({
        status: "failed", conflict_report: [{ code: "backfill_failed",
          message: error instanceof Error ? error.message : String(error) }], completed_at: new Date().toISOString(),
      }).eq("id", run.id);
      throw error;
    }
  }

  private async convertLegacyJourneys(acesId: number, sourceId: string) {
    const { data: funnels, error: funnelError } = await this.crm.from("automation_funnels")
      .select("id").eq("aces_id", acesId).eq("entry_source", "rb");
    if (funnelError) throw funnelError;
    for (const funnel of funnels ?? []) {
      const { error } = await this.collectionService.collections.rpc("clone_rb_funnel_for_shadow", {
        p_aces_id: acesId,
        p_source_connection_id: sourceId,
        p_legacy_funnel_id: funnel.id,
      });
      if (error) throw error;
    }

    const { data: legacyTools, error: toolsError } = await this.agents.from("agent_tools")
      .select("agent_id, is_enabled, config").eq("aces_id", acesId).eq("tool_key", "rb_billing");
    if (toolsError) throw toolsError;
    const trustedPixByCreditor: Record<string, string> = {};
    for (const legacyTool of legacyTools ?? []) {
      for (const [creditor, pixKey] of Object.entries(
        stringRecord(record(legacyTool.config).pix_mapping_by_store),
      )) {
        if (!trustedPixByCreditor[creditor]) trustedPixByCreditor[creditor] = pixKey;
      }
    }
    if (Object.keys(trustedPixByCreditor).length > 0) {
      const currentSource = await this.source(sourceId, acesId);
      const { error: sourceError } = await this.collectionService.collections.from("source_connections")
        .update({ config: { ...record(currentSource.config), trustedPixByCreditor } })
        .eq("id", sourceId).eq("aces_id", acesId);
      if (sourceError) throw sourceError;
    }
    for (const legacyTool of legacyTools ?? []) {
      const { data: tool, error } = await this.agents.from("agent_tools").upsert({
        aces_id: acesId, agent_id: legacyTool.agent_id, tool_key: "collection_orchestration",
        tool_version: 1, is_enabled: Boolean(legacyTool.is_enabled), readiness: "ready", config: {},
        last_validated_at: new Date().toISOString(),
      }, { onConflict: "agent_id,tool_key" }).select("id").single();
      if (error) throw error;
      const { data: existingBinding, error: existingBindingError } = await this.collectionService.collections
        .from("agent_source_bindings").select("id")
        .eq("aces_id", acesId).eq("agent_tool_id", tool.id)
        .eq("source_connection_id", sourceId).is("creditor_external_id", null).maybeSingle();
      if (existingBindingError) throw existingBindingError;
      const bindingWrite = existingBinding
        ? this.collectionService.collections.from("agent_source_bindings")
          .update({ priority: 100, is_enabled: true }).eq("id", existingBinding.id).eq("aces_id", acesId)
        : this.collectionService.collections.from("agent_source_bindings")
          .insert({ aces_id: acesId, agent_tool_id: tool.id, source_connection_id: sourceId,
            creditor_external_id: null, priority: 100, is_enabled: true });
      const { error: bindingError } = await bindingWrite;
      if (bindingError) throw bindingError;
    }
  }

  private async listCompanyPix(acesId: number, rows: RbBillingRecord[]) {
    const cnpjs = Array.from(new Set(rows
      .map((item) => String(item.EMP_CPFCNPJ ?? "").replace(/\D/g, ""))
      .filter(Boolean)));
    const companies = new Map<string, { cnpj: string; pix_key: string | null; use_cnpj_as_pix: boolean }>();
    if (cnpjs.length === 0) return companies;
    const { data, error } = await this.crm.from("empresas")
      .select("cnpj, pix_key, use_cnpj_as_pix")
      .eq("aces_id", acesId).in("cnpj", cnpjs);
    if (error) throw error;
    for (const company of data ?? []) {
      companies.set(String(company.cnpj).replace(/\D/g, ""), company);
    }
    return companies;
  }

  private resolvePixByCreditor(
    rows: RbBillingRecord[],
    companies: Map<string, { cnpj: string; pix_key: string | null; use_cnpj_as_pix: boolean }>,
    legacy: Record<string, string>,
  ) {
    const resolved = { ...legacy };
    for (const row of rows) {
      const cnpj = String(row.EMP_CPFCNPJ ?? "").replace(/\D/g, "");
      const company = companies.get(cnpj);
      if (!company) continue;
      const key = String(row.EMP_ID ?? "").trim() || cnpj;
      resolved[key] = company.use_cnpj_as_pix
        ? cnpj
        : String(company.pix_key ?? "").trim();
      resolved[cnpj] = resolved[key];
    }
    return resolved;
  }

  async compare(acesId: number, sourceId: string) {
    const [{ data: legacy, error: legacyError }, { data: canonical, error: canonicalError }] = await Promise.all([
      this.rb.from("lead_metadata").select("total_amount, titles_count").eq("aces_id", acesId),
      this.collectionService.collections.from("cases").select("total_open_amount, open_receivables_count")
        .eq("aces_id", acesId).eq("source_connection_id", sourceId).gt("open_receivables_count", 0),
    ]);
    if (legacyError) throw legacyError;
    if (canonicalError) throw canonicalError;
    const legacyCounts = { cases: legacy?.length ?? 0,
      titles: (legacy ?? []).reduce((sum: number, item: any) => sum + Number(item.titles_count ?? 0), 0),
      balance: (legacy ?? []).reduce((sum: number, item: any) => sum + Number(item.total_amount ?? 0), 0) };
    const canonicalCounts = { cases: canonical?.length ?? 0,
      titles: (canonical ?? []).reduce((sum: number, item: any) => sum + Number(item.open_receivables_count ?? 0), 0),
      balance: (canonical ?? []).reduce((sum: number, item: any) => sum + Number(item.total_open_amount ?? 0), 0) };
    return { legacy: legacyCounts, canonical: canonicalCounts, differences: {
      cases: canonicalCounts.cases - legacyCounts.cases,
      titles: canonicalCounts.titles - legacyCounts.titles,
      balance: Number((canonicalCounts.balance - legacyCounts.balance).toFixed(2)),
    } };
  }

  async cutover(acesId: number, sourceId: string, actorId: string | null, reason: string) {
    await this.source(sourceId, acesId);
    const { data: shadowRuns, error: shadowError } = await this.collectionService.collections
      .from("rb_migration_runs").select("id, status, started_at")
      .eq("aces_id", acesId).eq("source_connection_id", sourceId).eq("phase", "shadow")
      .order("started_at", { ascending: false }).limit(3);
    if (shadowError) throw shadowError;
    if ((shadowRuns?.length ?? 0) < 3 || shadowRuns?.some((run: any) => run.status !== "succeeded")) {
      throw new Error("Cutover bloqueado: sao necessarios tres ciclos sombra consecutivos e aprovados");
    }
    const comparison = await this.compare(acesId, sourceId);
    if (comparison.differences.cases !== 0 || comparison.differences.titles !== 0
      || Math.abs(comparison.differences.balance) >= 0.01) {
      throw new Error("Cutover bloqueado: RB e nucleo canonico possuem divergencias");
    }
    const { error: pauseError } = await this.collectionService.collections.rpc("set_active_dispatcher", {
      p_aces_id: acesId, p_dispatcher: "paused",
      p_reason: `Preparacao de cutover: ${reason}`, p_actor_id: actorId,
    });
    if (pauseError) throw pauseError;
    const { data, error } = await this.collectionService.collections
      .rpc("complete_canonical_cutover", {
        p_aces_id: acesId,
        p_source_connection_id: sourceId,
        p_reason: reason,
        p_actor_id: actorId,
      });
    if (error) throw error;
    return { runtime: data, comparison };
  }
}
