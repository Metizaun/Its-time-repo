import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  RbClient,
  type RbBillingJourneyKind,
  type RbBillingMode,
  type RbBillingRecord,
} from "./rb-client.js";

type JsonRecord = Record<string, unknown>;

type RbBillingToolConfig = {
  rb_mode: RbBillingMode;
  rb_base_url: string;
  rb_token_api: string;
  rb_empresa_ids: string[];
  trigger_time: string;
  timezone: string;
  pix_mapping_by_store: Record<string, string>;
  gupshup_defaults: Record<string, string>;
  is_dr_oculos_bootstrap: boolean;
  last_run_on_local_date: string | null;
  default_owner_id?: string | null;
};

type RbToolBinding = {
  id: string;
  aces_id: number;
  agent_id: string;
  tool_key: string;
  is_enabled: boolean;
  readiness: string;
  config: JsonRecord;
};

type AgentRow = {
  id: string;
  aces_id: number;
  name: string;
  instance_name: string;
  is_active: boolean;
};

type LeadRow = {
  id: string;
  aces_id: number;
  name: string | null;
  contact_phone: string | null;
  stage_id: string | null;
  owner_id: string | null;
  instancia: string | null;
  rb_clie_id: string | null;
  rb_cpf_cnpj: string | null;
  rb_store_emp_id: string | null;
};

type GroupedDebt = {
  key: string;
  phone: string;
  clieId: string;
  cpfCnpj: string;
  customerName: string;
  storeEmpId: string;
  storeEmpCpfCnpj: string;
  pixKey: string;
  totalAmount: number;
  titlesCount: number;
  nextDueDate: string | null;
  paymentTypeIds: string[];
  titles: Array<{
    titulo: string;
    amount: number;
    due_date: string | null;
    days_due: number | null;
    payment_type_id: string | null;
    store_emp_id: string;
    store_emp_cpf_cnpj: string;
  }>;
};

type StageRow = {
  id: string;
  name: string;
  pipeline_id: string;
  category: string | null;
};

type RbJourneyConfig = {
  funnelId: string;
  name: string;
  instanceName: string;
  triggerStageId: string;
  replyTargetStageId: string | null;
  rbMessageKind: RbBillingJourneyKind;
  rbDaysOffset: number;
  rbPaymentTypeIds: string[];
};

type RunSummary = {
  due_records_count: number;
  overdue_records_count: number;
  grouped_contacts_count: number;
  created_leads_count: number;
  updated_leads_count: number;
  moved_leads_count: number;
  skipped_without_phone_count: number;
  completed_leads_count: number;
};

type WorkerConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  mockFixturePath?: string | null;
  pollMs?: number;
};

const RB_PAYMENT_TYPE_LABELS: Record<string, string> = {
  "1": "Dinheiro",
  "2": "Cartao",
  "3": "Cheque",
  "4": "Movimento bancario",
  "5": "Credito financeiro",
  "6": "Carne",
  "7": "Pix",
  "8": "Crediario proprio",
  "9": "Boleto",
};

const RB_PAYMENT_TAG_PREFIX = "Pagamento: ";

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "";
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => asString(item)).filter(Boolean)
    : typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function normalizeDigits(value: string) {
  return value.replace(/\D+/g, "");
}

function normalizeCpfCnpj(value: unknown) {
  return normalizeDigits(asString(value));
}

function normalizePhone(value: unknown) {
  const digits = normalizeDigits(asString(value));
  if (!digits) {
    return "";
  }

  if (digits.startsWith("55") && digits.length >= 12) {
    return digits;
  }

  if (digits.length >= 10 && digits.length <= 11) {
    return `55${digits}`;
  }

  return digits;
}

function phoneVariants(phone: string) {
  const digits = normalizeDigits(phone);
  if (!digits) {
    return [];
  }

  const variants = new Set<string>([digits]);
  if (digits.startsWith("55") && digits.length > 11) {
    variants.add(digits.slice(2));
  } else {
    variants.add(`55${digits}`);
  }
  return Array.from(variants);
}

function normalizePaymentTypeId(value: unknown) {
  return asString(value);
}

function resolvePaymentTypeId(record: RbBillingRecord) {
  return normalizePaymentTypeId(
    (record as Record<string, unknown>).PGTO_IDORIGEM ??
      (record as Record<string, unknown>).pgto_idorigem ??
      (record as Record<string, unknown>).forma_id ??
      record.FORMA_ID
  );
}

