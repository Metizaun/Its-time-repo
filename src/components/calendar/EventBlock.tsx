import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { format, parseISO } from "date-fns";

import { HOUR_HEIGHT, SNAP_MINUTES, type CalendarEventLayout } from "@/hooks/useEventLayout";
import { cn } from "@/lib/utils";
import type { CalendarEvent, CalendarEventStatus } from "@/types/calendar";

type EventBlockProps = {
  layout: CalendarEventLayout;
  onSelectEvent: (event: CalendarEvent, position: { top: number; left: number }) => void;
  onResizeEvent: (event: CalendarEvent, deltaMinutes: number) => void;
};

const STATUS_STYLES: Record<CalendarEventStatus, { bg: string; border: string; text: string }> = {
  scheduled: { bg: "#FFF3EE", border: "#E8511A", text: "#9A3412" },
  confirmed: { bg: "#ECFDF3", border: "#16A34A", text: "#166534" },
  cancelled: { bg: "#FFF1F2", border: "#DC2626", text: "#991B1B" },
  done: { bg: "#F3F1EC", border: "#9E9E96", text: "#3D3D3A" },
  no_show: { bg: "#FFFBEB", border: "#D97706", text: "#92400E" },
};

function getResizeDeltaMinutes(startY: number, currentY: number) {
  const rawDeltaMinutes = ((currentY - startY) / HOUR_HEIGHT) * 60;
  return Math.round(rawDeltaMinutes / SNAP_MINUTES) * SNAP_MINUTES;
}

export function EventBlock({ layout, onSelectEvent, onResizeEvent }: EventBlockProps) {
  const { event, top, height, left, width, zIndex } = layout;
  const colors = STATUS_STYLES[event.status];
  const startTime = format(parseISO(event.start_time), "HH:mm");
  const endTime = format(parseISO(event.end_time), "HH:mm");
  const isCompact = height < 46;
  const [resizeDelta, setResizeDelta] = useState(0);
  const [resizeStartY, setResizeStartY] = useState<number | null>(null);

  useEffect(() => {
    if (resizeStartY === null) return;

    const handleMouseMove = (mouseEvent: MouseEvent) => {
      setResizeDelta(getResizeDeltaMinutes(resizeStartY, mouseEvent.clientY));
    };

    const handleMouseUp = (mouseEvent: MouseEvent) => {
      const deltaMinutes = getResizeDeltaMinutes(resizeStartY, mouseEvent.clientY);
      setResizeStartY(null);
      setResizeDelta(0);

      if (deltaMinutes !== 0) {
        onResizeEvent(event, deltaMinutes);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp, { once: true });

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [event, onResizeEvent, resizeStartY]);

  const previewHeight = Math.max(height + (resizeDelta / 60) * HOUR_HEIGHT, 24);

  return (
    <button
      type="button"
      draggable={resizeStartY === null}
      data-calendar-event-block
      onDragStart={(dragEvent) => {
        const start = parseISO(event.start_time);
        const end = parseISO(event.end_time);
        dragEvent.dataTransfer.setData(
          "application/calendar-event",
          JSON.stringify({
            id: event.id,
            durationMs: Math.max(end.getTime() - start.getTime(), 15 * 60 * 1000),
            allDay: event.all_day,
          })
        );
        dragEvent.dataTransfer.effectAllowed = "move";
      }}
      onClick={(clickEvent) => {
        clickEvent.stopPropagation();
        const rect = clickEvent.currentTarget.getBoundingClientRect();
        onSelectEvent(event, {
          top: Math.min(rect.bottom + 8, window.innerHeight - 260),
          left: Math.min(rect.left, window.innerWidth - 340),
        });
      }}
      className={cn(
        "absolute overflow-hidden rounded-lg border-l-[3px] px-2 py-1 text-left outline-none transition-all hover:brightness-[0.98] hover:shadow-sm focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)]",
        event.status === "cancelled" && "opacity-55"
      )}
      style={{
        top,
        height: previewHeight,
        left,
        width,
        zIndex,
        backgroundColor: colors.bg,
        borderLeftColor: colors.border,
        color: colors.text,
      }}
      title={`${event.title} - ${startTime}-${endTime}`}
    >
      <span className={cn("block truncate font-semibold leading-tight", isCompact ? "text-[11px]" : "text-xs")}>
        {event.title}
      </span>
      {!isCompact ? (
        <span className="mt-0.5 flex items-center gap-1 truncate text-[10px] leading-tight opacity-80">
          {startTime} - {endTime}
          {event.followup_1h_enabled ? <BellRing className="h-3 w-3" /> : null}
        </span>
      ) : null}
      <span
        role="presentation"
        onMouseDown={(mouseEvent) => {
          mouseEvent.preventDefault();
          mouseEvent.stopPropagation();
          setResizeStartY(mouseEvent.clientY);
        }}
        className="absolute inset-x-2 bottom-0 h-2 cursor-ns-resize rounded-full opacity-0 transition-opacity hover:opacity-100"
        style={{ backgroundColor: colors.border }}
      />
    </button>
  );
}
