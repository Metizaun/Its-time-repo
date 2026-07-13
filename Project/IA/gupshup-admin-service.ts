import { createClient } from "@supabase/supabase-js";
import { GupshupTemplateService, type CreateGupshupTemplateInput } from "./gupshup-template-service.js";

export type GupshupAdminServiceConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
};

export type UpsertGupshupChannelInput = {
  acesId: number;
  instanceName: string;
  appId?: string | null;
  appName: string;
  apiKey?: string | null;
  phoneNumber: string;
  status?: "draft" | "active" | "disabled";
};

type GupshupChannelRow = {
  id: string;
  aces_id: number;
  instance_name: string;
  app_id: string | null;
  app_name: string;
  api_key: string;
  phone_number: string;
  status: "draft" | "active" | "disabled";
  created_at: string;
  updated_at: string;
};

type CrmInstanceRow = { instancia: string };
type MetaInstanceRow = { instance_name: string; provider: string };

export class GupshupAdminService {
  private readonly crmClient;
  private readonly metaClient;
  private readonly gupshupClient;

  constructor(config: GupshupAdminServiceConfig) {
    const opts = { auth: { persistSession: false, autoRefreshToken: false } };
    this.crmClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { db: { schema: "crm" }, ...opts });
    this.metaClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { db: { schema: "meta" }, ...opts });
    this.gupshupClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, { db: { schema: "gupshup" }, ...opts });
  }

  async listChannels(acesId: number) {
    const { data: instances, error: ie } = await this.crmClient
      .from("instance").select("instancia").eq("aces_id", acesId).order("instancia");
    if (ie) throw ie;

    const { data: metaInstances, error: me } = await this.metaClient
      .from("instance").select("instance_name, provider").eq("aces_id", acesId);
    if (me) throw me;

    const { data: channels, error: ce } = await this.gupshupClient
      .from("channel").select("*").eq("aces_id", acesId);
    if (ce) throw ce;

    const metaByName = new Map(((metaInstances ?? []) as MetaInstanceRow[]).map((i) => [i.instance_name, i]));
    const channelByInstance = new Map(((channels ?? []) as GupshupChannelRow[]).map((c) => [c.instance_name, c]));

    return ((instances ?? []) as CrmInstanceRow[]).map((i) => ({
      instanceName: i.instancia,
      provider: metaByName.get(i.instancia)?.provider ?? "evolution",
      gupshupChannel: normalizeChannel(channelByInstance.get(i.instancia) ?? null),
    }));
  }

  async upsertChannel(input: UpsertGupshupChannelInput) {
    const instance = await this.requireInstance(input.acesId, input.instanceName);
    const existing = await this.findChannel(input.acesId, instance.instancia);
    const apiKey = input.apiKey?.trim() || existing?.api_key || null;
    if (!apiKey) throw new Error("API key Gupshup e obrigatoria para criar o canal");
    if ((input.status ?? "draft") === "active" && !input.appId?.trim() && !existing?.app_id?.trim()) {
      throw new Error("appId Gupshup e obrigatorio para ativar o canal");
    }
    const phoneNumber = input.phoneNumber.replace(/\D/g, "");
    if (phoneNumber.length < 10 || phoneNumber.length > 15) {
      throw new Error("Numero do WhatsApp Gupshup invalido");
    }

    const row = {
      aces_id: input.acesId,
      instance_name: instance.instancia,
      app_id: input.appId?.trim() || null,
      app_name: input.appName.trim(),
      api_key: apiKey,
      phone_number: phoneNumber,
      status: input.status ?? "draft",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.gupshupClient
      .from("channel")
      .upsert(row, { onConflict: "aces_id,instance_name" })
      .select("*").single();
    if (error) throw error;

    const channel = data as GupshupChannelRow;
    const newProvider = channel.status === "active" ? "gupshup" : "evolution";

    const { error: providerError } = await this.metaClient.from("instance").upsert(
      { aces_id: input.acesId, instance_name: instance.instancia, provider: newProvider, updated_at: new Date().toISOString() },
      { onConflict: "aces_id,instance_name" }
    );
    if (providerError) throw providerError;

    if (channel.status === "active") {
      const { error: instanceError } = await this.crmClient
        .from("instance")
        .update({
          status: "connected",
          setup_status: "connected",
          connection_mode: "external_webhook",
          remote_webhook_connected_at: new Date().toISOString(),
          setup_expires_at: null,
          last_error: null,
        })
        .eq("aces_id", input.acesId)
        .eq("instancia", instance.instancia);

      if (instanceError) throw instanceError;
    }

    return normalizeChannel(channel);
  }

  async listTemplates(acesId: number, instanceName: string) {
    const channel = await this.findActiveChannel(acesId, instanceName);
    if (!channel) return { instanceName, channel: null, templates: [] };
    if (!channel.app_id) throw new Error("appId Gupshup nao configurado para esta instancia");

    const service = new GupshupTemplateService({ apiKey: channel.api_key, appId: channel.app_id });
    const templates = await service.listTemplates();
    return { instanceName, channel: normalizeChannel(channel), templates };
  }

  async createTemplate(acesId: number, instanceName: string, input: CreateGupshupTemplateInput) {
    const channel = await this.findActiveChannel(acesId, instanceName);
    if (!channel) throw new Error("Canal Gupshup ativo nao encontrado para esta instancia");
    if (!channel.app_id) throw new Error("appId Gupshup nao configurado para esta instancia");

    const service = new GupshupTemplateService({ apiKey: channel.api_key, appId: channel.app_id });
    return service.createTemplate(input);
  }

  async resolveChannel(instanceName: string): Promise<GupshupChannelRow | null> {
    return this.findActiveChannel(null, instanceName, false);
  }

  private async findActiveChannel(acesId: number | null, instanceName: string, requireActive = true) {
    let query = this.gupshupClient.from("channel").select("*").eq("instance_name", instanceName);
    if (acesId !== null) query = query.eq("aces_id", acesId);
    if (requireActive) query = query.eq("status", "active");
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return (data as GupshupChannelRow | null) ?? null;
  }

  private async findChannel(acesId: number, instanceName: string) {
    const { data, error } = await this.gupshupClient
      .from("channel")
      .select("*")
      .eq("aces_id", acesId)
      .eq("instance_name", instanceName)
      .maybeSingle();
    if (error) throw error;
    return (data as GupshupChannelRow | null) ?? null;
  }

  private async requireInstance(acesId: number, instanceName: string) {
    const { data, error } = await this.crmClient
      .from("instance").select("instancia").eq("aces_id", acesId).eq("instancia", instanceName).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Instancia nao encontrada para esta conta");
    return data as CrmInstanceRow;
  }
}

function normalizeChannel(channel: GupshupChannelRow | null) {
  if (!channel) return null;
  return {
    id: channel.id,
    instanceName: channel.instance_name,
    appId: channel.app_id,
    appName: channel.app_name,
    phoneNumber: channel.phone_number,
    status: channel.status,
    createdAt: channel.created_at,
    updatedAt: channel.updated_at,
  };
}
