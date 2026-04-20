import { useEffect, useRef, useState } from "react";
import { Bot, Info } from "lucide-react";

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
  onOpenDetails?: () => void;
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
  onOpenDetails,
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
    <div className="border-b border-[var(--color-border-subtle)] px-5 py-3 flex items-center justify-between bg-transparent">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 flex items-center justify-center">
          <span className="text-sm font-bold text-[var(--color-accent)]">{initial}</span>
        </div>
        <div>
          <h2 className="font-bold text-foreground text-base leading-tight">{leadName}</h2>
          {instanceName && (
            <span className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-widest font-semibold">
              {instanceName}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
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
            onClick={onOpenDetails}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-[var(--color-text-secondary)] hover:text-foreground hover:bg-[var(--color-border-subtle)] transition-all duration-200"
          >
            <Info className="w-[18px] h-[18px]" />
          </button>
        )}
      </div>
    </div>
  );
}
