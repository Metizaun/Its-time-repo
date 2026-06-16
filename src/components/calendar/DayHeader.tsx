import { format, isSameDay, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";

import { cn } from "@/lib/utils";

interface DayHeaderProps {
  day: Date;
  selected?: boolean;
  compact?: boolean;
  onClick?: (day: Date) => void;
}

export function DayHeader({ day, selected = false, compact = false, onClick }: DayHeaderProps) {
  const today = isToday(day);
  const active = selected || today;
  const content = (
    <>
      <span
        className={cn(
          "text-[10px] font-bold uppercase tracking-[0.18em]",
          active ? "text-[var(--color-primary-600)]" : "text-[var(--color-text-secondary)]"
        )}
      >
        {format(day, "EEE", { locale: ptBR })}
      </span>
      <span
        className={cn(
          "mt-1 flex items-center justify-center rounded-full text-lg font-semibold tabular-nums transition-colors",
          compact ? "h-8 w-8 text-sm" : "h-10 w-10",
          today
            ? "bg-[var(--color-primary-500)] text-white shadow-[0_8px_18px_rgba(232,81,26,0.24)]"
            : active
              ? "bg-[var(--color-primary-50)] text-[var(--color-primary-700)]"
              : "text-[var(--color-text-primary)]"
        )}
      >
        {format(day, "d")}
      </span>
    </>
  );

  if (!onClick) {
    return <div className="flex min-w-0 flex-col items-center py-3">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onClick(day)}
      aria-current={isSameDay(day, new Date()) ? "date" : undefined}
      className="flex min-w-0 flex-col items-center rounded-2xl py-2 transition-colors hover:bg-[var(--color-primary-50)]"
    >
      {content}
    </button>
  );
}
