import { useCallback, useMemo, useState } from 'react';
import {
    startOfWeek,
    endOfWeek,
    addWeeks,
    subWeeks,
    addDays,
    subDays,
    addMonths,
    subMonths,
    startOfMonth,
    endOfMonth,
    eachDayOfInterval,
    isSameDay,
    isToday,
    format,
    getDay,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

export type CalendarView = 'week' | 'day' | 'month';

export interface CalendarNavigation {
    currentDate: Date;
    view: CalendarView;
    goNext: () => void;
    goPrev: () => void;
    goToday: () => void;
    goToDate: (date: Date) => void;
    setView: (view: CalendarView) => void;
    weekDays: Date[];
    monthWeeks: Date[][];
    visibleRange: { start: Date; end: Date };
    periodLabel: string;
}

export function useCalendarNavigation(
    initialDate?: Date,
    initialView: CalendarView = 'week',
): CalendarNavigation {
    const [currentDate, setCurrentDate] = useState(initialDate ?? new Date());
    const [view, setView] = useState<CalendarView>(initialView);

    const weekStart = useMemo(
        () => startOfWeek(currentDate, { weekStartsOn: 0 }),
        [currentDate],
    );
    const weekEnd = useMemo(
        () => endOfWeek(currentDate, { weekStartsOn: 0 }),
        [currentDate],
    );

    const weekDays = useMemo(
        () => eachDayOfInterval({ start: weekStart, end: weekEnd }),
        [weekStart, weekEnd],
    );

    const monthWeeks = useMemo(() => {
        const mStart = startOfMonth(currentDate);
        const mEnd = endOfMonth(currentDate);
        const calStart = startOfWeek(mStart, { weekStartsOn: 0 });
        const calEnd = endOfWeek(mEnd, { weekStartsOn: 0 });
        const allDays = eachDayOfInterval({ start: calStart, end: calEnd });
        const weeks: Date[][] = [];
        for (let i = 0; i < allDays.length; i += 7) {
            weeks.push(allDays.slice(i, i + 7));
        }
        return weeks;
    }, [currentDate]);

    const visibleRange = useMemo(() => {
        switch (view) {
            case 'week':
                return { start: weekStart, end: weekEnd };
            case 'day':
                return {
                    start: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 0, 0, 0),
                    end: new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), 23, 59, 59),
                };
            case 'month': {
                const mStart = startOfMonth(currentDate);
                const mEnd = endOfMonth(currentDate);
                const calStart = startOfWeek(mStart, { weekStartsOn: 0 });
                const calEnd = endOfWeek(mEnd, { weekStartsOn: 0 });
                return { start: calStart, end: calEnd };
            }
        }
    }, [view, currentDate, weekStart, weekEnd]);

    const periodLabel = useMemo(() => {
        switch (view) {
            case 'day':
                return format(currentDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
            case 'week': {
                const wStart = weekStart;
                const wEnd = weekEnd;
                if (wStart.getMonth() === wEnd.getMonth()) {
                    return `${format(wStart, 'd', { locale: ptBR })}–${format(wEnd, "d 'de' MMM yyyy", { locale: ptBR })}`;
                }
                return `${format(wStart, "d 'de' MMM", { locale: ptBR })} – ${format(wEnd, "d 'de' MMM yyyy", { locale: ptBR })}`;
            }
            case 'month':
                return format(currentDate, "MMMM 'de' yyyy", { locale: ptBR });
        }
    }, [view, currentDate, weekStart, weekEnd]);

    const goNext = useCallback(() => {
        setCurrentDate((prev) => {
            switch (view) {
                case 'week': return addWeeks(prev, 1);
                case 'day': return addDays(prev, 1);
                case 'month': return addMonths(prev, 1);
            }
        });
    }, [view]);

    const goPrev = useCallback(() => {
        setCurrentDate((prev) => {
            switch (view) {
                case 'week': return subWeeks(prev, 1);
                case 'day': return subDays(prev, 1);
                case 'month': return subMonths(prev, 1);
            }
        });
    }, [view]);

    const goToday = useCallback(() => {
        setCurrentDate(new Date());
    }, []);

    const goToDate = useCallback((date: Date) => {
        setCurrentDate(date);
    }, []);

    return {
        currentDate,
        view,
        goNext,
        goPrev,
        goToday,
        goToDate,
        setView,
        weekDays,
        monthWeeks,
        visibleRange,
        periodLabel,
    };
}
