import { Badge } from "@/components/ui/badge";
import {
  buildAutomationLookupMaps,
  summarizeRuleNode,
  type AutomationJourney,
  type AutomationStep,
} from "@/lib/automation";
import { cn } from "@/lib/utils";
import { PenSquare, Sparkles } from "lucide-react";
import type { PipelineStage } from "@/types";

import { formatDelayLabel, getMessagePreview, sortStepsForDisplay } from "./automation-utils";

interface AutomationCardProps {
  journey: AutomationJourney;
  stages: PipelineStage[];
  steps: AutomationStep[];
  onEdit: (journeyId: string) => void;
}

export function AutomationCard({ journey, stages, steps, onEdit }: AutomationCardProps) {
  const orderedSteps = sortStepsForDisplay(steps);
  const previewSteps = orderedSteps.slice(0, 2);
  const remainingSteps = Math.max(orderedSteps.length - previewSteps.length, 0);
  const lookups = buildAutomationLookupMaps({ stages });
  const entrySummary = summarizeRuleNode(journey.entry_rule, lookups);
  const firstStepSummary = orderedSteps[0]
    ? `Primeira: ${formatDelayLabel(orderedSteps[0].delay_minutes, journey.anchor_event)}`
    : null;

  return (
    <button
      type="button"
      onClick={() => onEdit(journey.id)}
      className={cn(
        "group w-full rounded-2xl border bg-card/95 p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        !journey.is_active && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight" title={journey.name}>
            {journey.name}
          </p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant={journey.is_active ? "default" : "outline"}>
              {journey.is_active ? "Ativa" : "Inativa"}
            </Badge>
            <Badge variant="outline" className="min-w-0 max-w-full overflow-hidden">
              <span className="truncate" title={journey.instance_name}>
                {journey.instance_name}
              </span>
            </Badge>
          </div>
        </div>

        <div className="shrink-0 rounded-full border p-2 text-muted-foreground transition-colors group-hover:text-foreground">
          <PenSquare className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border bg-background/70 px-3 py-3 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate" title={`Comeca quando: ${entrySummary}`}>
            Comeca quando: {entrySummary}
          </span>
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {previewSteps.length === 0 ? (
          <div className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
            Nenhuma mensagem configurada ainda.
          </div>
        ) : (
          previewSteps.map((step) => {
            const delayLabel = formatDelayLabel(step.delay_minutes, journey.anchor_event);
            const messagePreview = getMessagePreview(step.message_template);

            return (
              <div key={step.id} className="overflow-hidden rounded-xl border bg-background/80 px-3 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant="secondary" className="min-w-0 max-w-full overflow-hidden text-[11px]">
                    <span className="truncate" title={delayLabel}>
                      {delayLabel}
                    </span>
                  </Badge>
                  {!step.is_active && (
                    <Badge variant="outline" className="shrink-0 text-[11px]">
                      Pausada
                    </Badge>
                  )}
                </div>
                <p className="mt-2 truncate text-sm leading-relaxed text-muted-foreground" title={messagePreview}>
                  {messagePreview}
                </p>
              </div>
            );
          })
        )}

        <div className="flex min-w-0 items-center justify-between gap-3 px-1 text-xs font-medium text-muted-foreground">
          <span className="shrink-0">{orderedSteps.length} mensagens</span>
          {firstStepSummary ? (
            <span className="min-w-0 truncate text-right" title={firstStepSummary}>
              {firstStepSummary}
            </span>
          ) : null}
        </div>

        {remainingSteps > 0 && (
          <div className="px-1 text-xs font-medium text-muted-foreground">
            +{remainingSteps} {remainingSteps === 1 ? "mensagem adicional" : "mensagens adicionais"}
          </div>
        )}
      </div>
    </button>
  );
}
