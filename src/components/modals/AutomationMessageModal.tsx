import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clock3, Plus, Save, Sparkles, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";

import { AutomationConditionComposer } from "@/components/automation/AutomationConditionComposer";
import { AutomationRuleBuilder } from "@/components/automation/AutomationRuleBuilder";
import { AutomationSimulationPanel } from "@/components/automation/AutomationSimulationPanel";
import { formatDelayLabel, getMessagePreview, sortStepsForDisplay } from "@/components/automation/automation-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAutomationMessageFlow } from "@/hooks/useAutomationMessageFlow";
import type { Instance } from "@/hooks/useInstances";
import type { Lead } from "@/hooks/useLeads";
import {
  AUTOMATION_RECIPES,
  createDefaultEntryRule,
  createDefaultExitRule,
  createJourneyEntryRuleFromRecipe,
  createRuleGroup,
  formatTimingSummary,
  getAutomationRecipeById,
  minutesToTimeUnit,
  normalizeRuleNode,
  updateDefaultEntryRuleInstance,
  updateDefaultEntryRuleStage,
  timeUnitToMinutes,
  type AutomationExecution,
  type AutomationJourney,
  type AutomationLeadSourceOption,
  type AutomationOwnerOption,
  type AutomationPreviewResult,
  type AutomationRecipeId,
  type AutomationRuleNode,
  type AutomationStep,
  type AutomationTagOption,
  type AutomationTimeUnit,
} from "@/lib/automation";
import { cn } from "@/lib/utils";
import type { AutomationJourneyPayload, AutomationStepPayload } from "@/hooks/useAutomationJourneys";
import type { PipelineStage } from "@/types";

type StepTimingMode = "now" | "after";

type JourneyFormState = {
  id: string | null;
  name: string;
  trigger_stage_id: string;
  instance_name: string;
  is_active: boolean;
  humanized_dispatch_enabled: boolean;
  dispatch_limit_per_hour: number;
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
  delay_value: string;
  delay_unit: AutomationTimeUnit;
  message_template: string;
  is_active: boolean;
  step_rule: AutomationRuleNode;
  step_rule_enabled: boolean;
};

function inferRecipeIdFromJourney(journey: AutomationJourney | null): AutomationRecipeId | null {
  if (!journey) {
    return null;
  }

  if (journey.anchor_event === "last_outbound") {
    return "follow_up_last_message";
  }

  if (journey.anchor_event === "last_inbound") {
    return "nutrition_after_reply";
  }

  return "message_after_stage_time";
}

function createInitialStepForm(recipeId?: AutomationRecipeId | null): StepFormState {
  const recipe = recipeId ? getAutomationRecipeById(recipeId) : null;
  const defaultDelay = minutesToTimeUnit(recipe?.suggested_step.delay_minutes ?? 60);

  return {
    id: null,
    label: recipe?.suggested_step.label ?? "",
    timing_mode: (recipe?.suggested_step.delay_minutes ?? 60) === 0 ? "now" : "after",
    delay_value: String(defaultDelay.value),
    delay_unit: defaultDelay.unit,
    message_template: recipe?.suggested_step.message_template ?? "",
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
      humanized_dispatch_enabled: false,
      dispatch_limit_per_hour: 40,
      entry_rule: createDefaultEntryRule(defaultStageId, params.preselectedInstanceName),
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
    humanized_dispatch_enabled: params.journey.humanized_dispatch_enabled,
    dispatch_limit_per_hour: params.journey.dispatch_limit_per_hour || 40,
    entry_rule: updateDefaultEntryRuleInstance(
      normalizeRuleNode(
        params.journey.entry_rule,
        createDefaultEntryRule(params.journey.trigger_stage_id, params.journey.instance_name),
      ),
      params.journey.instance_name,
    ),
    exit_rule: normalizeRuleNode(params.journey.exit_rule, createDefaultExitRule()),
    anchor_event: params.journey.anchor_event,
    reentry_mode: params.journey.reentry_mode,
    reply_target_stage_id: params.journey.reply_target_stage_id || atendimentoStageId,
    builder_version: params.journey.builder_version || 2,
  };
}

