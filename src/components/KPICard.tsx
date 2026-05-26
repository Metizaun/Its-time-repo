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

  if (isValidElement<{ children?: ReactNode }>(node)) {
    if (node.type === "br") return " ";

    const props = node.props;
    if (props.children) {
      const newChildren = React.Children.map(props.children, removeBr);
      return cloneElement(node, undefined, newChildren);
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
    <article className={cn("card-kpi", className)}>
      <div className="card-kpi__body">
        <div className="card-kpi__content">
          <p className="card-kpi__label">{title}</p>

          <p className="card-kpi__value stat-value">{cleanValue}</p>

          {subtitle && <p className="card-kpi__subtitle">{subtitle}</p>}

          {trend && trendValue && (
            <div className="card-kpi__trend">
              <span
                className={cn(
                  "card-kpi__trend-value",
                  trend === "up" ? "card-kpi__trend-value--up" : "card-kpi__trend-value--down"
                )}
              >
                {trend === "up" ? "↑" : "↓"} {trendValue}
              </span>
              <span className="card-kpi__trend-copy">vs periodo anterior</span>
            </div>
          )}
        </div>

        {Icon && (
          <div className="card-kpi__icon" aria-hidden>
            <Icon />
          </div>
        )}
      </div>
    </article>
  );
}
