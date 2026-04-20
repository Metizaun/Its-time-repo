import "./load-env.js";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";

type ClaimedExecution = {
  execution_id: string;
  enrollment_id?: string | null;
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

type HumanizedDispatchPlan = {
  action: "send_now" | "defer";
  humanized: boolean;
  dispatch_at: string;
  dispatch_meta: Record<string, unknown> | null;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

function renderExecutionMessage(execution: ClaimedExecution) {
  if (!execution.template) {
    throw new Error("Template do disparo nao encontrado");
  }

  return renderTemplate(execution.template, {
    nome: execution.lead_name ?? "",
    telefone: execution.phone ?? "",
    cidade: execution.city ?? "",
    status: execution.lead_status ?? "",
  });
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
  const pollMs = Number(process.env.AUTOMATION_WORKER_POLL_MS ?? 15000);
  const batchSize = Number(process.env.AUTOMATION_WORKER_BATCH_SIZE ?? 50);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "crm" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let running = false;

  async function saveOutboundMessage(execution: ClaimedExecution, content: string, sentAt: string) {
    const { error } = await supabase.from("message_history").insert({
      lead_id: execution.lead_id,
      aces_id: execution.aces_id,
      content,
      direction: "outbound",
      source_type: "automation",
      conversation_id: `automation:${execution.execution_id}`,
      instance: execution.instance_name,
      sent_at: sentAt,
    });

    if (error) {
      throw error;
    }
  }

  async function deferExecution(
    executionId: string,
    dispatchAt: string,
    dispatchMeta: Record<string, unknown> | null
  ) {
    const { error } = await supabase
      .from("automation_executions")
      .update({
        status: "pending",
        scheduled_at: dispatchAt,
        dispatch_meta: dispatchMeta,
        claimed_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", executionId)
      .eq("status", "processing");

    if (error) {
      throw error;
    }
  }

  async function planHumanizedDispatch(
    executionId: string,
    messageLength: number
  ): Promise<HumanizedDispatchPlan> {
    const { data, error } = await supabase.rpc("rpc_plan_humanized_dispatch", {
      p_execution_id: executionId,
      p_message_length: messageLength,
    });

    if (error) {
      throw error;
    }

    return data as HumanizedDispatchPlan;
  }

  async function markDispatchSent(executionId: string, sentAt: string) {
    const { error } = await supabase.rpc("rpc_mark_humanized_dispatch_sent", {
      p_execution_id: executionId,
      p_sent_at: sentAt,
    });

    if (error) {
      throw error;
    }
  }

  async function completeExecution(executionId: string, renderedMessage: string) {
    const { error } = await supabase.rpc("rpc_complete_automation_execution", {
      p_execution_id: executionId,
      p_rendered_message: renderedMessage,
    });

    if (error) {
      throw error;
    }
  }

  async function failExecution(executionId: string, reason: string) {
    const { error } = await supabase.rpc("rpc_fail_automation_execution", {
      p_execution_id: executionId,
      p_error: reason,
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
      while (true) {
        const { data, error } = await supabase.rpc("rpc_claim_due_automation_executions_v2", {
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
          try {
            if (!execution.instance_name) {
              throw new Error("Instancia de envio nao definida");
            }

            if (!execution.phone) {
              throw new Error("Lead sem telefone para disparo");
            }

            const renderedMessage = renderExecutionMessage(execution);
            const dispatchPlan = await planHumanizedDispatch(
              execution.execution_id,
              renderedMessage.length
            );

            if (dispatchPlan.action === "defer") {
              await deferExecution(
                execution.execution_id,
                dispatchPlan.dispatch_at,
                dispatchPlan.dispatch_meta
              );
              continue;
            }

            await sendWhatsAppMessage(
              evolutionApiUrl,
              evolutionApiKey,
              execution.instance_name,
              execution.phone,
              renderedMessage
            );

            const sentAt = new Date().toISOString();
            await saveOutboundMessage(execution, renderedMessage, sentAt);
            await markDispatchSent(execution.execution_id, sentAt);
            await completeExecution(execution.execution_id, renderedMessage);
          } catch (error: any) {
            console.error(`[automation-worker] Falha ao processar execucao ${execution.execution_id}:`, error);

            try {
              await failExecution(
                execution.execution_id,
                error instanceof Error ? error.message : "Falha no disparo automatizado"
              );
            } catch (failError) {
              console.error(
                `[automation-worker] Falha adicional ao marcar execucao ${execution.execution_id} como erro:`,
                failError
              );
            }
          }
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
    console.error("[automation-worker] Erro na execucao inicial:", error);
  });

  console.log(
    `[automation-worker] Rodando a cada ${pollMs}ms com lote maximo de ${batchSize} execucoes`
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
