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
  prescription_analyst: "Catálogo comercial",
  visagism: "Visagismo",
  store_locator: "Busca de filiais",
  commercial_catalog: "Catálogo comercial",
};

export function AgentToolConfigurationDialog({
  agentId,
  open,
  toolKey,
  onOpenChange,
}: AgentToolConfigurationDialogProps) {
  const effectiveToolKey = toolKey === "prescription_analyst" ? "commercial_catalog" : toolKey;
  const isWideFlow = effectiveToolKey === "visagism" || effectiveToolKey === "forwarding" || effectiveToolKey === "store_locator" || effectiveToolKey === "send_media" || effectiveToolKey === "commercial_catalog";
  const hasDedicatedEditor = toolKey !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={isWideFlow
          ? "flex max-h-[92vh] max-w-5xl flex-col overflow-hidden [&>button]:hidden"
          : hasDedicatedEditor
            ? "flex max-h-[90vh] max-w-3xl flex-col overflow-hidden [&>button]:hidden"
            : "flex max-h-[90vh] max-w-3xl flex-col overflow-hidden"}
      >
        <DialogHeader className={hasDedicatedEditor ? "sr-only" : "shrink-0"}>
          <DialogTitle>{effectiveToolKey ? TOOL_LABELS[effectiveToolKey] : "Configurar ferramenta"}</DialogTitle>
          <DialogDescription>Revise e salve as configurações desta ferramenta.</DialogDescription>
        </DialogHeader>

        <div className="min-w-0 min-h-0 flex-1 overflow-y-auto pr-1">
          {open && agentId && effectiveToolKey ? (
            <AgentToolsPanel
              agentId={agentId}
              toolFilterKey={effectiveToolKey}
              onRequestClose={() => onOpenChange(false)}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
