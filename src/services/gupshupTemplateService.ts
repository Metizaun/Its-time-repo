import { getCrmBackend, postCrmBackend } from "@/services/crmBackend";
import type { GupshupTemplateCategory } from "@/lib/gupshupTemplates";

export type GupshupTemplate = {
  id: string;
  name: string;
  status: string;
  body: string;
  language: string;
  category: string;
  templateType: string;
};

export type GupshupTemplateType = "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

export type CreateGupshupTemplateInput = {
  instanceName: string;
  elementName: string;
  content: string;
  languageCode: string;
  category: GupshupTemplateCategory;
  templateType: GupshupTemplateType;
  example: string;
};

export async function listGupshupTemplates(instanceName: string) {
  return getCrmBackend<{ templates: GupshupTemplate[] }>(
    `/api/gupshup/templates?instanceName=${encodeURIComponent(instanceName)}`,
  );
}

export async function createGupshupTemplate(input: CreateGupshupTemplateInput) {
  return postCrmBackend<{ template: GupshupTemplate }>(
    "/api/gupshup/templates",
    {
      ...input,
      vertical: "OTHER",
    },
  );
}
