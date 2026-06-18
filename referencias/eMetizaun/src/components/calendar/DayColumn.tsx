import { useCallback, useMemo, useRef, useState } from 'react';
import { isToday } from 'date-fns';
import { HOUR_HEIGHT, DAY_START_HOUR, DAY_END_HOUR, GRID_HEIGHT, layoutEventsForDay } from '@/hooks/useEventLayout';
import { EventBlock } from './EventBlock';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';

interface DayColumnProps {
    day: Date;
    events: CalendarEvent[];
    onSelectEvent: (eventId: string) => void;
    onCreateAtTime: (day: Date, hour: number, minutes: number) => void;
    onDropEvent?: (eventId: string, durationMs: number, newStartHour: number, newStartMinutes: number, allDay?: boolean) => void;
}

/** Convert a pixel Y offset inside the grid to snapped (hour, minute) tuple */
function yToTime(y: number, snapMinutes: number = 15): { hour: number; minutes: number; totalMinutes: number } {
    const rawMinutes = (y / HOUR_HEIGHT) * 60 + DAY_START_HOUR * 60;
    const snapped = Math.round(rawMinutes / snapMinutes) * snapMinutes;
    const clamped = Math.max(DAY_START_HOUR * 60, Math.min(DAY_END_HOUR * 60 - 1, snapped));
    return {
        hour: Math.floor(clamped / 60),
        minutes: clamped % 60,
        totalMinutes: clamped,
    };
}

function formatTime(hour: number, minutes: number): string {
    return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function DayColumn({ day, events, onSelectEvent, onCreateAtTime, onDropEvent }: DayColumnProps) {
    const today = isToday(day);
    const layouts = useMemo(() => layoutEventsForDay(events, day), [events, day]);

    // Drag preview state
    const [dragPreview, setDragPreview] = useState<{
        top: number;
        height: number;
        label: string;
    } | null>(null);

    const dragDataRef = useRef<{ id: string; durationMs: number } | null>(null);

    const handleSlotClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            // Don't create event if clicking on an event block
            if ((e.target as HTMLElement).closest('button')) return;

            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const { hour, minutes } = yToTime(y);
            onCreateAtTime(day, hour, minutes);
        },
        [day, onCreateAtTime],
    );

    const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        // Try to parse event data from the first dragover if we haven't yet
        if (!dragDataRef.current) {
            // We can't read dataTransfer data during dragover (browser security)
            // but we can use the types to confirm it's our event
            const hasEventData = e.dataTransfer.types.includes('application/calendar-event');
            if (!hasEventData) return;
            // We'll set a placeholder; the actual data comes on drop
            dragDataRef.current = { id: '__pending__', durationMs: 60 * 60 * 1000 };
        }

        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const { hour, minutes, totalMinutes } = yToTime(y);

        // Default 1h if we don't know duration yet
        const durationMs = dragDataRef.current?.durationMs || 60 * 60 * 1000;
        const durationMinutes = durationMs / (60 * 1000);
        const endTotalMinutes = Math.min(totalMinutes + durationMinutes, DAY_END_HOUR * 60);
        const endHour = Math.floor(endTotalMinutes / 60);
        const endMin = endTotalMinutes % 60;

        const topPx = ((totalMinutes - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT;
        const heightPx = ((endTotalMinutes - totalMinutes) / 60) * HOUR_HEIGHT;

        setDragPreview({
            top: topPx,
            height: Math.max(heightPx, 20),
            label: `${formatTime(hour, minutes)} – ${formatTime(endHour, endMin)}`,
        });
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        // Only clear if we're actually leaving the column, not entering a child
        const related = e.relatedTarget as Node | null;
        if (!related || !e.currentTarget.contains(related)) {
            setDragPreview(null);
            dragDataRef.current = null;
        }
    }, []);

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragPreview(null);
        dragDataRef.current = null;

        const raw = e.dataTransfer.getData('application/calendar-event');
        if (!raw || !onDropEvent) return;

        try {
            const { id, durationMs, allDay } = JSON.parse(raw);

            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const { hour, minutes } = yToTime(y);

            onDropEvent(id, durationMs, hour, minutes, allDay);
        } catch (err) {
            console.error('Failed to parse dropped event data');
        }
    }, [onDropEvent]);

    // Current time indicator
    const nowIndicator = useMemo(() => {
        if (!today) return null;
        const now = new Date();
        const minutesSinceStart = (now.getHours() * 60 + now.getMinutes()) - DAY_START_HOUR * 60;
        if (minutesSinceStart < 0 || minutesSinceStart > (DAY_END_HOUR - DAY_START_HOUR) * 60) return null;
        const top = (minutesSinceStart / 60) * HOUR_HEIGHT;
        return top;
    }, [today]);

    const hours: number[] = [];
    for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h++) {
        hours.push(h);
    }

    return (
        <div
            className="relative border-l border-border/30 cursor-pointer"
            style={{ height: GRID_HEIGHT }}
            onClick={handleSlotClick}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Hour grid lines */}
            {hours.map((hour) => (
                <div
                    key={hour}
                    className="absolute w-full border-t border-border/30"
                    style={{ top: (hour - DAY_START_HOUR) * HOUR_HEIGHT }}
                >
                    {/* Half-hour line */}
                    <div
                        className="absolute w-full border-t border-border/15"
                        style={{ top: HOUR_HEIGHT / 2 }}
                    />
                </div>
            ))}

            {/* Events */}
            {layouts.map((layout) => (
                <EventBlock
                    key={layout.event.id}
                    layout={layout}
                    onClick={onSelectEvent}
                />
            ))}

            {/* Drag preview ghost */}
            {dragPreview && (
                <div
                    className="absolute left-0 right-0 z-30 pointer-events-none rounded border-2 border-dashed border-primary/50 bg-primary/10"
                    style={{ top: dragPreview.top, height: dragPreview.height }}
                >
                    <span className="absolute -top-5 left-1 text-[10px] font-semibold text-primary bg-background/90 px-1.5 py-0.5 rounded shadow-sm whitespace-nowrap">
                        {dragPreview.label}
                    </span>
                </div>
            )}

            {/* Current time indicator */}
            {nowIndicator !== null && (
                <div
                    className="absolute left-0 right-0 z-20 pointer-events-none"
                    style={{ top: nowIndicator }}
                >
                    <div className="flex items-center">
                        <div className="h-2.5 w-2.5 rounded-full bg-red-500 -ml-[5px] shrink-0" />
                        <div className="h-[2px] w-full bg-red-500" />
                    </div>
                </div>
            )}
        </div>
    );
}
