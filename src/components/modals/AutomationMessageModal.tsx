import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Plus, Save, Trash2, Workflow } from "lucide-react";
import { toast } from "sonner";

import { AutomationConditionComposer } from "@/components/automation/AutomationConditionComposer";
import { GupshupTemplatePanel } from "@/components/automation/GupshupTemplatePanel";
import { AutomationRuleBuilder } from "@/components/automation/AutomationRuleBuilder";
import { AutomationSimulationPanel } from "@/components/automation/AutomationSimulationPanel";
import {
  formatDelayLabel,
  getMessagePreview,
  sortStepsForDisplay,
} from "@/components/automation/automation-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useAutomationMediaAssets } from "@/hooks/useAutomationMediaAssets";
import { useAutomationMessageFlow } from "@/hooks/useAutomationMessageFlow";
import type { Instance } from "@/hooks/useInstances";
import type { Lead } from "@/hooks/useLeads";
import {
  createDefaultEntryRule,
  createDefaultExitRule,
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
  type AutomationJourneyEntrySource,
  type AutomationRuleNode,
  type AutomationStep,
  type AutomationStepContentMode,
  type AutomationStepMediaKind,
  type AutomationStepRbMessageKind,
  type AutomationTagOption,
  type AutomationTimeUnit,
} from "@/lib/automation";
import { cn } from "@/lib/utils";
import type {
  AutomationJourneyPayload,
  AutomationStepPayload,
} from "@/hooks/useAutomationJourneys";
import {
  uploadAutomationMediaAsset,
  type AutomationMediaAsset,
} from "@/services/automationMediaService";
import type { GupshupTemplate } from "@/services/gupshupTemplateService";
import type { PipelineStage } from "@/types";

type StepTimingMode = "now" | "after";
type GupshupMessageMode = "template" | "followup";

const DISPATCH_LIMIT_PRESETS = [8, 15, 30, 40];
const MAX_HUMANIZED_DISPATCH_LIMIT_PER_HOUR = 120;
const RECOMMENDED_HUMANIZED_DISPATCH_LIMIT_PER_HOUR = 60;
const MIN_HUMANIZED_WINDOW_MINUTES = 30;
const RECOMMENDED_HUMANIZED_WINDOW_MINUTES = 120;
const LATE_HUMANIZED_WINDOW_END_MINUTES = 21 * 60;
const RB_PAYMENT_TYPE_OPTIONS = [
  { id: "1", label: "Dinheiro" },
  { id: "2", label: "Cartao" },
  { id: "3", label: "Cheque" },
  { id: "4", label: "Movimento bancario" },
  { id: "5", label: "Credito financeiro" },
  { id: "6", label: "Carne" },
  { id: "7", label: "Pix" },
  { id: "8", label: "Crediario proprio" },
  { id: "9", label: "Boleto" },
] as const;
const DR_OCULOS_ACES_ID = 5;
const DR_OCULOS_RB_PAYMENT_TYPE_IDS = ["6", "8", "9"] as const;

const RB_MESSAGE_VARIABLES = [
  {
    token: "{nome}",
    label: "Nome do lead",
    description: "Nome usado nas saudacoes da mensagem.",
  },
  {
    token: "{vencimento}",
    label: "Vencimento",
    description: "Data de vencimento do titulo.",
  },
  {
    token: "{pix}",
    label: "Pix",
    description: "Chave Pix configurada para a empresa.",
  },
  {
    token: "{DtVencimento}",
    label: "DtVencimento",
    description: "Campo legado de vencimento do RB.",
  },
  {
    token: "{Vl_liquido}",
    label: "Vl_liquido",
    description: "Valor liquido legado exibido no RB.",
  },
  {
    token: "{valor_liquido}",
    label: "valor_liquido",
    description: "Valor liquido atualizado do titulo.",
  },
] as const;

type JourneyFormState = {
  id: string | null;
  name: string;
  trigger_stage_id: string;
  instance_name: string;
  is_active: boolean;
  humanized_dispatch_enabled: boolean;
  dispatch_limit_per_hour: number;
  humanized_dispatch_window_start: string;
  humanized_dispatch_window_end: string;
  daily_dispatch_enabled: boolean;
  daily_dispatch_weekends_enabled: boolean;
  daily_dispatch_time: string;
  entry_source: AutomationJourneyEntrySource;
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
  content_mode: AutomationStepContentMode;
  message_template: string;
  media_asset_id: string;
  media_kind: AutomationStepMediaKind;
  media_caption: string;
  gupshup_mode: GupshupMessageMode;
  gupshup_template_id: string;
  gupshup_template_name: string;
  gupshup_template_language: string;
  gupshup_template_params_text: string;
  rb_message_kind: AutomationStepRbMessageKind;
  rb_days_offset: string;
  rb_payment_type_ids: string[];
  is_active: boolean;
  step_rule: AutomationRuleNode;
  step_rule_enabled: boolean;
};