function parseDate(value: unknown) {
  const raw = asString(value);
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function getLocalDate(timezone: string, when = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(when);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function getLocalTime(timezone: string, when = new Date()) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(when);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function parseRbConfig(value: JsonRecord): RbBillingToolConfig {
  const pixMapping = asRecord(value.pix_mapping_by_store);
  const gupshupDefaults = asRecord(value.gupshup_defaults);

  return {
    rb_mode: value.rb_mode === "mock" ? "mock" : "live",
    rb_base_url: asString(value.rb_base_url),
    rb_token_api: asString(value.rb_token_api),
    rb_empresa_ids: asStringArray(value.rb_empresa_ids),
    trigger_time: asString(value.trigger_time) || "10:00",
    timezone: asString(value.timezone) || "America/Sao_Paulo",
    pix_mapping_by_store: Object.fromEntries(
      Object.entries(pixMapping).map(([key, item]) => [key, asString(item)]).filter(([, item]) => item)
    ),
    gupshup_defaults: Object.fromEntries(
      Object.entries(gupshupDefaults).map(([key, item]) => [key, asString(item)]).filter(([, item]) => item)
    ),
    is_dr_oculos_bootstrap: value.is_dr_oculos_bootstrap === true,
    last_run_on_local_date: asString(value.last_run_on_local_date) || null,
    default_owner_id: asString(value.default_owner_id) || null,
  };
}

function isConfigReady(config: RbBillingToolConfig) {
  if (!config.rb_base_url || !config.trigger_time || !config.timezone) {
    return false;
  }

  if (config.rb_mode !== "mock" && (!config.rb_token_api || config.rb_empresa_ids.length === 0)) {
    return false;
  }

  return true;
}

function getPixKey(config: RbBillingToolConfig, record: RbBillingRecord) {
  const byEmpId = config.pix_mapping_by_store[asString(record.EMP_ID)];
  const byEmpCpfCnpj = config.pix_mapping_by_store[normalizeCpfCnpj(record.EMP_CPFCNPJ)];
  return byEmpId || byEmpCpfCnpj || normalizeCpfCnpj(record.EMP_CPFCNPJ) || asString(record.EMP_CPFCNPJ);
}

function groupRbRecords(records: RbBillingRecord[], config: RbBillingToolConfig) {
  const grouped = new Map<string, GroupedDebt>();

  for (const record of records) {
    const phone = normalizePhone(record.CLIE_FONE);
    if (!phone) {
      continue;
    }

    const storeEmpId = asString(record.EMP_ID);
    const storeEmpCpfCnpj = normalizeCpfCnpj(record.EMP_CPFCNPJ);
    const key = `${phone}|${storeEmpId || storeEmpCpfCnpj}`;
    const amount = RbClient.normalizeMoney(record.FIN_VLLIQUIDO);
    const dueDate = parseDate(record.DtVencimento);
    const paymentTypeId = resolvePaymentTypeId(record);

    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        key,
        phone,
        clieId: asString(record.CLIE_ID),
        cpfCnpj: normalizeCpfCnpj(record.CLIE_CPFCNPJ),
        customerName: asString(record.CLIE_NOMEPRINC),
        storeEmpId,
        storeEmpCpfCnpj,
        pixKey: getPixKey(config, record),
        totalAmount: amount,
        titlesCount: 1,
        nextDueDate: dueDate,
        paymentTypeIds: paymentTypeId ? [paymentTypeId] : [],
        titles: [
          {
            titulo: asString(record.Titulo),
            amount,
            due_date: dueDate,
            days_due: RbClient.normalizeMoney(record.DiasVenc),
            payment_type_id: paymentTypeId || null,
            store_emp_id: storeEmpId,
            store_emp_cpf_cnpj: storeEmpCpfCnpj,
          },
        ],
      });
      continue;
    }

    existing.totalAmount += amount;
    existing.titlesCount += 1;
    existing.titles.push({
      titulo: asString(record.Titulo),
      amount,
      due_date: dueDate,
      days_due: RbClient.normalizeMoney(record.DiasVenc),
      payment_type_id: paymentTypeId || null,
      store_emp_id: storeEmpId,
      store_emp_cpf_cnpj: storeEmpCpfCnpj,
    });

    if (paymentTypeId && !existing.paymentTypeIds.includes(paymentTypeId)) {
      existing.paymentTypeIds.push(paymentTypeId);
    }

    if (dueDate && (!existing.nextDueDate || dueDate < existing.nextDueDate)) {
      existing.nextDueDate = dueDate;
    }
  }

  return Array.from(grouped.values());
}

