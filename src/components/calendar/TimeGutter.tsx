import { DAY_END_HOUR, DAY_START_HOUR, HOUR_HEIGHT, TIME_GUTTER_WIDTH } from "@/hooks/useEventLayout";

export function TimeGutter() {
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, index) => DAY_START_HOUR + index);

  return (
    <div className="relative shrink-0 select-none" style={{ width: TIME_GUTTER_WIDTH }}>
      {hours.map((hour) => (
        <div key={hour} className="relative" style={{ height: HOUR_HEIGHT }}>
          {hour !== DAY_START_HOUR ? (
            <span className="absolute -top-2.5 right-3 text-[11px] font-medium tabular-nums text-[var(--color-text-muted)]">
              {String(hour).padStart(2, "0")}:00
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
