import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  AUTOMATION_ANCHOR_EVENT_OPTIONS,
  AUTOMATION_PREDICATE_CATALOG,
  AUTOMATION_REENTRY_MODE_OPTIONS,
  NO_LEAD_SOURCE_VALUE,
  type AutomationLeadSourceOption,
  type AutomationOwnerOption,
  type AutomationTagOption,
} from "@/lib/automation";

const EMPTY_OWNERS: AutomationOwnerOption[] = [];
const EMPTY_TAGS: AutomationTagOption[] = [];
const EMPTY_LEAD_SOURCES: AutomationLeadSourceOption[] = [];

async function fetchLeadSources() {
  const PAGE_SIZE = 1000;
  const DETAILS_CHUNK_SIZE = 200;
  const sourceCounts = new Map<string, number>();
  const visibleIds: string[] = [];
  let page = 0;

  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from("leads")
      .select("id")
      .eq("view", true)
      .range(from, to);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    visibleIds.push(
      ...data
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );

    if (data.length < PAGE_SIZE) {
      break;
    }

    page += 1;
  }

  for (let index = 0; index < visibleIds.length; index += DETAILS_CHUNK_SIZE) {
    const chunk = visibleIds.slice(index, index + DETAILS_CHUNK_SIZE);
    const { data, error } = await supabase
      .from("v_lead_details")
      .select("source")
      .in("id", chunk);

    if (error) {
      throw error;
    }

    for (const row of data ?? []) {
      const source = typeof row.source === "string" ? row.source.trim() : "";
      const key = source || NO_LEAD_SOURCE_VALUE;
      sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + 1);
    }
  }

  if (!sourceCounts.has(NO_LEAD_SOURCE_VALUE)) {
    sourceCounts.set(NO_LEAD_SOURCE_VALUE, 0);
  }

  return Array.from(sourceCounts.entries())
    .map(([value, count]) => ({
      value,
      label: value === NO_LEAD_SOURCE_VALUE ? "Sem origem" : value,
      count,
    }))
    .filter((source) => source.value === NO_LEAD_SOURCE_VALUE || source.value.trim().length > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "pt-BR"));
}

async function fetchAutomationCatalog() {
  const [
    { data: owners, error: ownersError },
    { data: tags, error: tagsError },
    leadSources,
  ] = await Promise.all([
    supabase.from("users").select("id, name").order("name"),
    supabase.from("tags").select("id, name, urgencia").order("name"),
    fetchLeadSources(),
  ]);

  if (ownersError) {
    throw ownersError;
  }

  if (tagsError) {
    throw tagsError;
  }

  return {
    owners: (owners ?? []) as AutomationOwnerOption[],
    tags: (tags ?? []) as AutomationTagOption[],
    leadSources,
  };
}

export function useAutomationCatalog(enabled = true) {
  const catalogQuery = useQuery({
    queryKey: ["automation", "catalog"],
    queryFn: fetchAutomationCatalog,
    enabled,
    staleTime: 60_000,
  });

  const owners = catalogQuery.data?.owners ?? EMPTY_OWNERS;
  const tags = catalogQuery.data?.tags ?? EMPTY_TAGS;
  const leadSources = catalogQuery.data?.leadSources ?? EMPTY_LEAD_SOURCES;

  const ownersById = useMemo(
    () => Object.fromEntries(owners.map((owner) => [owner.id, owner.name])),
    [owners],
  );

  const tagsById = useMemo(
    () => Object.fromEntries(tags.map((tag) => [tag.id, tag.name])),
    [tags],
  );

  return {
    predicateCatalog: AUTOMATION_PREDICATE_CATALOG,
    anchorEventOptions: AUTOMATION_ANCHOR_EVENT_OPTIONS,
    reentryModeOptions: AUTOMATION_REENTRY_MODE_OPTIONS,
    owners,
    tags,
    leadSources,
    ownersById,
    tagsById,
    loading: catalogQuery.isLoading,
    error: catalogQuery.error,
    refetch: catalogQuery.refetch,
  };
}
