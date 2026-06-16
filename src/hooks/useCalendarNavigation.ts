import { useCallback, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { ptBR } from "date-fns/locale";

import type { CalendarViewMode } from "@/types/calendar";

const WEEK_STARTS_ON = 0;

function buildMonthWeeks(currentDate: Date) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: WEEK_STARTS_ON });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const weeks: Date[][] = [];

  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }

  return weeks;
}

function getVisibleRange(viewMode: CalendarViewMode, currentDate: Date) {
  if (viewMode === "month") {
    return {
      start: startOfWeek(startOfMonth(currentDate), { weekStartsOn: WEEK_STARTS_ON }),
      end: endOfWeek(endOfMonth(currentDate), { weekStartsOn: WEEK_STARTS_ON }),
    };
  }

  if (viewMode === "week") {
    return {
      start: startOfWeek(currentDate, { weekStartsOn: WEEK_STARTS_ON }),
      end: endOfWeek(currentDate, { weekStartsOn: WEEK_STARTS_ON }),
    };
  }

  return {
    start: startOfDay(currentDate),
    end: endOfDay(currentDate),
  };
}

function getPeriodLabel(viewMode: CalendarViewMode, currentDate: Date) {
  if (viewMode === "month") {
    return format(currentDate, "MMMM 'de' yyyy", { locale: ptBR });
  }

  if (viewMode === "day") {
    return format(currentDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
  }

  const start = startOfWeek(currentDate, { weekStartsOn: WEEK_STARTS_ON });
  const end = endOfWeek(currentDate, { weekStartsOn: WEEK_STARTS_ON });

  if (start.getMonth() === end.getMonth()) {
    return `${format(start, "d", { locale: ptBR })} - ${format(end, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}`;
  }

  return `${format(start, "d 'de' MMM", { locale: ptBR })} - ${format(end, "d 'de' MMM 'de' yyyy", { locale: ptBR })}`;
}

export function useCalendarNavigation(initialDate = new Date(), initialView: CalendarViewMode = "week") {
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [viewMode, setViewMode] = useState<CalendarViewMode>(initialView);

  const visibleRange = useMemo(
    () => getVisibleRange(viewMode, currentDate),
    [currentDate, viewMode]
  );

  const weekDays = useMemo(
    () => eachDayOfInterval({
      start: startOfWeek(currentDate, { weekStartsOn: WEEK_STARTS_ON }),
      end: endOfWeek(currentDate, { weekStartsOn: WEEK_STARTS_ON }),
    }),
    [currentDate]
  );

  const monthWeeks = useMemo(() => buildMonthWeeks(currentDate), [currentDate]);
  const periodLabel = useMemo(() => getPeriodLabel(viewMode, currentDate), [currentDate, viewMode]);

  const goToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const goToDate = useCallback((date: Date) => {
    setCurrentDate(date);
  }, []);

  const goNext = useCallback(() => {
    setCurrentDate((date) => {
      if (viewMode === "month") return addMonths(date, 1);
      if (viewMode === "week") return addWeeks(date, 1);
      return addDays(date, 1);
    });
  }, [viewMode]);

  const goPrevious = useCallback(() => {
    setCurrentDate((date) => {
      if (viewMode === "month") return subMonths(date, 1);
      if (viewMode === "week") return subWeeks(date, 1);
      return subDays(date, 1);
    });
  }, [viewMode]);

  return {
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
  };
}
