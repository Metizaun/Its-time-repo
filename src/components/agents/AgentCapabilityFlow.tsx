import { useEffect, useId, useMemo, useState } from "react";
import {
  AudioLines,
  CalendarDays,
  ChevronRight,
  Files,
  GitFork,
  Glasses,
  Loader2,
  Plus,
  Power,
  Trash2,
  WalletCards,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { AIAgent } from "@/types";
import { AgentTool, listAgentTools } from "@/services/agentToolsService";

const TOOL_ICONS: Partial<Record<AgentTool["key"], LucideIcon>> = {
  ai_audio: AudioLines,
  calendar: CalendarDays,
  forwarding: GitFork,
  send_media: Files,
  rb_billing: WalletCards,
  visagism: Glasses,
};

type AgentCapabilityFlowProps = {
  primary: AIAgent;
  subagents: AIAgent[];
  onEditAgent?: (agent: AIAgent) => void;
  onConfigureTool?: (agent: AIAgent, tool: AgentTool) => void;
  onManageTools?: (agent: AIAgent) => void;
  onToggleAgent?: (agent: AIAgent) => void;
  onDeleteAgent?: (agent: AIAgent) => void;
  statusAgentId?: string | null;
  deletingAgentId?: string | null;
  compact?: boolean;
  toolsRevision?: number;
};

function gradientId(prefix: string, id: string) {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

function GradientIcon({ Icon, className }: { Icon: LucideIcon; className?: string }) {
  const id = gradientId("cq-icon-gradient", useId());

  return (
    <Icon className={className} stroke={`url(#${id})`} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--cq-flow-gradient-start)" />
          <stop offset="52%" stopColor="var(--cq-flow-gradient-middle)" />
          <stop offset="100%" stopColor="var(--cq-flow-gradient-end)" />
        </linearGradient>
      </defs>
    </Icon>
  );
}

export function AgentBotIcon({ className }: { className?: string }) {
  const id = gradientId("cq-agent-gradient", useId());

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke={`url(#${id})`}
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--cq-flow-gradient-start)" />
          <stop offset="52%" stopColor="var(--cq-flow-gradient-middle)" />
          <stop offset="100%" stopColor="var(--cq-flow-gradient-end)" />
        </linearGradient>
      </defs>
      <path d="M12 7V4H8.5" />
      <rect x="5" y="7" width="14" height="12" rx="3" />
      <path d="M5 11H3.5v4H5M19 11h1.5v4H19" />
      <path d="M9 11.5v3M15 11.5v3" />
    </svg>
  );
}

function SpecializedToolIcon({
  kind,
  className,
}: {
  kind: "calendar" | "audio" | "forwarding" | "visagism";
  className?: string;
}) {
  const id = gradientId(`cq-${kind}-gradient`, useId());

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke={`url(#${id})`}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--cq-flow-gradient-start)" />
          <stop offset="52%" stopColor="var(--cq-flow-gradient-middle)" />
          <stop offset="100%" stopColor="var(--cq-flow-gradient-end)" />
        </linearGradient>
      </defs>

      {kind === "calendar" ? (
        <>
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M8 3v4M16 3v4M3 10h18" />
          <path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01M16 17.5h.01" strokeWidth="2.5" />
        </>
      ) : null}

      {kind === "audio" ? (
        <>
          <path d="M4 10v4M7.2 7.5v9M10.4 4.5v15M13.6 6v12M16.8 8v8M20 10v4" />
        </>
      ) : null}

      {kind === "forwarding" ? (
        <>
          <circle cx="5.5" cy="12" r="2.75" />
          <path d="M8.25 12h2.5c3 0 3-4 6-4H21" />
          <path d="m18.5 5.5 2.5 2.5-2.5 2.5" />
          <path d="M10.75 12c3 0 3 4 6 4H21" />
          <path d="m18.5 13.5 2.5 2.5-2.5 2.5" />
        </>
      ) : null}

      {kind === "visagism" ? (
        <>
          <circle cx="7.5" cy="12" r="4" />
          <circle cx="16.5" cy="12" r="4" />
          <path d="M11.5 12h1M3.5 10.5 2 9.75M20.5 10.5 22 9.75" />
        </>
      ) : null}
    </svg>
  );
}

