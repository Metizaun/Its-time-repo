import { HOUR_HEIGHT, DAY_START_HOUR, DAY_END_HOUR } from '@/hooks/useEventLayout';

export function TimeGutter() {
    const hours: number[] = [];
    for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h++) {
        hours.push(h);
    }

    return (
        <div className="relative select-none" style={{ width: 56 }}>
            {hours.map((hour) => (
                <div
                    key={hour}
                    className="relative"
                    style={{ height: HOUR_HEIGHT }}
                >
                    {hour !== 0 && (
                        <span className="absolute -top-[9px] right-2 text-[11px] font-medium text-muted-foreground tabular-nums">
                            {String(hour).padStart(2, '0')}:00
                        </span>
                    )}
                </div>
            ))}
        </div>
    );
}
