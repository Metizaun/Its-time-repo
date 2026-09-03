import { createHmac } from "node:crypto";

import axios, { type AxiosInstance } from "axios";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type MetaChannelStatus = "draft" | "active" | "disabled" | "error";

export type MetaOperationalChannel = {
  id: string;
  instanceName: string;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  status: MetaChannelStatus;
  health: "pending_activation" | "healthy" | "disabled" | "error";
  lastTemplateSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MetaBootstrapInput = {
  acesId: number;
  instanceName: string;
  wabaId: string;
  phoneNumberId: string;
  businessId?: string | null;
  accessTokenSecretRef: string;
  appSecretRef: string;
  webhookVerifyTokenSecretRef: string;
  actorId: string;
};

export type MetaBootstrapValidation = {
  wabaName: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
};

export type MetaChannelRow = {
  id: string;
  instance_name: string;
  waba_id: string | null;
  display_phone_number: string | null;
  status: MetaChannelStatus;
  last_template_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

type ResolvedMetaCredentials = {
  accessToken: string;
  appSecret: string;
};

export interface MetaBootstrapRepository {
  validateTarget(acesId: number, instanceName: string): Promise<void>;
  bootstrapChannel(
    input: MetaBootstrapInput,
    validation: MetaBootstrapValidation,
  ): Promise<MetaChannelRow>;
  auditValidationFailure(input: MetaBootstrapInput, errorCode: string): Promise<void>;
}

export interface MetaGraphValidator {
  validateAssets(
    input: Pick<MetaBootstrapInput, "wabaId" | "phoneNumberId" | "businessId">,
    credentials: ResolvedMetaCredentials,
  ): Promise<MetaBootstrapValidation>;
}

export type MetaBootstrapServiceConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  graphApiVersion: string;
  metaAppId: string;
  resolveSecret: (secretRef: string) => Promise<string | null> | string | null;
  repository?: MetaBootstrapRepository;
  graphValidator?: MetaGraphValidator;
};

export class MetaBootstrapError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MetaBootstrapError";
  }
}

export class MetaBootstrapService {
  private readonly repository: MetaBootstrapRepository;
  private readonly graphValidator: MetaGraphValidator;

  constructor(private readonly config: MetaBootstrapServiceConfig) {
    this.repository =
      config.repository ??
      new SupabaseMetaBootstrapRepository(config.supabaseUrl, config.supabaseServiceRoleKey);
    this.graphValidator =
      config.graphValidator ??
      new HttpMetaGraphValidator(config.graphApiVersion, config.metaAppId, axios);
  }

  async bootstrap(input: MetaBootstrapInput) {
    const normalized = normalizeBootstrapInput(input);

    try {
      await this.repository.validateTarget(normalized.acesId, normalized.instanceName);
      const credentials = await this.resolveCredentials(normalized);
      const validation = await this.graphValidator.validateAssets(normalized, credentials);
      const row = await this.repository.bootstrapChannel(normalized, validation);

      return {
        success: true as const,
        channel: toOperationalMetaChannel(row),
        validation,
      };
    } catch (error) {
      const safeError = toSafeBootstrapError(error);
      try {
        await this.repository.auditValidationFailure(normalized, safeError.code);
      } catch {
        // Audit failures must not leak database details or secret material.
      }
      throw safeError;
    }
  }

  private async resolveCredentials(input: MetaBootstrapInput): Promise<ResolvedMetaCredentials> {
    for (const secretRef of [
      input.accessTokenSecretRef,
      input.appSecretRef,
      input.webhookVerifyTokenSecretRef,
    ]) {
      assertSecretReference(secretRef);
    }

    const [accessToken, appSecret, webhookVerifyToken] = await Promise.all([
      this.config.resolveSecret(input.accessTokenSecretRef),
      this.config.resolveSecret(input.appSecretRef),
      this.config.resolveSecret(input.webhookVerifyTokenSecretRef),
    ]);

    if (!accessToken?.trim() || !appSecret?.trim() || !webhookVerifyToken?.trim()) {
      throw new MetaBootstrapError(
        "META_SECRET_NOT_RESOLVED",
        "Uma ou mais credenciais Meta nao puderam ser resolvidas no backend",
      );
    }

    return {
      accessToken: accessToken.trim(),
      appSecret: appSecret.trim(),
    };
  }
}

class SupabaseMetaBootstrapRepository implements MetaBootstrapRepository {
  private readonly crmClient: SupabaseClient<any, any, any>;
  private readonly metaClient: SupabaseClient<any, any, any>;

