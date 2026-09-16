import { GoogleGenerativeAI } from "@google/generative-ai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import { generateCentralStructuredResponse } from "./central-ai-provider.js";
import { HttpError } from "./sdr-agent-gemini.js";
import { InternalChatService } from "./internal-chat-service.js";

type JsonRecord = Record<string, unknown>;
type CrmClient = SupabaseClient<any, any, any, any, any>;

export type AgentSimulatorAuthContext = {
  accessToken: string;
  authUserId: string;
  crmUserId: string;
  acesId: number;
  role: string;
  name: string | null;
};

type SimulatorAgent = {
  id: string;
  aces_id: number;
  name: string;
  instance_name: string | null;
  agent_type: "primary" | "subagent";
  system_prompt: string;
  model: string;
  personality_profile: string | null;
  is_active: boolean;
};

type SimulatorTool = {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  readiness: string;
};

type SimulatorMessage = {
  role: "lead" | "agent";
  content: string;
  createdAt?: string;
};

type SimulatorAttachment = {
  kind: "image" | "audio";
  fileName: string;
  mimeType: string;
  size: number;
};

type ModelResponse = {
  reply_blocks: string[];
  tool_calls: Array<{ key: string; reason: string }>;
  confidence: number;
};

const SIMULATOR_RESPONSE_SCHEMA: JsonRecord = {
  type: "object",
  properties: {
    reply_blocks: {
      type: "array",
      maxItems: 3,
      items: { type: "string" },
    },
    tool_calls: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          reason: { type: "string" },
        },
        required: ["key", "reason"],
        additionalProperties: false,
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["reply_blocks", "tool_calls", "confidence"],
  additionalProperties: false,
};