function PrescriptionIcon({ className }: { className?: string }) {
  const id = gradientId("cq-prescription-gradient", useId());

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      stroke={`url(#${id})`}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--cq-flow-gradient-start)" />
          <stop offset="52%" stopColor="var(--cq-flow-gradient-middle)" />
          <stop offset="100%" stopColor="var(--cq-flow-gradient-end)" />
        </linearGradient>
      </defs>
      <path d="M7 2.75h7l4 4V21.25H7a2 2 0 0 1-2-2V4.75a2 2 0 0 1 2-2Z" />
      <path d="M14 2.75v4h4" />
      <path d="M8.5 11v6" />
      <path d="M8.5 11h2a1.75 1.75 0 0 1 0 3.5h-2" />
      <path d="m11 14.5 2.25 2.5" />
      <path d="m14.25 12.5 3 4.5" />
      <path d="m17.25 12.5-3 4.5" />
    </svg>
  );
}

export function ToolGlyph({ tool, className }: { tool: Pick<AgentTool, "key">; className?: string }) {
  if (tool.key === "prescription_analyst") {
    return <PrescriptionIcon className={className} />;
  }

  if (tool.key === "ai_audio") return <SpecializedToolIcon kind="audio" className={className} />;
  if (tool.key === "calendar") return <SpecializedToolIcon kind="calendar" className={className} />;
  if (tool.key === "forwarding") return <SpecializedToolIcon kind="forwarding" className={className} />;
  if (tool.key === "visagism") return <SpecializedToolIcon kind="visagism" className={className} />;

  return <GradientIcon Icon={TOOL_ICONS[tool.key] ?? Wrench} className={className} />;
}

