import type { Instance } from "@/hooks/useInstances";
import type { PipelineStage } from "@/types";

export type AutomationRuleGroupOperator = "all" | "any";
export type AutomationAnchorEvent = "stage_entered_at" | "last_outbound" | "last_inbound";
export type AutomationReentryMode = "restart_on_match" | "ignore_if_active" | "allow_parallel";
export type AutomationMessageDirection = "inbound" | "outbound";
export type AutomationConditionVisibility = "user" | "internal";
export type AutomationTimeUnit = "minute" | "hour" | "day";
export type AutomationRecipeId =
  | "follow_up_last_message"
  | "message_after_stage_time"
  | "nutrition_after_reply";
export type AutomationPredicateCategory = "stage" | "message" | "time" | "lead";
export type AutomationPredicateName =
  | "stage_is"
  | "stage_in"
  | "days_in_stage_gte"
  | "last_message_direction_is"
  | "hours_since_last_outbound_gte"
  | "hours_since_last_inbound_gte"
  | "no_inbound_since_anchor"
  | "lead_replied"
  | "tag_has"
  | "owner_is"
  | "instance_is"
  | "status_is"
  | "lead_visible_is_true";

export interface AutomationRulePredicate {
  id: string;
  type: "predicate";
  predicate: AutomationPredicateName;
  value?: boolean | number | string | null;
  values?: string[];
}

export interface AutomationRuleGroup {
  id: string;
  type: "group";
  operator: AutomationRuleGroupOperator;
  children: AutomationRuleNode[];
}

export type AutomationRuleNode = AutomationRuleGroup | AutomationRulePredicate;

