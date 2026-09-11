import axios from "axios";
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type MetaTemplateServiceConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  providerMode: "mock" | "live";
  graphApiVersion: string;
  fixturePath?: string;
  resolveSecret?: (secretRef: string) => Promise<string | null> | string | null;
};

type MetaChannelRow = {
  id: string;
  waba_id: string | null;
  access_token_secret_ref: string | null;
};

export type MetaTemplatePayload = {
  id?: string;
  name: string;
  language?: string;
  category?: string;
  status?: string;
  components?: unknown[];
  rejection_reason?: string | null;
};

export type CreateMetaTemplateInput = {
  name: string;
  language?: string;
  category?: string;
  components: unknown[];
};

const DEFAULT_MOCK_TEMPLATES: MetaTemplatePayload[] = [
  {
    id: "mock_template_confirmacao_agendamento",
    name: "confirmacao_agendamento",
    language: "pt_BR",
    category: "UTILITY",
    status: "APPROVED",
    components: [
      {
        type: "BODY",
        text: "Ola {{1}}, confirmamos seu agendamento para {{2}}.",
      },
    ],
  },
];

export class MetaTemplateService {
  private readonly metaClient: SupabaseClient<any, any, any>;

  constructor(private readonly config: MetaTemplateServiceConfig) {
    this.metaClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "meta" },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async syncTemplatesForInstance(instanceName: string) {
    const channel = await this.requireChannel(instanceName);
    const templates =
      this.config.providerMode === "mock"
        ? await this.loadMockTemplates()
        : await this.fetchGraphTemplates(channel);

    const rows = templates.map((template) => ({
      channel_id: channel.id,
      meta_template_id: template.id ?? null,
      name: normalizeTemplateName(template.name),
      language: template.language ?? "pt_BR",
      category: template.category ?? "UNKNOWN",
      status: template.status ?? "UNKNOWN",
      components_json: template.components ?? [],
      variables_json: extractTemplateVariables(template.components ?? []),
      rejection_reason: template.rejection_reason ?? null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    if (rows.length > 0) {
      const { error } = await this.metaClient
        .from("whatsapp_templates")
        .upsert(rows, { onConflict: "channel_id,name,language" });

      if (error) {
        throw error;
      }
    }

    const { error: channelError } = await this.metaClient
      .from("whatsapp_channels")
      .update({
        last_template_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", channel.id);

    if (channelError) {
      throw channelError;
    }

    return {
      instanceName,
      mode: this.config.providerMode,
      synced: rows.length,
    };
  }

  async createTemplate(instanceName: string, input: CreateMetaTemplateInput) {
    const channel = await this.requireChannel(instanceName);
    const name = normalizeTemplateName(input.name);
    if (!/^[a-z0-9_]{1,512}$/.test(name)) {
      throw new Error("Nome do template Meta deve usar apenas letras minusculas, numeros e underscore");
    }
    if (!Array.isArray(input.components) || input.components.length === 0) {
      throw new Error("O template Meta precisa de ao menos um componente");
    }

    const template: MetaTemplatePayload = this.config.providerMode === "mock"
      ? {
          id: `mock_${name}_${Date.now()}`,
          name,
          language: input.language ?? "pt_BR",
          category: input.category ?? "UTILITY",
          status: "PENDING",
          components: input.components,
        }
      : await this.createGraphTemplate(channel, {
          name,
          language: input.language ?? "pt_BR",
          category: input.category ?? "UTILITY",
          components: input.components,
        });

    const { data, error } = await this.metaClient
      .from("whatsapp_templates")
      .upsert({
        channel_id: channel.id,
        meta_template_id: template.id ?? null,
        name,
        language: template.language ?? "pt_BR",
        category: template.category ?? "UTILITY",
        status: template.status ?? "PENDING",
        components_json: template.components ?? input.components,
        variables_json: extractTemplateVariables(template.components ?? input.components),
        rejection_reason: template.rejection_reason ?? null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "channel_id,name,language" })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  private async requireChannel(instanceName: string) {
    const { data, error } = await this.metaClient
      .from("whatsapp_channels")
      .select("id, waba_id, access_token_secret_ref")
      .eq("instance_name", instanceName)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error("Canal Meta nao configurado para a instancia");
    }

    return data as MetaChannelRow;
  }

  private async loadMockTemplates() {
    if (!this.config.fixturePath) {
      return DEFAULT_MOCK_TEMPLATES;
    }

    const content = await readFile(this.config.fixturePath, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as MetaTemplatePayload[];
    }

    if (typeof parsed === "object" && parsed !== null) {
      const data = (parsed as Record<string, unknown>).data;
      if (Array.isArray(data)) {
        return data as MetaTemplatePayload[];
      }
    }

    return DEFAULT_MOCK_TEMPLATES;
  }

  private async fetchGraphTemplates(channel: MetaChannelRow) {
    if (!channel.waba_id) {
      throw new Error("waba_id Meta ausente para sincronizacao de templates");
    }

    const accessToken = await this.resolveAccessToken(channel);
    const response = await axios.get(
      `https://graph.facebook.com/${this.config.graphApiVersion}/${channel.waba_id}/message_templates`,
      {
        params: { limit: 100 },
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const payload = response.data as { data?: MetaTemplatePayload[] };
    return Array.isArray(payload.data) ? payload.data : [];
  }

  private async createGraphTemplate(channel: MetaChannelRow, payload: {
    name: string;
    language: string;
    category: string;
    components: unknown[];
  }) {
    if (!channel.waba_id) throw new Error("waba_id Meta ausente para criacao de template");
    const accessToken = await this.resolveAccessToken(channel);
    const response = await axios.post(
      `https://graph.facebook.com/${this.config.graphApiVersion}/${channel.waba_id}/message_templates`,
      payload,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const result = (response.data ?? {}) as Record<string, unknown>;
    return {
      id: typeof result.id === "string" ? result.id : undefined,
      name: payload.name,
      language: payload.language,
      category: payload.category,
      status: typeof result.status === "string" ? result.status : "PENDING",
      components: payload.components,
    } satisfies MetaTemplatePayload;
  }

  private async resolveAccessToken(channel: MetaChannelRow) {
    const secretRef = channel.access_token_secret_ref?.trim();
    if (!secretRef || !this.config.resolveSecret) {
      throw new Error("Access token Meta nao configurado para sincronizacao");
    }

    const token = await this.config.resolveSecret(secretRef);
    if (!token?.trim()) {
      throw new Error("Access token Meta nao resolvido para sincronizacao");
    }

    return token.trim();
  }
}

function normalizeTemplateName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function extractTemplateVariables(components: unknown[]) {
  const variables = new Set<string>();
  for (const component of components) {
    if (typeof component !== "object" || component === null) {
      continue;
    }

    const text = (component as Record<string, unknown>).text;
    if (typeof text !== "string") {
      continue;
    }

    for (const match of text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
      variables.add(match[1]);
    }
  }

  return Array.from(variables).sort((left, right) => Number(left) - Number(right));
}