function PrimaryAgentCard({
  agent,
  compact,
  tools,
  onEdit,
  onConfigureTool,
  onManageTools,
  onToggle,
  onDelete,
  statusPending,
  deletePending,
}: {
  agent: AIAgent;
  compact: boolean;
  tools?: AgentTool[];
  onEdit?: () => void;
  onConfigureTool?: (tool: AgentTool) => void;
  onManageTools?: () => void;
  onToggle?: () => void;
  onDelete?: () => void;
  statusPending?: boolean;
  deletePending?: boolean;
}) {
  const status = agent.is_active ? "Ativo" : "Pausado";
  const hasEmbeddedTools = tools !== undefined;

  const agentContent = (
    <>
      <span className="cq-agent-icon">
        <AgentBotIcon className="cq-agent-icon__glyph" />
      </span>

      <span className="cq-agent-copy">
        <strong title={agent.name}>{agent.name}</strong>
        <span title={agent.instance_name ?? undefined}>{agent.instance_name}</span>
      </span>
    </>
  );

  return (
    <section
      className={cn(
        "cq-agent-card cq-agent-card--interactive",
        hasEmbeddedTools && "cq-agent-card--with-tools",
        compact ? "cq-agent-card--compact" : "cq-agent-card--expanded",
      )}
      aria-label={`Agente ${agent.name}`}
    >
      <div className="cq-agent-card__header">
        <button
          type="button"
          onClick={onEdit}
          className="cq-agent-card__main group"
          aria-label={`Configurar agente ${agent.name}. Status: ${status}`}
        >
          {agentContent}
        </button>

        <div className="cq-agent-card__actions" role="group" aria-label={`Ações de ${agent.name}`}>
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              disabled={statusPending || deletePending}
              className={cn("cq-agent-card__control", agent.is_active && "cq-agent-card__control--active")}
              aria-label={agent.is_active ? `Desligar agente ${agent.name}` : `Ligar agente ${agent.name}`}
              title={agent.is_active ? "Desligar agente" : "Ligar agente"}
            >
              {statusPending ? <Loader2 className="cq-agent-card__spinner" aria-hidden="true" /> : <Power aria-hidden="true" />}
            </button>
          ) : null}

          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={deletePending || statusPending}
              className="cq-agent-card__control cq-agent-card__control--delete"
              aria-label={`Apagar agente ${agent.name}`}
              title="Apagar agente"
            >
              {deletePending ? <Loader2 className="cq-agent-card__spinner" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
            </button>
          ) : null}
        </div>
      </div>

      {hasEmbeddedTools ? (
        <div className="cq-agent-card__tools" role="group" aria-label={`Ferramentas de ${agent.name}`}>
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={onConfigureTool ? () => onConfigureTool(tool) : undefined}
              disabled={!onConfigureTool}
              className={cn(
                "cq-agent-tool-icon",
                tool.key === "calendar" && "cq-agent-tool-icon--calendar",
              )}
              aria-label={`Configurar ferramenta ${tool.name}`}
              title={tool.name}
            >
              <ToolGlyph tool={tool} className="cq-agent-tool-icon__glyph" />
            </button>
          ))}

          <button
            type="button"
            onClick={onManageTools}
            disabled={!onManageTools}
            className="cq-agent-tool-icon cq-agent-tool-icon--add"
            aria-label={`Adicionar ou gerenciar ferramentas de ${agent.name}`}
            title="Adicionar ou gerenciar ferramentas"
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ToolCard({
  tool,
  compact,
  connected,
  onClick,
}: {
  tool: AgentTool;
  compact: boolean;
  connected: boolean;
  onClick?: () => void;
}) {
  const status = tool.enabled ? "ativa" : "inativa";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("cq-tool-card", compact ? "cq-tool-card--compact" : "cq-tool-card--expanded")}
      data-connected={connected ? "true" : "false"}
      aria-label={`${tool.name}: ${status}`}
    >
      <span className="cq-tool-icon">
        <ToolGlyph tool={tool} className="cq-tool-icon__glyph" />
      </span>
      <strong title={tool.name}>{tool.name}</strong>
      <span className={cn("cq-tool-status", !tool.enabled && "cq-tool-status--inactive")} aria-hidden="true" />
    </button>
  );
}

