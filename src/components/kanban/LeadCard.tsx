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
        "p-3 transition-all focus-ring",
        isHolding ? "cursor-grabbing shadow-md -translate-y-0.5" : "cursor-pointer"
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
      <div className="space-y-2">
        <div>
          <h4 className="font-semibold text-sm leading-tight">{lead.lead_name}</h4>
          {lead.last_city && (
            <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
              <Building2 className="w-3 h-3" />
              <span>{lead.last_city}</span>
            </div>
          )}
        </div>

        {lead.owner_name && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <User className="w-3 h-3" />
            <span>{lead.owner_name}</span>
          </div>
        )}

        {lead.source && (
          <div className="text-[11px] text-muted-foreground">
            <span className="font-medium">{lead.source}</span>
          </div>
        )}

        <div className="flex items-center gap-2 mt-1">
          {lead.value !== null && lead.value !== undefined && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <DollarSign className="w-3.5 h-3.5" />
              <span>R$ {lead.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          {lead.connection_level && (
            <Badge variant="outline" className="text-xs h-5">
              {lead.connection_level}
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
}
