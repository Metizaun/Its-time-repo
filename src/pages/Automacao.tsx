import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Filter, Plus, Workflow } from "lucide-react";

import { AutomationBoard } from "@/components/automation/AutomationBoard";
import { AutomationMessageModal } from "@/components/modals/AutomationMessageModal";
import { useAuth } from "@/contexts/AuthContext";
import { useAutomation } from "@/hooks/useAutomation";
import { useInstances } from "@/hooks/useInstances";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export default function Automacao() {
  const { userRole } = useAuth();
  const automationEnabled = userRole === "ADMIN";
  const { stages, loading: loadingStages } = usePipelineStages();
  const { instances, loading: loadingInstances } = useInstances();
  const {
    funnels,
    stepsByFunnel,
    stepCounts,
    loadingFunnels,
    createFunnel,
    updateFunnel,
    deleteFunnel,
    createStep,
    updateStep,
    deleteStep,
  } = useAutomation(automationEnabled);

  const [instanceFilter, setInstanceFilter] = useState<string>("all");
  const [selectedFunnelId, setSelectedFunnelId] = useState<string | null>(null);
  const [pendingStageId, setPendingStageId] = useState<string | null>(null);
  const [automationModalOpen, setAutomationModalOpen] = useState(false);

  const selectedInstanceName = instanceFilter === "all" ? null : instanceFilter;

  const filteredFunnels = useMemo(() => {
    if (instanceFilter === "all") {
      return funnels;
    }

    return funnels.filter((funnel) => funnel.instance_name === instanceFilter);
  }, [funnels, instanceFilter]);

  const selectedFunnel = useMemo(
    () => funnels.find((funnel) => funnel.id === selectedFunnelId) || null,
    [funnels, selectedFunnelId]
  );

  const selectedSteps = useMemo(() => {
    if (!selectedFunnelId) {
      return [];
    }

    return stepsByFunnel[selectedFunnelId] || [];
  }, [selectedFunnelId, stepsByFunnel]);

  const activeFunnelsCount = useMemo(
    () => filteredFunnels.filter((funnel) => funnel.is_active).length,
    [filteredFunnels]
  );

  const totalMessagesCount = useMemo(
    () => filteredFunnels.reduce((total, funnel) => total + (stepCounts[funnel.id] || 0), 0),
    [filteredFunnels, stepCounts]
  );

  if (userRole !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  const handleCreateAutomation = (stageId: string | null) => {
    setSelectedFunnelId(null);
    setPendingStageId(stageId);
    setAutomationModalOpen(true);
  };

  const handleEditAutomation = (funnelId: string) => {
    setSelectedFunnelId(funnelId);
    setPendingStageId(null);
    setAutomationModalOpen(true);
  };

  const isLoading = loadingStages || loadingFunnels || loadingInstances;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3 text-white">
            <Workflow className="w-8 h-8" />
            Automação
          </h1>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleCreateAutomation(null)}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--color-accent)] hover:brightness-110 text-white text-sm font-semibold rounded-xl transition-all duration-200 shadow-[0_4px_16px_rgba(229,57,58,0.25)]"
          >
            <Plus className="w-4 h-4" />
            Nova automação
          </button>
        </div>
      </div>

      <Card className="p-5 sm:p-6 bg-transparent rounded-[24px] border border-white/5 border-t-2 border-t-[var(--color-accent)] shadow-[0_8px_32px_rgba(229,57,58,0.04)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-sm text-[var(--color-text-secondary)]">
              <Filter className="w-4 h-4" />
              Filtro de instância
            </div>

            <div className="w-full sm:w-[260px]">
              <Select value={instanceFilter} onValueChange={setInstanceFilter}>
                <SelectTrigger className="bg-[#0d0d0d] border-white/10 text-white rounded-xl">
                  <SelectValue placeholder="Filtrar por instância" />
                </SelectTrigger>
                <SelectContent className="bg-[#0d0d0d] border-white/10 rounded-xl">
                  <SelectItem value="all" className="text-white focus:bg-white/5 focus:text-white">Todas as instâncias</SelectItem>
                  {instances.map((instance) => (
                    <SelectItem key={instance.instancia} value={instance.instancia} className="text-white focus:bg-white/5 focus:text-white">
                      {instance.instancia}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-white/10 text-white bg-white/5 rounded-full px-3">{filteredFunnels.length} automações</Badge>
            <Badge variant="outline" className="border-white/10 text-white bg-[var(--color-success)]/10 text-[var(--color-success)] rounded-full px-3">{activeFunnelsCount} ativas</Badge>
            <Badge variant="outline" className="border-white/10 text-white bg-[var(--color-accent)]/10 text-[var(--color-accent)] rounded-full px-3">{totalMessagesCount} mensagens</Badge>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-[28px]" />
          <div className="flex gap-4 overflow-hidden">
            <Skeleton className="h-[520px] w-[340px] rounded-[28px]" />
            <Skeleton className="h-[520px] w-[340px] rounded-[28px]" />
            <Skeleton className="h-[520px] w-[340px] rounded-[28px]" />
          </div>
        </div>
      ) : stages.length === 0 ? (
        <Card className="p-8 sm:p-10 bg-transparent rounded-[24px] border border-white/5 border-dashed border-t-[var(--color-accent)] border-t-2 text-sm text-[var(--color-text-secondary)] text-center shadow-[0_8px_32px_rgba(229,57,58,0.04)]">
          Nenhuma etapa do pipeline foi cadastrada ainda. Crie as etapas no CRM antes de montar o Kanban de automação.
        </Card>
      ) : (
        <AutomationBoard
          stages={stages}
          funnels={filteredFunnels}
          stepsByFunnel={stepsByFunnel}
          onCreate={handleCreateAutomation}
          onEdit={handleEditAutomation}
        />
      )}

      <AutomationMessageModal
        open={automationModalOpen}
        onOpenChange={setAutomationModalOpen}
        funnel={selectedFunnel}
        steps={selectedSteps}
        stages={stages}
        instances={instances}
        preselectedStageId={pendingStageId}
        preselectedInstanceName={selectedInstanceName}
        onSelectFunnel={setSelectedFunnelId}
        createFunnel={createFunnel}
        updateFunnel={updateFunnel}
        deleteFunnel={deleteFunnel}
        createStep={createStep}
        updateStep={updateStep}
        deleteStep={deleteStep}
      />
    </div>
  );
}
