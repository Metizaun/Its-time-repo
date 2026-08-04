import { useEffect, useState } from "react";
import { ChevronRight, Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { AgentBotIcon, ToolGlyph } from "@/components/agents/AgentCapabilityFlow";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { OpticsToolConfigPanel } from "@/components/agents/OpticsToolConfigPanel";
import { RbBillingConfigPanel } from "@/components/agents/RbBillingConfigPanel";
import { AudioToolConfigPanel } from "@/components/agents/AudioToolConfigPanel";
import { ForwardingConfigPanel } from "@/components/agents/ForwardingConfigPanel";
import { CalendarToolConfigPanel } from "@/components/agents/CalendarToolConfigPanel";
import {
  listAgentTools,
  updateAgentTool,
  type AgentTool,
} from "@/services/agentToolsService";

type AgentToolsPanelProps = {
  agentId: string;
  toolFilterKey?: AgentTool["key"] | null;
  onRequestClose?: () => void;
  onCreateSubagent?: () => void;
  onConfigure?: (toolKey: ConfigurableToolKey) => void;
};

type ConfigurableToolKey = "ai_audio" | "calendar" | "forwarding" | "prescription_analyst" | "visagism" | "rb_billing";

function readinessCopy(tool: AgentTool) {
  if (tool.enabled) return "Ativa";
  if (tool.readiness === "needs_config") return "Precisa configurar";
  if (tool.readiness === "unavailable") return "Indisponivel";
  return "Pronta para ativar";
}

function isConfigurableToolKey(value: string): value is ConfigurableToolKey {
  return value === "ai_audio" || value === "calendar" || value === "forwarding" || value === "prescription_analyst" || value === "visagism" || value === "rb_billing";
}

export function AgentToolsPanel({ agentId, toolFilterKey = null, onRequestClose, onCreateSubagent, onConfigure }: AgentToolsPanelProps) {
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);

    listAgentTools(agentId)
      .then((items) => {
        if (active) setTools(items);
      })
      .catch((error: unknown) => {
        if (!active) return;
        toast.error("Nao foi possivel carregar as Tools", {
          description: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [agentId, reloadKey]);

  async function toggleTool(tool: AgentTool, enabled: boolean) {
    try {
      setSavingKey(tool.key);
      const updated = await updateAgentTool(agentId, tool.key, { isEnabled: enabled });
      if (updated) {
        setTools((current) => current.map((item) => (item.key === updated.key ? updated : item)));
      }
      toast.success(enabled ? `${tool.name} ativada` : `${tool.name} desativada`);
    } catch (error: unknown) {
      toast.error("Nao foi possivel atualizar a Tool", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-24 items-center justify-center rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] text-sm text-[var(--color-gray-500)] shadow-sm">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Carregando Tools
      </div>
    );
  }

  const visibleTools = toolFilterKey ? tools.filter((tool) => tool.key === toolFilterKey) : tools;

  if (visibleTools.length === 0 && !onCreateSubagent) {
    return (
      <div className="rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-bg-subtle)] p-4">
        <p className="text-sm font-semibold text-[var(--color-gray-800)]">
          {toolFilterKey ? "Tool nao instalada neste agente" : "Nenhuma Tool instalada"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-gray-600)]">
          {toolFilterKey
            ? "Essa capacidade ainda nao esta disponivel para este agente."
            : "Este agente foi criado em branco. A instalacao manual de Tools entra na proxima etapa desta tela."}
        </p>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-2 overflow-x-hidden">
      {onCreateSubagent ? (
        <button
          type="button"
          onClick={onCreateSubagent}
          className="flex min-w-0 items-center gap-3 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-3 text-left shadow-sm transition-[border-color,box-shadow] hover:border-[var(--color-primary-200)] hover:shadow-md focus-visible:outline-none focus-visible:shadow-focus"
          aria-label="Adicionar subagente"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-lg)] border border-[var(--cq-flow-icon-border)] bg-[var(--color-surface-1)] shadow-sm">
            <AgentBotIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-sm font-semibold text-[var(--color-gray-900)]">Subagente</strong>
            <span className="mt-0.5 block truncate text-xs text-[var(--color-gray-500)]">Criar atendimento especializado</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-primary-500)]" aria-hidden="true" />
        </button>
      ) : null}

      {visibleTools.map((tool) => {
        const canEnable = tool.readiness === "ready";
        const saving = savingKey === tool.key;

        const configurableKey = isConfigurableToolKey(tool.key) ? tool.key : null;
        const closeConfiguration = () => {
          if (toolFilterKey && onRequestClose) {
            onRequestClose();
            return;
          }
        };
        return (
          <div key={tool.id} className="grid min-w-0 gap-2">
          {toolFilterKey ? (
            <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--border-default)] pb-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-gray-800)]">Tool ativa</p>
                <p className="mt-0.5 text-xs text-[var(--color-gray-500)]">{readinessCopy(tool)}</p>
              </div>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin text-[var(--color-gray-500)] motion-reduce:animate-none" aria-label="Salvando" />
              ) : (
                <Switch
                  checked={tool.enabled}
                  disabled={!canEnable && !tool.enabled}
                  onCheckedChange={(checked) => toggleTool(tool, checked)}
                  aria-label={`${tool.enabled ? "Desativar" : "Ativar"} ${tool.name}`}
                />
              )}
            </div>
          ) : (
          <div className="flex min-w-0 items-center gap-3 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-3 shadow-sm">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-lg)] border border-[var(--cq-flow-icon-border)] bg-[var(--color-surface-1)] shadow-sm">
              <ToolGlyph tool={tool} className="h-5 w-5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-[var(--color-gray-900)]">{tool.name}</p>
                <span className={cn("text-[10px] font-semibold", tool.enabled ? "text-[var(--color-success-600)]" : "text-[var(--color-gray-500)]")}>
                  {readinessCopy(tool)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--color-gray-500)]">{tool.description}</p>
            </div>

            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--color-gray-500)]" aria-label="Salvando" />
            ) : (
              <div className="flex shrink-0 items-center gap-2">
              {configurableKey && onConfigure ? <button type="button" onClick={() => onConfigure(configurableKey)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-input)] px-3 text-xs font-semibold text-[var(--color-gray-700)] shadow-sm transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-[var(--color-primary-200)] hover:shadow-md focus-visible:outline-none focus-visible:shadow-focus active:translate-y-0 active:shadow-inset"><Settings2 className="h-3.5 w-3.5" />Configurar</button> : null}
              <Switch
                checked={tool.enabled}
                disabled={!canEnable && !tool.enabled}
                onCheckedChange={(checked) => toggleTool(tool, checked)}
                aria-label={`${tool.enabled ? "Desativar" : "Ativar"} ${tool.name}`}
              />
              </div>
            )}
          </div>
          )}
          {tool.key === "rb_billing" && toolFilterKey === tool.key ? (
            <RbBillingConfigPanel
              agentId={agentId}
              onClose={closeConfiguration}
              onChanged={() => setReloadKey((value) => value + 1)}
            />
          ) : null}
          {tool.key === "ai_audio" && toolFilterKey === tool.key ? (
            <AudioToolConfigPanel agentId={agentId} tool={tool} onClose={closeConfiguration} onChanged={() => setReloadKey((value) => value + 1)} />
          ) : null}
          {tool.key === "forwarding" && toolFilterKey === tool.key ? (
            <ForwardingConfigPanel
              agentId={agentId}
              onClose={closeConfiguration}
              onChanged={() => setReloadKey((value) => value + 1)}
            />
          ) : null}
          {tool.key === "calendar" && toolFilterKey === tool.key ? (
            <CalendarToolConfigPanel
              agentId={agentId}
              tool={tool}
              onClose={closeConfiguration}
              onChanged={() => setReloadKey((value) => value + 1)}
            />
          ) : null}
          {(tool.key === "prescription_analyst" || tool.key === "visagism") && toolFilterKey === tool.key ? (
            <OpticsToolConfigPanel
              agentId={agentId}
              toolKey={tool.key}
              onClose={closeConfiguration}
              onChanged={() => setReloadKey((value) => value + 1)}
            />
          ) : null}
          </div>
        );
      })}
    </div>
  );
}
