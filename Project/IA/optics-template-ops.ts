import "./load-env.js";

import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";

const ELEVENLABS_API_URL = "https://api.elevenlabs.io";
const DEFAULT_INSTANCE_NAME = "Lavie";
const DEFAULT_AGENT_NAME = "Consultor Lavie";
const DEFAULT_TEMPLATE_KEY = "optics-consultant";
const DEFAULT_SELECTION_RATE = 0.018;
const DEFAULT_PREVIEW_TEXT =
  "Ola! Eu sou a consultora virtual da Lavie. Como posso ajudar voce a encontrar a melhor solucao hoje?";
const LAVIE_SYSTEM_PROMPT =
  "Voce e o Consultor Lavie, atendimento comercial de uma otica via WhatsApp. Seja natural, consultivo e objetivo. Nao invente precos, estoque, diagnosticos ou recomendacoes clinicas. Use apenas informacoes e Tools configuradas. Faca uma pergunta por vez e encaminhe para atendimento humano quando faltar informacao ou houver questao clinica.";

type CliOptions = Map<string, string | boolean>;

type InstanceRow = {
  instancia: string;
  aces_id: number;
  created_by: string | null;
};

type AgentRow = {
  id: string;
  aces_id: number;
  instance_name: string;
  name: string;
  template_key: string | null;
  is_active: boolean;
};

type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  preview_url?: string | null;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variavel obrigatoria ausente: ${name}`);
  return value;
}

function parseOptions(args: string[]) {
  const options: CliOptions = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) throw new Error(`Argumento inesperado: ${token}`);
    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    if (!rawKey) throw new Error("Opcao vazia");
    if (inlineValue !== undefined) {
      options.set(rawKey, inlineValue);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      options.set(rawKey, next);
      index += 1;
    } else {
      options.set(rawKey, true);
    }
  }

  if (options.has("api-key")) {
    throw new Error("Nao passe segredos por argumento. Use ELEVENLABS_API_KEY no ambiente.");
  }
  return options;
}

function optionString(options: CliOptions, name: string) {
  const value = options.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionInteger(options: CliOptions, name: string) {
  const value = optionString(options, name);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} deve ser inteiro positivo`);
  return parsed;
}

function createClients() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const shared = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    crm: createClient(supabaseUrl, serviceRoleKey, { ...shared, db: { schema: "crm" } }),
    agents: createClient(supabaseUrl, serviceRoleKey, { ...shared, db: { schema: "agents" } }),
  };
}

async function listElevenLabsVoices(search?: string | null) {
  const apiKey = requiredEnv("ELEVENLABS_API_KEY");
  const voices: ElevenLabsVoice[] = [];
  let nextPageToken: string | null = null;

  for (let page = 0; page < 10; page += 1) {
    const response = await axios.get(`${ELEVENLABS_API_URL}/v2/voices`, {
      headers: { "xi-api-key": apiKey },
      params: {
        page_size: 100,
        search: search || undefined,
        next_page_token: nextPageToken || undefined,
      },
      timeout: 20_000,
    });
    const payload = response.data as {
      voices?: ElevenLabsVoice[];
      has_more?: boolean;
      next_page_token?: string | null;
    };
    voices.push(...(payload.voices ?? []));
    if (!payload.has_more || !payload.next_page_token) break;
    nextPageToken = payload.next_page_token;
  }

  return voices;
}

async function assertVoiceExists(voiceId: string) {
  const voices = await listElevenLabsVoices();
  const voice = voices.find((candidate) => candidate.voice_id === voiceId);
  if (!voice) throw new Error(`Voz ElevenLabs nao encontrada: ${voiceId}`);
  return voice;
}

