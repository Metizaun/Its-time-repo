import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { ChevronLeft, ChevronRight, Database, Plus, RotateCcw, Settings2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { CalendarEventDialog } from "@/components/calendar/CalendarEventDialog";
import { DayHeader } from "@/components/calendar/DayHeader";
import { DayView } from "@/components/calendar/DayView";
import { EventPopover } from "@/components/calendar/EventPopover";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { useProfessionalBooking } from "@/hooks/useProfessionalBooking";
import { supabase } from "@/integrations/supabase/client";
import { utcToWallDate, wallDateToUtc } from "@/lib/calendarTimezone";
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

function buildDefaultSlot(date: Date, timezone = "America/Sao_Paulo") {
  const start = new Date(date);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(10, 0, 0, 0);
  return { start: wallDateToUtc(start, timezone), end: wallDateToUtc(end, timezone) };
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
  const bookingDirectory = useProfessionalBooking(true);
  const calendarTimezone = bookingDirectory.timezone;
  const {
    events,
    loading: eventsLoading,
    schemaReady,
    createEvent,
    createProfessionalAppointment,
    rescheduleProfessionalAppointment,
    cancelProfessionalAppointment,
    updateEvent,
    setEventStatus,
    softDeleteEvent,
  } = useCalendarEvents(visibleRange, true, calendarTimezone);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [popoverState, setPopoverState] = useState<EventPopoverState | null>(null);
  const [defaultStart, setDefaultStart] = useState(() => buildDefaultSlot(new Date()).start);
  const [defaultEnd, setDefaultEnd] = useState(() => buildDefaultSlot(new Date()).end);
  const [defaultLeadId, setDefaultLeadId] = useState<string | null>(queryLeadId);
  const [leadFilter, setLeadFilter] = useState(queryLeadId ?? "all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [professionalFilter, setProfessionalFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<CalendarEventStatus | "all">("all");
  const [followupFilter, setFollowupFilter] = useState<FollowupFilter>("all");

  const leadsById = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads]);
  const companyOptions = useMemo(() => {
    const unique = new Map<string, string>();
    bookingDirectory.locationOptions.forEach((location) => {
      if (location.empresa_id && location.empresa_name) unique.set(location.empresa_id, location.empresa_name);
    });
    return Array.from(unique, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [bookingDirectory.locationOptions]);
  const professionalOptions = useMemo(() => {
    const unique = new Map<string, string>();
    bookingDirectory.locationOptions
      .filter((location) => companyFilter === "all" || location.empresa_id === companyFilter)
      .forEach((location) => unique.set(location.professional_id, location.professional_name));
    return Array.from(unique, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [bookingDirectory.locationOptions, companyFilter]);
  const serviceOptions = useMemo(() => {
    const unique = new Map<string, string>();
    bookingDirectory.locationOptions
      .filter((location) => companyFilter === "all" || location.empresa_id === companyFilter)
      .filter((location) => professionalFilter === "all" || location.professional_id === professionalFilter)
      .forEach((location) => {
        bookingDirectory.servicesForLocation(location.id).forEach((service) => unique.set(service.id, service.name));
      });
    return Array.from(unique, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [bookingDirectory, companyFilter, professionalFilter]);
  const loading = leadsLoading || eventsLoading;
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const matchesLead = leadFilter === "all" || event.lead_id === leadFilter;
      const matchesCompany = companyFilter === "all" || event.empresa_id === companyFilter;
      const matchesProfessional = professionalFilter === "all" || event.professional_id === professionalFilter;
      const matchesService = serviceFilter === "all" || event.service_id === serviceFilter;
      const matchesStatus = statusFilter === "all" || event.status === statusFilter;
      const matchesFollowup =
        followupFilter === "all" ||
        (followupFilter === "enabled" && event.followup_1h_enabled) ||
        event.followup_1h_status === followupFilter;

      return matchesLead && matchesCompany && matchesProfessional && matchesService && matchesStatus && matchesFollowup;
    });
  }, [companyFilter, events, followupFilter, leadFilter, professionalFilter, serviceFilter, statusFilter]);
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
    const { start, end } = buildDefaultSlot(currentDate, calendarTimezone);
    setDefaultStart(start);
    setDefaultEnd(end);
    setDefaultLeadId(leadExists ? queryLeadId : null);
    setSelectedEvent(null);
    setPopoverState(null);
    setDialogOpen(true);
    handledNewQueryRef.current = true;
  }, [calendarTimezone, currentDate, leads, leadsLoading, queryLeadId, queryNew]);

  useEffect(() => {
    if (!queryEventId || focusedEventIdRef.current === queryEventId) return;

    const localEvent = events.find((event) => event.id === queryEventId);
    if (localEvent) {
      focusedEventIdRef.current = queryEventId;
      goToDate(utcToWallDate(localEvent.start_time, calendarTimezone));
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
        goToDate(utcToWallDate(event.start_time, calendarTimezone));
        setSelectedEvent(event);
        setDefaultStart(new Date(event.start_time));
        setDefaultEnd(new Date(event.end_time));
        setPopoverState(null);
        setDialogOpen(true);
      });

    return () => {
      cancelled = true;
    };
  }, [calendarTimezone, events, goToDate, queryEventId]);

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
    setCompanyFilter("all");
    setProfessionalFilter("all");
    setServiceFilter("all");
    setStatusFilter("all");
    setFollowupFilter("all");
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("leadId");
    nextParams.delete("new");
    setSearchParams(nextParams, { replace: true });
  }

  function openCreateFromSelection(selection: { start: Date; end: Date; allDay: boolean }) {
    setDefaultStart(wallDateToUtc(selection.start, calendarTimezone));
    setDefaultEnd(wallDateToUtc(selection.end, calendarTimezone));
    setDefaultLeadId(leadFilter !== "all" ? leadFilter : queryLeadId);
    setSelectedEvent(null);
    setPopoverState(null);
    setDialogOpen(true);
  }

  function openCreateAtDate(date = currentDate) {
    const { start, end } = buildDefaultSlot(date, calendarTimezone);
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
    if (event.professional_location_id) {
      if (allDay) {
        toast.info("Agendamentos profissionais precisam permanecer em um horÃ¡rio disponÃ­vel.");
        return;
      }
      void rescheduleProfessionalAppointment(event.id, wallDateToUtc(start, calendarTimezone).toISOString(), { showToast: false });
      return;
    }

    void updateEvent(
      event.id,
      toEventInput(event, {
        start_time: wallDateToUtc(start, calendarTimezone).toISOString(),
        end_time: wallDateToUtc(end, calendarTimezone).toISOString(),
        all_day: allDay,
      }),
      { showToast: false }
    );
  }

  function handleResizeEvent(event: CalendarEvent, end: Date) {
    if (event.professional_location_id) {
      toast.info("A duraÃ§Ã£o deste atendimento Ã© definida pelo serviÃ§o.");
      return;
    }

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
    if (event.professional_location_id && status === "cancelled") {
      openEventDialog(event);
      toast.info("Informe o motivo do cancelamento antes de confirmar.");
      return;
    }
    void setEventStatus(event.id, status).then(() => setPopoverState(null));
  }

  const hasActiveFilters = leadFilter !== "all"
    || companyFilter !== "all"
    || professionalFilter !== "all"
    || serviceFilter !== "all"
    || statusFilter !== "all"
    || followupFilter !== "all";

  return (
    <div className="flex min-h-[calc(100vh-var(--layout-topbar-height)-32px)] flex-col gap-3">
      <header className="flex flex-col gap-3 rounded-[var(--radius-3xl)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday} className="rounded-full bg-[var(--color-surface-1)]">
            Hoje
          </Button>
          <div className="flex items-center rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] p-0.5">
            <button type="button" onClick={goPrevious} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-1)] hover:text-[var(--color-text-primary)]" aria-label="Periodo anterior">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={goNext} className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-1)] hover:text-[var(--color-text-primary)]" aria-label="Proximo periodo">
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
                    ? "bg-[var(--color-surface-1)] text-[var(--color-primary-600)] shadow-sm"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild variant="outline" size="icon" className="rounded-full bg-[var(--color-surface-1)]">
                <Link to="/calendar/settings" aria-label="Configurar agenda">
                  <Settings2 className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Configurar agenda</TooltipContent>
          </Tooltip>
          <Button onClick={() => openCreateAtDate()} className="rounded-full shadow-primary">
            <Plus className="mr-2 h-4 w-4" />
            Novo evento
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {companyOptions.length > 0 ? (
          <Select
            value={companyFilter}
            onValueChange={(value) => {
              setCompanyFilter(value);
              setProfessionalFilter("all");
              setServiceFilter("all");
            }}
          >
            <SelectTrigger className="h-9 w-auto min-w-[170px] rounded-full border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 shadow-none">
              <SelectValue placeholder="Empresa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as empresas</SelectItem>
              {companyOptions.map((company) => (
                <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {professionalOptions.length > 0 ? (
          <Select
            value={professionalFilter}
            onValueChange={(value) => {
              setProfessionalFilter(value);
              setServiceFilter("all");
            }}
          >
            <SelectTrigger className="h-9 w-auto min-w-[180px] rounded-full border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 shadow-none">
              <SelectValue placeholder="Profissional" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os profissionais</SelectItem>
              {professionalOptions.map((professional) => (
                <SelectItem key={professional.id} value={professional.id}>{professional.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {serviceOptions.length > 0 ? (
          <Select value={serviceFilter} onValueChange={setServiceFilter}>
            <SelectTrigger className="h-9 w-auto min-w-[170px] rounded-full border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 shadow-none">
              <SelectValue placeholder="Serviço" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os serviços</SelectItem>
              {serviceOptions.map((service) => (
                <SelectItem key={service.id} value={service.id}>{service.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Select value={leadFilter} onValueChange={updateLeadFilter}>
          <SelectTrigger className="h-9 w-auto min-w-[180px] rounded-full border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 shadow-none">
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
          <SelectTrigger className="h-9 w-auto min-w-[170px] rounded-full border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 shadow-none">
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
          <SelectTrigger className="h-9 w-auto min-w-[180px] rounded-full border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 shadow-none">
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
            <div key={day.toISOString()} className="min-w-16 rounded-2xl bg-[var(--color-surface-1)]">
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
            timezone={calendarTimezone}
          />
        ) : viewMode === "day" ? (
          <DayView
            day={currentDate}
            events={filteredEvents}
            onCreateFromSelection={openCreateFromSelection}
            onSelectEvent={(event, position) => setPopoverState({ event, position })}
            onMoveEvent={handleMoveEvent}
            onResizeEvent={handleResizeEvent}
            timezone={calendarTimezone}
          />
        ) : (
          <MonthView
            weeks={monthWeeks}
            currentDate={currentDate}
            events={filteredEvents}
            onCreateAtDate={openCreateAtDate}
            onSelectEvent={(event, position) => setPopoverState({ event, position })}
            onMoveEvent={handleMoveEvent}
            timezone={calendarTimezone}
          />
        )}

        {loading ? (
          <div className="absolute inset-0 z-40 flex items-center justify-center rounded-[var(--radius-3xl)] bg-[var(--color-surface-overlay)] backdrop-blur-sm">
            <div className="rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] shadow-sm">
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
          timezone={calendarTimezone}
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
        onCreateProfessional={createProfessionalAppointment}
        onCancelProfessional={cancelProfessionalAppointment}
        onUpdate={updateEvent}
        onDelete={softDeleteEvent}
      />
    </div>
  );
}
