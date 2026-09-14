import type { SupabaseClient } from "@supabase/supabase-js";

import { CollectionService } from "./collection-service.js";

const COLLECTION_TOOL_KEY = "collection_orchestration";
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_PROMPT =
  "Voce e o agente de cobranca. Seja claro, respeitoso e objetivo. Ajude o cliente a entender a pendencia e os proximos passos, sem pressionar ou inventar informacoes.";
const DEFAULT_MESSAGE =
  "Ola {nome}, identificamos uma pendencia de {valor}. Posso ajudar voce a regularizar?";

export class CollectionOnboardingError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = "CollectionOnboardingError";
  }
}

type OnboardingInput = {
  acesId: number;
  crmUserId: string | null;
  sourceConnectionId: string;
  instanceName?: string | null;
  pipelineId?: string | null;
  createNewPipeline?: boolean;
};

export type CollectionTemplateSelection = {
  provider: "meta" | "gupshup";
  id?: string | null;
  name: string;
  language?: string | null;
  status?: string | null;
  params?: string[] | null;
  rejectionReason?: string | null;
};

export type CollectionTimingRelation = "before_due" | "on_due" | "after_due";

export type CollectionMessageInput = {
  label?: string | null;
  messageTemplate: string;
  timingRelation?: CollectionTimingRelation | null;
  daysOffset?: number | null;
  template?: CollectionTemplateSelection | null;
};

