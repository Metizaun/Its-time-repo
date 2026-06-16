import { format, isSameMonth, isToday, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import { cn } from "@/lib/utils";
import type { CalendarEvent, CalendarEventStatus } from "@/types/calendar";

type MonthViewProps = {
  weeks: Date[][];
  currentDate: Date;
  events: CalendarEvent[];
  onCreateAtDate: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent, position: { top: number; left: number }) => void;
  onMoveEvent: (event: CalendarEvent, start: Date, end: Date, allDay: boolean) => void;
};

const STATUS_DOT_COLORS: Record<CalendarEventStatus, string> = {
  scheduled: "var(--color-primary-500)",
  confirmed: "var(--color-success-600)",
  cancelled: "var(--color-error-600)",
  done: "var(--color-gray-500)",
  no_show: "var(--color-warning-600)",
};

function eventsForDay(events: CalendarEvent[], day: Date) {
  const key = format(day, "yyyy-MM-dd");
  return events.filter((event) => format(parseISO(event.start_time), "yyyy-MM-dd") === key);
}

function readDropPayload(dataTransfer: DataTransfer) {
  const raw = dataTransfer.getData("application/calendar-event");
  if (!raw) return null;

  try {
    return JSON.parse(raw) as { id: string; durationMs?: number };
  } catch {
    return null;
  }
}

export function MonthView({
  weeks,
  currentDate,
  events,
  onCreateAtDate,
  onSelectEvent,
  onMoveEvent,
}: MonthViewProps) {
  const weekDays = weeks[0] ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-[var(--color-border-subtle)] bg-white shadow-[0_18px_45px_rgba(26,24,20,0.06)]">
      <div className="grid grid-cols-7 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
        {weekDays.map((day) => (
          <div key={day.toISOString()} className="px-3 py-3 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
            {format(day, "EEE", { locale: ptBR })}
          </div>
        ))}
      </div>

      <div className="grid flex-1" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(112px, 1fr))` }}>
        {weeks.map((week) => (
          <div key={week[0]?.toISOString()} className="grid grid-cols-7 border-b border-[var(--color-border-subtle)] last:border-b-0">
            {week.map((day) => {
              const dayEvents = eventsForDay(events, day);
              const muted = !isSameMonth(day, currentDate);
              const today = isToday(day);
              const overflowCount = Math.max(dayEvents.length - 3, 0);

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => onCreateAtDate(day)}
                  onDragOver={(dragEvent) => {
                    if (!dragEvent.dataTransfer.types.includes("application/calendar-event")) return;
                    dragEvent.preventDefault();
                    dragEvent.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(dropEvent) => {
                    dropEvent.preventDefault();
                    const payload = readDropPayload(dropEvent.dataTransfer);
                    if (!payload) return;

                    const event = events.find((candidate) => candidate.id === payload.id);
                    if (!event) return;

                    const originalStart = parseISO(event.start_time);
                    const start = new Date(day);
                    start.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);
                    const durationMs =
                      payload.durationMs ??
                      Math.max(parseISO(event.end_time).getTime() - originalStart.getTime(), 60 * 60 * 1000);
                    const end = new Date(start.getTime() + durationMs);

                    onMoveEvent(event, start, end, event.all_day);
                  }}
                  className={cn(
                    "min-h-[112px] border-r border-[var(--color-border-subtle)] p-2 text-left transition-colors hover:bg-[var(--color-primary-50)]/45 last:border-r-0",
                    muted && "bg-[var(--color-surface-2)]/60 text-[var(--color-text-muted)]"
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums",
                        today ? "bg-[var(--color-primary-500)] text-white" : "text-[var(--color-text-primary)]"
                      )}
                    >
                      {format(day, "d")}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {dayEvents.slice(0, 3).map((event) => (
                      <span
                        key={event.id}
                        draggable
                        onDragStart={(dragEvent) => {
                          const durationMs = parseISO(event.end_time).getTime() - parseISO(event.start_time).getTime();
                          dragEvent.dataTransfer.setData("application/calendar-event", JSON.stringify({ id: event.id, durationMs, allDay: event.all_day }));
                          dragEvent.dataTransfer.effectAllowed = "move";
                        }}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          const rect = clickEvent.currentTarget.getBoundingClientRect();
                          onSelectEvent(event, {
                            top: Math.min(rect.bottom + 8, window.innerHeight - 260),
                            left: Math.min(rect.left, window.innerWidth - 340),
                          });
                        }}
                        className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-[var(--color-text-primary)] hover:bg-white"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_DOT_COLORS[event.status] }} />
                        <span className="truncate">{event.all_day ? "" : `${format(parseISO(event.start_time), "HH:mm")} `}{event.title}</span>
                        {event.followup_1h_enabled ? <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary-300)]" title="Lembrete ativo" /> : null}
                      </span>
                    ))}
                    {overflowCount > 0 ? (
                      <span className="block px-1.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
                        +{overflowCount} mais
                      </span>
                    ) : null}
                  </div>
                  <span className="sr-only">
                    {dayEvents.length} evento{dayEvents.length === 1 ? "" : "s"} em {format(day, "dd/MM/yyyy")}; clique para criar evento.
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
