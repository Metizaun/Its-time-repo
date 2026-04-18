interface DateSeparatorProps {
  label: string;
}

export function DateSeparator({ label }: DateSeparatorProps) {
  return (
    <div className="flex justify-center py-2">
      <span className="rounded-full bg-[var(--color-border-subtle)] border border-[var(--color-border-subtle)] px-4 py-1 text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}
