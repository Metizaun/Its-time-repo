import { useEffect, useMemo, useState } from "react";
import { Clock3, Save, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";

import { AutomationRuleBuilder } from "@/components/automation/AutomationRuleBuilder";
import { AutomationSimulationPanel } from "@/components/automation/AutomationSimulationPanel";
import { formatDelayLabel, getMessagePreview, sortStepsForDisplay } from "@/components/automation/automation-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Instance } from "@/hooks/useInstances";
import type { Lead } from "@/hooks/useLeads";
import {
  buildAutomationLookupMaps,
  createDefaultEntryRule,
  createDefaultExitRule,
  createRuleGroup,
  formatAnchorEventLabel,
  formatReentryModeLabel,
  isRuleEmpty,
  normalizeRuleNode,
  summarizeRuleNode,
  updateDefaultEntryRuleStage,
  type AutomationExecution,
  type AutomationJourney,
  type AutomationOwnerOption,
  type AutomationPreviewResult,
  type AutomationRuleNode,
  type AutomationStep,
  type AutomationTagOption,
} from "@/lib/automation";
import type { AutomationJourneyPayload, AutomationStepPayload } from "@/hooks/useAutomationJourneys";
import type { PipelineStage } from "@/types";

type StepTimingMode = "anchor" | "after";

type JourneyFormState = {
  id: string | null;
  name: string;
  trigger_stage_id: string;
  instance_name: string;
  is_active: boolean;
  entry_rule: AutomationRuleNode;
  exit_rule: AutomationRuleNode;
  anchor_event: "stage_entered_at" | "last_outbound" | "last_inbound";
  reentry_mode: "restart_on_match" | "ignore_if_active" | "allow_parallel";
  reply_target_stage_id: string;
  builder_version: number;
};

type StepFormState = {
  id: string | null;
  label: string;
  timing_mode: StepTimingMode;
  delay_minutes: string;
  message_template: string;
  is_active: boolean;
  step_rule: AutomationRuleNode;
  step_rule_enabled: boolean;
};

function createInitialStepForm(): StepFormState {
  return {
    id: null,
    label: "",
    timing_mode: "anchor",
    delay_minutes: "60",
    message_template: "",
    is_active: true,
    step_rule: createRuleGroup("all", []),
    step_rule_enabled: false,
  };
}

function findAtendimentoStageId(stages: PipelineStage[]) {
  return stages.find((stage) => stage.name.trim().toLowerCase() === "atendimento")?.id ?? "";
}

function getErrorDescription(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return "Tente novamente em instantes.";
}

function buildInitialJourneyForm(params: {
  journey: AutomationJourney | null;
  stages: PipelineStage[];
  preselectedStageId: string | null;
  preselectedInstanceName: string | null;
}): JourneyFormState {
  const defaultStageId = params.preselectedStageId || params.stages[0]?.id || "";
  const atendimentoStageId = findAtendimentoStageId(params.stages);

  if (!params.journey) {
    return {
      id: null,
      name: "",
      trigger_stage_id: defaultStageId,
      instance_name: params.preselectedInstanceName || "",
      is_active: true,
      entry_rule: createDefaultEntryRule(defaultStageId),
      exit_rule: createDefaultExitRule(),
      anchor_event: "stage_entered_at",
      reentry_mode: "restart_on_match",
      reply_target_stage_id: atendimentoStageId,
      builder_version: 2,
    };
  }

  return {
    id: params.journey.id,
    name: params.journey.name,
    trigger_stage_id: params.journey.trigger_stage_id,
    instance_name: params.journey.instance_name,
    is_active: params.journey.is_active,
    entry_rule: normalizeRuleNode(params.journey.entry_rule, createDefaultEntryRule(params.journey.trigger_stage_id)),
    exit_rule: normalizeRuleNode(params.journey.exit_rule, createDefaultExitRule()),
    anchor_event: params.journey.anchor_event,
    reentry_mode: params.journey.reentry_mode,
    reply_target_stage_id: params.journey.reply_target_stage_id || atendimentoStageId,
    builder_version: params.journey.builder_version || 2,
  };
}

interface AutomationMessageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journey: AutomationJourney | null;
  steps: AutomationStep[];
  stages: PipelineStage[];
  instances: Instance[];
  owners: AutomationOwnerOption[];
  tags: AutomationTagOption[];
  previewLeads: Lead[];
  executions: AutomationExecution[];
  executionsLoading: boolean;
  previewResult: AutomationPreviewResult | null;
  previewLoading: boolean;
  onRunPreview: (leadId: string) => Promise<void>;
  preselectedStageId: string | null;
  preselectedInstanceName: string | null;
  onSelectJourney: (journeyId: string | null) => void;
  createJourney: (payload: AutomationJourneyPayload) => Promise<AutomationJourney>;
  updateJourney: (journeyId: string, payload: AutomationJourneyPayload) => Promise<AutomationJourney>;
  deleteJourney: (journeyId: string) => Promise<void>;
  createStep: (journeyId: string, payload: AutomationStepPayload) => Promise<AutomationStep>;
  updateStep: (stepId: string, journeyId: string, payload: AutomationStepPayload) => Promise<unknown>;
  deleteStep: (stepId: string, journeyId: string) => Promise<unknown>;
}

