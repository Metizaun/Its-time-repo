import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { type AutomationFunnel, type AutomationStep } from "@/hooks/useAutomation";
import { type PipelineStage } from "@/types";

import { AutomationColumn } from "./AutomationColumn";

interface AutomationBoardProps {
  stages: PipelineStage[];
  funnels: AutomationFunnel[];
  stepsByFunnel: Record<string, AutomationStep[]>;
  onCreate: (stageId: string) => void;
  onEdit: (funnelId: string) => void;
}

function sortFunnelsForBoard(funnels: AutomationFunnel[]) {
  return [...funnels].sort((left, right) => {
    if (left.is_active !== right.is_active) {
      return left.is_active ? -1 : 1;
    }

    return left.created_at.localeCompare(right.created_at);
  });
}

export function AutomationBoard({
  stages,
  funnels,
  stepsByFunnel,
  onCreate,
  onEdit,
}: AutomationBoardProps) {
  const funnelsByStage = stages.reduce<Record<string, AutomationFunnel[]>>((accumulator, stage) => {
    accumulator[stage.id] = sortFunnelsForBoard(
      funnels.filter((funnel) => funnel.trigger_stage_id === stage.id)
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
              funnels={funnelsByStage[stage.id] || []}
              stepsByFunnel={stepsByFunnel}
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
