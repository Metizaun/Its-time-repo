import { Badge } from "@/components/ui/badge";
import {
  buildAutomationLookupMaps,
  formatAnchorEventLabel,
  formatReentryModeLabel,
  summarizeRuleNode,
  type AutomationJourney,
  type AutomationStep,
} from "@/lib/automation";
import { cn } from "@/lib/utils";
import { Clock3, MessageSquareMore, PenSquare, Waypoints } from "lucide-react";
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
        <div className="min-w-0">
          <p className="font-semibold leading-tight">{journey.name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={journey.is_active ? "default" : "outline"}>
              {journey.is_active ? "Ativa" : "Inativa"}
            </Badge>
            <Badge variant="outline">{journey.instance_name}</Badge>
            <Badge variant="outline">{formatAnchorEventLabel(journey.anchor_event)}</Badge>
          </div>
        </div>

        <div className="rounded-full border p-2 text-muted-foreground transition-colors group-hover:text-foreground">
          <PenSquare className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Waypoints className="h-3.5 w-3.5" />
          Entrada: {summarizeRuleNode(journey.entry_rule, lookups)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock3 className="h-3.5 w-3.5" />
          Reentrada: {formatReentryModeLabel(journey.reentry_mode)}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquareMore className="h-3.5 w-3.5" />
          Saida: {summarizeRuleNode(journey.exit_rule, lookups)}
        </span>
      </div>

      <div className="mt-4 space-y-2">
        {previewSteps.length === 0 ? (
          <div className="rounded-xl border border-dashed px-3 py-4 text-sm text-muted-foreground">
            Nenhuma mensagem configurada ainda.
          </div>
        ) : (
          previewSteps.map((step) => (
            <div key={step.id} className="rounded-xl border bg-background/80 px-3 py-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[11px]">
                  {formatDelayLabel(step.delay_minutes)}
                </Badge>
                {!step.is_active && (
                  <Badge variant="outline" className="text-[11px]">
                    Pausada
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {getMessagePreview(step.message_template)}
              </p>
            </div>
          ))
        )}

        <div className="flex items-center justify-between px-1 text-xs font-medium text-muted-foreground">
          <span>{orderedSteps.length} mensagens</span>
          {orderedSteps[0] ? <span>Primeira: {formatDelayLabel(orderedSteps[0].delay_minutes)}</span> : null}
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
