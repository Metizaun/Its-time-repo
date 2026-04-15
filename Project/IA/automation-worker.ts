import "./load-env.js";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

type ClaimedExecution = {
  execution_id: string;
  lead_id: string;
  aces_id: number;
  instance_name: string | null;
  phone: string | null;
  lead_name: string | null;
  city: string | null;
  lead_status: string | null;
  template: string | null;
  step_label: string | null;
  funnel_name: string | null;
  scheduled_at: string;
  attempt_count: number;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

async function sendWhatsAppMessage(
  evolutionApiUrl: string,
  evolutionApiKey: string,
  instanceName: string,
  phone: string,
  message: string
) {
  const cleanPhone = normalizePhone(phone);
  const finalNumber = cleanPhone.length <= 11 ? `55${cleanPhone}` : cleanPhone;

  await axios.post(
    `${evolutionApiUrl}/message/sendText/${instanceName}`,
    {
      number: `${finalNumber}@s.whatsapp.net`,
      text: message,
      delay: 1000,
    },
    {
      headers: { apikey: evolutionApiKey },
    }
  );
}

export function startAutomationWorker() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const evolutionApiUrl = requireEnv("EVOLUTION_API_URL");
  const evolutionApiKey = requireEnv("EVOLUTION_API_KEY");
  const pollMs = Number(process.env.AUTOMATION_WORKER_POLL_MS ?? 300000);
  const batchSize = Number(process.env.AUTOMATION_WORKER_BATCH_SIZE ?? 50);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "crm" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let running = false;

  async function markExecution(
    executionId: string,
    payload: Partial<{
      status: "sent" | "failed";
      sent_at: string;
      rendered_message: string;
      last_error: string | null;
      attempt_count: number;
    }>
  ) {
    const { error } = await supabase
      .from("automation_executions")
      .update(payload)
      .eq("id", executionId);

    if (error) {
      throw error;
    }
  }

  async function saveOutboundMessage(execution: ClaimedExecution, content: string) {
    const { error } = await supabase.from("message_history").insert({
      lead_id: execution.lead_id,
      aces_id: execution.aces_id,
      content,
      direction: "outbound",
      source_type: "automation",
      conversation_id: `automation:${execution.execution_id}`,
      instance: execution.instance_name,
      sent_at: new Date().toISOString(),
    });

    if (error) {
      throw error;
    }
  }

  async function processDueExecutions() {
    if (running) {
      return;
    }

    running = true;

    try {
      const { data, error } = await supabase.rpc("rpc_claim_due_automation_executions", {
        p_limit: batchSize,
      });

      if (error) {
        throw error;
      }

      const executions = (data as ClaimedExecution[]) || [];
      if (executions.length === 0) {
        return;
      }

      for (const execution of executions) {
        const nextAttempt = execution.attempt_count + 1;

        try {
          if (!execution.template) {
            throw new Error("Template do disparo não encontrado");
          }

          if (!execution.instance_name) {
            throw new Error("Instância de envio não definida");
          }

          if (!execution.phone) {
            throw new Error("Lead sem telefone para disparo");
          }

          const renderedMessage = renderTemplate(execution.template, {
            nome: execution.lead_name ?? "",
            telefone: execution.phone ?? "",
            cidade: execution.city ?? "",
            status: execution.lead_status ?? "",
          });

          await sendWhatsAppMessage(
            evolutionApiUrl,
            evolutionApiKey,
            execution.instance_name,
            execution.phone,
            renderedMessage
          );

          await saveOutboundMessage(execution, renderedMessage);

          await markExecution(execution.execution_id, {
            status: "sent",
            sent_at: new Date().toISOString(),
            rendered_message: renderedMessage,
            last_error: null,
            attempt_count: nextAttempt,
          });
        } catch (error: any) {
          console.error(`[automation-worker] Falha ao processar execução ${execution.execution_id}:`, error);

          await markExecution(execution.execution_id, {
            status: "failed",
            rendered_message: execution.template
              ? renderTemplate(execution.template, {
                  nome: execution.lead_name ?? "",
                  telefone: execution.phone ?? "",
                  cidade: execution.city ?? "",
                  status: execution.lead_status ?? "",
                })
              : undefined,
            last_error: error.message,
            attempt_count: nextAttempt,
          });
        }
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => {
    processDueExecutions().catch((error) => {
      console.error("[automation-worker] Erro no ciclo do worker:", error);
    });
  }, pollMs);

  processDueExecutions().catch((error) => {
    console.error("[automation-worker] Erro na execução inicial:", error);
  });

  console.log(
    `[automation-worker] Rodando a cada ${pollMs}ms com lote máximo de ${batchSize} execuções`
  );

  return {
    processDueExecutions,
    stop() {
      clearInterval(timer);
    },
  };
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (isDirectRun) {
  startAutomationWorker();
}
