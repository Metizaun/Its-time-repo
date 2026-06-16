import { useEffect } from "react";
import { BellRing, CalendarCheck2, CheckCircle2, Clock3, Edit3, MapPin, XCircle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Lead } from "@/hooks/useLeads";
import type { CalendarEvent, CalendarEventStatus, CalendarFollowupStatus } from "@/types/calendar";

type EventPopoverProps = {
  event: CalendarEvent;
  lead: Lead | null;
  position: { top: number; left: number };
  onClose: () => void;
  onEdit: (event: CalendarEvent) => void;
  onSetStatus: (event: CalendarEvent, status: CalendarEventStatus) => void;
};

const STATUS_LABELS: Record<CalendarEventStatus, string> = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  done: "Concluido",
  no_show: "Nao compareceu",
};

const STATUS_DOT: Record<CalendarEventStatus, string> = {
  scheduled: "bg-[var(--color-primary-500)]",
  confirmed: "bg-[var(--color-success-600)]",
  cancelled: "bg-[var(--color-error-600)]",
  done: "bg-[var(--color-gray-500)]",
  no_show: "bg-[var(--color-warning-600)]",
};

const FOLLOWUP_LABELS: Record<CalendarFollowupStatus, string> = {
  disabled: "desligado",
  pending: "pendente",
  sending: "enviando",
  sent: "enviado",
  failed: "falhou",
  skipped: "ignorado",
};

function formatEventTime(event: CalendarEvent) {
  if (event.all_day) {
    return format(parseISO(event.start_time), "dd 'de' MMMM", { locale: ptBR });
  }

  return `${format(parseISO(event.start_time), "dd/MM HH:mm", { locale: ptBR })} - ${format(parseISO(event.end_time), "HH:mm", { locale: ptBR })}`;
}

export function EventPopover({
  event,
  lead,
  position,
  onClose,
  onEdit,
  onSetStatus,
}: EventPopoverProps) {
  useEffect(() => {
    const closeOnEscape = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === "Escape") {
        onClose();
      }
    };

    const closeOnPointer = (pointerEvent: MouseEvent) => {
      const target = pointerEvent.target as HTMLElement | null;
      if (!target?.closest("[data-calendar-event-popover]") && !target?.closest("[data-calendar-event-block]")) {
        onClose();
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOnPointer);

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", closeOnPointer);
    };
  }, [onClose]);

  return (
    <div
      data-calendar-event-popover
      className="fixed z-50 w-[320px] rounded-[22px] border border-[var(--color-border-subtle)] bg-white p-4 shadow-[0_22px_60px_rgba(26,24,20,0.16)]"
      style={{ top: position.top, left: position.left }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_DOT[event.status])} />
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">
              {STATUS_LABELS[event.status]}
            </span>
          </div>
          <h3 className="line-clamp-2 text-base font-semibold leading-tight text-[var(--color-text-primary)]">
            {event.title}
          </h3>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
          aria-label="Fechar detalhes do evento"
        >
          <XCircle className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
        <p className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-[var(--color-primary-500)]" />
          <span>{formatEventTime(event)}</span>
        </p>
        {lead ? (
          <p className="flex items-center gap-2">
            <CalendarCheck2 className="h-4 w-4 text-[var(--color-primary-500)]" />
            <span className="truncate">{lead.lead_name}</span>
          </p>
        ) : null}
        {event.location ? (
          <p className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[var(--color-primary-500)]" />
            <span className="truncate">{event.location}</span>
          </p>
        ) : null}
        {event.followup_1h_enabled ? (
          <p className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-[var(--color-primary-500)]" />
            <span>Lembrete 1h antes: {FOLLOWUP_LABELS[event.followup_1h_status]}</span>
          </p>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {event.status === "scheduled" ? (
          <Button size="sm" variant="outline" onClick={() => onSetStatus(event, "confirmed")}>
            Confirmar
          </Button>
        ) : null}
        {event.status !== "done" ? (
          <Button size="sm" variant="outline" onClick={() => onSetStatus(event, "done")}>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Concluir
          </Button>
        ) : null}
        {event.status !== "cancelled" ? (
          <Button size="sm" variant="outline" onClick={() => onSetStatus(event, "cancelled")}>
            Cancelar
          </Button>
        ) : null}
        <Button size="sm" onClick={() => onEdit(event)} className="shadow-none">
          <Edit3 className="mr-1.5 h-3.5 w-3.5" />
          Editar
        </Button>
      </div>
    </div>
  );
}