function buildStepLabel(stepForm: StepFormState, anchorEvent: JourneyFormState["anchor_event"]) {
  if (stepForm.label.trim()) {
    return stepForm.label.trim();
  }

  if (stepForm.timing_mode === "now") {
    return "Mensagem imediata";
  }

  return formatTimingSummary(
    timeUnitToMinutes(Number(stepForm.delay_value || 1), stepForm.delay_unit),
    anchorEvent,
  );
}

function buildStepPayload(
  stepForm: StepFormState,
  anchorEvent: JourneyFormState["anchor_event"],
  delayMinutes: number,
): AutomationStepPayload {
  return {
    label: buildStepLabel(stepForm, anchorEvent),
    delay_minutes: delayMinutes,
    message_template: stepForm.message_template.trim(),
    is_active: stepForm.is_active,
    step_rule: stepForm.step_rule_enabled ? normalizeRuleNode(stepForm.step_rule, createRuleGroup("all", [])) : null,
  };
}

function RecipePicker({
  onSelect,
}: {
  onSelect: (recipeId: AutomationRecipeId) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Escolha como a automacao vai comecar</h3>
        <p className="text-sm text-muted-foreground">
          Comece por um modelo pronto e ajuste so o que fizer sentido para o seu processo.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {AUTOMATION_RECIPES.map((recipe) => (
          <button
            key={recipe.id}
            type="button"
            onClick={() => onSelect(recipe.id)}
            className="rounded-[24px] border bg-card/80 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[var(--color-accent)]" />
              <span className="text-sm font-semibold">{recipe.title}</span>
            </div>

            <p className="mt-3 text-sm text-muted-foreground">{recipe.description}</p>

            <div className="mt-4 rounded-2xl border bg-background/70 px-4 py-3 text-sm text-muted-foreground">
              Primeira mensagem: {
                (() => {
                  const t = minutesToTimeUnit(recipe.suggested_step.delay_minutes);
                  const labels: Record<string, string> = { minute: "min", hour: "hora", day: "dia" };
                  return `${t.value} ${labels[t.unit] ?? t.unit}${t.value > 1 && t.unit !== "minute" ? "s" : ""} apos entrar na etapa`;
                })()
              }
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AutomationMessageStepCard({
  title,
  preview,
  timingLabel,
  leadCount,
  isInactive,
  isHighlighted,
  isDraft = false,
  onClick,
}: {
  title: string;
  preview: string;
  timingLabel: string;
  leadCount: number | null;
  isInactive: boolean;
  isHighlighted: boolean;
  isDraft?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-[196px] w-full min-w-[250px] max-w-[280px] flex-col overflow-hidden rounded-[24px] border border-[var(--color-accent)]/70 bg-[rgba(10,10,10,0.88)] p-5 text-left text-white shadow-[0_8px_32px_rgba(229,57,58,0.05)] transition-all duration-200 hover:-translate-y-1 hover:border-[var(--color-accent)] hover:shadow-[0_12px_36px_rgba(229,57,58,0.11)]",
        isInactive && "opacity-80",
        isHighlighted &&
          "border-[var(--color-accent)] shadow-[0_0_0_1px_rgba(229,57,58,0.32),0_0_24px_rgba(229,57,58,0.24),0_16px_40px_rgba(229,57,58,0.14)]",
      )}
    >
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/55">
              {timingLabel}
            </p>
            <p className="mt-2 line-clamp-2 text-base font-bold leading-tight text-white">
              {title}
            </p>
          </div>

          <div className="text-right">
            {isDraft ? <p className="text-[10px] uppercase tracking-[0.24em] text-white/50">Rascunho</p> : null}
          </div>
        </div>

        <div className="mt-3 inline-flex w-fit rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-border-subtle)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
          Mensagem
        </div>
        <p className="mt-4 line-clamp-4 text-sm leading-relaxed text-white/66">{preview}</p>

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-[var(--color-border-subtle)] pt-3">
          <div className={cn("text-xs font-medium", isInactive ? "text-[var(--color-text-secondary)]" : "text-[var(--color-success)]")}>
            {isInactive ? "Inativa" : "Ativa"}
          </div>
          {leadCount !== null ? (
            <div className="rounded-full border border-[var(--color-accent)]/25 bg-[var(--color-accent)]/10 px-3 py-1 text-xs font-semibold text-[var(--color-accent)]">
              {leadCount} leads
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function AutomationMessageEditorDialog({
  open,
  onOpenChange,
  stepForm,
  currentStepDelayMinutes,
  journeyAnchorEvent,
  journeySaved,
  savingStep,
  onStepFormChange,
  onSave,
  onCancelEdit,
  onDelete,
  stages,
  tags,
  instances,
  leadSources,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stepForm: StepFormState;
  currentStepDelayMinutes: number;
  journeyAnchorEvent: JourneyFormState["anchor_event"];
  journeySaved: boolean;
  savingStep: boolean;
  onStepFormChange: (updater: (previous: StepFormState) => StepFormState) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onDelete?: (() => void) | null;
  stages: PipelineStage[];
  tags: AutomationTagOption[];
  instances: Instance[];
  leadSources: AutomationLeadSourceOption[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-3rem)] max-w-3xl overflow-y-auto rounded-[28px] border-white/10 bg-[#09090c] p-0 text-white">
        <DialogHeader className="border-b border-white/10 px-6 py-5">
          <DialogTitle className="text-white">{stepForm.id ? "Editar mensagem" : journeySaved ? "Nova mensagem" : "Primeira mensagem"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-6 py-6">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_150px_150px]">
            <div className="space-y-2">
              <Label htmlFor="step-label" className="text-white/80">
                Nome interno
              </Label>
              <Input
                id="step-label"
                value={stepForm.label}
                onChange={(event) => onStepFormChange((previous) => ({ ...previous, label: event.target.value }))}
                placeholder="Gerado automaticamente se ficar vazio"
                className="border-white/10 bg-white/5 text-white placeholder:text-white/35"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-white/80">Quando enviar</Label>
              <Select
                value={stepForm.timing_mode}
                onValueChange={(value: StepTimingMode) =>
                  onStepFormChange((previous) => ({ ...previous, timing_mode: value }))
                }
              >
                <SelectTrigger className="border-white/10 bg-white/5 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-white/10 bg-[#111115] text-white">
                  <SelectItem value="now">Na hora</SelectItem>
                  <SelectItem value="after">Depois de</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <div className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/78">
                {formatTimingSummary(currentStepDelayMinutes, journeyAnchorEvent)}
              </div>
            </div>
          </div>

          {stepForm.timing_mode === "after" ? (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
              <div className="space-y-2">
                <Label htmlFor="step-delay" className="text-white/80">
                  Tempo
                </Label>
                <Input
                  id="step-delay"
                  type="number"
                  min={1}
                  value={stepForm.delay_value}
                  onChange={(event) =>
                    onStepFormChange((previous) => ({ ...previous, delay_value: event.target.value }))
                  }
                  className="border-white/10 bg-white/5 text-white"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white/80">Unidade</Label>
                <Select
                  value={stepForm.delay_unit}
                  onValueChange={(value: AutomationTimeUnit) =>
                    onStepFormChange((previous) => ({ ...previous, delay_unit: value }))
                  }
                >
                  <SelectTrigger className="border-white/10 bg-white/5 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-white/10 bg-[#111115] text-white">
                    <SelectItem value="minute">min</SelectItem>
                    <SelectItem value="hour">hora</SelectItem>
                    <SelectItem value="day">dia</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="step-message" className="text-white/80">
              Mensagem
            </Label>
            <Textarea
              id="step-message"
              rows={8}
              value={stepForm.message_template}
              onChange={(event) =>
                onStepFormChange((previous) => ({ ...previous, message_template: event.target.value }))
              }
              placeholder="Oi {nome}, sigo por aqui para continuar o atendimento."
              className="min-h-[210px] resize-none border-white/10 bg-white/5 text-white placeholder:text-white/35"
            />
          </div>

          <div className="flex flex-col gap-3 rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-medium text-white">Mensagem ativa</p>
              <p className="text-xs text-white/52">Mensagens inativas ficam no fluxo, mas nao disparam.</p>
            </div>
            <Switch
              checked={stepForm.is_active}
              onCheckedChange={(checked) => onStepFormChange((previous) => ({ ...previous, is_active: checked }))}
            />
          </div>

          <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-medium text-white">Condicao extra</p>
                <p className="text-xs text-white/52">Use apenas se essa mensagem depender de uma regra adicional.</p>
              </div>
              <Switch
                checked={stepForm.step_rule_enabled}
                onCheckedChange={(checked) =>
                  onStepFormChange((previous) => ({ ...previous, step_rule_enabled: checked }))
                }
              />
            </div>

            {stepForm.step_rule_enabled ? (
              <div className="mt-4">
                <AutomationConditionComposer
                  title="Regras da mensagem"
                  compact
                  value={stepForm.step_rule}
                  onChange={(nextValue) =>
                    onStepFormChange((previous) => ({ ...previous, step_rule: nextValue }))
                  }
                  stages={stages}
                  tags={tags}
                  leadSources={leadSources}
                  instances={instances}
                />
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t border-white/10 px-6 py-4">
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              {stepForm.id && onDelete ? (
                <Button
                  variant="outline"
                  onClick={onDelete}
                  className="border-white/15 bg-transparent text-white hover:bg-white/5 hover:text-white"
                >
                  <Trash2 className="h-4 w-4" />
                  Remover
                </Button>
              ) : null}
              {stepForm.id ? (
                <Button
                  variant="outline"
                  onClick={onCancelEdit}
                  className="border-white/15 bg-transparent text-white hover:bg-white/5 hover:text-white"
                >
                  Cancelar edicao
                </Button>
              ) : null}
            </div>

            <Button onClick={onSave} disabled={savingStep} className="bg-[var(--color-accent)] text-white hover:brightness-110">
              <Save className="h-4 w-4" />
              {savingStep ? "Salvando..." : journeySaved ? (stepForm.id ? "Salvar mensagem" : "Adicionar mensagem") : "Salvar rascunho"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
  leadSources: AutomationLeadSourceOption[];
  previewLeads: Lead[];
  executions: AutomationExecution[];
  executionsLoading: boolean;
  previewResult: AutomationPreviewResult | null;
  previewLoading: boolean;
  onRunPreview: (leadId: string) => Promise<void>;
  preselectedStageId: string | null;
  preselectedInstanceName: string | null;
  onSelectJourney: (journeyId: string | null) => void;
  createJourney: (payload: AutomationJourneyPayload, initialStepPayload?: AutomationStepPayload | null) => Promise<AutomationJourney>;
  updateJourney: (journeyId: string, payload: AutomationJourneyPayload) => Promise<AutomationJourney>;
  deleteJourney: (journeyId: string) => Promise<void>;
  createStep: (journeyId: string, payload: AutomationStepPayload) => Promise<AutomationStep>;
  updateStep: (stepId: string, journeyId: string, payload: AutomationStepPayload) => Promise<unknown>;
  deleteStep: (stepId: string, journeyId: string) => Promise<unknown>;
  showDebugTools?: boolean;
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
  leadSources,
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
  showDebugTools = false,
}: AutomationMessageModalProps) {
  const [journeyForm, setJourneyForm] = useState<JourneyFormState>(() =>
    buildInitialJourneyForm({
      journey,
      stages,
      preselectedStageId,
      preselectedInstanceName,
    }),
  );
  const [stepForm, setStepForm] = useState<StepFormState>(() => createInitialStepForm(inferRecipeIdFromJourney(journey)));
  const [selectedRecipeId, setSelectedRecipeId] = useState<AutomationRecipeId | null>(() =>
    inferRecipeIdFromJourney(journey),
  );
  const [savingJourney, setSavingJourney] = useState(false);
  const [savingStep, setSavingStep] = useState(false);
  const [stepEditorOpen, setStepEditorOpen] = useState(false);
  const [selectedPreviewLeadId, setSelectedPreviewLeadId] = useState("");
  const [activeTab, setActiveTab] = useState("entry");

  const orderedSteps = useMemo(() => sortStepsForDisplay(steps), [steps]);
  const atendimentoStageId = useMemo(() => findAtendimentoStageId(stages), [stages]);
  const selectedRecipe = selectedRecipeId ? getAutomationRecipeById(selectedRecipeId) : null;
  const currentStepDelayMinutes = stepForm.timing_mode === "now"
    ? 0
    : timeUnitToMinutes(Math.max(1, Number(stepForm.delay_value || 1)), stepForm.delay_unit);
  const canShowEditor = !!journey || !!selectedRecipeId;
  const { flow: messageFlow, loading: messageFlowLoading } = useAutomationMessageFlow(
    journeyForm.id,
    orderedSteps,
    open && canShowEditor,
  );
  const editingStep = useMemo(
    () => orderedSteps.find((step) => step.id === stepForm.id) ?? null,
    [orderedSteps, stepForm.id],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextRecipeId = inferRecipeIdFromJourney(journey);

    setJourneyForm(
      buildInitialJourneyForm({
        journey,
        stages,
        preselectedStageId,
        preselectedInstanceName,
      }),
    );
    setSelectedRecipeId(nextRecipeId);
    setStepForm(createInitialStepForm(nextRecipeId));
    setStepEditorOpen(false);
    setActiveTab("entry");
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

  const applyRecipe = (recipeId: AutomationRecipeId) => {
    const recipe = getAutomationRecipeById(recipeId);

    setSelectedRecipeId(recipeId);
    setJourneyForm((previous) => ({
      ...previous,
      name: previous.name.trim() ? previous.name : recipe.title,
      entry_rule: createJourneyEntryRuleFromRecipe(recipeId, previous.trigger_stage_id, previous.instance_name),
      exit_rule: createDefaultExitRule(),
      anchor_event: recipe.anchor_event,
      reentry_mode: recipe.reentry_mode,
      builder_version: 2,
    }));
    setStepForm(createInitialStepForm(recipeId));
    setActiveTab("entry");
  };

  const handleJourneyFieldChange = <K extends keyof JourneyFormState>(field: K, value: JourneyFormState[K]) => {
    setJourneyForm((previous) => {
      const nextState = {
        ...previous,
        [field]: value,
      };

      if (field === "trigger_stage_id" && typeof value === "string" && value.length > 0) {
        nextState.entry_rule = updateDefaultEntryRuleStage(previous.entry_rule, value);
      }

      if (field === "instance_name" && typeof value === "string" && value.length > 0) {
        nextState.entry_rule = updateDefaultEntryRuleInstance(previous.entry_rule, value);
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
      toast.error("Defina a etapa para quando o lead responder");
      return;
    }

    if (!Number.isInteger(journeyForm.dispatch_limit_per_hour) || journeyForm.dispatch_limit_per_hour < 1) {
      toast.error("Informe um valor valido em Limite de disparos");
      return;
    }

    try {
      setSavingJourney(true);

      const payload: AutomationJourneyPayload = {
        name: journeyForm.name.trim(),
        trigger_stage_id: journeyForm.trigger_stage_id,
        instance_name: journeyForm.instance_name,
        is_active: journeyForm.is_active,
        humanized_dispatch_enabled: journeyForm.humanized_dispatch_enabled,
        dispatch_limit_per_hour: journeyForm.dispatch_limit_per_hour,
        entry_rule: normalizeRuleNode(
          updateDefaultEntryRuleInstance(journeyForm.entry_rule, journeyForm.instance_name),
          createDefaultEntryRule(journeyForm.trigger_stage_id, journeyForm.instance_name),
        ),
        exit_rule: normalizeRuleNode(journeyForm.exit_rule, createDefaultExitRule()),
        anchor_event: journeyForm.anchor_event,
        reentry_mode: journeyForm.reentry_mode,
        reply_target_stage_id: journeyForm.reply_target_stage_id || null,
        builder_version: 2,
      };

      const isCreatingJourney = !journeyForm.id;
      const shouldCreateInitialStep =
        isCreatingJourney && !stepForm.id && stepForm.message_template.trim().length > 0;

      if (isCreatingJourney && journeyForm.is_active && !shouldCreateInitialStep) {
        toast.error("Escreva a primeira mensagem antes de ativar a automacao");
        setActiveTab("messages");
        return;
      }

      if (shouldCreateInitialStep && stepForm.timing_mode === "after" && currentStepDelayMinutes < 1) {
        toast.error("Escolha um tempo valido para a primeira mensagem");
        setActiveTab("messages");
        return;
      }

      const initialStepPayload = shouldCreateInitialStep
        ? buildStepPayload(stepForm, journeyForm.anchor_event, currentStepDelayMinutes)
        : null;

      const savedJourney = journeyForm.id
        ? await updateJourney(journeyForm.id, payload)
        : await createJourney(payload, initialStepPayload);

      onSelectJourney(savedJourney.id);
      setJourneyForm(
        buildInitialJourneyForm({
          journey: savedJourney,
          stages,
          preselectedStageId,
          preselectedInstanceName,
        }),
      );
      setSelectedRecipeId(inferRecipeIdFromJourney(savedJourney));
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

  const handleStepFormChange = (updater: (previous: StepFormState) => StepFormState) => {
    setStepForm((previous) => updater(previous));
  };

  const handleSaveStep = async () => {
    const currentJourneyId = journeyForm.id || journey?.id || null;

    if (!stepForm.message_template.trim()) {
      toast.error("Escreva a mensagem automatica");
      return;
    }

    if (stepForm.timing_mode === "after" && currentStepDelayMinutes < 1) {
      toast.error("Escolha um tempo valido para essa mensagem");
      return;
    }

    try {
      setSavingStep(true);

      if (!currentJourneyId) {
        setStepEditorOpen(false);
        return;
      }

      const payload = buildStepPayload(stepForm, journeyForm.anchor_event, currentStepDelayMinutes);

      if (stepForm.id) {
        await updateStep(stepForm.id, currentJourneyId, payload);
      } else {
        await createStep(currentJourneyId, payload);
      }

      setStepForm(createInitialStepForm(selectedRecipeId));
      setStepEditorOpen(false);
    } catch (error: unknown) {
      toast.error("Erro ao salvar mensagem", { description: getErrorDescription(error) });
    } finally {
      setSavingStep(false);
    }
  };

  const openNewStepEditor = () => {
    setActiveTab("messages");
    setStepForm(createInitialStepForm(selectedRecipeId));
    setStepEditorOpen(true);
  };

  const handleEditStep = (step: AutomationStep) => {
    const delay = minutesToTimeUnit(step.delay_minutes === 0 ? 60 : step.delay_minutes);

    setActiveTab("messages");
    setStepForm({
      id: step.id,
      label: step.label,
      timing_mode: step.delay_minutes === 0 ? "now" : "after",
      delay_value: String(delay.value),
      delay_unit: delay.unit,
      message_template: step.message_template,
      is_active: step.is_active,
      step_rule: step.step_rule ? normalizeRuleNode(step.step_rule) : createRuleGroup("all", []),
      step_rule_enabled: !!step.step_rule,
    });
    setStepEditorOpen(true);
  };

  const handleCancelStepEdit = () => {
    setStepForm(createInitialStepForm(selectedRecipeId));
    setStepEditorOpen(false);
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
        setStepForm(createInitialStepForm(selectedRecipeId));
        setStepEditorOpen(false);
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
      toast.error("Erro ao rodar diagnostico", { description: getErrorDescription(error) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] max-w-7xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-1">
              <DialogTitle className="flex items-center gap-2">
                <Workflow className="h-5 w-5" />
                {journeyForm.id ? "Editar automacao" : "Nova automacao"}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                Monte a jornada em linguagem simples, sem precisar pensar na logica interna.
              </p>
            </div>

            {canShowEditor ? (
              <div className="flex flex-wrap items-center gap-2">
                {!journeyForm.id && selectedRecipe ? (
                  <Badge variant="outline">{selectedRecipe.title}</Badge>
                ) : null}
                <Button onClick={handleSaveJourney} disabled={savingJourney}>
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
            ) : null}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {!canShowEditor ? (
            <RecipePicker onSelect={applyRecipe} />
          ) : (
            <div className="space-y-6">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_220px_220px]">
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
                  <Label>Etapa do Funil</Label>
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
                  <Label>Instancia</Label>
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
                  <Label>Mover para</Label>
                  <Select
                    value={journeyForm.reply_target_stage_id || atendimentoStageId}
                    onValueChange={(value) => handleJourneyFieldChange("reply_target_stage_id", value)}
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
              </div>

              {!journeyForm.id && selectedRecipe ? (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/70 px-4 py-3">
                  <Badge variant="outline">{selectedRecipe.title}</Badge>
                  <span className="text-sm text-muted-foreground">{selectedRecipe.description}</span>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedRecipeId(null)}>
                    <ArrowLeft className="h-4 w-4" />
                    Trocar modelo
                  </Button>
                </div>
              ) : null}

              {!atendimentoStageId ? (
                <Alert>
                  <AlertTitle>Etapa Atendimento nao encontrada</AlertTitle>
                  <AlertDescription>
                    Crie uma etapa chamada Atendimento para que a resposta do lead possa encerrar a jornada.
                  </AlertDescription>
                </Alert>
              ) : null}

              <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList
                  className={`grid h-auto gap-2 bg-transparent p-0 ${showDebugTools ? "grid-cols-3" : "grid-cols-2"}`}
                >
                  <TabsTrigger value="entry" className="rounded-xl border bg-card/60 py-3">
                    Entrada
                  </TabsTrigger>
                  <TabsTrigger value="messages" className="rounded-xl border bg-card/60 py-3">
                    Mensagens
                  </TabsTrigger>
                  {showDebugTools ? (
                    <TabsTrigger value="debug" className="rounded-xl border bg-card/60 py-3">
                      Debug
                    </TabsTrigger>
                  ) : null}
                </TabsList>

                <TabsContent value="entry" className="space-y-6">
                  <AutomationConditionComposer
                    title="Quando essa jornada deve entrar"
                    value={journeyForm.entry_rule}
                    onChange={(nextValue) => handleJourneyFieldChange("entry_rule", nextValue)}
                    stages={stages}
                    tags={tags}
                    leadSources={leadSources}
                    instances={instances}
                  />

                  <div className="rounded-[24px] border bg-card/70 p-5">
                    <div className="grid gap-4 lg:grid-cols-3">
                      <div className="flex items-center justify-between rounded-2xl border bg-background/60 px-4 py-3">
                        <p className="font-medium">Automacao ativa</p>
                        <Switch
                          checked={journeyForm.is_active}
                          onCheckedChange={(checked) => handleJourneyFieldChange("is_active", checked)}
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-2xl border bg-background/60 px-4 py-3">
                        <p className="font-medium">Envio humanizado</p>
                        <Switch
                          checked={journeyForm.humanized_dispatch_enabled}
                          onCheckedChange={(checked) =>
                            handleJourneyFieldChange("humanized_dispatch_enabled", checked)
                          }
                        />
                      </div>

                      <div className="rounded-2xl border bg-background/60 px-4 py-3">
                        <Label htmlFor="dispatch-limit" className="font-medium">
                          Disparos por hora
                        </Label>
                        <Input
                          id="dispatch-limit"
                          type="number"
                          min={1}
                          step={1}
                          className="mt-3"
                          value={journeyForm.dispatch_limit_per_hour}
                          onChange={(event) =>
                            handleJourneyFieldChange(
                              "dispatch_limit_per_hour",
                              Math.max(0, Math.trunc(Number(event.target.value || 0)))
                            )
                          }
                        />
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="messages" className="space-y-6">
                  <div className="space-y-5 rounded-[28px] border bg-card/70 p-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div>
                        <h3 className="flex items-center gap-2 font-semibold">
                          <Clock3 className="h-4 w-4" />
                          Fluxo de mensagens
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {journeyForm.id
                            ? `${messageFlow.activeLeadsCount} leads ativos nesta jornada.`
                            : "Monte a primeira mensagem e salve a automacao para distribuir os leads no fluxo."}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{orderedSteps.length} mensagens</Badge>
                        {journeyForm.id ? <Badge variant="outline">{messageFlow.parkedCount} no fim</Badge> : null}
                        <Button
                          onClick={journeyForm.id ? openNewStepEditor : () => setStepEditorOpen(true)}
                          className="bg-[var(--color-accent)] text-white hover:brightness-110"
                        >
                          <Plus className="h-4 w-4" />
                          {journeyForm.id ? "Nova mensagem" : "Primeira mensagem"}
                        </Button>
                      </div>
                    </div>

                    {messageFlowLoading && journeyForm.id ? (
                      <div className="flex flex-wrap gap-3">
                        <div className="h-[196px] w-[260px] animate-pulse rounded-[28px] border bg-background/40" />
                        <div className="h-[196px] w-[260px] animate-pulse rounded-[28px] border bg-background/40" />
                        <div className="h-[196px] w-[260px] animate-pulse rounded-[28px] border bg-background/40" />
                      </div>
                    ) : !journeyForm.id ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <AutomationMessageStepCard
                          title={stepForm.label.trim() || "Primeira mensagem"}
                          preview={
                            stepForm.message_template.trim()
                              ? getMessagePreview(stepForm.message_template, 120)
                              : "Clique para escrever a primeira mensagem."
                          }
                          timingLabel={formatTimingSummary(currentStepDelayMinutes, journeyForm.anchor_event)}
                          leadCount={null}
                          isInactive={!stepForm.is_active}
                          isHighlighted={false}
                          isDraft
                          onClick={() => setStepEditorOpen(true)}
                        />
                      </div>
                    ) : orderedSteps.length === 0 ? (
                      <button
                        type="button"
                        onClick={openNewStepEditor}
                        className="flex h-[180px] w-full items-center justify-center rounded-[28px] border border-dashed border-border bg-background/30 px-6 text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
                      >
                        Criar a primeira mensagem do fluxo
                      </button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        {orderedSteps.map((step, index) => {
                          const leadCount = messageFlow.stepCounts[step.id] ?? 0;
                          const isHighlighted = messageFlow.highlightedStepIds.includes(step.id);

                          return (
                            <div key={step.id} className="flex items-center gap-3">
                              <AutomationMessageStepCard
                                title={step.label.trim() || `Mensagem ${index + 1}`}
                                preview={getMessagePreview(step.message_template, 120)}
                                timingLabel={formatDelayLabel(step.delay_minutes, journeyForm.anchor_event)}
                                leadCount={leadCount}
                                isInactive={!step.is_active}
                                isHighlighted={isHighlighted}
                                onClick={() => handleEditStep(step)}
                              />

                              {index < orderedSteps.length - 1 ? (
                                <div className="hidden xl:block">
                                  <div className="h-px w-7 bg-[var(--color-accent)]/45" />
                                </div>
                              ) : null}
                            </div>
                          );
                        })}

                        <div className="flex items-center gap-3">
                          {orderedSteps.length > 0 ? (
                            <div className="hidden xl:block">
                              <div className="h-px w-7 bg-[var(--color-accent)]/45" />
                            </div>
                          ) : null}

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={openNewStepEditor}
                              className={cn(
                                "group flex h-14 w-14 items-center justify-center rounded-full border border-[var(--color-accent)]/45 bg-[rgba(10,10,10,0.86)] text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-accent)] hover:shadow-[0_0_18px_rgba(229,57,58,0.18)]",
                                messageFlow.parkedCount > 0 && "shadow-[0_0_14px_rgba(229,57,58,0.14)]",
                              )}
                              title="Criar nova mensagem"
                            >
                              {messageFlow.parkedCount}
                            </button>

                            <button
                              type="button"
                              onClick={openNewStepEditor}
                              className="text-left transition-opacity hover:opacity-100"
                            >
                              <span className="block text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                                No fim
                              </span>
                              <span className="block text-xs text-white/72">Nova mensagem</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <AutomationMessageEditorDialog
                    open={stepEditorOpen}
                    onOpenChange={setStepEditorOpen}
                    stepForm={stepForm}
                    currentStepDelayMinutes={currentStepDelayMinutes}
                    journeyAnchorEvent={journeyForm.anchor_event}
                    journeySaved={Boolean(journeyForm.id)}
                    savingStep={savingStep}
                    onStepFormChange={handleStepFormChange}
                    onSave={handleSaveStep}
                    onCancelEdit={handleCancelStepEdit}
                    onDelete={editingStep ? () => handleDeleteStep(editingStep) : null}
                    stages={stages}
                    tags={tags}
                    instances={instances}
                    leadSources={leadSources}
                  />
                </TabsContent>

                {showDebugTools ? (
                  <TabsContent value="debug" className="space-y-6">
                    <Alert>
                      <AlertTitle>Area interna</AlertTitle>
                      <AlertDescription>
                        Esse modo mostra o builder tecnico e o diagnostico visual do motor.
                      </AlertDescription>
                    </Alert>

                    <AutomationRuleBuilder
                      title="Regra de entrada"
                      description="Modo tecnico para revisar ou editar a regra completa."
                      value={journeyForm.entry_rule}
                      onChange={(nextValue) => handleJourneyFieldChange("entry_rule", nextValue)}
                      stages={stages}
                      owners={owners}
                      tags={tags}
                      instances={instances}
                    />

                    <AutomationRuleBuilder
                      title="Regra de saida"
                      description="Modo tecnico para revisar ou editar a regra completa."
                      value={journeyForm.exit_rule}
                      onChange={(nextValue) => handleJourneyFieldChange("exit_rule", nextValue)}
                      stages={stages}
                      owners={owners}
                      tags={tags}
                      instances={instances}
                    />

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
                ) : null}
              </Tabs>
            </div>
          )}
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
