import { Card } from "@/components/ui/card";
import { FunnelStep } from "@/lib/utils/metrics";
import { useMemo } from "react";
import { ArrowDown, TrendingDown, TrendingUp } from "lucide-react";

interface FunnelChartProps {
  data: FunnelStep[];
  title: string;
}

// Valor fictício para gerar Custos Base proporcionais e fechar o design IDÊNTICO.
const MOCK_TOTAL_SPEND = 1100.00;

export function FunnelChart({ data, title }: FunnelChartProps) {
  const HIDE_STEPS = ["Perdido", "Remarketing"];
  const validSteps = useMemo(
    () => data.filter((s) => !HIDE_STEPS.includes(s.name)),
    [data]
  );

  if (!validSteps.length) {
    return (
      <Card className="p-4 sm:p-6 bg-[#0a0a0a] border-white/5 flex flex-col justify-center items-center h-[320px]">
        <h3 className="text-base sm:text-lg font-semibold mb-4 w-full text-left text-white/90">{title}</h3>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Sem dados para exibir
        </div>
      </Card>
    );
  }

  const getWidthPercent = (index: number, totalLen: number) => {
    const startW = 100;
    const endW = 45;
    const drop = (startW - endW) / (totalLen - 1 || 1);
    const minW = startW - drop * index;
    return `${minW}%`;
  };

  return (
    <Card className="p-4 sm:p-8 bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl overflow-hidden relative shadow-2xl">
      <h3 className="text-base sm:text-lg font-semibold mb-8 text-white/90 text-center sm:text-left">
        {title} 
      </h3>

      <div className="w-full flex flex-col items-center gap-3 relative pb-4">
        {validSteps.map((step, index) => {
          const isFirst = index === 0;
          const prevValue = isFirst ? step.value : validSteps[index - 1].value;
          
          const custoBase = step.value > 0 ? MOCK_TOTAL_SPEND / step.value : 0;
          let metricCostLabel = "";
          if (step.name === "Novo") metricCostLabel = "C/Lead (Iniciado)";
          else if (step.name === "Atendimento") metricCostLabel = "C/Atendimento";
          else if (step.name === "Orçamento") metricCostLabel = "C/Proposta";
          else if (step.name === "Fechado") metricCostLabel = "C/Venda";
          else metricCostLabel = `C/${step.name}`;

          const cvrPrev = prevValue > 0 ? (step.value / prevValue) * 100 : 0;
          let metricRateLabel = "";
          if (step.name === "Novo") metricRateLabel = "Tx Engajamento";
          else if (step.name === "Atendimento") metricRateLabel = "Tx Contato";
          else if (step.name === "Orçamento") metricRateLabel = "Tx Proposta";
          else if (step.name === "Fechado") metricRateLabel = "Tx Fechamento";
          else metricRateLabel = `Tx ${step.name}`;

          const variationStatic = [ -15.4, 17.1, 0.0, -50.9, 100.00 ][index % 5];
          const isPositive = variationStatic > 0;
          const isZero = variationStatic === 0;

          const widthStr = getWidthPercent(index, validSteps.length);

          return (
            <div key={step.name} className="relative w-full flex items-center justify-center group z-10 transition-all hover:z-20">
              
              {/* === ESQUERDA: Custo === */}
              {custoBase > 0 && (
                <div className="hidden sm:flex absolute left-0 w-[20%] lg:w-[25%] flex-col justify-center">
                  <div className="text-[10px] text-muted-foreground mb-0.5 tracking-wider font-medium">{metricCostLabel}</div>
                  <div className="text-sm font-semibold text-white/90">
                    R$ {custoBase.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                  </div>
                  <div className={`flex items-center gap-1 text-[9px] font-semibold mt-0.5 ${isPositive ? 'text-emerald-500' : isZero ? 'text-muted-foreground' : 'text-red-500'}`}>
                    {!isZero && (isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />)}
                    {variationStatic > 0 ? '+' : ''}{Math.abs(variationStatic).toFixed(1)}%
                  </div>
                  
                  {/* Conector */}
                  <div className="absolute top-1/2 -right-4 w-6 border-b border-dashed border-white/10" />
                  <div className="absolute top-1/2 -right-4 w-1.5 h-1.5 rounded-full bg-white/20 transform -translate-y-1/2" />
                </div>
              )}

              {/* === CENTRO: Funil Neumórfico === */}
              <div 
                className="flex flex-col items-center justify-center py-4 px-4 sm:px-8 transition-transform duration-300 transform group-hover:scale-[1.02]"
                style={{ 
                  width: widthStr, 
                  minHeight: '100px',
                  borderRadius: index === 0 ? '16px 16px 24px 24px' : '24px',
                  background: 'linear-gradient(180deg, #1b1b1c 0%, #0d0d0f 100%)',
                  boxShadow: 'inset 0px 2px 3px rgba(255, 255, 255, 0.08), 0px 10px 20px -5px rgba(0,0,0,0.8), 0px 4px 8px -2px rgba(0,0,0,0.6)',
                  border: '1px solid rgba(255,255,255,0.03)'
                }}
              >
                <div className="text-xs sm:text-sm font-medium text-muted-foreground tracking-wide mb-1 opacity-80">
                  {step.name}
                </div>
                <div className="text-2xl sm:text-4xl font-bold text-white tracking-tight mb-1" style={{ textShadow: '0px 2px 8px rgba(0,0,0,0.5)'}}>
                  {step.value.toLocaleString('pt-BR')}
                </div>
                
                <div className={`flex items-center gap-1 text-[10px] sm:text-xs font-semibold ${isPositive ? 'text-emerald-500' : isZero ? 'text-muted-foreground' : 'text-red-500'}`}>
                  {!isZero && (isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />)}
                  {Math.abs(variationStatic).toFixed(1)}%
                </div>
              </div>

              {/* Reta divisória de descida */}
              {index < validSteps.length - 1 && (
                <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 w-1 h-3 z-0 flex flex-col items-center">
                   <div className="w-px h-3 bg-white/10" />
                   <div className="w-1.5 h-1.5 rounded-full bg-[#1b1b1c] border border-white/20 mt-[-2px]" />
                </div>
              )}

              {/* === DIREITA: Taxa === */}
              {index > 0 && (
                <div className="hidden sm:flex absolute right-0 w-[20%] lg:w-[25%] flex-col justify-center items-end text-right">
                  <div className="text-[10px] text-muted-foreground mb-0.5 tracking-wider font-medium">{metricRateLabel}</div>
                  <div className="text-sm font-semibold text-white/90">
                    {cvrPrev.toFixed(2)}%
                  </div>
                  <div className={`flex items-center gap-1 text-[9px] font-semibold mt-0.5 ${isPositive ? 'text-emerald-500' : isZero ? 'text-muted-foreground' : 'text-red-500'}`}>
                    {!isZero && (isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />)}
                    {variationStatic > 0 ? '+' : ''}{Math.abs(variationStatic).toFixed(1)}%
                  </div>

                  {/* Conector */}
                  <div className="absolute top-1/2 -left-4 w-6 border-b border-dashed border-white/10" />
                  <div className="absolute top-1/2 -left-4 w-1.5 h-1.5 rounded-full bg-white/20 transform -translate-y-1/2" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}