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
}

export function useAgents() {
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  const upsertAgent = useCallback(
    async (payload: AgentPayload, agentId?: string) => {
      try {
        setSaving(true);

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
        console.error("Erro ao salvar agente:", err);
        toast.error("Erro ao salvar agente", { description: err.message });
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [fetchAgents]
  );

  const toggleAgentStatus = useCallback(
    async (agentId: string, isActive: boolean) => {
      try {
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
    error,
    refetch: fetchAgents,
    upsertAgent,
    toggleAgentStatus,
  };
}
