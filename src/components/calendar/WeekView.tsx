import { useEffect, useMemo, useRef } from "react";
import { format, parseISO } from "date-fns";

import { DayColumn } from "@/components/calendar/DayColumn";
import { DayHeader } from "@/components/calendar/DayHeader";
import { TimeGutter } from "@/components/calendar/TimeGutter";
import {
  DAY_START_HOUR,
  HOUR_HEIGHT,
  TIME_GUTTER_WIDTH,
  allDayEventsForDay,
} from "@/hooks/useEventLayout";
import type { CalendarEvent } from "@/types/calendar";

type WeekViewProps = {
  days: Date[];
  events: CalendarEvent[];
  selectedDate: Date;
  onGoToDate: (date: Date) => void;
  onCreateFromSelection: (selection: { start: Date; end: Date; allDay: boolean }) => void;
  onSelectEvent: (event: CalendarEvent, position: { top: number; left: number }) => void;
  onMoveEvent: (event: CalendarEvent, start: Date, end: Date, allDay: boolean) => void;
  onResizeEvent: (event: CalendarEvent, end: Date) => void;
};

export function WeekView({
  days,
  events,
  selectedDate,
  onGoToDate,
  onCreateFromSelection,
  onSelectEvent,
  onMoveEvent,
  onResizeEvent,
}: WeekViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasAllDayEvents = useMemo(
    () => days.some((day) => allDayEventsForDay(events, day).length > 0),
    [days, events]
  );

  useEffect(() => {
    const currentHour = new Date().getHours();
    scrollRef.current?.scrollTo({
      top: Math.max(0, (currentHour - DAY_START_HOUR - 1) * HOUR_HEIGHT),
      behavior: "auto",
    });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-[var(--color-border-subtle)] bg-white shadow-[0_18px_45px_rgba(26,24,20,0.06)]">
      <div className="sticky top-0 z-30 flex border-b border-[var(--color-border-subtle)] bg-white/95 backdrop-blur">
        <div className="shrink-0" style={{ width: TIME_GUTTER_WIDTH }} />
        <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(156px, 1fr))` }}>
          {days.map((day) => (
            <DayHeader key={day.toISOString()} day={day} selected={format(day, "yyyy-MM-dd") === format(selectedDate, "yyyy-MM-dd")} onClick={onGoToDate} />
          ))}
        </div>
      </div>

      {hasAllDayEvents ? (
        <div className="flex border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
          <div className="flex shrink-0 items-center justify-end pr-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]" style={{ width: TIME_GUTTER_WIDTH }}>
            Dia todo
          </div>
          <div className="grid min-w-0 flex-1 gap-px p-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(156px, 1fr))` }}>
            {days.map((day) => (
              <div key={day.toISOString()} className="min-h-7 space-y-1">
                {allDayEventsForDay(events, day).slice(0, 2).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    draggable
                    onDragStart={(dragEvent) => {
                      const durationMs = parseISO(event.end_time).getTime() - parseISO(event.start_time).getTime();
                      dragEvent.dataTransfer.setData("application/calendar-event", JSON.stringify({ id: event.id, durationMs, allDay: true }));
                      dragEvent.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={(clickEvent) => {
                      const rect = clickEvent.currentTarget.getBoundingClientRect();
                      onSelectEvent(event, {
                        top: Math.min(rect.bottom + 8, window.innerHeight - 260),
                        left: Math.min(rect.left, window.innerWidth - 340),
                      });
                    }}
                    className="block w-full truncate rounded-md bg-[var(--color-primary-50)] px-2 py-1 text-left text-[11px] font-semibold text-[var(--color-primary-700)] hover:bg-[var(--color-primary-100)]"
                  >
                    {event.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div ref={scrollRef} className="flex min-h-0 flex-1 overflow-auto">
        <TimeGutter />
        <div className="grid min-w-[1092px] flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(156px, 1fr))` }}>
          {days.map((day) => (
            <DayColumn
              key={day.toISOString()}
              day={day}
              events={events}
              onCreateFromSelection={onCreateFromSelection}
              onSelectEvent={onSelectEvent}
              onMoveEvent={onMoveEvent}
              onResizeEvent={onResizeEvent}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
