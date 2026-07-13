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

export type CreateGupshupTemplateInput = {
  elementName: string;
  content: string;
  languageCode?: string;
  category?: string;
  templateType?: string;
  vertical?: string;
  example?: string;
};

export class GupshupTemplateService {
  constructor(private readonly config: GupshupTemplateConfig) {}

  async listTemplates(): Promise<GupshupTemplateNormalized[]> {
    const response = await axios.get(
      `${GUPSHUP_API_BASE}/wa/app/${encodeURIComponent(this.config.appId)}/template`,
      {
        headers: { apikey: this.config.apiKey },
        params: { pageNo: 0, pageSize: 100 },
        timeout: GUPSHUP_REQUEST_TIMEOUT_MS,
      }
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

  async createTemplate(input: CreateGupshupTemplateInput): Promise<GupshupTemplateNormalized> {
    if (/\{\{\s*\d+\s*\}\}/.test(input.content) && !input.example?.trim()) {
      throw new Error("example e obrigatorio para templates com variaveis");
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

    const response = await axios.post(
      `${GUPSHUP_API_BASE}/wa/app/${encodeURIComponent(this.config.appId)}/template`,
      params.toString(),
      {
        headers: {
          apikey: this.config.apiKey,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: GUPSHUP_REQUEST_TIMEOUT_MS,
      }
    );

    const t = response.data?.template as Partial<GupshupTemplate> | undefined;
    return {
      id: t?.id ?? "",
      name: t?.elementName ?? input.elementName,
      status: t?.status ?? "PENDING",
      body: t?.data ?? input.content,
      language: t?.languageCode ?? (input.languageCode ?? "pt_BR"),
      category: t?.category ?? (input.category ?? "UTILITY"),
      templateType: t?.templateType ?? (input.templateType ?? "TEXT"),
    };
  }

  async getTemplateById(templateId: string): Promise<GupshupTemplateNormalized | null> {
    const normalizedTemplateId = templateId.trim();
    if (!normalizedTemplateId) {
      return null;
    }

    const response = await axios.get(
      `${GUPSHUP_API_BASE}/wa/app/${encodeURIComponent(this.config.appId)}/template/${encodeURIComponent(normalizedTemplateId)}`,
      {
        headers: { apikey: this.config.apiKey },
        timeout: GUPSHUP_REQUEST_TIMEOUT_MS,
      }
    );

    const template = normalizeTemplateRecord(response.data?.template ?? response.data);
    return template?.id ? template : null;
  }
}

function normalizeTemplateRecord(value: unknown): GupshupTemplateNormalized | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const template = value as Partial<GupshupTemplate>;
  return {
    id: typeof template.id === "string" ? template.id : "",
    name: typeof template.elementName === "string" ? template.elementName : "",
    status: typeof template.status === "string" ? template.status : "",
    body: typeof template.data === "string" ? template.data : "",
    language: typeof template.languageCode === "string" ? template.languageCode : "pt_BR",
    category: typeof template.category === "string" ? template.category : "",
    templateType: typeof template.templateType === "string" ? template.templateType : "",
  };
}