  constructor(supabaseUrl: string, supabaseServiceRoleKey: string) {
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    this.crmClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      db: { schema: "crm" },
      ...options,
    });
    this.metaClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      db: { schema: "meta" },
      ...options,
    });
  }

  async validateTarget(acesId: number, instanceName: string) {
    const { data: instance, error: instanceError } = await this.crmClient
      .from("instance")
      .select("instancia")
      .eq("aces_id", acesId)
      .eq("instancia", instanceName)
      .maybeSingle();

    if (instanceError) throw instanceError;
    if (!instance) {
      throw new MetaBootstrapError(
        "META_INSTANCE_NOT_FOUND",
        "Instancia nao encontrada para esta conta",
      );
    }

    const { data: binding, error: bindingError } = await this.crmClient
      .from("instance_channels")
      .select("channel_type")
      .eq("aces_id", acesId)
      .eq("instance_name", instanceName)
      .maybeSingle();

    if (bindingError) throw bindingError;
    if (binding && binding.channel_type !== "whatsapp") {
      throw new MetaBootstrapError(
        "META_CHANNEL_TYPE_CONFLICT",
        "A instancia esta vinculada a outro tipo de canal",
      );
    }
  }

  async bootstrapChannel(input: MetaBootstrapInput, validation: MetaBootstrapValidation) {
    const { data, error } = await this.crmClient.rpc("rpc_bootstrap_meta_whatsapp_channel", {
      p_aces_id: input.acesId,
      p_instance_name: input.instanceName,
      p_waba_id: input.wabaId,
      p_phone_number_id: input.phoneNumberId,
      p_business_id: input.businessId ?? null,
      p_display_phone_number: validation.displayPhoneNumber,
      p_access_token_secret_ref: input.accessTokenSecretRef,
      p_app_secret_ref: input.appSecretRef,
      p_webhook_verify_token: input.webhookVerifyTokenSecretRef,
      p_actor_id: input.actorId,
    });

    if (error) throw error;
    return data as MetaChannelRow;
  }

  async auditValidationFailure(input: MetaBootstrapInput, errorCode: string) {
    const { error } = await this.metaClient.from("admin_audit_events").insert({
      aces_id: input.acesId,
      channel_id: null,
      actor_id: input.actorId,
      action: "validation_failed",
      outcome: "failed",
      error_code: errorCode,
      metadata: {
        instanceName: input.instanceName,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
      },
    });

    if (error) throw error;
  }
}

export class HttpMetaGraphValidator implements MetaGraphValidator {
  private readonly graphBaseUrl: string;
  private readonly metaAppId: string;

  constructor(
    graphApiVersion: string,
    metaAppId: string,
    private readonly http: AxiosInstance,
  ) {
    const normalizedVersion = graphApiVersion.trim();
    if (!/^v\d+\.\d+$/.test(normalizedVersion)) {
      throw new MetaBootstrapError(
        "META_GRAPH_VERSION_INVALID",
        "META_GRAPH_API_VERSION invalida",
      );
    }
    this.graphBaseUrl = `https://graph.facebook.com/${normalizedVersion}`;

    this.metaAppId = metaAppId.trim();
    if (!/^\d+$/.test(this.metaAppId)) {
      throw new MetaBootstrapError("META_APP_ID_INVALID", "META_APP_ID invalido");
    }
  }

