import axios from "axios";

const GUPSHUP_API_BASE = "https://api.gupshup.io";
const GUPSHUP_REQUEST_TIMEOUT_MS = 15_000;

export type GupshupTemplateConfig = {
  apiKey: string;
  appId: string;
};

export type GupshupTemplate = {
  id: string;
  elementName: string;
  status: string;
  data: string;
  meta: string;
  templateType: string;
  category: string;
  languageCode: string;
  vertical: string;
  createdOn: number;
  modifiedOn: number;
};

export type GupshupTemplateNormalized = {
  id: string;
  name: string;
  status: string;
  body: string;
  language: string;
  category: string;
  templateType: string;
};

export const GUPSHUP_TEMPLATE_TYPES = [
  "TEXT",
  "IMAGE",
  "VIDEO",
  "DOCUMENT",
] as const;
export type GupshupTemplateType = (typeof GUPSHUP_TEMPLATE_TYPES)[number];

export type CreateGupshupTemplateInput = {
  elementName: string;
  content: string;
  languageCode?: string;
  category?: string;
  templateType?: GupshupTemplateType;
  vertical?: string;
  example?: string;
};

export class GupshupTemplateApiError extends Error {
  constructor(
    message: string,
    public readonly upstreamStatus: number | null,
  ) {
    super(message);
    this.name = "GupshupTemplateApiError";
  }
}

const GUPSHUP_TEMPLATE_CATEGORIES = new Set([
  "UTILITY",
  "MARKETING",
  "AUTHENTICATION",
]);
const GUPSHUP_TEMPLATE_TYPE_SET = new Set<string>(GUPSHUP_TEMPLATE_TYPES);

export function validateCreateGupshupTemplateInput(
  input: CreateGupshupTemplateInput,
): string | null {
  const elementName = input.elementName.trim();
  const content = input.content.trim();

  if (!/^[a-z0-9_]+$/.test(elementName)) {
    return "elementName deve conter apenas letras minusculas, numeros e sublinhado";
  }

  if (!content) {
    return "content e obrigatorio";
  }

  if (content.length > 1024) {
    return "content deve ter no maximo 1024 caracteres";
  }

  const category = (input.category ?? "UTILITY").trim().toUpperCase();
  if (!GUPSHUP_TEMPLATE_CATEGORIES.has(category)) {
    return "category deve ser UTILITY, MARKETING ou AUTHENTICATION";
  }

  const templateType = (input.templateType ?? "TEXT").trim().toUpperCase();
  if (!GUPSHUP_TEMPLATE_TYPE_SET.has(templateType)) {
    return "templateType deve ser TEXT, IMAGE, VIDEO ou DOCUMENT";
  }

  const languageCode = (input.languageCode ?? "pt_BR").trim();
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(languageCode)) {
    return "languageCode deve usar o formato pt_BR, en_US ou es";
  }

  const variables = Array.from(content.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map(
    (match) => Number(match[1]),
  );
  const uniqueVariables = [...new Set(variables)].sort(
    (left, right) => left - right,
  );
  if (uniqueVariables.some((variable, index) => variable !== index + 1)) {
    return "As variaveis do template devem ser sequenciais: {{1}}, {{2}}, ...";
  }

  if (!input.example?.trim()) {
    return "example e obrigatorio para analise do template";
  }

  if (uniqueVariables.length > 0) {
    const examples = input.example
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (examples.length !== uniqueVariables.length) {
      return `example deve conter ${uniqueVariables.length} valor(es), um para cada variavel`;
    }
  }

  return null;
}

export class GupshupTemplateService {
  constructor(private readonly config: GupshupTemplateConfig) {}

  async listTemplates(): Promise<GupshupTemplateNormalized[]> {
    const response = await axios.get(
      `${GUPSHUP_API_BASE}/wa/app/${encodeURIComponent(this.config.appId)}/template`,
      {
        headers: { apikey: this.config.apiKey },
        params: { pageNo: 0, pageSize: 100 },
        timeout: GUPSHUP_REQUEST_TIMEOUT_MS,
      },
    );

    const templates: GupshupTemplate[] = Array.isArray(response.data?.templates)
      ? response.data.templates
      : [];

    return templates.map((t) => ({
      id: t.id,
      name: t.elementName,
      status: t.status,
      body: t.data,
      language: t.languageCode,
      category: t.category,
      templateType: t.templateType,
    }));
  }

  async createTemplate(
    input: CreateGupshupTemplateInput,
  ): Promise<GupshupTemplateNormalized> {
    const validationError = validateCreateGupshupTemplateInput(input);
    if (validationError) {
      throw new Error(validationError);
    }

    const params = new URLSearchParams({
      elementName: input.elementName,
      languageCode: input.languageCode ?? "pt_BR",
      content: input.content,
      templateType: input.templateType ?? "TEXT",
      category: input.category ?? "UTILITY",
      vertical: input.vertical ?? "OTHER",
    });
    if (input.example?.trim()) params.set("example", input.example.trim());

    let response;
    try {
      response = await axios.post(
        `${GUPSHUP_API_BASE}/wa/app/${encodeURIComponent(this.config.appId)}/template`,
        params.toString(),
        {
          headers: {
            apikey: this.config.apiKey,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          timeout: GUPSHUP_REQUEST_TIMEOUT_MS,
        },
      );
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        throw error;
      }

      const upstreamMessage =
        typeof error.response?.data?.message === "string"
          ? error.response.data.message.trim()
          : "A Gupshup recusou a criacao do template";
      const friendlyMessage =
        upstreamMessage === "Template Not Supported On Gupshup Platform"
          ? "A Gupshup nao permite criar templates via API para este aplicativo. Verifique no painel da Gupshup se a criacao por API esta habilitada."
          : upstreamMessage;

      throw new GupshupTemplateApiError(
        friendlyMessage,
        error.response?.status ?? null,
      );
    }

    const t = response.data?.template as Partial<GupshupTemplate> | undefined;
    return {
      id: t?.id ?? "",
      name: t?.elementName ?? input.elementName,
      status: t?.status ?? "PENDING",
      body: t?.data ?? input.content,
      language: t?.languageCode ?? input.languageCode ?? "pt_BR",
      category: t?.category ?? input.category ?? "UTILITY",
      templateType: t?.templateType ?? input.templateType ?? "TEXT",
    };
  }

  async getTemplateById(
    templateId: string,
  ): Promise<GupshupTemplateNormalized | null> {
    const normalizedTemplateId = templateId.trim();
    if (!normalizedTemplateId) {
      return null;
    }

    const response = await axios.get(
      `${GUPSHUP_API_BASE}/wa/app/${encodeURIComponent(this.config.appId)}/template/${encodeURIComponent(normalizedTemplateId)}`,
      {
        headers: { apikey: this.config.apiKey },
        timeout: GUPSHUP_REQUEST_TIMEOUT_MS,
      },
    );

    const template = normalizeTemplateRecord(
      response.data?.template ?? response.data,
    );
    return template?.id ? template : null;
  }
}

function normalizeTemplateRecord(
  value: unknown,
): GupshupTemplateNormalized | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const template = value as Partial<GupshupTemplate>;
  return {
    id: typeof template.id === "string" ? template.id : "",
    name: typeof template.elementName === "string" ? template.elementName : "",
    status: typeof template.status === "string" ? template.status : "",
    body: typeof template.data === "string" ? template.data : "",
    language:
      typeof template.languageCode === "string"
        ? template.languageCode
        : "pt_BR",
    category: typeof template.category === "string" ? template.category : "",
    templateType:
      typeof template.templateType === "string" ? template.templateType : "",
  };
}
