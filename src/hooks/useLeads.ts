import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const LEADS_UPDATED_EVENT = "leads-updated";

export function notifyLeadsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LEADS_UPDATED_EVENT));
  }
}

export interface Lead {
  id: string;
  lead_name: string;
  email: string | null;
  contact_phone: string | null;
  source: string | null;
  status: string;
  stage_id: string | null;
  created_at: string;
  updated_at: string | null;
  last_message_at: string | null;
  last_city: string | null;
  last_region: string | null;
  last_country: string | null;
  lead_number: number | null;
  owner_name: string | null;
  owner_id: string | null;
  value: number | null;
  connection_level: string | null;
  opportunity_status: string | null;
  notes: string | null;
  instance_name?: string | null;
  instance_color?: string | null;
  last_tag_name: string | null;
  last_tag_urgencia: number | null;
}

interface UseLeadsOptions {
  enableRealtime?: boolean;
  enabled?: boolean;
}

function sortLeadsByRecency(value: Lead[]): Lead[] {
  return [...value].sort((a, b) => {
    const aHasLast = !!a.last_message_at;
    const bHasLast = !!b.last_message_at;

    if (aHasLast !== bHasLast) {
      return aHasLast ? -1 : 1;
    }

    if (a.last_message_at && b.last_message_at && a.last_message_at !== b.last_message_at) {
      return a.last_message_at > b.last_message_at ? -1 : 1;
    }

    if (a.created_at !== b.created_at) {
      return a.created_at > b.created_at ? -1 : 1;
    }

    return 0;
  });
}

