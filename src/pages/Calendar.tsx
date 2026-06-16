import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { ChevronLeft, ChevronRight, Database, Plus, RotateCcw } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { CalendarEventDialog } from "@/components/calendar/CalendarEventDialog";
import { DayHeader } from "@/components/calendar/DayHeader";
import { DayView } from "@/components/calendar/DayView";
import { EventPopover } from "@/components/calendar/EventPopover";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCalendarEvents } from "@/hooks/useCalendarEvents";
import { useCalendarNavigation } from "@/hooks/useCalendarNavigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLeads } from "@/hooks/useLeads";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarEventStatus,
  CalendarFollowupStatus,
  CalendarViewMode,
} from "@/types/calendar";

type FollowupFilter = CalendarFollowupStatus | "all" | "enabled";

type EventPopoverState = {
  event: CalendarEvent;
  position: { top: number; left: number };
};

const VIEW_OPTIONS: Array<{ value: CalendarViewMode; label: string }> = [
  { value: "week", label: "Semana" },
  { value: "day", label: "Dia" },
  { value: "month", label: "Mes" },
];

const STATUS_FILTERS: Array<{ value: CalendarEventStatus | "all"; label: string }> = [
  { value: "all", label: "Todos os status" },
  { value: "scheduled", label: "Agendado" },
  { value: "confirmed", label: "Confirmado" },
  { value: "done", label: "Concluido" },
  { value: "cancelled", label: "Cancelado" },
  { value: "no_show", label: "Nao compareceu" },
];

const FOLLOWUP_FILTERS: Array<{ value: FollowupFilter; label: string }> = [
  { value: "all", label: "Todos os lembretes" },
  { value: "enabled", label: "Lembrete ativo" },
  { value: "pending", label: "Pendente" },
  { value: "sending", label: "Enviando" },
  { value: "sent", label: "Enviado" },
  { value: "failed", label: "Falhou" },
  { value: "skipped", label: "Ignorado" },
  { value: "disabled", label: "Desligado" },
];

function buildDefaultSlot(date: Date) {
  const start = new Date(date);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(10, 0, 0, 0);
  return { start, end };
}

function toEventInput(event: CalendarEvent, overrides: Partial<CalendarEventInput> = {}): CalendarEventInput {
  return {
    title: event.title,
    description: event.description,
    start_time: event.start_time,
    end_time: event.end_time,
    all_day: event.all_day,
    status: event.status,
    cancel_reason: event.cancel_reason,
    location: event.location,
    meeting_url: event.meeting_url,
    lead_id: event.lead_id,
    opportunity_id: event.opportunity_id,
    followup_1h_enabled: event.followup_1h_enabled,
    metadata: event.metadata,
    ...overrides,
  };
}

