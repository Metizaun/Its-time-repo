import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import "../load-env.js";

type PersonalityProfile = "surgical" | "consultative" | "balanced" | "dynamic" | "enthusiastic";
type CompanyManifest = {
  cnpj: string; legalName: string; name: string; address: string; city: string; state: string;
  postalCode: string | null; phone: string | null; email: string | null; timezone: string; active: boolean;
};
type AgentManifest = {
  key: string; name: string; systemPromptFile: string; model: string; temperature: number;
  personalityProfile: PersonalityProfile; routingInstruction: string; handoffPrompt: string;
  ragEnabled: false; active: boolean;
  tools: { calendar: { enabled: boolean; queryAvailability: boolean; create: false; reschedule: false; cancel: false } };
};
type ClientAgentManifest = {
  schemaVersion: 3;
  clientKey: string;
  parentAgent: Omit<AgentManifest, "key" | "routingInstruction" | "tools"> & { templateKey: string };
  companies: CompanyManifest[];
  subagents?: AgentManifest[];
  calendar: { timezone: string; aiBookingEnabled: false };
};
type CliOptions = { configPath: string; acesId: number; instanceName: string; dryRun: boolean };

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} nao configurada.`);
  return value;
}

function readOption(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1]?.trim() : undefined;
}

function parseOptions(): CliOptions {
  const args = process.argv.slice(2);
  const configPath = readOption(args, "--config");
  const acesRaw = readOption(args, "--aces-id") ?? process.env.CLIENT_CONFIG_ACES_ID?.trim();
  const instanceName = readOption(args, "--instance") ?? process.env.CLIENT_CONFIG_INSTANCE_NAME?.trim();
  if (!configPath || !acesRaw || !instanceName) {
    throw new Error("Uso: npm run client-config:apply -- --config <manifest.json> --aces-id <id> --instance <nome> [--dry-run]");
  }
  const acesId = Number(acesRaw);
  if (!Number.isInteger(acesId) || acesId <= 0) throw new Error("aces-id invalido.");
  return { configPath: path.resolve(configPath), acesId, instanceName, dryRun: args.includes("--dry-run") };
}

function assertManifest(value: unknown): asserts value is ClientAgentManifest {
  const manifest = value as Partial<ClientAgentManifest>;
  if (manifest.schemaVersion !== 3 || !manifest.clientKey?.trim()) throw new Error("Manifesto invalido ou desatualizado.");
  if (!manifest.parentAgent?.name?.trim() || !manifest.parentAgent.systemPromptFile?.trim() || !manifest.parentAgent.templateKey?.trim()) throw new Error("parentAgent incompleto.");
  if (!Array.isArray(manifest.companies) || manifest.companies.length === 0) throw new Error("Declare as empresas atendidas.");
  if (manifest.calendar?.aiBookingEnabled !== false) throw new Error("aiBookingEnabled deve permanecer false.");
  if (!Array.isArray(manifest.subagents) && manifest.clientKey !== "queromed") {
    throw new Error("Somente a QueroMed pode operar sem subagentes.");
  }
  if (Array.isArray(manifest.subagents)) {
    for (const subagent of manifest.subagents) {
      if (!subagent.key?.trim() || !subagent.routingInstruction?.trim() || !subagent.systemPromptFile?.trim()) throw new Error("Subagente incompleto.");
      if (subagent.ragEnabled !== false) throw new Error(`RAG deve permanecer desativado em ${subagent.key}.`);
      const tool = subagent.tools?.calendar;
      if (!tool || tool.create !== false || tool.reschedule !== false || tool.cancel !== false) throw new Error(`Mutacoes de agenda devem permanecer bloqueadas em ${subagent.key}.`);
    }
  }
  const cnpjs = manifest.companies.map((company) => company.cnpj.replace(/\D/g, ""));
  if (new Set(cnpjs).size !== cnpjs.length) throw new Error("CNPJs duplicados.");
}

async function loadPrompt(directory: string, relativePath: string) {
  const resolved = path.resolve(directory, relativePath);
  if (!resolved.startsWith(`${directory}${path.sep}`)) throw new Error(`Prompt fora da pasta do manifesto: ${relativePath}`);
  const prompt = (await fs.readFile(resolved, "utf8")).trim();
  if (!prompt) throw new Error(`Prompt vazio: ${relativePath}`);
  return prompt;
}

async function main() {
  const options = parseOptions();
  const directory = path.dirname(options.configPath);
  const raw = JSON.parse(await fs.readFile(options.configPath, "utf8")) as unknown;
  assertManifest(raw);
  const manifest = raw;
  const parentPrompt = await loadPrompt(directory, manifest.parentAgent.systemPromptFile);
  const subagentItems = Array.isArray(manifest.subagents) ? manifest.subagents : [];
  const subagents = await Promise.all(subagentItems.map(async (item) => ({ ...item, systemPrompt: await loadPrompt(directory, item.systemPromptFile) })));
  const allowsCalendarMutations = manifest.clientKey === "queromed";

  const shared = { auth: { persistSession: false, autoRefreshToken: false } };
  const url = requiredEnv("SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const crm = createClient(url, key, { ...shared, db: { schema: "crm" } });
  const agentsDb = createClient(url, key, { ...shared, db: { schema: "agents" } });
  const calendar = createClient(url, key, { ...shared, db: { schema: "calendar" } });

  const [{ data: account }, { data: instance }] = await Promise.all([
    crm.from("accounts").select("id").eq("id", options.acesId).maybeSingle(),
    crm.from("instance").select("instancia").eq("instancia", options.instanceName).eq("aces_id", options.acesId).maybeSingle(),
  ]);
  if (!account) throw new Error(`Conta ${options.acesId} nao encontrada.`);
  if (!instance) throw new Error(`Instancia ${options.instanceName} nao encontrada. O aplicador nunca cria numeros ou instancias.`);

  const { data: templates, error: templateError } = await agentsDb.from("agent_templates")
    .select("template_key,version")
    .eq("template_key", manifest.parentAgent.templateKey)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1);
  const template = templates?.[0];
  if (templateError || !template) throw new Error(`Template ${manifest.parentAgent.templateKey} nao encontrado ou inativo: ${templateError?.message ?? "sem versao ativa"}`);

  const { data: templateTools, error: templateToolsError } = await agentsDb.from("agent_template_tools")
    .select("tool_key,tool_version,default_enabled,default_readiness,default_config")
    .eq("template_key", template.template_key)
    .eq("template_version", template.version);
  if (templateToolsError) throw new Error(`Falha ao carregar ferramentas do template ${template.template_key}: ${templateToolsError.message}`);

  const plan = {
    clientKey: manifest.clientKey, acesId: options.acesId, instanceName: options.instanceName,
    parentAgent: manifest.parentAgent.name, parentTemplate: `${template.template_key}:${template.version}`,
    subagents: subagents.map((item) => item.key),
    companies: manifest.companies.map(({ cnpj, name }) => ({ cnpj, name })),
    createsWhatsAppInstance: false, usesRag: false, writesCompanyRegistrationData: true,
    automaticCalendarMutations: allowsCalendarMutations,
  };
  if (options.dryRun) { process.stdout.write(`${JSON.stringify({ dryRun: true, plan }, null, 2)}\n`); return; }

  const { data: parent, error: parentError } = await agentsDb.from("ai_agents").upsert({
    aces_id: options.acesId, instance_name: options.instanceName, agent_type: "primary", parent_agent_id: null,
    agent_key: null, routing_instruction: null, name: manifest.parentAgent.name, system_prompt: parentPrompt,
    provider: "gemini", model: manifest.parentAgent.model, temperature: manifest.parentAgent.temperature,
    personality_profile: manifest.parentAgent.personalityProfile, is_active: manifest.parentAgent.active,
    handoff_enabled: true, handoff_prompt: manifest.parentAgent.handoffPrompt, rag_enabled: false,
    template_key: template.template_key, template_version: template.version,
  }, { onConflict: "aces_id,instance_name" }).select("id").single();
  if (parentError || !parent) throw new Error(`Falha ao aplicar agente principal: ${parentError?.message}`);

  if (templateTools?.length) {
    const { error: parentToolsError } = await agentsDb.from("agent_tools").upsert(
      templateTools.map((tool) => ({
        aces_id: options.acesId,
        agent_id: parent.id,
        tool_key: tool.tool_key,
        tool_version: tool.tool_version,
        is_enabled: tool.default_enabled,
        readiness: tool.default_readiness,
        config: tool.default_config,
      })),
      { onConflict: "agent_id,tool_key", ignoreDuplicates: true },
    );
    if (parentToolsError) throw new Error(`Falha ao aplicar ferramentas do template ${template.template_key}: ${parentToolsError.message}`);
  }

  const companyIds: string[] = [];
  for (const company of manifest.companies) {
    const { data, error } = await crm.from("empresas").upsert({
      aces_id: options.acesId, cnpj: company.cnpj.replace(/\D/g, ""), legal_name: company.legalName,
      name: company.name, phone: company.phone, email: company.email, address: company.address,
      city: company.city, state: company.state, postal_code: company.postalCode?.replace(/\D/g, "") ?? null,
      timezone: company.timezone, is_active: company.active,
    }, { onConflict: "aces_id,cnpj" }).select("id").single();
    if (error || !data) throw new Error(`Falha ao aplicar empresa ${company.name}: ${error?.message}`);
    companyIds.push(String(data.id));
  }

  const subagentIds: string[] = [];
  for (const subagent of subagents) {
    const { data: existing, error: findError } = await agentsDb.from("ai_agents").select("id")
      .eq("aces_id", options.acesId).eq("parent_agent_id", parent.id).eq("agent_key", subagent.key).maybeSingle();
    if (findError) throw new Error(`Falha ao consultar subagente ${subagent.key}: ${findError.message}`);
    const payload = {
      aces_id: options.acesId, instance_name: null, agent_type: "subagent", parent_agent_id: parent.id,
      agent_key: subagent.key, routing_instruction: subagent.routingInstruction, name: subagent.name,
      system_prompt: subagent.systemPrompt, provider: "gemini", model: subagent.model,
      temperature: subagent.temperature, personality_profile: subagent.personalityProfile,
      is_active: subagent.active, handoff_enabled: true, handoff_prompt: subagent.handoffPrompt, rag_enabled: false,
    };
    const operation = existing
      ? agentsDb.from("ai_agents").update(payload).eq("id", existing.id).select("id").single()
      : agentsDb.from("ai_agents").insert(payload).select("id").single();
    const { data: saved, error } = await operation;
    if (error || !saved) throw new Error(`Falha ao aplicar subagente ${subagent.key}: ${error?.message}`);
    subagentIds.push(String(saved.id));

    const calendarTool = subagent.tools.calendar;
    const { error: toolError } = await agentsDb.from("agent_tools").upsert({
      aces_id: options.acesId, agent_id: saved.id, tool_key: "calendar", tool_version: 1,
      is_enabled: calendarTool.enabled, readiness: "ready",
      config: { queryAvailability: calendarTool.queryAvailability, create: false, reschedule: false, cancel: false },
      last_validated_at: new Date().toISOString(),
    }, { onConflict: "agent_id,tool_key" });
    if (toolError) throw new Error(`Falha ao aplicar agenda em ${subagent.key}: ${toolError.message}`);
  }

  const { error: settingsError } = await calendar.from("settings").upsert({
    aces_id: options.acesId, timezone: manifest.calendar.timezone, ai_booking_enabled: allowsCalendarMutations,
  }, { onConflict: "aces_id" });
  if (settingsError) throw new Error(`Falha ao bloquear agenda da conta: ${settingsError.message}`);

  if (allowsCalendarMutations) {
    // A QueroMed agenda pelo agente principal; os demais clientes permanecem somente em consulta.
    await agentsDb.from("agent_tools").upsert([
      {
        aces_id: options.acesId, agent_id: parent.id, tool_key: "calendar", tool_version: 1,
        is_enabled: true, readiness: "ready",
        config: { queryAvailability: true, create: true, reschedule: true, cancel: true },
        last_validated_at: new Date().toISOString(),
      },
      {
        aces_id: options.acesId, agent_id: parent.id, tool_key: "forwarding", tool_version: 1,
        is_enabled: true, readiness: "ready",
        config: {},
        last_validated_at: new Date().toISOString(),
      }
    ], { onConflict: "agent_id,tool_key" });
  } else {
    await agentsDb.from("agent_tools").update({ is_enabled: false }).eq("agent_id", parent.id).eq("tool_key", "calendar");
  }

  process.stdout.write(`${JSON.stringify({ applied: true, plan, parentAgentId: parent.id, subagentIds, companyIds }, null, 2)}\n`);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
