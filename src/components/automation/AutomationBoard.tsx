import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { type AutomationJourney, type AutomationStep } from "@/lib/automation";
import { type PipelineStage } from "@/types";

import { AutomationColumn } from "./AutomationColumn";

interface AutomationBoardProps {
  stages: PipelineStage[];
  journeys: AutomationJourney[];
  stepsByJourney: Record<string, AutomationStep[]>;
  onCreate: (stageId: string) => void;
  onCreateCalendar: () => void;
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
  onCreateCalendar,
  onEdit,
}: AutomationBoardProps) {
  const journeysByStage = stages.reduce<Record<string, AutomationJourney[]>>((accumulator, stage) => {
    accumulator[stage.id] = sortJourneysForBoard(
      journeys.filter((journey) => journey.trigger_stage_id === stage.id)
    );
    return accumulator;
  }, {});

  const calendarJourneys = sortJourneysForBoard(
    journeys.filter((journey) => journey.entry_source === "calendar_event")
  );

  return (
    <div className="rounded-[28px] border bg-background p-4 shadow-sm">
      <ScrollArea className="w-full">
        <div className="flex w-max gap-4 pb-4">
          {stages.map((stage) => (
            <AutomationColumn
              key={stage.id}
              title={stage.name}
              dotColor={stage.color}
              emptyLabel="Nenhuma automacao nesta etapa ainda."
              journeys={journeysByStage[stage.id] || []}
              stepsByJourney={stepsByJourney}
              stages={stages}
              onCreate={() => onCreate(stage.id)}
              onEdit={onEdit}
            />
          ))}

          <AutomationColumn
            title="Agenda"
            dotColor="var(--color-primary-500)"
            emptyLabel="Nenhuma automacao de agendamento ainda."
            journeys={calendarJourneys}
            stepsByJourney={stepsByJourney}
            stages={stages}
            onCreate={onCreateCalendar}
            onEdit={onEdit}
          />
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
