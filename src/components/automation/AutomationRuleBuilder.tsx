import { Plus, Trash2, Waypoints } from "lucide-react";

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
  AUTOMATION_DIRECTION_OPTIONS,
  AUTOMATION_PREDICATE_CATALOG,
  buildAutomationLookupMaps,
  createPredicate,
  createRuleGroup,
  isRuleEmpty,
  normalizeRuleNode,
  summarizeRuleNode,
  type AutomationOwnerOption,
  type AutomationRuleGroup,
  type AutomationRuleNode,
  type AutomationRulePredicate,
  type AutomationTagOption,
} from "@/lib/automation";
import { cn } from "@/lib/utils";
import type { Instance } from "@/hooks/useInstances";
import type { PipelineStage } from "@/types";

interface AutomationRuleBuilderProps {
  title: string;
  description: string;
  value: AutomationRuleNode;
  onChange: (value: AutomationRuleNode) => void;
  stages: PipelineStage[];
  owners: AutomationOwnerOption[];
  tags: AutomationTagOption[];
  instances: Instance[];
}

interface RuleEditorProps extends Omit<AutomationRuleBuilderProps, "title" | "description"> {
  node: AutomationRuleNode;
  depth?: number;
  isRoot?: boolean;
  onRemove?: () => void;
}

function updateNode(root: AutomationRuleNode, nodeId: string, updater: (node: AutomationRuleNode) => AutomationRuleNode) {
  if (root.id === nodeId) {
    return updater(root);
  }

  if (root.type !== "group") {
    return root;
  }

  return {
    ...root,
    children: root.children.map((child) => updateNode(child, nodeId, updater)),
  };
}

