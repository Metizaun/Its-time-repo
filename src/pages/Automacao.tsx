import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Bot, Filter, Plus, Workflow } from "lucide-react";

import { AutomationBoard } from "@/components/automation/AutomationBoard";
import { EditInstanceAgentModal } from "@/components/modals/EditInstanceAgentModal";
import { AutomationMessageModal } from "@/components/modals/AutomationMessageModal";
import { useAuth } from "@/contexts/AuthContext";
import { useAutomation } from "@/hooks/useAutomation";
import { useInstances } from "@/hooks/useInstances";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  const [agentModalOpen, setAgentModalOpen] = useState(false);

  const selectedInstanceName = instanceFilter === "all" ? null : instanceFilter;
  const instanceNames = useMemo(
    () => instances.map((instance) => instance.instancia),
    [instances]
  );

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
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Workflow className="w-8 h-8" />
            Automação
          </h1>
          <p className="text-muted-foreground mt-1 max-w-3xl">
            Visualize e edite automações por etapa do pipeline em formato Kanban. Cada cartão representa
            uma automação e pode conter várias mensagens automáticas.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAgentModalOpen(true)}>
            <Bot className="w-4 h-4 mr-2" />
            Configurar IA
          </Button>
          <Button onClick={() => handleCreateAutomation(null)}>
            <Plus className="w-4 h-4 mr-2" />
            Nova automação
          </Button>
        </div>
      </div>

      <Card className="rounded-[28px] border p-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm text-muted-foreground">
              <Filter className="w-4 h-4" />
              Filtro de instância
            </div>

            <div className="w-full sm:w-[260px]">
              <Select value={instanceFilter} onValueChange={setInstanceFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filtrar por instância" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as instâncias</SelectItem>
                  {instances.map((instance) => (
                    <SelectItem key={instance.instancia} value={instance.instancia}>
                      {instance.instancia}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{filteredFunnels.length} automações</Badge>
            <Badge variant="outline">{activeFunnelsCount} ativas</Badge>
            <Badge variant="outline">{totalMessagesCount} mensagens</Badge>
          </div>
        </div>

        <div className="mt-4">
          {selectedInstanceName ? (
            <Alert>
              <AlertTitle>Instância selecionada: {selectedInstanceName}</AlertTitle>
              <AlertDescription>
                O board mostra apenas automações desta instância e o botão `Configurar IA` edita esse
                mesmo agente.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertTitle>Visualização consolidada</AlertTitle>
              <AlertDescription>
                O board mostra automações de todas as instâncias da conta. Selecione uma instância específica
                para editar a IA vinculada.
              </AlertDescription>
            </Alert>
          )}
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
        <Card className="rounded-[28px] border border-dashed p-8 text-sm text-muted-foreground">
          Nenhuma etapa do pipeline foi cadastrada ainda. Crie as etapas no CRM antes de montar o Kanban de
          automação.
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

      <EditInstanceAgentModal
        open={agentModalOpen}
        onOpenChange={setAgentModalOpen}
        instanceName={selectedInstanceName}
        instanceOptions={instanceNames}
      />
    </div>
  );
}
