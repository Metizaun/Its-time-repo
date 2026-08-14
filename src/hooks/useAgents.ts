import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { AIAgent } from "@/types";
import {
  CrmBackendError,
  deleteCrmBackend,
  getCrmBackend,
  patchCrmBackend,
  postCrmBackend,
} from "@/services/crmBackend";

interface AgentPayload {
  name: string;
  instance_name: string | null;
  agent_type?: AIAgent["agent_type"];
  parent_agent_id?: string | null;
  agent_key?: string | null;
  routing_instruction?: string | null;
  system_prompt: string;
  model: string;
  is_active: boolean;
  temperature?: number;
  personality_profile: AIAgent["personality_profile"];
  buffer_wait_ms?: number;
  human_pause_minutes?: number;
  handoff_enabled?: boolean;
  handoff_prompt?: string | null;
  handoff_target_phone?: string | null;
  templateKey?: string | null;
}

export type AgentInstanceChangePolicy = "humanize" | "deactivate";

export interface AgentInstanceChangeResult {
  sourceInstance: string;
  destinationInstance: string;
  affectedLeadCount: number;
  policy: AgentInstanceChangePolicy | null;
  agentIsActive: boolean;
}

interface AgentSaveResponse {
  agent: AIAgent;
  instanceChange: AgentInstanceChangeResult | null;
}

export class AgentInstanceChangeRequiredError extends Error {
  constructor(
    public readonly sourceInstance: string,
    public readonly destinationInstance: string,
    public readonly affectedLeadCount: number,
  ) {
    super("A troca de instância exige uma decisão para os leads em modo IA.");
    this.name = "AgentInstanceChangeRequiredError";
  }
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

function backendDetails(err: unknown) {
  return errorDetails(errorDetails(err).details);
}

function buildAgentSaveError(err: unknown, instanceName?: string | null) {
  const detailsRecord = errorDetails(err);
  const backendDetailRecord = backendDetails(err);
  const code = String(backendDetailRecord.code ?? detailsRecord.code ?? "");
  const constraint = String(detailsRecord.constraint ?? "").toLowerCase();
  const details = String(detailsRecord.details ?? "").toLowerCase();
  const message = String(detailsRecord.message ?? "");
  const normalizedMessage = message.toLowerCase();
  const instanceLabel = instanceName ? ` "${instanceName}"` : "";

  if (code === "AGENT_INSTANCE_OCCUPIED") {
    return new Error(
      `A instância${instanceLabel} já possui um agente principal. Escolha outra instância.`
    );
  }

  if (code === "AGENT_INSTANCE_OUTSIDE_ACCOUNT") {
    return new Error("A instância selecionada não pertence a esta conta.");
  }

  if (code === "AGENT_INSTANCE_NOT_FOUND") {
    return new Error("A instância selecionada não foi encontrada. Atualize a página e tente novamente.");
  }

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
    async (instanceName: string | null, currentAgentId?: string) =>
      !instanceName ? null :
      agents.find(
        (agent) => agent.agent_type === "primary" && agent.instance_name === instanceName && agent.id !== currentAgentId
      ) ?? null,
    [agents]
  );

  const upsertAgent = useCallback(
    async (
      payload: AgentPayload,
      agentId?: string,
      instanceChangePolicy?: AgentInstanceChangePolicy,
    ): Promise<AgentSaveResponse> => {
      try {
        setSaving(true);

        const conflictingAgent = payload.agent_type === "subagent"
          ? null
          : await findConflictingAgent(payload.instance_name, agentId);
        if (conflictingAgent) {
          throw new Error(
            `A instância "${payload.instance_name}" já está vinculada ao agente "${conflictingAgent.name}".`
          );
        }

        if (agentId) {
          // Edição
          const response = await patchCrmBackend<AgentSaveResponse>(`/api/ai-agents/${encodeURIComponent(agentId)}`, {
            name: payload.name,
            instanceName: payload.instance_name,
            routingInstruction: payload.routing_instruction,
            systemPrompt: payload.system_prompt,
            model: payload.model,
            isActive: payload.is_active,
            temperature: payload.temperature,
            personalityProfile: payload.personality_profile,
            bufferWaitMs: payload.buffer_wait_ms,
            humanPauseMinutes: payload.human_pause_minutes,
            handoffEnabled: payload.handoff_enabled,
            handoffPrompt: payload.handoff_prompt,
            handoffTargetPhone: payload.handoff_target_phone,
            instanceChangePolicy,
          });
          toast.success("Agente atualizado com sucesso");
          await fetchAgents();
          return response;
        } else {
          // Criação
          const response = await postCrmBackend<{ agent: AIAgent }>("/api/ai-agents", {
            name: payload.name,
            instanceName: payload.instance_name,
            agentType: payload.agent_type ?? "primary",
            parentAgentId: payload.parent_agent_id,
            agentKey: payload.agent_key,
            routingInstruction: payload.routing_instruction,
            systemPrompt: payload.system_prompt,
            model: payload.model,
            isActive: payload.is_active,
            temperature: payload.temperature,
            personalityProfile: payload.personality_profile,
            bufferWaitMs: payload.buffer_wait_ms,
            humanPauseMinutes: payload.human_pause_minutes,
            handoffEnabled: payload.handoff_enabled,
            handoffPrompt: payload.handoff_prompt,
            handoffTargetPhone: payload.handoff_target_phone,
            templateKey: payload.templateKey || undefined,
          });
          toast.success("Agente criado com sucesso");
          await fetchAgents();
          return { agent: response.agent, instanceChange: null };
        }
      } catch (err: unknown) {
        const details = backendDetails(err);
        if (
          err instanceof CrmBackendError
          && details.code === "AGENT_INSTANCE_CHANGE_REQUIRES_DECISION"
        ) {
          throw new AgentInstanceChangeRequiredError(
            String(details.sourceInstance ?? payload.instance_name ?? ""),
            String(details.destinationInstance ?? payload.instance_name ?? ""),
            Number(details.affectedLeadCount ?? 0),
          );
        }
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
