import { Badge } from "@/components/ui/badge";
import { type AutomationFunnel, type AutomationStep } from "@/hooks/useAutomation";
import { cn } from "@/lib/utils";
import { Clock3, MessageSquareMore, PenSquare } from "lucide-react";

import { formatDelayLabel, getMessagePreview, sortStepsForDisplay } from "./automation-utils";

interface AutomationCardProps {
  funnel: AutomationFunnel;
  steps: AutomationStep[];
  onEdit: (funnelId: string) => void;
}

export function AutomationCard({ funnel, steps, onEdit }: AutomationCardProps) {
  const orderedSteps = sortStepsForDisplay(steps);
  const previewSteps = orderedSteps.slice(0, 3);
  const remainingSteps = Math.max(orderedSteps.length - previewSteps.length, 0);

  return (
    <button
      type="button"
      onClick={() => onEdit(funnel.id)}
      className={cn(
        "group w-full rounded-2xl border bg-card/95 p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        !funnel.is_active && "opacity-70"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-tight">{funnel.name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={funnel.is_active ? "default" : "outline"}>
              {funnel.is_active ? "Ativa" : "Inativa"}
            </Badge>
            <Badge variant="outline">{funnel.instance_name}</Badge>
          </div>
        </div>

        <div className="rounded-full border p-2 text-muted-foreground transition-colors group-hover:text-foreground">
          <PenSquare className="h-4 w-4" />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MessageSquareMore className="h-3.5 w-3.5" />
          {orderedSteps.length} {orderedSteps.length === 1 ? "mensagem" : "mensagens"}
        </span>
        {orderedSteps[0] && (
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" />
            {formatDelayLabel(orderedSteps[0].delay_minutes)}
          </span>
        )}
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

        {remainingSteps > 0 && (
          <div className="px-1 text-xs font-medium text-muted-foreground">
            +{remainingSteps} {remainingSteps === 1 ? "mensagem adicional" : "mensagens adicionais"}
          </div>
        )}
      </div>
    </button>
  );
}
