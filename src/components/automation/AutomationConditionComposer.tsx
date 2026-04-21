import { Plus, Trash2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  analyzeRuleForComposer,
  buildComposerRule,
  createPredicate,
  getUserVisiblePredicateCatalog,
  type AutomationRuleGroupOperator,
  type AutomationRuleNode,
  type AutomationRulePredicate,
  type AutomationTagOption,
} from "@/lib/automation";
import type { PipelineStage } from "@/types";

const USER_CATALOG = getUserVisiblePredicateCatalog();
const HIDDEN_EXTRA_CONDITION_PREDICATES = new Set<AutomationRulePredicate["predicate"]>(["stage_is", "stage_in"]);
const AVAILABLE_USER_CATALOG = USER_CATALOG.filter(
  (item) => !HIDDEN_EXTRA_CONDITION_PREDICATES.has(item.predicate),
);
const DEFAULT_CONDITION_PREDICATE = AVAILABLE_USER_CATALOG[0]?.predicate ?? "days_in_stage_gte";

function getConditionCatalog(predicate: AutomationRulePredicate["predicate"]) {
  if (!HIDDEN_EXTRA_CONDITION_PREDICATES.has(predicate)) {
    return AVAILABLE_USER_CATALOG;
  }

  const currentDefinition = USER_CATALOG.find((item) => item.predicate === predicate);

  return currentDefinition ? [currentDefinition, ...AVAILABLE_USER_CATALOG] : AVAILABLE_USER_CATALOG;
}

