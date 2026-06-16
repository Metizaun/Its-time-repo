import { useEffect, useRef } from "react";
import { parseISO } from "date-fns";

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

type DayViewProps = {
  day: Date;
  events: CalendarEvent[];
  onCreateFromSelection: (selection: { start: Date; end: Date; allDay: boolean }) => void;
  onSelectEvent: (event: CalendarEvent, position: { top: number; left: number }) => void;
  onMoveEvent: (event: CalendarEvent, start: Date, end: Date, allDay: boolean) => void;
  onResizeEvent: (event: CalendarEvent, end: Date) => void;
};

export function DayView({
  day,
  events,
  onCreateFromSelection,
  onSelectEvent,
  onMoveEvent,
  onResizeEvent,
}: DayViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const allDayEvents = allDayEventsForDay(events, day);

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
        <div className="min-w-0 flex-1">
          <DayHeader day={day} />
        </div>
      </div>

      {allDayEvents.length > 0 ? (
        <div className="flex border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
          <div className="flex shrink-0 items-center justify-end pr-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-muted)]" style={{ width: TIME_GUTTER_WIDTH }}>
            Dia todo
          </div>
          <div className="flex min-h-9 flex-1 flex-wrap gap-1 p-1.5">
            {allDayEvents.map((event) => (
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
                className="rounded-md bg-[var(--color-primary-50)] px-2 py-1 text-[11px] font-semibold text-[var(--color-primary-700)] hover:bg-[var(--color-primary-100)]"
              >
                {event.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div ref={scrollRef} className="flex min-h-0 flex-1 overflow-auto">
        <TimeGutter />
        <div className="min-w-[620px] flex-1">
          <DayColumn
            day={day}
            events={events}
            onCreateFromSelection={onCreateFromSelection}
            onSelectEvent={onSelectEvent}
            onMoveEvent={onMoveEvent}
            onResizeEvent={onResizeEvent}
          />
        </div>
      </div>
    </div>
  );
}
