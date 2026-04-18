import { Lead } from "@/hooks/useLeads";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, DollarSign, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApp } from "@/context/AppContext";
import { useState } from "react";

interface LeadCardProps {
  lead: Lead;
  onDragStart: () => void;
  onDragEnd: () => void;
}


export function LeadCard({ lead, onDragStart, onDragEnd }: LeadCardProps) {
  const { openDrawer } = useApp();
  const [isHolding, setIsHolding] = useState(false);

  return (
    <Card
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-kanban-item", "lead");
        e.dataTransfer.setData("text/lead-id", lead.id);
        e.dataTransfer.effectAllowed = "move";
        e.currentTarget.setAttribute("aria-grabbed", "true");
        setIsHolding(true);
        onDragStart();
      }}
      onDragEnd={(e) => {
        e.currentTarget.setAttribute("aria-grabbed", "false");
        setIsHolding(false);
        onDragEnd();
      }}
      onMouseDown={() => setIsHolding(true)}
      onMouseUp={() => setIsHolding(false)}
      onMouseLeave={() => setIsHolding(false)}
      onClick={() => openDrawer(lead.id)}
      className={cn(
        "p-3.5 bg-[var(--color-bg-elevated)] rounded-xl transition-all outline-none",
        isHolding ? "cursor-grabbing opacity-80 scale-[0.98]" : "cursor-pointer hover:brightness-105"
      )}
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDrawer(lead.id);
        }
        if (e.key === "m") {
          e.preventDefault();
          // TODO: Open move modal
        }
      }}
    >
      <div className="space-y-3">
        <div>
          <h4 className="font-bold text-sm leading-tight text-foreground">{lead.lead_name}</h4>
          {lead.last_city && (
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-[var(--color-text-secondary)]">
              <Building2 className="w-3 h-3 text-[var(--color-text-muted)]" />
              <span>{lead.last_city}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          {lead.owner_name && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]">
              <User className="w-3 h-3 text-[var(--color-accent)]/80" />
              <span>{lead.owner_name}</span>
            </div>
          )}

          {lead.source && (
            <div className="text-[11px] text-[var(--color-text-secondary)]">
              <span className="font-medium bg-[var(--color-border-subtle)] px-2 py-0.5 rounded-full border border-[var(--color-border-subtle)]">{lead.source}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 mt-1 pt-3 border-t border-[var(--color-border-subtle)]">
          {lead.value !== null && lead.value !== undefined && (
            <div className="flex items-center gap-1 text-xs text-[var(--color-text-primary)] font-medium">
              <DollarSign className="w-3 h-3 text-[var(--color-success)]" />
              <span>R$ {lead.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          {lead.connection_level && (
            <Badge variant="outline" className="text-[10px] h-5 bg-[var(--color-border-subtle)] border-[var(--color-border-medium)] text-foreground font-semibold tracking-wider uppercase ml-auto">
              {lead.connection_level}
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
}
