import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PipelineStage } from "@/types";
import { useAuth } from "@/contexts/AuthContext";
import { notifyLeadsUpdated } from "./useLeads";

const PIPELINE_STAGES_UPDATED_EVENT = "pipeline-stages-updated";
const MAX_FUNNEL_STAGES = 5;

export function usePipelineStages() {
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [loading, setLoading] = useState(true);
  const { session } = useAuth();
  const isAuthenticated = !!session;

  const notifyStagesUpdated = useCallback(() => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(PIPELINE_STAGES_UPDATED_EVENT));
    }
  }, []);

  const fetchStages = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("aces_id")
        .eq("auth_user_id", session?.user?.id)
        .maybeSingle();

      if (userError) {
        throw userError;
      }

      if (!userData?.aces_id) {
        setStages([]);
        return;
      }

      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("aces_id", userData.aces_id)
        .order("position", { ascending: true });

      if (error) throw error;
      setStages(data || []);
    } catch (error: any) {
      console.error("Erro ao carregar etapas do pipeline:", error);
      toast.error("Erro ao carregar etapas do pipeline");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, session?.user?.id]);

  useEffect(() => {
    fetchStages();

    if (!isAuthenticated) return;

    const channel = supabase
      .channel("pipeline-stages-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "Crm",
          table: "pipeline_stages",
        },
        () => {
          fetchStages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchStages, isAuthenticated]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleStagesUpdated = () => {
      fetchStages();
    };

    window.addEventListener(PIPELINE_STAGES_UPDATED_EVENT, handleStagesUpdated);
    return () => {
      window.removeEventListener(PIPELINE_STAGES_UPDATED_EVENT, handleStagesUpdated);
    };
  }, [fetchStages]);

  const createStage = async (stageData: { name: string; color: string; category: PipelineStage["category"] }) => {
    try {
      const maxPosition = stages.length > 0 ? Math.max(...stages.map((s) => s.position)) : -1;

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("aces_id")
        .eq("auth_user_id", session?.user?.id)
        .single();

      if (userError || !userData) throw new Error("Nao foi possivel encontrar a empresa do usuario logado.");

      const { data, error } = await supabase
        .from("pipeline_stages")
        .insert({
          name: stageData.name,
          color: stageData.color,
          category: stageData.category,
          position: maxPosition + 1,
          aces_id: userData.aces_id,
          is_funnel_stage: false,
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setStages((prev) => [...prev, data].sort((a, b) => a.position - b.position));
      }

      notifyStagesUpdated();
      toast.success("Etapa criada com sucesso!");
      return { data, error: null };
    } catch (error: any) {
      console.error("Erro ao criar etapa:", error);
      toast.error("Erro ao criar etapa", { description: error.message });
      return { data: null, error };
    }
  };

  const updateStage = async (id: string, updates: Partial<PipelineStage>) => {
    try {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setStages((prev) => prev.map((stage) => (stage.id === id ? data : stage)));
      }

      notifyStagesUpdated();
      toast.success("Etapa atualizada!");
      return { data, error: null };
    } catch (error: any) {
      console.error("Erro ao atualizar etapa:", error);
      toast.error("Erro ao atualizar etapa", { description: error.message });
      return { data: null, error };
    }
  };

  const deleteStage = async (id: string, migrateToStageId?: string) => {
    try {
      if (migrateToStageId === id) {
        throw new Error("A etapa de destino deve ser diferente da etapa excluida.");
      }

      const { count: leadsInStageCount, error: countError } = await supabase
        .from("leads")
        .select("id", { head: true, count: "exact" })
        .eq("stage_id", id)
        .eq("view", true);

      if (countError) throw countError;

      if ((leadsInStageCount || 0) > 0 && !migrateToStageId) {
        throw new Error("Esta etapa possui leads. Selecione uma etapa de destino para migrar.");
      }

      if ((leadsInStageCount || 0) > 0 && migrateToStageId) {
        const { error: moveError } = await supabase
          .from("leads")
          .update({ stage_id: migrateToStageId })
          .eq("stage_id", id)
          .eq("view", true);
        if (moveError) throw moveError;
        notifyLeadsUpdated();
      }

      const { error } = await supabase.from("pipeline_stages").delete().eq("id", id);

      if (error) throw error;

      setStages((prev) => prev.filter((stage) => stage.id !== id));
      notifyStagesUpdated();
      toast.success("Etapa excluida com sucesso!");
      return { error: null };
    } catch (error: any) {
      console.error("Erro ao excluir etapa:", error);
      toast.error("Erro ao excluir etapa", { description: error.message });
      return { error };
    }
  };

  const reorderStages = async (reorderedStages: PipelineStage[]) => {
    try {
      setStages(reorderedStages);

      const promises = reorderedStages.map((stage, index) =>
        supabase.from("pipeline_stages").update({ position: index }).eq("id", stage.id)
      );

      const results = await Promise.all(promises);
      const firstError = results.find((result) => result.error);
      if (firstError?.error) throw firstError.error;

      await fetchStages();
      notifyStagesUpdated();
      return { error: null };
    } catch (error: any) {
      console.error("Erro ao reordenar etapas:", error);
      toast.error("Erro ao reordenar etapas");
      fetchStages();
      return { error };
    }
  };

  const toggleFunnelStage = async (stageId: string, isEnabled: boolean) => {
    const stage = stages.find((currentStage) => currentStage.id === stageId);

    if (!stage) {
      const error = new Error("Etapa do pipeline nao encontrada.");
      toast.error(error.message);
      return { data: null, error, limitReached: false };
    }

    if (stage.is_funnel_stage === isEnabled) {
      return { data: stage, error: null, limitReached: false };
    }

    if (isEnabled) {
      const selectedCount = stages.filter((currentStage) => currentStage.is_funnel_stage).length;

      if (selectedCount >= MAX_FUNNEL_STAGES) {
        const error = new Error("Voce pode selecionar no maximo 5 etapas no funil.");
        toast.error(error.message);
        return { data: null, error, limitReached: true };
      }
    }

    try {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .update({ is_funnel_stage: isEnabled })
        .eq("id", stageId)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setStages((previousStages) =>
          previousStages
            .map((currentStage) => (currentStage.id === stageId ? data : currentStage))
            .sort((left, right) => left.position - right.position)
        );
      }

      notifyStagesUpdated();
      return { data, error: null, limitReached: false };
    } catch (error: any) {
      const message =
        typeof error?.message === "string" ? error.message : "Erro ao atualizar selecao do funil.";
      const limitReached = message.toLowerCase().includes("maximum of 5 funnel stages");

      if (limitReached) {
        toast.error("Voce pode selecionar no maximo 5 etapas no funil.");
      } else {
        toast.error("Erro ao atualizar selecao do funil", { description: message });
      }

      return { data: null, error, limitReached };
    }
  };

  return {
    stages,
    loading,
    refetch: fetchStages,
    createStage,
    updateStage,
    deleteStage,
    reorderStages,
    toggleFunnelStage,
  };
}
