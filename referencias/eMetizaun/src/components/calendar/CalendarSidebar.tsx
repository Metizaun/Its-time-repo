import { useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { CalendarEventStatus } from '@/hooks/useCalendarEvents';

interface CalendarSidebarProps {
    selectedDate: Date;
    onDateSelect: (date: Date) => void;
    statusFilters: CalendarEventStatus[];
    onStatusFiltersChange: (filters: CalendarEventStatus[]) => void;
}

const STATUS_OPTIONS: { value: CalendarEventStatus; label: string; color: string }[] = [
    { value: 'scheduled', label: 'Agendado', color: '#4285F4' },
    { value: 'confirmed', label: 'Confirmado', color: '#0F9D58' },
    { value: 'cancelled', label: 'Cancelado', color: '#DB4437' },
    { value: 'done', label: 'Concluído', color: '#9E9E9E' },
    { value: 'no_show', label: 'Não compareceu', color: '#F4B400' },
];

export function CalendarSidebar({
    selectedDate,
    onDateSelect,
    statusFilters,
    onStatusFiltersChange,
}: CalendarSidebarProps) {
    const toggleStatus = (status: CalendarEventStatus) => {
        if (statusFilters.includes(status)) {
            onStatusFiltersChange(statusFilters.filter((s) => s !== status));
        } else {
            onStatusFiltersChange([...statusFilters, status]);
        }
    };

    return (
        <aside className="w-[280px] shrink-0 hidden lg:block border-r border-border/40 pr-4">
            {/* Mini Calendar */}
            <div className="pb-4">
                <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => date && onDateSelect(date)}
                    className="w-full"
                />
            </div>

            {/* Status Filters */}
            <div className="pt-2 border-t border-border/30">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Filtrar por status
                </h3>
                <div className="space-y-2.5">
                    {STATUS_OPTIONS.map((opt) => (
                        <div key={opt.value} className="flex items-center gap-2">
                            <Checkbox
                                id={`filter-${opt.value}`}
                                checked={statusFilters.includes(opt.value)}
                                onCheckedChange={() => toggleStatus(opt.value)}
                                className="border-0"
                                style={{
                                    backgroundColor: statusFilters.includes(opt.value) ? opt.color : undefined,
                                    borderColor: opt.color,
                                    borderWidth: statusFilters.includes(opt.value) ? 0 : 2,
                                }}
                            />
                            <Label
                                htmlFor={`filter-${opt.value}`}
                                className="text-sm font-normal cursor-pointer"
                            >
                                {opt.label}
                            </Label>
                        </div>
                    ))}
                </div>
            </div>
        </aside>
    );
}
