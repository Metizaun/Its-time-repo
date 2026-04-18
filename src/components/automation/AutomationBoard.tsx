import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { type AutomationJourney, type AutomationStep } from "@/lib/automation";
import { type PipelineStage } from "@/types";

import { AutomationColumn } from "./AutomationColumn";

interface AutomationBoardProps {
  stages: PipelineStage[];
  journeys: AutomationJourney[];
  stepsByJourney: Record<string, AutomationStep[]>;
  onCreate: (stageId: string) => void;
  onEdit: (journeyId: string) => void;
}

function sortJourneysForBoard(journeys: AutomationJourney[]) {
  return [...journeys].sort((left, right) => {
    if (left.is_active !== right.is_active) {
      return left.is_active ? -1 : 1;
    }

    return left.created_at.localeCompare(right.created_at);
  });
}

export function AutomationBoard({
  stages,
  journeys,
  stepsByJourney,
  onCreate,
  onEdit,
}: AutomationBoardProps) {
  const journeysByStage = stages.reduce<Record<string, AutomationJourney[]>>((accumulator, stage) => {
    accumulator[stage.id] = sortJourneysForBoard(
      journeys.filter((journey) => journey.trigger_stage_id === stage.id)
    );
    return accumulator;
  }, {});

  return (
    <div className="rounded-[32px] border bg-gradient-to-br from-background via-background to-muted/30 p-4 shadow-sm">
      <ScrollArea className="w-full whitespace-nowrap">
        <div className="flex w-max gap-4 pb-4">
          {stages.map((stage) => (
            <AutomationColumn
              key={stage.id}
              stage={stage}
              journeys={journeysByStage[stage.id] || []}
              stepsByJourney={stepsByJourney}
              stages={stages}
              onCreate={onCreate}
              onEdit={onEdit}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
