import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { type AutomationJourney, type AutomationStep } from "@/lib/automation";
import { type PipelineStage } from "@/types";

import { AutomationCard } from "./AutomationCard";

interface AutomationColumnProps {
  stage: PipelineStage;
  stages: PipelineStage[];
  journeys: AutomationJourney[];
  stepsByJourney: Record<string, AutomationStep[]>;
  onCreate: (stageId: string) => void;
  onEdit: (journeyId: string) => void;
}

export function AutomationColumn({
  stage,
  stages,
  journeys,
  stepsByJourney,
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
            {journeys.length} {journeys.length === 1 ? "automacao" : "automacoes"}
          </p>
        </div>

        <Button variant="ghost" size="icon" onClick={() => onCreate(stage.id)} className="shrink-0 rounded-full">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {journeys.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
            Nenhuma automacao nesta etapa ainda.
          </div>
        ) : (
          journeys.map((journey) => (
            <AutomationCard
              key={journey.id}
              journey={journey}
              stages={stages}
              steps={stepsByJourney[journey.id] || []}
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
        <Plus className="mr-2 h-4 w-4" />
        Adicionar automacao
      </Button>
    </div>
  );
}
