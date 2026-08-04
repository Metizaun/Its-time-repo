import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { AgentToolsPanel } from "@/components/agents/AgentToolsPanel";
import type { AgentTool } from "@/services/agentToolsService";

type AgentToolConfigurationDialogProps = {
  agentId: string;
  open: boolean;
  toolKey: AgentTool["key"] | null;
  onOpenChange: (open: boolean) => void;
};

const TOOL_LABELS: Record<AgentTool["key"], string> = {
  ai_audio: "Áudio IA",
  calendar: "Agenda",
  forwarding: "Encaminhamento",
  send_media: "Enviar mídia",
  rb_billing: "Cobrança RB",
  prescription_analyst: "Analista de receituário",
  visagism: "Visagismo",
};

export function AgentToolConfigurationDialog({
  agentId,
  open,
  toolKey,
  onOpenChange,
}: AgentToolConfigurationDialogProps) {
  const isWideFlow = toolKey === "visagism" || toolKey === "prescription_analyst" || toolKey === "forwarding";
  const hasDedicatedEditor = toolKey !== null && toolKey !== "send_media";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={isWideFlow
          ? "max-h-[92vh] max-w-5xl overflow-hidden [&>button]:hidden"
          : hasDedicatedEditor
            ? "max-h-[90vh] max-w-3xl overflow-hidden [&>button]:hidden"
            : "max-h-[90vh] max-w-3xl overflow-hidden"}
      >
        <DialogHeader className={hasDedicatedEditor ? "sr-only" : undefined}>
          <DialogTitle>{toolKey ? TOOL_LABELS[toolKey] : "Configurar ferramenta"}</DialogTitle>
          <DialogDescription>Revise e salve as configurações desta ferramenta.</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 overflow-y-auto pr-1">
          {open && agentId && toolKey ? (
            <AgentToolsPanel
              agentId={agentId}
              toolFilterKey={toolKey}
              onRequestClose={() => onOpenChange(false)}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
