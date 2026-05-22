import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { EvolutionWhatsAppProvider } from "./evolution-whatsapp-provider.js";
import {
  type MetaChannelConfig,
  MetaWhatsAppProvider,
  type MetaProviderMode,
} from "./meta-whatsapp-provider.js";
import type { WhatsAppProvider, WhatsAppProviderName } from "./whatsapp-provider.js";

export type WhatsAppProviderRegistryConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  evolutionApiUrl: string;
  evolutionApiKey: string;
  metaProviderMode?: string;
  metaGraphApiVersion?: string;
};

export class WhatsAppProviderRegistry {
  private readonly serviceClient: SupabaseClient<any, any, any>;
  private readonly evolutionProvider: EvolutionWhatsAppProvider;
  private readonly metaProvider: MetaWhatsAppProvider;

  constructor(config: WhatsAppProviderRegistryConfig) {
    this.serviceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "crm" },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    this.evolutionProvider = new EvolutionWhatsAppProvider({
      evolutionApiUrl: config.evolutionApiUrl,
      evolutionApiKey: config.evolutionApiKey,
    });

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
    const { data, error } = await this.serviceClient
      .from("instance")
      .select("provider")
      .eq("instancia", instanceName)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data?.provider === "meta" ? "meta" : "evolution";
  }

  private async resolveMetaChannel(instanceName: string): Promise<MetaChannelConfig | null> {
    const { data, error } = await this.serviceClient
      .from("whatsapp_meta_channels")
      .select("instance_name, phone_number_id, access_token_secret_ref")
      .eq("instance_name", instanceName)
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
