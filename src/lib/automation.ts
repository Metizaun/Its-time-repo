import type { Instance } from "@/hooks/useInstances";
import type { PipelineStage } from "@/types";

export type AutomationRuleGroupOperator = "all" | "any";
export type AutomationAnchorEvent = "stage_entered_at" | "last_outbound" | "last_inbound";
export type AutomationReentryMode = "restart_on_match" | "ignore_if_active" | "allow_parallel";
export type AutomationMessageDirection = "inbound" | "outbound";
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

export interface AutomationPredicateCatalogItem {
  predicate: AutomationPredicateName;
  label: string;
  description: string;
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

export const AUTOMATION_PREDICATE_CATALOG: AutomationPredicateCatalogItem[] = [
  {
    predicate: "stage_is",
    label: "Etapa e exatamente",
    description: "Verifica se o lead esta na etapa selecionada.",
    input: "stage",
  },
  {
    predicate: "stage_in",
    label: "Etapa esta na lista",
    description: "Permite validar mais de uma etapa ao mesmo tempo.",
    input: "stage-multi",
  },
  {
    predicate: "days_in_stage_gte",
    label: "Dias na etapa maior ou igual",
    description: "Calcula quanto tempo o lead esta parado na etapa atual.",
    input: "number",
  },
  {
    predicate: "last_message_direction_is",
    label: "Ultima mensagem foi",
    description: "Olha apenas para inbound ou outbound.",
    input: "direction",
  },
  {
    predicate: "hours_since_last_outbound_gte",
    label: "Horas desde ultimo outbound",
    description: "Ideal para follow-up ancorado na ultima mensagem enviada.",
    input: "number",
  },
  {
    predicate: "hours_since_last_inbound_gte",
    label: "Horas desde ultimo inbound",
    description: "Ideal para nutricao ancorada na ultima resposta do lead.",
    input: "number",
  },
  {
    predicate: "no_inbound_since_anchor",
    label: "Nao houve inbound desde a ancora",
    description: "Confirma que o lead ainda nao respondeu desde o evento ancora.",
    input: "none",
  },
  {
    predicate: "lead_replied",
    label: "Lead respondeu",
    description: "Detecta resposta inbound apos a ancora da jornada.",
    input: "none",
  },
  {
    predicate: "tag_has",
    label: "Lead possui tag",
    description: "Valida a ultima tag conhecida do lead.",
    input: "tag",
  },
  {
    predicate: "owner_is",
    label: "Responsavel e",
    description: "Filtra por usuario responsavel pelo lead.",
    input: "owner",
  },
  {
    predicate: "instance_is",
    label: "Instancia e",
    description: "Garante que a jornada use a instancia esperada.",
    input: "instance",
  },
  {
    predicate: "status_is",
    label: "Status textual e",
    description: "Usa o campo status atual do lead.",
    input: "text",
  },
  {
    predicate: "lead_visible_is_true",
    label: "Lead visivel",
    description: "Ignora leads ocultos no CRM.",
    input: "none",
  },
];

export const AUTOMATION_ANCHOR_EVENT_OPTIONS: Array<{ value: AutomationAnchorEvent; label: string }> = [
  { value: "stage_entered_at", label: "Entrada na etapa" },
  { value: "last_outbound", label: "Ultimo outbound" },
  { value: "last_inbound", label: "Ultimo inbound" },
];

export const AUTOMATION_REENTRY_MODE_OPTIONS: Array<{ value: AutomationReentryMode; label: string }> = [
  { value: "restart_on_match", label: "Reiniciar relogio" },
  { value: "ignore_if_active", label: "Ignorar se ja estiver ativa" },
  { value: "allow_parallel", label: "Permitir paralelas" },
];

export const AUTOMATION_DIRECTION_OPTIONS: Array<{ value: AutomationMessageDirection; label: string }> = [
  { value: "outbound", label: "Outbound" },
  { value: "inbound", label: "Inbound" },
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

  if (predicate === "days_in_stage_gte" || predicate === "hours_since_last_outbound_gte" || predicate === "hours_since_last_inbound_gte") {
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

export function createDefaultEntryRule(triggerStageId?: string | null) {
  return createRuleGroup("all", [
    {
      ...createPredicate("stage_is"),
      value: triggerStageId || "",
    },
    createPredicate("lead_visible_is_true"),
  ]);
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
    return String(rawValue);
  }

  if (typeof rawValue === "string" && rawValue.trim().length > 0) {
    return rawValue;
  }

  return "sem valor";
}

function summarizePredicate(predicate: AutomationRulePredicate, lookups: AutomationLookupMaps = {}) {
  switch (predicate.predicate) {
    case "stage_is":
      return `etapa = ${formatPredicateValue(predicate, lookups)}`;
    case "stage_in":
      return `etapa em ${formatPredicateValue(predicate, lookups)}`;
    case "days_in_stage_gte":
      return `dias na etapa >= ${formatPredicateValue(predicate, lookups)}`;
    case "last_message_direction_is":
      return `ultima direcao = ${formatPredicateValue(predicate, lookups)}`;
    case "hours_since_last_outbound_gte":
      return `horas desde outbound >= ${formatPredicateValue(predicate, lookups)}`;
    case "hours_since_last_inbound_gte":
      return `horas desde inbound >= ${formatPredicateValue(predicate, lookups)}`;
    case "no_inbound_since_anchor":
      return "sem inbound desde a ancora";
    case "lead_replied":
      return "lead respondeu";
    case "tag_has":
      return `tag = ${formatPredicateValue(predicate, lookups)}`;
    case "owner_is":
      return `responsavel = ${formatPredicateValue(predicate, lookups)}`;
    case "instance_is":
      return `instancia = ${formatPredicateValue(predicate, lookups)}`;
    case "status_is":
      return `status = ${formatPredicateValue(predicate, lookups)}`;
    case "lead_visible_is_true":
      return "lead visivel";
    default:
      return predicate.predicate;
  }
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
    return summarizePredicate(normalized, lookups);
  }

  const children = normalized.children
    .map((child) => summarizeRuleNode(child, lookups))
    .filter((item) => item && item !== "Sem condicoes extras");

  if (children.length === 0) {
    return "Sem condicoes extras";
  }

  return children.join(normalized.operator === "all" ? " E " : " OU ");
}

export function formatAnchorEventLabel(value: AutomationAnchorEvent) {
  return AUTOMATION_ANCHOR_EVENT_OPTIONS.find((item) => item.value === value)?.label ?? value;
}

export function formatReentryModeLabel(value: AutomationReentryMode) {
  return AUTOMATION_REENTRY_MODE_OPTIONS.find((item) => item.value === value)?.label ?? value;
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
    instances: Object.fromEntries((params.instances || []).map((instance) => [instance.instancia, instance.instancia])),
  };
}

export function cloneRuleNode<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
