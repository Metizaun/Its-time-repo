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
};

type InstanceChannelRow = {
  instance_name: string;
  provider: "evolution" | "meta" | "gupshup" | "instagram";
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
  private readonly crmClient: SupabaseClient<any, any, any>;
  private readonly metaClient: SupabaseClient<any, any, any>;

  constructor(config: MetaAdminServiceConfig) {
    const clientOptions = {
      auth: { persistSession: false, autoRefreshToken: false },
    };

    this.crmClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "crm" },
      ...clientOptions,
    });

    this.metaClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      db: { schema: "meta" },
      ...clientOptions,
    });
  }

  async listChannels(acesId: number) {
    const { data: instances, error: instanceError } = await this.crmClient
      .from("instance")
      .select("instancia")
      .eq("aces_id", acesId)
      .order("instancia", { ascending: true });

    if (instanceError) {
      throw instanceError;
    }

    const { data: instanceChannels, error: instanceChannelError } = await this.crmClient
      .from("instance_channels")
      .select("instance_name, provider")
      .eq("aces_id", acesId);

    if (instanceChannelError) {
      throw instanceChannelError;
    }

    const { data: channels, error: channelError } = await this.metaClient
      .from("whatsapp_channels")
      .select("*")
      .eq("aces_id", acesId);

    if (channelError) {
      throw channelError;
    }

    const instanceChannelByName = new Map(
      ((instanceChannels ?? []) as InstanceChannelRow[]).map((instance) => [
        instance.instance_name,
        instance,
      ])
    );
    const channelByInstance = new Map(
      ((channels ?? []) as MetaChannelRow[]).map((channel) => [channel.instance_name, channel])
    );

    return ((instances ?? []) as InstanceRow[]).map((instance) => {
      const instanceChannel = instanceChannelByName.get(instance.instancia) ?? null;
      const channel = channelByInstance.get(instance.instancia) ?? null;

      return {
        instanceName: instance.instancia,
        provider: instanceChannel?.provider ?? null,
        metaChannelId: channel?.id ?? null,
        channel: normalizeChannel(channel),
      };
    });
  }

  async upsertChannel(input: UpsertMetaChannelInput) {
    const instance = await this.requireInstance(input.acesId, input.instanceName);
    const { data, error } = await this.crmClient.rpc("rpc_upsert_meta_whatsapp_channel", {
      p_aces_id: input.acesId,
      p_instance_name: instance.instancia,
      p_waba_id: cleanOptional(input.wabaId),
      p_phone_number_id: cleanOptional(input.phoneNumberId),
      p_business_id: cleanOptional(input.businessId),
      p_display_phone_number: cleanOptional(input.displayPhoneNumber),
      p_access_token_secret_ref: cleanOptional(input.accessTokenSecretRef),
      p_app_secret_ref: cleanOptional(input.appSecretRef),
      p_webhook_verify_token: cleanOptional(input.webhookVerifyToken),
      p_status: input.status ?? "draft",
    });

    if (error) {
      throw error;
    }

    return normalizeChannel(data as MetaChannelRow);
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

    const { data, error } = await this.metaClient
      .from("whatsapp_templates")
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
    const { data, error } = await this.crmClient
      .from("instance")
      .select("instancia")
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
    const { data, error } = await this.metaClient
      .from("whatsapp_channels")
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
