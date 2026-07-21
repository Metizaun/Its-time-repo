import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Video,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useGupshupTemplates } from "@/hooks/useGupshupTemplates";
import {
  compileGupshupTemplateContent,
  getGupshupTemplateDraftError,
  isApprovedGupshupTemplate,
  isPendingGupshupTemplate,
  normalizeGupshupTemplateStatus,
  type GupshupTemplateCategory,
} from "@/lib/gupshupTemplates";
import { cn } from "@/lib/utils";
import type {
  GupshupTemplate,
  GupshupTemplateType,
} from "@/services/gupshupTemplateService";

type GupshupTemplatePanelProps = {
  instanceName: string;
  selectedTemplateId: string;
  selectedTemplateName: string;
  parametersText: string;
  mediaEditor?: ReactNode;
  onTemplateChange: (template: GupshupTemplate) => void;
  onParametersTextChange: (parametersText: string) => void;
};

type CreateTemplateForm = {
  elementName: string;
  content: string;
  languageCode: string;
  category: Exclude<GupshupTemplateCategory, "AUTHENTICATION">;
  templateType: GupshupTemplateType;
  examples: string[];
};

const INITIAL_FORM: CreateTemplateForm = {
  elementName: "",
  content: "",
  languageCode: "pt_BR",
  category: "UTILITY",
  templateType: "TEXT",
  examples: [""],
};

const TEMPLATE_TYPES: Array<{
  value: GupshupTemplateType;
  label: string;
  icon: typeof FileText;
}> = [
  { value: "TEXT", label: "Texto", icon: FileText },
  { value: "IMAGE", label: "Imagem", icon: ImageIcon },
  { value: "VIDEO", label: "Vídeo", icon: Video },
  { value: "DOCUMENT", label: "Documento", icon: FileText },
];

function getTemplateValue(template: GupshupTemplate) {
  return template.id.trim() || template.name.trim();
}

function normalizeTemplateType(value: string): GupshupTemplateType {
  const normalized = value.trim().toUpperCase();
  return normalized === "IMAGE" || normalized === "VIDEO" || normalized === "DOCUMENT"
    ? normalized
    : "TEXT";
}

function getTemplateTypeLabel(value: string) {
  const normalized = normalizeTemplateType(value);
  return TEMPLATE_TYPES.find((item) => item.value === normalized)?.label ?? "Texto";
}

function getStatusPresentation(status: string) {
  const normalized = normalizeGupshupTemplateStatus(status);
  if (isApprovedGupshupTemplate(normalized)) {
    return {
      label: "Aprovado",
      icon: CheckCircle2,
      className: "text-[var(--color-success-600)]",
    };
  }

  if (normalized === "REJECTED" || normalized === "DISABLED") {
    return {
      label: normalized === "REJECTED" ? "Rejeitado" : "Desativado",
      icon: XCircle,
      className: "text-[var(--color-error-600)]",
    };
  }

  return {
    label: "Em análise",
    icon: Clock3,
    className: "text-[var(--color-gray-500)]",
  };
}

