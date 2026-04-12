import { Card } from "@/components/ui/card";
import { FunnelStep } from "@/lib/utils/metrics";
import { useState, useMemo, useRef, useLayoutEffect } from "react";

interface FunnelChartProps {
  data: FunnelStep[];
  title: string;
}

export function FunnelChart({ data, title }: FunnelChartProps) {
  // 1. Todos os Hooks devem vir PRIMEIRO
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [tooltipAbove, setTooltipAbove] = useState<boolean>(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevPosRef = useRef<{ x: number; y: number } | null>(null);

  // 1) total real
  const totalLeads = useMemo(() => data.reduce((s, it) => s + (it?.value || 0), 0) || 1, [data]);

  // 2) Filtrar etapas
  const HIDE_STEPS = ["Perdido", "Remarketing"];
  const validSteps = useMemo(
    () => data.filter((s) => !HIDE_STEPS.includes(s.name) && typeof s.value === "number" && s.value > 0),
    [data]
  );

  // Variáveis de geometria (precisam existir para o useMemo rodar, mesmo sem dados)
  const svgWidth = 880;
  const gap = 10;
  const baseStepHeight = 72;
  // Fallback seguro para altura se não tiver passos
  const svgHeight = validSteps.length > 0 
    ? validSteps.length * baseStepHeight + (validSteps.length - 1) * gap
    : 300; 
    
  const maxWidth = svgWidth * 0.85;
  const centerX = svgWidth / 2;
  const maxValue = Math.max(...validSteps.map((s) => s.value), 1);

  // 3) Hook dos Trapezoids (AGORA ESTÁ ANTES DO RETURN)
  const trapezoids = useMemo(() => {
    if (!validSteps.length) return []; // Retorna array vazio se não tiver steps

    return validSteps.map((step, index) => {
      const currentWidthPercent = step.value / maxValue;
      const currentWidth = maxWidth * currentWidthPercent;

      const nextValueRaw = validSteps[index + 1]?.value;
      const nextValue = typeof nextValueRaw === "number" ? nextValueRaw : Math.max(step.value * 0.5, 1);
      const nextWidthPercent = nextValue / maxValue;
      const nextWidth = maxWidth * nextWidthPercent;

      const stepHeight = baseStepHeight;
      const y = index * (stepHeight + gap);

      const points = [
        [centerX - currentWidth / 2, y],
        [centerX + currentWidth / 2, y],
        [centerX + nextWidth / 2, y + stepHeight],
        [centerX - nextWidth / 2, y + stepHeight],
      ];

      const percentOfTotal = ((step.value / totalLeads) * 100).toFixed(1);

      return {
        ...step,
        points,
        y,
        currentWidth,
        percentOfTotal,
        index,
        stepHeight,
        centerX,
      };
    });
  }, [validSteps, maxWidth, maxValue, totalLeads, baseStepHeight, gap, centerX]);

  // 4) Hook do LayoutEffect (AGORA ESTÁ ANTES DO RETURN)
  useLayoutEffect(() => {
    if (hoveredIndex === null || !validSteps.length) {
      prevPosRef.current = null;
      setTooltipPos(null);
      return;
    }

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const scaleX = rect.width / svgWidth;
    const scaleY = rect.height / svgHeight;
    const trap = trapezoids[hoveredIndex];
    if (!trap) {
      prevPosRef.current = null;
      setTooltipPos(null);
      return;
    }

    let px = trap.centerX * scaleX;
    const pyCenter = (trap.y + trap.stepHeight / 2) * scaleY;

    const canPlaceAbove = pyCenter - 72 - 8 > 0; // TOOLTIP_H = 72, MARGIN = 8
    const canPlaceBelow = pyCenter + 72 + 8 < rect.height;
    let placeAbove = canPlaceAbove || !canPlaceBelow;

    if (trap.name === "Atendimento") placeAbove = false;

    let topPx = placeAbove ? pyCenter - (trap.stepHeight * scaleY) / 2 - 8 : pyCenter + (trap.stepHeight * scaleY) / 2 + 8;

    const minX = 8 + 220 / 2; // MARGIN + TOOLTIP_W / 2
    const maxX = rect.width - 8 - 220 / 2;
    px = Math.max(minX, Math.min(maxX, px));

    const minY = 8 + 72 / 2;
    const maxY = rect.height - 8 - 72 / 2;
    topPx = Math.max(minY, Math.min(maxY, topPx));

    const prev = prevPosRef.current;
    const changed =
      !prev ||
      Math.abs(prev.x - px) > 0.5 ||
      Math.abs(prev.y - topPx) > 0.5 ||
      tooltipAbove !== placeAbove;

    if (changed) {
      prevPosRef.current = { x: px, y: topPx };
      setTooltipPos({ x: px, y: topPx });
      setTooltipAbove(placeAbove);
    }
  }, [hoveredIndex, trapezoids, svgHeight, svgWidth, tooltipAbove, validSteps.length]);

  // Função auxiliar de cores (não é hook, pode ficar aqui ou fora)
  const getStepColor = (index: number, total: number) => {
    const hues = [205, 203, 200, 197, 194, 192];
    const sats = [70, 72, 68, 65, 60, 58];
    const lights = [26, 23, 20, 18, 16, 13];
    if (index === total - 1) return `hsl(192, 60%, 10%)`;
    const i = Math.min(index, hues.length - 1);
    return `hsl(${hues[i]}, ${sats[i]}%, ${lights[i]}%)`;
  };

  // AGORA SIM: O Return Condicional (depois de todos os hooks)
  if (!validSteps.length) {
    return (
      <Card className="p-4 sm:p-6 flex flex-col justify-center items-center h-[320px]">
        <h3 className="text-base sm:text-lg font-semibold mb-4 w-full text-left">{title}</h3>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Sem dados para exibir
        </div>
      </Card>
    );
  }

  // constantes do tooltip
  const TOOLTIP_W = 220;
  const TOOLTIP_H = 72;

  return (
    <Card className="p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold mb-4">{title}</h3>

      <div ref={containerRef} className="w-full overflow-x-auto relative" style={{ minHeight: 320 }}>
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto" style={{ minHeight: 320 }}>
          <defs>
            <linearGradient id="funnelGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style={{ stopColor: "hsl(205, 60%, 20%)" }} />
              <stop offset="60%" style={{ stopColor: "hsl(205, 65%, 14%)" }} />
              <stop offset="100%" style={{ stopColor: "hsl(195, 50%, 12%)" }} />
            </linearGradient>

            {trapezoids.map((_, i) => (
              <linearGradient key={`g-${i}`} id={`stepGradient${i}`} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style={{ stopColor: getStepColor(i, trapezoids.length) }} />
                <stop offset="100%" style={{ stopColor: getStepColor(Math.min(i + 1, trapezoids.length - 1), trapezoids.length) }} />
              </linearGradient>
            ))}
          </defs>

          {trapezoids.map((trap) => (
            <g key={trap.name}>
              <polygon
                points={trap.points.map((p) => p.join(",")).join(" ")}
                fill={`url(#stepGradient${trap.index})`}
                stroke="hsl(var(--background))"
                strokeWidth="3"
                style={{
                  transition: "opacity .12s linear, transform .12s ease",
                  opacity: hoveredIndex === null || hoveredIndex === trap.index ? 1 : 0.6,
                  transform: hoveredIndex === trap.index ? "scale(1.01)" : "scale(1)",
                  transformOrigin: "center",
                }}
                onMouseEnter={() => setHoveredIndex(trap.index)}
                onMouseLeave={() => setHoveredIndex(null)}
              />

              <text
                x={centerX}
                y={trap.y + trap.stepHeight / 2 - 10}
                textAnchor="middle"
                className="fill-white font-semibold"
                style={{ textShadow: "0 2px 4px rgba(0,0,0,0.3)", fontSize: "clamp(14px, 2vw, 18px)" }}
              >
                {trap.name}
              </text>

              <text
                x={centerX}
                y={trap.y + trap.stepHeight / 2 + 12}
                textAnchor="middle"
                className="fill-white font-bold"
                style={{ textShadow: "0 2px 4px rgba(0,0,0,0.4)", fontSize: "clamp(16px, 2.2vw, 22px)" }}
              >
                {trap.value}
              </text>
            </g>
          ))}
        </svg>

        {hoveredIndex !== null && tooltipPos && hoveredIndex < trapezoids.length && (
          <div
            style={{
              position: "absolute",
              left: tooltipPos.x,
              top: tooltipPos.y,
              transform: tooltipAbove ? "translate(-50%, -120%)" : "translate(-50%, 8%)",
              pointerEvents: "none",
              zIndex: 9999,
            }}
          >
            <div
              style={{
                width: TOOLTIP_W,
                minHeight: TOOLTIP_H,
                background: "hsl(var(--card))",
                color: "#fff",
                borderRadius: 8,
                padding: "8px 10px",
                boxShadow: "0 6px 18px rgba(0,0,0,0.6)",
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 700 }}>{trapezoids[hoveredIndex].name}</div>
              <div style={{ marginTop: 6, color: "hsl(var(--muted-foreground))" }}>
                <span style={{ fontWeight: 600, color: "#fff" }}>{trapezoids[hoveredIndex].value}</span>{" "}
                — {trapezoids[hoveredIndex].percentOfTotal}% do total
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}