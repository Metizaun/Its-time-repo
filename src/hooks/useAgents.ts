import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { AIAgent } from "@/types";
import {
  deleteCrmBackend,
  getCrmBackend,
  patchCrmBackend,
  postCrmBackend,
} from "@/services/crmBackend";

interface AgentPayload {
  name: string;
  instance_name: string;
  system_prompt: string;
  model: string;
  is_active: boolean;
  temperature: number;
  buffer_wait_ms?: number;
  human_pause_minutes?: number;
  handoff_enabled?: boolean;
  handoff_prompt?: string | null;
  handoff_target_phone?: string | null;
  templateKey?: string | null;
}

function errorDetails(err: unknown) {
  return typeof err === "object" && err !== null
    ? (err as Record<string, unknown>)
    : {};
}

function errorMessage(err: unknown, fallback: string) {
  const message = errorDetails(err).message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

function buildAgentSaveError(err: unknown, instanceName?: string) {
  const detailsRecord = errorDetails(err);
  const code = String(detailsRecord.code ?? "");
  const constraint = String(detailsRecord.constraint ?? "").toLowerCase();
  const details = String(detailsRecord.details ?? "").toLowerCase();
  const message = String(detailsRecord.message ?? "");
  const normalizedMessage = message.toLowerCase();
  const instanceLabel = instanceName ? ` "${instanceName}"` : "";

  if (
    code === "23505" ||
    constraint.includes("ai_agents_account_instance_unique") ||
    normalizedMessage.includes("duplicate key")
  ) {
    return new Error(
      `A instância${instanceLabel} já possui um agente vinculado. Edite o agente existente em vez de criar outro.`
    );
  }

  if (code === "23503") {
    if (
      details.includes("created_by") ||
      normalizedMessage.includes("created_by") ||
      details.includes("crm.users") ||
      normalizedMessage.includes("crm.users")
    ) {
      return new Error(
        "Seu vínculo de usuário com o CRM parece desatualizado. Saia e entre novamente. Se o problema continuar, re-sincronize esse usuário no painel Admin."
      );
    }

    if (
      details.includes("instance_name") ||
      normalizedMessage.includes("instance_name") ||
      details.includes("crm.instance") ||
      normalizedMessage.includes("crm.instance")
    ) {
      return new Error(
        `A instância${instanceLabel} não está disponível para esta conta. Atualize a página e tente novamente.`
      );
    }
  }

  return new Error(message || "Não foi possível salvar o agente.");
}

export function useAgents() {
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusAgentId, setStatusAgentId] = useState<string | null>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await getCrmBackend<{ agents?: AIAgent[] }>("/api/ai-agents");
      setAgents(response.agents ?? []);
    } catch (err: unknown) {
      const message = errorMessage(err, "Nao foi possivel carregar os agentes.");
      console.error("Erro ao carregar agentes:", err);
      setError(message);
      toast.error("Erro ao carregar agentes", { description: message });
    } finally {
      setLoading(false);
    }
  }, []);

  const findConflictingAgent = useCallback(
    async (instanceName: string, currentAgentId?: string) =>
      agents.find(
        (agent) => agent.instance_name === instanceName && agent.id !== currentAgentId
      ) ?? null,
    [agents]
  );

  const upsertAgent = useCallback(
    async (payload: AgentPayload, agentId?: string) => {
      try {
        setSaving(true);

        const conflictingAgent = await findConflictingAgent(payload.instance_name, agentId);
        if (conflictingAgent) {
          throw new Error(
            `A instância "${payload.instance_name}" já está vinculada ao agente "${conflictingAgent.name}".`
          );
        }

        if (agentId) {
          // Edição
          await patchCrmBackend(`/api/ai-agents/${encodeURIComponent(agentId)}`, {
            name: payload.name,
            instanceName: payload.instance_name,
            systemPrompt: payload.system_prompt,
            model: payload.model,
            isActive: payload.is_active,
            temperature: payload.temperature,
            bufferWaitMs: payload.buffer_wait_ms,
            humanPauseMinutes: payload.human_pause_minutes,
            handoffEnabled: payload.handoff_enabled,
            handoffPrompt: payload.handoff_prompt,
            handoffTargetPhone: payload.handoff_target_phone,
          });
          toast.success("Agente atualizado com sucesso");
        } else {
          // Criação
          await postCrmBackend("/api/ai-agents", {
            name: payload.name,
            instanceName: payload.instance_name,
            systemPrompt: payload.system_prompt,
            model: payload.model,
            isActive: payload.is_active,
            temperature: payload.temperature,
            bufferWaitMs: payload.buffer_wait_ms,
            humanPauseMinutes: payload.human_pause_minutes,
            handoffEnabled: payload.handoff_enabled,
            handoffPrompt: payload.handoff_prompt,
            handoffTargetPhone: payload.handoff_target_phone,
            templateKey: payload.templateKey || undefined,
          });
          toast.success("Agente criado com sucesso");
        }

        await fetchAgents();
      } catch (err: unknown) {
        const friendlyError = buildAgentSaveError(err, payload.instance_name);
        console.error("Erro ao salvar agente:", err);
        toast.error("Erro ao salvar agente", { description: friendlyError.message });
        throw friendlyError;
      } finally {
        setSaving(false);
      }
    },
    [fetchAgents, findConflictingAgent]
  );

  const toggleAgentStatus = useCallback(
    async (agentId: string, isActive: boolean) => {
      try {
        setStatusAgentId(agentId);

        await patchCrmBackend(`/api/ai-agents/${encodeURIComponent(agentId)}`, {
          isActive,
        });

        // Optimistic update
        setAgents((prev) =>
          prev.map((a) => (a.id === agentId ? { ...a, is_active: isActive } : a))
        );

        toast.success(isActive ? "Agente ativado" : "Agente pausado");
      } catch (err: unknown) {
        const message = errorMessage(err, "Nao foi possivel alterar o status do agente.");
        console.error("Erro ao alterar status do agente:", err);
        toast.error("Erro ao alterar status", { description: message });
        // Reverte em caso de falha
        await fetchAgents();
      } finally {
        setStatusAgentId(null);
      }
    },
    [fetchAgents]
  );

  const deleteAgent = useCallback(
    async (agentId: string, agentName?: string) => {
      try {
        setDeletingAgentId(agentId);

        await deleteCrmBackend(`/api/ai-agents/${encodeURIComponent(agentId)}`);

        setAgents((prev) => prev.filter((agent) => agent.id !== agentId));
        toast.success("Agente apagado com sucesso", {
          description: agentName ? `${agentName} foi removido.` : undefined,
        });
      } catch (err: unknown) {
        const message = errorMessage(err, "Nao foi possivel apagar o agente.");
        console.error("Erro ao apagar agente:", err);
        toast.error("Erro ao apagar agente", {
          description: message,
        });
        await fetchAgents();
        throw err;
      } finally {
        setDeletingAgentId(null);
      }
    },
    [fetchAgents]
  );

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return {
    agents,
    loading,
    saving,
    statusAgentId,
    deletingAgentId,
    error,
    refetch: fetchAgents,
    upsertAgent,
    toggleAgentStatus,
    deleteAgent,
  };
}
