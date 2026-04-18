import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import {
  AUTOMATION_ANCHOR_EVENT_OPTIONS,
  AUTOMATION_PREDICATE_CATALOG,
  AUTOMATION_REENTRY_MODE_OPTIONS,
  type AutomationOwnerOption,
  type AutomationTagOption,
} from "@/lib/automation";

const EMPTY_OWNERS: AutomationOwnerOption[] = [];
const EMPTY_TAGS: AutomationTagOption[] = [];

async function fetchAutomationCatalog() {
  const [{ data: owners, error: ownersError }, { data: tags, error: tagsError }] = await Promise.all([
    supabase.from("users").select("id, name").order("name"),
    supabase.from("tags").select("id, name, urgencia").order("name"),
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
    ownersById,
    tagsById,
    loading: catalogQuery.isLoading,
    error: catalogQuery.error,
    refetch: catalogQuery.refetch,
  };
}
