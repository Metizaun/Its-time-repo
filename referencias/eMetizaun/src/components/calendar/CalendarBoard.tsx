import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCalendarNavigation, type CalendarView } from '@/hooks/useCalendarNavigation';
import { CalendarHeader } from './CalendarHeader';
import { CalendarSidebar } from './CalendarSidebar';
import { WeekView } from './WeekView';
import { DayView } from './DayView';
import { MonthView } from './MonthView';
import type { CalendarEvent, CalendarEventStatus } from '@/hooks/useCalendarEvents';

interface CalendarBoardProps {
  events: CalendarEvent[];
  loading?: boolean;
  onRangeChange: (start: string, end: string) => void;
  onCreateFromSelection: (selection: { start: string; end: string; allDay: boolean }) => void;
  onSelectEvent: (eventId: string) => void;
  onMoveOrResizeEvent: (payload: {
    id: string;
    start_time: string;
    end_time: string;
    all_day: boolean;
  }) => Promise<void>;
  onNewEvent: () => void;
  tableMissing?: boolean;
}

const ALL_STATUSES: CalendarEventStatus[] = ['scheduled', 'confirmed', 'cancelled', 'done', 'no_show'];

export function CalendarBoard({
  events,
  loading = false,
  onRangeChange,
  onCreateFromSelection,
  onSelectEvent,
  onMoveOrResizeEvent,
  onNewEvent,
  tableMissing,
}: CalendarBoardProps) {
  const nav = useCalendarNavigation();
  const [statusFilters, setStatusFilters] = useState<CalendarEventStatus[]>([...ALL_STATUSES]);

  // Notify parent when visible range changes
  useEffect(() => {
    const { start, end } = nav.visibleRange;
    onRangeChange(start.toISOString(), end.toISOString());
  }, [nav.visibleRange, onRangeChange]);

  // Filter events by status
  const filteredEvents = useMemo(() => {
    return events.filter((e) => statusFilters.includes(e.status));
  }, [events, statusFilters]);

  // Handle click-to-create on time grid
  const handleCreateAtTime = useCallback(
    (day: Date, hour: number, minutes: number) => {
      const start = new Date(day);
      start.setHours(hour, minutes, 0, 0);
      const end = new Date(start);
      end.setHours(hour + 1, minutes, 0, 0);
      onCreateFromSelection({
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: false,
      });
    },
    [onCreateFromSelection],
  );

  // Handle day click in month view
  const handleMonthDayClick = useCallback(
    (day: Date) => {
      nav.goToDate(day);
      nav.setView('day');
    },
    [nav],
  );

  // Handle sidebar date select
  const handleSidebarDateSelect = useCallback(
    (date: Date) => {
      nav.goToDate(date);
    },
    [nav],
  );

  const renderView = () => {
    switch (nav.view) {
      case 'week':
        return (
          <WeekView
            days={nav.weekDays}
            events={filteredEvents}
            onSelectEvent={onSelectEvent}
            onCreateAtTime={handleCreateAtTime}
            onMoveOrResizeEvent={onMoveOrResizeEvent}
          />
        );
      case 'day':
        return (
          <DayView
            day={nav.currentDate}
            events={filteredEvents}
            onSelectEvent={onSelectEvent}
            onCreateAtTime={handleCreateAtTime}
            onMoveOrResizeEvent={onMoveOrResizeEvent}
          />
        );
      case 'month':
        return (
          <MonthView
            weeks={nav.monthWeeks}
            currentDate={nav.currentDate}
            events={filteredEvents}
            onSelectEvent={onSelectEvent}
            onDayClick={handleMonthDayClick}
            onMoveOrResizeEvent={onMoveOrResizeEvent}
          />
        );
    }
  };

  return (
    <div className="flex flex-col h-full">
      <CalendarHeader
        periodLabel={nav.periodLabel}
        view={nav.view}
        onPrev={nav.goPrev}
        onNext={nav.goNext}
        onToday={nav.goToday}
        onViewChange={nav.setView}
        onNewEvent={onNewEvent}
        disabled={tableMissing}
      />

      <div className="flex gap-4 flex-1 min-h-0">
        <CalendarSidebar
          selectedDate={nav.currentDate}
          onDateSelect={handleSidebarDateSelect}
          statusFilters={statusFilters}
          onStatusFiltersChange={setStatusFilters}
        />

        <div className="flex-1 min-h-0 relative">
          {renderView()}

          {loading && (
            <div className="absolute inset-0 bg-background/50 backdrop-blur-[1px] flex items-center justify-center z-30">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Carregando eventos...
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
