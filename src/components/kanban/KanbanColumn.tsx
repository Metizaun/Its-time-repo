import { Lead } from "@/hooks/useLeads";
import { PipelineStage } from "@/types";
import { LeadCard } from "./LeadCard";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { MoreVertical, Edit2, Trash2, GripVertical, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useApp } from "@/context/AppContext";

interface KanbanColumnProps {
  column: PipelineStage;
  leads: Lead[];
  activeDragType: "lead" | "column" | null;
  activeDragId: string | null;
  onLeadDragStart: (leadId: string) => void;
  onLeadDragEnd: () => void;
  onLeadDrop: (targetColumnId: string, leadId?: string) => void;
  onColumnDragStart?: (columnId: string) => void;
  onColumnDragEnd?: () => void;
  onColumnDrop?: (targetColumnId: string, sourceColumnId?: string) => void;
  isDraggingColumn?: boolean;
}

export function KanbanColumn({
  column,
  leads,
  activeDragType,
  activeDragId,
  onLeadDragStart,
  onLeadDragEnd,
  onLeadDrop,
  onColumnDragStart,
  onColumnDragEnd,
  onColumnDrop,
  isDraggingColumn,
}: KanbanColumnProps) {
  const { openModal } = useApp();
  const { userRole } = useAuth();
  const isAdmin = userRole === "ADMIN";
  const [isLeadDragOver, setIsLeadDragOver] = useState(false);
  const [isColumnDragOver, setIsColumnDragOver] = useState(false);
  const [visibleCount, setVisibleCount] = useState(6);
  const visibleLeads = useMemo(() => leads.slice(0, visibleCount), [leads, visibleCount]);
  const remainingLeads = Math.max(0, leads.length - visibleLeads.length);

  useEffect(() => {
    setVisibleCount(6);
  }, [column.id]);

  const handleLeadDragOver = (e: React.DragEvent) => {
    if (activeDragType !== "lead") return;
    e.preventDefault();
    setIsLeadDragOver(true);
  };

  const handleLeadDragLeave = () => {
    setIsLeadDragOver(false);
  };

  const handleLeadDrop = (e: React.DragEvent) => {
    if (activeDragType !== "lead") return;
    e.preventDefault();
    e.stopPropagation();
    setIsLeadDragOver(false);

    const leadId = e.dataTransfer.getData("text/lead-id") || (activeDragType === "lead" ? activeDragId || undefined : undefined);
    onLeadDrop(column.id, leadId);
  };

  const handleColumnDragOver = (e: React.DragEvent) => {
    if (activeDragType !== "column") return;
    e.preventDefault();
    setIsColumnDragOver(true);
  };

  const handleColumnDragLeave = () => {
    setIsColumnDragOver(false);
  };

  const handleColumnDrop = (e: React.DragEvent) => {
    if (activeDragType !== "column") return;
    e.preventDefault();
    e.stopPropagation();
    setIsColumnDragOver(false);

    const sourceColumnId =
      e.dataTransfer.getData("text/column-id") ||
      (activeDragType === "column" ? activeDragId || undefined : undefined);

    onColumnDrop?.(column.id, sourceColumnId);
  };

  return (
    <div
      className={cn(
        "pipeline-column",
        isLeadDragOver && "bg-[var(--color-border-subtle)]",
        isDraggingColumn && "opacity-50"
      )}
      style={{ 
        borderTopColor: column.color,
      }}
      onDragOver={handleLeadDragOver}
      onDragLeave={handleLeadDragLeave}
      onDrop={handleLeadDrop}
      role="list"
      aria-label={`Coluna ${column.name}`}
    >
      <div
        className={cn(
          "px-4 py-3 flex items-center justify-between transition-colors",
          isAdmin && "cursor-grab active:cursor-grabbing",
          isColumnDragOver && "bg-[var(--color-border-subtle)]"
        )}
        draggable={isAdmin}
        onDragStart={(e) => {
          if (!isAdmin) return;
          e.dataTransfer.setData("application/x-kanban-item", "column");
          e.dataTransfer.setData("text/column-id", column.id);
          e.dataTransfer.effectAllowed = "move";
          onColumnDragStart?.(column.id);
        }}
        onDragEnd={() => {
          setIsColumnDragOver(false);
          onColumnDragEnd?.();
        }}
        onDragOver={handleColumnDragOver}
        onDragLeave={handleColumnDragLeave}
        onDrop={handleColumnDrop}
      >
        <div className="flex items-center gap-2">
          {isAdmin && <GripVertical className="w-4 h-4 text-[var(--color-text-muted)]" />}
          <h3 className="font-bold text-sm text-foreground">{column.name}</h3>
          <span className="text-[10px] uppercase font-semibold tracking-wider text-[var(--color-text-muted)]">({leads.length})</span>
        </div>

        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                <MoreVertical className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[var(--color-bg-elevated)] border-[var(--color-border-subtle)] text-foreground rounded-xl">
              <DropdownMenuItem onClick={() => openModal("STAGE_FORM", { stage: column, pipelineId: column.pipeline_id })} className="focus:bg-[var(--color-bg-surface)] focus:text-foreground cursor-pointer rounded-lg">
                <Edit2 className="w-4 h-4 mr-2 opacity-70" />
                Editar Etapa
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openModal("DELETE_STAGE", { stage: column })}
                disabled={column.isAttendanceStage}
                className="text-[var(--color-destructive)] focus:bg-[var(--color-destructive)]/10 focus:text-[var(--color-destructive)] cursor-pointer rounded-lg"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Excluir Etapa
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className={cn("pipeline-column__leads", isLeadDragOver && "opacity-70")}>
        {leads.length === 0 ? (
          <div className="text-center py-12 text-[var(--color-text-muted)] text-xs tracking-wider uppercase font-medium">Nenhum lead nesta etapa</div>
        ) : (
          visibleLeads.map((lead) => (
            <LeadCard
              key={lead.id}
              lead={lead}
              onDragStart={() => onLeadDragStart(lead.id)}
              onDragEnd={onLeadDragEnd}
            />
          ))
        )}
        {remainingLeads > 0 && (
          <Button
            type="button"
            variant="ghost"
            className="pipeline-show-more"
            onClick={() => setVisibleCount((count) => count + 10)}
          >
            <ChevronDown className="h-4 w-4" />
            Ver mais {Math.min(10, remainingLeads)}
            <span className="pipeline-show-more__remaining">{remainingLeads} restantes</span>
          </Button>
        )}
      </div>
    </div>
  );
}
