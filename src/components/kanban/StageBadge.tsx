import { cn } from "@/lib/utils";
import { PipelineStage } from "@/types";

interface StageBadgeProps {
  stage?: PipelineStage | null;
  className?: string;
  variant?: "default" | "outline" | "flat";
}

export function StageBadge({ stage, className, variant = "default" }: StageBadgeProps) {
  if (!stage) {
    return (
      <span className={cn("px-2 py-0.5 rounded text-[10px] bg-muted text-muted-foreground", className)}>
        Sem Etapa
      </span>
    );
  }

  const isDark = (color: string) => {
    // Simple heuristic for hex or hsl
    if (color.startsWith('hsl')) return false; // Assume UI colors are balanced
    return false; // Default to black text for most
  };

  if (variant === "flat") {
    return (
      <span 
        className={cn("px-2 py-0.5 rounded text-[10px] font-medium transition-colors", className)}
        style={{ 
          backgroundColor: `${stage.color}20`, 
          color: stage.color,
          border: `1px solid ${stage.color}40`
        }}
      >
        {stage.name}
      </span>
    );
  }

  if (variant === "outline") {
    return (
      <span 
        className={cn("px-2 py-0.5 rounded text-[10px] font-medium border transition-colors", className)}
        style={{ 
          borderColor: stage.color, 
          color: stage.color,
        }}
      >
        {stage.name}
      </span>
    );
  }

  return (
    <span 
      className={cn("px-2 py-0.5 rounded text-[10px] font-medium text-white transition-colors shadow-sm", className)}
      style={{ backgroundColor: stage.color }}
    >
      {stage.name}
    </span>
  );
}
