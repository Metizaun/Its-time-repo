import { useEffect, useState } from "react";
import {
  AudioLines,
  Files,
  Loader2,
  Plus,
  Route,
  ScanFace,
  ScanLine,
  Wrench,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { listAgentTools, type AgentTool } from "@/services/agentToolsService";
import { AgentToolsDialog } from "@/components/agents/AgentToolsDialog";

type AgentToolRailProps = {
  agentId: string;
};

const TOOL_ICONS = {
  ai_audio: AudioLines,
  forwarding: Route,
  send_media: Files,
  prescription_analyst: ScanLine,
  visagism: ScanFace,
} as const;

function toolStateLabel(tool: AgentTool) {
  if (tool.enabled) return "Ativa";
  if (tool.readiness === "needs_config") return "Precisa configurar";
  if (tool.readiness === "unavailable") return "Indisponivel";
  return "Desativada";
}

export function AgentToolRail({ agentId }: AgentToolRailProps) {
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedToolKey, setSelectedToolKey] = useState<AgentTool["key"] | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    listAgentTools(agentId)
      .then((items) => {
        if (active) setTools(items);
      })
      .catch(() => {
        if (active) setTools([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [agentId]);

  function openToolsDialog(toolKey: AgentTool["key"] | null = null) {
    setSelectedToolKey(toolKey);
    setDialogOpen(true);
  }

  return (
    <>
      <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--color-gray-500)]">
            Tools
          </span>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-gray-400)]" /> : null}
        </div>

        <div className="relative flex min-h-10 items-center gap-2">
          <span className="absolute left-4 right-4 top-1/2 h-px -translate-y-1/2 bg-[var(--border-default)]" />

          <button
            type="button"
            onClick={() => openToolsDialog(null)}
            className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[var(--border-input)] bg-[var(--color-surface-1)] text-[var(--color-gray-600)] shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:shadow-focus"
            aria-label="Adicionar ou configurar Tools"
            title="Adicionar ou configurar Tools"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>

          {tools.map((tool) => {
            const Icon = TOOL_ICONS[tool.key as keyof typeof TOOL_ICONS] ?? Wrench;
            const stateLabel = toolStateLabel(tool);

            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => openToolsDialog(tool.key)}
                className={cn(
                  "relative grid h-9 w-9 shrink-0 place-items-center rounded-full border bg-[var(--color-surface-1)] shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:shadow-focus",
                  tool.enabled
                    ? "border-[var(--color-success-border)] text-[var(--color-success-600)]"
                    : tool.readiness === "needs_config"
                      ? "border-[var(--color-warning-border)] text-[var(--color-warning-600)]"
                      : "border-[var(--border-input)] text-[var(--color-gray-500)]"
                )}
                aria-label={`${tool.name}: ${stateLabel}`}
                title={`${tool.name} - ${stateLabel}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      <AgentToolsDialog
        agentId={agentId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        toolKey={selectedToolKey}
      />
    </>
  );
}
