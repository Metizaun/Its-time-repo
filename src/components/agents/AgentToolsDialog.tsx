import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { AgentToolsPanel } from "@/components/agents/AgentToolsPanel";
import type { AgentTool } from "@/services/agentToolsService";

type AgentToolsDialogProps = {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateSubagent?: () => void;
  onConfigure: (toolKey: AgentTool["key"]) => void;
};

export function AgentToolsDialog({
  agentId,
  open,
  onOpenChange,
  onCreateSubagent,
  onConfigure,
}: AgentToolsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Ferramentas do agente</DialogTitle>
          <DialogDescription>Ative, desative e escolha a capacidade que deseja configurar.</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 min-h-0 flex-1 overflow-y-auto pr-1">
          {open && agentId ? (
            <AgentToolsPanel
              agentId={agentId}
              onCreateSubagent={onCreateSubagent}
              onConfigure={onConfigure}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
