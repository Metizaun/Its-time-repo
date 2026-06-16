import { useCallback, useMemo, useState } from "react";
import { isToday, parseISO } from "date-fns";

import { EventBlock } from "@/components/calendar/EventBlock";
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  GRID_HEIGHT,
  HOUR_HEIGHT,
  dateWithMinutes,
  layoutEventsForDay,
  minutesToTimeLabel,
  minutesToTop,
  yToSnappedMinutes,
} from "@/hooks/useEventLayout";
import { cn } from "@/lib/utils";
import type { CalendarEvent } from "@/types/calendar";

type DayColumnProps = {
  day: Date;
  events: CalendarEvent[];
  onCreateFromSelection: (selection: { start: Date; end: Date; allDay: boolean }) => void;
  onSelectEvent: (event: CalendarEvent, position: { top: number; left: number }) => void;
  onMoveEvent: (event: CalendarEvent, start: Date, end: Date, allDay: boolean) => void;
  onResizeEvent: (event: CalendarEvent, end: Date) => void;
};

function getDropPayload(dataTransfer: DataTransfer) {
  const raw = dataTransfer.getData("application/calendar-event");
  if (!raw) return null;

  try {
    return JSON.parse(raw) as { id: string; durationMs?: number; allDay?: boolean };
  } catch {
    return null;
  }
}

export function DayColumn({
  day,
  events,
  onCreateFromSelection,
  onSelectEvent,
  onMoveEvent,
  onResizeEvent,
}: DayColumnProps) {
  const [dragPreview, setDragPreview] = useState<{ top: number; height: number; label: string } | null>(null);
  const layouts = useMemo(() => layoutEventsForDay(events, day), [day, events]);
  const today = isToday(day);
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, index) => DAY_START_HOUR + index);

  const createAtPointer = useCallback(
    (element: HTMLElement, clientY: number) => {
      const rect = element.getBoundingClientRect();
      const minutes = yToSnappedMinutes(clientY - rect.top);
      const start = dateWithMinutes(day, minutes);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      onCreateFromSelection({ start, end, allDay: false });
    },
    [day, onCreateFromSelection]
  );

  return (
    <div
      className={cn(
        "relative min-w-[156px] cursor-crosshair border-l border-[var(--color-border-subtle)] bg-white",
        today && "bg-[linear-gradient(180deg,rgba(255,243,238,0.45),rgba(255,255,255,0)_18%)]"
      )}
      style={{ height: GRID_HEIGHT }}
      onClick={(clickEvent) => {
        if ((clickEvent.target as HTMLElement).closest("[data-calendar-event-block]")) return;
        createAtPointer(clickEvent.currentTarget, clickEvent.clientY);
      }}
      onDragOver={(dragEvent) => {
        if (!dragEvent.dataTransfer.types.includes("application/calendar-event")) return;
        dragEvent.preventDefault();
        dragEvent.dataTransfer.dropEffect = "move";

        const rect = dragEvent.currentTarget.getBoundingClientRect();
        const minutes = yToSnappedMinutes(dragEvent.clientY - rect.top);
        const defaultDurationMinutes = 60;
        const endMinutes = Math.min(minutes + defaultDurationMinutes, DAY_END_HOUR * 60);

        setDragPreview({
          top: minutesToTop(minutes),
          height: Math.max(((endMinutes - minutes) / 60) * HOUR_HEIGHT, 24),
          label: `${minutesToTimeLabel(minutes)} - ${minutesToTimeLabel(endMinutes)}`,
        });
      }}
      onDragLeave={(dragEvent) => {
        const relatedTarget = dragEvent.relatedTarget as Node | null;
        if (!relatedTarget || !dragEvent.currentTarget.contains(relatedTarget)) {
          setDragPreview(null);
        }
      }}
      onDrop={(dropEvent) => {
        dropEvent.preventDefault();
        setDragPreview(null);

        const payload = getDropPayload(dropEvent.dataTransfer);
        if (!payload) return;

        const event = events.find((candidate) => candidate.id === payload.id);
        if (!event) return;

        const rect = dropEvent.currentTarget.getBoundingClientRect();
        const minutes = yToSnappedMinutes(dropEvent.clientY - rect.top);
        const start = dateWithMinutes(day, minutes);
        const durationMs =
          payload.durationMs ??
          Math.max(parseISO(event.end_time).getTime() - parseISO(event.start_time).getTime(), 60 * 60 * 1000);
        const end = new Date(start.getTime() + durationMs);

        onMoveEvent(event, start, end, false);
      }}
    >
      {hours.map((hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 border-t border-[var(--color-border-subtle)]"
          style={{ top: (hour - DAY_START_HOUR) * HOUR_HEIGHT }}
        >
          <div className="absolute inset-x-0 border-t border-[rgba(26,24,20,0.035)]" style={{ top: HOUR_HEIGHT / 2 }} />
        </div>
      ))}

      {layouts.map((layout) => (
        <EventBlock
          key={layout.event.id}
          layout={layout}
          onSelectEvent={onSelectEvent}
          onResizeEvent={(event, deltaMinutes) => {
            const currentEnd = parseISO(event.end_time);
            const nextEnd = new Date(currentEnd.getTime() + deltaMinutes * 60 * 1000);
            const minEnd = new Date(parseISO(event.start_time).getTime() + 15 * 60 * 1000);
            onResizeEvent(event, nextEnd < minEnd ? minEnd : nextEnd);
          }}
        />
      ))}

      {dragPreview ? (
        <div
          className="pointer-events-none absolute left-1 right-1 z-30 rounded-lg border border-dashed border-[var(--color-primary-300)] bg-[var(--color-primary-50)]/70"
          style={{ top: dragPreview.top, height: dragPreview.height }}
        >
          <span className="absolute -top-6 left-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary-700)] shadow-sm">
            {dragPreview.label}
          </span>
        </div>
      ) : null}

      {today ? <CurrentTimeIndicator /> : null}
    </div>
  );
}

function CurrentTimeIndicator() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = DAY_START_HOUR * 60;
  const endMinutes = DAY_END_HOUR * 60;

  if (minutes < startMinutes || minutes > endMinutes) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute left-0 right-0 z-40" style={{ top: minutesToTop(minutes) }}>
      <div className="flex items-center">
        <div className="-ml-[5px] h-2.5 w-2.5 rounded-full bg-[var(--color-primary-500)]" />
        <div className="h-[2px] flex-1 bg-[var(--color-primary-500)]" />
      </div>
    </div>
  );
}
