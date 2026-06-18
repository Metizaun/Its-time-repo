import { useEffect, useRef, useCallback } from 'react';
import { HOUR_HEIGHT, DAY_START_HOUR, allDayEventsForDay } from '@/hooks/useEventLayout';
import { TimeGutter } from './TimeGutter';
import { DayColumnHeader } from './DayColumnHeader';
import { DayColumn } from './DayColumn';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';
import { parseISO } from 'date-fns';

interface DayViewProps {
    day: Date;
    events: CalendarEvent[];
    onSelectEvent: (eventId: string) => void;
    onCreateAtTime: (day: Date, hour: number, minutes: number) => void;
    onMoveOrResizeEvent?: (payload: { id: string; start_time: string; end_time: string; all_day: boolean; }) => Promise<void>;
}

export function DayView({ day, events, onSelectEvent, onCreateAtTime, onMoveOrResizeEvent }: DayViewProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    const handleDropEvent = useCallback((eventId: string, day: Date, durationMs: number | undefined, newStartHour: number, newStartMinutes: number, wasAllDay?: boolean) => {
        if (!onMoveOrResizeEvent) return;
        const start = new Date(day);
        start.setHours(newStartHour, newStartMinutes, 0, 0);

        let endMs = start.getTime() + (durationMs || 60 * 60 * 1000);
        const end = new Date(endMs);

        onMoveOrResizeEvent({
            id: eventId,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            all_day: false,
        });
    }, [onMoveOrResizeEvent]);

    useEffect(() => {
        if (!scrollRef.current) return;
        const now = new Date();
        const currentHour = now.getHours();
        const scrollTarget = Math.max(0, (currentHour - DAY_START_HOUR - 1) * HOUR_HEIGHT);
        scrollRef.current.scrollTop = scrollTarget;
    }, []);

    const allDay = allDayEventsForDay(events, day);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex border-b border-border/40 z-10 shrink-0">
                <div style={{ width: 56 }} className="shrink-0" />
                <div className="flex-1">
                    <DayColumnHeader day={day} />
                </div>
            </div>

            {/* All-day bar */}
            {allDay.length > 0 && (
                <div className="flex border-b border-border/40 shrink-0">
                    <div style={{ width: 56 }} className="shrink-0 flex items-center justify-end pr-2">
                        <span className="text-[10px] text-muted-foreground">dia todo</span>
                    </div>
                    <div className="flex-1 flex flex-wrap gap-1 p-1 min-h-[28px]">
                        {allDay.map((event) => (
                            <button
                                key={event.id}
                                type="button"
                                draggable
                                onDragStart={(e) => {
                                    const durationMs = parseISO(event.end_time).getTime() - parseISO(event.start_time).getTime();
                                    e.dataTransfer.setData('application/calendar-event', JSON.stringify({
                                        id: event.id,
                                        durationMs,
                                        allDay: true
                                    }));
                                    e.dataTransfer.effectAllowed = 'move';
                                }}
                                onClick={() => onSelectEvent(event.id)}
                                className="text-[11px] font-medium px-2 py-0.5 rounded bg-primary/10 text-primary
                  hover:bg-primary/20 transition-colors"
                            >
                                {event.title}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Time grid */}
            <div ref={scrollRef} className="flex overflow-y-auto overflow-x-hidden flex-1">
                <TimeGutter />
                <div className="flex-1">
                    <DayColumn
                        day={day}
                        events={events}
                        onSelectEvent={onSelectEvent}
                        onCreateAtTime={onCreateAtTime}
                        onDropEvent={(eventId, durationMs, hour, minutes, allDay) =>
                            handleDropEvent(eventId, day, durationMs, hour, minutes, allDay)
                        }
                    />
                </div>
            </div>
        </div>
    );
}
