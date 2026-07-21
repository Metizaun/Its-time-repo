import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getCrmBackend } from "@/services/crmBackend";
import type { Pipeline } from "@/types";

const PIPELINES_UPDATED_EVENT = "pipelines-updated";

type CrmProfileResponse = {
  profile?: {
    aces_id: number;
  };
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado";
}

function normalizePipeline(row: Record<string, unknown>): Pipeline {
  return {
    id: String(row.id),
    aces_id: Number(row.aces_id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    classifier_key: String(row.classifier_key ?? "crm_pipeline_classifier"),
    is_default: Boolean(row.is_default),
    is_active: Boolean(row.is_active),
    ai_reply_enabled: row.ai_reply_enabled !== false,
    ai_classification_enabled: row.ai_classification_enabled !== false,
    classification_auto_apply_threshold: Number(row.classification_auto_apply_threshold ?? 0.85),
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export function notifyPipelinesUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PIPELINES_UPDATED_EVENT));
  }
}

export function usePipelines() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const { session } = useAuth();
  const isAuthenticated = Boolean(session);

  const fetchCurrentAcesId = useCallback(async () => {
    const { profile } = await getCrmBackend<CrmProfileResponse>("/api/crm/profile");
    return profile?.aces_id ?? null;
  }, []);

  const fetchPipelines = useCallback(async () => {
    if (!isAuthenticated) {
      setPipelines([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const acesId = await fetchCurrentAcesId();
      if (!acesId) {
        setPipelines([]);
        return;
      }

      const { data, error } = await supabase
        .from("pipelines")
        .select("*")
        .eq("aces_id", acesId)
        .eq("is_active", true)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: true });

      if (error) throw error;
      setPipelines((data ?? []).map((row) => normalizePipeline(row as Record<string, unknown>)));
    } catch (error: unknown) {
      console.error("Erro ao carregar pipelines:", error);
      toast.error("Erro ao carregar pipelines", { description: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [fetchCurrentAcesId, isAuthenticated]);

  useEffect(() => {
    fetchPipelines();

    if (!isAuthenticated) return;

    const channel = supabase
      .channel("pipelines-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "crm",
          table: "pipelines",
        },
        () => {
          fetchPipelines();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void fetchPipelines();
      });

    const handleResume = () => {
      if (document.visibilityState === "visible") void fetchPipelines();
    };
    window.addEventListener("focus", handleResume);
    document.addEventListener("visibilitychange", handleResume);

    return () => {
      window.removeEventListener("focus", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
      void supabase.removeChannel(channel);
    };
  }, [fetchPipelines, isAuthenticated]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleUpdated = () => fetchPipelines();
    window.addEventListener(PIPELINES_UPDATED_EVENT, handleUpdated);
    return () => window.removeEventListener(PIPELINES_UPDATED_EVENT, handleUpdated);
  }, [fetchPipelines]);

  const createPipeline = async (input: { name: string; description?: string }) => {
    const name = input.name.trim();
    if (!name) {
      const error = new Error("Informe o nome do pipeline.");
      toast.error(error.message);
      return { data: null, error };
    }

    try {
      const { data, error } = await supabase.rpc("rpc_create_pipeline", {
        p_name: name,
        p_description: input.description?.trim() ?? "",
        p_ai_classification_enabled: true,
      });

      if (error) throw error;

      const pipeline = normalizePipeline(data as Record<string, unknown>);
      setPipelines((previous) => [...previous, pipeline]);
      notifyPipelinesUpdated();
      toast.success("Pipeline criado com sucesso");
      return { data: pipeline, error: null };
    } catch (error: unknown) {
      console.error("Erro ao criar pipeline:", error);
      toast.error("Erro ao criar pipeline", { description: getErrorMessage(error) });
      return { data: null, error };
    }
  };

  const updatePipelineClassification = async (pipelineId: string, enabled: boolean) => {
    const previous = pipelines;
    setPipelines((current) =>
      current.map((pipeline) =>
        pipeline.id === pipelineId
          ? { ...pipeline, ai_classification_enabled: enabled }
          : pipeline
      )
    );

    try {
      const { error } = await supabase.rpc("rpc_set_pipeline_classification", {
        p_pipeline_id: pipelineId,
        p_enabled: enabled,
      });
      if (error) throw error;
      notifyPipelinesUpdated();
      toast.success(enabled ? "Classificacao automatica ativada" : "Controle manual ativado");
      return { error: null };
    } catch (error: unknown) {
      setPipelines(previous);
      toast.error("Nao foi possivel alterar a classificacao", { description: getErrorMessage(error) });
      return { error };
    }
  };

  return {
    pipelines,
    loading,
    refetch: fetchPipelines,
    createPipeline,
    updatePipelineClassification,
  };
}