export function AutomationMessageModal({
  open,
  onOpenChange,
  journey,
  steps,
  stages,
  instances,
  owners,
  tags,
  previewLeads,
  executions,
  executionsLoading,
  previewResult,
  previewLoading,
  onRunPreview,
  preselectedStageId,
  preselectedInstanceName,
  onSelectJourney,
  createJourney,
  updateJourney,
  deleteJourney,
  createStep,
  updateStep,
  deleteStep,
}: AutomationMessageModalProps) {
  const [journeyForm, setJourneyForm] = useState<JourneyFormState>(() =>
    buildInitialJourneyForm({
      journey,
      stages,
      preselectedStageId,
      preselectedInstanceName,
    }),
  );
  const [stepForm, setStepForm] = useState<StepFormState>(() => createInitialStepForm());
  const [savingJourney, setSavingJourney] = useState(false);
  const [savingStep, setSavingStep] = useState(false);
  const [selectedPreviewLeadId, setSelectedPreviewLeadId] = useState("");

  const orderedSteps = useMemo(() => sortStepsForDisplay(steps), [steps]);
  const atendimentoStageId = useMemo(() => findAtendimentoStageId(stages), [stages]);
  const lookupMaps = useMemo(
    () => buildAutomationLookupMaps({ stages, owners, tags, instances }),
    [instances, owners, stages, tags],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setJourneyForm(
      buildInitialJourneyForm({
        journey,
        stages,
        preselectedStageId,
        preselectedInstanceName,
      }),
    );
    setStepForm(createInitialStepForm());
  }, [journey, open, preselectedInstanceName, preselectedStageId, stages]);

  useEffect(() => {
    if (previewLeads.length === 0) {
      if (selectedPreviewLeadId) {
        setSelectedPreviewLeadId("");
      }
      return;
    }

    if (!selectedPreviewLeadId || !previewLeads.some((lead) => lead.id === selectedPreviewLeadId)) {
      setSelectedPreviewLeadId(previewLeads[0].id);
    }
  }, [previewLeads, selectedPreviewLeadId]);

  const handleJourneyFieldChange = <K extends keyof JourneyFormState>(field: K, value: JourneyFormState[K]) => {
    setJourneyForm((previous) => {
      const nextState = {
        ...previous,
        [field]: value,
      };

      if (field === "trigger_stage_id" && typeof value === "string" && value.length > 0) {
        nextState.entry_rule = updateDefaultEntryRuleStage(previous.entry_rule, value);
      }

      return nextState;
    });
  };

  const handleSaveJourney = async () => {
    if (!journeyForm.name.trim()) {
      toast.error("Informe um nome para a automacao");
      return;
    }

    if (!journeyForm.trigger_stage_id) {
      toast.error("Selecione a etapa do pipeline");
      return;
    }

    if (!journeyForm.instance_name) {
      toast.error("Selecione a instancia de envio");
      return;
    }

    if (!journeyForm.reply_target_stage_id) {
      toast.error("Defina a etapa de resposta do lead antes de ativar a jornada");
      return;
    }

    try {
      setSavingJourney(true);

      const payload: AutomationJourneyPayload = {
        name: journeyForm.name.trim(),
        trigger_stage_id: journeyForm.trigger_stage_id,
        instance_name: journeyForm.instance_name,
        is_active: journeyForm.is_active,
        entry_rule: normalizeRuleNode(journeyForm.entry_rule, createDefaultEntryRule(journeyForm.trigger_stage_id)),
        exit_rule: normalizeRuleNode(journeyForm.exit_rule, createDefaultExitRule()),
        anchor_event: journeyForm.anchor_event,
        reentry_mode: journeyForm.reentry_mode,
        reply_target_stage_id: journeyForm.reply_target_stage_id || null,
        builder_version: 2,
      };

      const savedJourney = journeyForm.id
        ? await updateJourney(journeyForm.id, payload)
        : await createJourney(payload);

      onSelectJourney(savedJourney.id);
      setJourneyForm(
        buildInitialJourneyForm({
          journey: savedJourney,
          stages,
          preselectedStageId,
          preselectedInstanceName,
        }),
      );
    } catch (error: unknown) {
      toast.error("Erro ao salvar automacao", { description: getErrorDescription(error) });
    } finally {
      setSavingJourney(false);
    }
  };

  const handleDeleteJourney = async () => {
    if (!journeyForm.id || !journey) {
      return;
    }

    const confirmed = window.confirm(`Remover a automacao "${journey.name}"?`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteJourney(journey.id);
      onSelectJourney(null);
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error("Erro ao remover automacao", { description: getErrorDescription(error) });
    }
  };

  const handleSaveStep = async () => {
    const currentJourneyId = journeyForm.id || journey?.id || null;

    if (!currentJourneyId) {
      toast.error("Salve a automacao antes de criar mensagens");
      return;
    }

    if (!stepForm.label.trim()) {
      toast.error("Informe um rotulo para a mensagem");
      return;
    }

    if (!stepForm.message_template.trim()) {
      toast.error("Escreva a mensagem automatica");
      return;
    }

    const parsedDelay = Number(stepForm.delay_minutes);
    if (stepForm.timing_mode === "after" && (Number.isNaN(parsedDelay) || parsedDelay < 1)) {
      toast.error("O envio apos a ancora exige um valor positivo");
      return;
    }

    try {
      setSavingStep(true);

      const payload: AutomationStepPayload = {
        label: stepForm.label.trim(),
        delay_minutes: stepForm.timing_mode === "anchor" ? 0 : parsedDelay,
        message_template: stepForm.message_template.trim(),
        is_active: stepForm.is_active,
        step_rule: stepForm.step_rule_enabled ? normalizeRuleNode(stepForm.step_rule, createRuleGroup("all", [])) : null,
      };

      if (stepForm.id) {
        await updateStep(stepForm.id, currentJourneyId, payload);
      } else {
        await createStep(currentJourneyId, payload);
      }

      setStepForm(createInitialStepForm());
    } catch (error: unknown) {
      toast.error("Erro ao salvar mensagem", { description: getErrorDescription(error) });
    } finally {
      setSavingStep(false);
    }
  };

  const handleEditStep = (step: AutomationStep) => {
    setStepForm({
      id: step.id,
      label: step.label,
      timing_mode: step.delay_minutes === 0 ? "anchor" : "after",
      delay_minutes: step.delay_minutes === 0 ? "60" : String(step.delay_minutes),
      message_template: step.message_template,
      is_active: step.is_active,
      step_rule: step.step_rule ? normalizeRuleNode(step.step_rule) : createRuleGroup("all", []),
      step_rule_enabled: !!step.step_rule && !isRuleEmpty(step.step_rule),
    });
  };

  const handleDeleteStep = async (step: AutomationStep) => {
    const currentJourneyId = journeyForm.id || journey?.id || null;
    if (!currentJourneyId) {
      return;
    }

    const confirmed = window.confirm(`Remover a mensagem "${step.label}"?`);
    if (!confirmed) {
      return;
    }

    try {
      await deleteStep(step.id, currentJourneyId);
      if (stepForm.id === step.id) {
        setStepForm(createInitialStepForm());
      }
    } catch (error: unknown) {
      toast.error("Erro ao remover mensagem", { description: getErrorDescription(error) });
    }
  };

  const handleRunPreview = async () => {
    if (!journeyForm.id || !selectedPreviewLeadId) {
      return;
    }

    try {
      await onRunPreview(selectedPreviewLeadId);
    } catch (error: unknown) {
      toast.error("Erro ao rodar simulacao", { description: getErrorDescription(error) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl overflow-hidden p-0">
        <DialogHeader className="border-b px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="h-5 w-5" />
            {journeyForm.id ? "Editar automacao" : "Nova automacao"}
          </DialogTitle>
          <DialogDescription>
            Monte a jornada com regra de entrada, saida por inbound, mensagens e simulacao do motor logico.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 px-6 py-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="journey-name">Nome da automacao</Label>
                <Input
                  id="journey-name"
                  value={journeyForm.name}
                  onChange={(event) => handleJourneyFieldChange("name", event.target.value)}
                  placeholder="Ex: Follow-up atendimento"
                />
              </div>

              <div className="space-y-2">
                <Label>Etapa do Kanban</Label>
                <Select
                  value={journeyForm.trigger_stage_id}
                  onValueChange={(value) => handleJourneyFieldChange("trigger_stage_id", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a etapa" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Instancia de envio</Label>
                <Select
                  value={journeyForm.instance_name}
                  onValueChange={(value) => handleJourneyFieldChange("instance_name", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a instancia" />
                  </SelectTrigger>
                  <SelectContent>
                    {instances.map((instance) => (
                      <SelectItem key={instance.instancia} value={instance.instancia}>
                        {instance.instancia}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Etapa para resposta inbound</Label>
                <Select
                  value={journeyForm.reply_target_stage_id || atendimentoStageId}
                  onValueChange={(value) => handleJourneyFieldChange("reply_target_stage_id", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a etapa de resposta" />
                  </SelectTrigger>
                  <SelectContent>
                    {stages.map((stage) => (
                      <SelectItem key={stage.id} value={stage.id}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-[24px] border bg-card/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Automacao ativa</p>
                  <p className="text-sm text-muted-foreground">
                    Se o lead responder inbound, a jornada para e vai para a etapa selecionada.
                  </p>
                </div>
                <Switch
                  checked={journeyForm.is_active}
                  onCheckedChange={(checked) => handleJourneyFieldChange("is_active", checked)}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="outline">{formatAnchorEventLabel(journeyForm.anchor_event)}</Badge>
                <Badge variant="outline">{formatReentryModeLabel(journeyForm.reentry_mode)}</Badge>
                <Badge variant="outline">{summarizeRuleNode(journeyForm.entry_rule, lookupMaps)}</Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={handleSaveJourney} disabled={savingJourney} className="flex-1">
                  <Save className="h-4 w-4" />
                  {savingJourney ? "Salvando..." : journeyForm.id ? "Salvar automacao" : "Criar automacao"}
                </Button>

                {journeyForm.id ? (
                  <Button variant="outline" onClick={handleDeleteJourney}>
                    <Trash2 className="h-4 w-4" />
                    Remover
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {!atendimentoStageId ? (
            <Alert>
              <AlertTitle>Etapa Atendimento nao encontrada</AlertTitle>
              <AlertDescription>
                Crie uma etapa chamada Atendimento para que o inbound possa encerrar a jornada e mover o lead automaticamente.
              </AlertDescription>
            </Alert>
          ) : null}

          <Tabs defaultValue="entry" className="space-y-4">
            <TabsList className="grid h-auto grid-cols-2 gap-2 bg-transparent p-0 xl:grid-cols-4">
              <TabsTrigger value="entry" className="rounded-xl border bg-card/60 py-3">
                Entrada
              </TabsTrigger>
              <TabsTrigger value="exit" className="rounded-xl border bg-card/60 py-3">
                Saida
              </TabsTrigger>
              <TabsTrigger value="messages" className="rounded-xl border bg-card/60 py-3">
                Mensagens
              </TabsTrigger>
              <TabsTrigger value="simulation" className="rounded-xl border bg-card/60 py-3">
                Simulacao
              </TabsTrigger>
            </TabsList>

            <TabsContent value="entry" className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label>Evento ancora</Label>
                  <Select
                    value={journeyForm.anchor_event}
                    onValueChange={(value: JourneyFormState["anchor_event"]) =>
                      handleJourneyFieldChange("anchor_event", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stage_entered_at">Entrada na etapa</SelectItem>
                      <SelectItem value="last_outbound">Ultimo outbound</SelectItem>
                      <SelectItem value="last_inbound">Ultimo inbound</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Comportamento de reentrada</Label>
                  <Select
                    value={journeyForm.reentry_mode}
                    onValueChange={(value: JourneyFormState["reentry_mode"]) =>
                      handleJourneyFieldChange("reentry_mode", value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="restart_on_match">Reiniciar relogio</SelectItem>
                      <SelectItem value="ignore_if_active">Ignorar se ja estiver ativa</SelectItem>
                      <SelectItem value="allow_parallel">Permitir paralelas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <AutomationRuleBuilder
                title="Regra de entrada"
                description="Defina o IF logico que faz a jornada entrar ou reiniciar."
                value={journeyForm.entry_rule}
                onChange={(nextValue) => handleJourneyFieldChange("entry_rule", nextValue)}
                stages={stages}
                owners={owners}
                tags={tags}
                instances={instances}
              />
            </TabsContent>

            <TabsContent value="exit" className="space-y-6">
              <Alert>
                <AlertTitle>Padrao recomendado</AlertTitle>
                <AlertDescription>
                  O fluxo padrao desta v1 e encerrar a automacao quando houver inbound e mover o lead para Atendimento.
                </AlertDescription>
              </Alert>

              <AutomationRuleBuilder
                title="Regra de saida"
                description="Essas condicoes sao revalidadas antes do envio e na chegada de mensagens inbound."
                value={journeyForm.exit_rule}
                onChange={(nextValue) => handleJourneyFieldChange("exit_rule", nextValue)}
                stages={stages}
                owners={owners}
                tags={tags}
                instances={instances}
              />
            </TabsContent>

            <TabsContent value="messages" className="space-y-6">
              <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="space-y-4">
                  <div>
                    <h3 className="flex items-center gap-2 font-semibold">
                      <Clock3 className="h-4 w-4" />
                      Mensagens da jornada
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Cada mensagem usa o evento ancora da jornada como ponto zero do relogio.
                    </p>
                  </div>

                  <Separator />

                  {!journeyForm.id ? (
                    <div className="rounded-2xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                      Salve a automacao para comecar a cadastrar mensagens.
                    </div>
                  ) : orderedSteps.length === 0 ? (
                    <div className="rounded-2xl border border-dashed px-4 py-8 text-sm text-muted-foreground">
                      Nenhuma mensagem cadastrada ainda.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {orderedSteps.map((step) => (
                        <div key={step.id} className="rounded-2xl border bg-card/95 p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-medium">{step.label}</p>
                                <Badge variant="secondary">{formatDelayLabel(step.delay_minutes)}</Badge>
                                <Badge variant={step.is_active ? "default" : "outline"}>
                                  {step.is_active ? "Ativa" : "Pausada"}
                                </Badge>
                                {step.step_rule && !isRuleEmpty(step.step_rule) ? (
                                  <Badge variant="outline">Regra extra</Badge>
                                ) : null}
                              </div>

                              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                                {getMessagePreview(step.message_template, 180)}
                              </p>

                              {step.step_rule && !isRuleEmpty(step.step_rule) ? (
                                <p className="mt-3 text-xs text-muted-foreground">
                                  Antes de enviar: {summarizeRuleNode(step.step_rule, lookupMaps)}
                                </p>
                              ) : null}
                            </div>

                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" onClick={() => handleEditStep(step)}>
                                Editar
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => handleDeleteStep(step)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-4 rounded-[24px] border bg-muted/20 p-4">
                  <div>
                    <h3 className="font-semibold">{stepForm.id ? "Editar mensagem" : "Nova mensagem"}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Use 0 minuto para disparar na ancora ou um atraso positivo para follow-up/nutricao.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="step-label">Rotulo</Label>
                    <Input
                      id="step-label"
                      value={stepForm.label}
                      onChange={(event) => setStepForm((previous) => ({ ...previous, label: event.target.value }))}
                      placeholder="Ex: Follow-up 4h"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Quando enviar</Label>
                      <Select
                        value={stepForm.timing_mode}
                        onValueChange={(value: StepTimingMode) =>
                          setStepForm((previous) => ({ ...previous, timing_mode: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="anchor">Na ancora</SelectItem>
                          <SelectItem value="after">Depois de</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="step-delay">Tempo em minutos</Label>
                      <Input
                        id="step-delay"
                        type="number"
                        min={stepForm.timing_mode === "anchor" ? 0 : 1}
                        value={stepForm.timing_mode === "anchor" ? 0 : stepForm.delay_minutes}
                        disabled={stepForm.timing_mode === "anchor"}
                        onChange={(event) =>
                          setStepForm((previous) => ({ ...previous, delay_minutes: event.target.value }))
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="step-message">Mensagem</Label>
                    <Textarea
                      id="step-message"
                      rows={8}
                      value={stepForm.message_template}
                      onChange={(event) =>
                        setStepForm((previous) => ({ ...previous, message_template: event.target.value }))
                      }
                      placeholder="Oi {nome}, seguimos por aqui caso voce queira continuar seu atendimento."
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-xl border bg-background px-4 py-3">
                    <div>
                      <p className="font-medium">Mensagem ativa</p>
                      <p className="text-sm text-muted-foreground">
                        Mensagens pausadas continuam cadastradas, mas nao geram novas execucoes.
                      </p>
                    </div>
                    <Switch
                      checked={stepForm.is_active}
                      onCheckedChange={(checked) =>
                        setStepForm((previous) => ({ ...previous, is_active: checked }))
                      }
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-xl border bg-background px-4 py-3">
                    <div>
                      <p className="font-medium">Regra extra antes do envio</p>
                      <p className="text-sm text-muted-foreground">
                        Use quando a mensagem so deve sair se outra condicao ainda estiver valida.
                      </p>
                    </div>
                    <Switch
                      checked={stepForm.step_rule_enabled}
                      onCheckedChange={(checked) =>
                        setStepForm((previous) => ({ ...previous, step_rule_enabled: checked }))
                      }
                    />
                  </div>

                  {stepForm.step_rule_enabled ? (
                    <AutomationRuleBuilder
                      title="Validacao da mensagem"
                      description="Essa regra roda de novo antes do envio efetivo da mensagem."
                      value={stepForm.step_rule}
                      onChange={(nextValue) => setStepForm((previous) => ({ ...previous, step_rule: nextValue }))}
                      stages={stages}
                      owners={owners}
                      tags={tags}
                      instances={instances}
                    />
                  ) : null}

                  <div className="flex items-center justify-end gap-2">
                    {stepForm.id ? (
                      <Button variant="outline" onClick={() => setStepForm(createInitialStepForm())}>
                        Cancelar edicao
                      </Button>
                    ) : null}
                    <Button onClick={handleSaveStep} disabled={!journeyForm.id || savingStep}>
                      <Save className="h-4 w-4" />
                      {savingStep ? "Salvando..." : stepForm.id ? "Salvar mensagem" : "Adicionar mensagem"}
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="simulation">
              <AutomationSimulationPanel
                funnelId={journeyForm.id}
                leads={previewLeads}
                selectedLeadId={selectedPreviewLeadId}
                onSelectedLeadIdChange={setSelectedPreviewLeadId}
                onRunPreview={handleRunPreview}
                previewLoading={previewLoading}
                previewResult={previewResult}
                executions={executions}
                executionsLoading={executionsLoading}
              />
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
