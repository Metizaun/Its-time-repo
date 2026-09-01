import { createClient } from "@supabase/supabase-js";

import "../load-env.js";

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} e obrigatorio`);
  return value;
}

async function main() {
  const acesId = Number(requireEnv("META_BOOTSTRAP_ACES_ID"));
  if (!Number.isInteger(acesId) || acesId <= 0) {
    throw new Error("META_BOOTSTRAP_ACES_ID deve ser um inteiro positivo");
  }

  const crmClient = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      db: { schema: "crm" },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data, error } = await crmClient.rpc(
    "rpc_disable_meta_whatsapp_channel",
    {
      p_aces_id: acesId,
      p_instance_name: requireEnv("META_BOOTSTRAP_INSTANCE_NAME"),
      p_actor_id: requireEnv("META_BOOTSTRAP_ACTOR_ID"),
    },
  );

  if (error) throw error;

  console.log(
    JSON.stringify({
      success: true,
      channel: {
        id: String(data?.id ?? ""),
        instanceName: String(data?.instance_name ?? ""),
        status: String(data?.status ?? "disabled"),
      },
    }),
  );
}

main().catch(() => {
  console.error(
    JSON.stringify({
      success: false,
      error: {
        code: "META_DISABLE_FAILED",
        message: "Nao foi possivel desabilitar o canal Meta",
      },
    }),
  );
  process.exitCode = 1;
});
