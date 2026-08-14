import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { AgentCapabilityFlow } from "@/components/agents/AgentCapabilityFlow";
import { AgentCreationDialog } from "@/components/agents/AgentCreationDialog";
import { AgentToolConfigurationDialog } from "@/components/agents/AgentToolConfigurationDialog";
import { AgentToolsDialog } from "@/components/agents/AgentToolsDialog";
import { AgentConfigModal } from "@/components/modals/AgentConfigModal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAgents } from "@/hooks/useAgents";
import { AIAgent } from "@/types";
import type { AgentTemplate, AgentTool } from "@/services/agentToolsService";

type ModalMode = { type: "primary" | "subagent"; parentId: string | null };

export default function Agentes() {
  const {
    agents,
    loading,
    saving,
    statusAgentId,
    deletingAgentId,
    refetch,
    upsertAgent,
    toggleAgentStatus,
    deleteAgent,
  } = useAgents();
  const [modalOpen, setModalOpen] = useState(false);
  const [creationPickerOpen, setCreationPickerOpen] = useState(false);
  const [creationTemplate, setCreationTemplate] = useState<AgentTemplate | null>(null);
  const [editingAgent, setEditingAgent] = useState<AIAgent | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>({ type: "primary", parentId: null });
  const [toolsDialogAgent, setToolsDialogAgent] = useState<AIAgent | null>(null);
  const [toolConfigDialog, setToolConfigDialog] = useState<{ agent: AIAgent; toolKey: AgentTool["key"] } | null>(null);
  const [toolsRevision, setToolsRevision] = useState(0);
  const [agentToDelete, setAgentToDelete] = useState<AIAgent | null>(null);

  const primaryAgents = useMemo(
    () => agents.filter((agent) => agent.agent_type === "primary"),
    [agents]
  );

  function openCreatePrimary() {
    setEditingAgent(null);
    setCreationTemplate(null);
    setModalMode({ type: "primary", parentId: null });
    setCreationPickerOpen(true);
  }

  function selectCreationMode(template: AgentTemplate | null) {
    setCreationTemplate(template);
    setCreationPickerOpen(false);
    setModalMode({ type: "primary", parentId: null });
    setModalOpen(true);
  }

  function openCreateSubagent(parent: AIAgent) {
    setEditingAgent(null);
    setCreationTemplate(null);
    setModalMode({ type: "subagent", parentId: parent.id });
    setModalOpen(true);
  }

  function openEdit(agent: AIAgent) {
    setEditingAgent(agent);
    setCreationTemplate(null);
    setModalMode({ type: agent.agent_type, parentId: agent.parent_agent_id });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingAgent(null);
    setCreationTemplate(null);
  }

  async function handleAgentSaved() {
    await refetch();
    closeModal();
  }

  async function confirmDeleteAgent() {
    if (!agentToDelete) return;

    try {
      await deleteAgent(agentToDelete.id, agentToDelete.name);
      setAgentToDelete(null);
    } catch {
      // O hook ja exibe o erro e restaura a lista.
    }
  }

  if (loading) {
    return <div className="flex min-h-64 items-center justify-center text-sm text-[var(--color-text-secondary)]">Carregando agentes...</div>;
  }

  return (
    <div className="agents-page space-y-7">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)] sm:text-4xl">Agentes de IA</h1>
          <p className="mt-2 text-sm font-medium text-[var(--color-text-secondary)] sm:text-base">
            Configure seus agentes para prospectar, atender e vender automaticamente.
          </p>
        </div>
        <Button type="button" onClick={openCreatePrimary} className="gap-2 self-start sm:self-auto">
          <Plus className="h-4 w-4" /> Novo agente
        </Button>
      </header>

      {primaryAgents.length === 0 ? (
        <section className="cq-flow-canvas flex min-h-[28rem] flex-col items-center justify-center text-center">
          <h2 className="text-xl font-bold text-[var(--color-text-primary)]">Crie seu primeiro agente</h2>
          <p className="mt-2 max-w-md text-sm text-[var(--color-text-secondary)]">Depois de conectar o canal, você poderá adicionar subagentes especializados e ferramentas próprias.</p>
          <Button type="button" onClick={openCreatePrimary} className="mt-6 gap-2"><Plus className="h-4 w-4" /> Criar agente</Button>
        </section>
      ) : (
        <div className="cq-agent-overview-grid">
          {primaryAgents.map((primary) => (
            <AgentCapabilityFlow
              key={primary.id}
              primary={primary}
              subagents={agents.filter((agent) => agent.agent_type === "subagent" && agent.parent_agent_id === primary.id)}
              onEditAgent={openEdit}
              onConfigureTool={(agent, tool) => setToolConfigDialog({ agent, toolKey: tool.key })}
              onManageTools={setToolsDialogAgent}
              onToggleAgent={(agent) => void toggleAgentStatus(agent.id, !agent.is_active)}
              onDeleteAgent={setAgentToDelete}
              statusAgentId={statusAgentId}
              deletingAgentId={deletingAgentId}
              toolsRevision={toolsRevision}
              compact
            />
          ))}
        </div>
      )}

      <AgentCreationDialog
        open={creationPickerOpen}
        onOpenChange={setCreationPickerOpen}
        onSelect={selectCreationMode}
      />

      <AgentConfigModal
        open={modalOpen}
        agent={editingAgent}
        agents={agents}
        saving={saving}
        upsertAgent={upsertAgent}
        agentType={modalMode.type}
        parentAgentId={modalMode.parentId}
        templateKey={!editingAgent && modalMode.type === "primary" ? creationTemplate?.key ?? null : null}
        templateName={!editingAgent && modalMode.type === "primary" ? creationTemplate?.name ?? null : null}
        onClose={closeModal}
        onSaved={handleAgentSaved}
      />

      <AgentToolsDialog
        open={Boolean(toolsDialogAgent)}
        onOpenChange={(open) => {
          if (!open) {
            setToolsDialogAgent(null);
            setToolsRevision((value) => value + 1);
          }
        }}
        agentId={toolsDialogAgent?.id ?? ""}
        onConfigure={(toolKey) => {
          if (!toolsDialogAgent) return;
          const agent = toolsDialogAgent;
          setToolsDialogAgent(null);
          setToolConfigDialog({ agent, toolKey });
        }}
        onCreateSubagent={
          toolsDialogAgent?.agent_type === "primary"
          && agents.filter((agent) => agent.agent_type === "subagent" && agent.parent_agent_id === toolsDialogAgent.id).length < 2
            ? () => {
                const parent = toolsDialogAgent;
                setToolsDialogAgent(null);
                openCreateSubagent(parent);
              }
            : undefined
        }
      />

      <AgentToolConfigurationDialog
        open={Boolean(toolConfigDialog)}
        onOpenChange={(open) => {
          if (!open) {
            setToolConfigDialog(null);
            setToolsRevision((value) => value + 1);
          }
        }}
        agentId={toolConfigDialog?.agent.id ?? ""}
        toolKey={toolConfigDialog?.toolKey ?? null}
      />

      <AlertDialog
        open={Boolean(agentToDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingAgentId) setAgentToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar agente?</AlertDialogTitle>
            <AlertDialogDescription>
              O agente <strong>{agentToDelete?.name}</strong> será removido permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingAgentId)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDeleteAgent()}
              disabled={Boolean(deletingAgentId)}
              className="gap-2 bg-[var(--color-error-500)] text-white hover:bg-[var(--color-error-600)]"
            >
              {deletingAgentId ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
