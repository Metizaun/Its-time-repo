import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { FunnelStep } from "@/lib/utils/metrics";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChartCard } from "./ChartCard";

interface FunnelChartProps {
  data: FunnelStep[];
  title: string;
  headerAction?: ReactNode;
  totalLeads?: number;
}

const MAX_VISIBLE_STAGES = 5;
const MIN_STAGE_WIDTH_PERCENT = 42;
const EMPTY_STAGE_WIDTH_PERCENT = 34;

function getStageWidthPercent(value: number, maxValue: number) {
  if (maxValue <= 0) return 100;
  if (value <= 0) return EMPTY_STAGE_WIDTH_PERCENT;

  const ratio = value / maxValue;
  return Math.round((MIN_STAGE_WIDTH_PERCENT + ratio * (100 - MIN_STAGE_WIDTH_PERCENT)) * 10) / 10;
}

export function FunnelChart({ data, title, headerAction, totalLeads = 0 }: FunnelChartProps) {
  const funnelStagesInput = useMemo(() => data.slice(0, MAX_VISIBLE_STAGES), [data]);
  const totalFunnelLeads = useMemo(
    () => funnelStagesInput.reduce((sum, item) => sum + (item?.value || 0), 0),
    [funnelStagesInput]
  );
  const effectiveTotalLeads = totalLeads > 0 ? totalLeads : totalFunnelLeads;
  const maxStageLeads = useMemo(
    () => funnelStagesInput.reduce((max, item) => Math.max(max, item.value || 0), 0),
    [funnelStagesInput]
  );

  const funnelStages = useMemo(
    () =>
      funnelStagesInput.map((step, index) => {
        const previousValue = index > 0 ? funnelStagesInput[index - 1].value : null;
        const widthPercent = getStageWidthPercent(step.value, maxStageLeads);
        const shareOfLeads = effectiveTotalLeads > 0 ? (step.value / effectiveTotalLeads) * 100 : 0;
        const conversionRate =
          previousValue && previousValue > 0 ? (step.value / previousValue) * 100 : index === 0 ? 100 : 0;
        const dropFromPrevious =
          previousValue && previousValue > 0 ? ((previousValue - step.value) / previousValue) * 100 : 0;

        return {
          name: step.name,
          value: step.value,
          width: `${widthPercent}%`,
          shareLabel: `${shareOfLeads.toFixed(1)}% dos leads`,
          scaleLabel: maxStageLeads > 0 ? `${widthPercent.toFixed(0)}% da maior etapa` : "sem volume no periodo",
          conversionLabel: `${conversionRate.toFixed(1)}%`,
          conversionSupport:
            index === 0
              ? `${step.value} lead${step.value === 1 ? "" : "s"} na base do funil`
              : `${step.value} de ${previousValue ?? 0} leads vieram da etapa anterior`,
          dropFromPrevious,
        };
      }),
    [effectiveTotalLeads, funnelStagesInput, maxStageLeads]
  );

  if (!funnelStages.length) {
    return (
      <ChartCard title={title} action={headerAction}>
        <div className="empty-state">Sem dados para exibir</div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title={title} action={headerAction}>
      <div className="funnel-wrapper">
        <TooltipProvider>
          {funnelStages.map((stage, index) => (
            <div key={stage.name} className="funnel-step-group">
              <div className="funnel-stage-row">
                <div className="funnel-stage-shell">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="funnel-stage"
                        style={{ "--funnel-stage-width": stage.width } as CSSProperties}
                      >
                        <span className="funnel-stage__accent" aria-hidden="true" />
                        <span className="funnel-stage__label">{stage.name}</span>
                        <strong className="funnel-stage__value">{stage.value}</strong>
                        <span className="funnel-stage__meta">{stage.shareLabel}</span>
                        <span className="funnel-stage__scale">{stage.scaleLabel}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="chart-tooltip">
                      <p className="font-semibold">{stage.name}</p>
                      <p>
                        {stage.value} de {effectiveTotalLeads} leads estao nesta etapa
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div className="funnel-conversion">
                  <p className="funnel-conversion__label">Conversao</p>
                  <p className="funnel-conversion__value">{stage.conversionLabel}</p>
                  <p
                    className={cn(
                      "funnel-conversion__copy",
                      index > 0 && stage.dropFromPrevious > 0 && "funnel-conversion__copy--negative"
                    )}
                  >
                    {index === 0 ? stage.conversionSupport : `Queda de ${stage.dropFromPrevious.toFixed(1)}%`}
                  </p>
                </div>
              </div>

              {index < funnelStages.length - 1 && <div className="funnel-connector" />}
            </div>
          ))}
        </TooltipProvider>
      </div>
    </ChartCard>
  );
}
