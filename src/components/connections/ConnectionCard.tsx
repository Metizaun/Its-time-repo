import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type ConnectionStatus =
  | "not_configured"
  | "pending"
  | "connected"
  | "attention"
  | "disabled"
  | "coming_soon";

type ConnectionCardProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  iconSrc?: string;
  status: ConnectionStatus;
  statusLabel: string;
  actionLabel?: string;
  onAction?: () => void;
  footer?: ReactNode;
  className?: string;
};

const statusClassNames: Record<ConnectionStatus, string> = {
  not_configured: "connection-card__status-dot--neutral",
  pending: "connection-card__status-dot--warning",
  connected: "connection-card__status-dot--success",
  attention: "connection-card__status-dot--error",
  disabled: "connection-card__status-dot--neutral",
  coming_soon: "connection-card__status-dot--neutral",
};

export function ConnectionCard({
  title,
  description,
  icon: Icon,
  iconSrc,
  status,
  statusLabel,
  actionLabel,
  onAction,
  footer,
  className,
}: ConnectionCardProps) {
  const isUnavailable = status === "coming_soon";

  return (
    <article
      className={cn("connection-card", isUnavailable && "connection-card--unavailable", className)}
      aria-label={`${title}: ${statusLabel}`}
    >
      <div className="connection-card__icon" aria-hidden="true">
        {iconSrc ? <img src={iconSrc} alt="" className="connection-card__icon-image" /> : <Icon className="connection-card__icon-glyph" />}
      </div>

      <span
        className={cn("connection-card__status-dot", statusClassNames[status])}
        aria-hidden="true"
      />

      <div className="connection-card__content">
        <h3 className="connection-card__title">{title}</h3>
        <p className="connection-card__description">{description}</p>
        <span className="connection-card__status-label">{statusLabel}</span>
      </div>

      <div className="connection-card__footer">
        {footer ?? (isUnavailable ? (
          <span className="connection-card__availability-note">Disponível em breve</span>
        ) : (
          <Button
            type="button"
            variant={status === "not_configured" ? "default" : "outline"}
            className="connection-card__action"
            onClick={onAction}
            disabled={isUnavailable || !onAction}
          >
            {actionLabel}
          </Button>
        ))}
      </div>
    </article>
  );
}
