import { useEffect, useState } from "react";
import {
  AudioLines,
  Files,
  Loader2,
  Route,
  ScanFace,
  ScanLine,
  Settings2,
  Wallet,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { OpticsToolConfigPanel } from "@/components/agents/OpticsToolConfigPanel";
import { RbBillingConfigPanel } from "@/components/agents/RbBillingConfigPanel";
import {
  listAgentTools,
  updateAgentTool,
  type AgentTool,
} from "@/services/agentToolsService";

type AgentToolsPanelProps = {
  agentId: string;
  toolFilterKey?: AgentTool["key"] | null;
};

type ConfigurableToolKey = "prescription_analyst" | "visagism" | "rb_billing";

const TOOL_ICONS = {
  ai_audio: AudioLines,
  forwarding: Route,
  send_media: Files,
  rb_billing: Wallet,
  prescription_analyst: ScanLine,
  visagism: ScanFace,
} as const;

function readinessCopy(tool: AgentTool) {
  if (tool.enabled) return "Ativa";
  if (tool.readiness === "needs_config") return "Precisa configurar";
  if (tool.readiness === "unavailable") return "Indisponivel";
  return "Pronta para ativar";
}

function isConfigurableToolKey(value: string): value is ConfigurableToolKey {
  return value === "prescription_analyst" || value === "visagism" || value === "rb_billing";
}

export function AgentToolsPanel({ agentId, toolFilterKey = null }: AgentToolsPanelProps) {
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [configuringKey, setConfiguringKey] = useState<ConfigurableToolKey | null>(null);
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

  useEffect(() => {
    if (toolFilterKey && isConfigurableToolKey(toolFilterKey)) {
      setConfiguringKey(toolFilterKey);
      return;
    }

    setConfiguringKey(null);
  }, [toolFilterKey]);

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

  if (visibleTools.length === 0) {
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
      {visibleTools.map((tool) => {
        const Icon = TOOL_ICONS[tool.key as keyof typeof TOOL_ICONS] ?? Wrench;
        const canEnable = tool.readiness === "ready";
        const saving = savingKey === tool.key;

        const configurableKey = isConfigurableToolKey(tool.key) ? tool.key : null;
        return (
          <div key={tool.id} className="grid min-w-0 gap-2">
          <div className="flex min-w-0 items-center gap-3 overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-3 shadow-sm">
            <div
              className={cn(
                "grid h-10 w-10 shrink-0 place-items-center rounded-full border",
                tool.enabled
                  ? "border-[var(--color-success-border)] bg-[var(--color-success-50)] text-[var(--color-success-600)]"
                  : tool.readiness === "needs_config"
                    ? "border-[var(--color-warning-border)] bg-[var(--color-warning-50)] text-[var(--color-warning-600)]"
                    : "border-[var(--border-input)] bg-[var(--color-bg-subtle)] text-[var(--color-gray-500)]"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-semibold text-[var(--color-gray-900)]">{tool.name}</p>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide",
                    tool.enabled
                      ? "bg-[var(--color-success-50)] text-[var(--color-success-600)]"
                      : tool.readiness === "needs_config"
                        ? "bg-[var(--color-warning-50)] text-[var(--color-warning-600)]"
                        : "bg-[var(--color-bg-muted)] text-[var(--color-gray-600)]"
                  )}
                >
                  {readinessCopy(tool)}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--color-gray-500)]">{tool.description}</p>
            </div>

            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--color-gray-500)]" aria-label="Salvando" />
            ) : (
              <div className="flex shrink-0 items-center gap-2">
              {configurableKey && <button type="button" onClick={() => setConfiguringKey((current) => current === configurableKey ? null : configurableKey)} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--border-input)] px-3 text-xs font-semibold text-[var(--color-gray-700)] transition-all hover:-translate-y-0.5 hover:shadow-md"><Settings2 className="h-3.5 w-3.5" />Configurar</button>}
              <Switch
                checked={tool.enabled}
                disabled={!canEnable && !tool.enabled}
                onCheckedChange={(checked) => toggleTool(tool, checked)}
                aria-label={`${tool.enabled ? "Desativar" : "Ativar"} ${tool.name}`}
              />
              </div>
            )}
          </div>
          {tool.key === "rb_billing" && configuringKey === tool.key ? (
            <RbBillingConfigPanel
              agentId={agentId}
              onClose={() => setConfiguringKey(null)}
              onChanged={() => setReloadKey((value) => value + 1)}
            />
          ) : null}
          {(tool.key === "prescription_analyst" || tool.key === "visagism") && configuringKey === tool.key ? (
            <OpticsToolConfigPanel
              agentId={agentId}
              toolKey={tool.key}
              onClose={() => setConfiguringKey(null)}
              onChanged={() => setReloadKey((value) => value + 1)}
            />
          ) : null}
          </div>
        );
      })}
    </div>
  );
}
