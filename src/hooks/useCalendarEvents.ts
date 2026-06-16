import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import type { CalendarEvent, CalendarEventInput, CalendarEventRange, CalendarEventStatus } from "@/types/calendar";

type MutationResult = {
  data: CalendarEvent | null;
  error: unknown | null;
};

type MutationOptions = {
  showToast?: boolean;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) return String((error as { message?: unknown }).message);
  return "Erro inesperado no calendario";
}

function toCalendarPayload(input: CalendarEventInput) {
  return {
    ...input,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    location: input.location?.trim() || null,
    meeting_url: input.meeting_url?.trim() || null,
    opportunity_id: input.opportunity_id || null,
    all_day: Boolean(input.all_day),
    followup_1h_enabled: Boolean(input.followup_1h_enabled),
    status: input.status ?? "scheduled",
    metadata: input.metadata ?? {},
  };
}

export function useCalendarEvents(range: CalendarEventRange, enabled = true) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [schemaReady, setSchemaReady] = useState(true);
  const rangeRef = useRef(range);
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rangeStartMs = range.start.getTime();
  const rangeEndMs = range.end.getTime();

  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  const fetchEvents = useCallback(
    async ({ showLoading = true }: { showLoading?: boolean } = {}) => {
      if (!enabled) {
        setLoading(false);
        return;
      }

      try {
        if (showLoading) setLoading(true);

        const { start, end } = rangeRef.current;
        const { data, error } = await supabase
          .schema("calendar")
          .from("events")
          .select("*")
          .lt("start_time", end.toISOString())
          .gt("end_time", start.toISOString())
          .is("deleted_at", null)
          .order("start_time", { ascending: true });

        if (error) throw error;

        setSchemaReady(true);
        setEvents((data ?? []) as CalendarEvent[]);
      } catch (error) {
        console.error("Erro ao carregar eventos do calendario:", error);
        setEvents([]);

        const message = getErrorMessage(error);
        const missingSchema = message.includes("schema") || message.includes("calendar") || message.includes("relation");
        setSchemaReady(!missingSchema);

        toast.error("Erro ao carregar calendario", {
          description: missingSchema ? "A migration do schema calendar ainda nao foi aplicada." : message,
        });
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [enabled]
  );

  const scheduleBackgroundFetch = useCallback(() => {
    if (fetchTimeoutRef.current) return;

    fetchTimeoutRef.current = setTimeout(() => {
      fetchTimeoutRef.current = null;
      void fetchEvents({ showLoading: false });
    }, 250);
  }, [fetchEvents]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents, rangeStartMs, rangeEndMs]);

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel("calendar-events-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "calendar",
          table: "events",
        },
        scheduleBackgroundFetch
      )
      .subscribe();

    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
        fetchTimeoutRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [enabled, scheduleBackgroundFetch]);

  const createEvent = useCallback(
    async (input: CalendarEventInput): Promise<MutationResult> => {
      try {
        const payload = toCalendarPayload(input);
        if (!payload.title) throw new Error("Informe um titulo para o evento.");
        if (!payload.lead_id) throw new Error("Selecione um lead para o evento.");

        const { data, error } = await supabase
          .schema("calendar")
          .from("events")
          .insert(payload)
          .select()
          .single();

        if (error) throw error;

        toast.success("Evento criado com sucesso!");
        await fetchEvents({ showLoading: false });
        return { data: data as CalendarEvent, error: null };
      } catch (error) {
        console.error("Erro ao criar evento:", error);
        toast.error("Erro ao criar evento", { description: getErrorMessage(error) });
        return { data: null, error };
      }
    },
    [fetchEvents]
  );

  const updateEvent = useCallback(
    async (eventId: string, input: Partial<CalendarEventInput>, options: MutationOptions = {}): Promise<MutationResult> => {
      try {
        const showToast = options.showToast ?? true;
        const payload = toCalendarPayload({
          title: input.title ?? "Evento",
          start_time: input.start_time ?? new Date().toISOString(),
          end_time: input.end_time ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          lead_id: input.lead_id ?? "",
          ...input,
        } as CalendarEventInput);

        const { data, error } = await supabase
          .schema("calendar")
          .from("events")
          .update(payload)
          .eq("id", eventId)
          .select()
          .single();

        if (error) throw error;

        if (showToast) {
          toast.success("Evento atualizado!");
        }
        await fetchEvents({ showLoading: false });
        return { data: data as CalendarEvent, error: null };
      } catch (error) {
        console.error("Erro ao atualizar evento:", error);
        if (options.showToast ?? true) {
          toast.error("Erro ao atualizar evento", { description: getErrorMessage(error) });
        }
        return { data: null, error };
      }
    },
    [fetchEvents]
  );

  const setEventStatus = useCallback(
    async (eventId: string, status: CalendarEventStatus, cancelReason?: string | null): Promise<MutationResult> => {
      try {
        const { data, error } = await supabase
          .schema("calendar")
          .from("events")
          .update({
            status,
            cancel_reason: status === "cancelled" ? cancelReason || null : null,
          })
          .eq("id", eventId)
          .select()
          .single();

        if (error) throw error;

        await fetchEvents({ showLoading: false });
        toast.success(status === "done" ? "Evento concluido!" : "Status atualizado!");
        return { data: data as CalendarEvent, error: null };
      } catch (error) {
        console.error("Erro ao atualizar status do evento:", error);
        toast.error("Erro ao atualizar evento", { description: getErrorMessage(error) });
        return { data: null, error };
      }
    },
    [fetchEvents]
  );

  const softDeleteEvent = useCallback(
    async (eventId: string): Promise<{ error: unknown | null }> => {
      try {
        const { error } = await supabase
          .schema("calendar")
          .from("events")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", eventId);

        if (error) throw error;

        setEvents((currentEvents) => currentEvents.filter((event) => event.id !== eventId));
        toast.success("Evento removido do calendario.");
        await fetchEvents({ showLoading: false });
        return { error: null };
      } catch (error) {
        console.error("Erro ao excluir evento:", error);
        toast.error("Erro ao excluir evento", { description: getErrorMessage(error) });
        return { error };
      }
    },
    [fetchEvents]
  );

  return {
    events,
    loading,
    schemaReady,
    refetch: fetchEvents,
    createEvent,
    updateEvent,
    setEventStatus,
    softDeleteEvent,
  };
}