async function resolveInstance(options: CliOptions) {
  const instanceName = optionString(options, "instance") ?? DEFAULT_INSTANCE_NAME;
  const acesId = optionInteger(options, "aces-id");
  const { crm } = createClients();
  let query = crm
    .from("instance")
    .select("instancia, aces_id, created_by")
    .eq("instancia", instanceName);
  if (acesId) query = query.eq("aces_id", acesId);
  const { data, error } = await query.limit(3);
  if (error) throw new Error(`Falha ao localizar instancia: ${error.message}`);
  if (!data?.length) throw new Error(`Instancia nao encontrada: ${instanceName}`);
  if (data.length > 1) throw new Error("Instancia ambigua; informe --aces-id");

  const instance = data[0] as InstanceRow;
  if (!instance.created_by) throw new Error("A instancia nao possui created_by");
  const { data: owner, error: ownerError } = await crm
    .from("users")
    .select("id, role")
    .eq("id", instance.created_by)
    .eq("aces_id", instance.aces_id)
    .maybeSingle();
  if (ownerError) throw new Error(`Falha ao validar responsavel: ${ownerError.message}`);
  if (!owner || owner.role !== "ADMIN") throw new Error("O responsavel da instancia precisa ser ADMIN");
  return instance;
}

async function findLavieAgent(instance: InstanceRow) {
  const { agents } = createClients();
  const { data, error } = await agents
    .from("ai_agents")
    .select("id, aces_id, instance_name, name, template_key, is_active")
    .eq("aces_id", instance.aces_id)
    .eq("instance_name", instance.instancia)
    .maybeSingle();
  if (error) throw new Error(`Falha ao localizar agente: ${error.message}`);
  return (data as AgentRow | null) ?? null;
}

async function provisionLavie(options: CliOptions) {
  const instance = await resolveInstance(options);
  const existing = await findLavieAgent(instance);
  if (existing) {
    if (existing.template_key !== DEFAULT_TEMPLATE_KEY) {
      throw new Error(`A instancia ja esta vinculada ao agente ${existing.name}, sem o template de oticas`);
    }
    return { created: false, agent: existing };
  }

  const { agents, crm } = createClients();
  const { data: agent, error } = await agents
    .rpc("create_agent_from_template", {
      p_aces_id: instance.aces_id,
      p_created_by: instance.created_by,
      p_instance_name: instance.instancia,
      p_name: DEFAULT_AGENT_NAME,
      p_system_prompt: LAVIE_SYSTEM_PROMPT,
      p_model: "gemini-2.5-flash",
      p_temperature: 0.4,
      p_template_key: DEFAULT_TEMPLATE_KEY,
      p_is_active: false,
    })
    .single();
  if (error) throw new Error(`Falha ao provisionar Consultor Lavie: ${error.message}`);

  const createdAgent = agent as AgentRow;
  const { data: stages, error: stageError } = await crm
    .from("pipeline_stages")
    .select("id, position, category")
    .eq("aces_id", instance.aces_id);
  if (stageError) throw new Error(`Agente criado, mas falhou ao listar etapas: ${stageError.message}`);
  if (stages?.length) {
    const { error: rulesError } = await agents.from("ai_stage_rules").upsert(
      stages.map((stage) => ({
        agent_id: createdAgent.id,
        stage_id: stage.id,
        goal_description: "",
        positive_signals: [],
        negative_signals: [],
        example_phrases: [],
        priority: stage.position,
        is_terminal: stage.category !== "Aberto",
      })),
      { onConflict: "agent_id,stage_id" }
    );
    if (rulesError) throw new Error(`Agente criado, mas falhou ao preparar regras: ${rulesError.message}`);
  }

  return { created: true, agent: { ...createdAgent, is_active: false } };
}

