import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CalendarView } from '@/hooks/useCalendarNavigation';

interface CalendarHeaderProps {
    periodLabel: string;
    view: CalendarView;
    onPrev: () => void;
    onNext: () => void;
    onToday: () => void;
    onViewChange: (view: CalendarView) => void;
    onNewEvent: () => void;
    disabled?: boolean;
}

const VIEW_LABELS: Record<CalendarView, string> = {
    week: 'Semana',
    day: 'Dia',
    month: 'Mês',
};

export function CalendarHeader({
    periodLabel,
    view,
    onPrev,
    onNext,
    onToday,
    onViewChange,
    onNewEvent,
    disabled,
}: CalendarHeaderProps) {
    return (
        <div className="flex items-center justify-between gap-3 pb-3">
            {/* Left: nav controls */}
            <div className="flex items-center gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onToday}
                    className="text-xs font-medium"
                >
                    Hoje
                </Button>

                <div className="flex items-center">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onPrev}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onNext}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>

                <h2 className="text-lg font-semibold capitalize whitespace-nowrap select-none">
                    {periodLabel}
                </h2>
            </div>

            {/* Right: view switcher + new event */}
            <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center rounded-lg border bg-muted/40 p-0.5">
                    {(['week', 'day', 'month'] as CalendarView[]).map((v) => (
                        <button
                            key={v}
                            onClick={() => onViewChange(v)}
                            className={`
                px-3 py-1 text-xs font-medium rounded-md transition-all duration-200
                ${view === v
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                                }
              `}
                        >
                            {VIEW_LABELS[v]}
                        </button>
                    ))}
                </div>

                <Button size="sm" onClick={onNewEvent} disabled={disabled} className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    <span className="hidden sm:inline">Novo evento</span>
                </Button>
            </div>
        </div>
    );
}