function ToolBranch({
  owner,
  tools,
  compact,
  label = "Ferramentas",
  onConfigureTool,
  onManageTools,
}: {
  owner: AIAgent;
  tools: AgentTool[];
  compact: boolean;
  label?: string;
  onConfigureTool?: (agent: AIAgent, tool: AgentTool) => void;
  onManageTools?: (agent: AIAgent) => void;
}) {
  const firstRowCount = Math.min(tools.length, compact ? 2 : 3);

  return (
    <section className={cn("cq-tool-branch", compact && "cq-tool-branch--compact")} aria-label={`${label} de ${owner.name}`}>
      <div className="cq-tool-branch__head">
        <span>{label}</span>
        <button
          type="button"
          onClick={onManageTools ? () => onManageTools(owner) : undefined}
          disabled={!onManageTools}
          className="cq-add-tool"
          aria-label={`Adicionar ferramenta ao agente ${owner.name}`}
          title="Adicionar ferramenta"
        >
          <Plus aria-hidden="true" />
        </button>
      </div>

      {tools.length > 0 ? (
        <div
          className={cn("cq-tool-grid", compact ? "cq-tool-grid--compact" : "cq-tool-grid--expanded")}
          data-first-row-count={firstRowCount}
        >
          {tools.map((tool, index) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              compact={compact}
              connected={index < firstRowCount}
              onClick={onConfigureTool ? () => onConfigureTool(owner, tool) : undefined}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SubagentCard({ agent, onEdit }: { agent: AIAgent; onEdit?: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="cq-subagent-card group"
      aria-label={`Configurar subagente ${agent.name}`}
    >
      <span className="cq-subagent-icon">
        <AgentBotIcon className="cq-subagent-icon__glyph" />
      </span>
      <span className="cq-subagent-copy">
        <strong title={agent.name}>{agent.name}</strong>
        <span title={agent.routing_instruction ?? undefined}>
          {agent.routing_instruction || "Atendimento especializado"}
        </span>
      </span>
      <ChevronRight className="cq-subagent-chevron" aria-hidden="true" />
    </button>
  );
}

export function AgentCapabilityFlow({
  primary,
  subagents,
  onEditAgent,
  onConfigureTool,
  onManageTools,
  onToggleAgent,
  onDeleteAgent,
  statusAgentId = null,
  deletingAgentId = null,
  compact = false,
  toolsRevision = 0,
}: AgentCapabilityFlowProps) {
  const visibleSubagents = useMemo(() => subagents.slice(0, 2), [subagents]);
  const allAgents = useMemo(() => [primary, ...visibleSubagents], [primary, visibleSubagents]);
  const [toolsByAgent, setToolsByAgent] = useState<Record<string, AgentTool[]>>({});

  useEffect(() => {
    let active = true;

    Promise.all(allAgents.map(async (agent) => [agent.id, await listAgentTools(agent.id)] as const))
      .then((entries) => {
        if (active) setToolsByAgent(Object.fromEntries(entries));
      })
      .catch(() => {
        if (active) setToolsByAgent({});
      });

    return () => {
      active = false;
    };
  }, [allAgents, toolsRevision]);

  const primaryTools = (toolsByAgent[primary.id] ?? []).filter((tool) => tool.enabled);
  const subagentItemCount = visibleSubagents.length;
  const embedPrimaryTools = subagentItemCount > 0;

  return (
    <article
      className={cn(
        "cq-capability-flow",
        compact ? "cq-capability-flow--compact" : "cq-capability-flow--expanded",
      )}
    >
      <PrimaryAgentCard
        agent={primary}
        compact={compact}
        tools={embedPrimaryTools ? primaryTools : undefined}
        onEdit={onEditAgent ? () => onEditAgent(primary) : undefined}
        onConfigureTool={onConfigureTool ? (tool) => onConfigureTool(primary, tool) : undefined}
        onManageTools={onManageTools ? () => onManageTools(primary) : undefined}
        onToggle={onToggleAgent ? () => onToggleAgent(primary) : undefined}
        onDelete={onDeleteAgent ? () => onDeleteAgent(primary) : undefined}
        statusPending={statusAgentId === primary.id}
        deletePending={deletingAgentId === primary.id}
      />

      {!embedPrimaryTools ? (
        <ToolBranch
          owner={primary}
          tools={primaryTools}
          compact={compact}
          onConfigureTool={onConfigureTool}
          onManageTools={onManageTools}
        />
      ) : null}

      {subagentItemCount > 0 ? (
        <section
          className={cn("cq-subagent-section", subagentItemCount === 1 && "cq-subagent-section--single")}
          aria-label={`Subagentes de ${primary.name}`}
        >
          <div className="cq-subagent-grid">
            {visibleSubagents.map((subagent) => {
              const tools = (toolsByAgent[subagent.id] ?? []).filter((tool) => tool.enabled);

              return (
                <div key={subagent.id} className="cq-subagent-column">
                  <SubagentCard
                    agent={subagent}
                    onEdit={onEditAgent ? () => onEditAgent(subagent) : undefined}
                  />
                  <ToolBranch
                    owner={subagent}
                    tools={tools}
                    compact
                    onConfigureTool={onConfigureTool}
                    onManageTools={onManageTools}
                  />
                </div>
              );
            })}

          </div>
        </section>
      ) : null}
    </article>
  );
}