async function configureLavie(options: CliOptions) {
  if (process.env.ELEVENLABS_TTS_ENABLED !== "true") {
    throw new Error("Defina ELEVENLABS_TTS_ENABLED=true antes de ativar o audio");
  }
  const voiceId = optionString(options, "voice-id");
  if (!voiceId) throw new Error("Informe --voice-id");
  const voice = await assertVoiceExists(voiceId);
  const instance = await resolveInstance(options);
  const agent = await findLavieAgent(instance);
  if (!agent || agent.template_key !== DEFAULT_TEMPLATE_KEY) {
    throw new Error("Consultor Lavie nao provisionado. Execute provision-lavie primeiro.");
  }

  const { agents } = createClients();
  const { data, error } = await agents.rpc("configure_agent_audio", {
    p_agent_id: agent.id,
    p_voice_id: voiceId,
    p_selection_rate: DEFAULT_SELECTION_RATE,
    p_activate_agent: true,
  });
  if (error) throw new Error(`Falha ao configurar audio da Lavie: ${error.message}`);

  const status = await getLavieStatus(options);
  const enabled = status.tools.filter((tool) => tool.is_enabled);
  if (enabled.length !== 1 || enabled[0]?.tool_key !== "ai_audio" || !status.agent.is_active) {
    throw new Error("Pos-condicao falhou: Lavie ativa deve ter somente ai_audio habilitada");
  }
  return { voice: { voiceId: voice.voice_id, name: voice.name }, result: data, status };
}

async function getLavieStatus(options: CliOptions) {
  const instance = await resolveInstance(options);
  const agent = await findLavieAgent(instance);
  if (!agent) throw new Error("Consultor Lavie nao provisionado");
  const { agents } = createClients();
  const { data: tools, error } = await agents
    .from("agent_tools")
    .select("tool_key, is_enabled, readiness, config")
    .eq("agent_id", agent.id)
    .order("tool_key");
  if (error) throw new Error(`Falha ao carregar Tools: ${error.message}`);
  return { agent, tools: tools ?? [] };
}

async function generatePreview(options: CliOptions) {
  const voiceId = optionString(options, "voice-id");
  if (!voiceId) throw new Error("Informe --voice-id");
  const voice = await assertVoiceExists(voiceId);
  const apiKey = requiredEnv("ELEVENLABS_API_KEY");
  const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT?.trim() || "mp3_44100_128";
  const modelId = process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5";
  const response = await axios.post(
    `${ELEVENLABS_API_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      text: optionString(options, "text") ?? DEFAULT_PREVIEW_TEXT,
      model_id: modelId,
    },
    {
      headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      params: { output_format: outputFormat },
      responseType: "arraybuffer",
      timeout: 45_000,
    }
  );

  const defaultFile = path.resolve(process.cwd(), ".tmp", "elevenlabs-previews", `${voiceId}.mp3`);
  const outputFile = path.resolve(optionString(options, "out") ?? defaultFile);
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, Buffer.from(response.data));
  return { voice: { voiceId: voice.voice_id, name: voice.name }, file: outputFile };
}

function printHelp() {
  process.stdout.write(`Uso: npm run optics:ops -- <comando> [opcoes]\n\n`);
  process.stdout.write("Comandos:\n");
  process.stdout.write("  voices [--search texto]\n");
  process.stdout.write("  preview --voice-id ID [--text texto] [--out arquivo.mp3]\n");
  process.stdout.write("  provision-lavie [--instance Lavie] [--aces-id ID]\n");
  process.stdout.write("  configure-lavie --voice-id ID [--instance Lavie] [--aces-id ID]\n");
  process.stdout.write("  status-lavie [--instance Lavie] [--aces-id ID]\n");
}

async function main() {
  const [command, ...rawOptions] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }
  const options = parseOptions(rawOptions);

  let result: unknown;
  if (command === "voices") {
    result = (await listElevenLabsVoices(optionString(options, "search"))).map((voice) => ({
      voiceId: voice.voice_id,
      name: voice.name,
      category: voice.category ?? null,
      description: voice.description ?? null,
      previewUrl: voice.preview_url ?? null,
    }));
  } else if (command === "preview") {
    result = await generatePreview(options);
  } else if (command === "provision-lavie") {
    result = await provisionLavie(options);
  } else if (command === "configure-lavie") {
    result = await configureLavie(options);
  } else if (command === "status-lavie") {
    result = await getLavieStatus(options);
  } else {
    throw new Error(`Comando desconhecido: ${command}`);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = axios.isAxiosError(error)
    ? `Falha externa (${error.response?.status ?? "sem status"}): ${error.message}`
    : error instanceof Error
      ? error.message
      : "Falha operacional desconhecida";
  process.stderr.write(`[optics-ops] ${message}\n`);
  process.exitCode = 1;
});
