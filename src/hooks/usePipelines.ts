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

function normalizePipeline(row: Record<string, unknown>): Pipeline {
  return {
    id: String(row.id),
    aces_id: Number(row.aces_id),
    name: String(row.name ?? ""),
    description: String(row.description ?? ""),
    classifier_key: String(row.classifier_key ?? "crm_pipeline_classifier"),
    is_default: Boolean(row.is_default),
    is_active: Boolean(row.is_active),
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
    } catch (error: any) {
      console.error("Erro ao carregar pipelines:", error);
      toast.error("Erro ao carregar pipelines", { description: error.message });
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
      const acesId = await fetchCurrentAcesId();
      if (!acesId) throw new Error("Nao foi possivel encontrar a empresa do usuario logado.");

      const { data, error } = await supabase
        .from("pipelines")
        .insert({
          aces_id: acesId,
          name,
          description: input.description?.trim() ?? "",
          classifier_key: "crm_pipeline_classifier",
          is_default: false,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;

      const pipeline = normalizePipeline(data as Record<string, unknown>);
      setPipelines((previous) => [...previous, pipeline]);
      notifyPipelinesUpdated();
      toast.success("Pipeline criado com sucesso");
      return { data: pipeline, error: null };
    } catch (error: any) {
      console.error("Erro ao criar pipeline:", error);
      toast.error("Erro ao criar pipeline", { description: error.message });
      return { data: null, error };
    }
  };

  return {
    pipelines,
    loading,
    refetch: fetchPipelines,
    createPipeline,
  };
}
