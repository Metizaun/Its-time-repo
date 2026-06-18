import type { CalendarEvent } from '@/hooks/useCalendarEvents';
import type { LayoutRect } from '@/hooks/useEventLayout';
import { format, parseISO } from 'date-fns';

interface EventBlockProps {
    layout: LayoutRect;
    onClick: (eventId: string) => void;
}

const STATUS_COLORS: Record<CalendarEvent['status'], { bg: string; border: string; text: string }> = {
    scheduled: { bg: '#E8F0FE', border: '#4285F4', text: '#1967D2' },
    confirmed: { bg: '#E6F4EA', border: '#0F9D58', text: '#137333' },
    cancelled: { bg: '#FCE8E6', border: '#DB4437', text: '#C5221F' },
    done: { bg: '#F1F3F4', border: '#9E9E9E', text: '#5F6368' },
    no_show: { bg: '#FEF7E0', border: '#F4B400', text: '#EA8600' },
};

export function EventBlock({ layout, onClick }: EventBlockProps) {
    const { event, top, height, left, width, zIndex } = layout;
    const colors = STATUS_COLORS[event.status];
    const isCancelled = event.status === 'cancelled';
    const isDone = event.status === 'done';
    const isCompact = height < 40;

    const startTime = format(parseISO(event.start_time), 'HH:mm');
    const endTime = format(parseISO(event.end_time), 'HH:mm');

    return (
        <button
            type="button"
            draggable
            onDragStart={(e) => {
                const durationMs = parseISO(event.end_time).getTime() - parseISO(event.start_time).getTime();
                e.dataTransfer.setData('application/calendar-event', JSON.stringify({
                    id: event.id,
                    durationMs,
                }));
                e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={(e) => {
                e.stopPropagation();
                onClick(event.id);
            }}
            className="absolute rounded px-1.5 py-0.5 text-left overflow-hidden cursor-move
        transition-all duration-150 hover:shadow-md hover:brightness-95 active:scale-[0.98]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            style={{
                top,
                height: Math.max(height, 20),
                left,
                width,
                zIndex,
                backgroundColor: colors.bg,
                borderLeft: `3px solid ${colors.border}`,
                color: colors.text,
                opacity: isCancelled ? 0.6 : 1,
            }}
            title={`${event.title} · ${startTime}–${endTime}`}
        >
            {isCompact ? (
                <span className={`text-[10px] font-medium leading-tight truncate block ${isCancelled ? 'line-through' : ''}`}>
                    {event.title}
                </span>
            ) : (
                <>
                    <span className={`text-[11px] font-semibold leading-tight truncate block ${isCancelled ? 'line-through' : ''}`}>
                        {event.title}
                    </span>
                    <span className="text-[10px] leading-tight opacity-80 truncate block">
                        {startTime} – {endTime}
                    </span>
                    {isDone && (
                        <span className="text-[9px] opacity-60 block mt-0.5">✓ Concluído</span>
                    )}
                </>
            )}
        </button>
    );
}