export function useLeads(options: UseLeadsOptions = {}) {
  const { enableRealtime = false, enabled = true } = options;
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(enabled);
  const pendingRealtimeLeadIdsRef = useRef<Set<string>>(new Set());
  const flushRealtimeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchLeads = useCallback(async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
    if (!isMountedRef.current) {
      return;
    }

    try {
      if (showLoading) {
        setLoading(true);
      }

      const PAGE_SIZE = 500;
      const visibleIdRows: Array<{ id: string | null }> = [];
      let page = 0;

      while (true) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        const { data, error } = await supabase
          .from("leads")
          .select("id")
          .eq("view", true)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);

        if (error) throw error;

        if (!data || data.length === 0) {
          break;
        }

        visibleIdRows.push(...data);

        if (data.length < PAGE_SIZE) {
          break;
        }

        page += 1;
      }

      const visibleIds = Array.from(
        new Set(
          visibleIdRows
            .map((lead) => lead.id)
            .filter((id): id is string => typeof id === "string" && id.length > 0)
        )
      );

      if (visibleIds.length === 0) {
        if (!isMountedRef.current) {
          return;
        }
        setLeads([]);
        return;
      }

      const chunkSize = 200;
      const allLeads: Lead[] = [];

      for (let i = 0; i < visibleIds.length; i += chunkSize) {
        const chunk = visibleIds.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from("v_lead_details")
          .select("*")
          .in("id", chunk)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false } as any);

        if (error) throw error;

        if (data?.length) {
          allLeads.push(...data);
        }
      }

      if (allLeads.length !== visibleIds.length) {
        const loadedLeadIds = new Set(allLeads.map((lead) => lead.id));
        const missingIds = visibleIds.filter((id) => !loadedLeadIds.has(id));

        console.warn("[useLeads] Divergencia entre IDs visiveis e detalhes carregados", {
          visibleIdsCount: visibleIds.length,
          loadedLeadsCount: allLeads.length,
          missingCount: missingIds.length,
          sampleMissingIds: missingIds.slice(0, 10),
        });
      }

      if (!isMountedRef.current) {
        return;
      }

      setLeads(sortLeadsByRecency(allLeads));
    } catch (error: any) {
      console.error("Erro ao carregar leads:", error);
      toast.error("Erro ao carregar leads");
    } finally {
      if (showLoading && isMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const flushRealtimeLeadUpdates = useCallback(async () => {
    if (!isMountedRef.current) {
      return;
    }

    const ids = Array.from(pendingRealtimeLeadIdsRef.current);
    pendingRealtimeLeadIdsRef.current.clear();
    flushRealtimeTimeoutRef.current = null;

    if (ids.length === 0) {
      return;
    }

    try {
      const chunkSize = 200;
      const updatedLeads: Lead[] = [];
      const idsToRemove: string[] = [];

      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const { data: visibilityData, error: visibilityError } = await supabase
          .from("leads")
          .select("id, view")
          .in("id", chunk);

        if (visibilityError) throw visibilityError;

        const visibleIdSet = new Set(
          (visibilityData ?? [])
            .filter((row: any) => row?.view === true && typeof row?.id === "string" && row.id.length > 0)
            .map((row: any) => row.id as string)
        );

        for (const id of chunk) {
          if (!visibleIdSet.has(id)) {
            idsToRemove.push(id);
          }
        }

        const visibleIds = Array.from(visibleIdSet);
        if (visibleIds.length === 0) {
          continue;
        }

        const { data, error } = await supabase.from("v_lead_details").select("*").in("id", visibleIds);

        if (error) throw error;

        const returnedIdSet = new Set((data ?? []).map((lead: any) => lead?.id).filter(Boolean));
        for (const id of visibleIds) {
          if (!returnedIdSet.has(id)) {
            idsToRemove.push(id);
          }
        }

        if (data?.length) {
          updatedLeads.push(...data);
        }
      }

      if (!isMountedRef.current) {
        return;
      }

      const removeSet = new Set(idsToRemove);

      setLeads((prev) => {
        const prevHasAnyRemove = removeSet.size > 0 && prev.some((lead) => removeSet.has(lead.id));
        const hasAnyChange = updatedLeads.length > 0 || prevHasAnyRemove;

        if (!hasAnyChange) {
          return prev;
        }

        let next = prev;

        if (prevHasAnyRemove) {
          next = next.filter((lead) => !removeSet.has(lead.id));
        }

        if (updatedLeads.length > 0) {
          if (next === prev) {
            next = [...next];
          }
          const byId = new Map(next.map((lead) => [lead.id, lead]));
          for (const lead of updatedLeads) {
            byId.set(lead.id, lead);
          }
          next = Array.from(byId.values());
        }

        return sortLeadsByRecency(next);
      });
    } catch (error) {
      console.error("[useLeads] Erro no patch incremental; fallback para refetch em background.", error);
      if (isMountedRef.current) {
        void fetchLeads({ showLoading: false });
      }
    }
  }, [fetchLeads]);

  const queueRealtimeLeadUpdate = useCallback(
    (leadId: string) => {
      pendingRealtimeLeadIdsRef.current.add(leadId);

      if (flushRealtimeTimeoutRef.current) {
        return;
      }

      flushRealtimeTimeoutRef.current = setTimeout(() => {
        void flushRealtimeLeadUpdates();
      }, 250);
    },
    [flushRealtimeLeadUpdates]
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    fetchLeads();

    if (!enableRealtime) {
      return;
    }

    const channel = supabase
      .channel("leads-changes-sorting")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "Crm",
          table: "leads",
        },
        (payload) => {
          const leadId = (payload.new as any)?.id ?? (payload.old as any)?.id;

          if (typeof leadId !== "string" || leadId.length === 0) {
            console.warn("[useLeads] Evento realtime sem leadId; fallback para refetch em background.", payload);
            void fetchLeads({ showLoading: false });
            return;
          }

          queueRealtimeLeadUpdate(leadId);
        }
      )
      .subscribe();

    return () => {
      if (flushRealtimeTimeoutRef.current) {
        clearTimeout(flushRealtimeTimeoutRef.current);
        flushRealtimeTimeoutRef.current = null;
      }
      pendingRealtimeLeadIdsRef.current.clear();
      supabase.removeChannel(channel);
    };
  }, [enabled, enableRealtime, fetchLeads, queueRealtimeLeadUpdate]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleLeadsUpdated = () => {
      void fetchLeads({ showLoading: false });
    };

    window.addEventListener(LEADS_UPDATED_EVENT, handleLeadsUpdated);
    return () => {
      window.removeEventListener(LEADS_UPDATED_EVENT, handleLeadsUpdated);
    };
  }, [fetchLeads]);

  const refetch = useCallback(
    ({ showLoading = true }: { showLoading?: boolean } = {}) => fetchLeads({ showLoading }),
    [fetchLeads]
  );

  return { leads, loading, refetch };
}
