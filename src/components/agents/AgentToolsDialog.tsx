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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <AgentToolsPanel agentId={agentId} toolFilterKey={toolKey} />
      </DialogContent>
    </Dialog>
  );
}
