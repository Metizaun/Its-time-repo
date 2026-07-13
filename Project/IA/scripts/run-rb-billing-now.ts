import { createClient } from "@supabase/supabase-js";

import "../load-env.js";
import { RbBillingWorker } from "../rb-billing-worker.js";

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

function parseInteger(value: string | undefined, flagName: string) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} deve ser um inteiro positivo`);
  }

  return parsed;
}

function parseArgs(argv: string[]) {
  let acesId: number | null = null;
  let agentId: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--aces-id") {
      acesId = parseInteger(next, "--aces-id");
      index += 1;
      continue;
    }

    if (current === "--agent-id") {
      agentId = next?.trim() || null;
      index += 1;
      continue;
    }
  }

  if (!acesId && !agentId) {
    throw new Error("Informe --aces-id ou --agent-id");
  }

  return { acesId, agentId };
}

async function listAgentIdsForAcesId(acesId: number) {
  const agentsClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "agents" },
  });

  const { data, error } = await agentsClient
    .from("agent_tools")
    .select("agent_id")
    .eq("aces_id", acesId)
    .eq("tool_key", "rb_billing")
    .eq("is_enabled", true)
    .eq("readiness", "ready");

  if (error) {
    throw new Error(`Nao foi possivel listar bindings RB da conta ${acesId}: ${error.message}`);
  }

  return Array.from(new Set((data ?? []).map((row) => String(row.agent_id)).filter(Boolean)));
}

async function resolveAcesIdForAgent(agentId: string) {
  const agentsClient = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "agents" },
  });

  const { data, error } = await agentsClient
    .from("agent_tools")
    .select("aces_id")
    .eq("agent_id", agentId)
    .eq("tool_key", "rb_billing")
    .maybeSingle();

  if (error) {
    throw new Error(`Nao foi possivel resolver a conta do agente ${agentId}: ${error.message}`);
  }

  const resolved = Number(data?.aces_id);
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(`Agente ${agentId} nao possui binding RB valido`);
  }

  return resolved;
}

async function main() {
  const { acesId, agentId } = parseArgs(process.argv.slice(2));
  const worker = new RbBillingWorker({
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    mockFixturePath: process.env.RB_BILLING_MOCK_FIXTURE_PATH,
    pollMs: Number(process.env.RB_BILLING_WORKER_POLL_MS ?? 60000),
  });

  const targets =
    agentId && acesId
      ? [{ acesId, agentId }]
      : agentId
        ? [{ acesId: await resolveAcesIdForAgent(agentId), agentId }]
        : (await listAgentIdsForAcesId(acesId!)).map((currentAgentId) => ({
            acesId: acesId!,
            agentId: currentAgentId,
          }));

  if (targets.length === 0) {
    throw new Error(`Nenhum binding RB habilitado e pronto encontrado para aces_id=${acesId}`);
  }

  for (const target of targets) {
    const result = await worker.runNowForAgent(target.acesId, target.agentId);
    console.log(
      JSON.stringify(
        {
          acesId: target.acesId,
          agentId: target.agentId,
          result,
        },
        null,
        2
      )
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