export interface AutomationJourney {
  id: string;
  aces_id: number;
  name: string;
  trigger_stage_id: string;
  instance_name: string;
  is_active: boolean;
  humanized_dispatch_enabled: boolean;
  dispatch_limit_per_hour: number;
  entry_rule: AutomationRuleNode;
  exit_rule: AutomationRuleNode;
  anchor_event: AutomationAnchorEvent;
  reentry_mode: AutomationReentryMode;
  reply_target_stage_id: string | null;
  builder_version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationStep {
  id: string;
  funnel_id: string;
  position: number;
  label: string;
  delay_minutes: number;
  message_template: string;
  channel: "whatsapp";
  is_active: boolean;
  step_rule: AutomationRuleNode | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationExecution {
  id: string;
  aces_id: number;
  funnel_id: string | null;
  step_id: string | null;
  enrollment_id: string | null;
  lead_id: string;
  source_stage_id: string | null;
  scheduled_at: string;
  sent_at: string | null;
  cancelled_at: string | null;
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  rendered_message: string | null;
  dispatch_meta: JsonLike | null;
  phone_snapshot: string | null;
  instance_snapshot: string | null;
  lead_name_snapshot: string | null;
  city_snapshot: string | null;
  status_snapshot: string | null;
  funnel_name_snapshot: string | null;
  step_label_snapshot: string | null;
  step_rule_snapshot: AutomationRuleNode | null;
  anchor_at_snapshot: string | null;
  last_error: string | null;
  completed_reason: string | null;
  claimed_by: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

export type JsonLike =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonLike | undefined }
  | JsonLike[];

export interface AutomationEnrollment {
  id: string;
  aces_id: number;
  funnel_id: string;
  lead_id: string;
  status: "active" | "completed" | "cancelled" | "failed";
  anchor_event: AutomationAnchorEvent;
  anchor_at: string;
  anchor_message_id: string | null;
  current_stage_id: string | null;
  reply_target_stage_id: string | null;
  stopped_reason: string | null;
  restarted_count: number;
  last_evaluated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationPreviewTreeNode {
  matched: boolean;
  type: "group" | "predicate";
  label: string;
  predicate?: AutomationPredicateName;
  operator?: AutomationRuleGroupOperator;
  expected?: boolean | number | string | null;
  actual?: boolean | number | string | null;
  children?: AutomationPreviewTreeNode[];
}

export interface AutomationPreviewResult {
  lead_id: string;
  funnel_id: string;
  anchor_at: string | null;
  anchor_event: AutomationAnchorEvent;
  reply_target_stage_id: string | null;
  entry_rule: AutomationPreviewTreeNode;
  exit_rule: AutomationPreviewTreeNode;
  steps: Array<{
    id: string;
    label: string;
    delay_minutes: number;
    rule: AutomationPreviewTreeNode | null;
    scheduled_at: string | null;
  }>;
}

export interface AutomationOwnerOption {
  id: string;
  name: string;
}

export interface AutomationTagOption {
  id: string;
  name: string;
  urgencia: number | null;
}

export interface AutomationLookupMaps {
  stages?: Record<string, string>;
  owners?: Record<string, string>;
  tags?: Record<string, string>;
  instances?: Record<string, string>;
}

export interface AutomationConditionCopy {
  shortLabel: string;
  sentenceLabel: string;
  description: string;
}

export interface AutomationPredicateCatalogItem {
  predicate: AutomationPredicateName;
  label: string;
  shortLabel: string;
  sentenceLabel: string;
  description: string;
  category: AutomationPredicateCategory;
  visibility: AutomationConditionVisibility;
  input:
    | "none"
    | "text"
    | "number"
    | "boolean"
    | "stage"
    | "stage-multi"
    | "direction"
    | "owner"
    | "tag"
    | "instance";
}

export interface AutomationRecipe {
  id: AutomationRecipeId;
  title: string;
  description: string;
  anchor_event: AutomationAnchorEvent;
  reentry_mode: AutomationReentryMode;
  suggested_step: {
    label: string;
    delay_minutes: number;
    message_template: string;
  };
}

export interface AutomationComposerAnalysis {
  supported: boolean;
  reason: string | null;
  operator: AutomationRuleGroupOperator;
  visibleConditions: AutomationRulePredicate[];
  preservedConditions: AutomationRulePredicate[];
}

const USER_VISIBLE_PREDICATES: AutomationPredicateName[] = [
  "stage_is",
  "stage_in",
  "days_in_stage_gte",
  "hours_since_last_outbound_gte",
  "hours_since_last_inbound_gte",
  "no_inbound_since_anchor",
  "lead_replied",
  "tag_has",
  "instance_is",
];

const SIMPLE_HIDDEN_PREDICATES: AutomationPredicateName[] = ["lead_visible_is_true"];

export const AUTOMATION_PREDICATE_CATALOG: AutomationPredicateCatalogItem[] = [
  {
    predicate: "stage_is",
    label: "Lead esta na etapa",
    shortLabel: "Lead na etapa",
    sentenceLabel: "Lead esta na etapa",
    description: "Use para escolher a etapa atual do lead.",
    category: "stage",
    visibility: "user",
    input: "stage",
  },
  {
    predicate: "stage_in",
    label: "Lead esta em uma destas etapas",
    shortLabel: "Lead em etapas",
    sentenceLabel: "Lead esta em uma destas etapas",
    description: "Use quando a jornada vale para mais de uma etapa.",
    category: "stage",
    visibility: "user",
    input: "stage-multi",
  },
  {
    predicate: "days_in_stage_gte",
    label: "Lead esta nessa etapa ha pelo menos",
    shortLabel: "Tempo na etapa",
    sentenceLabel: "Lead esta nessa etapa ha pelo menos",
    description: "Bom para rotinas de retomada por tempo parado na etapa.",
    category: "time",
    visibility: "user",
    input: "number",
  },
  {
    predicate: "last_message_direction_is",
    label: "Ultima direcao da conversa",
    shortLabel: "Direcao da conversa",
    sentenceLabel: "Ultima direcao da conversa",
    description: "Predicado tecnico usado pelo motor.",
    category: "message",
    visibility: "internal",
    input: "direction",
  },
  {
    predicate: "hours_since_last_outbound_gte",
    label: "Minha ultima mensagem foi ha pelo menos",
    shortLabel: "Minha ultima mensagem",
    sentenceLabel: "Minha ultima mensagem foi ha pelo menos",
    description: "Use para follow-up apos a ultima mensagem enviada.",
    category: "time",
    visibility: "user",
    input: "number",
  },
  {
    predicate: "hours_since_last_inbound_gte",
    label: "Ultima resposta do lead foi ha pelo menos",
    shortLabel: "Ultima resposta do lead",
    sentenceLabel: "Ultima resposta do lead foi ha pelo menos",
    description: "Use para nutricao apos a ultima resposta do lead.",
    category: "time",
    visibility: "user",
    input: "number",
  },
  {
    predicate: "no_inbound_since_anchor",
    label: "O lead ainda nao respondeu",
    shortLabel: "Sem resposta do lead",
    sentenceLabel: "O lead ainda nao respondeu",
    description: "Confirma que ainda nao houve resposta do lead.",
    category: "message",
    visibility: "user",
    input: "none",
  },
  {
    predicate: "lead_replied",
    label: "O lead respondeu",
    shortLabel: "Lead respondeu",
    sentenceLabel: "O lead respondeu",
    description: "Usado para encerrar ou desviar a automacao.",
    category: "message",
    visibility: "user",
    input: "none",
  },
  {
    predicate: "tag_has",
    label: "Lead possui a tag",
    shortLabel: "Tag do lead",
    sentenceLabel: "Lead possui a tag",
    description: "Filtra a jornada por tag.",
    category: "lead",
    visibility: "user",
    input: "tag",
  },
  {
    predicate: "owner_is",
    label: "Responsavel do lead",
    shortLabel: "Responsavel",
    sentenceLabel: "Responsavel do lead",
    description: "Predicado tecnico usado pelo motor.",
    category: "lead",
    visibility: "internal",
    input: "owner",
  },
  {
    predicate: "instance_is",
    label: "Instancia do lead",
    shortLabel: "Instancia",
    sentenceLabel: "Instancia do lead",
    description: "Limita a automacao aos leads dessa instancia.",
    category: "lead",
    visibility: "user",
    input: "instance",
  },
  {
    predicate: "status_is",
    label: "Status do lead",
    shortLabel: "Status do lead",
    sentenceLabel: "Status do lead",
    description: "Predicado tecnico usado pelo motor.",
    category: "lead",
    visibility: "internal",
    input: "text",
  },
  {
    predicate: "lead_visible_is_true",
    label: "Lead visivel no CRM",
    shortLabel: "Lead visivel",
    sentenceLabel: "Lead visivel no CRM",
    description: "Protecao tecnica usada pelo motor.",
    category: "lead",
    visibility: "internal",
    input: "none",
  },
];

export const AUTOMATION_ANCHOR_EVENT_OPTIONS: Array<{ value: AutomationAnchorEvent; label: string }> = [
  { value: "stage_entered_at", label: "Entrar na etapa" },
  { value: "last_outbound", label: "Minha ultima mensagem" },
  { value: "last_inbound", label: "Ultima resposta do lead" },
];

export const AUTOMATION_REENTRY_MODE_OPTIONS: Array<{ value: AutomationReentryMode; label: string }> = [
  { value: "restart_on_match", label: "Reiniciar o prazo" },
  { value: "ignore_if_active", label: "Manter a automacao atual" },
  { value: "allow_parallel", label: "Criar outra automacao" },
];

export const AUTOMATION_DIRECTION_OPTIONS: Array<{ value: AutomationMessageDirection; label: string }> = [
  { value: "outbound", label: "Minha mensagem" },
  { value: "inbound", label: "Resposta do lead" },
];

export const AUTOMATION_TIME_UNIT_OPTIONS: Array<{ value: AutomationTimeUnit; label: string }> = [
  { value: "minute", label: "min" },
  { value: "hour", label: "hora" },
  { value: "day", label: "dia" },
];

export const AUTOMATION_RECIPES: AutomationRecipe[] = [
  {
    id: "follow_up_last_message",
    title: "Follow-up da minha ultima mensagem",
    description: "Ideal para retomar um contato algumas horas depois da sua ultima mensagem.",
    anchor_event: "last_outbound",
    reentry_mode: "restart_on_match",
    suggested_step: {
      label: "Follow-up",
      delay_minutes: 240,
      message_template: "Oi {nome}, sigo por aqui caso queira continuar o atendimento.",
    },
  },
  {
    id: "message_after_stage_time",
    title: "Mensagem apos tempo na etapa",
    description: "Boa para acionar o lead depois de alguns dias parado na etapa atual.",
    anchor_event: "stage_entered_at",
    reentry_mode: "ignore_if_active",
    suggested_step: {
      label: "Retomada da etapa",
      delay_minutes: 43200,
      message_template: "Oi {nome}, vi que seu atendimento ficou parado por aqui. Quer que eu te ajude a seguir?",
    },
  },
  {
    id: "nutrition_after_reply",
    title: "Nutricao apos resposta do lead",
    description: "Perfeita para continuar a conversa depois da ultima resposta do lead.",
    anchor_event: "last_inbound",
    reentry_mode: "restart_on_match",
    suggested_step: {
      label: "Mensagem de nutricao",
      delay_minutes: 1440,
      message_template: "Oi {nome}, trouxe mais um conteudo que pode te ajudar no proximo passo.",
    },
  },
];

function makeNodeId() {
  return globalThis.crypto?.randomUUID?.() ?? `rule-${Math.random().toString(36).slice(2, 10)}`;
}

function shortValue(value: string) {
  if (value.length <= 10) {
    return value;
  }

  return `${value.slice(0, 8)}...`;
}

function ensureArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function ensureNodeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function isKnownPredicate(value: unknown): value is AutomationPredicateName {
  return AUTOMATION_PREDICATE_CATALOG.some((item) => item.predicate === value);
}

function findPredicateCatalogItem(predicate: AutomationPredicateName) {
  return AUTOMATION_PREDICATE_CATALOG.find((item) => item.predicate === predicate);
}

function isUserVisiblePredicate(predicate: AutomationPredicateName) {
  return USER_VISIBLE_PREDICATES.includes(predicate);
}

function isSimpleHiddenPredicate(predicate: AutomationPredicateName) {
  return SIMPLE_HIDDEN_PREDICATES.includes(predicate);
}

export function createRuleGroup(
  operator: AutomationRuleGroupOperator = "all",
  children: AutomationRuleNode[] = [],
): AutomationRuleGroup {
  return {
    id: makeNodeId(),
    type: "group",
    operator,
    children,
  };
}

export function createPredicate(
  predicate: AutomationPredicateName = "lead_visible_is_true",
): AutomationRulePredicate {
  if (predicate === "stage_in") {
    return {
      id: makeNodeId(),
      type: "predicate",
      predicate,
      values: [],
    };
  }

  if (predicate === "lead_replied" || predicate === "no_inbound_since_anchor" || predicate === "lead_visible_is_true") {
    return {
      id: makeNodeId(),
      type: "predicate",
      predicate,
      value: true,
    };
  }

  if (
    predicate === "days_in_stage_gte" ||
    predicate === "hours_since_last_outbound_gte" ||
    predicate === "hours_since_last_inbound_gte"
  ) {
    return {
      id: makeNodeId(),
      type: "predicate",
      predicate,
      value: 1,
    };
  }

  if (predicate === "last_message_direction_is") {
    return {
      id: makeNodeId(),
      type: "predicate",
      predicate,
      value: "outbound",
    };
  }

  return {
    id: makeNodeId(),
    type: "predicate",
    predicate,
    value: "",
  };
}

export function normalizeRuleNode(input: unknown, fallback?: AutomationRuleNode): AutomationRuleNode {
  if (input && typeof input === "object" && "type" in input) {
    const candidate = input as Partial<AutomationRuleNode>;

    if (candidate.type === "group") {
      return {
        id: typeof candidate.id === "string" ? candidate.id : makeNodeId(),
        type: "group",
        operator: candidate.operator === "any" ? "any" : "all",
        children: ensureNodeArray((candidate as { children?: unknown }).children).map((child) =>
          normalizeRuleNode(child),
        ),
      };
    }

    if (candidate.type === "predicate" && isKnownPredicate(candidate.predicate)) {
      return {
        id: typeof candidate.id === "string" ? candidate.id : makeNodeId(),
        type: "predicate",
        predicate: candidate.predicate,
        value:
          typeof candidate.value === "string" ||
          typeof candidate.value === "number" ||
          typeof candidate.value === "boolean" ||
          candidate.value === null
            ? candidate.value
            : undefined,
        values: ensureArray(candidate.values),
      };
    }
  }

  if (fallback) {
    return normalizeRuleNode(fallback);
  }

  return createRuleGroup("all", []);
}

function createInstancePredicate(instanceName?: string | null) {
  return {
    ...createPredicate("instance_is"),
    value: instanceName || "",
  };
}

export function createDefaultEntryRule(triggerStageId?: string | null, instanceName?: string | null) {
  const children: AutomationRuleNode[] = [
    {
      ...createPredicate("stage_is"),
      value: triggerStageId || "",
    },
  ];

  if (instanceName) {
    children.push(createInstancePredicate(instanceName));
  }

  children.push(createPredicate("lead_visible_is_true"));

  return createRuleGroup("all", children);
}

export function createDefaultExitRule() {
  return createRuleGroup("any", [createPredicate("lead_replied")]);
}

export function updateDefaultEntryRuleStage(rule: AutomationRuleNode, triggerStageId: string) {
  const normalized = normalizeRuleNode(rule, createDefaultEntryRule(triggerStageId));

  if (normalized.type !== "group" || normalized.children.length === 0) {
    return createDefaultEntryRule(triggerStageId);
  }

  const nextChildren = normalized.children.map((child, index) => {
    if (index !== 0 || child.type !== "predicate" || child.predicate !== "stage_is") {
      return child;
    }

    return {
      ...child,
      value: triggerStageId,
    };
  });

  return {
    ...normalized,
    children: nextChildren,
  };
}

export function updateDefaultEntryRuleInstance(rule: AutomationRuleNode, instanceName: string) {
  const normalized = normalizeRuleNode(rule);

  if (normalized.type !== "group") {
    return createDefaultEntryRule(null, instanceName);
  }

  let foundInstancePredicate = false;
  const nextChildren = normalized.children.map((child) => {
    if (child.type !== "predicate" || child.predicate !== "instance_is") {
      return child;
    }

    foundInstancePredicate = true;
    return {
      ...child,
      value: instanceName,
    };
  });

  if (!foundInstancePredicate) {
    const leadVisibleIndex = nextChildren.findIndex(
      (child) => child.type === "predicate" && child.predicate === "lead_visible_is_true",
    );
    const instancePredicate = createInstancePredicate(instanceName);

    if (leadVisibleIndex >= 0) {
      nextChildren.splice(leadVisibleIndex, 0, instancePredicate);
    } else {
      nextChildren.push(instancePredicate);
    }
  }

  return {
    ...normalized,
    children: nextChildren,
  };
}

export function createJourneyEntryRuleFromRecipe(
  recipeId: AutomationRecipeId,
  stageId?: string | null,
  instanceName?: string | null,
) {
  if (recipeId === "message_after_stage_time") {
    const children: AutomationRuleNode[] = [
      {
        ...createPredicate("stage_is"),
        value: stageId || "",
      },
    ];

    if (instanceName) {
      children.push(createInstancePredicate(instanceName));
    }

    children.push(createPredicate("lead_visible_is_true"));
    return createRuleGroup("all", children);
  }

  if (recipeId === "nutrition_after_reply") {
    const children: AutomationRuleNode[] = [
      {
        ...createPredicate("stage_is"),
        value: stageId || "",
      },
    ];

    if (instanceName) {
      children.push(createInstancePredicate(instanceName));
    }

    children.push(createPredicate("lead_visible_is_true"));
    return createRuleGroup("all", children);
  }

  const children: AutomationRuleNode[] = [
    {
      ...createPredicate("stage_is"),
      value: stageId || "",
    },
  ];

  if (instanceName) {
    children.push(createInstancePredicate(instanceName));
  }

  children.push(createPredicate("lead_visible_is_true"));
  return createRuleGroup("all", children);
}

export function getAutomationRecipeById(recipeId: AutomationRecipeId) {
  return AUTOMATION_RECIPES.find((recipe) => recipe.id === recipeId) ?? AUTOMATION_RECIPES[0];
}

export function isRuleEmpty(rule: AutomationRuleNode | null | undefined): boolean {
  if (!rule) {
    return true;
  }

  const normalized = normalizeRuleNode(rule);
  if (normalized.type === "predicate") {
    if (normalized.predicate === "stage_in") {
      return (normalized.values?.length || 0) === 0;
    }

    return normalized.value === "" || normalized.value === null || typeof normalized.value === "undefined";
  }

  return normalized.children.length === 0 || normalized.children.every((child) => isRuleEmpty(child));
}

export function minutesToTimeUnit(minutes: number): { value: number; unit: AutomationTimeUnit } {
  if (minutes !== 0 && minutes % 1440 === 0) {
    return {
      value: minutes / 1440,
      unit: "day",
    };
  }

  if (minutes !== 0 && minutes % 60 === 0) {
    return {
      value: minutes / 60,
      unit: "hour",
    };
  }

  return {
    value: minutes,
    unit: "minute",
  };
}

export function timeUnitToMinutes(value: number, unit: AutomationTimeUnit) {
  if (unit === "day") {
    return value * 1440;
  }

  if (unit === "hour") {
    return value * 60;
  }

  return value;
}

export function formatTimeValue(value: number, unit: AutomationTimeUnit) {
  if (unit === "day") {
    return `${value} ${value === 1 ? "dia" : "dias"}`;
  }

  if (unit === "hour") {
    return `${value} ${value === 1 ? "hora" : "horas"}`;
  }

  return `${value} ${value === 1 ? "min" : "min"}`;
}

export function formatTimingSummary(delayMinutes: number, anchorEvent: AutomationAnchorEvent) {
  if (delayMinutes === 0) {
    if (anchorEvent === "last_outbound") {
      return "Enviar na hora da minha ultima mensagem";
    }

    if (anchorEvent === "last_inbound") {
      return "Enviar na hora da ultima resposta do lead";
    }

    return "Enviar ao entrar na etapa";
  }

  const timeValue = minutesToTimeUnit(delayMinutes);
  const timeLabel = formatTimeValue(timeValue.value, timeValue.unit);

  if (anchorEvent === "last_outbound") {
    return `Enviar ${timeLabel} depois da minha ultima mensagem`;
  }

  if (anchorEvent === "last_inbound") {
    return `Enviar ${timeLabel} depois da ultima resposta do lead`;
  }

  return `Enviar ${timeLabel} depois de entrar na etapa`;
}

export function analyzeRuleForComposer(rule: AutomationRuleNode | null | undefined): AutomationComposerAnalysis {
  const normalized = normalizeRuleNode(rule, createRuleGroup("all", []));

  if (normalized.type !== "group") {
    return {
      supported: false,
      reason: "Esta automacao usa regras avancadas.",
      operator: "all",
      visibleConditions: [],
      preservedConditions: [],
    };
  }

  const visibleConditions: AutomationRulePredicate[] = [];
  const preservedConditions: AutomationRulePredicate[] = [];

  for (const child of normalized.children) {
    if (child.type !== "predicate") {
      return {
        supported: false,
        reason: "Esta automacao usa regras avancadas.",
        operator: normalized.operator,
        visibleConditions: [],
        preservedConditions: [],
      };
    }

    if (isUserVisiblePredicate(child.predicate)) {
      visibleConditions.push(child);
      continue;
    }

    if (isSimpleHiddenPredicate(child.predicate)) {
      preservedConditions.push(child);
      continue;
    }

    return {
      supported: false,
      reason: "Esta automacao usa regras avancadas.",
      operator: normalized.operator,
      visibleConditions: [],
      preservedConditions: [],
    };
  }

  return {
    supported: true,
    reason: null,
    operator: normalized.operator,
    visibleConditions,
    preservedConditions,
  };
}

export function buildComposerRule(params: {
  operator: AutomationRuleGroupOperator;
  visibleConditions: AutomationRulePredicate[];
  preservedConditions?: AutomationRulePredicate[];
}) {
  return createRuleGroup(params.operator, [
    ...(params.visibleConditions || []).map((condition) => normalizeRuleNode(condition) as AutomationRulePredicate),
    ...((params.preservedConditions || []).map((condition) => normalizeRuleNode(condition) as AutomationRulePredicate)),
  ]);
}

function formatPredicateValue(
  predicate: AutomationRulePredicate,
  lookups: AutomationLookupMaps = {},
): string {
  if (predicate.predicate === "stage_in") {
    const values = predicate.values || [];
    if (values.length === 0) {
      return "nenhuma etapa";
    }

    return values
      .map((value) => lookups.stages?.[value] ?? shortValue(value))
      .join(", ");
  }

  const rawValue = predicate.value;
  if (predicate.predicate === "stage_is" && typeof rawValue === "string") {
    return lookups.stages?.[rawValue] ?? shortValue(rawValue);
  }

  if (predicate.predicate === "owner_is" && typeof rawValue === "string") {
    return lookups.owners?.[rawValue] ?? shortValue(rawValue);
  }

  if (predicate.predicate === "tag_has" && typeof rawValue === "string") {
    return lookups.tags?.[rawValue] ?? rawValue;
  }

  if (predicate.predicate === "instance_is" && typeof rawValue === "string") {
    return lookups.instances?.[rawValue] ?? rawValue;
  }

  if (typeof rawValue === "boolean") {
    return rawValue ? "sim" : "nao";
  }

  if (typeof rawValue === "number") {
    if (predicate.predicate === "days_in_stage_gte") {
      return formatTimeValue(rawValue, "day");
    }

    if (
      predicate.predicate === "hours_since_last_outbound_gte" ||
      predicate.predicate === "hours_since_last_inbound_gte"
    ) {
      return formatTimeValue(rawValue, "hour");
    }

    return String(rawValue);
  }

  if (typeof rawValue === "string" && rawValue.trim().length > 0) {
    return rawValue;
  }

  return "sem valor";
}

function summarizePredicate(predicate: AutomationRulePredicate, lookups: AutomationLookupMaps = {}) {
  if (predicate.predicate === "lead_visible_is_true") {
    return "";
  }

  const catalogItem = findPredicateCatalogItem(predicate.predicate);
  if (!catalogItem) {
    return predicate.predicate;
  }

  if (catalogItem.input === "none") {
    return catalogItem.shortLabel;
  }

  return `${catalogItem.sentenceLabel} ${formatPredicateValue(predicate, lookups)}`;
}

export function summarizeRuleNode(
  rule: AutomationRuleNode | null | undefined,
  lookups: AutomationLookupMaps = {},
): string {
  if (!rule || isRuleEmpty(rule)) {
    return "Sem condicoes extras";
  }

  const normalized = normalizeRuleNode(rule);
  if (normalized.type === "predicate") {
    return summarizePredicate(normalized, lookups) || "Sem condicoes extras";
  }

  const children = normalized.children
    .map((child) => summarizeRuleNode(child, lookups))
    .filter((item) => item && item !== "Sem condicoes extras");

  if (children.length === 0) {
    return "Sem condicoes extras";
  }

  return children.join(normalized.operator === "all" ? " e " : " ou ");
}

export function formatAnchorEventLabel(value: AutomationAnchorEvent) {
  return AUTOMATION_ANCHOR_EVENT_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

export function formatReentryModeLabel(value: AutomationReentryMode) {
  return AUTOMATION_REENTRY_MODE_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

export function getUserVisiblePredicateCatalog() {
  return AUTOMATION_PREDICATE_CATALOG.filter((item) => item.visibility === "user");
}

export function buildAutomationLookupMaps(params: {
  stages?: PipelineStage[];
  owners?: AutomationOwnerOption[];
  tags?: AutomationTagOption[];
  instances?: Instance[];
}): AutomationLookupMaps {
  return {
    stages: Object.fromEntries((params.stages || []).map((stage) => [stage.id, stage.name])),
    owners: Object.fromEntries((params.owners || []).map((owner) => [owner.id, owner.name])),
    tags: Object.fromEntries((params.tags || []).map((tag) => [tag.id, tag.name])),
    instances: Object.fromEntries(
      (params.instances || []).map((instance) => [instance.instancia, instance.instancia]),
    ),
  };
}

export function cloneRuleNode<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
