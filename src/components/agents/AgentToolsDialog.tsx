import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { AgentToolsPanel } from "@/components/agents/AgentToolsPanel";
import type { AgentTool } from "@/services/agentToolsService";

type AgentToolsDialogProps = {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toolKey?: AgentTool["key"] | null;
};

const TOOL_LABELS: Record<AgentTool["key"], string> = {
  ai_audio: "Audio IA",
  forwarding: "Encaminhamento",
  send_media: "Enviar midia",
  rb_billing: "Cobranca RB",
  prescription_analyst: "Analista de receituario",
  visagism: "Visagismo",
};

export function AgentToolsDialog({
  agentId,
  open,
  onOpenChange,
  toolKey = null,
}: AgentToolsDialogProps) {
  const title = toolKey ? TOOL_LABELS[toolKey] : "Ferramentas do agente";
  const description = toolKey
    ? "Ajuste somente esta capacidade do agente."
    : "Ative, desative e configure as capacidades disponiveis para este agente.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 overflow-y-auto pr-1">
          <AgentToolsPanel agentId={agentId} toolFilterKey={toolKey} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
