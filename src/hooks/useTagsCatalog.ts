import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export interface TagsCatalogItem {
  id: string;
  name: string;
  urgencia: number | null;
}

const EMPTY_TAGS: TagsCatalogItem[] = [];

async function fetchTagsCatalog() {
  const { data, error } = await supabase.from("tags").select("id, name, urgencia").order("name");

  if (error) {
    throw error;
  }

  return (data ?? []) as TagsCatalogItem[];
}

export function useTagsCatalog(enabled = true) {
  const tagsQuery = useQuery({
    queryKey: ["tags", "catalog"],
    queryFn: fetchTagsCatalog,
    enabled,
    staleTime: 60_000,
  });

  const tags = tagsQuery.data ?? EMPTY_TAGS;
  const tagsById = useMemo(() => Object.fromEntries(tags.map((tag) => [tag.id, tag.name])), [tags]);
  const tagMetaById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);

  return {
    tags,
    tagsById,
    tagMetaById,
    loading: tagsQuery.isLoading,
    error: tagsQuery.error,
    refetch: tagsQuery.refetch,
  };
}
