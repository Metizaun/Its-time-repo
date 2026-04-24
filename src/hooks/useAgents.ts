import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AIAgent } from "@/types";

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
}

function buildAgentSaveError(err: any, instanceName?: string) {
  const code = String(err?.code ?? "");
  const constraint = String(err?.constraint ?? "").toLowerCase();
  const details = String(err?.details ?? "").toLowerCase();
  const message = String(err?.message ?? "");
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

      const { data, error: fetchError } = await supabase
        .from("ai_agents")
        .select("*")
        .order("created_at", { ascending: true });

      if (fetchError) throw fetchError;

      setAgents((data as AIAgent[]) || []);
    } catch (err: any) {
      console.error("Erro ao carregar agentes:", err);
      setError(err.message);
      toast.error("Erro ao carregar agentes", { description: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  const findConflictingAgent = useCallback(async (instanceName: string, currentAgentId?: string) => {
    let query = supabase
      .from("ai_agents")
      .select("id, name, instance_name")
      .eq("instance_name", instanceName);

    if (currentAgentId) {
      query = query.neq("id", currentAgentId);
    }

    const { data, error: lookupError } = await query.maybeSingle();

    if (lookupError) throw lookupError;

    return data;
  }, []);

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
          const { error: updateError } = await supabase
            .from("ai_agents")
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq("id", agentId);

          if (updateError) throw updateError;
          toast.success("Agente atualizado com sucesso");
        } else {
          // Criação
          const { error: insertError } = await supabase
            .from("ai_agents")
            .insert({ ...payload, provider: "gemini" });

          if (insertError) throw insertError;
          toast.success("Agente criado com sucesso");
        }

        await fetchAgents();
      } catch (err: any) {
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

        const { error: toggleError } = await supabase
          .from("ai_agents")
          .update({ is_active: isActive, updated_at: new Date().toISOString() })
          .eq("id", agentId);

        if (toggleError) throw toggleError;

        // Optimistic update
        setAgents((prev) =>
          prev.map((a) => (a.id === agentId ? { ...a, is_active: isActive } : a))
        );

        toast.success(isActive ? "Agente ativado" : "Agente pausado");
      } catch (err: any) {
        console.error("Erro ao alterar status do agente:", err);
        toast.error("Erro ao alterar status", { description: err.message });
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

        const { error: deleteError } = await supabase
          .from("ai_agents")
          .delete()
          .eq("id", agentId);

        if (deleteError) throw deleteError;

        setAgents((prev) => prev.filter((agent) => agent.id !== agentId));
        toast.success("Agente apagado com sucesso", {
          description: agentName ? `${agentName} foi removido.` : undefined,
        });
      } catch (err: any) {
        console.error("Erro ao apagar agente:", err);
        toast.error("Erro ao apagar agente", {
          description: err.message || "Não foi possível apagar o agente.",
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