  async validateAssets(input: Pick<MetaBootstrapInput, "wabaId" | "phoneNumberId" | "businessId">, credentials: ResolvedMetaCredentials) {
    const appSecretProof = createHmac("sha256", credentials.appSecret)
      .update(credentials.accessToken)
      .digest("hex");
    const requestConfig = {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
      params: { appsecret_proof: appSecretProof },
    };

    try {
      const tokenResponse = await graphGet(
        this.http,
        `${this.graphBaseUrl}/debug_token`,
        {
          headers: {
            Authorization: `Bearer ${this.metaAppId}|${credentials.appSecret}`,
          },
          params: { input_token: credentials.accessToken },
        },
        "META_TOKEN_DEBUG_FAILED",
        "Validacao do token Meta falhou",
      );
      const tokenData = tokenResponse.data?.data ?? {};

      if (tokenData.is_valid !== true || String(tokenData.app_id ?? "") !== this.metaAppId) {
        throw new MetaBootstrapError(
          "META_TOKEN_APP_MISMATCH",
          "Token Meta invalido ou vinculado a outro App",
        );
      }

      const grantedScopes = new Set<string>([
        ...(Array.isArray(tokenData.scopes) ? tokenData.scopes.map(String) : []),
        ...(Array.isArray(tokenData.granular_scopes)
          ? tokenData.granular_scopes.map((scope: Record<string, unknown>) =>
              String(scope.scope ?? ""),
            )
          : []),
      ]);
      const missingPermissions = [
        "whatsapp_business_management",
        "whatsapp_business_messaging",
      ].filter((permission) => !grantedScopes.has(permission));

      if (missingPermissions.length > 0) {
        throw new MetaBootstrapError(
          "META_PERMISSIONS_MISSING",
          "Token Meta nao possui as permissoes obrigatorias do WhatsApp",
        );
      }

      const [wabaResponse, phoneNumbersResponse, businessResponse] = await Promise.all([
        graphGet(this.http, `${this.graphBaseUrl}/${encodeURIComponent(input.wabaId)}`, {
          ...requestConfig,
          params: { ...requestConfig.params, fields: "id,name" },
        }, "META_WABA_ACCESS_FAILED", "Validacao de acesso ao WABA falhou"),
        graphGet(this.http, `${this.graphBaseUrl}/${encodeURIComponent(input.wabaId)}/phone_numbers`, {
          ...requestConfig,
          params: {
            ...requestConfig.params,
            fields: "id,display_phone_number,verified_name",
            limit: 100,
          },
        }, "META_PHONE_LIST_FAILED", "Validacao da lista de numeros Meta falhou"),
        input.businessId
          ? graphGet(this.http, `${this.graphBaseUrl}/${encodeURIComponent(input.businessId)}`, {
              ...requestConfig,
              params: { ...requestConfig.params, fields: "id,name" },
            }, "META_BUSINESS_ACCESS_FAILED", "Validacao do Business Meta falhou")
          : Promise.resolve(null),
      ]);

      if (String(wabaResponse.data?.id ?? "") !== input.wabaId) {
        throw new MetaBootstrapError("META_WABA_MISMATCH", "WABA Meta nao corresponde ao ativo informado");
      }

      if (
        input.businessId &&
        String(businessResponse?.data?.id ?? "") !== input.businessId
      ) {
        throw new MetaBootstrapError(
          "META_BUSINESS_MISMATCH",
          "Business portfolio Meta nao corresponde ao ativo informado",
        );
      }

      const phoneNumbers = Array.isArray(phoneNumbersResponse.data?.data)
        ? phoneNumbersResponse.data.data
        : [];
      const phone = phoneNumbers.find(
        (candidate: Record<string, unknown>) => String(candidate.id ?? "") === input.phoneNumberId,
      ) as Record<string, unknown> | undefined;

      if (!phone) {
        throw new MetaBootstrapError(
          "META_PHONE_NOT_IN_WABA",
          "Numero Meta nao pertence ao WABA informado ou nao esta acessivel",
        );
      }

      return {
        wabaName: cleanOptional(wabaResponse.data?.name),
        displayPhoneNumber: cleanOptional(phone.display_phone_number),
        verifiedName: cleanOptional(phone.verified_name),
      };
    } catch (error) {
      if (error instanceof MetaBootstrapError) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : null;
      throw new MetaBootstrapError(
        "META_GRAPH_VALIDATION_FAILED",
        status ? `Validacao dos ativos Meta falhou com status ${status}` : "Validacao dos ativos Meta falhou",
      );
    }
  }
}

export function toOperationalMetaChannel(row: MetaChannelRow): MetaOperationalChannel {
  return {
    id: String(row.id),
    instanceName: String(row.instance_name),
    wabaId: cleanOptional(row.waba_id),
    displayPhoneNumber: cleanOptional(row.display_phone_number),
    status: row.status,
    health: channelHealth(row.status),
    lastTemplateSyncAt: row.last_template_sync_at ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function normalizeBootstrapInput(input: MetaBootstrapInput): MetaBootstrapInput {
  if (!Number.isInteger(input.acesId) || input.acesId <= 0) {
    throw new MetaBootstrapError("META_TENANT_INVALID", "aces_id deve ser um inteiro positivo");
  }

  const normalized = {
    ...input,
    instanceName: input.instanceName.trim(),
    wabaId: input.wabaId.trim(),
    phoneNumberId: input.phoneNumberId.trim(),
    businessId: cleanOptional(input.businessId),
    accessTokenSecretRef: input.accessTokenSecretRef.trim(),
    appSecretRef: input.appSecretRef.trim(),
    webhookVerifyTokenSecretRef: input.webhookVerifyTokenSecretRef.trim(),
    actorId: input.actorId.trim(),
  };

  if (!normalized.instanceName || !normalized.wabaId || !normalized.phoneNumberId) {
    throw new MetaBootstrapError(
      "META_BOOTSTRAP_INPUT_INVALID",
      "Instancia, WABA e phone_number_id sao obrigatorios",
    );
  }
  if (!normalized.actorId) {
    throw new MetaBootstrapError("META_OPERATOR_REQUIRED", "Operador do bootstrap obrigatorio");
  }

  return normalized;
}

function assertSecretReference(secretRef: string) {
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(secretRef)) {
    throw new MetaBootstrapError(
      "META_SECRET_REF_INVALID",
      "Referencia de credencial Meta invalida",
    );
  }
}

function toSafeBootstrapError(error: unknown) {
  if (error instanceof MetaBootstrapError) return error;
  return new MetaBootstrapError(
    "META_BOOTSTRAP_FAILED",
    "Nao foi possivel concluir a configuracao segura do canal Meta",
  );
}

function channelHealth(status: MetaChannelStatus): MetaOperationalChannel["health"] {
  if (status === "active") return "healthy";
  if (status === "disabled") return "disabled";
  if (status === "error") return "error";
  return "pending_activation";
}

function cleanOptional(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function graphGet(
  http: AxiosInstance,
  url: string,
  config: Parameters<AxiosInstance["get"]>[1],
  errorCode: string,
  message: string,
) {
  try {
    return await http.get(url, config);
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : null;
    throw new MetaBootstrapError(
      errorCode,
      status ? `${message} com status ${status}` : message,
    );
  }
}
