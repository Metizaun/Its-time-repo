import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { notifyLeadsUpdated } from "@/hooks/useLeads";
import { useTagsCatalog, type TagsCatalogItem } from "@/hooks/useTagsCatalog";

export interface LeadTag extends TagsCatalogItem {
  created_at: string | null;
}

type LeadTagRow = {
  tag_id: string;
  tag_name: string | null;
  created_at: string | null;
};

const EMPTY_LEAD_TAGS: LeadTag[] = [];

async function fetchLeadTagRows(leadId: string) {
  const { data, error } = await supabase
    .from("lead_tags")
    .select("tag_id, tag_name, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as LeadTagRow[];
}

export function useLeadTags(leadId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  const tagsCatalog = useTagsCatalog(enabled);

  const leadTagsQuery = useQuery({
    queryKey: ["lead-tags", leadId],
    queryFn: () => fetchLeadTagRows(leadId!),
    enabled: enabled && Boolean(leadId),
  });

  const leadTags = useMemo(() => {
    if (!leadId) {
      return EMPTY_LEAD_TAGS;
    }

    return (leadTagsQuery.data ?? []).map((row) => {
      const catalogTag = tagsCatalog.tagMetaById.get(row.tag_id);

      return {
        id: row.tag_id,
        name: catalogTag?.name ?? row.tag_name ?? "Tag",
        urgencia: catalogTag?.urgencia ?? null,
        usage_description: catalogTag?.usage_description ?? null,
        created_at: row.created_at,
      };
    });
  }, [leadId, leadTagsQuery.data, tagsCatalog.tagMetaById]);

  const selectedTagIds = useMemo(() => new Set(leadTags.map((tag) => tag.id)), [leadTags]);

  const invalidateLeadTags = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lead-tags", leadId] }),
      queryClient.invalidateQueries({ queryKey: ["tags", "catalog"] }),
    ]);
    notifyLeadsUpdated();
  };

  const addTagMutation = useMutation({
    mutationFn: async (tagId: string) => {
      if (!leadId) {
        throw new Error("Lead nao selecionado");
      }

      const { error } = await supabase
        .from("lead_tags")
        .upsert(
          { lead_id: leadId, tag_id: tagId },
          { onConflict: "lead_id,tag_id", ignoreDuplicates: true }
        );

      if (error) {
        throw error;
      }
    },
    onSuccess: invalidateLeadTags,
  });

  const removeTagMutation = useMutation({
    mutationFn: async (tagId: string) => {
      if (!leadId) {
        throw new Error("Lead nao selecionado");
      }

      const { error } = await supabase.from("lead_tags").delete().eq("lead_id", leadId).eq("tag_id", tagId);

      if (error) {
        throw error;
      }
    },
    onSuccess: invalidateLeadTags,
  });

  const deleteTagMutation = useMutation({
    mutationFn: async (tagId: string) => {
      const { error } = await supabase.from("tags").delete().eq("id", tagId);

      if (error) {
        throw error;
      }
    },
    onSuccess: invalidateLeadTags,
  });

  return {
    leadTags,
    selectedTagIds,
    availableTags: tagsCatalog.tags,
    loading: leadTagsQuery.isLoading || tagsCatalog.loading,
    error: leadTagsQuery.error ?? tagsCatalog.error,
    refetch: leadTagsQuery.refetch,
    addTag: addTagMutation.mutateAsync,
    removeTag: removeTagMutation.mutateAsync,
    deleteTag: deleteTagMutation.mutateAsync,
    saving: addTagMutation.isPending || removeTagMutation.isPending || deleteTagMutation.isPending,
  };
}
