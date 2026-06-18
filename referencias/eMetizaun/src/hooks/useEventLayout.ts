import { useMemo } from 'react';
import { isSameDay, parseISO } from 'date-fns';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';

/** Height in pixels for one hour in the time grid */
export const HOUR_HEIGHT = 60;

/** First visible hour in the grid (0 = 00:00) */
export const DAY_START_HOUR = 0;

/** Last visible hour in the grid (24 = 24:00, i.e. midnight end) */
export const DAY_END_HOUR = 24;

/** Total visible hours */
export const VISIBLE_HOURS = DAY_END_HOUR - DAY_START_HOUR;

/** Total grid height in pixels */
export const GRID_HEIGHT = VISIBLE_HOURS * HOUR_HEIGHT;

export interface LayoutRect {
    top: number;
    height: number;
    left: string;
    width: string;
    zIndex: number;
    event: CalendarEvent;
}

interface EventInterval {
    startMinutes: number;
    endMinutes: number;
    event: CalendarEvent;
}

function timeToMinutes(isoString: string): number {
    const d = parseISO(isoString);
    return d.getHours() * 60 + d.getMinutes();
}

function clampMinutes(minutes: number): number {
    const min = DAY_START_HOUR * 60;
    const max = DAY_END_HOUR * 60;
    return Math.max(min, Math.min(max, minutes));
}

function intervalsOverlap(a: EventInterval, b: EventInterval): boolean {
    return a.startMinutes < b.endMinutes && a.endMinutes > b.startMinutes;
}

/**
 * Groups overlapping events into collision clusters,
 * then assigns column index and total columns to each.
 */
function assignColumns(intervals: EventInterval[]): Map<string, { col: number; totalCols: number }> {
    if (intervals.length === 0) return new Map();

    // Sort by start time, then by longer duration first
    const sorted = [...intervals].sort((a, b) => {
        if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
        return (b.endMinutes - b.startMinutes) - (a.endMinutes - a.startMinutes);
    });

    // Build collision groups using a greedy approach
    const groups: EventInterval[][] = [];
    const visited = new Set<string>();

    for (const interval of sorted) {
        if (visited.has(interval.event.id)) continue;

        const group: EventInterval[] = [interval];
        visited.add(interval.event.id);

        for (const other of sorted) {
            if (visited.has(other.event.id)) continue;
            // Check if 'other' overlaps with ANY member of the current group
            const overlapsGroup = group.some((member) => intervalsOverlap(member, other));
            if (overlapsGroup) {
                group.push(other);
                visited.add(other.event.id);
            }
        }

        groups.push(group);
    }

    const result = new Map<string, { col: number; totalCols: number }>();

    for (const group of groups) {
        // Sort group by start time
        group.sort((a, b) => a.startMinutes - b.startMinutes);

        const columns: EventInterval[][] = [];

        for (const interval of group) {
            let placed = false;
            for (let c = 0; c < columns.length; c++) {
                const lastInCol = columns[c][columns[c].length - 1];
                if (!intervalsOverlap(lastInCol, interval)) {
                    columns[c].push(interval);
                    result.set(interval.event.id, { col: c, totalCols: 0 });
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                columns.push([interval]);
                result.set(interval.event.id, { col: columns.length - 1, totalCols: 0 });
            }
        }

        // Set totalCols for all events in this group
        const totalCols = columns.length;
        for (const interval of group) {
            const entry = result.get(interval.event.id);
            if (entry) entry.totalCols = totalCols;
        }
    }

    return result;
}

/**
 * Returns positioned layout rects for all events on a specific day.
 */
export function layoutEventsForDay(events: CalendarEvent[], day: Date): LayoutRect[] {
    const dayEvents = events.filter((e) => {
        if (e.all_day) return false;
        const start = parseISO(e.start_time);
        return isSameDay(start, day);
    });

    if (dayEvents.length === 0) return [];

    const intervals: EventInterval[] = dayEvents.map((e) => ({
        startMinutes: clampMinutes(timeToMinutes(e.start_time)),
        endMinutes: clampMinutes(timeToMinutes(e.end_time)),
        event: e,
    }));

    // Ensure minimum height (15 min)
    for (const interval of intervals) {
        if (interval.endMinutes - interval.startMinutes < 15) {
            interval.endMinutes = Math.min(interval.startMinutes + 15, DAY_END_HOUR * 60);
        }
    }

    const columnMap = assignColumns(intervals);

    return intervals.map((interval) => {
        const offsetMinutes = interval.startMinutes - DAY_START_HOUR * 60;
        const durationMinutes = interval.endMinutes - interval.startMinutes;

        const top = (offsetMinutes / 60) * HOUR_HEIGHT;
        const height = Math.max((durationMinutes / 60) * HOUR_HEIGHT, 20);

        const layout = columnMap.get(interval.event.id) ?? { col: 0, totalCols: 1 };
        const widthPercent = 100 / layout.totalCols;
        const leftPercent = widthPercent * layout.col;

        return {
            top,
            height,
            left: `${leftPercent}%`,
            width: `calc(${widthPercent}% - 2px)`,
            zIndex: layout.col + 1,
            event: interval.event,
        };
    });
}

/**
 * Returns all-day events for a specific day.
 */
export function allDayEventsForDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
    return events.filter((e) => {
        if (!e.all_day) return false;
        const start = parseISO(e.start_time);
        const end = parseISO(e.end_time);
        return (
            isSameDay(start, day) ||
            isSameDay(end, day) ||
            (start <= day && end >= day)
        );
    });
}

/**
 * Hook wrapper for layoutEventsForDay, memoized per day.
 */
export function useEventLayout(events: CalendarEvent[], day: Date): LayoutRect[] {
    return useMemo(() => layoutEventsForDay(events, day), [events, day]);
}
