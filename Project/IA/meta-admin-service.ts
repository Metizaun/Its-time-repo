import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type MetaAdminServiceConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
};

export type UpsertMetaChannelInput = {
  acesId: number;
  instanceName: string;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  businessId?: string | null;
  displayPhoneNumber?: string | null;
  accessTokenSecretRef?: string | null;
  appSecretRef?: string | null;
  webhookVerifyToken?: string | null;
  status?: "draft" | "active" | "disabled" | "error";
};

type InstanceRow = {
  instancia: string;
  provider: "evolution" | "meta";
  meta_channel_id: string | null;
};

type MetaChannelRow = {
  id: string;
  aces_id: number;
  instance_name: string;
  waba_id: string | null;
  phone_number_id: string | null;
  business_id: string | null;
  display_phone_number: string | null;
  access_token_secret_ref: string | null;
  app_secret_ref: string | null;
  webhook_verify_token: string | null;
  status: "draft" | "active" | "disabled" | "error";
  last_template_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

type MetaTemplateRow = {
  id: string;
  channel_id: string;
  meta_template_id: string | null;
  name: string;
  language: string;
  category: string;
  status: string;
  components_json: unknown;
  variables_json: unknown;
  rejection_reason: string | null;
  last_synced_at: string;
};

export class MetaAdminService {
  private readonly serviceClient: SupabaseClient<any, any, any>;

  constructor(config: MetaAdminServiceConfig) {
    this.serviceClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "crm" },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async listChannels(acesId: number) {
    const { data: instances, error: instanceError } = await this.serviceClient
      .from("instance")
      .select("instancia, provider, meta_channel_id")
      .eq("aces_id", acesId)
      .order("instancia", { ascending: true });

    if (instanceError) {
      throw instanceError;
    }

    const { data: channels, error: channelError } = await this.serviceClient
      .from("whatsapp_meta_channels")
      .select("*")
      .eq("aces_id", acesId);

    if (channelError) {
      throw channelError;
    }

    const channelByInstance = new Map(
      ((channels ?? []) as MetaChannelRow[]).map((channel) => [channel.instance_name, channel])
    );

    return ((instances ?? []) as InstanceRow[]).map((instance) => ({
      instanceName: instance.instancia,
      provider: instance.provider ?? "evolution",
      metaChannelId: instance.meta_channel_id,
      channel: normalizeChannel(channelByInstance.get(instance.instancia) ?? null),
    }));
  }

  async upsertChannel(input: UpsertMetaChannelInput) {
    const instance = await this.requireInstance(input.acesId, input.instanceName);
    const row = {
      aces_id: input.acesId,
      instance_name: instance.instancia,
      waba_id: cleanOptional(input.wabaId),
      phone_number_id: cleanOptional(input.phoneNumberId),
      business_id: cleanOptional(input.businessId),
      display_phone_number: cleanOptional(input.displayPhoneNumber),
      access_token_secret_ref: cleanOptional(input.accessTokenSecretRef),
      app_secret_ref: cleanOptional(input.appSecretRef),
      webhook_verify_token: cleanOptional(input.webhookVerifyToken),
      status: input.status ?? "draft",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.serviceClient
      .from("whatsapp_meta_channels")
      .upsert(row, { onConflict: "aces_id,instance_name" })
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    const channel = data as MetaChannelRow;
    const { error: instanceError } = await this.serviceClient
      .from("instance")
      .update({ meta_channel_id: channel.id })
      .eq("aces_id", input.acesId)
      .eq("instancia", instance.instancia);

    if (instanceError) {
      throw instanceError;
    }

    return normalizeChannel(channel);
  }

  async listTemplates(acesId: number, instanceName: string) {
    const channel = await this.findChannel(acesId, instanceName);
    if (!channel) {
      return {
        instanceName,
        channel: null,
        templates: [],
      };
    }

    const { data, error } = await this.serviceClient
      .from("whatsapp_meta_templates")
      .select("*")
      .eq("channel_id", channel.id)
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return {
      instanceName,
      channel: normalizeChannel(channel),
      templates: ((data ?? []) as MetaTemplateRow[]).map(normalizeTemplate),
    };
  }

  private async requireInstance(acesId: number, instanceName: string) {
    const { data, error } = await this.serviceClient
      .from("instance")
      .select("instancia, provider, meta_channel_id")
      .eq("aces_id", acesId)
      .eq("instancia", instanceName)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error("Instancia nao encontrada para esta conta");
    }

    return data as InstanceRow;
  }

  private async findChannel(acesId: number, instanceName: string) {
    const { data, error } = await this.serviceClient
      .from("whatsapp_meta_channels")
      .select("*")
      .eq("aces_id", acesId)
      .eq("instance_name", instanceName)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data as MetaChannelRow | null) ?? null;
  }
}

function cleanOptional(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeChannel(channel: MetaChannelRow | null) {
  if (!channel) {
    return null;
  }

  return {
    id: channel.id,
    instanceName: channel.instance_name,
    wabaId: channel.waba_id,
    phoneNumberId: channel.phone_number_id,
    businessId: channel.business_id,
    displayPhoneNumber: channel.display_phone_number,
    accessTokenSecretRef: channel.access_token_secret_ref,
    appSecretRef: channel.app_secret_ref,
    webhookVerifyToken: channel.webhook_verify_token,
    status: channel.status,
    lastTemplateSyncAt: channel.last_template_sync_at,
    createdAt: channel.created_at,
    updatedAt: channel.updated_at,
  };
}

function normalizeTemplate(template: MetaTemplateRow) {
  return {
    id: template.id,
    channelId: template.channel_id,
    metaTemplateId: template.meta_template_id,
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    components: template.components_json,
    variables: template.variables_json,
    rejectionReason: template.rejection_reason,
    lastSyncedAt: template.last_synced_at,
  };
}
