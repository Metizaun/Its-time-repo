export const GUPSHUP_TEMPLATE_CATEGORIES = [
  "UTILITY",
  "MARKETING",
  "AUTHENTICATION",
] as const;

export type GupshupTemplateCategory =
  (typeof GUPSHUP_TEMPLATE_CATEGORIES)[number];

export type CompiledGupshupTemplate = {
  content: string;
  parameterNames: string[];
};

export type GupshupTemplateDraft = {
  elementName: string;
  content: string;
  example: string;
};

const FRIENDLY_VARIABLE_PATTERN = /(?<!\{)\{([A-Za-z_][A-Za-z0-9_]*)\}(?!\})/g;
const GUPSHUP_VARIABLE_PATTERN = /\{\{\s*(\d+)\s*\}\}/g;

export function compileGupshupTemplateContent(
  source: string,
): CompiledGupshupTemplate {
  const parameterNames: string[] = [];
  const parameterIndexes = new Map<string, number>();
  const content = source.replace(
    FRIENDLY_VARIABLE_PATTERN,
    (_match, parameterName: string) => {
      const normalizedName = parameterName.trim();
      let parameterIndex = parameterIndexes.get(normalizedName);

      if (!parameterIndex) {
        parameterNames.push(normalizedName);
        parameterIndex = parameterNames.length;
        parameterIndexes.set(normalizedName, parameterIndex);
      }

      return `{{${parameterIndex}}}`;
    },
  );

  return { content, parameterNames };
}

export function getGupshupTemplateDraftError(
  draft: GupshupTemplateDraft,
): string | null {
  const elementName = draft.elementName.trim();
  const compiled = compileGupshupTemplateContent(draft.content);

  if (!elementName) {
    return "Informe o nome interno do template";
  }

  if (!/^[a-z0-9_]+$/.test(elementName)) {
    return "Use apenas letras minusculas, numeros e sublinhado no nome";
  }

  if (!compiled.content.trim()) {
    return "Escreva o conteudo do template";
  }

  if (compiled.content.length > 1024) {
    return "O conteudo deve ter no maximo 1024 caracteres";
  }

  const numericVariables = Array.from(
    compiled.content.matchAll(GUPSHUP_VARIABLE_PATTERN),
  ).map((match) => Number(match[1]));
  const uniqueVariables = [...new Set(numericVariables)].sort(
    (left, right) => left - right,
  );
  if (uniqueVariables.some((variable, index) => variable !== index + 1)) {
    return "As variaveis numericas devem ser sequenciais: {{1}}, {{2}}, ...";
  }

  if (!draft.example.trim()) {
    return "Informe um exemplo para a analise da Meta";
  }

  return null;
}

export function normalizeGupshupTemplateStatus(status: string) {
  return status
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function isApprovedGupshupTemplate(status: string) {
  const normalizedStatus = normalizeGupshupTemplateStatus(status);
  return normalizedStatus === "APPROVED" || normalizedStatus === "ENABLED";
}

export function isPendingGupshupTemplate(status: string) {
  const normalizedStatus = normalizeGupshupTemplateStatus(status);
  return ["PENDING", "IN_REVIEW", "SUBMITTED"].includes(normalizedStatus);
}
