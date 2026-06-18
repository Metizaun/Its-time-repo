import { useMemo } from "react";
import type { CSSProperties } from "react";

import type { DashboardHeatmapCell } from "@/types/dashboard";

const WEEKDAY_LABELS = [
  { row: 1, label: "Seg" },
  { row: 3, label: "Qua" },
  { row: 5, label: "Sex" },
];

function formatHeatmapDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function normalizeIntensity(value: number): DashboardHeatmapCell["intensity"] {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  return 0;
}

function getHeatmapStyle(weekCount: number): CSSProperties {
  const weeks = Math.max(1, weekCount);
  const preferredCell = Math.max(9, Math.min(13, 14.4 - weeks * 0.12));
  const preferredGap = Math.max(2, Math.min(4, 4.4 - weeks * 0.04));

  return {
    "--heatmap-weeks": weeks,
    "--heatmap-cell": `clamp(9px, ${preferredCell.toFixed(2)}px, 13px)`,
    "--heatmap-gap": `clamp(2px, ${preferredGap.toFixed(2)}px, 4px)`,
  } as CSSProperties;
}

export function DashboardLeadHeatmap({ data }: { data: DashboardHeatmapCell[] }) {
  const { weekCount, monthLabels } = useMemo(() => {
    const weekIndexes = data.map((cell) => cell.week_index);
    const maxWeek = weekIndexes.length > 0 ? Math.max(...weekIndexes) : 0;
    const labels = new Map<number, string>();

    data.forEach((cell) => {
      if (cell.month_label && !labels.has(cell.week_index)) {
        labels.set(cell.week_index, cell.month_label);
      }
    });

    return {
      weekCount: maxWeek + 1,
      monthLabels: Array.from(labels.entries()).map(([weekIndex, label]) => ({ weekIndex, label })),
    };
  }, [data]);

  if (data.length === 0) {
    return <div className="empty-state">Sem entradas no periodo</div>;
  }

  return (
    <div className="lead-heatmap">
      <div className="lead-heatmap__viewport">
        <div
          className="lead-heatmap__grid"
          style={getHeatmapStyle(weekCount)}
          aria-label="Mapa de calor de entrada de leads por dia"
        >
          {monthLabels.map((month) => (
            <span
              key={`${month.weekIndex}-${month.label}`}
              className="lead-heatmap__month"
              style={{ gridColumn: month.weekIndex + 2, gridRow: 1 }}
            >
              {month.label}
            </span>
          ))}

          {WEEKDAY_LABELS.map((weekday) => (
            <span
              key={weekday.label}
              className="lead-heatmap__weekday"
              style={{ gridColumn: 1, gridRow: weekday.row + 2 }}
            >
              {weekday.label}
            </span>
          ))}

          {data.map((cell) => {
            const intensity = normalizeIntensity(cell.intensity);

            return (
              <span
                key={cell.date}
                className="lead-heatmap__cell"
                data-intensity={intensity}
                style={{ gridColumn: cell.week_index + 2, gridRow: cell.weekday + 2 }}
                title={`${formatHeatmapDate(cell.date)}: ${cell.leads} lead${cell.leads === 1 ? "" : "s"}`}
                aria-label={`${formatHeatmapDate(cell.date)}: ${cell.leads} lead${cell.leads === 1 ? "" : "s"}`}
              />
            );
          })}
        </div>
      </div>

      <div className="lead-heatmap__footer">
        <span>Entradas por dia</span>
        <div className="lead-heatmap__legend" aria-label="Legenda de intensidade">
          <span>Menos</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span key={level} className="lead-heatmap__legend-cell" data-intensity={level} />
          ))}
          <span>Mais</span>
        </div>
      </div>
    </div>
  );
}