function buildSummaryPayload(summary: RunSummary, activeKeys: string[]) {
  return {
    ...summary,
    active_keys: activeKeys,
  };
}

export class RbBillingWorker {
  private readonly serviceClient: SupabaseClient<any, "crm", any>;
  private readonly agentsClient: SupabaseClient<any, "agents", any>;
  private readonly rbServiceClient: SupabaseClient<any, "rb", any>;
  private readonly config: WorkerConfig;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(config: WorkerConfig) {
    this.config = config;
    this.serviceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "crm" },
    });
    this.agentsClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "agents" },
    });
    this.rbServiceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "rb" },
    });
  }

  start() {
    if (this.timer) {
      return this;
    }

    const pollMs = this.config.pollMs ?? 60000;
    this.timer = setInterval(() => {
      this.processDueTools().catch((error) => {
        console.error("[rb-billing-worker] Erro no ciclo do worker:", error);
      });
    }, pollMs);

    this.processDueTools().catch((error) => {
      console.error("[rb-billing-worker] Erro na execucao inicial:", error);
    });

    console.log(`[rb-billing-worker] Rodando a cada ${pollMs}ms`);
    return this;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processDueTools() {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const bindings = await this.listEligibleBindings();
      for (const binding of bindings) {
        const config = parseRbConfig(binding.config);
        const localDate = getLocalDate(config.timezone);
        const localTime = getLocalTime(config.timezone);
        if (config.trigger_time !== localTime || config.last_run_on_local_date === localDate) {
          continue;
        }
        await this.runTool(binding, { forceSchedule: false });
      }
    } finally {
      this.running = false;
    }
  }

  async runNowForAgent(acesId: number, agentId: string) {
    const binding = await this.getBindingForAgent(acesId, agentId);
    return this.runTool(binding, { forceSchedule: true });
  }

  private async listEligibleBindings() {
    const { data, error } = await this.agentsClient
      .from("agent_tools")
      .select("id, aces_id, agent_id, tool_key, is_enabled, readiness, config")
      .eq("tool_key", "rb_billing")
      .eq("is_enabled", true)
      .eq("readiness", "ready");

    if (error) {
      throw new Error(`Nao foi possivel listar Tools RB: ${error.message}`);
    }

    return (data ?? []) as RbToolBinding[];
  }

  private async getBindingForAgent(acesId: number, agentId: string) {
    const { data, error } = await this.agentsClient
      .from("agent_tools")
      .select("id, aces_id, agent_id, tool_key, is_enabled, readiness, config")
      .eq("aces_id", acesId)
      .eq("agent_id", agentId)
      .eq("tool_key", "rb_billing")
      .maybeSingle();

    if (error) {
      throw new Error(`Nao foi possivel carregar a Tool RB: ${error.message}`);
    }

    if (!data) {
      throw new Error("Tool RB nao instalada neste agente");
    }

    return data as RbToolBinding;
  }

  private async getAgent(agentId: string, acesId: number) {
    const { data, error } = await this.agentsClient
      .from("ai_agents")
      .select("id, aces_id, name, instance_name, is_active")
      .eq("id", agentId)
      .eq("aces_id", acesId)
      .maybeSingle();

    if (error) {
      throw new Error(`Nao foi possivel carregar o agente RB: ${error.message}`);
    }

    if (!data) {
      throw new Error("Agente RB nao encontrado");
    }

    return data as AgentRow;
  }

  private async tryStartRun(binding: RbToolBinding, localRunDate: string) {
    const { data, error } = await this.rbServiceClient
      .from("sync_runs")
      .insert({
        aces_id: binding.aces_id,
        agent_tool_id: binding.id,
        agent_id: binding.agent_id,
        local_run_date: localRunDate,
        status: "running",
      })
      .select("id")
      .maybeSingle();

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        return null;
      }
      throw new Error(`Nao foi possivel iniciar a auditoria RB: ${error.message}`);
    }

    return asString(data?.id);
  }

  private async finishRun(
    runId: string,
    status: "succeeded" | "failed",
    summary: RunSummary,
    activeKeys: string[],
    errorMessage?: string | null
  ) {
    const { error } = await this.rbServiceClient
      .from("sync_runs")
      .update({
        status,
        completed_at: new Date().toISOString(),
        due_records_count: summary.due_records_count,
        overdue_records_count: summary.overdue_records_count,
        grouped_contacts_count: summary.grouped_contacts_count,
        created_leads_count: summary.created_leads_count,
        updated_leads_count: summary.updated_leads_count,
        moved_leads_count: summary.moved_leads_count + summary.completed_leads_count,
        skipped_without_phone_count: summary.skipped_without_phone_count,
        payload_summary: buildSummaryPayload(summary, activeKeys),
        error_message: errorMessage ?? null,
      })
      .eq("id", runId);

    if (error) {
      console.error("[rb-billing-worker] Falha ao concluir auditoria RB:", error);
    }
  }

  private async updateBindingLastRun(bindingId: string, localDate: string) {
    const { data, error } = await this.agentsClient
      .from("agent_tools")
      .select("config")
      .eq("id", bindingId)
      .maybeSingle();

    if (error || !data) {
      return;
    }

    const nextConfig = {
      ...asRecord(data.config),
      last_run_on_local_date: localDate,
    };

    await this.agentsClient.from("agent_tools").update({ config: nextConfig }).eq("id", bindingId);
  }

  private async getDefaultOwnerId(acesId: number, config?: RbBillingToolConfig) {
    const configuredOwnerId = config?.default_owner_id?.trim();
    if (configuredOwnerId) {
      if (!isUuid(configuredOwnerId)) {
        throw new Error("O responsavel padrao configurado para a cobranca e invalido");
      }

      const { data: configuredOwner, error: configuredOwnerError } = await this.serviceClient
        .from("users")
        .select("id")
        .eq("id", configuredOwnerId)
        .eq("aces_id", acesId)
        .neq("role", "NENHUM")
        .maybeSingle();

      if (configuredOwnerError) {
        throw new Error(
          `Nao foi possivel validar o responsavel padrao da cobranca: ${configuredOwnerError.message}`
        );
      }

      if (!configuredOwner) {
        throw new Error("O responsavel padrao da cobranca nao pertence a esta conta ou esta inativo");
      }

      return configuredOwnerId;
    }

    const { data, error } = await this.serviceClient
      .from("users")
      .select("id")
      .eq("aces_id", acesId)
      .neq("role", "NENHUM")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Nao foi possivel resolver o responsavel padrao: ${error.message}`);
    }

    return asString(data?.id) || null;
  }

  private async findLeadByPhone(acesId: number, phone: string): Promise<LeadRow | null> {
    const variants = phoneVariants(phone);
    const { data: lead, error } = await this.serviceClient
      .from("leads")
      .select("id, aces_id, name, contact_phone, stage_id, owner_id, instancia")
      .eq("aces_id", acesId)
      .in("contact_phone", variants)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Nao foi possivel localizar lead por telefone: ${error.message}`);
    }

    if (!lead) {
      return null;
    }

    const { data: meta } = await this.rbServiceClient
      .from("lead_metadata")
      .select("clie_id, cpf_cnpj, store_emp_id")
      .eq("lead_id", lead.id)
      .maybeSingle();

    return {
      id: lead.id,
      aces_id: lead.aces_id,
      name: lead.name,
      contact_phone: lead.contact_phone,
      stage_id: lead.stage_id,
      owner_id: lead.owner_id,
      instancia: lead.instancia,
      rb_clie_id: meta?.clie_id ?? null,
      rb_cpf_cnpj: meta?.cpf_cnpj ?? null,
      rb_store_emp_id: meta?.store_emp_id ?? null,
    };
  }

  private async findLeadByFallback(acesId: number, debt: GroupedDebt): Promise<LeadRow | null> {
    let meta: any = null;

    if (debt.cpfCnpj) {
      const { data, error } = await this.rbServiceClient
        .from("lead_metadata")
        .select("lead_id, clie_id, cpf_cnpj, store_emp_id")
        .eq("aces_id", acesId)
        .eq("cpf_cnpj", debt.cpfCnpj)
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(`Nao foi possivel localizar metadata por CPF/CNPJ: ${error.message}`);
      }
      if (data) {
        meta = data;
      }
    }

    if (!meta && debt.clieId) {
      const { data, error } = await this.rbServiceClient
        .from("lead_metadata")
        .select("lead_id, clie_id, cpf_cnpj, store_emp_id")
        .eq("aces_id", acesId)
        .eq("clie_id", debt.clieId)
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(`Nao foi possivel localizar metadata por CLIE_ID: ${error.message}`);
      }
      if (data) {
        meta = data;
      }
    }

    if (!meta) {
      return null;
    }

    const { data: lead, error: leadError } = await this.serviceClient
      .from("leads")
      .select("id, aces_id, name, contact_phone, stage_id, owner_id, instancia")
      .eq("id", meta.lead_id)
      .maybeSingle();

    if (leadError) {
      throw new Error(`Nao foi possivel localizar lead pelo metadata: ${leadError.message}`);
    }

    if (!lead) {
      return null;
    }

    return {
      id: lead.id,
      aces_id: lead.aces_id,
      name: lead.name,
      contact_phone: lead.contact_phone,
      stage_id: lead.stage_id,
      owner_id: lead.owner_id,
      instancia: lead.instancia,
      rb_clie_id: meta.clie_id ?? null,
      rb_cpf_cnpj: meta.cpf_cnpj ?? null,
      rb_store_emp_id: meta.store_emp_id ?? null,
    };
  }

  private async createLead(
    acesId: number,
    agent: AgentRow,
    debt: GroupedDebt,
    ownerId: string | null
  ): Promise<LeadRow> {
    const { data, error } = await this.serviceClient
      .from("leads")
      .insert({
        aces_id: acesId,
        name: debt.customerName || `Lead ${debt.phone}`,
        contact_phone: debt.phone,
        status: "Novo",
        stage_id: null,
        instancia: agent.instance_name,
        owner_id: ownerId,
        view: true,
      })
      .select("id, aces_id, name, contact_phone, stage_id, owner_id, instancia")
      .single();

    if (error) {
      throw new Error(`Nao foi possivel criar lead RB: ${error.message}`);
    }

    return {
      id: data.id,
      aces_id: data.aces_id,
      name: data.name,
      contact_phone: data.contact_phone,
      stage_id: data.stage_id,
      owner_id: data.owner_id,
      instancia: data.instancia,
      rb_clie_id: null,
      rb_cpf_cnpj: null,
      rb_store_emp_id: null,
    };
  }

  private async saveLeadRbState(
    leadId: string,
    acesId: number,
    agent: AgentRow,
    debt: GroupedDebt,
    enforcedOwnerId: string | null
  ) {
    const { error: leadError } = await this.serviceClient
      .from("leads")
      .update({
        name: debt.customerName || null,
        contact_phone: debt.phone,
        instancia: agent.instance_name,
        ...(enforcedOwnerId ? { owner_id: enforcedOwnerId } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId)
      .eq("aces_id", acesId);

    if (leadError) {
      throw new Error(`Nao foi possivel atualizar lead base no CRM: ${leadError.message}`);
    }

    const { error: metaError } = await this.rbServiceClient
      .from("lead_metadata")
      .upsert({
        lead_id: leadId,
        aces_id: acesId,
        clie_id: debt.clieId || null,
        cpf_cnpj: debt.cpfCnpj || null,
        store_emp_id: debt.storeEmpId || null,
        store_emp_cpf_cnpj: debt.storeEmpCpfCnpj || null,
        total_amount: Number(debt.totalAmount.toFixed(2)),
        titles_count: debt.titlesCount,
        titles: debt.titles,
        next_due_date: debt.nextDueDate,
        last_sync_at: new Date().toISOString(),
        pix_key: debt.pixKey || null,
        updated_at: new Date().toISOString(),
      });

    if (metaError) {
      throw new Error(`Nao foi possivel salvar metadados RB no lead: ${metaError.message}`);
    }
  }

  private async syncLeadPaymentTypeTags(leadId: string, acesId: number, paymentTypeIds: string[]) {
    const desiredTagNames = Array.from(
      new Set(
        paymentTypeIds
          .map((paymentTypeId) => RB_PAYMENT_TYPE_LABELS[paymentTypeId])
          .filter((label): label is string => Boolean(label))
          .map((label) => `${RB_PAYMENT_TAG_PREFIX}${label}`)
      )
    );

    const managedTagNames = Object.values(RB_PAYMENT_TYPE_LABELS).map((label) => `${RB_PAYMENT_TAG_PREFIX}${label}`);
    const { data: existingTags, error: existingTagsError } = await this.serviceClient
      .from("tags")
      .select("id, name")
      .eq("aces_id", acesId)
      .in("name", managedTagNames);

    if (existingTagsError) {
      throw new Error(`Nao foi possivel consultar tags de pagamento RB: ${existingTagsError.message}`);
    }

    const existingTagByName = new Map(
      (existingTags ?? []).map((tag) => [String(tag.name), String(tag.id)])
    );

    for (const tagName of desiredTagNames) {
      if (existingTagByName.has(tagName)) {
        continue;
      }

      const { data: createdTag, error: createTagError } = await this.serviceClient
        .from("tags")
        .insert({
          aces_id: acesId,
          name: tagName,
          urgencia: null,
        })
        .select("id, name")
        .single();

      if (createTagError || !createdTag) {
        throw new Error(`Nao foi possivel criar tag de pagamento RB: ${createTagError?.message ?? tagName}`);
      }

      existingTagByName.set(String(createdTag.name), String(createdTag.id));
    }

    const managedTagIds = Array.from(existingTagByName.values());
    if (managedTagIds.length > 0) {
      const { error: deleteError } = await this.serviceClient
        .from("lead_tags")
        .delete()
        .eq("lead_id", leadId)
        .in("tag_id", managedTagIds);

      if (deleteError) {
        throw new Error(`Nao foi possivel limpar tags de pagamento RB: ${deleteError.message}`);
      }
    }

    const desiredTagIds = desiredTagNames
      .map((tagName) => existingTagByName.get(tagName) ?? null)
      .filter((tagId): tagId is string => Boolean(tagId));

    if (desiredTagIds.length === 0) {
      return;
    }

    const { error: upsertError } = await this.serviceClient
      .from("lead_tags")
      .upsert(
        desiredTagIds.map((tagId) => ({
          lead_id: leadId,
          tag_id: tagId,
        })),
        { onConflict: "lead_id,tag_id", ignoreDuplicates: true }
      );

    if (upsertError) {
      throw new Error(`Nao foi possivel salvar tags de pagamento RB: ${upsertError.message}`);
    }
  }

  private async moveLeadToStage(leadId: string, stageId: string, acesId: number) {
    const { error } = await this.serviceClient.rpc("service_move_lead_to_stage", {
      p_lead_id: leadId,
      p_stage_id: stageId,
      p_aces_id: acesId,
    });

    if (error) {
      throw new Error(`Nao foi possivel mover o lead RB para a etapa: ${error.message}`);
    }
  }

  private async listRbJourneys(acesId: number, instanceName: string) {
    const { data: funnels, error: funnelError } = await this.serviceClient
      .from("automation_funnels")
      .select("id, name, instance_name, trigger_stage_id, reply_target_stage_id, entry_source, is_active")
      .eq("aces_id", acesId)
      .eq("instance_name", instanceName)
      .eq("is_active", true)
      .eq("entry_source", "rb");

    if (funnelError) {
      throw new Error(`Nao foi possivel carregar jornadas RB: ${funnelError.message}`);
    }

    if (!funnels?.length) {
      return [];
    }

    const funnelIds = funnels.map((funnel) => String(funnel.id));
    const { data: steps, error: stepError } = await this.serviceClient
      .from("automation_steps")
      .select("funnel_id, position, is_active, rb_message_kind, rb_days_offset, rb_payment_type_ids")
      .in("funnel_id", funnelIds)
      .eq("is_active", true)
      .order("position", { ascending: true });

    if (stepError) {
      throw new Error(`Nao foi possivel carregar mensagens RB: ${stepError.message}`);
    }

    const firstStepByFunnel = new Map<string, Record<string, unknown>>();
    for (const step of (steps ?? []) as Array<Record<string, unknown>>) {
      const funnelId = asString(step.funnel_id);
      if (!funnelId || firstStepByFunnel.has(funnelId)) {
        continue;
      }

      const rbMessageKind =
        step.rb_message_kind === "reminder" || step.rb_message_kind === "charge"
          ? (step.rb_message_kind as RbBillingJourneyKind)
          : null;
      const rbDaysOffset = Number(step.rb_days_offset ?? -1);

      if (!rbMessageKind || !Number.isFinite(rbDaysOffset) || rbDaysOffset < 0) {
        continue;
      }

      firstStepByFunnel.set(funnelId, step);
    }

    return (funnels as Array<Record<string, unknown>>)
      .map((funnel) => {
        const funnelId = asString(funnel.id);
        const step = firstStepByFunnel.get(funnelId);
        if (!step) {
          return null;
        }

        return {
          funnelId,
          name: asString(funnel.name),
          instanceName: asString(funnel.instance_name),
          triggerStageId: asString(funnel.trigger_stage_id),
          replyTargetStageId: asString(funnel.reply_target_stage_id) || null,
          rbMessageKind: step.rb_message_kind as RbBillingJourneyKind,
          rbDaysOffset: Math.max(0, Number(step.rb_days_offset ?? 0)),
          rbPaymentTypeIds: asStringArray(step.rb_payment_type_ids),
        } satisfies RbJourneyConfig;
      })
      .filter((journey): journey is RbJourneyConfig => Boolean(journey));
  }

  private async listStagesByIds(stageIds: string[]) {
    if (!stageIds.length) {
      return [];
    }

    const { data, error } = await this.serviceClient
      .from("pipeline_stages")
      .select("id, name, pipeline_id, category")
      .in("id", stageIds);

    if (error) {
      throw new Error(`Nao foi possivel carregar etapas RB: ${error.message}`);
    }

    return (data ?? []) as StageRow[];
  }

  private findCompletedStageId(stageRows: StageRow[], triggerStageId: string) {
    const triggerStage = stageRows.find((stage) => stage.id === triggerStageId);
    if (!triggerStage) {
      return null;
    }

    const samePipelineStages = stageRows.filter((stage) => stage.pipeline_id === triggerStage.pipeline_id);
    const byName =
      samePipelineStages.find((stage) => stage.name.trim().toLowerCase() === "finalizado") ??
      samePipelineStages.find((stage) => stage.category?.toLowerCase() === "ganho") ??
      null;

    return byName?.id ?? null;
  }

  private async completeMissingDebtors(
    acesId: number,
    agent: AgentRow,
    debtStageIds: string[],
    completedStageByDebtStageId: Record<string, string>,
    activeKeysByStageId: Record<string, Set<string>>
  ) {
    if (!debtStageIds.length) {
      return 0;
    }

    const { data: metaList, error: metaError } = await this.rbServiceClient
      .from("lead_metadata")
      .select("lead_id, store_emp_id")
      .eq("aces_id", acesId);

    if (metaError) {
      throw new Error(`Nao foi possivel localizar leads RB para finalizacao (meta): ${metaError.message}`);
    }

    if (!metaList || metaList.length === 0) {
      return 0;
    }

    const leadIds = metaList.map((m) => String(m.lead_id));
    const metaMap = new Map(metaList.map((m) => [String(m.lead_id), String(m.store_emp_id ?? "")]));

    const { data, error } = await this.serviceClient
      .from("leads")
      .select("id, contact_phone, stage_id")
      .eq("aces_id", acesId)
      .eq("instancia", agent.instance_name)
      .in("id", leadIds)
      .in("stage_id", debtStageIds);

    if (error) {
      throw new Error(`Nao foi possivel localizar leads RB para finalizacao (leads): ${error.message}`);
    }

    let completedCount = 0;
    for (const row of data ?? []) {
      const currentStageId = asString(row.stage_id);
      const completedStageId = completedStageByDebtStageId[currentStageId];
      if (!completedStageId) {
        continue;
      }

      const storeEmpId = metaMap.get(String(row.id)) ?? "";
      const key = `${normalizePhone(row.contact_phone)}|${storeEmpId}`;
      const activeKeys = activeKeysByStageId[currentStageId] ?? new Set<string>();
      if (!activeKeys.has(key)) {
        await this.moveLeadToStage(String(row.id), completedStageId, acesId);
        completedCount += 1;
      }
    }

    return completedCount;
  }

  private async runTool(binding: RbToolBinding, options: { forceSchedule: boolean }) {
    const config = parseRbConfig(binding.config);
    if (!binding.is_enabled || binding.readiness !== "ready" || !isConfigReady(config)) {
      return { skipped: true, reason: "tool_not_ready" };
    }

    const agent = await this.getAgent(binding.agent_id, binding.aces_id);
    if (!agent.is_active) {
      return { skipped: true, reason: "agent_inactive" };
    }

    const localDate = getLocalDate(config.timezone);
    if (!options.forceSchedule && config.last_run_on_local_date === localDate) {
      return { skipped: true, reason: "already_ran_today" };
    }

    const runId = await this.tryStartRun(binding, localDate);
    if (!runId) {
      return { skipped: true, reason: "audit_already_exists" };
    }

    const summary: RunSummary = {
      due_records_count: 0,
      overdue_records_count: 0,
      grouped_contacts_count: 0,
      created_leads_count: 0,
      updated_leads_count: 0,
      moved_leads_count: 0,
      skipped_without_phone_count: 0,
      completed_leads_count: 0,
    };

    const activeKeysByStageId: Record<string, Set<string>> = {};

    try {
      const defaultOwnerId = await this.getDefaultOwnerId(binding.aces_id, config);
      const enforcedOwnerId = config.default_owner_id ? defaultOwnerId : null;
      const client = new RbClient({
        mode: config.rb_mode,
        baseUrl: config.rb_base_url,
        tokenApi: config.rb_token_api,
        empresaIds: config.rb_empresa_ids,
        mockFixturePath: this.config.mockFixturePath ?? null,
      });

      const journeys = await this.listRbJourneys(binding.aces_id, agent.instance_name);
      if (journeys.length === 0) {
        await this.updateBindingLastRun(binding.id, localDate);
        await this.finishRun(runId, "succeeded", summary, []);
        return { skipped: false, summary, journeys: 0 };
      }

      const stageRows = await this.listStagesByIds(
        Array.from(new Set(journeys.map((journeyItem) => journeyItem.triggerStageId))),
      );
      const completedStageByDebtStageId = Object.fromEntries(
        journeys
          .map((journeyItem) => [
            journeyItem.triggerStageId,
            this.findCompletedStageId(stageRows, journeyItem.triggerStageId),
          ] as const)
          .filter((item): item is [string, string] => Boolean(item[1])),
      );

      for (const journeyItem of journeys) {
        if (!isUuid(journeyItem.triggerStageId)) {
          continue;
        }

        const rawRows = await client.fetchTitlesForRule(journeyItem.rbMessageKind, journeyItem.rbDaysOffset);
        const allowedPaymentTypeIds = new Set(journeyItem.rbPaymentTypeIds.map((item) => normalizePaymentTypeId(item)));
        const rows = rawRows.filter((row) => {
          if (!allowedPaymentTypeIds.size) {
            return true;
          }

          const paymentTypeId = resolvePaymentTypeId(row);
          return paymentTypeId ? allowedPaymentTypeIds.has(paymentTypeId) : false;
        });

        summary.due_records_count += journeyItem.rbMessageKind === "reminder" ? rows.length : 0;
        summary.overdue_records_count += journeyItem.rbMessageKind === "charge" ? rows.length : 0;
        summary.skipped_without_phone_count += rows.filter((item) => !normalizePhone(item.CLIE_FONE)).length;

        const grouped = groupRbRecords(rows, config);
        summary.grouped_contacts_count += grouped.length;

        const activeKeysForStage =
          activeKeysByStageId[journeyItem.triggerStageId] ?? new Set<string>();
        activeKeysByStageId[journeyItem.triggerStageId] = activeKeysForStage;

        for (const debt of grouped) {
          activeKeysForStage.add(debt.key);

          let lead = await this.findLeadByPhone(binding.aces_id, debt.phone);
          if (!lead) {
            lead = await this.findLeadByFallback(binding.aces_id, debt);
          }

          const existed = Boolean(lead);
          if (!lead) {
            lead = await this.createLead(binding.aces_id, agent, debt, defaultOwnerId);
            summary.created_leads_count += 1;
          } else {
            summary.updated_leads_count += 1;
          }

          await this.saveLeadRbState(
            lead.id,
            binding.aces_id,
            agent,
            debt,
            enforcedOwnerId
          );
          await this.syncLeadPaymentTypeTags(lead.id, binding.aces_id, debt.paymentTypeIds);

          if (!existed || lead.stage_id !== journeyItem.triggerStageId) {
            await this.moveLeadToStage(lead.id, journeyItem.triggerStageId, binding.aces_id);
            summary.moved_leads_count += 1;
          }
        }
      }

      summary.completed_leads_count = await this.completeMissingDebtors(
        binding.aces_id,
        agent,
        Object.keys(activeKeysByStageId),
        completedStageByDebtStageId,
        activeKeysByStageId,
      );

      await this.updateBindingLastRun(binding.id, localDate);
      await this.finishRun(
        runId,
        "succeeded",
        summary,
        Object.values(activeKeysByStageId).flatMap((keys) => Array.from(keys)),
      );
      return { skipped: false, summary };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha desconhecida na sincronizacao RB";
      await this.finishRun(
        runId,
        "failed",
        summary,
        Object.values(activeKeysByStageId).flatMap((keys) => Array.from(keys)),
        message,
      );
      throw error;
    }
  }
}

export function startRbBillingWorker(config: WorkerConfig) {
  const worker = new RbBillingWorker(config);
  return worker.start();
}