function removeNode(root: AutomationRuleNode, nodeId: string): AutomationRuleNode {
  if (root.type !== "group") {
    return root;
  }

  return {
    ...root,
    children: root.children
      .filter((child) => child.id !== nodeId)
      .map((child) => removeNode(child, nodeId)),
  };
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
          <p className="text-sm font-medium">Etapas permitidas</p>
          <p className="text-xs text-muted-foreground">Selecione uma ou mais etapas para a condicao.</p>
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

function PredicateValueEditor({
  node,
  onChange,
  stages,
  owners,
  tags,
  instances,
}: {
  node: AutomationRulePredicate;
  onChange: (nextNode: AutomationRulePredicate) => void;
  stages: PipelineStage[];
  owners: AutomationOwnerOption[];
  tags: AutomationTagOption[];
  instances: Instance[];
}) {
  const definition = AUTOMATION_PREDICATE_CATALOG.find((item) => item.predicate === node.predicate);

  if (!definition || definition.input === "none") {
    return (
      <div className="rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Esta condicao nao precisa de valor adicional.
      </div>
    );
  }

  if (definition.input === "number") {
    return (
      <Input
        type="number"
        min={0}
        value={typeof node.value === "number" ? node.value : Number(node.value || 0)}
        onChange={(event) =>
          onChange({
            ...node,
            value: Number(event.target.value || 0),
          })
        }
      />
    );
  }

  if (definition.input === "text") {
    return (
      <Input
        value={typeof node.value === "string" ? node.value : ""}
        onChange={(event) =>
          onChange({
            ...node,
            value: event.target.value,
          })
        }
        placeholder="Digite o valor textual"
      />
    );
  }

  if (definition.input === "direction") {
    return (
      <Select
        value={typeof node.value === "string" ? node.value : "outbound"}
        onValueChange={(value) =>
          onChange({
            ...node,
            value,
          })
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AUTOMATION_DIRECTION_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (definition.input === "stage") {
    return (
      <Select
        value={typeof node.value === "string" ? node.value : ""}
        onValueChange={(value) =>
          onChange({
            ...node,
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
        value={node.values || []}
        onChange={(values) =>
          onChange({
            ...node,
            values,
          })
        }
        stages={stages}
      />
    );
  }

  if (definition.input === "owner") {
    return (
      <Select
        value={typeof node.value === "string" ? node.value : ""}
        onValueChange={(value) =>
          onChange({
            ...node,
            value,
          })
        }
      >
        <SelectTrigger>
          <SelectValue placeholder="Selecione o responsavel" />
        </SelectTrigger>
        <SelectContent>
          {owners.map((owner) => (
            <SelectItem key={owner.id} value={owner.id}>
              {owner.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (definition.input === "tag") {
    return (
      <Select
        value={typeof node.value === "string" ? node.value : ""}
        onValueChange={(value) =>
          onChange({
            ...node,
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

  if (definition.input === "instance") {
    return (
      <Select
        value={typeof node.value === "string" ? node.value : ""}
        onValueChange={(value) =>
          onChange({
            ...node,
            value,
          })
        }
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
    );
  }

  return null;
}

function PredicateEditor({
  node,
  onChange,
  onRemove,
  stages,
  owners,
  tags,
  instances,
}: {
  node: AutomationRulePredicate;
  onChange: (nextNode: AutomationRulePredicate) => void;
  onRemove: () => void;
  stages: PipelineStage[];
  owners: AutomationOwnerOption[];
  tags: AutomationTagOption[];
  instances: Instance[];
}) {
  const definition = AUTOMATION_PREDICATE_CATALOG.find((item) => item.predicate === node.predicate);

  return (
    <div className="space-y-3 rounded-2xl border bg-background/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{definition?.label || node.predicate}</p>
          <p className="mt-1 text-xs text-muted-foreground">{definition?.description}</p>
        </div>

        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remover condicao">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Condicao</Label>
          <Select
            value={node.predicate}
            onValueChange={(value) => {
              const nextNode = createPredicate(value as AutomationRulePredicate["predicate"]);
              onChange({
                ...nextNode,
                id: node.id,
              });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUTOMATION_PREDICATE_CATALOG.map((item) => (
                <SelectItem key={item.predicate} value={item.predicate}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Valor</Label>
          <PredicateValueEditor
            node={node}
            onChange={onChange}
            stages={stages}
            owners={owners}
            tags={tags}
            instances={instances}
          />
        </div>
      </div>
    </div>
  );
}

function RuleEditor({
  node,
  onChange,
  stages,
  owners,
  tags,
  instances,
  depth = 0,
  isRoot = false,
  onRemove,
}: RuleEditorProps) {
  if (node.type === "predicate") {
    return (
      <PredicateEditor
        node={node}
        onChange={(nextNode) => onChange(nextNode)}
        onRemove={() => {
          if (isRoot) {
            return;
          }

          onRemove?.();
        }}
        stages={stages}
        owners={owners}
        tags={tags}
        instances={instances}
      />
    );
  }

  const groupNode = node as AutomationRuleGroup;

  return (
    <div className={cn("space-y-4 rounded-2xl border p-4", depth > 0 && "bg-muted/20")}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Waypoints className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Grupo logico</span>
            <Badge variant="secondary">{groupNode.children.length} item(ns)</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {groupNode.operator === "all"
              ? "Todos os itens abaixo precisam ser verdadeiros."
              : "Qualquer item abaixo ja faz esse grupo casar."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={groupNode.operator}
            onValueChange={(value: AutomationRuleGroup["operator"]) =>
              onChange({
                ...groupNode,
                operator: value,
              })
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">IF todos os itens</SelectItem>
              <SelectItem value="any">IF qualquer item</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            onClick={() =>
              onChange({
                ...groupNode,
                children: [...groupNode.children, createPredicate("stage_is")],
              })
            }
          >
            <Plus className="h-4 w-4" />
            Condicao
          </Button>

          <Button
            variant="outline"
            onClick={() =>
              onChange({
                ...groupNode,
                children: [...groupNode.children, createRuleGroup("all", [])],
              })
            }
          >
            <Plus className="h-4 w-4" />
            Subgrupo
          </Button>
        </div>
      </div>

      {groupNode.children.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
          Nenhuma condicao adicionada ainda.
        </div>
      ) : (
        <div className="space-y-3">
          {groupNode.children.map((child) => (
            <div key={child.id} className="space-y-2">
              {child.type === "group" ? (
                <div className="flex items-center justify-end">
                  <Button variant="ghost" size="sm" onClick={() => onChange(removeNode(groupNode, child.id))}>
                    <Trash2 className="h-4 w-4" />
                    Remover
                  </Button>
                </div>
              ) : null}

              <RuleEditor
                node={child}
                onChange={(nextChild) =>
                  onChange(updateNode(groupNode, child.id, () => nextChild))
                }
                onRemove={() => onChange(removeNode(groupNode, child.id))}
                stages={stages}
                owners={owners}
                tags={tags}
                instances={instances}
                depth={depth + 1}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AutomationRuleBuilder({
  title,
  description,
  value,
  onChange,
  stages,
  owners,
  tags,
  instances,
}: AutomationRuleBuilderProps) {
  const normalizedValue = normalizeRuleNode(value, createRuleGroup("all", []));
  const lookups = buildAutomationLookupMaps({ stages, owners, tags, instances });

  return (
    <div className="space-y-4 rounded-[24px] border bg-card/70 p-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{title}</h3>
          {!isRuleEmpty(normalizedValue) && (
            <Badge variant="outline" className="max-w-full truncate">
              {summarizeRuleNode(normalizedValue, lookups)}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <RuleEditor
        node={normalizedValue}
        onChange={onChange}
        stages={stages}
        owners={owners}
        tags={tags}
        instances={instances}
        isRoot
      />
    </div>
  );
}
