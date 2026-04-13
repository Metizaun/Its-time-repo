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

function removeBr(node: ReactNode): ReactNode {
  if (node == null) return node;

  if (Array.isArray(node)) {
    return React.Children.map(node, removeBr);
  }

  if (isValidElement(node)) {
    if (node.type === "br") return " ";
    const props = (node as any).props || {};
    if (props.children) {
      const newChildren = React.Children.map(props.children, removeBr);
      return cloneElement(node, { ...props, children: newChildren } as any);
    }
    return node;
  }

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
    <Card className={cn("p-4 sm:p-6 bg-[#0a0a0a] border border-[#1a1a1a] shadow-lg rounded-2xl hover:shadow-xl transition-shadow", className)}>
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white/50 font-medium tracking-wide uppercase">{title}</p>

          <p className="text-3xl font-bold text-white mt-3 mb-1 whitespace-nowrap" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
            {cleanValue}
          </p>

          {subtitle && (
            <p className="text-xs sm:text-sm text-white/40 font-medium">
              {subtitle}
            </p>
          )}

          {trend && trendValue && (
            <div className="flex items-center gap-1 mt-2">
              <span
                className={cn(
                  "text-xs font-semibold",
                  trend === "up" ? "text-emerald-500" : "text-red-500"
                )}
              >
                {trend === "up" ? "↑" : "↓"} {trendValue}
              </span>
              <span className="text-xs text-white/30">
                vs período anterior
              </span>
            </div>
          )}
        </div>

        {Icon && (
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0 shadow-inner">
            <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-white/80" />
          </div>
        )}
      </div>
    </Card>
  );
}