type OnboardingRow = Record<string, any> & {
  source_connection_id: string;
  instance_name: string;
  agent_id: string;
  agent_tool_id: string;
  pipeline_id: string;
  funnel_id: string;
  journey_rule_id: string;
  first_step_id: string;
  status: string;
  sending_enabled: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class CollectionOnboardingService {
  private readonly collections: SupabaseClient<any, "collections", any>;
  private readonly crm: SupabaseClient<any, "crm", any>;
  private readonly agents: SupabaseClient<any, "agents", any>;
  private readonly prepareLocks = new Map<string, Promise<void>>();

  constructor(private readonly collectionService: CollectionService) {
    this.collections = collectionService.collections;
    this.crm = collectionService.crm;
    this.agents = collectionService.agents;
  }

  async listSetups(acesId: number) {
    const { data, error } = await this.collections
      .from("onboarding_bindings")
      .select("*")
      .eq("aces_id", acesId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return Promise.all((data ?? []).map((row) => this.getSetup(acesId, row.source_connection_id)));
  }

  async getSetup(acesId: number, sourceConnectionId: string) {
    const source = await this.collectionService.getSource(acesId, sourceConnectionId);
    if (!source) return null;

    const { data: onboarding, error: onboardingError } = await this.collections
      .from("onboarding_bindings")
      .select("*")
      .eq("aces_id", acesId)
      .eq("source_connection_id", sourceConnectionId)
      .maybeSingle();
    if (onboardingError) throw onboardingError;
    if (!onboarding) {
      return {
        source,
        prepared: false,
        status: "draft",
        sendingEnabled: false,
        pending: ["instance", "agent", "pipeline", "message"],
        nextAction: "select_instance",
      };
    }

    const row = onboarding as OnboardingRow;
    const [instance, agent, tool, pipeline, funnel, rule, steps] = await Promise.all([
      this.getInstance(acesId, row.instance_name),
      this.agents.from("ai_agents").select("id, name, instance_name, is_active, provider, model")
        .eq("id", row.agent_id).eq("aces_id", acesId).maybeSingle(),
      this.agents.from("agent_tools").select("id, agent_id, tool_key, is_enabled, readiness, config")
        .eq("id", row.agent_tool_id).eq("aces_id", acesId).maybeSingle(),
      this.crm.from("pipelines").select("id, name, description, is_active")
        .eq("id", row.pipeline_id).eq("aces_id", acesId).maybeSingle(),
      this.crm.from("automation_funnels").select("id, name, instance_name, is_active, entry_source")
        .eq("id", row.funnel_id).eq("aces_id", acesId).maybeSingle(),
      this.collections.from("journey_rules").select("*")
        .eq("id", row.journey_rule_id).eq("aces_id", acesId).maybeSingle(),
      this.crm.from("automation_steps").select("*")
        .eq("funnel_id", row.funnel_id).order("position", { ascending: true }).order("created_at", { ascending: true }),
    ]);
    for (const result of [agent, tool, pipeline, funnel, rule, steps]) {
      if (result.error) throw result.error;
    }

    const messages = (steps.data ?? []) as Array<Record<string, any>>;
    const firstMessage = messages.find((item) => item.id === row.first_step_id) ?? messages[0] ?? null;

    const pending: string[] = [];
    if (!instance) pending.push("instance");
    if (!agent.data) pending.push("agent");
    if (!tool.data || tool.data.tool_key !== COLLECTION_TOOL_KEY || tool.data.readiness !== "ready") pending.push("tool");
    if (!pipeline.data) pending.push("pipeline");
    if (!funnel.data || funnel.data.entry_source !== "collection") pending.push("funnel");
    if (!rule.data) pending.push("rule");
    if (!messages.some((item) => String(item.message_template ?? "").trim())) pending.push("message");
    const provider = instance?.provider === "meta" || instance?.provider === "gupshup"
      ? instance.provider
      : null;
    const templatePending = provider && messages.some((item) => {
      const templateName = String(item.gupshup_template_name ?? "").trim();
      const templateStatus = String(item.template_status ?? "").trim().toLowerCase();
      return !templateName || (templateStatus && !["approved", "active", "enabled"].includes(templateStatus));
    });
    if (templatePending) {
      pending.push("template");
    }
    if (!agent.data?.is_active) pending.push("agent_activation");
    const channelStatus = instance?.channelStatus ?? instance?.status;
    if (instance && channelStatus && !["connected", "active", "open"].includes(String(channelStatus).toLowerCase())) {
      pending.push("channel");
    }

    return {
      source,
      prepared: true,
      status: row.status,
      sendingEnabled: Boolean(row.sending_enabled),
      pending,
      nextAction: row.sending_enabled ? "manage" : pending.length > 0 ? pending[0] : "activate",
      instance: instance
        ? { name: row.instance_name, provider: instance.provider ?? null, status: channelStatus ?? null, phoneNumber: instance.phoneNumber ?? instance.phone_number ?? null }
        : { name: row.instance_name, provider: null, status: null, phoneNumber: null },
      agent: agent.data,
      tool: tool.data,
      pipeline: pipeline.data,
      funnel: funnel.data,
      journeyRule: rule.data,
      messages,
      message: firstMessage,
      onboarding: row,
    };
  }

  async prepare(input: OnboardingInput) {
    const lockKey = `${input.acesId}:${input.sourceConnectionId}`;
    const previous = this.prepareLocks.get(lockKey) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.prepareLocks.set(lockKey, queued);
    try {
      await previous;
      return await this.prepareUnlocked(input);
    } finally {
      release();
      if (this.prepareLocks.get(lockKey) === queued) this.prepareLocks.delete(lockKey);
    }
  }

  private async prepareUnlocked(input: OnboardingInput) {
    const source = await this.collectionService.getSource(input.acesId, input.sourceConnectionId);
    if (!source) {
      throw new CollectionOnboardingError("Fonte de cobranca nao encontrada", "SOURCE_NOT_FOUND", 404);
    }
    if (["disabled", "error"].includes(source.status)) {
      throw new CollectionOnboardingError("Resolva a situacao da fonte antes de preparar a cobranca", "SOURCE_NOT_READY");
    }

    const existing = await this.getOnboardingRow(input.acesId, input.sourceConnectionId);
    const instanceName = await this.resolveInstance(input, existing);
    const agent = await this.ensureAgent(input.acesId, instanceName, input.crmUserId);
    const tool = await this.ensureTool(input.acesId, agent.id, source);
    await this.ensureSourceBinding(input.acesId, tool.id, source.id);
    const pipeline = await this.ensurePipeline(input, existing);
    const funnel = await this.ensureFunnel(input, existing, instanceName);
    const step = await this.ensureFirstMessage(funnel.id, input.crmUserId);
    const rule = await this.ensureJourneyRule(input, funnel.id, source.id);

    const row = {
      aces_id: input.acesId,
      source_connection_id: source.id,
      instance_name: instanceName,
      agent_id: agent.id,
      agent_tool_id: tool.id,
      pipeline_id: pipeline.id,
      funnel_id: funnel.id,
      journey_rule_id: rule.id,
      first_step_id: step.id,
      status: existing?.sending_enabled ? "active" : "ready",
      sending_enabled: Boolean(existing?.sending_enabled),
    };
    const { error } = await this.collections.from("onboarding_bindings")
      .upsert(row, { onConflict: "aces_id,source_connection_id" });
    if (error) throw error;

    await this.collections.from("cases").update({
      communication_status: "eligible",
      pause_reason: null,
      updated_at: new Date().toISOString(),
    }).eq("aces_id", input.acesId).eq("source_connection_id", source.id)
      .eq("communication_status", "error").eq("pause_reason", "Fonte sem agente vinculado");
    const { error: rebuildError } = await this.collections.rpc("rebuild_case_projections", {
      p_aces_id: input.acesId,
      p_source_connection_id: source.id,
      p_reason: "Onboarding de cobranca preparado",
      p_actor_id: input.crmUserId,
    });
    if (rebuildError) throw rebuildError;

    return this.getSetup(input.acesId, source.id);
  }

  async updateMessage(
    acesId: number,
    sourceConnectionId: string,
    messageTemplate: string,
    template?: CollectionTemplateSelection | null,
  ) {
    const setup = await this.getSetup(acesId, sourceConnectionId);
    if (!setup?.prepared || !setup.message?.id) {
      throw new CollectionOnboardingError("Prepare a fonte antes de configurar a mensagem", "ONBOARDING_NOT_PREPARED");
    }
    return this.updateMessageById(acesId, sourceConnectionId, setup.message.id, {
      label: setup.message.label,
      messageTemplate,
      timingRelation: (setup.message.collection_timing_relation ?? setup.journeyRule?.timing_relation ?? "on_due") as CollectionTimingRelation,
      daysOffset: Number(setup.message.collection_days_offset ?? setup.journeyRule?.days_offset ?? 0),
      template,
    });
  }

  async createMessage(acesId: number, sourceConnectionId: string, input: CollectionMessageInput) {
    const setup = await this.getSetup(acesId, sourceConnectionId);
    if (!setup?.prepared || !setup.funnel?.id || !setup.journeyRule?.id) {
      throw new CollectionOnboardingError("Prepare a fonte antes de criar mensagens", "ONBOARDING_NOT_PREPARED");
    }
    this.validateTemplateProvider(setup.instance?.provider, input.template);
    const message = this.normalizeMessageInput(input);
    const { data: lastStep, error: lastStepError } = await this.crm.from("automation_steps")
      .select("position").eq("funnel_id", setup.funnel.id).order("position", { ascending: false }).limit(1).maybeSingle();
    if (lastStepError) throw lastStepError;
    const { data, error } = await this.crm.from("automation_steps").insert({
      funnel_id: setup.funnel.id,
      position: Number(lastStep?.position ?? -1) + 1,
      label: message.label || `Mensagem ${Number(lastStep?.position ?? -1) + 2}`,
      delay_minutes: 0,
      message_template: message.message,
      channel: "whatsapp",
      is_active: false,
      created_by: null,
      content_mode: "text",
      media_asset_id: null, media_kind: null, media_caption: null,
      gupshup_template_id: message.templateFields.gupshup_template_id,
      gupshup_template_name: message.templateFields.gupshup_template_name,
      gupshup_template_language: message.templateFields.gupshup_template_language,
      gupshup_template_params: message.templateFields.gupshup_template_params,
      rb_message_kind: null, rb_days_offset: null, rb_payment_type_ids: [], step_rule: null,
      template_provider: message.templateFields.template_provider,
      template_status: message.templateFields.template_status,
      template_rejection_reason: message.templateFields.template_rejection_reason,
      collection_timing_relation: message.timingRelation,
      collection_days_offset: message.daysOffset,
    }).select("*").single();
    if (error) throw error;
    await this.markNeedsReview(acesId, sourceConnectionId, setup.funnel.id, setup.journeyRule.id);
    return { message: data, setup: await this.getSetup(acesId, sourceConnectionId) };
  }

  async updateMessageById(acesId: number, sourceConnectionId: string, messageId: string, input: CollectionMessageInput) {
    const setup = await this.getSetup(acesId, sourceConnectionId);
    if (!setup?.prepared || !setup.funnel?.id || !setup.journeyRule?.id) {
      throw new CollectionOnboardingError("Prepare a fonte antes de configurar a mensagem", "ONBOARDING_NOT_PREPARED");
    }
    this.validateTemplateProvider(setup.instance?.provider, input.template);
    const message = this.normalizeMessageInput(input);
    const { data, error } = await this.crm.from("automation_steps")
      .update({
        label: message.label || "Mensagem de cobrança",
        message_template: message.message,
        is_active: false,
        updated_at: new Date().toISOString(),
        ...message.templateFields,
        collection_timing_relation: message.timingRelation,
        collection_days_offset: message.daysOffset,
      })
      .eq("id", messageId).eq("funnel_id", setup.funnel.id).select("*").single();
    if (error) throw error;
    await this.markNeedsReview(acesId, sourceConnectionId, setup.funnel.id, setup.journeyRule.id);
    return { message: data, setup: await this.getSetup(acesId, sourceConnectionId) };
  }

  async activate(acesId: number, sourceConnectionId: string) {
    const setup = await this.getSetup(acesId, sourceConnectionId);
    if (!setup?.prepared) throw new CollectionOnboardingError("Prepare a fonte antes de ativar os envios", "ONBOARDING_NOT_PREPARED");
    if (setup.source.status !== "active") throw new CollectionOnboardingError("A fonte precisa estar ativa para iniciar os envios", "SOURCE_NOT_ACTIVE");
    if (!setup.agent?.id || !setup.tool?.id || !setup.pipeline?.id || !setup.funnel?.id || !setup.journeyRule?.id || !setup.messages?.length) {
      throw new CollectionOnboardingError("A configuracao da cobranca ainda esta incompleta", "ONBOARDING_INCOMPLETE");
    }
    const blockingPending = setup.pending.filter((item) => item !== "agent_activation");
    if (blockingPending.length > 0) {
      throw new CollectionOnboardingError(
        "Conclua a configuracao do WhatsApp e da mensagem antes de ativar os envios",
        "ONBOARDING_NOT_READY",
      );
    }
    const { data: dispatcher, error: dispatcherError } = await this.collections.rpc("resolve_source_dispatcher", {
      p_source_connection_id: setup.source.id,
    });
    if (dispatcherError) throw dispatcherError;
    if (dispatcher !== "canonical") {
      throw new CollectionOnboardingError("A fonte ainda nao esta pronta para a operacao canonica", "DISPATCHER_NOT_READY", 409);
    }
    const { error: activationError } = await this.collections.rpc("activate_collection_onboarding", {
      p_aces_id: acesId,
      p_source_connection_id: sourceConnectionId,
    });
    if (activationError) throw activationError;
    return this.getSetup(acesId, sourceConnectionId);
  }

  async pause(acesId: number, sourceConnectionId: string) {
    const { data, error } = await this.collections.from("onboarding_bindings").update({
      status: "paused", sending_enabled: false, updated_at: new Date().toISOString(),
    }).eq("aces_id", acesId).eq("source_connection_id", sourceConnectionId).select("*").maybeSingle();
    if (error) throw error;
    if (!data) throw new CollectionOnboardingError("Fonte ainda nao foi preparada", "ONBOARDING_NOT_PREPARED");
    return this.getSetup(acesId, sourceConnectionId);
  }

  private async getOnboardingRow(acesId: number, sourceConnectionId: string): Promise<OnboardingRow | null> {
    const { data, error } = await this.collections.from("onboarding_bindings").select("*")
      .eq("aces_id", acesId).eq("source_connection_id", sourceConnectionId).maybeSingle();
    if (error) throw error;
    return data as OnboardingRow | null;
  }

  private normalizeMessageInput(input: CollectionMessageInput) {
    const message = input.messageTemplate.trim();
    if (!message) throw new CollectionOnboardingError("A mensagem nao pode ficar vazia", "MESSAGE_REQUIRED");
    const timingRelation = input.timingRelation ?? "on_due";
    if (!["before_due", "on_due", "after_due"].includes(timingRelation)) {
      throw new CollectionOnboardingError("Escolha um momento de envio valido", "TIMING_INVALID");
    }
    const daysOffset = timingRelation === "on_due"
      ? 0
      : Math.max(0, Math.floor(Number(input.daysOffset ?? 0)));
    if (!Number.isFinite(daysOffset)) {
      throw new CollectionOnboardingError("Informe uma quantidade de dias valida", "TIMING_INVALID");
    }
    const template = input.template;
    if (template && !template.name.trim()) {
      throw new CollectionOnboardingError("Selecione um template antes de salvar", "TEMPLATE_REQUIRED");
    }
    return {
      message,
      label: input.label?.trim() || null,
      timingRelation,
      daysOffset,
      templateFields: template
        ? {
            gupshup_template_id: template.id?.trim() || null,
            gupshup_template_name: template.name.trim(),
            gupshup_template_language: template.language?.trim() || "pt_BR",
            gupshup_template_params: Array.isArray(template.params) ? template.params : [],
            template_provider: template.provider,
            template_status: template.status?.trim() || null,
            template_rejection_reason: template.rejectionReason?.trim() || null,
          }
        : {
            gupshup_template_id: null,
            gupshup_template_name: null,
            gupshup_template_language: "pt_BR",
            gupshup_template_params: [],
            template_provider: null,
            template_status: null,
            template_rejection_reason: null,
          },
    };
  }

  private validateTemplateProvider(provider: string | null | undefined, template?: CollectionTemplateSelection | null) {
    if (!template) return;
    if ((provider !== "meta" && provider !== "gupshup") || template.provider !== provider) {
      throw new CollectionOnboardingError("O template nao pertence ao WhatsApp selecionado", "TEMPLATE_PROVIDER_MISMATCH");
    }
  }

  private async markNeedsReview(acesId: number, sourceConnectionId: string, funnelId: string, ruleId: string) {
    const [binding, rule, funnel] = await Promise.all([
      this.collections.from("onboarding_bindings").update({
        status: "ready", sending_enabled: false, updated_at: new Date().toISOString(),
      }).eq("aces_id", acesId).eq("source_connection_id", sourceConnectionId),
      this.collections.from("journey_rules").update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", ruleId).eq("aces_id", acesId),
      this.crm.from("automation_funnels").update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", funnelId).eq("aces_id", acesId),
    ]);
    for (const result of [binding, rule, funnel]) if (result.error) throw result.error;
  }

  private async getInstance(acesId: number, instanceName: string) {
    const [{ data, error }, { data: channel, error: channelError }] = await Promise.all([
      this.crm.from("instance").select("*")
        .eq("aces_id", acesId).eq("instancia", instanceName).maybeSingle(),
      this.crm.from("instance_channels").select("provider, status")
        .eq("aces_id", acesId).eq("instance_name", instanceName).maybeSingle(),
    ]);
    if (error) throw error;
    if (channelError) throw channelError;
    return data ? { ...data, provider: channel?.provider ?? null, channelStatus: channel?.status ?? null } : null;
  }

  private async resolveInstance(input: OnboardingInput, existing: OnboardingRow | null) {
    const requested = input.instanceName?.trim();
    const candidates = [requested, existing?.instance_name].filter(Boolean) as string[];
    if (candidates.length === 0) {
      const { data: route, error: routeError } = await this.collections.from("agent_source_bindings")
        .select("agent_tool_id").eq("aces_id", input.acesId).eq("source_connection_id", input.sourceConnectionId)
        .eq("is_enabled", true).limit(2);
      if (routeError) throw routeError;
      for (const binding of route ?? []) {
        const { data: tool, error: toolError } = await this.agents.from("agent_tools").select("agent_id")
          .eq("id", binding.agent_tool_id).eq("aces_id", input.acesId).maybeSingle();
        if (toolError) throw toolError;
        if (!tool?.agent_id) continue;
        const { data: agent, error: agentError } = await this.agents.from("ai_agents").select("instance_name")
          .eq("id", tool.agent_id).eq("aces_id", input.acesId).maybeSingle();
        if (agentError) throw agentError;
        if (agent?.instance_name) candidates.push(agent.instance_name);
      }
    }
    if (candidates.length === 0) {
      const source = await this.collectionService.getSource(input.acesId, input.sourceConnectionId);
      const configured = asRecord(source?.config).whatsappInstanceName;
      if (typeof configured === "string" && configured.trim()) candidates.push(configured.trim());
    }
    if (candidates.length === 0) {
      const { data: instances, error } = await this.crm.from("instance").select("instancia")
        .eq("aces_id", input.acesId).limit(2);
      if (error) throw error;
      if ((instances ?? []).length === 1) candidates.push(String(instances![0].instancia));
    }
    const instanceName = candidates[0]?.trim();
    if (!instanceName) {
      throw new CollectionOnboardingError("Escolha o WhatsApp que fara os envios da cobranca", "INSTANCE_REQUIRED");
    }
    const instance = await this.getInstance(input.acesId, instanceName);
    if (!instance) throw new CollectionOnboardingError("O WhatsApp selecionado nao pertence a esta conta", "INSTANCE_NOT_FOUND");
    return instanceName;
  }

  private async ensureAgent(acesId: number, instanceName: string, createdBy: string | null) {
    const { data: current, error } = await this.agents.from("ai_agents").select("*")
      .eq("aces_id", acesId).eq("instance_name", instanceName).maybeSingle();
    if (error) throw error;
    if (current) return current;

    const { data: created, error: createError } = await this.agents.from("ai_agents").insert({
      aces_id: acesId,
      instance_name: instanceName,
      name: "Agente de cobranca",
      system_prompt: DEFAULT_PROMPT,
      provider: "gemini",
      model: DEFAULT_MODEL,
      is_active: false,
      buffer_wait_ms: 15000,
      human_pause_minutes: 60,
      auto_apply_threshold: 0.85,
      personality_profile: "balanced",
      handoff_enabled: false,
      handoff_prompt: null,
      handoff_target_phone: null,
      unanswered_followup_enabled: true,
      created_by: createdBy,
      agent_type: "primary",
      parent_agent_id: null,
      agent_key: null,
      routing_instruction: null,
    }).select("*").single();
    if (!createError && created) return created;
    if (createError?.code === "23505") {
      const { data: raced, error: raceError } = await this.agents.from("ai_agents").select("*")
        .eq("aces_id", acesId).eq("instance_name", instanceName).single();
      if (!raceError && raced) return raced;
    }
    throw new CollectionOnboardingError(`Nao foi possivel preparar o agente: ${errorMessage(createError)}`, "AGENT_PREPARE_FAILED", 500);
  }

  private async ensureTool(acesId: number, agentId: string, source: any) {
    const { data: current, error } = await this.agents.from("agent_tools").select("*")
      .eq("aces_id", acesId).eq("agent_id", agentId).eq("tool_key", COLLECTION_TOOL_KEY).maybeSingle();
    if (error) throw error;
    if (current) return current;
    const { data, error: createError } = await this.agents.from("agent_tools").insert({
      aces_id: acesId,
      agent_id: agentId,
      tool_key: COLLECTION_TOOL_KEY,
      tool_version: 1,
      is_enabled: false,
      readiness: "ready",
      config: { sourceConnectionId: source.id, sourceType: source.source_type },
      last_validated_at: new Date().toISOString(),
    }).select("*").single();
    if (createError || !data) throw new CollectionOnboardingError(`Nao foi possivel preparar a ferramenta de cobranca: ${errorMessage(createError)}`, "TOOL_PREPARE_FAILED", 500);
    return data;
  }

  private async ensureSourceBinding(acesId: number, agentToolId: string, sourceConnectionId: string) {
    const { data: current, error } = await this.collections.from("agent_source_bindings").select("*")
      .eq("aces_id", acesId).eq("agent_tool_id", agentToolId).eq("source_connection_id", sourceConnectionId)
      .is("creditor_external_id", null).maybeSingle();
    if (error) throw error;
    if (current) return current;
    const { data, error: createError } = await this.collections.from("agent_source_bindings").insert({
      aces_id: acesId, agent_tool_id: agentToolId, source_connection_id: sourceConnectionId,
      priority: 100, is_enabled: true,
    }).select("*").single();
    if (!createError && data) return data;
    if (createError?.code === "23505") {
      const { data: raced, error: raceError } = await this.collections.from("agent_source_bindings").select("*")
        .eq("aces_id", acesId).eq("agent_tool_id", agentToolId).eq("source_connection_id", sourceConnectionId)
        .is("creditor_external_id", null).single();
      if (!raceError && raced) return raced;
    }
    throw createError;
  }

  private async ensurePipeline(input: OnboardingInput, existing: OnboardingRow | null) {
    if (input.pipelineId?.trim()) {
      const { data, error } = await this.crm.from("pipelines").select("*")
        .eq("id", input.pipelineId.trim()).eq("aces_id", input.acesId).maybeSingle();
      if (error) throw error;
      if (!data) throw new CollectionOnboardingError("Pipeline nao encontrado nesta conta", "PIPELINE_NOT_FOUND");
      if (data.classifier_key !== "crm_collection" && !String(data.name ?? "").toLowerCase().includes("cobrança") && !String(data.name ?? "").toLowerCase().includes("cobranca")) {
        throw new CollectionOnboardingError("Selecione um pipeline de cobrança", "COLLECTION_PIPELINE_REQUIRED");
      }
      return data;
    }
    if (existing?.pipeline_id) {
      const { data, error } = await this.crm.from("pipelines").select("*")
        .eq("id", existing.pipeline_id).eq("aces_id", input.acesId).maybeSingle();
      if (error) throw error;
      if (data) return data;
    }
    const { data: account } = await this.crm.from("accounts").select("name").eq("id", input.acesId).maybeSingle();
    const basePipelineName = account?.name ? `Cobrança · ${account.name}` : "Cobrança";
    if (!input.createNewPipeline) {
      const { data: shared, error: sharedError } = await this.collections.from("onboarding_bindings")
        .select("pipeline_id").eq("aces_id", input.acesId).limit(1).maybeSingle();
      if (sharedError) throw sharedError;
      if (shared?.pipeline_id) {
        const { data, error } = await this.crm.from("pipelines").select("*").eq("id", shared.pipeline_id).eq("aces_id", input.acesId).maybeSingle();
        if (error) throw error;
        if (data) return data;
      }
      const { data: named, error: namedError } = await this.crm.from("pipelines").select("*")
        .eq("aces_id", input.acesId).ilike("name", "Cobrança%").limit(1).maybeSingle();
      if (namedError) throw namedError;
      if (named) return this.ensureCollectionPipelineStages(input.acesId, named);
    }
    let pipelineName = basePipelineName;
    if (input.createNewPipeline) {
      const { data: existingNames, error: namesError } = await this.crm.from("pipelines").select("name")
        .eq("aces_id", input.acesId).ilike("name", `${basePipelineName}%`).limit(100);
      if (namesError) throw namesError;
      const names = new Set((existingNames ?? []).map((item) => String(item.name ?? "")));
      let suffix = 2;
      while (names.has(pipelineName)) pipelineName = `${basePipelineName} · ${suffix++}`;
    }
    const { data: created, error: createError } = await this.crm.from("pipelines").insert({
      aces_id: input.acesId,
      name: pipelineName,
      description: "Pipeline operacional preparado para casos de cobrança.",
      classifier_key: "crm_collection",
      is_default: false,
      // Activate only after the required active_service stage is inserted.
      is_active: false,
      ai_classification_enabled: false,
      created_by: input.crmUserId,
    }).select("*").single();
    if (createError?.code === "23505") {
      const { data: raced, error: raceError } = await this.crm.from("pipelines").select("*")
        .eq("aces_id", input.acesId).eq("name", pipelineName).single();
      if (!raceError && raced) return raced;
    }
    if (createError || !created) throw createError;
    const stages = [
      ["Entrada", "#64748b", "new"], ["Atendimento", "#0ea5e9", "active_service"],
      ["Negociação", "#8b5cf6", "quote"], ["Ganho", "#10b981", "won"], ["Perdido", "#ef4444", "lost"],
    ].map(([name, color, semantic], position) => ({
      aces_id: input.acesId, pipeline_id: created.id, name, color, position,
      category: semantic === "won" ? "Ganho" : semantic === "lost" ? "Perdido" : "Aberto",
      is_funnel_stage: false, classifier_semantic_key: semantic, classifier_is_destination: !["new", "active_service"].includes(semantic),
    }));
    const { error: stageError } = await this.crm.from("pipeline_stages").insert(stages);
    if (stageError) throw stageError;
    const { data: activated, error: activateError } = await this.crm.from("pipelines")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq("id", created.id)
      .eq("aces_id", input.acesId)
      .select("*")
      .single();
    if (activateError || !activated) {
      if (activateError?.code === "P0001") {
        throw new CollectionOnboardingError(
          "Nao foi possivel ativar o pipeline: ele precisa ter exatamente uma etapa de Atendimento",
          "PIPELINE_ATTENDANCE_STAGE_REQUIRED",
          422,
        );
      }
      throw activateError;
    }
    return activated;
  }

  private async ensureCollectionPipelineStages(acesId: number, pipeline: any) {
    const { data: currentStages, error: stagesError } = await this.crm.from("pipeline_stages")
      .select("id, name, classifier_semantic_key")
      .eq("aces_id", acesId)
      .eq("pipeline_id", pipeline.id);
    if (stagesError) throw stagesError;
    if ((currentStages ?? []).some((stage) => stage.classifier_semantic_key === "active_service")) {
      return pipeline;
    }

    const definitions = [
      ["Entrada", "#64748b", "new"], ["Atendimento", "#0ea5e9", "active_service"],
      ["Negociacao", "#8b5cf6", "quote"], ["Ganho", "#10b981", "won"], ["Perdido", "#ef4444", "lost"],
    ] as const;
    const existingNames = new Set((currentStages ?? []).map((stage: any) => String(stage.name ?? "").toLowerCase()));
    const stages = definitions
      .filter(([name]) => !existingNames.has(name.toLowerCase()))
      .map(([name, color, semantic], offset) => ({
        aces_id: acesId,
        pipeline_id: pipeline.id,
        name,
        color,
        position: (currentStages ?? []).length + offset,
        category: semantic === "won" ? "Ganho" : semantic === "lost" ? "Perdido" : "Aberto",
        is_funnel_stage: false,
        classifier_semantic_key: semantic,
        classifier_is_destination: !["new", "active_service"].includes(semantic),
      }));
    const { error: insertError } = await this.crm.from("pipeline_stages").insert(stages);
    if (insertError) throw insertError;
    const { data: activated, error: activateError } = await this.crm.from("pipelines")
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq("id", pipeline.id)
      .eq("aces_id", acesId)
      .select("*")
      .single();
    if (activateError || !activated) throw activateError;
    return activated;
  }

  private async ensureFunnel(input: OnboardingInput, existing: OnboardingRow | null, instanceName: string) {
    if (existing?.funnel_id) {
      const { data, error } = await this.crm.from("automation_funnels").select("*")
        .eq("id", existing.funnel_id).eq("aces_id", input.acesId).maybeSingle();
      if (error) throw error;
      if (data) return data;
    }
    const { data: shared, error: sharedError } = await this.collections.from("onboarding_bindings")
      .select("funnel_id, instance_name").eq("aces_id", input.acesId).eq("instance_name", instanceName).limit(1).maybeSingle();
    if (sharedError) throw sharedError;
    if (shared?.funnel_id) {
      const { data, error } = await this.crm.from("automation_funnels").select("*").eq("id", shared.funnel_id).maybeSingle();
      if (error) throw error;
      if (data) return data;
    }
    const { data: account } = await this.crm.from("accounts").select("name").eq("id", input.acesId).maybeSingle();
    const funnelName = account?.name ? `Régua de cobrança · ${account.name}` : "Régua de cobrança";
    const { data: current, error: currentError } = await this.crm.from("automation_funnels").select("*")
      .eq("aces_id", input.acesId).eq("instance_name", instanceName).eq("entry_source", "collection")
      .ilike("name", "Régua de cobrança%").limit(1).maybeSingle();
    if (currentError) throw currentError;
    if (current) return current;
    const { data, error } = await this.crm.from("automation_funnels").insert({
      aces_id: input.acesId, name: funnelName, trigger_stage_id: null, instance_name: instanceName,
      is_active: false, created_by: input.crmUserId, entry_rule: { source: "collection" },
      exit_rule: { onReply: true, onPaid: true }, anchor_event: "stage_entered_at",
      reentry_mode: "ignore_if_active", reply_target_stage_id: null, builder_version: 2,
      humanized_dispatch_enabled: false, dispatch_limit_per_hour: 40,
      humanized_dispatch_window_start: "08:00:00", humanized_dispatch_window_end: "19:00:00",
      entry_source: "collection", daily_dispatch_enabled: false, daily_dispatch_weekends_enabled: false,
      trigger_event_status: null,
    }).select("*").single();
    if (error?.code === "23505") {
      const { data: raced, error: raceError } = await this.crm.from("automation_funnels").select("*")
        .eq("aces_id", input.acesId).eq("name", funnelName).single();
      if (!raceError && raced) return raced;
    }
    if (error || !data) throw error;
    return data;
  }

  private async ensureFirstMessage(funnelId: string, createdBy: string | null) {
    const { data: current, error } = await this.crm.from("automation_steps").select("*")
      .eq("funnel_id", funnelId).eq("position", 0).maybeSingle();
    if (error) throw error;
    if (current) return current;
    const { data, error: createError } = await this.crm.from("automation_steps").insert({
      funnel_id: funnelId, position: 0, label: "Lembrete no vencimento", delay_minutes: 0,
      message_template: DEFAULT_MESSAGE, channel: "whatsapp", is_active: false, created_by: createdBy,
      content_mode: "text", media_asset_id: null, media_kind: null, media_caption: null,
      gupshup_template_id: null, gupshup_template_name: null, gupshup_template_language: "pt_BR",
      gupshup_template_params: [], rb_message_kind: null, rb_days_offset: null, rb_payment_type_ids: [], step_rule: null,
      template_provider: null, template_status: null, template_rejection_reason: null,
      collection_timing_relation: "on_due", collection_days_offset: 0,
    }).select("*").single();
    if (createError?.code === "23505") {
      const { data: raced, error: raceError } = await this.crm.from("automation_steps").select("*")
        .eq("funnel_id", funnelId).eq("position", 0).single();
      if (!raceError && raced) return raced;
    }
    if (createError || !data) throw createError;
    return data;
  }

  private async ensureJourneyRule(input: OnboardingInput, funnelId: string, sourceConnectionId: string) {
    const { data: current, error } = await this.collections.from("journey_rules").select("*")
      .eq("funnel_id", funnelId).eq("aces_id", input.acesId).maybeSingle();
    if (error) throw error;
    let rule = current;
    if (!rule) {
      const { data: created, error: createError } = await this.collections.from("journey_rules").insert({
        aces_id: input.acesId, funnel_id: funnelId, timing_relation: "on_due", days_offset: 0,
        priority: 100, financial_statuses: ["open"], payment_methods: [], currency: null,
        is_active: false,
      }).select("*").single();
      if (createError?.code === "23505") {
        const { data: raced, error: raceError } = await this.collections.from("journey_rules").select("*")
          .eq("funnel_id", funnelId).eq("aces_id", input.acesId).single();
        if (!raceError && raced) rule = raced;
      } else if (createError || !created) {
        throw createError;
      } else {
        rule = created;
      }
    }
    const { error: sourceBindingError } = await this.collections.from("journey_source_bindings").upsert({
      journey_rule_id: rule.id, source_connection_id: sourceConnectionId, aces_id: input.acesId,
    }, { onConflict: "journey_rule_id,source_connection_id" });
    if (sourceBindingError) throw sourceBindingError;
    return rule;
  }
}
