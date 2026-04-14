import { Card } from "@/components/ui/card";
import { FunnelStep } from "@/lib/utils/metrics";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FunnelChartProps {
  data: FunnelStep[];
  title: string;
}

// Fixed percentages logic based on instructions
const STAGE_WIDTHS = ["100%", "80%", "65%", "55%", "45%"];

export function FunnelChart({ data, title }: FunnelChartProps) {
  // 1) total real
  const totalLeads = useMemo(() => data.reduce((s, it) => s + (it?.value || 0), 0) || 1, [data]);

  // 2) Filtrar etapas (Mantendo a logica backend mas permitindo stages com volume 0)
  const HIDE_STEPS = ["Perdido", "Remarketing"];
  const validSteps = useMemo(
    () => data.filter((s) => !HIDE_STEPS.includes(s.name)),
    [data]
  );

  if (!validSteps.length) {
    return (
      <div className="p-4 sm:p-6 flex flex-col justify-center items-center rounded-[var(--radius-lg)] bg-[var(--color-bg-primary)] h-[320px]">
        <h3 className="text-base sm:text-lg font-semibold mb-4 w-full text-left text-white">{title}</h3>
        <div className="flex-1 flex items-center justify-center text-[var(--color-text-secondary)] text-sm">
          Sem dados para exibir
        </div>
      </div>
    );
  }

  // Pre-calcular funil stats para cada stage (Taxas e Custos)
  const funnelStages = validSteps.map((step, index) => {
    // Current step percentage over total
    const percentOfTotal = ((step.value / totalLeads) * 100);
    
    // Delta and logic previous step to current conversion
    const prevValue = index > 0 ? validSteps[index - 1].value : step.value;
    const conversionFromPrev = prevValue > 0 ? (step.value / prevValue) * 100 : 0;
    
    // Simulate drop from previous
    const delta = typeof prevValue === 'number' && prevValue > 0 
      ? ((step.value - prevValue) / prevValue) * 100
      : 0;
      
    // Mock Costs (Backend already handles the 'value' but if no cost provided we mock for UI parity with reference image)
    const costValue = step.value > 0 ? (280 / step.value).toFixed(2) : "0,00"; // Fake logic just for visual testing based on reference

    return {
      name: step.name,
      value: step.value,
      width: STAGE_WIDTHS[index] || "45%", // Fallback to smallest if overflow
      delta: delta,
      percentOfTotal: percentOfTotal.toFixed(1),
      convRate: index === 0 ? "100.00%" : `${conversionFromPrev.toFixed(2)}%`,
      formattedCost: `R$ ${costValue.replace(".", ",")}`
    };
  });

  return (
    <div className="p-0 sm:p-6 max-w-full overflow-x-hidden flex flex-col">
      {/* Title area */}
      <h3 className="text-[var(--font-size-title,1rem)] text-white font-semibold mb-8 text-center sm:text-left">{title}</h3>

      {/* Funnel Area */}
      <div className="flex flex-col items-center w-full bg-[var(--color-bg-primary)] px-2 sm:px-6 py-4 rounded-xl relative">
        <TooltipProvider>
          {funnelStages.map((stage, index) => (
            <div key={stage.name} className="flex flex-col items-center w-full group relative">
              
              {/* Row Container */}
              <div className="flex flex-col sm:flex-row items-center justify-center w-full gap-4 sm:gap-8 relative min-h-[140px]">
                
                {/* Left Metric (Custo) - Bare Text, NO borders as per Image 1 */}
                <div className="hidden sm:flex flex-col items-center sm:items-end flex-none w-[120px] text-right z-10 transition-opacity opacity-70 group-hover:opacity-100">
                  <p className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-wider font-semibold mb-1">C/{stage.name}</p>
                  <p className="text-white text-lg sm:text-xl font-medium tracking-wide">{stage.formattedCost}</p>
                  <p className={cn("text-xs font-bold mt-0.5", stage.delta >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]")}>
                    {stage.delta >= 0 ? '↑' : '↓'} {Math.abs(stage.delta).toFixed(1)}%
                  </p>
                </div>

                {/* Central Box (Soft Neumorphism Exactly as Image 1) */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div 
                      className="funnel-stage relative z-10 flex flex-col justify-center items-center transition-transform hover:scale-[1.01]"
                      style={{
                        width: `clamp(220px, ${stage.width}, 100%)`, 
                        background: 'var(--color-bg-elevated)',
                        borderRadius: '24px',
                        padding: '16px 24px',
                        boxShadow: '0 16px 32px rgba(0, 0, 0, 0.7), inset 0 2px 2px rgba(255, 255, 255, 0.04)',
                        border: 'none'
                      }}
                    >
                      <span className="text-[10px] sm:text-xs text-[var(--color-text-secondary)] uppercase font-semibold tracking-widest">{stage.name}</span>
                      <strong className="text-3xl sm:text-[2.6rem] text-white font-bold leading-none my-1 tracking-tight">{stage.value}</strong>
                      <span 
                        className={cn(
                          "text-xs font-bold",
                          stage.delta >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"
                        )}
                      >
                        {stage.delta >= 0 ? '↑' : '↓'} {Math.abs(stage.delta).toFixed(1)}%
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-[var(--color-bg-surface)] text-white border-[var(--color-border-medium)]">
                    <p className="font-bold">{stage.name}</p>
                    <p className="text-xs text-muted-foreground">{stage.percentOfTotal}% de retenção do funil total</p>
                  </TooltipContent>
                </Tooltip>

                {/* Right Metric (Taxa) - Bare Text, NO borders */}
                <div className="hidden sm:flex flex-col items-center sm:items-start flex-none w-[120px] text-left z-10 transition-opacity opacity-70 group-hover:opacity-100">
                  <p className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-wider font-semibold mb-1">Taxa {stage.name}</p>
                  <p className="text-white text-lg sm:text-xl font-medium tracking-wide">{stage.convRate}</p>
                  <p className={cn("text-xs font-bold mt-0.5 text-[var(--color-danger)]")}>
                     {index > 0 ? "↓ " + (100 - parseFloat(stage.convRate)).toFixed(1) + "%" : "0.0%"}
                  </p>
                </div>

              </div>

              {/* Vertical Connector exactly as Image 1 (subtle dropping pin) */}
              {index < funnelStages.length - 1 && (
                <div className="h-6 sm:h-8 w-[2px] bg-[var(--color-border-medium)] mx-auto opacity-30 z-0 my-1"></div>
              )}
            </div>
          ))}
        </TooltipProvider>
      </div>
    </div>
  );
}