const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeJson(raw: string) {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function parseModelResponse(raw: string): ModelResponse {
  const parsed = asRecord(JSON.parse(normalizeJson(raw)));
  const replyBlocks = Array.isArray(parsed.reply_blocks)
    ? parsed.reply_blocks.map((item) => asString(item)).filter(Boolean).slice(0, 3)
    : [];
  const toolCalls = Array.isArray(parsed.tool_calls)
    ? parsed.tool_calls.map((item) => {
      const call = asRecord(item);
      return { key: asString(call.key), reason: asString(call.reason) };
    }).filter((item) => Boolean(item.key)).slice(0, 4)
    : [];
  const confidence = Number(parsed.confidence);
  return {
    reply_blocks: replyBlocks,
    tool_calls: toolCalls,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
  };
}

function personalityInstruction(profile: string | null) {
  const normalized = profile ?? "balanced";
  if (normalized === "surgical") return "Seja objetivo, claro e economize palavras sem ficar frio.";
  if (normalized === "consultative") return "Seja acolhedor, investigativo e explique o próximo passo com clareza.";
  if (normalized === "dynamic") return "Mantenha um ritmo ágil, próximo e proativo, sem pressão artificial.";
  if (normalized === "enthusiastic") return "Seja caloroso e positivo, mas sem exagerar em exclamações ou intimidade.";
  return "Seja humano, claro, consultivo e adapte o tom ao contexto da conversa.";
}

function toolLabel(key: string) {
  const labels: Record<string, string> = {
    ai_audio: "Áudio IA",
    calendar: "Agendamento",
    forwarding: "Encaminhamento",
    prescription_analyst: "Receituário",
    visagism: "Visagismo",
    store_locator: "Buscar filiais",
    send_media: "Enviar mídia",
    rb_billing: "Cobrança",
  };
  return labels[key] ?? key;
}

export class AgentSimulatorService {
  private readonly client: CrmClient;
  private readonly agentsClient: CrmClient;
  private readonly locatorClient: CrmClient;
  private readonly openai: OpenAI | null;
  private readonly gemini: GoogleGenerativeAI | null;
  private readonly openaiModel: string;
  private readonly geminiFallbackModel: string;

  constructor(private readonly config: {
    supabaseUrl: string;
    serviceRoleKey: string;
    openaiApiKey?: string;
    openaiModel?: string;
    geminiApiKey?: string;
    geminiFallbackModel?: string;
    supportReportRecipientEmail: string;
    internalChatService: InternalChatService;
  }) {
    this.client = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "crm" },
    });
    this.agentsClient = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "agents" },
    });
    this.locatorClient = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "locator" },
    });
    this.openai = config.openaiApiKey ? new OpenAI({ apiKey: config.openaiApiKey }) : null;
    this.gemini = config.geminiApiKey ? new GoogleGenerativeAI(config.geminiApiKey) : null;
    this.openaiModel = config.openaiModel?.trim() || "gpt-5.6-luna";
    this.geminiFallbackModel = config.geminiFallbackModel?.trim() || "gemini-2.5-flash";
  }

  async listAccounts() {
    const { data, error } = await this.client.rpc("service_admin_accounts");
    if (error) throw new HttpError(500, "Não foi possível carregar as contas para simulação", error);
    const rows = Array.isArray(data) ? data : [];
    return rows
      .map((item) => asRecord(item))
      .map((item) => ({
        acesId: Number(item.aces_id),
        name: asString(item.account_name) || `Conta ${String(item.aces_id ?? "")}`,
        status: asString(item.status) || "active",
      }))
      .filter((item) => Number.isInteger(item.acesId) && item.acesId > 0 && item.status !== "canceled")
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }

  async listAgents(acesId: number) {
    await this.assertAccount(acesId);
    const { data, error } = await this.agentsClient
      .from("ai_agents")
      .select("id, aces_id, name, instance_name, agent_type, model, is_active")
      .eq("aces_id", acesId)
      .order("created_at", { ascending: true });
    if (error) throw new HttpError(500, "Não foi possível carregar os agentes", error);
    return (data ?? []).map((agent) => ({
      id: String(agent.id),
      name: String(agent.name ?? "Agente sem nome"),
      instanceName: agent.instance_name ? String(agent.instance_name) : null,
      agentType: agent.agent_type === "subagent" ? "subagent" : "primary",
      model: String(agent.model ?? ""),
      isActive: agent.is_active === true,
    }));
  }

  async getAgentConfig(acesId: number, agentId: string) {
    const agent = await this.loadAgent(acesId, agentId);
    const tools = await this.loadActiveTools(agent);
    return {
      agent: {
        id: agent.id,
        name: agent.name,
        instanceName: agent.instance_name,
        agentType: agent.agent_type,
        model: agent.model,
        isActive: agent.is_active,
      },
      tools,
    };
  }

  async simulateTurn(input: {
    acesId: number;
    agentId: string;
    scenarioKey?: string | null;
    leadContext?: { name?: string; city?: string; objective?: string };
    messages: SimulatorMessage[];
    attachments?: SimulatorAttachment[];
  }) {
    const agent = await this.loadAgent(input.acesId, input.agentId);
    const tools = await this.loadActiveTools(agent);
    const messages = this.validateMessages(input.messages);
    const attachments = this.validateAttachments(input.attachments ?? []);
    const latestLeadMessage = [...messages].reverse().find((message) => message.role === "lead");
    if (!latestLeadMessage) throw new HttpError(400, "Envie ao menos uma mensagem do lead para iniciar a simulação");

    const activeToolKeys = new Set(tools.map((tool) => tool.key));
    const conversation = messages
      .map((message) => `${message.role === "lead" ? "Lead" : "Agente"}: ${message.content}`)
      .join("\n");
    const leadContext = {
      name: asString(input.leadContext?.name) || "Lead de teste",
      city: asString(input.leadContext?.city) || null,
      objective: asString(input.leadContext?.objective) || null,
    };
    const prompt = [
      agent.system_prompt,
      "",
      "Você está em um SIMULADOR INTERNO. Responda como o agente configurado, mas nunca afirme que uma ação foi executada fora deste simulador.",
      personalityInstruction(agent.personality_profile),
      "Não envie mensagens por WhatsApp, não crie leads, não altere CRM, não faça handoff real, não agende nada e não altere dados.",
      "Quando uma ferramenta for necessária, cite-a apenas em tool_calls. Use exclusivamente chaves da lista de ferramentas ativas.",
      "Retorne JSON puro com reply_blocks, tool_calls e confidence.",
      "reply_blocks deve conter de 0 a 3 mensagens naturais, curtas e prontas para atendimento.",
      "",
      `Lead fictício: ${JSON.stringify(leadContext)}`,
      `Cenário selecionado: ${asString(input.scenarioKey) || "conversa livre"}`,
      `Ferramentas ativas: ${JSON.stringify(tools.map((tool) => ({ key: tool.key, name: tool.name, description: tool.description })))}`,
      attachments.length > 0
        ? `Anexos temporários no turno atual: ${JSON.stringify(attachments.map((attachment) => ({ kind: attachment.kind, fileName: attachment.fileName, mimeType: attachment.mimeType })))}`
        : null,
      "",
      `Histórico da simulação:\n${conversation}`,
    ].filter(Boolean).join("\n");

    const generated = await generateCentralStructuredResponse({
      openai: this.openai,
      openaiModel: this.openaiModel,
      prompt,
      schemaName: "agent_simulator_reply",
      schema: SIMULATOR_RESPONSE_SCHEMA,
      maxOutputTokens: 1_200,
      parse: parseModelResponse,
      fallback: () => this.generateGeminiResponse(agent.model, prompt),
      onPrimaryError: (error) => {
        console.warn("[agent-simulator] OpenAI indisponível; usando fallback Gemini", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });

    const toolCalls = generated.parsed.tool_calls.filter((call) => activeToolKeys.has(call.key));
    const toolEvents = await Promise.all(toolCalls.map((call) => this.describeToolSimulation(
      agent,
      tools.find((tool) => tool.key === call.key)!,
      call.reason,
    )));

    return {
      replyBlocks: generated.parsed.reply_blocks,
      confidence: generated.parsed.confidence,
      toolEvents,
      activeTools: tools,
      model: {
        provider: generated.provider,
        name: generated.modelName,
        usedFallback: generated.usedFallback,
      },
    };
  }

  async sendReport(context: AgentSimulatorAuthContext, input: {
    clientReportId: string;
    accountName: string;
    targetAcesId: number;
    agentName: string;
    tests: Array<{ kind: "scenario" | "tool"; name: string; status: "passed" | "failed"; note?: string }>;
    generalNote?: string;
  }) {
    if (!isUuid(input.clientReportId)) throw new HttpError(400, "Identificador do relatório inválido");
    await this.assertAccount(input.targetAcesId);
    const failedTests = input.tests.filter((test) => test.status === "failed");
    const passedTests = input.tests.filter((test) => test.status === "passed");
    if (failedTests.length === 0 && !asString(input.generalNote)) {
      throw new HttpError(400, "Registre ao menos um erro ou uma observação antes de enviar o relatório");
    }
    const content = [
      "SIMULADOR DE AGENTES",
      `Conta: ${asString(input.accountName) || `Conta ${input.targetAcesId}`} (aces_id: ${input.targetAcesId})`,
      `Agente: ${asString(input.agentName) || "Não informado"}`,
      passedTests.length ? `Testes aprovados: ${passedTests.map((test) => test.name).join(", ")}` : null,
      failedTests.length ? "Problemas encontrados:" : null,
      ...failedTests.map((test) => `- ${test.kind === "tool" ? "Tool" : "Cenário"}: ${test.name}${asString(test.note) ? ` — ${asString(test.note)}` : ""}`),
      asString(input.generalNote) ? `Observação: ${asString(input.generalNote)}` : null,
    ].filter(Boolean).join("\n");
    if (content.length > 9_500) throw new HttpError(400, "O relatório está muito extenso");

    return this.config.internalChatService.sendSimulatorReport(context, {
      recipientEmail: this.config.supportReportRecipientEmail,
      content,
      clientMessageId: input.clientReportId,
    });
  }

  private async assertAccount(acesId: number) {
    if (!Number.isInteger(acesId) || acesId <= 0) throw new HttpError(400, "Conta inválida");
    const { data, error } = await this.client
      .from("accounts")
      .select("id")
      .eq("id", acesId)
      .maybeSingle();
    if (error) throw new HttpError(500, "Não foi possível validar a conta", error);
    if (!data) throw new HttpError(404, "Conta não encontrada");
  }

  private async loadAgent(acesId: number, agentId: string): Promise<SimulatorAgent> {
    await this.assertAccount(acesId);
    if (!isUuid(agentId)) throw new HttpError(400, "Agente inválido");
    const { data, error } = await this.agentsClient
      .from("ai_agents")
      .select("id, aces_id, name, instance_name, agent_type, system_prompt, model, personality_profile, is_active")
      .eq("id", agentId)
      .eq("aces_id", acesId)
      .maybeSingle();
    if (error) throw new HttpError(500, "Não foi possível carregar o agente", error);
    if (!data) throw new HttpError(404, "Agente não encontrado nesta conta");
    return {
      id: String(data.id),
      aces_id: Number(data.aces_id),
      name: String(data.name ?? "Agente"),
      instance_name: data.instance_name ? String(data.instance_name) : null,
      agent_type: data.agent_type === "subagent" ? "subagent" : "primary",
      system_prompt: String(data.system_prompt ?? ""),
      model: String(data.model ?? ""),
      personality_profile: data.personality_profile ? String(data.personality_profile) : null,
      is_active: data.is_active === true,
    };
  }

  private async loadActiveTools(agent: SimulatorAgent): Promise<SimulatorTool[]> {
    const [{ data: bindings, error: bindingError }, { data: definitions, error: definitionError }] = await Promise.all([
      this.agentsClient
        .from("agent_tools")
        .select("id, tool_key, tool_version, is_enabled, readiness")
        .eq("agent_id", agent.id)
        .eq("aces_id", agent.aces_id)
        .eq("is_enabled", true)
        .eq("readiness", "ready"),
      this.agentsClient
        .from("tool_definitions")
        .select("tool_key, version, display_name, description")
        .eq("is_active", true),
    ]);
    if (bindingError || definitionError) {
      throw new HttpError(500, "Não foi possível validar as tools ativas", bindingError ?? definitionError);
    }
    const definitionByKey = new Map((definitions ?? []).map((definition) => [
      `${String(definition.tool_key)}:${Number(definition.version)}`,
      definition,
    ]));
    return (bindings ?? []).map((binding) => {
      const definition = definitionByKey.get(`${String(binding.tool_key)}:${Number(binding.tool_version)}`);
      return {
        id: String(binding.id),
        key: String(binding.tool_key),
        name: String(definition?.display_name ?? toolLabel(String(binding.tool_key))),
        description: String(definition?.description ?? ""),
        enabled: true,
        readiness: "ready",
      };
    });
  }

  private validateMessages(input: SimulatorMessage[]) {
    if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) {
      throw new HttpError(400, "Histórico de simulação inválido");
    }
    return input.map((message) => {
      const role = message?.role === "agent" ? "agent" : message?.role === "lead" ? "lead" : null;
      const content = asString(message?.content);
      if (!role || !content || content.length > MAX_MESSAGE_CHARS) {
        throw new HttpError(400, "Mensagem de simulação inválida");
      }
      return { role, content };
    });
  }

  private validateAttachments(input: SimulatorAttachment[]) {
    if (!Array.isArray(input) || input.length > MAX_ATTACHMENTS) throw new HttpError(400, "Quantidade de anexos inválida");
    return input.map((attachment) => {
      const kind = attachment?.kind === "audio" ? "audio" : attachment?.kind === "image" ? "image" : null;
      const fileName = asString(attachment?.fileName);
      const mimeType = asString(attachment?.mimeType).toLowerCase();
      const size = Number(attachment?.size);
      const allowed = kind === "image"
        ? ["image/jpeg", "image/png", "image/webp"].includes(mimeType)
        : ["audio/mpeg", "audio/mp4", "audio/ogg", "audio/opus", "audio/wav", "audio/webm"].includes(mimeType);
      if (!kind || !fileName || !allowed || !Number.isFinite(size) || size <= 0 || size > MAX_ATTACHMENT_BYTES) {
        throw new HttpError(400, "Anexo de simulação inválido");
      }
      return { kind, fileName, mimeType, size };
    });
  }

  private async generateGeminiResponse(agentModel: string, prompt: string) {
    if (!this.gemini) throw new Error("Nenhum provedor de IA está configurado para o simulador");
    const modelName = agentModel.startsWith("gemini") ? agentModel : this.geminiFallbackModel;
    const model = this.gemini.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1_200 },
    });
    const result = await model.generateContent(prompt);
    const response = result.response;
    const usage = asRecord(response as unknown as JsonRecord);
    return {
      rawText: response.text(),
      modelName,
      attempt: 1,
      tokensIn: typeof usage.promptTokenCount === "number" ? usage.promptTokenCount : null,
      tokensOut: typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null,
    };
  }

  private async describeToolSimulation(agent: SimulatorAgent, tool: SimulatorTool, reason: string) {
    const generic = {
      key: tool.key,
      name: tool.name,
      reason,
      status: "simulated" as const,
      detail: "Ação simulada sem alterar dados externos.",
    };
    try {
      if (tool.key === "store_locator") {
        const { data } = await this.locatorClient
          .from("stores")
          .select("display_name, city, state")
          .eq("aces_id", agent.aces_id)
          .eq("is_active", true)
          .eq("ai_visible", true)
          .limit(3);
        const labels = (data ?? []).map((store) => [store.display_name, store.city, store.state].filter(Boolean).join(" — "));
        return { ...generic, status: "read_only" as const, detail: labels.length ? `Consulta segura disponível: ${labels.join("; ")}.` : "Nenhuma filial ativa encontrada para consulta." };
      }
      if (tool.key === "send_media") {
        const { data } = await this.agentsClient
          .from("tool_media_assets")
          .select("display_name")
          .eq("aces_id", agent.aces_id)
          .eq("agent_tool_id", tool.id)
          .eq("is_active", true)
          .limit(3);
        const labels = (data ?? []).map((asset) => String(asset.display_name));
        return { ...generic, status: "read_only" as const, detail: labels.length ? `Materiais disponíveis para simulação: ${labels.join(", ")}. Nenhum envio foi realizado.` : "A mídia seria simulada; não há material ativo cadastrado." };
      }
      if (tool.key === "calendar") {
        const { data } = await this.client.schema("calendar")
          .from("settings")
          .select("timezone, ai_booking_enabled")
          .eq("aces_id", agent.aces_id)
          .maybeSingle();
        return { ...generic, status: "read_only" as const, detail: data ? `Agenda consultada em modo seguro (${String(data.timezone ?? "America/Sao_Paulo")}). Nenhuma reserva foi criada.` : "Agenda simulada; nenhuma reserva foi criada." };
      }
    } catch (error) {
      return { ...generic, detail: `Ação simulada. A consulta segura não ficou disponível: ${error instanceof Error ? error.message : "erro desconhecido"}` };
    }
    return generic;
  }
}