export default function Calendar() {
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryLeadId = searchParams.get("leadId");
  const queryNew = searchParams.get("new");
  const queryEventId = searchParams.get("eventId");
  const mobileFallbackAppliedRef = useRef(false);
  const handledNewQueryRef = useRef(false);
  const focusedEventIdRef = useRef<string | null>(null);

  const {
    currentDate,
    viewMode,
    visibleRange,
    weekDays,
    monthWeeks,
    periodLabel,
    goToday,
    goToDate,
    goNext,
    goPrevious,
    setViewMode,
  } = useCalendarNavigation(new Date(), "week");

  const { leads, loading: leadsLoading } = useLeads({ enableRealtime: false });
  const {
    events,
    loading: eventsLoading,
    schemaReady,
    createEvent,
    updateEvent,
    setEventStatus,
    softDeleteEvent,
  } = useCalendarEvents(visibleRange);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [popoverState, setPopoverState] = useState<EventPopoverState | null>(null);
  const [defaultStart, setDefaultStart] = useState(() => buildDefaultSlot(new Date()).start);
  const [defaultEnd, setDefaultEnd] = useState(() => buildDefaultSlot(new Date()).end);
  const [defaultLeadId, setDefaultLeadId] = useState<string | null>(queryLeadId);
  const [leadFilter, setLeadFilter] = useState(queryLeadId ?? "all");
  const [statusFilter, setStatusFilter] = useState<CalendarEventStatus | "all">("all");
  const [followupFilter, setFollowupFilter] = useState<FollowupFilter>("all");

  const leadsById = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads]);
  const loading = leadsLoading || eventsLoading;
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const matchesLead = leadFilter === "all" || event.lead_id === leadFilter;
      const matchesStatus = statusFilter === "all" || event.status === statusFilter;
      const matchesFollowup =
        followupFilter === "all" ||
        (followupFilter === "enabled" && event.followup_1h_enabled) ||
        event.followup_1h_status === followupFilter;

      return matchesLead && matchesStatus && matchesFollowup;
    });
  }, [events, followupFilter, leadFilter, statusFilter]);
  const activePopoverEvent = popoverState
    ? events.find((event) => event.id === popoverState.event.id) ?? popoverState.event
    : null;

  useEffect(() => {
    if (!isMobile || mobileFallbackAppliedRef.current) return;
    setViewMode("day");
    mobileFallbackAppliedRef.current = true;
  }, [isMobile, setViewMode]);

  useEffect(() => {
    setLeadFilter(queryLeadId ?? "all");
  }, [queryLeadId]);

  useEffect(() => {
    handledNewQueryRef.current = false;
  }, [queryLeadId, queryNew]);

  useEffect(() => {
    if (queryNew !== "1" || handledNewQueryRef.current || leadsLoading) return;

    const leadExists = queryLeadId ? leads.some((lead) => lead.id === queryLeadId) : false;
    const { start, end } = buildDefaultSlot(currentDate);
    setDefaultStart(start);
    setDefaultEnd(end);
    setDefaultLeadId(leadExists ? queryLeadId : null);
    setSelectedEvent(null);
    setPopoverState(null);
    setDialogOpen(true);
    handledNewQueryRef.current = true;
  }, [currentDate, leads, leadsLoading, queryLeadId, queryNew]);

  useEffect(() => {
    if (!queryEventId || focusedEventIdRef.current === queryEventId) return;

    const localEvent = events.find((event) => event.id === queryEventId);
    if (localEvent) {
      focusedEventIdRef.current = queryEventId;
      goToDate(new Date(localEvent.start_time));
      setSelectedEvent(localEvent);
      setDefaultStart(new Date(localEvent.start_time));
      setDefaultEnd(new Date(localEvent.end_time));
      setPopoverState(null);
      setDialogOpen(true);
      return;
    }

    let cancelled = false;
    void supabase
      .schema("calendar")
      .from("events")
      .select("*")
      .eq("id", queryEventId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const event = data as CalendarEvent;
        focusedEventIdRef.current = queryEventId;
        goToDate(new Date(event.start_time));
        setSelectedEvent(event);
        setDefaultStart(new Date(event.start_time));
        setDefaultEnd(new Date(event.end_time));
        setPopoverState(null);
        setDialogOpen(true);
      });

    return () => {
      cancelled = true;
    };
  }, [events, goToDate, queryEventId]);

  function updateLeadFilter(value: string) {
    setLeadFilter(value);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("new");

    if (value === "all") {
      nextParams.delete("leadId");
    } else {
      nextParams.set("leadId", value);
    }

    setSearchParams(nextParams, { replace: true });
  }

  function clearFilters() {
    setLeadFilter("all");
    setStatusFilter("all");
    setFollowupFilter("all");
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("leadId");
    nextParams.delete("new");
    setSearchParams(nextParams, { replace: true });
  }

  function openCreateFromSelection(selection: { start: Date; end: Date; allDay: boolean }) {
    setDefaultStart(selection.start);
    setDefaultEnd(selection.end);
    setDefaultLeadId(leadFilter !== "all" ? leadFilter : queryLeadId);
    setSelectedEvent(null);
    setPopoverState(null);
    setDialogOpen(true);
  }

  function openCreateAtDate(date = currentDate) {
    const { start, end } = buildDefaultSlot(date);
    openCreateFromSelection({ start, end, allDay: false });
  }

  function openEventDialog(event: CalendarEvent) {
    setSelectedEvent(event);
    setDefaultStart(new Date(event.start_time));
    setDefaultEnd(new Date(event.end_time));
    setPopoverState(null);
    setDialogOpen(true);
  }

  function handleMoveEvent(event: CalendarEvent, start: Date, end: Date, allDay: boolean) {
    void updateEvent(
      event.id,
      toEventInput(event, {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        all_day: allDay,
      }),
      { showToast: false }
    );
  }

  function handleResizeEvent(event: CalendarEvent, end: Date) {
    void updateEvent(
      event.id,
      toEventInput(event, {
        end_time: end.toISOString(),
        all_day: false,
      }),
      { showToast: false }
    );
  }

  function handleSetStatus(event: CalendarEvent, status: CalendarEventStatus) {
    void setEventStatus(event.id, status).then(() => setPopoverState(null));
  }

  const hasActiveFilters = leadFilter !== "all" || statusFilter !== "all" || followupFilter !== "all";

  return (
    <div className="flex min-h-[calc(100vh-var(--layout-topbar-height)-32px)] flex-col gap-3">
      <header className="flex flex-col gap-3 rounded-[28px] border border-[var(--color-border-subtle)] bg-white px-4 py-3 shadow-[0_12px_32px_rgba(26,24,20,0.05)] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday} className="rounded-full bg-white">
            Hoje
          </Button>
          <div className="flex items-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-0.5">
            <button type="button" onClick={goPrevious} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-white hover:text-[var(--color-text-primary)]" aria-label="Periodo anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={goNext} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-white hover:text-[var(--color-text-primary)]" aria-label="Proximo periodo">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="min-w-0 px-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">Calendario</p>
            <h1 className="truncate text-xl font-semibold capitalize tracking-tight text-[var(--color-text-primary)] lg:text-2xl">
              {periodLabel}
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-1">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setViewMode(option.value)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-semibold transition-all",
                  viewMode === option.value
                    ? "bg-white text-[var(--color-primary-600)] shadow-sm"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button onClick={() => openCreateAtDate()} className="rounded-full shadow-[0_10px_22px_rgba(232,81,26,0.22)]">
            <Plus className="mr-2 h-4 w-4" />
            Novo evento
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={leadFilter} onValueChange={updateLeadFilter}>
          <SelectTrigger className="h-9 w-auto min-w-[180px] rounded-full border-[var(--color-border-subtle)] bg-white px-4 shadow-none">
            <SelectValue placeholder="Lead" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os leads</SelectItem>
            {leads.map((lead) => (
              <SelectItem key={lead.id} value={lead.id}>
                {lead.lead_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as CalendarEventStatus | "all")}>
          <SelectTrigger className="h-9 w-auto min-w-[170px] rounded-full border-[var(--color-border-subtle)] bg-white px-4 shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={followupFilter} onValueChange={(value) => setFollowupFilter(value as FollowupFilter)}>
          <SelectTrigger className="h-9 w-auto min-w-[180px] rounded-full border-[var(--color-border-subtle)] bg-white px-4 shadow-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FOLLOWUP_FILTERS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 rounded-full text-[var(--color-text-secondary)]">
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Limpar filtros
          </Button>
        ) : null}
      </div>

      {isMobile && viewMode !== "month" ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {weekDays.map((day) => (
            <div key={day.toISOString()} className="min-w-16 rounded-2xl bg-white">
              <DayHeader
                day={day}
                compact
                selected={format(day, "yyyy-MM-dd") === format(currentDate, "yyyy-MM-dd")}
                onClick={goToDate}
              />
            </div>
          ))}
        </div>
      ) : null}

      {!schemaReady ? (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-4 text-sm text-[var(--color-text-secondary)]">
          <Database className="h-5 w-5 text-[var(--color-warning-600)]" />
          <span>A migration do schema calendar precisa estar aplicada no Supabase para liberar os eventos.</span>
        </div>
      ) : null}

      <main className="relative min-h-0 flex-1">
        {viewMode === "week" ? (
          <WeekView
            days={weekDays}
            events={filteredEvents}
            selectedDate={currentDate}
            onGoToDate={goToDate}
            onCreateFromSelection={openCreateFromSelection}
            onSelectEvent={(event, position) => setPopoverState({ event, position })}
            onMoveEvent={handleMoveEvent}
            onResizeEvent={handleResizeEvent}
          />
        ) : viewMode === "day" ? (
          <DayView
            day={currentDate}
            events={filteredEvents}
            onCreateFromSelection={openCreateFromSelection}
            onSelectEvent={(event, position) => setPopoverState({ event, position })}
            onMoveEvent={handleMoveEvent}
            onResizeEvent={handleResizeEvent}
          />
        ) : (
          <MonthView
            weeks={monthWeeks}
            currentDate={currentDate}
            events={filteredEvents}
            onCreateAtDate={openCreateAtDate}
            onSelectEvent={(event, position) => setPopoverState({ event, position })}
            onMoveEvent={handleMoveEvent}
          />
        )}

        {loading ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center rounded-[28px] bg-white/55 backdrop-blur-[1px]">
            <div className="rounded-full border border-[var(--color-border-subtle)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] shadow-sm">
              Carregando agenda...
            </div>
          </div>
        ) : null}
      </main>

      {activePopoverEvent && popoverState ? (
        <EventPopover
          event={activePopoverEvent}
          lead={leadsById.get(activePopoverEvent.lead_id) ?? null}
          position={popoverState.position}
          onClose={() => setPopoverState(null)}
          onEdit={openEventDialog}
          onSetStatus={handleSetStatus}
        />
      ) : null}

      <CalendarEventDialog
        open={dialogOpen}
        event={selectedEvent}
        defaultStart={defaultStart}
        defaultEnd={defaultEnd}
        leads={leads}
        defaultLeadId={defaultLeadId}
        onOpenChange={setDialogOpen}
        onCreate={createEvent}
        onUpdate={updateEvent}
        onDelete={softDeleteEvent}
      />
    </div>
  );
}
