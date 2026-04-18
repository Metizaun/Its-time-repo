import { useState } from "react";
import { Bot, Plus, Edit2, Power, PowerOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgents } from "@/hooks/useAgents";
import { AIAgent } from "@/types";
import { AgentConfigModal } from "@/components/modals/AgentConfigModal";

export default function Agentes() {
  const { agents, loading, toggleAgentStatus } = useAgents();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AIAgent | null>(null);

  function openCreate() {
    setEditingAgent(null);
    setModalOpen(true);
  }

  function openEdit(agent: AIAgent) {
    setEditingAgent(agent);
    setModalOpen(true);
  }

  function handleClose() {
    setModalOpen(false);
    setEditingAgent(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[var(--color-accent)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Agentes de IA</h1>
          <p className="text-[var(--color-text-secondary)] mt-1 text-sm">
            Configure seus agentes para prospectar, atender e vender automaticamente.
          </p>
        </div>
        {agents.length > 0 && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--color-accent)] hover:brightness-110 text-white text-sm font-semibold rounded-xl transition-all duration-200"
          >
            <Plus className="w-4 h-4" />
            Novo Agente
          </button>
        )}
      </div>

      {/* Empty State */}
      {agents.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-6">
          <div className="w-20 h-20 rounded-full bg-transparent border border-t-2 border-t-[var(--color-accent)] border-[var(--color-border-subtle)] flex items-center justify-center shadow-[0_8px_32px_rgba(229,57,58,0.08)]">
            <Bot className="w-9 h-9 text-[var(--color-text-secondary)]" />
          </div>
          <div className="text-center space-y-1">
            <h2 className="text-xl font-semibold text-foreground">Nenhum agente configurado</h2>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-xs">
              Crie seu primeiro agente de IA e deixe ele trabalhar por você.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-6 py-3 bg-[var(--color-accent)] hover:brightness-110 text-white font-semibold rounded-xl transition-all duration-200 shadow-[0_4px_24px_rgba(229,57,58,0.25)]"
          >
            <Plus className="w-4 h-4" />
            Criar Agente
          </button>
        </div>
      )}

      {/* Agent Cards */}
      {agents.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className={cn(
                "relative p-5 rounded-[24px] border border-[var(--color-border-subtle)] border-t-2 bg-transparent",
                "shadow-[0_8px_32px_rgba(229,57,58,0.04)] transition-all duration-200 hover:shadow-[0_8px_32px_rgba(229,57,58,0.08)]",
                agent.is_active ? "border-t-[var(--color-accent)]" : "border-t-[var(--color-border-medium)]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Instance badge */}
                  <span className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-widest font-semibold">
                    {agent.instance_name}
                  </span>
                  {/* Agent name */}
                  <h3 className="text-base font-bold text-foreground mt-0.5 truncate">{agent.name}</h3>
                  {/* Model tag */}
                  <span className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]">
                    {agent.model}
                  </span>
                </div>

                {/* Status indicator */}
                <div
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-full border flex-shrink-0 transition-colors duration-200",
                    agent.is_active
                      ? "bg-[var(--color-success)]/10 border-[var(--color-success)]/30"
                      : "bg-[var(--color-border-subtle)] border-[var(--color-border-medium)]"
                  )}
                >
                  {agent.is_active ? (
                    <Power className="w-4 h-4 text-[var(--color-success)]" />
                  ) : (
                    <PowerOff className="w-4 h-4 text-[var(--color-text-secondary)]" />
                  )}
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--color-border-subtle)]">
                <span
                  className={cn(
                    "text-xs font-medium",
                    agent.is_active ? "text-[var(--color-success)]" : "text-[var(--color-text-secondary)]"
                  )}
                >
                  {agent.is_active ? "Ativo" : "Pausado"}
                </span>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleAgentStatus(agent.id, !agent.is_active)}
                    className="text-[10px] uppercase tracking-wider font-semibold text-[var(--color-text-secondary)] hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-[var(--color-border-subtle)]"
                  >
                    {agent.is_active ? "Pausar" : "Ativar"}
                  </button>
                  <button
                    onClick={() => openEdit(agent)}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-[var(--color-text-secondary)] hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-[var(--color-border-subtle)]"
                  >
                    <Edit2 className="w-3 h-3" />
                    Editar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      <AgentConfigModal
        open={modalOpen}
        agent={editingAgent}
        onClose={handleClose}
      />
    </div>
  );
}
