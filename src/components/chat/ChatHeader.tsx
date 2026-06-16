import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, CalendarPlus, Info } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type ChatAiControl = {
  enabled: boolean;
  available: boolean;
  reason: "active" | "manual_off" | "auto_pause" | "global_inactive" | "no_agent";
  bypassingGlobalInactive: boolean;
  loading: boolean;
  saving: boolean;
  onToggle: (enabled: boolean) => Promise<unknown> | void;
};

interface ChatHeaderProps {
  leadName: string;
  instanceName?: string | null;
  showBackButton?: boolean;
  onBack?: () => void;
  onOpenDetails?: () => void;
  onSchedule?: () => void;
  aiControl?: ChatAiControl | null;
}

const AI_TOGGLE_ANIMATION_MS = 240;

function getAiTooltipText(aiControl: ChatAiControl) {
  if (aiControl.loading) {
    return "Carregando controle da IA";
  }

  if (!aiControl.available || aiControl.reason === "no_agent") {
    return "Sem agente nesta instância";
  }

  if (aiControl.reason === "auto_pause") {
    return "Pausada por atendimento humano";
  }

  if (aiControl.bypassingGlobalInactive && aiControl.enabled) {
    return "Bypass de teste ativo";
  }

  if (aiControl.enabled) {
    return "IA ativa";
  }

  return "IA desligada para este lead";
}

export function ChatHeader({
  leadName,
  instanceName,
  showBackButton = false,
  onBack,
  onOpenDetails,
  onSchedule,
  aiControl,
}: ChatHeaderProps) {
  const initial = leadName.charAt(0).toUpperCase();
  const [transitionState, setTransitionState] = useState<"idle" | "turning-on" | "turning-off">("idle");
  const previousEnabledRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!aiControl) {
      previousEnabledRef.current = null;
      setTransitionState("idle");
      return;
    }

    if (previousEnabledRef.current === null) {
      previousEnabledRef.current = aiControl.enabled;
      setTransitionState("idle");
      return;
    }

    if (previousEnabledRef.current === aiControl.enabled) {
      return;
    }

    previousEnabledRef.current = aiControl.enabled;
    setTransitionState(aiControl.enabled ? "turning-on" : "turning-off");

    const timer = window.setTimeout(() => {
      setTransitionState("idle");
    }, AI_TOGGLE_ANIMATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [aiControl]);

  const aiToggleState = !aiControl?.available ? "unavailable" : aiControl.enabled ? "on" : "off";
  const aiToggleDisabled = !aiControl || aiControl.loading || aiControl.saving || !aiControl.available;

  return (
    <div className="flex h-[var(--chat-header-height)] shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {showBackButton && onBack && (
          <button
            type="button"
            aria-label="Voltar para conversas"
            onClick={onBack}
            className="chat-tool-button focus-ring md:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}

        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/10">
          <span className="text-sm font-bold text-[var(--color-accent)]">{initial}</span>
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold leading-tight text-foreground">{leadName}</h2>
          {instanceName && (
            <span className="block truncate text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-secondary)]">
              {instanceName}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {onSchedule && (
          <button
            type="button"
            aria-label="Agendar compromisso"
            onClick={onSchedule}
            className="chat-tool-button h-9 w-9 text-[var(--color-text-secondary)] focus-ring hover:text-foreground"
          >
            <CalendarPlus className="h-[18px] w-[18px]" />
          </button>
        )}

        {aiControl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Alternar IA deste lead"
                disabled={aiToggleDisabled}
                onClick={() => {
                  void aiControl.onToggle(!aiControl.enabled);
                }}
                data-state={aiToggleState}
                data-transition={transitionState}
                data-busy={aiControl.saving ? "true" : "false"}
                data-bypass={aiControl.bypassingGlobalInactive ? "true" : "false"}
                className={cn("chat-ai-toggle", aiControl.loading && "chat-ai-toggle--loading")}
              >
                <Bot className={cn("chat-ai-toggle__icon", aiControl.loading && "animate-pulse-subtle")} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="border-[var(--color-border-medium)] bg-[var(--color-bg-surface)] text-foreground"
            >
              {getAiTooltipText(aiControl)}
            </TooltipContent>
          </Tooltip>
        )}

        {onOpenDetails && (
          <button
            type="button"
            aria-label="Abrir detalhes do lead"
            onClick={onOpenDetails}
            className="chat-tool-button h-9 w-9 text-[var(--color-text-secondary)] focus-ring hover:text-foreground"
          >
            <Info className="w-[18px] h-[18px]" />
          </button>
        )}
      </div>
    </div>
  );
}
