import { useEffect, useMemo, useState } from "react";
import { Lead } from "@/hooks/useLeads";
import { KanbanColumn } from "./KanbanColumn";
import { useLeadOperations } from "@/hooks/useLeadOperations";
import { usePipelineStages } from "@/hooks/usePipelineStages";

interface KanbanBoardProps {
  leads: Lead[];
  onLeadsChanged?: () => Promise<void> | void;
}

type DragType = "lead" | "column" | null;

export function KanbanBoard({ leads, onLeadsChanged }: KanbanBoardProps) {
  const { moveLeadToStage } = useLeadOperations();
  const { stages, loading, reorderStages } = usePipelineStages();
  const [optimisticLeads, setOptimisticLeads] = useState<Lead[]>(leads);
  const [activeDragType, setActiveDragType] = useState<DragType>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  useEffect(() => {
    setOptimisticLeads(leads);
  }, [leads]);

  const normalize = (value?: string | null) =>
    (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  const stageMetaById = useMemo(() => {
    const map = new Map<string, { name: string; category: string }>();
    stages.forEach((stage) => map.set(stage.id, { name: stage.name, category: stage.category }));
    return map;
  }, [stages]);

  const firstStageByCategory = useMemo(() => {
    const map: Record<string, string> = {};
    stages.forEach((stage) => {
      if (!map[stage.category]) {
        map[stage.category] = stage.id;
      }
    });
    return map;
  }, [stages]);

  const handleLeadDrop = async (targetColumnId: string, droppedLeadId?: string) => {
    const leadId = droppedLeadId || (activeDragType === "lead" ? activeDragId : null);
    if (!leadId) {
      setActiveDragType(null);
      setActiveDragId(null);
      return;
    }

    const leadToMove = optimisticLeads.find((lead) => lead.id === leadId);
    if (!leadToMove || leadToMove.stage_id === targetColumnId) {
      setActiveDragType(null);
      setActiveDragId(null);
      return;
    }

    const previousStageId = leadToMove.stage_id;
    const previousStatus = leadToMove.status;
    const targetStageMeta = stageMetaById.get(targetColumnId);

    setOptimisticLeads((prev) =>
      prev.map((lead) =>
        lead.id === leadId
          ? {
              ...lead,
              stage_id: targetColumnId,
              status: targetStageMeta?.category || previousStatus,
            }
          : lead
      )
    );

    const { error } = await moveLeadToStage(leadId, targetColumnId);
    if (error) {
      setOptimisticLeads((prev) =>
        prev.map((lead) =>
          lead.id === leadId
            ? {
                ...lead,
                stage_id: previousStageId,
                status: previousStatus,
              }
            : lead
        )
      );
      setActiveDragType(null);
      setActiveDragId(null);
      return;
    }

    setActiveDragType(null);
    setActiveDragId(null);
    await onLeadsChanged?.();
  };

  const handleColumnDrop = async (targetColumnId: string, sourceColumnId?: string) => {
    const effectiveSourceColumnId =
      sourceColumnId || (activeDragType === "column" ? activeDragId : null);

    if (!effectiveSourceColumnId || effectiveSourceColumnId === targetColumnId) {
      setActiveDragType(null);
      setActiveDragId(null);
      return;
    }

    const sourceIndex = stages.findIndex((s) => s.id === effectiveSourceColumnId);
    const targetIndex = stages.findIndex((s) => s.id === targetColumnId);
    if (sourceIndex === -1 || targetIndex === -1) {
      setActiveDragType(null);
      setActiveDragId(null);
      return;
    }

    const newStages = [...stages];
    const [movedStage] = newStages.splice(sourceIndex, 1);
    newStages.splice(targetIndex, 0, movedStage);

    const { error } = await reorderStages(newStages);
    if (error) {
      setActiveDragType(null);
      setActiveDragId(null);
      return;
    }

    setActiveDragType(null);
    setActiveDragId(null);
  };

  if (loading && stages.length === 0) {
    return <div className="flex w-full gap-3 pb-4">Carregando funil...</div>;
  }

  const groupedLeads = stages.reduce((acc, col) => {
    const normalizedStageName = normalize(col.name);
    const normalizedCategory = normalize(col.category);

    acc[col.id] = optimisticLeads.filter((lead) => {
      if (lead.stage_id === col.id) return true;

      if (!lead.stage_id) {
        const normalizedStatus = normalize(lead.status);

        if (normalizedStatus === normalizedStageName) return true;

        if (normalizedStatus === normalizedCategory && firstStageByCategory[col.category] === col.id) {
          return true;
        }
      }

      return false;
    });

    return acc;
  }, {} as Record<string, Lead[]>);

  return (
    <div className="flex w-full gap-3 pb-4 overflow-x-auto min-h-[70vh]">
      {stages.map((column) => (
        <KanbanColumn
          key={column.id}
          column={column}
          leads={groupedLeads[column.id] || []}
          activeDragType={activeDragType}
          activeDragId={activeDragId}
          onLeadDragStart={(leadId) => {
            setActiveDragType("lead");
            setActiveDragId(leadId);
          }}
          onLeadDragEnd={() => {
            setActiveDragType(null);
            setActiveDragId(null);
          }}
          onLeadDrop={handleLeadDrop}
          onColumnDragStart={(columnId) => {
            setActiveDragType("column");
            setActiveDragId(columnId);
          }}
          onColumnDragEnd={() => {
            setActiveDragType(null);
            setActiveDragId(null);
          }}
          onColumnDrop={handleColumnDrop}
          isDraggingColumn={activeDragType === "column" && activeDragId === column.id}
        />
      ))}
    </div>
  );
}
