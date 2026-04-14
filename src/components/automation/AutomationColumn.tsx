import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { type AutomationFunnel, type AutomationStep } from "@/hooks/useAutomation";
import { type PipelineStage } from "@/types";

import { AutomationCard } from "./AutomationCard";

interface AutomationColumnProps {
  stage: PipelineStage;
  funnels: AutomationFunnel[];
  stepsByFunnel: Record<string, AutomationStep[]>;
  onCreate: (stageId: string) => void;
  onEdit: (funnelId: string) => void;
}

export function AutomationColumn({
  stage,
  funnels,
  stepsByFunnel,
  onCreate,
  onEdit,
}: AutomationColumnProps) {
  return (
    <div className="w-[340px] min-w-[340px] rounded-[28px] border bg-card/80 p-4 shadow-sm backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full border border-background/40"
              style={{ backgroundColor: stage.color }}
            />
            <h2 className="truncate font-semibold">{stage.name}</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {funnels.length} {funnels.length === 1 ? "automação" : "automações"}
          </p>
        </div>

        <Button variant="ghost" size="icon" onClick={() => onCreate(stage.id)} className="shrink-0 rounded-full">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {funnels.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
            Nenhuma automação nesta etapa ainda.
          </div>
        ) : (
          funnels.map((funnel) => (
            <AutomationCard
              key={funnel.id}
              funnel={funnel}
              steps={stepsByFunnel[funnel.id] || []}
              onEdit={onEdit}
            />
          ))
        )}
      </div>

      <Button
        variant="ghost"
        onClick={() => onCreate(stage.id)}
        className="mt-4 w-full justify-start rounded-2xl border border-dashed"
      >
        <Plus className="h-4 w-4 mr-2" />
        Adicionar automação
      </Button>
    </div>
  );
}