function MultiStageSelector({
  value,
  onChange,
  stages,
}: {
  value: string[];
  onChange: (nextValue: string[]) => void;
  stages: PipelineStage[];
}) {
  const selectedStages = stages.filter((stage) => value.includes(stage.id));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="justify-between">
          <span className="truncate">
            {selectedStages.length > 0
              ? `${selectedStages.length} etapa${selectedStages.length === 1 ? "" : "s"}`
              : "Selecionar etapas"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] space-y-3">
        <div>
          <p className="text-sm font-medium">Etapas</p>
          <p className="text-xs text-muted-foreground">Escolha uma ou mais etapas.</p>
        </div>

        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
          {stages.map((stage) => {
            const checked = value.includes(stage.id);

            return (
              <label
                key={stage.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(nextChecked) => {
                    if (nextChecked) {
                      onChange([...value, stage.id]);
                      return;
                    }

                    onChange(value.filter((stageId) => stageId !== stage.id));
                  }}
                />
                <span className="truncate">{stage.name}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ConditionValueField({
  condition,
  onChange,
  stages,
  tags,
}: {
  condition: AutomationRulePredicate;
  onChange: (condition: AutomationRulePredicate) => void;
  stages: PipelineStage[];
  tags: AutomationTagOption[];
}) {
  const definition = USER_CATALOG.find((item) => item.predicate === condition.predicate);

  if (!definition || definition.input === "none") {
    return (
      <div className="rounded-xl border border-dashed px-3 py-2 text-sm text-muted-foreground">
        Sem valor adicional
      </div>
    );
  }

  if (definition.input === "number") {
    const suffix =
      condition.predicate === "days_in_stage_gte"
        ? "dias"
        : condition.predicate === "hours_since_last_outbound_gte" ||
            condition.predicate === "hours_since_last_inbound_gte"
          ? "horas"
          : "";

    return (
      <div className="relative">
        <Input
          type="number"
          min={1}
          value={typeof condition.value === "number" ? condition.value : Number(condition.value || 1)}
          onChange={(event) =>
            onChange({
              ...condition,
              value: Math.max(1, Number(event.target.value || 1)),
            })
          }
          className={suffix ? "pr-16" : undefined}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </div>
    );
  }

  if (definition.input === "stage") {
    return (
      <Select
        value={typeof condition.value === "string" ? condition.value : ""}
        onValueChange={(value) =>
          onChange({
            ...condition,
            value,
          })
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
    );
  }

  if (definition.input === "stage-multi") {
    return (
      <MultiStageSelector
        value={condition.values || []}
        onChange={(values) =>
          onChange({
            ...condition,
            values,
          })
        }
        stages={stages}
      />
    );
  }

  if (definition.input === "tag") {
    return (
      <Select
        value={typeof condition.value === "string" ? condition.value : ""}
        onValueChange={(value) =>
          onChange({
            ...condition,
            value,
          })
        }
      >
        <SelectTrigger>
          <SelectValue placeholder="Selecione a tag" />
        </SelectTrigger>
        <SelectContent>
          {tags.map((tag) => (
            <SelectItem key={tag.id} value={tag.id}>
              {tag.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return null;
}

interface AutomationConditionComposerProps {
  title: string;
  value: AutomationRuleNode;
  onChange: (value: AutomationRuleNode) => void;
  stages: PipelineStage[];
  tags: AutomationTagOption[];
}

export function AutomationConditionComposer({
  title,
  value,
  onChange,
  stages,
  tags,
}: AutomationConditionComposerProps) {
  const analysis = analyzeRuleForComposer(value);

  if (!analysis.supported) {
    return (
      <div className="space-y-4 rounded-[24px] border bg-card/70 p-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{title}</h3>
            <Badge variant="outline">Regra avancada</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Esta automacao usa uma logica mais avancada e sera preservada como esta.
          </p>
        </div>

        <Alert>
          <AlertTitle>Modo simplificado indisponivel</AlertTitle>
          <AlertDescription>{analysis.reason}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleOperatorChange = (operator: AutomationRuleGroupOperator) => {
    onChange(
      buildComposerRule({
        operator,
        visibleConditions: analysis.visibleConditions,
        preservedConditions: analysis.preservedConditions,
      }),
    );
  };

  const handleConditionsChange = (nextConditions: AutomationRulePredicate[]) => {
    onChange(
      buildComposerRule({
        operator: analysis.operator,
        visibleConditions: nextConditions,
        preservedConditions: analysis.preservedConditions,
      }),
    );
  };

  const visibleConditions = analysis.visibleConditions;

  return (
    <div className="space-y-4 rounded-[24px] border bg-card/70 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">Escolha apenas as condicoes que fazem sentido para a jornada.</p>
        </div>

        <Select value={analysis.operator} onValueChange={handleOperatorChange}>
          <SelectTrigger className="w-full lg:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as condicoes</SelectItem>
            <SelectItem value="any">Qualquer condicao</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {visibleConditions.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          Nenhuma condicao extra configurada.
        </div>
      ) : (
        <div className="space-y-3">
          {visibleConditions.map((condition) => {
            const definition = USER_CATALOG.find((item) => item.predicate === condition.predicate);

            return (
              <div key={condition.id} className="rounded-2xl border bg-background/60 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="grid flex-1 gap-3 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Condicao</Label>
                      <Select
                        value={condition.predicate}
                        onValueChange={(predicate) => {
                          const nextCondition = createPredicate(predicate as AutomationRulePredicate["predicate"]);
                          handleConditionsChange(
                            visibleConditions.map((item) =>
                              item.id === condition.id ? { ...nextCondition, id: condition.id } : item,
                            ),
                          );
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {getConditionCatalog(condition.predicate).map((item) => (
                            <SelectItem key={item.predicate} value={item.predicate}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Valor</Label>
                      <ConditionValueField
                        condition={condition}
                        onChange={(nextCondition) =>
                          handleConditionsChange(
                            visibleConditions.map((item) => (item.id === condition.id ? nextCondition : item)),
                          )
                        }
                        stages={stages}
                        tags={tags}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 lg:flex-col lg:items-end">
                    <p className="text-xs text-muted-foreground">{definition?.description}</p>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        handleConditionsChange(visibleConditions.filter((item) => item.id !== condition.id))
                      }
                      aria-label="Remover condicao"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Button
        variant="outline"
        onClick={() => handleConditionsChange([...visibleConditions, createPredicate(DEFAULT_CONDITION_PREDICATE)])}
      >
        <Plus className="h-4 w-4" />
        Adicionar condicao
      </Button>
    </div>
  );
}
