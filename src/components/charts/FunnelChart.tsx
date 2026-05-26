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

const STAGE_WIDTHS = ["100%", "80%", "65%", "55%", "45%"];

export function FunnelChart({ data, title, headerAction, totalLeads = 0 }: FunnelChartProps) {
  const funnelStagesInput = useMemo(() => data.slice(0, STAGE_WIDTHS.length), [data]);
  const totalFunnelLeads = useMemo(
    () => funnelStagesInput.reduce((sum, item) => sum + (item?.value || 0), 0),
    [funnelStagesInput]
  );
  const effectiveTotalLeads = totalLeads > 0 ? totalLeads : totalFunnelLeads;

  const funnelStages = useMemo(
    () =>
      funnelStagesInput.map((step, index) => {
        const previousValue = index > 0 ? funnelStagesInput[index - 1].value : null;
        const shareOfLeads = effectiveTotalLeads > 0 ? (step.value / effectiveTotalLeads) * 100 : 0;
        const conversionRate =
          previousValue && previousValue > 0 ? (step.value / previousValue) * 100 : index === 0 ? 100 : 0;
        const dropFromPrevious =
          previousValue && previousValue > 0 ? ((previousValue - step.value) / previousValue) * 100 : 0;

        return {
          name: step.name,
          value: step.value,
          width: STAGE_WIDTHS[index] || "45%",
          shareLabel: `${shareOfLeads.toFixed(1)}% dos leads`,
          conversionLabel: `${conversionRate.toFixed(1)}%`,
          conversionSupport:
            index === 0
              ? `${step.value} lead${step.value === 1 ? "" : "s"} na base do funil`
              : `${step.value} de ${previousValue ?? 0} leads vieram da etapa anterior`,
          dropFromPrevious,
        };
      }),
    [effectiveTotalLeads, funnelStagesInput]
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="funnel-stage"
                      style={{ "--funnel-stage-width": stage.width } as CSSProperties}
                    >
                      <span className="funnel-stage__label">{stage.name}</span>
                      <strong className="funnel-stage__value">{stage.value}</strong>
                      <span className="funnel-stage__meta">{stage.shareLabel}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="chart-tooltip">
                    <p className="font-semibold">{stage.name}</p>
                    <p>
                      {stage.value} de {effectiveTotalLeads} leads estao nesta etapa
                    </p>
                  </TooltipContent>
                </Tooltip>

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
