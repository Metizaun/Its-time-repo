import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { EvolutionWhatsAppProvider } from "./evolution-whatsapp-provider.js";
import {
  type MetaChannelConfig,
  MetaWhatsAppProvider,
  type MetaProviderMode,
} from "./meta-whatsapp-provider.js";
import {
  type SendMediaInput,
  type SendTemplateInput,
  type SendTextInput,
  type WhatsAppProvider,
  WhatsAppProviderError,
  type WhatsAppProviderName,
} from "./whatsapp-provider.js";

export type WhatsAppProviderRegistryConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  evolutionApiUrl: string;
  evolutionApiKey: string;
  metaProviderMode?: string;
  metaGraphApiVersion?: string;
};

export class WhatsAppProviderRegistry {
  private readonly crmClient: SupabaseClient<any, any, any>;
  private readonly metaClient: SupabaseClient<any, any, any>;
  private readonly evolutionProvider: WhatsAppProvider;
  private readonly metaProvider: MetaWhatsAppProvider;
  private readonly defaultEvolutionApiUrl: string;
  private readonly defaultEvolutionApiKey: string;

  constructor(config: WhatsAppProviderRegistryConfig) {
    this.crmClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "crm" },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.metaClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "meta" },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    this.defaultEvolutionApiUrl = config.evolutionApiUrl.replace(/\/$/, "");
    this.defaultEvolutionApiKey = config.evolutionApiKey;
    this.evolutionProvider = {
      sendText: (input) => this.sendEvolutionText(input),
      sendTemplate: (input) => this.sendEvolutionTemplate(input),
      sendMedia: (input) => this.sendEvolutionMedia(input),
    };

    this.metaProvider = new MetaWhatsAppProvider({
      mode: normalizeMetaProviderMode(config.metaProviderMode),
      graphApiVersion: config.metaGraphApiVersion?.trim() || "v20.0",
      resolveChannel: (instanceName) => this.resolveMetaChannel(instanceName),
      resolveSecret: (secretRef) => this.resolveSecret(secretRef),
    });
  }

  getProvider(provider: WhatsAppProviderName): WhatsAppProvider {
    return provider === "meta" ? this.metaProvider : this.evolutionProvider;
  }

  async resolveInstanceProvider(instanceName: string): Promise<WhatsAppProviderName> {
    const { data, error } = await this.metaClient
      .from("instance")
      .select("provider")
      .eq("instance_name", instanceName)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data?.provider === "meta" ? "meta" : "evolution";
  }

  private async resolveMetaChannel(instanceName: string): Promise<MetaChannelConfig | null> {
    const { data, error } = await this.metaClient
      .from("whatsapp_channels")
      .select("instance_name, phone_number_id, access_token_secret_ref")
      .eq("instance_name", instanceName)
      .eq("status", "active")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      instanceName: String(data.instance_name),
      phoneNumberId: typeof data.phone_number_id === "string" ? data.phone_number_id : null,
      accessTokenSecretRef:
        typeof data.access_token_secret_ref === "string" ? data.access_token_secret_ref : null,
    };
  }

  private async resolveEvolutionProvider(instanceName: string) {
    const { data: instance, error: instanceError } = await this.crmClient
      .from("instance")
      .select("instancia, aces_id, connection_mode, remote_evolution_url, remote_instance_name")
      .eq("instancia", instanceName)
      .maybeSingle();

    if (instanceError) {
      throw instanceError;
    }

    if (!instance || instance.connection_mode !== "external_webhook") {
      return {
        provider: new EvolutionWhatsAppProvider({
          evolutionApiUrl: this.defaultEvolutionApiUrl,
          evolutionApiKey: this.defaultEvolutionApiKey,
        }),
        instanceName,
      };
    }

    const { data: credentials, error: credentialError } = await this.crmClient
      .from("instance_provider_credentials")
      .select("evolution_api_key")
      .eq("instance_name", instanceName)
      .eq("aces_id", instance.aces_id)
      .maybeSingle();

    if (credentialError) {
      throw credentialError;
    }

    const evolutionApiUrl = String(instance.remote_evolution_url ?? "").trim().replace(/\/$/, "");
    const remoteInstanceName = String(instance.remote_instance_name ?? "").trim();
    const evolutionApiKey = String(credentials?.evolution_api_key ?? "").trim();

    if (!evolutionApiUrl || !remoteInstanceName || !evolutionApiKey) {
      throw new WhatsAppProviderError(
        "Evolution externa sem URL, nome remoto ou API key. Vincule a instancia novamente.",
        { provider: "evolution", kind: "permanent" }
      );
    }

    return {
      provider: new EvolutionWhatsAppProvider({ evolutionApiUrl, evolutionApiKey }),
      instanceName: remoteInstanceName,
    };
  }

  private async sendEvolutionText(input: SendTextInput) {
    const resolved = await this.resolveEvolutionProvider(input.instanceName);
    return resolved.provider.sendText({ ...input, instanceName: resolved.instanceName });
  }

  private async sendEvolutionTemplate(input: SendTemplateInput) {
    const resolved = await this.resolveEvolutionProvider(input.instanceName);
    return resolved.provider.sendTemplate({ ...input, instanceName: resolved.instanceName });
  }

  private async sendEvolutionMedia(input: SendMediaInput) {
    const resolved = await this.resolveEvolutionProvider(input.instanceName);
    if (!resolved.provider.sendMedia) {
      throw new WhatsAppProviderError("Provider Evolution sem suporte a midia", {
        provider: "evolution",
        kind: "permanent",
      });
    }
    return resolved.provider.sendMedia({ ...input, instanceName: resolved.instanceName });
  }

  private resolveSecret(secretRef: string) {
    return process.env[secretRef] ?? null;
  }
}

function normalizeMetaProviderMode(value: string | undefined): MetaProviderMode {
  return value?.trim().toLowerCase() === "live" ? "live" : "mock";
}

export function createWhatsAppProviderRegistry(config: WhatsAppProviderRegistryConfig) {
  return new WhatsAppProviderRegistry(config);
}
