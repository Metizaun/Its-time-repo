import { Card } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import React, { ReactNode, isValidElement, cloneElement, useMemo } from "react";

interface KPICardProps {
  title: string;
  value: string | number | ReactNode;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: "up" | "down";
  trendValue?: string;
  className?: string;
}

/** Remove <br/> e quebras explícitas dos nós de value */
function removeBr(node: ReactNode): ReactNode {
  if (node == null) return node;

  // CORREÇÃO 1: Se for array, usa React.Children.map para garantir keys
  if (Array.isArray(node)) {
    return React.Children.map(node, removeBr);
  }

  // Elemento React
  if (isValidElement(node)) {
    // Se for <br>, substitui por espaço
    if (node.type === "br") return " ";

    const props = (node as any).props || {};
    
    // CORREÇÃO 2: Processa children usando React.Children.map
    if (props.children) {
      const newChildren = React.Children.map(props.children, removeBr);
      return cloneElement(node, { ...props, children: newChildren } as any);
    }
    return node;
  }

  // Texto simples — mantém
  return node;
}

export function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendValue,
  className,
}: KPICardProps) {

  const cleanValue = useMemo(() => removeBr(value), [value]);

  return (
    <Card className={cn("p-4 sm:p-6 hover-lift", className)}>
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-muted-foreground font-medium">{title}</p>

          {/* força linha única para R$ 4.800,00 */}
          <p className="stat-value mt-2 whitespace-nowrap">
            {cleanValue}
          </p>

          {subtitle && (
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              {subtitle}
            </p>
          )}

          {trend && trendValue && (
            <div className="flex items-center gap-1 mt-2">
              <span
                className={cn(
                  "text-xs font-medium",
                  trend === "up" ? "text-success" : "text-destructive"
                )}
              >
                {trend === "up" ? "↑" : "↓"} {trendValue}
              </span>
              <span className="text-xs text-muted-foreground">
                vs período anterior
              </span>
            </div>
          )}
        </div>

        {Icon && (
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
          </div>
        )}
      </div>
    </Card>
  );
}