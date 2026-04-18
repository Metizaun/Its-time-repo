import { useMemo } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { FunnelStep } from "@/lib/utils/metrics";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
          shareOfLeads,
          shareLabel: `${shareOfLeads.toFixed(1)}% dos leads`,
          conversionRate,
          conversionLabel: `${conversionRate.toFixed(2)}%`,
          conversionSupport:
            index === 0
              ? `${step.value} lead${step.value === 1 ? "" : "s"} na base do funil`
              : `${step.value} de ${previousValue ?? 0} leads vieram da etapa anterior`,
          dropFromPrevious,
        };
      }),
    [effectiveTotalLeads, funnelStagesInput]
  );

  const renderHeader = () => (
    <div className="mb-8 flex items-center justify-between gap-3">
      <h3 className="text-left text-[var(--font-size-title,1rem)] font-semibold text-foreground">{title}</h3>
      {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
    </div>
  );

  if (!funnelStages.length) {
    return (
      <div className="flex h-[320px] flex-col items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-bg-primary)] p-4 sm:p-6">
        <div className="w-full">{renderHeader()}</div>
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-secondary)]">
          Sem dados para exibir
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-full flex-col overflow-x-hidden p-0 sm:p-6">
      {renderHeader()}

      <div className="relative flex w-full flex-col items-center rounded-xl bg-[var(--color-bg-primary)] px-2 py-4 sm:px-6">
        <TooltipProvider>
          {funnelStages.map((stage, index) => (
            <div key={stage.name} className="group relative flex w-full flex-col items-center">
              <div className="relative flex min-h-[140px] w-full flex-col items-center justify-center gap-4 sm:flex-row sm:gap-8">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="funnel-stage relative z-10 flex flex-col items-center justify-center transition-transform hover:scale-[1.01]"
                      style={{
                        width: `clamp(220px, ${stage.width}, 100%)`,
                        background: "transparent",
                        borderRadius: "24px",
                        padding: "16px 24px",
                        boxShadow: "0 8px 32px rgba(229, 57, 58, 0.04)",
                        border: "1px solid var(--color-border-subtle)",
                        borderTop: "2px solid var(--color-accent)",
                      }}
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)] sm:text-xs">
                        {stage.name}
                      </span>
                      <strong className="my-1 text-3xl font-bold leading-none tracking-tight text-foreground sm:text-[2.6rem]">
                        {stage.value}
                      </strong>
                      <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
                        {stage.shareLabel}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="border-[var(--color-border-medium)] bg-[var(--color-bg-surface)] text-foreground">
                    <p className="font-bold">{stage.name}</p>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {stage.value} de {effectiveTotalLeads} leads estao nesta etapa
                    </p>
                  </TooltipContent>
                </Tooltip>

                <div className="hidden w-[140px] flex-none text-left opacity-70 transition-opacity group-hover:opacity-100 sm:flex sm:flex-col sm:items-start">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Conversao
                  </p>
                  <p className="text-lg font-medium tracking-wide text-foreground sm:text-xl">
                    {stage.conversionLabel}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-xs font-medium",
                      index === 0 ? "text-[var(--color-text-secondary)]" : "text-[var(--color-danger)]"
                    )}
                  >
                    {index === 0 ? stage.conversionSupport : `Queda de ${stage.dropFromPrevious.toFixed(1)}%`}
                  </p>
                </div>
              </div>

              {index < funnelStages.length - 1 && (
                <div className="z-0 mx-auto my-1 h-6 w-[2px] bg-[var(--color-border-medium)] opacity-30 sm:h-8" />
              )}
            </div>
          ))}
        </TooltipProvider>
      </div>
    </div>
  );
}