function getNumericParameterCount(body: string) {
  const indexes = Array.from(body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map((match) =>
    Number(match[1]),
  );
  return indexes.length ? Math.max(...indexes) : 0;
}

function parseParameters(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeExamples(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean).join(", ");
}

export function GupshupTemplatePanel({
  instanceName,
  selectedTemplateId,
  selectedTemplateName,
  parametersText,
  mediaEditor,
  onTemplateChange,
  onParametersTextChange,
}: GupshupTemplatePanelProps) {
  const [view, setView] = useState<"catalog" | "create">("catalog");
  const [createForm, setCreateForm] = useState<CreateTemplateForm>(INITIAL_FORM);
  const [templateSearch, setTemplateSearch] = useState("");
  const { templates, loading, creating, error, refetch, createTemplate } =
    useGupshupTemplates(instanceName, Boolean(instanceName.trim()));

  const approvedTemplates = useMemo(
    () => templates.filter((template) => isApprovedGupshupTemplate(template.status)),
    [templates],
  );
  const visibleApprovedTemplates = useMemo(() => {
    const query = templateSearch.trim().toLocaleLowerCase("pt-BR");
    if (!query) return approvedTemplates;
    return approvedTemplates.filter((template) =>
      [template.name, template.body, template.category, template.language]
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(query),
    );
  }, [approvedTemplates, templateSearch]);
  const reviewTemplates = useMemo(
    () => templates.filter((template) => !isApprovedGupshupTemplate(template.status)),
    [templates],
  );
  const selectedValue = selectedTemplateId.trim() || selectedTemplateName.trim();
  const selectedTemplate = useMemo(
    () =>
      approvedTemplates.find(
        (template) =>
          getTemplateValue(template) === selectedValue ||
          template.id === selectedTemplateId ||
          template.name === selectedTemplateName,
      ) ?? null,
    [approvedTemplates, selectedTemplateId, selectedTemplateName, selectedValue],
  );
  const compiledTemplate = useMemo(
    () => compileGupshupTemplateContent(createForm.content),
    [createForm.content],
  );
  const createExampleCount = Math.max(1, compiledTemplate.parameterNames.length);
  const selectedParameterCount = selectedTemplate
    ? getNumericParameterCount(selectedTemplate.body)
    : 0;
  const parameterValues = parseParameters(parametersText);

  const updateCreateForm = (next: Partial<CreateTemplateForm>) => {
    setCreateForm((current) => ({ ...current, ...next }));
  };

  const updateExample = (index: number, value: string) => {
    setCreateForm((current) => {
      const examples = Array.from(
        { length: Math.max(createExampleCount, current.examples.length) },
        (_, itemIndex) => current.examples[itemIndex] ?? "",
      );
      examples[index] = value;
      return { ...current, examples };
    });
  };

  const updateParameter = (index: number, value: string) => {
    const nextValues = Array.from(
      { length: selectedParameterCount },
      (_, itemIndex) => parameterValues[itemIndex] ?? "",
    );
    nextValues[index] = value;
    onParametersTextChange(nextValues.join("\n"));
  };

  const handleSelectTemplate = (value: string) => {
    const template = approvedTemplates.find((item) => getTemplateValue(item) === value);
    if (template) onTemplateChange(template);
  };

  const handleCreateTemplate = async () => {
    const requiredExamples = createForm.examples.slice(0, createExampleCount);
    if (requiredExamples.some((value) => !value.trim())) {
      toast.error("Preencha um exemplo para cada variável");
      return;
    }
    const example = serializeExamples(requiredExamples);
    const draftError = getGupshupTemplateDraftError({
      elementName: createForm.elementName,
      content: createForm.content,
      example,
    });
    if (draftError) {
      toast.error(draftError);
      return;
    }

    try {
      await createTemplate({
        instanceName,
        elementName: createForm.elementName.trim(),
        content: compiledTemplate.content.trim(),
        languageCode: createForm.languageCode,
        category: createForm.category,
        templateType: createForm.templateType,
        example,
      });
      toast.success("Template enviado para análise da Meta");
      setCreateForm(INITIAL_FORM);
      setView("catalog");
    } catch (createError) {
      toast.error(
        createError instanceof Error
          ? createError.message
          : "Não foi possível criar o template",
      );
    }
  };

  if (view === "create") {
    return (
      <div className="space-y-5" data-testid="gupshup-template-create">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border-default)] pb-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setView("catalog")}
              aria-label="Voltar para templates"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h3 className="font-semibold text-[var(--color-gray-900)]">Novo template</h3>
              <p className="mt-1 text-xs text-[var(--color-gray-500)]">
                Ficará disponível após a aprovação.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Formato</Label>
          <Tabs
            value={createForm.templateType}
            onValueChange={(value) =>
              updateCreateForm({ templateType: value as GupshupTemplateType })
            }
          >
            <TabsList className="grid h-auto w-full grid-cols-2 bg-[var(--color-surface-2)] p-1 sm:grid-cols-4">
              {TEMPLATE_TYPES.map((item) => {
                const Icon = item.icon;
                return (
                  <TabsTrigger key={item.value} value={item.value} className="gap-2">
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        <div className="space-y-2">
          <Label htmlFor="gupshup-template-name">Nome interno</Label>
          <Input
            id="gupshup-template-name"
            value={createForm.elementName}
            onChange={(event) =>
              updateCreateForm({ elementName: event.target.value.toLowerCase() })
            }
            placeholder="retomar_atendimento"
            autoComplete="off"
          />
          <p className="text-xs text-[var(--color-gray-500)]">
            Letras minúsculas, números e sublinhado.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select
              value={createForm.category}
              onValueChange={(category: "UTILITY" | "MARKETING") =>
                updateCreateForm({ category })
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="UTILITY">Utilidade</SelectItem>
                <SelectItem value="MARKETING">Marketing</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Idioma</Label>
            <Select
              value={createForm.languageCode}
              onValueChange={(languageCode) => updateCreateForm({ languageCode })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pt_BR">Português (Brasil)</SelectItem>
                <SelectItem value="en_US">Inglês (EUA)</SelectItem>
                <SelectItem value="es">Espanhol</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="gupshup-template-content">Mensagem</Label>
          <Textarea
            id="gupshup-template-content"
            rows={5}
            maxLength={1024}
            value={createForm.content}
            onChange={(event) => updateCreateForm({ content: event.target.value })}
            placeholder="Olá {nome}, podemos continuar seu atendimento?"
            className="min-h-[140px] resize-none"
          />
          <div className="flex justify-end text-xs text-[var(--color-gray-500)]">
            {createForm.content.length}/1024
          </div>
        </div>

        <div className="space-y-3 border-t border-[var(--border-default)] pt-4">
          <Label>{compiledTemplate.parameterNames.length ? "Exemplos das variáveis" : "Exemplo para análise"}</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: createExampleCount }, (_, index) => (
              <div key={compiledTemplate.parameterNames[index] ?? "message"} className="space-y-2">
                <Label
                  htmlFor={`gupshup-template-example-${index}`}
                  className="text-xs font-normal text-[var(--color-gray-500)]"
                >
                  {compiledTemplate.parameterNames[index]
                    ? `{${compiledTemplate.parameterNames[index]}}`
                    : "Mensagem aprovada"}
                </Label>
                <Input
                  id={`gupshup-template-example-${index}`}
                  value={createForm.examples[index] ?? ""}
                  onChange={(event) => updateExample(index, event.target.value)}
                  placeholder={index === 0 ? "Maria" : "Exemplo"}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-default)] pt-4">
          <Button type="button" variant="ghost" onClick={() => setView("catalog")}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void handleCreateTemplate()} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enviar para análise
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="gupshup-template-catalog">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold text-[var(--color-gray-900)]">Template aprovado</h3>
          <p className="mt-1 text-xs text-[var(--color-gray-500)]">
            Pode iniciar uma conversa a qualquer momento.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void refetch()}
            disabled={loading}
            aria-label="Atualizar templates Gupshup"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button type="button" variant="outline" onClick={() => setView("create")}>
            <Plus className="h-4 w-4" />
            Criar template
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-gray-400)]"
        />
        <Input
          value={templateSearch}
          onChange={(event) => setTemplateSearch(event.target.value)}
          placeholder="Buscar template"
          aria-label="Buscar template aprovado"
          className="pl-9"
        />
      </div>

      <Select
        value={selectedValue}
        onValueChange={handleSelectTemplate}
        disabled={loading || !visibleApprovedTemplates.length}
      >
        <SelectTrigger>
          <SelectValue
            placeholder={
              loading
                ? "Carregando templates..."
                : visibleApprovedTemplates.length
                  ? "Selecione um template"
                  : templateSearch.trim()
                    ? "Nenhum template encontrado"
                    : "Nenhum template aprovado"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {visibleApprovedTemplates.map((template) => (
            <SelectItem key={`${template.id}-${template.name}`} value={getTemplateValue(template)}>
              {template.name} · {getTemplateTypeLabel(template.templateType)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedTemplate ? (
        <div className="space-y-4 border-y border-[var(--border-default)] py-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--color-gray-500)]">
            <span>{getTemplateTypeLabel(selectedTemplate.templateType)}</span>
            <span>{selectedTemplate.language || "pt_BR"}</span>
            <span>{selectedTemplate.category}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-gray-700)]">
            {selectedTemplate.body}
          </p>
        </div>
      ) : selectedValue ? (
        <p className="text-sm text-[var(--color-error-600)]">
          Este template não está disponível no catálogo atual. Atualize a lista ou selecione outro.
        </p>
      ) : null}

      {selectedTemplate && selectedParameterCount > 0 ? (
        <div className="space-y-3">
          <Label>Variáveis do envio</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: selectedParameterCount }, (_, index) => (
              <div key={index} className="space-y-2">
                <Label
                  htmlFor={`gupshup-parameter-${index}`}
                  className="text-xs font-normal text-[var(--color-gray-500)]"
                >
                  Variável {index + 1}
                </Label>
                <Input
                  id={`gupshup-parameter-${index}`}
                  value={parameterValues[index] ?? ""}
                  onChange={(event) => updateParameter(index, event.target.value)}
                  placeholder={index === 0 ? "{nome}" : "Valor ou variável"}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {selectedTemplate && normalizeTemplateType(selectedTemplate.templateType) !== "TEXT"
        ? mediaEditor
        : null}

      {reviewTemplates.length ? (
        <div className="space-y-1 border-t border-[var(--border-default)] pt-4">
          <p className="pb-2 text-xs font-medium text-[var(--color-gray-500)]">Em acompanhamento</p>
          {reviewTemplates.map((template) => {
            const presentation = getStatusPresentation(template.status);
            const StatusIcon = presentation.icon;
            return (
              <div
                key={`${template.id}-${template.name}`}
                className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] py-3 first:border-t-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-gray-800)]">
                    {template.name}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-gray-500)]">
                    {getTemplateTypeLabel(template.templateType)} · {template.language || "pt_BR"}
                  </p>
                </div>
                <span className={cn("inline-flex items-center gap-1.5 text-xs", presentation.className)}>
                  <StatusIcon className={cn("h-3.5 w-3.5", isPendingGupshupTemplate(template.status) && "animate-pulse")} />
                  {presentation.label}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
