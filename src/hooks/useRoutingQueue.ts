import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import {
  claimRoutingEvent,
  closeRoutingEvent,
  listRoutingQueue,
  type RoutingQueueItem,
} from "@/services/routingQueueService";

export function useRoutingQueue() {
  const [items, setItems] = useState<RoutingQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const refetch = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setItems(await listRoutingQueue());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Nao foi possivel carregar os encaminhamentos"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
    const channel = supabase
      .channel("routing-queue-chat")
      .on(
        "postgres_changes",
        { event: "*", schema: "crm", table: "routing_events" },
        () => void refetch(true),
      )
      .subscribe();
    const onVisible = () => document.visibilityState === "visible" && void refetch(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [refetch]);

  const claim = useCallback(async (eventId: string) => {
    setActionId(eventId);
    try {
      const response = await claimRoutingEvent(eventId);
      await refetch(true);
      return response.result;
    } finally {
      setActionId(null);
    }
  }, [refetch]);

  const close = useCallback(async (eventId: string) => {
    setActionId(eventId);
    try {
      const response = await closeRoutingEvent(eventId);
      await refetch(true);
      return response.result;
    } finally {
      setActionId(null);
    }
  }, [refetch]);

  const byLead = useMemo(() => {
    const entries = new Map<string, RoutingQueueItem>();
    for (const item of items) {
      if (item.status !== "waiting" && item.status !== "claimed") continue;
      if (!entries.has(item.leadId)) entries.set(item.leadId, item);
    }
    return entries;
  }, [items]);

  return { items, byLead, loading, error, actionId, refetch, claim, close };
}
