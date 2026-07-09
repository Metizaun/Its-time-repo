import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Filter, Plus, Workflow, Wallet } from "lucide-react";
import { toast } from "sonner";

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
import { useAgents } from "@/hooks/useAgents";
import { useInstances } from "@/hooks/useInstances";
import { useLeads } from "@/hooks/useLeads";
import { usePipelines } from "@/hooks/usePipelines";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { listAgentTools } from "@/services/agentToolsService";
import {
  RB_BILLING_MESSAGE_BLUEPRINTS,
  RB_BILLING_STAGE_BLUEPRINTS,
  buildRbBillingJourneyPayload,
  buildRbBillingStagePayload,
  buildRbBillingStepPayload,
} from "@/lib/rbBillingBlueprint";

export default function Automacao() {
  const { userRole } = useAuth();
  const automationEnabled = userRole === "ADMIN";
  const showAutomationDebug = import.meta.env.DEV || import.meta.env.VITE_SHOW_AUTOMATION_DEBUG === "true";
  const { pipelines, loading: loadingPipelines, createPipeline } = usePipelines();
  const { instances, loading: loadingInstances } = useInstances();
  const { agents } = useAgents();
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
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [selectedJourneyId, setSelectedJourneyId] = useState<string | null>(null);
  const [pendingStageId, setPendingStageId] = useState<string | null>(null);
  const [automationModalOpen, setAutomationModalOpen] = useState(false);
  const [rbEnabledInstanceNames, setRbEnabledInstanceNames] = useState<string[]>([]);
  const [seedingRbBlueprint, setSeedingRbBlueprint] = useState(false);

  const selectedInstanceName = instanceFilter === "all" ? null : instanceFilter;
  const effectivePipelineId =
    selectedPipelineId || pipelines.find((pipeline) => pipeline.is_default)?.id || pipelines[0]?.id || "";
  const { stages, loading: loadingStages, createStage } = usePipelineStages(effectivePipelineId || null);
  const stageIdsInPipeline = useMemo(() => new Set(stages.map((stage) => stage.id)), [stages]);

  const normalizedStageLookup = useMemo(() => {
    return new Map(stages.map((stage) => [stage.name.trim().toLowerCase(), stage]));
  }, [stages]);

  const filteredJourneys = useMemo(() => {
    return journeys.filter((journey) => {
      const matchesInstance = instanceFilter === "all" || journey.instance_name === instanceFilter;
      const matchesPipeline =
        !effectivePipelineId || !journey.trigger_stage_id || stageIdsInPipeline.has(journey.trigger_stage_id);

      return matchesInstance && matchesPipeline;
    });
  }, [effectivePipelineId, instanceFilter, journeys, stageIdsInPipeline]);

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

  useEffect(() => {
    if (instanceFilter === "all" && instances.length === 1) {
      setInstanceFilter(instances[0].instancia);
    }
  }, [instanceFilter, instances]);

  const handleSeedRbBlueprint = async () => {
    if (!selectedInstanceName) {
      toast.error("Selecione uma instancia antes de gerar o pacote RB.");
      return;
    }

    const confirmMessage =
      "Isso vai criar um pipeline dedicado de cobranca com as etapas e os 6 disparos RB padrao. Continuar?";
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      setSeedingRbBlueprint(true);

      // 1) Localizar ou criar o pipeline dedicado "Cobranca"
      const cobrancaPipelineName = "Cobranca";
      let cobrancaPipeline = pipelines.find(
        (pipeline) => pipeline.name.trim().toLowerCase() === cobrancaPipelineName.toLowerCase(),
      );

      if (!cobrancaPipeline) {
        const { data: newPipeline, error: createError } = await createPipeline({
          name: cobrancaPipelineName,
          description: "Pipeline dedicado para etapas de cobranca e automacoes RB.",
        });

        if (createError || !newPipeline) {
          throw new Error("Nao foi possivel criar o pipeline de cobranca.");
        }

        cobrancaPipeline = newPipeline;
      }

      const targetPipelineId = cobrancaPipeline.id;

      // 2) Construir lookup das etapas já existentes (unificando todas as etapas visíveis)
      const allStagesLookup = new Map(stages.map((stage) => [stage.name.trim().toLowerCase(), stage]));

      const journeyLookup = new Set(
        journeys.map((journey) => `${journey.instance_name.trim().toLowerCase()}::${journey.name.trim().toLowerCase()}`),
      );

      const ensureStage = async (stageBlueprint: (typeof RB_BILLING_STAGE_BLUEPRINTS)[number]) => {
        const existingStage = allStagesLookup.get(stageBlueprint.stageName.trim().toLowerCase());
        if (existingStage) {
          return existingStage;
        }

        const result = await createStage({
          ...buildRbBillingStagePayload(stageBlueprint),
          pipeline_id: targetPipelineId,
        });

        if (!result.data) {
          throw new Error(`Nao foi possivel criar a etapa ${stageBlueprint.stageName}.`);
        }

        allStagesLookup.set(result.data.name.trim().toLowerCase(), result.data);
        return result.data;
      };

      for (const stageBlueprint of RB_BILLING_STAGE_BLUEPRINTS) {
        await ensureStage(stageBlueprint);
      }

      const atendimentoStage =
        allStagesLookup.get("atendimento") ??
        allStagesLookup.get("finalizado") ??
        null;

      if (!atendimentoStage) {
        throw new Error("Nao foi possivel localizar a etapa de Atendimento.");
      }

      for (const messageBlueprint of RB_BILLING_MESSAGE_BLUEPRINTS) {
        const triggerStage = allStagesLookup.get(messageBlueprint.stageName.trim().toLowerCase());
        if (!triggerStage) {
          throw new Error(`Etapa nao encontrada para ${messageBlueprint.stageName}.`);
        }

        const journeyKey = `${selectedInstanceName.trim().toLowerCase()}::${messageBlueprint.journeyName.trim().toLowerCase()}`;
        if (journeyLookup.has(journeyKey)) {
          continue;
        }

        await createJourney(
          buildRbBillingJourneyPayload({
            triggerStageId: triggerStage.id,
            instanceName: selectedInstanceName,
            replyTargetStageId: atendimentoStage.id,
            journeyName: messageBlueprint.journeyName,
          }),
          buildRbBillingStepPayload(messageBlueprint),
        );
        journeyLookup.add(journeyKey);
      }

      // 3) Mudar a seleção para o pipeline de cobrança
      setSelectedPipelineId(targetPipelineId);
      toast.success("Pacote RB criado no pipeline \"Cobranca\".");
    } catch (error) {
      toast.error("Nao foi possivel criar o pacote RB.", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSeedingRbBlueprint(false);
    }
  };

  useEffect(() => {
    if (!automationEnabled || agents.length === 0) {
      setRbEnabledInstanceNames([]);
      return;
    }

    let active = true;

    void Promise.allSettled(
      agents.map(async (agent) => {
        const tools = await listAgentTools(agent.id);
        const rbTool = tools.find((tool) => tool.key === "rb_billing");
        return rbTool?.enabled && rbTool.readiness === "ready" ? agent.instance_name : null;
      }),
    ).then((results) => {
      if (!active) {
        return;
      }

      const nextInstances = Array.from(
        new Set(
          results
            .filter((result): result is PromiseFulfilledResult<string | null> => result.status === "fulfilled")
            .map((result) => result.value)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      setRbEnabledInstanceNames(nextInstances);
    });

    return () => {
      active = false;
    };
  }, [agents, automationEnabled]);

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

  const isLoading = loadingPipelines || loadingStages || loadingInstances || loadingJourneys || loadingCatalog;

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
            className="flex items-center gap-2 rounded-xl bg-[var(--color-primary-500)] px-4 py-2 text-sm font-semibold text-[var(--color-surface-1)] shadow-primary transition-all duration-200 hover:bg-[var(--color-primary-600)]"
          >
            <Plus className="h-4 w-4" />
            Nova automacao
          </button>
          <button
            onClick={handleSeedRbBlueprint}
            disabled={seedingRbBlueprint || loadingStages || loadingJourneys}
            className="flex items-center gap-2 rounded-xl border border-[var(--color-primary-200)] bg-[var(--color-primary-50)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-700)] shadow-sm transition-all duration-200 hover:bg-[var(--color-primary-100)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Wallet className="h-4 w-4" />
            {seedingRbBlueprint ? "Gerando RB..." : "Gerar pacote RB"}
          </button>
        </div>
      </div>

      <Card className="rounded-[24px] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border-medium)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">
              <Filter className="h-4 w-4" />
              Filtro de instancia
            </div>

            <div className="w-full sm:w-[260px]">
              <Select value={effectivePipelineId} onValueChange={setSelectedPipelineId} disabled={loadingPipelines || pipelines.length === 0}>
                <SelectTrigger className="rounded-xl border-[var(--color-border-medium)] bg-[var(--color-bg-surface)] text-foreground">
                  <SelectValue placeholder="Pipeline" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)]">
                  {pipelines.map((pipeline) => (
                    <SelectItem
                      key={pipeline.id}
                      value={pipeline.id}
                      className="text-foreground focus:bg-[var(--color-border-subtle)] focus:text-foreground"
                    >
                      {pipeline.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
        <Card className="rounded-[24px] border border-dashed border-[var(--border-default)] bg-[var(--color-surface-1)] p-8 text-center text-sm text-[var(--color-gray-600)] shadow-sm sm:p-10">
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
        onRunPreview={async (leadId) => {
          await preview({ funnelId: selectedJourneyId as string, leadId });
        }}
        preselectedStageId={pendingStageId}
        preselectedInstanceName={selectedInstanceName}
        onSelectJourney={setSelectedJourneyId}
        createJourney={createJourney}
        updateJourney={updateJourney}
        deleteJourney={deleteJourney}
        createStep={createStep}
        updateStep={updateStep}
        deleteStep={deleteStep}
        rbEnabledInstanceNames={rbEnabledInstanceNames}
        showDebugTools={showAutomationDebug}
      />
    </div>
  );
}
