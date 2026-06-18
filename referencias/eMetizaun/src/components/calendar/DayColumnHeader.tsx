import { isToday, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface DayColumnHeaderProps {
    day: Date;
}

export function DayColumnHeader({ day }: DayColumnHeaderProps) {
    const today = isToday(day);
    const dayName = format(day, 'EEE', { locale: ptBR }).toUpperCase();
    const dayNumber = format(day, 'd');

    return (
        <div className="flex flex-col items-center py-2 select-none">
            <span
                className={`text-[11px] font-medium tracking-wide ${today ? 'text-primary' : 'text-muted-foreground'
                    }`}
            >
                {dayName}
            </span>
            <span
                className={`
          mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold
          transition-colors duration-200
          ${today
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-accent'
                    }
        `}
            >
                {dayNumber}
            </span>
        </div>
    );
}