function inferRecipeIdFromJourney(
  journey: AutomationJourney | null,
): AutomationRecipeId | null {
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

function createInitialStepForm(
  recipeId?: AutomationRecipeId | null,
): StepFormState {
  const recipe = recipeId ? getAutomationRecipeById(recipeId) : null;
  const defaultDelay = minutesToTimeUnit(
    recipe?.suggested_step.delay_minutes ?? 60,
  );

  return {
    id: null,
    label: recipe?.suggested_step.label ?? "",
    timing_mode:
      (recipe?.suggested_step.delay_minutes ?? 60) === 0 ? "now" : "after",
    delay_value: String(defaultDelay.value),
    delay_unit: defaultDelay.unit,
    content_mode: "text",
    message_template: recipe?.suggested_step.message_template ?? "",
    media_asset_id: "",
    media_kind: "image",
    media_caption: "",
    gupshup_mode: "template",
    gupshup_template_id: "",
    gupshup_template_name: "",
    gupshup_template_language: "pt_BR",
    gupshup_template_params_text: "",
    rb_message_kind: "reminder",
    rb_days_offset: "2",
    rb_payment_type_ids: [],
    is_active: true,
    step_rule: createRuleGroup("all", []),
    step_rule_enabled: false,
  };
}

function parseTemplateParams(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTemplateParams(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .join("\n")
    : "";
}

function buildRbStepLabel(stepForm: StepFormState) {
  const daysOffset = Math.max(0, Number(stepForm.rb_days_offset || 0));

  if (stepForm.rb_message_kind === "reminder") {
    return daysOffset === 0 ? "Vence hoje" : `A vencer (${daysOffset} dias)`;
  }

  return `Atrasado (${daysOffset} dias)`;
}

function hasSameStringSelection(
  currentValues: string[],
  expectedValues: readonly string[],
) {
  if (currentValues.length !== expectedValues.length) {
    return false;
  }

  const currentSet = new Set(currentValues);
  return expectedValues.every((value) => currentSet.has(value));
}

function findAtendimentoStageId(stages: PipelineStage[]) {
  return (
    stages.find((stage) => stage.name.trim().toLowerCase() === "atendimento")
      ?.id ?? ""
  );
}

function toHHMM(value: string | null | undefined, fallback: string) {
  const raw = (value ?? "").trim();
  if (!raw) {
    return fallback;
  }

  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return fallback;
  }

  const hours = String(Math.min(Math.max(Number(match[1]), 0), 23)).padStart(
    2,
    "0",
  );
  const minutes = String(Math.min(Math.max(Number(match[2]), 0), 59)).padStart(
    2,
    "0",
  );
  return `${hours}:${minutes}`;
}

function hhmmToMinutes(value: string) {
  const match = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function normalizeTimeForDb(value: string) {
  const normalized = toHHMM(value, "08:00");
  return normalized.length === 5 ? `${normalized}:00` : normalized;
}

function getHumanizedDispatchQuality(form: JourneyFormState) {
  const warnings: string[] = [];

  if (!form.humanized_dispatch_enabled) {
    return { error: null, warnings };
  }

  if (
    !Number.isInteger(form.dispatch_limit_per_hour) ||
    form.dispatch_limit_per_hour < 1 ||
    form.dispatch_limit_per_hour > MAX_HUMANIZED_DISPATCH_LIMIT_PER_HOUR
  ) {
    return {
      error: `Informe um limite inteiro entre 1 e ${MAX_HUMANIZED_DISPATCH_LIMIT_PER_HOUR} disparos por hora`,
      warnings,
    };
  }

  const startMinutes = hhmmToMinutes(form.humanized_dispatch_window_start);
  const endMinutes = hhmmToMinutes(form.humanized_dispatch_window_end);

  if (startMinutes === null || endMinutes === null) {
    return {
      error: "Informe horarios validos para Inicio e Limite do disparo",
      warnings,
    };
  }

  if (startMinutes >= endMinutes) {
    return {
      error: "O horario limite deve ser maior que o horario de inicio",
      warnings,
    };
  }

  const windowMinutes = endMinutes - startMinutes;

  if (windowMinutes < MIN_HUMANIZED_WINDOW_MINUTES) {
    return {
      error: `A janela de disparo precisa ter pelo menos ${MIN_HUMANIZED_WINDOW_MINUTES} minutos`,
      warnings,
    };
  }

  if (
    form.dispatch_limit_per_hour > RECOMMENDED_HUMANIZED_DISPATCH_LIMIT_PER_HOUR
  ) {
    warnings.push(
      "Limite acima de 60 disparos/hora pode ficar agressivo para uma instancia.",
    );
  }

  if (windowMinutes < RECOMMENDED_HUMANIZED_WINDOW_MINUTES) {
    warnings.push(
      "Janela menor que 2 horas reduz a folga para atrasos e filas.",
    );
  }

  if (endMinutes > LATE_HUMANIZED_WINDOW_END_MINUTES) {
    warnings.push(
      "Horario limite depois das 21:00 pode gerar respostas fora do expediente.",
    );
  }

  return { error: null, warnings };
}

function getDailyDispatchQuality(form: JourneyFormState) {
  if (form.entry_source !== "rb" || !form.daily_dispatch_enabled) {
    return { error: null };
  }

  if (hhmmToMinutes(form.daily_dispatch_time) === null) {
    return { error: "Informe um horario valido para o disparo diario" };
  }

  return { error: null };
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
  const defaultStageId =
    params.preselectedStageId || params.stages[0]?.id || "";
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
      humanized_dispatch_window_start: "08:00",
      humanized_dispatch_window_end: "19:00",
      daily_dispatch_enabled: false,
      daily_dispatch_weekends_enabled: false,
      daily_dispatch_time: "08:00",
      entry_source: "conditions",
      entry_rule: createDefaultEntryRule(
        defaultStageId,
        params.preselectedInstanceName,
      ),
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
    humanized_dispatch_window_start: toHHMM(
      params.journey.humanized_dispatch_window_start,
      "08:00",
    ),
    humanized_dispatch_window_end: toHHMM(
      params.journey.humanized_dispatch_window_end,
      "19:00",
    ),
    daily_dispatch_enabled: params.journey.daily_dispatch_enabled ?? false,
    daily_dispatch_weekends_enabled:
      params.journey.daily_dispatch_weekends_enabled ?? false,
    daily_dispatch_time: toHHMM(params.journey.daily_dispatch_time, "08:00"),
    entry_source: params.journey.entry_source ?? "conditions",
    entry_rule: updateDefaultEntryRuleInstance(
      normalizeRuleNode(
        params.journey.entry_rule,
        createDefaultEntryRule(
          params.journey.trigger_stage_id,
          params.journey.instance_name,
        ),
      ),
      params.journey.instance_name,
    ),
    exit_rule: normalizeRuleNode(
      params.journey.exit_rule,
      createDefaultExitRule(),
    ),
    anchor_event: params.journey.anchor_event,
    reentry_mode: params.journey.reentry_mode,
    reply_target_stage_id:
      params.journey.reply_target_stage_id || atendimentoStageId,
    builder_version: params.journey.builder_version || 2,
  };
}

function buildStepLabel(
  stepForm: StepFormState,
  anchorEvent: JourneyFormState["anchor_event"],
  entrySource: AutomationJourneyEntrySource,
) {
  if (stepForm.label.trim()) {
    return stepForm.label.trim();
  }

  if (entrySource === "rb") {
    return buildRbStepLabel(stepForm);
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
  entrySource: AutomationJourneyEntrySource,
  delayMinutes: number,
): AutomationStepPayload {
  const isMedia = stepForm.content_mode === "media";
  const isRbJourney = entrySource === "rb";
  const useGupshupTemplate =
    stepForm.gupshup_mode === "template" &&
    Boolean(
      stepForm.gupshup_template_id.trim() || stepForm.gupshup_template_name.trim(),
    );

  return {
    label: buildStepLabel(stepForm, anchorEvent, entrySource),
    delay_minutes: delayMinutes,
    content_mode: stepForm.content_mode,
    message_template: isMedia ? null : stepForm.message_template.trim(),
    media_asset_id: isMedia ? stepForm.media_asset_id : null,
    media_kind: isMedia ? stepForm.media_kind : null,
    media_caption: isMedia ? stepForm.media_caption.trim() || null : null,
    gupshup_template_id: useGupshupTemplate
      ? stepForm.gupshup_template_id.trim() || null
      : null,
    gupshup_template_name: useGupshupTemplate
      ? stepForm.gupshup_template_name.trim() || null
      : null,
    gupshup_template_language: useGupshupTemplate
      ? stepForm.gupshup_template_language.trim() || "pt_BR"
      : null,
    gupshup_template_params: useGupshupTemplate
      ? parseTemplateParams(stepForm.gupshup_template_params_text)
      : [],
    rb_message_kind: isRbJourney ? stepForm.rb_message_kind : null,
    rb_days_offset: isRbJourney
      ? Math.max(0, Number(stepForm.rb_days_offset || 0))
      : null,
    rb_payment_type_ids: isRbJourney ? stepForm.rb_payment_type_ids : [],
    is_active: stepForm.is_active,
    step_rule: stepForm.step_rule_enabled
      ? normalizeRuleNode(stepForm.step_rule, createRuleGroup("all", []))
      : null,
  };
}

function hasStepContent(stepForm: StepFormState) {
  if (stepForm.content_mode === "media") {
    return stepForm.media_asset_id.trim().length > 0;
  }

  return stepForm.message_template.trim().length > 0;
}

function getStepFormPreview(stepForm: StepFormState) {
  if (stepForm.content_mode === "media") {
    return stepForm.media_caption.trim()
      ? getMessagePreview(stepForm.media_caption, 120)
      : stepForm.media_kind === "image"
        ? "Imagem cadastrada para disparo automatico."
        : stepForm.media_kind === "video"
          ? "Video cadastrado para disparo automatico."
          : "PDF cadastrado para disparo automatico.";
  }

  return stepForm.message_template.trim()
    ? getMessagePreview(stepForm.message_template, 120)
    : "Clique para escrever a primeira mensagem.";
}

function getAutomationStepPreview(step: AutomationStep) {
  if (step.content_mode === "media") {
    return step.media_caption?.trim()
      ? getMessagePreview(step.media_caption, 120)
      : step.media_kind === "image"
        ? "Imagem cadastrada para disparo automatico."
        : step.media_kind === "video"
          ? "Video cadastrado para disparo automatico."
          : "PDF cadastrado para disparo automatico.";
  }

  return getMessagePreview(step.message_template ?? "", 120);
}

function inferMediaKindFromFile(file: File) {
  const mimeType = file.type.trim().toLowerCase();
  if (
    mimeType === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  ) {
    return "document" as const;
  }

  if (mimeType.startsWith("image/")) {
    return "image" as const;
  }

  if (mimeType === "video/mp4" || file.name.toLowerCase().endsWith(".mp4")) {
    return "video" as const;
  }

  return null;
}

function getMediaKindLabel(kind: AutomationStepMediaKind) {
  if (kind === "image") return "Imagem";
  if (kind === "video") return "Vídeo";
  return "PDF";
}

function getMediaAccept(allowedKinds: AutomationStepMediaKind[]) {
  return [
    allowedKinds.includes("image") ? "image/jpeg,image/png" : null,
    allowedKinds.includes("video") ? "video/mp4" : null,
    allowedKinds.includes("document") ? "application/pdf" : null,
  ]
    .filter(Boolean)
    .join(",");
}

function AutomationMediaEditor({
  stepForm,
  instanceName,
  mediaAssets,
  mediaAssetsLoading,
  pendingMediaFile,
  allowedKinds,
  showCaption,
  onStepFormChange,
  onPendingMediaFileChange,
}: {
  stepForm: StepFormState;
  instanceName: string;
  mediaAssets: AutomationMediaAsset[];
  mediaAssetsLoading: boolean;
  pendingMediaFile: File | null;
  allowedKinds: AutomationStepMediaKind[];
  showCaption: boolean;
  onStepFormChange: (updater: (previous: StepFormState) => StepFormState) => void;
  onPendingMediaFileChange: (file: File | null) => void;
}) {
  const compatibleAssets = useMemo(
    () => mediaAssets.filter((asset) => allowedKinds.includes(asset.media_kind)),
    [allowedKinds, mediaAssets],
  );
  const selectedMediaAsset =
    compatibleAssets.find((asset) => asset.id === stepForm.media_asset_id) ?? null;

  return (
    <div className="space-y-4 border-t border-[var(--border-default)] pt-4">
      <div className="space-y-2">
        <Label htmlFor="automation-media-file">Arquivo</Label>
        <Input
          id="automation-media-file"
          type="file"
          accept={getMediaAccept(allowedKinds)}
          disabled={!instanceName.trim()}
          onChange={(event) => {
            const nextFile = event.target.files?.[0] ?? null;
            if (!nextFile) {
              onPendingMediaFileChange(null);
              return;
            }

            const inferredKind = inferMediaKindFromFile(nextFile);
            if (!inferredKind || !allowedKinds.includes(inferredKind)) {
              toast.error(`Use ${allowedKinds.map(getMediaKindLabel).join(", ")}`);
              event.target.value = "";
              return;
            }

            onPendingMediaFileChange(nextFile);
            onStepFormChange((previous) => ({
              ...previous,
              media_asset_id: "",
              media_kind: inferredKind,
            }));
          }}
          className="min-w-0 w-full file:mr-4 file:rounded-md file:border-0 file:bg-[var(--color-surface-2)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--color-gray-700)]"
        />
        {pendingMediaFile ? (
          <p className="break-all text-xs text-[var(--color-gray-600)]">
            {pendingMediaFile.name} · {getMediaKindLabel(stepForm.media_kind)}
          </p>
        ) : null}
        {!instanceName.trim() ? (
          <p className="text-xs text-[var(--color-error-600)]">
            Selecione a instância antes de enviar a mídia.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label>Reutilizar arquivo</Label>
        <Select
          value={stepForm.media_asset_id}
          disabled={!instanceName.trim() || mediaAssetsLoading || compatibleAssets.length === 0}
          onValueChange={(value) => {
            const asset = compatibleAssets.find((item) => item.id === value);
            onPendingMediaFileChange(null);
            onStepFormChange((previous) => ({
              ...previous,
              media_asset_id: value,
              media_kind: asset?.media_kind ?? previous.media_kind,
              media_caption: previous.media_caption || asset?.default_caption || "",
            }));
          }}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={mediaAssetsLoading ? "Carregando arquivos..." : "Selecione um arquivo"}
            />
          </SelectTrigger>
          <SelectContent>
            {compatibleAssets.map((asset) => (
              <SelectItem key={asset.id} value={asset.id}>
                {getMediaKindLabel(asset.media_kind)} · {asset.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedMediaAsset ? (
          <p className="text-xs text-[var(--color-gray-500)]">
            Salvo para {selectedMediaAsset.instance_name}
          </p>
        ) : null}
      </div>

      {showCaption ? (
        <div className="space-y-2">
          <Label htmlFor="media-caption">Legenda opcional</Label>
          <Textarea
            id="media-caption"
            rows={4}
            value={stepForm.media_caption}
            onChange={(event) =>
              onStepFormChange((previous) => ({
                ...previous,
                media_caption: event.target.value,
              }))
            }
            placeholder="Oi {nome}, segue o material combinado."
            className="min-h-[112px] resize-none"
          />
        </div>
      ) : null}
    </div>
  );
}

function getStepContentError(
  stepForm: StepFormState,
  isGupshupInstance: boolean,
  pendingMediaFile: File | null,
  entrySource: AutomationJourneyEntrySource,
) {
  if (stepForm.content_mode === "text") {
    if (!stepForm.message_template.trim()) {
      return "Escreva a mensagem automatica";
    }
  }

  if (
    isGupshupInstance &&
    stepForm.gupshup_mode === "template" &&
    !stepForm.gupshup_template_id.trim() &&
    !stepForm.gupshup_template_name.trim()
  ) {
    return "Selecione um template Gupshup aprovado";
  }

  if (!stepForm.media_asset_id.trim() && !pendingMediaFile) {
    if (stepForm.content_mode === "media") {
      return "Selecione a midia da automacao";
    }
  }

  const effectiveMediaKind = pendingMediaFile
    ? inferMediaKindFromFile(pendingMediaFile)
    : stepForm.media_kind;
  if (
    stepForm.content_mode === "media" &&
    effectiveMediaKind !== "image" &&
    effectiveMediaKind !== "video" &&
    effectiveMediaKind !== "document"
  ) {
    return "Use apenas imagem, video MP4 ou PDF";
  }

  const requiresTemplate = isGupshupInstance && entrySource === "rb";
  if (
    requiresTemplate &&
    !stepForm.gupshup_template_id.trim() &&
    !stepForm.gupshup_template_name.trim()
  ) {
    return "Informe o template Gupshup aprovado para este disparo";
  }

  if (entrySource === "rb") {
    if (!stepForm.rb_payment_type_ids.length) {
      return "Selecione ao menos um tipo de pagamento para a mensagem RB";
    }

    const rbDaysOffset = Number(stepForm.rb_days_offset || 0);
    if (!Number.isFinite(rbDaysOffset) || rbDaysOffset < 0) {
      return "Informe um numero de dias valido para a mensagem RB";
    }
  }

  return null;
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
        "group relative flex h-[196px] w-full min-w-[250px] max-w-[280px] flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--color-surface-1)] p-5 text-left text-[var(--color-gray-700)] shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-[var(--color-primary-200)] hover:shadow-md",
        isInactive && "opacity-80",
        isHighlighted &&
          "border-[var(--color-primary-500)] bg-[var(--color-primary-50)] shadow-md",
      )}
    >
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mt-2 line-clamp-2 text-base font-bold leading-tight text-[var(--color-gray-900)]">
              {title}
            </p>
          </div>

          <div className="text-right">
            {isDraft ? (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-primary-600)]">
                Rascunho
              </p>
            ) : null}
          </div>
        </div>

        <p className="mt-4 line-clamp-4 text-sm leading-relaxed text-[var(--color-gray-600)]">
          {preview}
        </p>

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-[var(--border-default)] pt-3">
          <div
            className={cn(
              "text-xs font-medium",
              isInactive
                ? "text-[var(--color-gray-500)]"
                : "text-[var(--color-success-600)]",
            )}
          >
            {isInactive ? "Inativa" : "Ativa"}
          </div>
          {leadCount !== null ? (
            <div className="rounded-full border border-[var(--color-primary-200)] bg-[var(--color-primary-50)] px-3 py-1 text-xs font-semibold text-[var(--color-primary-700)]">
              {leadCount} leads
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

type MessageContentDraft = Pick<
  StepFormState,
  | "content_mode"
  | "message_template"
  | "media_asset_id"
  | "media_kind"
  | "media_caption"
  | "gupshup_template_id"
  | "gupshup_template_name"
  | "gupshup_template_language"
  | "gupshup_template_params_text"
>;

function captureMessageDraft(stepForm: StepFormState): MessageContentDraft {
  return {
    content_mode: stepForm.content_mode,
    message_template: stepForm.message_template,
    media_asset_id: stepForm.media_asset_id,
    media_kind: stepForm.media_kind,
    media_caption: stepForm.media_caption,
    gupshup_template_id: stepForm.gupshup_template_id,
    gupshup_template_name: stepForm.gupshup_template_name,
    gupshup_template_language: stepForm.gupshup_template_language,
    gupshup_template_params_text: stepForm.gupshup_template_params_text,
  };
}

function createEmptyTemplateDraft(stepForm: StepFormState): MessageContentDraft {
  return {
    ...captureMessageDraft(stepForm),
    content_mode: "text",
    message_template: "",
    media_asset_id: "",
    media_kind: "image",
    media_caption: "",
    gupshup_template_id: "",
    gupshup_template_name: "",
    gupshup_template_params_text: "",
  };
}

function createFollowupDraft(stepForm: StepFormState): MessageContentDraft {
  return {
    ...captureMessageDraft(stepForm),
    gupshup_template_id: "",
    gupshup_template_name: "",
    gupshup_template_params_text: "",
  };
}

function AutomationMessageEditorDialog({
  open,
  onOpenChange,
  stepForm,
  currentStepDelayMinutes,
  journeyAnchorEvent,
  entrySource,
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
  instanceName,
  mediaAssets,
  mediaAssetsLoading,
  pendingMediaFile,
  onPendingMediaFileChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stepForm: StepFormState;
  currentStepDelayMinutes: number;
  journeyAnchorEvent: JourneyFormState["anchor_event"];
  entrySource: AutomationJourneyEntrySource;
  journeySaved: boolean;
  savingStep: boolean;
  onStepFormChange: (
    updater: (previous: StepFormState) => StepFormState,
  ) => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onDelete?: (() => void) | null;
  stages: PipelineStage[];
  tags: AutomationTagOption[];
  instances: Instance[];
  leadSources: AutomationLeadSourceOption[];
  instanceName: string;
  mediaAssets: AutomationMediaAsset[];
  mediaAssetsLoading: boolean;
  pendingMediaFile: File | null;
  onPendingMediaFileChange: (file: File | null) => void;
}) {
  const selectedMediaAsset = useMemo(
    () => mediaAssets.find((asset) => asset.id === stepForm.media_asset_id) ?? null,
    [mediaAssets, stepForm.media_asset_id],
  );
  const isRbJourney = entrySource === "rb";
  const isGupshupInstance = instances.some(
    (instance) =>
      instance.instancia === instanceName && instance.provider === "gupshup",
  );
  const [templateDraft, setTemplateDraft] = useState<MessageContentDraft>(() =>
    stepForm.gupshup_mode === "template"
      ? captureMessageDraft(stepForm)
      : createEmptyTemplateDraft(stepForm),
  );
  const [followupDraft, setFollowupDraft] = useState<MessageContentDraft>(() =>
    stepForm.gupshup_mode === "followup"
      ? createFollowupDraft(stepForm)
      : createFollowupDraft({ ...stepForm, message_template: "", media_asset_id: "", media_caption: "" }),
  );
  const [templatePendingFile, setTemplatePendingFile] = useState<File | null>(null);
  const [followupPendingFile, setFollowupPendingFile] = useState<File | null>(null);
  const initializedDraftKeyRef = useRef("");

  useEffect(() => {
    if (!open) {
      initializedDraftKeyRef.current = "";
      return;
    }

    const draftKey = stepForm.id ?? "new";
    if (initializedDraftKeyRef.current === draftKey) return;
    initializedDraftKeyRef.current = draftKey;

    const currentDraft = captureMessageDraft(stepForm);
    if (stepForm.gupshup_mode === "template") {
      setTemplateDraft(currentDraft);
      setFollowupDraft(
        createFollowupDraft({
          ...stepForm,
          content_mode: "text",
          message_template: stepForm.id ? "" : stepForm.message_template,
          media_asset_id: "",
          media_caption: "",
        }),
      );
      setTemplatePendingFile(pendingMediaFile);
      setFollowupPendingFile(null);
    } else {
      setFollowupDraft(createFollowupDraft(stepForm));
      setTemplateDraft(createEmptyTemplateDraft(stepForm));
      setFollowupPendingFile(pendingMediaFile);
      setTemplatePendingFile(null);
    }
  }, [open, pendingMediaFile, stepForm]);

  const changeGupshupMode = (nextMode: GupshupMessageMode) => {
    if (nextMode === stepForm.gupshup_mode) return;

    if (nextMode === "followup") {
      setTemplateDraft(captureMessageDraft(stepForm));
      setTemplatePendingFile(pendingMediaFile);
      onPendingMediaFileChange(followupPendingFile);
      onStepFormChange((previous) => ({
        ...previous,
        ...followupDraft,
        gupshup_mode: "followup",
      }));
      return;
    }

    setFollowupDraft(createFollowupDraft(stepForm));
    setFollowupPendingFile(pendingMediaFile);
    onPendingMediaFileChange(templatePendingFile);
    onStepFormChange((previous) => ({
      ...previous,
      ...templateDraft,
      gupshup_mode: "template",
    }));
  };

  const handleTemplateChange = (template: GupshupTemplate) => {
    const templateType = template.templateType.trim().toUpperCase();
    const nextMediaKind: AutomationStepMediaKind | null =
      templateType === "IMAGE"
        ? "image"
        : templateType === "VIDEO"
          ? "video"
          : templateType === "DOCUMENT"
            ? "document"
            : null;
    const pendingKind = pendingMediaFile ? inferMediaKindFromFile(pendingMediaFile) : null;
    if (pendingKind && nextMediaKind && pendingKind !== nextMediaKind) {
      onPendingMediaFileChange(null);
    }

    onStepFormChange((previous) => ({
      ...previous,
      gupshup_mode: "template",
      content_mode: nextMediaKind ? "media" : "text",
      message_template: template.body || previous.message_template,
      media_asset_id:
        nextMediaKind && previous.media_kind === nextMediaKind
          ? previous.media_asset_id
          : "",
      media_kind: nextMediaKind ?? previous.media_kind,
      media_caption: nextMediaKind ? "" : previous.media_caption,
      gupshup_template_id: template.id || template.name,
      gupshup_template_name: template.name,
      gupshup_template_language: template.language || "pt_BR",
      gupshup_template_params_text: "",
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-3rem)] max-w-3xl overflow-y-auto rounded-3xl border-[var(--border-default)] bg-[var(--color-surface-1)] p-0 text-[var(--color-gray-900)]">
        <DialogHeader className="border-b border-[var(--border-default)] px-6 py-5">
          <DialogTitle className="text-[var(--color-gray-900)]">
            {stepForm.id
              ? "Editar mensagem"
              : journeySaved
                ? "Nova mensagem"
                : "Primeira mensagem"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configure o agendamento e o conteúdo desta mensagem automática.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-6">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(360px,1.35fr)]">
            <div className="space-y-2">
              <Label
                htmlFor="step-label"
                className="text-[var(--color-gray-600)]"
              >
                Nome interno
              </Label>
              <Input
                id="step-label"
                value={stepForm.label}
                onChange={(event) =>
                  onStepFormChange((previous) => ({
                    ...previous,
                    label: event.target.value,
                  }))
                }
                placeholder="Gerado automaticamente se ficar vazio"
                className="border-[var(--border-input)] bg-[var(--color-surface-1)] text-[var(--color-gray-900)] placeholder:text-[var(--color-gray-500)]"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[var(--color-gray-600)]">Agendamento</Label>
              <div
                className={cn(
                  "grid gap-3",
                  stepForm.timing_mode === "after"
                    ? "grid-cols-1 sm:grid-cols-[minmax(130px,1fr)_90px_minmax(110px,0.8fr)]"
                    : "grid-cols-1",
                )}
              >
                <Select
                  value={stepForm.timing_mode}
                  onValueChange={(value: StepTimingMode) =>
                    onStepFormChange((previous) => ({ ...previous, timing_mode: value }))
                  }
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="now">Na hora</SelectItem>
                    <SelectItem value="after">Depois de</SelectItem>
                  </SelectContent>
                </Select>

                {stepForm.timing_mode === "after" ? (
                  <>
                    <Input
                      id="step-delay"
                      aria-label="Tempo"
                      type="number"
                      min={1}
                      value={stepForm.delay_value}
                      onChange={(event) =>
                        onStepFormChange((previous) => ({
                          ...previous,
                          delay_value: event.target.value,
                        }))
                      }
                    />
                    <Select
                      value={stepForm.delay_unit}
                      onValueChange={(value: AutomationTimeUnit) =>
                        onStepFormChange((previous) => ({ ...previous, delay_unit: value }))
                      }
                    >
                      <SelectTrigger aria-label="Unidade de tempo"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minute">minuto</SelectItem>
                        <SelectItem value="hour">hora</SelectItem>
                        <SelectItem value="day">dia</SelectItem>
                      </SelectContent>
                    </Select>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {!isGupshupInstance ? (
            <div className="space-y-2">
              <Label>Tipo de disparo</Label>
              <Tabs
                value={stepForm.content_mode}
                onValueChange={(value) =>
                  onStepFormChange((previous) => ({
                    ...previous,
                    content_mode: value as AutomationStepContentMode,
                  }))
                }
              >
                <TabsList className="grid h-10 w-full max-w-xs grid-cols-2 bg-[var(--color-surface-2)] p-1">
                  <TabsTrigger value="text">Texto</TabsTrigger>
                  <TabsTrigger value="media">Mídia</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          ) : null}

          {!isGupshupInstance ? (
            stepForm.content_mode === "text" || isRbJourney ? (
            isRbJourney ? (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-2">
                  <Label
                    htmlFor="step-message"
                    className="text-[var(--color-gray-600)]"
                  >
                    Mensagem
                  </Label>
                  <Textarea
                    id="step-message"
                    rows={8}
                    value={stepForm.message_template}
                    onChange={(event) =>
                      onStepFormChange((previous) => ({
                        ...previous,
                        message_template: event.target.value,
                      }))
                    }
                    placeholder="Oi {nome}, sigo por aqui para continuar o atendimento."
                    className="min-h-[210px] resize-none border-[var(--border-input)] bg-[var(--color-surface-1)] text-[var(--color-gray-900)] placeholder:text-[var(--color-gray-500)]"
                  />
                  <p className="text-xs text-[var(--color-gray-500)]">
                    Use os campos mapeados ao lado para montar a mensagem sem
                    risco de variar nomes de variaveis.
                  </p>
                </div>

                <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--color-surface-2)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-gray-900)]">
                        Variaveis disponiveis
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-gray-600)]">
                        Mapeamento visual dos campos aceitos nesta jornada.
                        Ainda nao ha arrastar e soltar.
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="border-[var(--border-default)] bg-[var(--color-surface-1)]"
                    >
                      Mapeado
                    </Badge>
                  </div>

                  <div className="mt-4 space-y-2">
                    {RB_MESSAGE_VARIABLES.map((variable) => (
                      <div
                        key={variable.token}
                        className="rounded-xl border border-[var(--border-default)] bg-[var(--color-surface-1)] px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <code className="text-xs font-semibold text-[var(--color-primary-700)]">
                            {variable.token}
                          </code>
                          <span className="text-[11px] font-medium text-[var(--color-gray-500)]">
                            {variable.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--color-gray-600)]">
                          {variable.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label
                  htmlFor="step-message"
                  className="text-[var(--color-gray-600)]"
                >
                  Mensagem
                </Label>
                <Textarea
                  id="step-message"
                  rows={8}
                  value={stepForm.message_template}
                  onChange={(event) =>
                    onStepFormChange((previous) => ({
                      ...previous,
                      message_template: event.target.value,
                    }))
                  }
                  placeholder="Oi {nome}, sigo por aqui para continuar o atendimento."
                  className="min-h-[210px] resize-none border-[var(--border-input)] bg-[var(--color-surface-1)] text-[var(--color-gray-900)] placeholder:text-[var(--color-gray-500)]"
                />
              </div>
            )
          ) : (
            <div className="space-y-5 border-t border-[var(--border-default)] pt-4">
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
                <div className="space-y-2">
                  <Label
                    htmlFor="automation-media-file"
                    className="text-[var(--color-gray-600)]"
                  >
                    Arquivo do computador
                  </Label>
                  <Input
                    id="automation-media-file"
                    type="file"
                    accept="image/*,application/pdf"
                    disabled={!instanceName.trim()}
                    onChange={(event) => {
                      const nextFile = event.target.files?.[0] ?? null;
                      onPendingMediaFileChange(nextFile);

                      if (!nextFile) {
                        return;
                      }

                      const inferredKind = inferMediaKindFromFile(nextFile);
                      onStepFormChange((previous) => ({
                        ...previous,
                        media_asset_id: "",
                        media_kind: inferredKind ?? previous.media_kind,
                      }));
                    }}
                    className="border-[var(--border-input)] bg-[var(--color-surface-1)] text-[var(--color-gray-900)] file:mr-4 file:rounded-md file:border-0 file:bg-[var(--color-surface-2)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--color-gray-700)]"
                  />
                  {pendingMediaFile ? (
                    <p className="text-xs text-[var(--color-gray-600)]">
                      {pendingMediaFile.name} -{" "}
                      {stepForm.media_kind === "document" ? "PDF" : "Imagem"}
                    </p>
                  ) : null}
                  {!instanceName.trim() ? (
                    <p className="text-xs text-amber-600">
                      Selecione a instancia da jornada antes de enviar a midia.
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label className="text-[var(--color-gray-600)]">Tipo</Label>
                  <Input
                    value={
                      stepForm.media_kind === "document" ? "PDF" : "Imagem"
                    }
                    disabled
                    className="border-[var(--border-input)] bg-[var(--color-surface-2)] text-[var(--color-gray-700)]"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-[var(--color-gray-600)]">
                  Ou reutilize um arquivo desta instancia
                </Label>
                <Select
                  value={stepForm.media_asset_id}
                  disabled={
                    !instanceName.trim() ||
                    mediaAssetsLoading ||
                    mediaAssets.length === 0
                  }
                  onValueChange={(value) => {
                    const asset = mediaAssets.find((item) => item.id === value);
                    onPendingMediaFileChange(null);
                    onStepFormChange((previous) => ({
                      ...previous,
                      media_asset_id: value,
                      media_kind: asset?.media_kind ?? previous.media_kind,
                      media_caption:
                        previous.media_caption || asset?.default_caption || "",
                    }));
                  }}
                >
                  <SelectTrigger className="border-[var(--border-input)] bg-[var(--color-surface-1)] text-[var(--color-gray-900)]">
                    <SelectValue
                      placeholder={
                        mediaAssetsLoading
                          ? "Carregando arquivos..."
                          : "Selecione imagem ou PDF ja enviado"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {mediaAssets.filter((asset) => asset.media_kind !== "video").map((asset) => (
                      <SelectItem key={asset.id} value={asset.id}>
                        {asset.media_kind === "image" ? "Imagem" : "PDF"} -{" "}
                        {asset.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedMediaAsset ? (
                  <p className="text-xs text-[var(--color-gray-500)]">
                    Arquivo salvo para a instancia{" "}
                    {selectedMediaAsset.instance_name}
                  </p>
                ) : mediaAssets.length === 0 &&
                  !mediaAssetsLoading &&
                  instanceName.trim() ? (
                  <p className="text-xs text-[var(--color-gray-500)]">
                    Nenhum arquivo reutilizavel foi enviado ainda para esta
                    instancia.
                  </p>
                ) : null}
                {pendingMediaFile ? (
                  <p className="text-xs text-[var(--color-primary-700)]">
                    O arquivo do computador sera usado ao salvar esta mensagem.
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="media-caption"
                  className="text-[var(--color-gray-600)]"
                >
                  Legenda opcional
                </Label>
                <Textarea
                  id="media-caption"
                  rows={4}
                  value={stepForm.media_caption}
                  onChange={(event) =>
                    onStepFormChange((previous) => ({
                      ...previous,
                      media_caption: event.target.value,
                    }))
                  }
                  placeholder="Oi {nome}, segue o material combinado."
                  className="min-h-[120px] resize-none border-[var(--border-input)] bg-[var(--color-surface-1)] text-[var(--color-gray-900)] placeholder:text-[var(--color-gray-500)]"
                />
              </div>
            </div>
            )
          ) : (
            <Tabs
              value={isRbJourney ? "template" : stepForm.gupshup_mode}
              onValueChange={(value) => changeGupshupMode(value as GupshupMessageMode)}
              className="space-y-5"
            >
              {!isRbJourney ? (
                <TabsList className="grid h-11 w-full grid-cols-2 bg-[var(--color-surface-2)] p-1">
                  <TabsTrigger value="template">Template</TabsTrigger>
                  <TabsTrigger value="followup">Follow-up (24 h)</TabsTrigger>
                </TabsList>
              ) : null}

              <TabsContent value="template" className="mt-0">
                <GupshupTemplatePanel
                  instanceName={instanceName}
                  selectedTemplateId={stepForm.gupshup_template_id}
                  selectedTemplateName={stepForm.gupshup_template_name}
                  parametersText={stepForm.gupshup_template_params_text}
                  onTemplateChange={handleTemplateChange}
                  onParametersTextChange={(parametersText) =>
                    onStepFormChange((previous) => ({
                      ...previous,
                      gupshup_template_params_text: parametersText,
                    }))
                  }
                  mediaEditor={
                    stepForm.content_mode === "media" ? (
                      <AutomationMediaEditor
                        stepForm={stepForm}
                        instanceName={instanceName}
                        mediaAssets={mediaAssets}
                        mediaAssetsLoading={mediaAssetsLoading}
                        pendingMediaFile={pendingMediaFile}
                        allowedKinds={[stepForm.media_kind]}
                        showCaption={false}
                        onStepFormChange={onStepFormChange}
                        onPendingMediaFileChange={onPendingMediaFileChange}
                      />
                    ) : undefined
                  }
                />
              </TabsContent>

              {!isRbJourney ? (
                <TabsContent value="followup" className="mt-0 space-y-5">
                  <div className="flex flex-col gap-3 border-b border-[var(--border-default)] pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="font-semibold text-[var(--color-gray-900)]">Follow-up</h3>
                      <p className="mt-1 text-xs text-[var(--color-gray-500)]">
                        Envia somente se o cliente falou nas últimas 24 horas.
                      </p>
                    </div>
                    <Tabs
                      value={stepForm.content_mode}
                      onValueChange={(value) =>
                        onStepFormChange((previous) => ({
                          ...previous,
                          content_mode: value as AutomationStepContentMode,
                        }))
                      }
                    >
                      <TabsList className="grid h-10 w-56 grid-cols-2 bg-[var(--color-surface-2)] p-1">
                        <TabsTrigger value="text">Texto</TabsTrigger>
                        <TabsTrigger value="media">Mídia</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  {stepForm.content_mode === "text" ? (
                    <div className="space-y-2">
                      <Label htmlFor="step-message">Mensagem</Label>
                      <Textarea
                        id="step-message"
                        rows={6}
                        value={stepForm.message_template}
                        onChange={(event) =>
                          onStepFormChange((previous) => ({
                            ...previous,
                            message_template: event.target.value,
                          }))
                        }
                        placeholder="Oi {nome}, sigo por aqui para continuar o atendimento."
                        className="min-h-[160px] resize-none"
                      />
                    </div>
                  ) : (
                    <AutomationMediaEditor
                      stepForm={stepForm}
                      instanceName={instanceName}
                      mediaAssets={mediaAssets}
                      mediaAssetsLoading={mediaAssetsLoading}
                      pendingMediaFile={pendingMediaFile}
                      allowedKinds={["image", "video", "document"]}
                      showCaption
                      onStepFormChange={onStepFormChange}
                      onPendingMediaFileChange={onPendingMediaFileChange}
                    />
                  )}
                </TabsContent>
              ) : null}
            </Tabs>
          )}

          <div className="border-t border-[var(--border-default)]">
            <div className="flex items-center justify-between gap-4 py-4">
              <div className="min-w-0">
                <p className="font-medium text-[var(--color-gray-900)]">
                  Mensagem ativa
                </p>
              </div>
              <Switch
                checked={stepForm.is_active}
                onCheckedChange={(checked) =>
                  onStepFormChange((previous) => ({
                    ...previous,
                    is_active: checked,
                  }))
                }
              />
            </div>

            <div className="border-t border-[var(--border-default)]/70">
              <div className="flex items-center justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="font-medium text-[var(--color-gray-900)]">
                    Regras adicionais
                  </p>
                </div>
                <Switch
                  checked={stepForm.step_rule_enabled}
                  onCheckedChange={(checked) =>
                    onStepFormChange((previous) => ({
                      ...previous,
                      step_rule_enabled: checked,
                    }))
                  }
                />
              </div>

              {stepForm.step_rule_enabled ? (
                <div className="pb-2">
                  <AutomationConditionComposer
                    title="Regras da mensagem"
                    compact
                    value={stepForm.step_rule}
                    onChange={(nextValue) =>
                      onStepFormChange((previous) => ({
                        ...previous,
                        step_rule: nextValue,
                      }))
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
        </div>

        <DialogFooter className="border-t border-[var(--border-default)] bg-transparent px-6 py-4">
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              {stepForm.id && onDelete ? (
                <Button
                  variant="outline"
                  onClick={onDelete}
                  className="h-10 shadow-none"
                >
                  <Trash2 className="h-4 w-4" />
                  Remover
                </Button>
              ) : null}
              {stepForm.id ? (
                <Button
                  variant="ghost"
                  onClick={onCancelEdit}
                  className="h-10 text-[var(--color-gray-700)]"
                >
                  Cancelar edicao
                </Button>
              ) : null}
            </div>

            <Button
              onClick={onSave}
              disabled={savingStep}
              className="h-10 shadow-none"
            >
              <Save className="h-4 w-4" />
              {savingStep
                ? "Salvando..."
                : journeySaved
                  ? stepForm.id
                    ? "Salvar mensagem"
                    : "Adicionar mensagem"
                  : "Salvar rascunho"}
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
  createJourney: (
    payload: AutomationJourneyPayload,
    initialStepPayload?: AutomationStepPayload | null,
  ) => Promise<AutomationJourney>;
  updateJourney: (
    journeyId: string,
    payload: AutomationJourneyPayload,
  ) => Promise<AutomationJourney>;
  deleteJourney: (journeyId: string) => Promise<void>;
  createStep: (
    journeyId: string,
    payload: AutomationStepPayload,
  ) => Promise<AutomationStep>;
  updateStep: (
    stepId: string,
    journeyId: string,
    payload: AutomationStepPayload,
  ) => Promise<unknown>;
  deleteStep: (stepId: string, journeyId: string) => Promise<unknown>;
  rbEnabledInstanceNames: string[];
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
  rbEnabledInstanceNames,
  showDebugTools = false,
}: AutomationMessageModalProps) {
  const { acesId } = useAuth();
  const [journeyForm, setJourneyForm] = useState<JourneyFormState>(() =>
    buildInitialJourneyForm({
      journey,
      stages,
      preselectedStageId,
      preselectedInstanceName,
    }),
  );
  const [stepForm, setStepForm] = useState<StepFormState>(() =>
    createInitialStepForm(inferRecipeIdFromJourney(journey)),
  );
  const [selectedRecipeId, setSelectedRecipeId] =
    useState<AutomationRecipeId | null>(() =>
      inferRecipeIdFromJourney(journey),
    );
  const [savingJourney, setSavingJourney] = useState(false);
  const [savingStep, setSavingStep] = useState(false);
  const [stepEditorOpen, setStepEditorOpen] = useState(false);
  const [selectedPreviewLeadId, setSelectedPreviewLeadId] = useState("");
  const [activeTab, setActiveTab] = useState("entry");
  const [pendingMediaFile, setPendingMediaFile] = useState<File | null>(null);
  const initializedJourneyKeyRef = useRef("");

  const orderedSteps = useMemo(() => sortStepsForDisplay(steps), [steps]);
  const isGupshupInstance = instances.some(
    (instance) =>
      instance.instancia === journeyForm.instance_name &&
      instance.provider === "gupshup",
  );
  const atendimentoStageId = useMemo(
    () => findAtendimentoStageId(stages),
    [stages],
  );
  const currentStepDelayMinutes =
    stepForm.timing_mode === "now"
      ? 0
      : timeUnitToMinutes(
          Math.max(1, Number(stepForm.delay_value || 1)),
          stepForm.delay_unit,
        );
  const { flow: messageFlow, loading: messageFlowLoading } =
    useAutomationMessageFlow(journeyForm.id, orderedSteps, open);
  const editingStep = useMemo(
    () => orderedSteps.find((step) => step.id === stepForm.id) ?? null,
    [orderedSteps, stepForm.id],
  );
  const humanizedDispatchQuality = useMemo(
    () => getHumanizedDispatchQuality(journeyForm),
    [journeyForm],
  );
  const dailyDispatchQuality = useMemo(
    () => getDailyDispatchQuality(journeyForm),
    [journeyForm],
  );
  const rbEntryAvailable = useMemo(
    () =>
      journeyForm.instance_name.trim().length > 0 &&
      rbEnabledInstanceNames.includes(journeyForm.instance_name),
    [journeyForm.instance_name, rbEnabledInstanceNames],
  );
  const drOculosRbLocked = useMemo(
    () => journeyForm.entry_source === "rb" && acesId === DR_OCULOS_ACES_ID,
    [acesId, journeyForm.entry_source],
  );
  const {
    assets: mediaAssets,
    loading: mediaAssetsLoading,
    refetch: refetchMediaAssets,
  } = useAutomationMediaAssets(
    journeyForm.instance_name || null,
    open && Boolean(journeyForm.instance_name),
  );

  useEffect(() => {
    if (!open) {
      initializedJourneyKeyRef.current = "";
      return;
    }

    const initializationKey = [
      journey?.id ?? "new",
      preselectedStageId ?? "",
      preselectedInstanceName ?? "",
      stages.map((stage) => stage.id).join(","),
    ].join("|");
    if (initializedJourneyKeyRef.current === initializationKey) return;
    initializedJourneyKeyRef.current = initializationKey;

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
    setPendingMediaFile(null);
    setActiveTab("entry");
  }, [journey, open, preselectedInstanceName, preselectedStageId, stages]);

  useEffect(() => {
    if (previewLeads.length === 0) {
      if (selectedPreviewLeadId) {
        setSelectedPreviewLeadId("");
      }
      return;
    }

    if (
      !selectedPreviewLeadId ||
      !previewLeads.some((lead) => lead.id === selectedPreviewLeadId)
    ) {
      setSelectedPreviewLeadId(previewLeads[0].id);
    }
  }, [previewLeads, selectedPreviewLeadId]);

  useEffect(() => {
    if (
      !journeyForm.id &&
      journeyForm.entry_source === "rb" &&
      !rbEntryAvailable
    ) {
      setJourneyForm((previous) => ({
        ...previous,
        entry_source: "conditions",
      }));
    }
  }, [journeyForm.entry_source, journeyForm.id, rbEntryAvailable]);

  useEffect(() => {
    if (journeyForm.entry_source !== "rb") {
      return;
    }

    setStepForm((previous) => ({
      ...previous,
      content_mode: "text",
    }));
  }, [journeyForm.entry_source]);

  useEffect(() => {
    if (!drOculosRbLocked) {
      return;
    }

    setStepForm((previous) => {
      if (
        hasSameStringSelection(
          previous.rb_payment_type_ids,
          DR_OCULOS_RB_PAYMENT_TYPE_IDS,
        )
      ) {
        return previous;
      }

      return {
        ...previous,
        rb_payment_type_ids: [...DR_OCULOS_RB_PAYMENT_TYPE_IDS],
        content_mode: "text",
      };
    });
  }, [drOculosRbLocked]);

  const uploadPendingMediaIfNeeded = async () => {
    if (stepForm.content_mode !== "media" || !pendingMediaFile) {
      return stepForm.media_asset_id;
    }

    if (!journeyForm.instance_name.trim()) {
      throw new Error(
        "Selecione a instancia da automacao antes de enviar a midia",
      );
    }

    const uploadedAsset = await uploadAutomationMediaAsset({
      instanceName: journeyForm.instance_name,
      file: pendingMediaFile,
    });

    await refetchMediaAssets();
    setPendingMediaFile(null);
    setStepForm((previous) => ({
      ...previous,
      media_asset_id: uploadedAsset.id,
      media_kind: uploadedAsset.media_kind,
      media_caption:
        previous.media_caption || uploadedAsset.default_caption || "",
    }));

    return uploadedAsset.id;
  };

  const handleJourneyFieldChange = <K extends keyof JourneyFormState>(
    field: K,
    value: JourneyFormState[K],
  ) => {
    setJourneyForm((previous) => {
      const nextState = {
        ...previous,
        [field]: value,
      };

      if (
        field === "trigger_stage_id" &&
        typeof value === "string" &&
        value.length > 0
      ) {
        nextState.entry_rule = updateDefaultEntryRuleStage(
          previous.entry_rule,
          value,
        );
      }

      if (
        field === "instance_name" &&
        typeof value === "string" &&
        value.length > 0
      ) {
        nextState.entry_rule = updateDefaultEntryRuleInstance(
          previous.entry_rule,
          value,
        );
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

    if (humanizedDispatchQuality.error) {
      toast.error(humanizedDispatchQuality.error);
      return;
    }

    if (dailyDispatchQuality.error) {
      toast.error(dailyDispatchQuality.error);
      return;
    }

    try {
      setSavingJourney(true);
      const dispatchLimitPerHour =
        journeyForm.humanized_dispatch_enabled ||
        (Number.isInteger(journeyForm.dispatch_limit_per_hour) &&
          journeyForm.dispatch_limit_per_hour > 0)
          ? journeyForm.dispatch_limit_per_hour
          : 40;

      const payload: AutomationJourneyPayload = {
        name: journeyForm.name.trim(),
        trigger_stage_id: journeyForm.trigger_stage_id,
        instance_name: journeyForm.instance_name,
        is_active: journeyForm.is_active,
        humanized_dispatch_enabled: journeyForm.humanized_dispatch_enabled,
        dispatch_limit_per_hour: dispatchLimitPerHour,
        humanized_dispatch_window_start: normalizeTimeForDb(
          journeyForm.humanized_dispatch_window_start,
        ),
        humanized_dispatch_window_end: normalizeTimeForDb(
          journeyForm.humanized_dispatch_window_end,
        ),
        daily_dispatch_enabled:
          journeyForm.entry_source === "rb" &&
          journeyForm.daily_dispatch_enabled,
        daily_dispatch_weekends_enabled:
          journeyForm.entry_source === "rb" &&
          journeyForm.daily_dispatch_enabled &&
          journeyForm.daily_dispatch_weekends_enabled,
        daily_dispatch_time:
          journeyForm.entry_source === "rb" &&
          journeyForm.daily_dispatch_enabled
            ? normalizeTimeForDb(journeyForm.daily_dispatch_time)
            : null,
        entry_source: journeyForm.entry_source,
        entry_rule: normalizeRuleNode(
          journeyForm.entry_source === "rb"
            ? createDefaultEntryRule(
                journeyForm.trigger_stage_id,
                journeyForm.instance_name,
              )
            : updateDefaultEntryRuleInstance(
                journeyForm.entry_rule,
                journeyForm.instance_name,
              ),
          createDefaultEntryRule(
            journeyForm.trigger_stage_id,
            journeyForm.instance_name,
          ),
        ),
        exit_rule: normalizeRuleNode(
          journeyForm.exit_rule,
          createDefaultExitRule(),
        ),
        anchor_event: journeyForm.anchor_event,
        reentry_mode: journeyForm.reentry_mode,
        reply_target_stage_id: journeyForm.reply_target_stage_id || null,
        builder_version: 2,
      };

      const isCreatingJourney = !journeyForm.id;
      const shouldCreateInitialStep =
        isCreatingJourney &&
        !stepForm.id &&
        (hasStepContent(stepForm) ||
          (stepForm.content_mode === "media" && pendingMediaFile !== null));

      if (
        isCreatingJourney &&
        journeyForm.is_active &&
        !shouldCreateInitialStep
      ) {
        toast.error("Crie a primeira mensagem antes de ativar a automacao");
        setActiveTab("messages");
        return;
      }

      const initialStepError = shouldCreateInitialStep
        ? getStepContentError(
            stepForm,
            isGupshupInstance,
            pendingMediaFile,
            journeyForm.entry_source,
          )
        : null;
      if (initialStepError) {
        toast.error(initialStepError);
        setActiveTab("messages");
        return;
      }

      if (
        shouldCreateInitialStep &&
        stepForm.timing_mode === "after" &&
        currentStepDelayMinutes < 1
      ) {
        toast.error("Escolha um tempo valido para a primeira mensagem");
        setActiveTab("messages");
        return;
      }

      let initialStepPayload: AutomationStepPayload | null = null;
      if (shouldCreateInitialStep) {
        const resolvedMediaAssetId = await uploadPendingMediaIfNeeded();
        initialStepPayload = buildStepPayload(
          {
            ...stepForm,
            media_asset_id: resolvedMediaAssetId || stepForm.media_asset_id,
          },
          journeyForm.anchor_event,
          journeyForm.entry_source,
          currentStepDelayMinutes,
        );
      }

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
      toast.error("Erro ao salvar automacao", {
        description: getErrorDescription(error),
      });
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
      toast.error("Erro ao remover automacao", {
        description: getErrorDescription(error),
      });
    }
  };

  const handleStepFormChange = (
    updater: (previous: StepFormState) => StepFormState,
  ) => {
    setStepForm((previous) => updater(previous));
  };

  const handleSaveStep = async () => {
    const currentJourneyId = journeyForm.id || journey?.id || null;

    const stepContentError = getStepContentError(
      stepForm,
      isGupshupInstance,
      pendingMediaFile,
      journeyForm.entry_source,
    );
    if (stepContentError) {
      toast.error(stepContentError);
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

      const resolvedMediaAssetId = await uploadPendingMediaIfNeeded();
      const payload = buildStepPayload(
        {
          ...stepForm,
          media_asset_id: resolvedMediaAssetId || stepForm.media_asset_id,
        },
        journeyForm.anchor_event,
        journeyForm.entry_source,
        currentStepDelayMinutes,
      );

      if (stepForm.id) {
        await updateStep(stepForm.id, currentJourneyId, payload);
      } else {
        await createStep(currentJourneyId, payload);
      }

      setStepForm(createInitialStepForm(selectedRecipeId));
      setPendingMediaFile(null);
      setStepEditorOpen(false);
    } catch (error: unknown) {
      toast.error("Erro ao salvar mensagem", {
        description: getErrorDescription(error),
      });
    } finally {
      setSavingStep(false);
    }
  };

  const openNewStepEditor = () => {
    setActiveTab("messages");
    setStepForm(createInitialStepForm(selectedRecipeId));
    setPendingMediaFile(null);
    setStepEditorOpen(true);
  };

  const handleEditStep = (step: AutomationStep) => {
    const delay = minutesToTimeUnit(
      step.delay_minutes === 0 ? 60 : step.delay_minutes,
    );

    setActiveTab("messages");
    setPendingMediaFile(null);
    setStepForm({
      id: step.id,
      label: step.label,
      timing_mode: step.delay_minutes === 0 ? "now" : "after",
      delay_value: String(delay.value),
      delay_unit: delay.unit,
      content_mode: step.content_mode ?? "text",
      message_template: step.message_template ?? "",
      media_asset_id: step.media_asset_id ?? "",
      media_kind: step.media_kind ?? "image",
      media_caption: step.media_caption ?? "",
      gupshup_mode:
        step.gupshup_template_id || step.gupshup_template_name
          ? "template"
          : "followup",
      gupshup_template_id: step.gupshup_template_id ?? "",
      gupshup_template_name: step.gupshup_template_name ?? "",
      gupshup_template_language: step.gupshup_template_language ?? "pt_BR",
      gupshup_template_params_text: formatTemplateParams(
        step.gupshup_template_params,
      ),
      rb_message_kind: step.rb_message_kind ?? "reminder",
      rb_days_offset: String(step.rb_days_offset ?? 2),
      rb_payment_type_ids: step.rb_payment_type_ids ?? [],
      is_active: step.is_active,
      step_rule: step.step_rule
        ? normalizeRuleNode(step.step_rule)
        : createRuleGroup("all", []),
      step_rule_enabled: !!step.step_rule,
    });
    setStepEditorOpen(true);
  };

  const handleCancelStepEdit = () => {
    setStepForm(createInitialStepForm(selectedRecipeId));
    setPendingMediaFile(null);
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
        setPendingMediaFile(null);
        setStepEditorOpen(false);
      }
    } catch (error: unknown) {
      toast.error("Erro ao remover mensagem", {
        description: getErrorDescription(error),
      });
    }
  };

  const handleRunPreview = async () => {
    if (!journeyForm.id || !selectedPreviewLeadId) {
      return;
    }

    try {
      await onRunPreview(selectedPreviewLeadId);
    } catch (error: unknown) {
      toast.error("Erro ao rodar diagnostico", {
        description: getErrorDescription(error),
      });
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
              <DialogDescription className="sr-only">
                Configure a entrada, as mensagens e as regras desta automação.
              </DialogDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleSaveJourney} disabled={savingJourney}>
                <Save className="h-4 w-4" />
                {savingJourney
                  ? "Salvando..."
                  : journeyForm.id
                    ? "Salvar automacao"
                    : "Criar automacao"}
              </Button>
              {journeyForm.id ? (
                <Button variant="outline" onClick={handleDeleteJourney}>
                  <Trash2 className="h-4 w-4" />
                  Remover
                </Button>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-6">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_220px_220px]">
              <div className="space-y-2">
                <Label htmlFor="journey-name">Nome da automacao</Label>
                <Input
                  id="journey-name"
                  value={journeyForm.name}
                  onChange={(event) =>
                    handleJourneyFieldChange("name", event.target.value)
                  }
                  placeholder="Ex: Follow-up atendimento"
                />
              </div>

              <div className="space-y-2">
                <Label>Etapa do Funil</Label>
                <Select
                  value={journeyForm.trigger_stage_id}
                  onValueChange={(value) =>
                    handleJourneyFieldChange("trigger_stage_id", value)
                  }
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
                  onValueChange={(value) =>
                    handleJourneyFieldChange("instance_name", value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a instancia" />
                  </SelectTrigger>
                  <SelectContent>
                    {instances.map((instance) => (
                      <SelectItem
                        key={instance.instancia}
                        value={instance.instancia}
                      >
                        {instance.instancia}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Mover para</Label>
                <Select
                  value={
                    journeyForm.reply_target_stage_id || atendimentoStageId
                  }
                  onValueChange={(value) =>
                    handleJourneyFieldChange("reply_target_stage_id", value)
                  }
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

            {!atendimentoStageId ? (
              <Alert>
                <AlertTitle>Etapa Atendimento nao encontrada</AlertTitle>
                <AlertDescription>
                  Crie uma etapa chamada Atendimento para que a resposta do lead
                  possa encerrar a jornada.
                </AlertDescription>
              </Alert>
            ) : null}

            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="space-y-4"
            >
              <TabsList
                className={`grid h-auto gap-2 bg-transparent p-0 ${showDebugTools ? "grid-cols-3" : "grid-cols-2"}`}
              >
                <TabsTrigger
                  value="entry"
                  className="rounded-xl border bg-card/60 py-3"
                >
                  Entrada
                </TabsTrigger>
                <TabsTrigger
                  value="messages"
                  className="rounded-xl border bg-card/60 py-3"
                >
                  Mensagens
                </TabsTrigger>
                {showDebugTools ? (
                  <TabsTrigger
                    value="debug"
                    className="rounded-xl border bg-card/60 py-3"
                  >
                    Debug
                  </TabsTrigger>
                ) : null}
              </TabsList>

              <TabsContent value="entry" className="space-y-6">
                <div className="space-y-4 rounded-[24px] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-5">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--color-gray-900)]">
                        Quando essa jornada deve entrar
                      </h3>
                      <p className="mt-1 text-sm text-[var(--color-gray-600)]">
                        Escolha como essa jornada comeca.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {[
                        {
                          value: "conditions",
                          label: "Condicoes",
                          disabled: false,
                        },
                        {
                          value: "rb",
                          label: "RB",
                          disabled: !rbEntryAvailable,
                        },
                      ].map((option) => {
                        const selected =
                          journeyForm.entry_source === option.value;

                        return (
                          <button
                            key={option.value}
                            type="button"
                            disabled={option.disabled}
                            onClick={() =>
                              handleJourneyFieldChange(
                                "entry_source",
                                option.value as AutomationJourneyEntrySource,
                              )
                            }
                            className={cn(
                              "rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
                              selected
                                ? "border-[var(--color-primary-500)] bg-[var(--color-primary-50)] text-[var(--color-primary-700)]"
                                : "border-[var(--border-default)] bg-[var(--color-surface-1)] text-[var(--color-gray-700)] hover:border-[var(--color-primary-300)]",
                              option.disabled &&
                                "cursor-not-allowed opacity-50",
                            )}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {journeyForm.entry_source === "rb" ? (
                    <div className="space-y-5">
                      <div className="grid gap-4 md:grid-cols-[180px_140px_minmax(0,1fr)]">
                        <div className="space-y-2">
                          <Label className="text-[var(--color-gray-600)]">
                            Tipo da mensagem RB
                          </Label>
                          <Select
                            value={stepForm.rb_message_kind}
                            onValueChange={(
                              value: AutomationStepRbMessageKind,
                            ) =>
                              handleStepFormChange((previous) => ({
                                ...previous,
                                rb_message_kind: value,
                                content_mode: "text",
                              }))
                            }
                          >
                            <SelectTrigger className="border-[var(--border-input)] bg-[var(--color-surface-1)] text-[var(--color-gray-900)]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="reminder">Lembrete</SelectItem>
                              <SelectItem value="charge">Cobranca</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label
                            htmlFor="rb-days-offset-entry"
                            className="text-[var(--color-gray-600)]"
                          >
                            Dias
                          </Label>
                          <Input
                            id="rb-days-offset-entry"
                            type="number"
                            min={0}
                            value={stepForm.rb_days_offset}
                            onChange={(event) =>
                              handleStepFormChange((previous) => ({
                                ...previous,
                                rb_days_offset: event.target.value,
                                content_mode: "text",
                              }))
                            }
                            className="border-[var(--border-input)] bg-[var(--color-surface-1)] text-[var(--color-gray-900)]"
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
                        <div className="space-y-2">
                          <Label className="text-[var(--color-gray-600)]">
                            Tipo de pagamento
                          </Label>
                          <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--border-input)] bg-[var(--color-surface-1)] p-3 sm:grid-cols-2">
                            {RB_PAYMENT_TYPE_OPTIONS.map((option) => {
                              const checked =
                                stepForm.rb_payment_type_ids.includes(
                                  option.id,
                                );

                              return (
                                <label
                                  key={option.id}
                                  className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-[var(--color-gray-900)]"
                                >
                                  <Checkbox
                                    checked={checked}
                                    disabled={drOculosRbLocked}
                                    onCheckedChange={(nextChecked) =>
                                      handleStepFormChange((previous) => {
                                        const nextIds = nextChecked
                                          ? [
                                              ...new Set([
                                                ...previous.rb_payment_type_ids,
                                                option.id,
                                              ]),
                                            ]
                                          : previous.rb_payment_type_ids.filter(
                                              (item) => item !== option.id,
                                            );

                                        return {
                                          ...previous,
                                          rb_payment_type_ids: nextIds,
                                          content_mode: "text",
                                        };
                                      })
                                    }
                                  />
                                  <span>
                                    {option.id} - {option.label}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {drOculosRbLocked ? (
                          <div className="flex items-end" />
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <AutomationConditionComposer
                      title="Quando essa jornada deve entrar"
                      value={journeyForm.entry_rule}
                      onChange={(nextValue) =>
                        handleJourneyFieldChange("entry_rule", nextValue)
                      }
                      stages={stages}
                      tags={tags}
                      leadSources={leadSources}
                      instances={instances}
                      compact
                    />
                  )}

                  {!rbEntryAvailable ? (
                    <p className="text-xs text-[var(--color-gray-500)]">
                      Selecione uma instancia com RB ativo para usar essa
                      entrada.
                    </p>
                  ) : null}
                </div>

                <div className="max-w-md divide-y divide-border/70">
                  <div className="flex min-h-14 items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Automacao ativa</p>
                    </div>
                    <Switch
                      checked={journeyForm.is_active}
                      onCheckedChange={(checked) =>
                        handleJourneyFieldChange("is_active", checked)
                      }
                    />
                  </div>

                  <div className="flex min-h-14 items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Envio humanizado</p>
                    </div>
                    <Switch
                      checked={journeyForm.humanized_dispatch_enabled}
                      onCheckedChange={(checked) =>
                        handleJourneyFieldChange(
                          "humanized_dispatch_enabled",
                          checked,
                        )
                      }
                    />
                  </div>

                  {journeyForm.humanized_dispatch_enabled ? (
                    <div className="flex flex-col gap-3 py-4">
                      <Label
                        htmlFor="dispatch-limit"
                        className="text-sm font-medium"
                      >
                        Disparos por hora
                      </Label>
                      <div className="flex flex-wrap items-center gap-2">
                        {DISPATCH_LIMIT_PRESETS.map((preset) => {
                          const selected =
                            journeyForm.dispatch_limit_per_hour === preset;

                          return (
                            <button
                              key={preset}
                              type="button"
                              aria-pressed={selected}
                              onClick={() =>
                                handleJourneyFieldChange(
                                  "dispatch_limit_per_hour",
                                  preset,
                                )
                              }
                              className={cn(
                                "h-8 rounded-md border px-3 text-sm font-medium transition-colors",
                                selected
                                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-foreground"
                                  : "border-border/70 text-muted-foreground hover:border-foreground/25 hover:text-foreground",
                              )}
                            >
                              {preset}
                            </button>
                          );
                        })}

                        <Input
                          id="dispatch-limit"
                          type="number"
                          min={1}
                          max={MAX_HUMANIZED_DISPATCH_LIMIT_PER_HOUR}
                          step={1}
                          className="h-8 w-24 text-sm"
                          value={journeyForm.dispatch_limit_per_hour}
                          onChange={(event) =>
                            handleJourneyFieldChange(
                              "dispatch_limit_per_hour",
                              event.target.value === ""
                                ? 0
                                : Number(event.target.value),
                            )
                          }
                        />
                      </div>
                    </div>
                  ) : null}

                  {journeyForm.humanized_dispatch_enabled ? (
                    <div className="flex min-h-14 items-center justify-between gap-4 py-3">
                      <Label
                        htmlFor="dispatch-window-start"
                        className="text-sm font-medium"
                      >
                        Inicio do disparo
                      </Label>
                      <Input
                        id="dispatch-window-start"
                        type="time"
                        step={60}
                        className="h-9 w-32"
                        value={journeyForm.humanized_dispatch_window_start}
                        onChange={(event) =>
                          handleJourneyFieldChange(
                            "humanized_dispatch_window_start",
                            event.target.value,
                          )
                        }
                      />
                    </div>
                  ) : null}

                  {journeyForm.humanized_dispatch_enabled ? (
                    <div className="flex min-h-14 items-center justify-between gap-4 py-3">
                      <Label
                        htmlFor="dispatch-window-end"
                        className="text-sm font-medium"
                      >
                        Horario limite
                      </Label>
                      <Input
                        id="dispatch-window-end"
                        type="time"
                        step={60}
                        className="h-9 w-32"
                        value={journeyForm.humanized_dispatch_window_end}
                        onChange={(event) =>
                          handleJourneyFieldChange(
                            "humanized_dispatch_window_end",
                            event.target.value,
                          )
                        }
                      />
                    </div>
                  ) : null}

                  {journeyForm.entry_source === "rb" ? (
                    <div className="flex min-h-14 items-center justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Disparo diario</p>
                      </div>
                      <Switch
                        checked={journeyForm.daily_dispatch_enabled}
                        onCheckedChange={(checked) =>
                          handleJourneyFieldChange(
                            "daily_dispatch_enabled",
                            checked,
                          )
                        }
                      />
                    </div>
                  ) : null}

                  {journeyForm.entry_source === "rb" &&
                  journeyForm.daily_dispatch_enabled ? (
                    <div className="space-y-3 py-3">
                      <div className="flex min-h-14 items-center justify-between gap-4">
                        <Label
                          htmlFor="daily-dispatch-time"
                          className="text-sm font-medium"
                        >
                          Horario do disparo
                        </Label>
                        <Input
                          id="daily-dispatch-time"
                          type="time"
                          step={60}
                          className="h-9 w-32"
                          value={journeyForm.daily_dispatch_time}
                          onChange={(event) =>
                            handleJourneyFieldChange(
                              "daily_dispatch_time",
                              event.target.value,
                            )
                          }
                        />
                      </div>

                      <label
                        htmlFor="daily-dispatch-weekends"
                        className="flex cursor-pointer items-center gap-2 pl-0.5 text-sm text-muted-foreground"
                      >
                        <Checkbox
                          id="daily-dispatch-weekends"
                          checked={journeyForm.daily_dispatch_weekends_enabled}
                          onCheckedChange={(checked) =>
                            handleJourneyFieldChange(
                              "daily_dispatch_weekends_enabled",
                              checked === true,
                            )
                          }
                        />
                        <span>Disparar fim de semana</span>
                      </label>
                    </div>
                  ) : null}
                </div>

                {journeyForm.humanized_dispatch_enabled &&
                humanizedDispatchQuality.warnings.length > 0 ? (
                  <div className="max-w-md space-y-1 pt-1 text-xs text-amber-300/90">
                    {humanizedDispatchQuality.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                ) : null}
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
                        {journeyForm.entry_source === "rb"
                          ? journeyForm.id
                            ? `${messageFlow.activeLeadsCount} leads ativos nesta jornada de cobranca RB.`
                            : "Defina a primeira mensagem RB para que o worker saiba quais titulos devem entrar nesta etapa."
                          : journeyForm.id
                            ? `${messageFlow.activeLeadsCount} leads ativos nesta jornada.`
                            : "Monte a primeira mensagem e salve a automacao para distribuir os leads no fluxo."}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {orderedSteps.length} mensagens
                      </Badge>
                      {journeyForm.id ? (
                        <Badge variant="outline">
                          {messageFlow.parkedCount} no fim
                        </Badge>
                      ) : null}
                      <Button
                        onClick={
                          journeyForm.id
                            ? openNewStepEditor
                            : () => setStepEditorOpen(true)
                        }
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
                        title={
                          stepForm.label.trim() ||
                          buildStepLabel(
                            stepForm,
                            journeyForm.anchor_event,
                            journeyForm.entry_source,
                          )
                        }
                        preview={getStepFormPreview(stepForm)}
                        timingLabel={formatTimingSummary(
                          currentStepDelayMinutes,
                          journeyForm.anchor_event,
                        )}
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
                        const isHighlighted =
                          messageFlow.highlightedStepIds.includes(step.id);

                        return (
                          <div
                            key={step.id}
                            className="flex items-center gap-3"
                          >
                            <AutomationMessageStepCard
                              title={
                                step.label.trim() || `Mensagem ${index + 1}`
                              }
                              preview={getAutomationStepPreview(step)}
                              timingLabel={formatDelayLabel(
                                step.delay_minutes,
                                journeyForm.anchor_event,
                              )}
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
                              "group flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--color-surface-1)] text-sm font-semibold text-[var(--color-primary-600)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary-300)] hover:shadow-md",
                              messageFlow.parkedCount > 0 &&
                                "border-[var(--color-primary-500)] bg-[var(--color-primary-50)]",
                            )}
                            title="Criar nova mensagem"
                          >
                            {messageFlow.parkedCount}
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
                  entrySource={journeyForm.entry_source}
                  journeySaved={Boolean(journeyForm.id)}
                  savingStep={savingStep}
                  onStepFormChange={handleStepFormChange}
                  onSave={handleSaveStep}
                  onCancelEdit={handleCancelStepEdit}
                  onDelete={
                    editingStep ? () => handleDeleteStep(editingStep) : null
                  }
                  stages={stages}
                  tags={tags}
                  instances={instances}
                  leadSources={leadSources}
                  instanceName={journeyForm.instance_name}
                  mediaAssets={mediaAssets}
                  mediaAssetsLoading={mediaAssetsLoading}
                  pendingMediaFile={pendingMediaFile}
                  onPendingMediaFileChange={setPendingMediaFile}
                />
              </TabsContent>

              {showDebugTools ? (
                <TabsContent value="debug" className="space-y-6">
                  <Alert>
                    <AlertTitle>Area interna</AlertTitle>
                    <AlertDescription>
                      Esse modo mostra o builder tecnico e o diagnostico visual
                      do motor.
                    </AlertDescription>
                  </Alert>

                  <AutomationRuleBuilder
                    title="Regra de entrada"
                    description=""
                    value={journeyForm.entry_rule}
                    onChange={(nextValue) =>
                      handleJourneyFieldChange("entry_rule", nextValue)
                    }
                    stages={stages}
                    owners={owners}
                    tags={tags}
                    instances={instances}
                  />

                  <AutomationRuleBuilder
                    title="Regra de saida"
                    description=""
                    value={journeyForm.exit_rule}
                    onChange={(nextValue) =>
                      handleJourneyFieldChange("exit_rule", nextValue)
                    }
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
