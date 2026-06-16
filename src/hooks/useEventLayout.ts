import { useMemo } from "react";
import { endOfDay, parseISO, startOfDay } from "date-fns";

import type { CalendarEvent } from "@/types/calendar";

export const HOUR_HEIGHT = 64;
export const DAY_START_HOUR = 0;
export const DAY_END_HOUR = 24;
export const SNAP_MINUTES = 15;
export const MIN_EVENT_MINUTES = 15;
export const TIME_GUTTER_WIDTH = 64;
export const GRID_HEIGHT = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_HEIGHT;

export type CalendarEventLayout = {
  event: CalendarEvent;
  top: number;
  height: number;
  left: string;
  width: string;
  zIndex: number;
};

type EventInterval = {
  event: CalendarEvent;
  startMinutes: number;
  endMinutes: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function eventOverlapsDay(event: CalendarEvent, day: Date) {
  const start = parseISO(event.start_time);
  const end = parseISO(event.end_time);
  return start < endOfDay(day) && end > startOfDay(day);
}

function getMinutesInDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function toVisibleInterval(event: CalendarEvent, day: Date): EventInterval | null {
  if (event.all_day || !eventOverlapsDay(event, day)) {
    return null;
  }

  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  const eventStart = parseISO(event.start_time);
  const eventEnd = parseISO(event.end_time);
  const visibleStart = eventStart < dayStart ? dayStart : eventStart;
  const visibleEnd = eventEnd > dayEnd ? dayEnd : eventEnd;

  const startMinutes = clamp(getMinutesInDay(visibleStart), DAY_START_HOUR * 60, DAY_END_HOUR * 60);
  const endMinutes = clamp(getMinutesInDay(visibleEnd), DAY_START_HOUR * 60, DAY_END_HOUR * 60);

  return {
    event,
    startMinutes,
    endMinutes: Math.max(endMinutes, startMinutes + MIN_EVENT_MINUTES),
  };
}

function overlaps(left: EventInterval, right: EventInterval) {
  return left.startMinutes < right.endMinutes && left.endMinutes > right.startMinutes;
}

function assignColumns(intervals: EventInterval[]) {
  const sorted = [...intervals].sort((left, right) => {
    if (left.startMinutes !== right.startMinutes) return left.startMinutes - right.startMinutes;
    return right.endMinutes - right.startMinutes - (left.endMinutes - left.startMinutes);
  });

  const columnMap = new Map<string, { column: number; totalColumns: number }>();
  const visited = new Set<string>();

  for (const interval of sorted) {
    if (visited.has(interval.event.id)) continue;

    const group: EventInterval[] = [interval];
    visited.add(interval.event.id);

    for (const candidate of sorted) {
      if (visited.has(candidate.event.id)) continue;
      if (group.some((grouped) => overlaps(grouped, candidate))) {
        group.push(candidate);
        visited.add(candidate.event.id);
      }
    }

    const columns: EventInterval[][] = [];

    for (const grouped of group.sort((left, right) => left.startMinutes - right.startMinutes)) {
      const availableColumn = columns.findIndex((column) => {
        const last = column[column.length - 1];
        return !overlaps(last, grouped);
      });

      if (availableColumn === -1) {
        columns.push([grouped]);
        columnMap.set(grouped.event.id, { column: columns.length - 1, totalColumns: 0 });
      } else {
        columns[availableColumn].push(grouped);
        columnMap.set(grouped.event.id, { column: availableColumn, totalColumns: 0 });
      }
    }

    for (const grouped of group) {
      const assignment = columnMap.get(grouped.event.id);
      if (assignment) {
        assignment.totalColumns = columns.length;
      }
    }
  }

  return columnMap;
}

export function minutesToTop(minutes: number) {
  return ((minutes - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT;
}

export function snapMinutes(minutes: number) {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

export function yToSnappedMinutes(y: number) {
  const rawMinutes = DAY_START_HOUR * 60 + (y / HOUR_HEIGHT) * 60;
  return clamp(snapMinutes(rawMinutes), DAY_START_HOUR * 60, DAY_END_HOUR * 60 - SNAP_MINUTES);
}

export function minutesToTimeLabel(minutes: number) {
  const safeMinutes = clamp(minutes, 0, DAY_END_HOUR * 60);
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function dateWithMinutes(day: Date, minutes: number) {
  const nextDate = new Date(day);
  nextDate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return nextDate;
}

export function layoutEventsForDay(events: CalendarEvent[], day: Date): CalendarEventLayout[] {
  const intervals = events
    .map((event) => toVisibleInterval(event, day))
    .filter((interval): interval is EventInterval => interval !== null);

  const columnMap = assignColumns(intervals);

  return intervals.map((interval) => {
    const assignment = columnMap.get(interval.event.id) ?? { column: 0, totalColumns: 1 };
    const widthPercent = 100 / Math.max(assignment.totalColumns, 1);
    const leftPercent = assignment.column * widthPercent;

    return {
      event: interval.event,
      top: minutesToTop(interval.startMinutes),
      height: Math.max(((interval.endMinutes - interval.startMinutes) / 60) * HOUR_HEIGHT, 24),
      left: `${leftPercent}%`,
      width: `calc(${widthPercent}% - 4px)`,
      zIndex: assignment.column + 1,
    };
  });
}

export function allDayEventsForDay(events: CalendarEvent[], day: Date) {
  return events.filter((event) => event.all_day && eventOverlapsDay(event, day));
}

export function useEventLayout(events: CalendarEvent[], day: Date) {
  return useMemo(() => layoutEventsForDay(events, day), [events, day]);
}
