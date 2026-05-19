import { Badge } from "@/components/ui/badge";
import { type AutomationJourney, type AutomationStep } from "@/lib/automation";
import { cn } from "@/lib/utils";
import { PenSquare } from "lucide-react";
import type { PipelineStage } from "@/types";

import { formatDelayLabel, sortStepsForDisplay } from "./automation-utils";

interface AutomationCardProps {
  journey: AutomationJourney;
  stages: PipelineStage[];
  steps: AutomationStep[];
  onEdit: (journeyId: string) => void;
}

export function AutomationCard({ journey, stages, steps, onEdit }: AutomationCardProps) {
  const orderedSteps = sortStepsForDisplay(steps);
  const firstStepSummary = orderedSteps[0]
    ? `Primeira: ${formatDelayLabel(orderedSteps[0].delay_minutes, journey.anchor_event)}`
    : null;
  const stageName = stages.find((stage) => stage.id === journey.trigger_stage_id)?.name;

  return (
    <button
      type="button"
      onClick={() => onEdit(journey.id)}
      className={cn(
        "group w-full min-w-0 rounded-2xl border bg-card/90 p-3 text-left shadow-sm transition-colors hover:border-foreground/20 hover:bg-card",
        !journey.is_active && "opacity-70",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight" title={journey.name}>
            {journey.name}
          </p>
          <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={journey.is_active ? "default" : "outline"} className="h-5 rounded-full px-2 text-[11px]">
              {journey.is_active ? "Ativa" : "Inativa"}
            </Badge>
            <span className="truncate" title={stageName || journey.instance_name}>
              {stageName || journey.instance_name}
            </span>
          </div>
        </div>

        <div className="shrink-0 rounded-full border p-1.5 text-muted-foreground transition-colors group-hover:text-foreground">
          <PenSquare className="h-3.5 w-3.5" />
        </div>
      </div>

      <div className="mt-3 flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="shrink-0">
          {orderedSteps.length} {orderedSteps.length === 1 ? "mensagem" : "mensagens"}
        </span>
        {firstStepSummary ? (
          <span className="min-w-0 truncate text-right" title={firstStepSummary}>
            {firstStepSummary}
          </span>
        ) : (
          <span className="min-w-0 truncate text-right">Sem mensagens</span>
        )}
      </div>
    </button>
  );
}
