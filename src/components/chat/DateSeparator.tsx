interface DateSeparatorProps {
  label: string;
}

export function DateSeparator({ label }: DateSeparatorProps) {
  return (
    <div className="flex justify-center py-2">
      <span className="rounded-full bg-white/5 border border-white/5 px-4 py-1 text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}
