import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Filter, Plus, Workflow } from "lucide-react";

import { AutomationBoard } from "@/components/automation/AutomationBoard";
import { AutomationMessageModal } from "@/components/modals/AutomationMessageModal";
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
import { useAuth } from "@/contexts/AuthContext";
import { useAutomationCatalog } from "@/hooks/useAutomationCatalog";
import { useAutomationExecutions } from "@/hooks/useAutomationExecutions";
import { useAutomationJourneys } from "@/hooks/useAutomationJourneys";
import { useAutomationPreview } from "@/hooks/useAutomationPreview";
import { useInstances } from "@/hooks/useInstances";
import { useLeads } from "@/hooks/useLeads";
import { usePipelineStages } from "@/hooks/usePipelineStages";

export default function Automacao() {
  const { userRole } = useAuth();
  const automationEnabled = userRole === "ADMIN";
  const showAutomationDebug = import.meta.env.DEV || import.meta.env.VITE_SHOW_AUTOMATION_DEBUG === "true";
  const { stages, loading: loadingStages } = usePipelineStages();
  const { instances, loading: loadingInstances } = useInstances();
  const { owners, tags, leadSources, loading: loadingCatalog } = useAutomationCatalog(automationEnabled);
  const {
    journeys,
    stepsByJourney,
    stepCounts,
    loadingJourneys,
    createJourney,
    updateJourney,
    deleteJourney,
    createStep,
    updateStep,
    deleteStep,
  } = useAutomationJourneys(automationEnabled);

  const [instanceFilter, setInstanceFilter] = useState<string>("all");
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);
  const [pendingStageId, setPendingStageId] = useState<string | null>(null);
  const [automationModalOpen, setAutomationModalOpen] = useState(false);

  const selectedInstanceName = instanceFilter === "all" ? null : instanceFilter;

  const filteredJourneys = useMemo(() => {
    if (instanceFilter === "all") {
      return journeys;
    }

    return journeys.filter((journey) => journey.instance_name === instanceFilter);
  }, [instanceFilter, journeys]);

  const selectedJourney = useMemo(
    () => journeys.find((journey) => journey.id === selectedJourneyId) || null,
    [journeys, selectedJourneyId],
  );

  const selectedSteps = useMemo(() => {
    if (!selectedJourneyId) {
      return [];
    }

    return stepsByJourney[selectedJourneyId] || [];
  }, [selectedJourneyId, stepsByJourney]);

  const activeJourneysCount = useMemo(
    () => filteredJourneys.filter((journey) => journey.is_active).length,
    [filteredJourneys],
  );

  const totalMessagesCount = useMemo(
    () => filteredJourneys.reduce((total, journey) => total + (stepCounts[journey.id] || 0), 0),
    [filteredJourneys, stepCounts],
  );

  const { executions, loading: executionsLoading } = useAutomationExecutions(
    selectedJourneyId,
    automationModalOpen && showAutomationDebug,
  );
  const { leads: previewLeads } = useLeads({ enabled: automationModalOpen && showAutomationDebug });
  const { preview, previewResult, loading: previewLoading, reset: resetPreview } = useAutomationPreview();

  useEffect(() => {
    resetPreview();
  }, [resetPreview, selectedJourneyId]);

  if (userRole !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  const handleCreateAutomation = (stageId: string | null) => {
    setSelectedJourneyId(null);
    setPendingStageId(stageId);
    setAutomationModalOpen(true);
  };

  const handleEditAutomation = (journeyId: string) => {
    setSelectedJourneyId(journeyId);
    setPendingStageId(null);
    setAutomationModalOpen(true);
  };

  const isLoading = loadingStages || loadingInstances || loadingJourneys || loadingCatalog;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-foreground sm:text-3xl">
            <Workflow className="h-8 w-8" />
            Automacao
          </h1>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleCreateAutomation(null)}
            className="flex items-center gap-2 rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(229,57,58,0.25)] transition-all duration-200 hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            Nova automacao
          </button>
        </div>
      </div>

      <Card className="rounded-[24px] border border-[var(--color-border-subtle)] border-t-2 border-t-[var(--color-accent)] bg-transparent p-5 shadow-[0_8px_32px_rgba(229,57,58,0.04)] sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-medium)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
              <Filter className="h-4 w-4" />
              Filtro de instancia
            </div>

            <div className="w-full sm:w-[260px]">
              <Select value={instanceFilter} onValueChange={setInstanceFilter}>
                <SelectTrigger className="rounded-xl border-[var(--color-border-medium)] bg-[var(--color-bg-surface)] text-foreground">
                  <SelectValue placeholder="Filtrar por instancia" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)]">
                  <SelectItem value="all" className="text-foreground focus:bg-[var(--color-border-subtle)] focus:text-foreground">
                    Todas as instancias
                  </SelectItem>
                  {instances.map((instance) => (
                    <SelectItem
                      key={instance.instancia}
                      value={instance.instancia}
                      className="text-foreground focus:bg-[var(--color-border-subtle)] focus:text-foreground"
                    >
                      {instance.instancia}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-full border-[var(--color-border-medium)] bg-[var(--color-border-subtle)] px-3 text-foreground">
              {filteredJourneys.length} automacoes
            </Badge>
            <Badge
              variant="outline"
              className="rounded-full border-[var(--color-border-medium)] bg-[var(--color-success)]/10 px-3 text-[var(--color-success)]"
            >
              {activeJourneysCount} ativas
            </Badge>
            <Badge
              variant="outline"
              className="rounded-full border-[var(--color-border-medium)] bg-[var(--color-accent)]/10 px-3 text-[var(--color-accent)]"
            >
              {totalMessagesCount} mensagens
            </Badge>
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
        <Card className="rounded-[24px] border border-dashed border-[var(--color-border-subtle)] border-t-2 border-t-[var(--color-accent)] bg-transparent p-8 text-center text-sm text-[var(--color-text-secondary)] shadow-[0_8px_32px_rgba(229,57,58,0.04)] sm:p-10">
          Nenhuma etapa do pipeline foi cadastrada ainda. Crie as etapas no CRM antes de montar o Kanban de automacao.
        </Card>
      ) : (
        <AutomationBoard
          stages={stages}
          journeys={filteredJourneys}
          stepsByJourney={stepsByJourney}
          onCreate={handleCreateAutomation}
          onEdit={handleEditAutomation}
        />
      )}

      <AutomationMessageModal
        open={automationModalOpen}
        onOpenChange={setAutomationModalOpen}
        journey={selectedJourney}
        steps={selectedSteps}
        stages={stages}
        instances={instances}
        owners={owners}
        tags={tags}
        leadSources={leadSources}
        previewLeads={previewLeads}
        executions={executions}
        executionsLoading={executionsLoading}
        previewResult={previewResult}
        previewLoading={previewLoading}
        onRunPreview={(leadId) => preview({ funnelId: selectedJourneyId as string, leadId })}
        preselectedStageId={pendingStageId}
        preselectedInstanceName={selectedInstanceName}
        onSelectJourney={setSelectedJourneyId}
        createJourney={createJourney}
        updateJourney={updateJourney}
        deleteJourney={deleteJourney}
        createStep={createStep}
        updateStep={updateStep}
        deleteStep={deleteStep}
        showDebugTools={showAutomationDebug}
      />
    </div>
  );
}
