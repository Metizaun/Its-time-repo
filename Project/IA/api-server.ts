import "./load-env.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { createClient } from "@supabase/supabase-js";
import {
  AgentManager,
  DEFAULT_SYSTEM_MESSAGE,
  HttpError,
  parseEvolutionWebhookPayload,
  type WebhookPayload,
} from "./sdr-agent-gemini.js";
import { assertRuntimeSchemaCompatibility } from "./schema-preflight.js";
import { startAutomationWorker } from "./automation-worker.js";
import { RbBillingWorker } from "./rb-billing-worker.js";
import { MetaWebhookProcessor } from "./meta-webhook.js";
import { MetaTemplateService } from "./meta-template-service.js";
import { MetaAdminService } from "./meta-admin-service.js";
import { GupshupWebhookProcessor } from "./gupshup-webhook.js";
import { GupshupAdminService } from "./gupshup-admin-service.js";

type AuthenticatedRequest = Request & {
  authContext?: Awaited<ReturnType<AgentManager["authenticate"]>>;
};

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

type CrmUserRole = "NENHUM" | "VENDEDOR" | "ADMIN";

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function summarizeEvolutionWebhookPayload(payload: WebhookPayload) {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const key = asRecord(data.key);
  const messageData = asRecord(data.messageData);
  const messageDataKey = asRecord(messageData.key);

  try {
    const parsed = parseEvolutionWebhookPayload(payload);
    return {
      event: asString(root.event),
      instance: parsed.instanceName,
      messageId: parsed.messageId,
      fromMe: parsed.fromMe,
      phone: parsed.phone,
      conversationId: parsed.conversationId,
      messageType: parsed.messageType,
      remoteJid: asString(parsed.raw.remoteJid),
      remoteJidAlt: asString(parsed.raw.remoteJidAlt),
      senderPn: asString(parsed.raw.senderPn),
      participantPn: asString(parsed.raw.participantPn),
    };
  } catch {
    return {
      event: asString(root.event),
      instance:
        asString(root.instance) ??
        asString(root.instanceName) ??
        asString(data.instance) ??
        asString(data.instanceName),
      messageId: asString(key.id) ?? asString(messageDataKey.id) ?? asString(root.messageId),
      fromMe: Boolean(key.fromMe ?? messageDataKey.fromMe ?? data.fromMe ?? root.fromMe),
      phone: null,
      conversationId: null,
      messageType: asString(data.messageType) ?? asString(root.messageType),
      remoteJid: asString(key.remoteJid) ?? asString(messageDataKey.remoteJid) ?? asString(data.remoteJid),
      remoteJidAlt:
        asString(key.remoteJidAlt) ??
        asString(messageDataKey.remoteJidAlt) ??
        asString(data.remoteJidAlt),
      senderPn: asString(key.senderPn) ?? asString(messageDataKey.senderPn) ?? asString(data.senderPn),
      participantPn:
        asString(key.participantPn) ??
        asString(messageDataKey.participantPn) ??
        asString(data.participantPn),
    };
  }
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

function getSingleParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function resolveEnvSecretRef(secretRef: string | undefined) {
  return secretRef?.trim() ? process.env[secretRef.trim()] ?? null : null;
}

function getSupabaseUrl() {
  return requireEnv("SUPABASE_URL").replace(/\/$/, "");
}

function getSupabasePublicKey() {
  return process.env.SUPABASE_ANON_KEY || requireEnv("SUPABASE_KEY");
}

function createUserScopedSupabaseClient(accessToken: string) {
  return createClient(getSupabaseUrl(), getSupabasePublicKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "crm" },
  });
}

function createServiceSupabaseClient() {
  return createClient(getSupabaseUrl(), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "crm" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readBackendError(payload: unknown, fallback: string) {
  const record = asRecord(payload);
  return typeof record.error === "string"
    ? record.error
    : typeof record.message === "string"
      ? record.message
      : fallback;
}

async function forwardSupabaseFunction(functionName: string, accessToken: string, body: unknown) {
  const response = await fetch(`${getSupabaseUrl()}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: getSupabasePublicKey(),
    },
    body: JSON.stringify(body ?? {}),
  });

  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    throw new HttpError(
      response.status,
      readBackendError(payload, `Falha ao chamar funcao ${functionName}`),
      payload
    );
  }

  return payload;
}

function resolveMetaWebhookAppSecret() {
  const mode = (process.env.META_PROVIDER_MODE ?? "mock").trim().toLowerCase();
  return (
    process.env.META_WEBHOOK_APP_SECRET?.trim() ||
    process.env.META_APP_SECRET?.trim() ||
    resolveEnvSecretRef(process.env.META_WEBHOOK_APP_SECRET_REF) ||
    (mode === "mock" ? "local-dev-app-secret" : null)
  );
}

const manager = new AgentManager({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || requireEnv("SUPABASE_KEY"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiFallbackModels: (process.env.GEMINI_FALLBACK_MODELS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  geminiMaxRetries: Number(process.env.GEMINI_MAX_RETRIES ?? 3),
  geminiRetryBaseDelayMs: Number(process.env.GEMINI_RETRY_BASE_DELAY_MS ?? 1000),
  crmAnalysisWorkerModel: process.env.CRM_ANALYSIS_WORKER_MODEL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL,
  openaiVisionModel: process.env.OPENAI_VISION_MODEL,
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  elevenLabsDefaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID,
  elevenLabsModel: process.env.ELEVENLABS_TTS_MODEL,
  elevenLabsOutputFormat: process.env.ELEVENLABS_OUTPUT_FORMAT,
  elevenLabsTtsEnabled: process.env.ELEVENLABS_TTS_ENABLED === "true",
  visagismToolEnabled: process.env.VISAGISM_TOOL_ENABLED === "true",
  visagismInternalRuntimeEnabled: process.env.VISAGISM_INTERNAL_RUNTIME_ENABLED !== "false",
  visagismAnalysisWorkerModel: process.env.VISAGISM_ANALYSIS_WORKER_MODEL,
  visagismMatchingWorkerModel: process.env.VISAGISM_MATCHING_WORKER_MODEL,
  visagismImageWorkerModel: process.env.VISAGISM_IMAGE_WORKER_MODEL,
  prescriptionWorkerEnabled: process.env.PRESCRIPTION_WORKER_ENABLED !== "false",
  prescriptionWorkerModel: process.env.PRESCRIPTION_WORKER_MODEL,
  toolMediaAllowedHosts: (process.env.TOOL_MEDIA_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
  redisUrl: process.env.REDIS_URL,
  evolutionApiUrl: requireEnv("EVOLUTION_API_URL"),
  evolutionApiKey: requireEnv("EVOLUTION_API_KEY"),
  evolutionWebhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET,
  webhookPublicBaseUrl:
    process.env.CRM_BACKEND_PUBLIC_URL ??
    process.env.BACKEND_PUBLIC_URL ??
    process.env.WEBHOOK_PUBLIC_BASE_URL ??
    process.env.VITE_CRM_BACKEND_URL ??
    process.env.CRM_BACKEND_URL,
  chatCacheTtlSeconds: Number(process.env.CHAT_CACHE_TTL_SECONDS ?? 60),
  chatSignedDownloadTtlSeconds: Number(process.env.CHAT_SIGNED_DOWNLOAD_TTL_SECONDS ?? 900),
  chatAttachmentUploadIntentTtlMinutes: Number(
    process.env.CHAT_ATTACHMENTS_UPLOAD_INTENT_TTL_MINUTES ?? 120
  ),
  instancePhoneAllowlists: {
    mamis: ["554199031152"],
  },
});

const metaWebhookProcessor = new MetaWebhookProcessor({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  verifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? "local-dev-verify-token",
  appSecret: resolveMetaWebhookAppSecret(),
});

const metaTemplateService = new MetaTemplateService({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  providerMode: process.env.META_PROVIDER_MODE?.trim().toLowerCase() === "live" ? "live" : "mock",
  graphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v20.0",
  fixturePath: process.env.META_TEMPLATES_FIXTURE_PATH,
  resolveSecret: (secretRef) => resolveEnvSecretRef(secretRef),
});

const metaAdminService = new MetaAdminService({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
});

const rbBillingWorker = new RbBillingWorker({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  mockFixturePath: process.env.RB_BILLING_MOCK_FIXTURE_PATH,
  pollMs: Number(process.env.RB_BILLING_WORKER_POLL_MS ?? 60000),
});

const gupshupWebhookProcessor = new GupshupWebhookProcessor({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  processInboundMessage: (acesId, message) => manager.processProviderInboundWebhook(acesId, message),
});

const gupshupAdminService = new GupshupAdminService({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
});

const app = express();
app.use(
  express.json({
    limit: process.env.JSON_BODY_LIMIT ?? process.env.WEBHOOK_JSON_LIMIT ?? "150mb",
    verify: (req, _res, buf) => {
      if (req.url?.startsWith("/api/webhook/meta")) {
        (req as RawBodyRequest).rawBody = Buffer.from(buf);
      }
    },
  })
);

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:8080,http://127.0.0.1:8080")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-webhook-secret, x-evolution-secret, x-gupshup-secret, x-hub-signature-256"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).send();
    return;
  }

  next();
});

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

const authMiddleware = asyncHandler(async (req: AuthenticatedRequest, _res, next) => {
  req.authContext = await manager.authenticate(req.headers.authorization);
  next();
});

const webhookHandler = asyncHandler(async (req, res) => {
  const startedAt = Date.now();
  const summary = summarizeEvolutionWebhookPayload(req.body as WebhookPayload);
  const providedSecret =
    req.header("x-webhook-secret") ||
    req.header("x-evolution-secret") ||
    req.header("authorization");

  if (!manager.validateWebhookSecret(providedSecret)) {
    throw new HttpError(401, "Webhook da Evolution sem credencial valida");
  }

  try {
    const result = await manager.processEvolutionWebhook(req.body as WebhookPayload);
    console.info("[crm-ai-webhook] Evolution webhook processado:", {
      ...summary,
      result,
      elapsedMs: Date.now() - startedAt,
    });
    res.status(202).json(result);
  } catch (error) {
    console.error("[crm-ai-webhook] Evolution webhook falhou:", {
      ...summary,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
});

const metaWebhookHandler = asyncHandler(async (req, res) => {
  const signature = req.header("x-hub-signature-256");
  if (!metaWebhookProcessor.verifySignature((req as RawBodyRequest).rawBody, signature)) {
    throw new HttpError(401, "Webhook da Meta sem assinatura valida");
  }

  const result = await metaWebhookProcessor.processWebhook(req.body);
  res.status(202).json(result);
});

function isGupshupValidationProbe(req: Request): boolean {
  const rawBody = (req as RawBodyRequest).rawBody;
  if (rawBody && rawBody.length > 0) {
    return false;
  }

  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? asRecord(req.body)
      : null;

  if (body && Object.keys(body).length > 0) {
    return false;
  }

  return true;
}

const gupshupWebhookHandler = asyncHandler(async (req, res) => {
  if (isGupshupValidationProbe(req)) {
    res.status(204).end();
    return;
  }

  const configuredSecret = process.env.GUPSHUP_WEBHOOK_SECRET?.trim() || null;
  const providedSecret =
    req.header("x-gupshup-secret") ||
    req.header("x-webhook-secret") ||
    asString(req.query.secret);

  if (configuredSecret && providedSecret !== configuredSecret) {
    throw new HttpError(401, "Webhook da Gupshup sem credencial valida");
  }

  if (!configuredSecret && process.env.NODE_ENV === "production") {
    throw new HttpError(503, "GUPSHUP_WEBHOOK_SECRET nao configurado");
  }

  await gupshupWebhookProcessor.processWebhook(req.body);
  res.status(204).end();
});

const gupshupWebhookProbeHandler = (_req: Request, res: Response) => {
  res.status(204).end();
};

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "crm-ai-backend",
    defaultSystemMessage: DEFAULT_SYSTEM_MESSAGE,
  });
});

app.get("/api/webhook/meta", (req, res) => {
  const challenge = metaWebhookProcessor.verifyChallenge(req.query as Record<string, unknown>);
  if (!challenge) {
    res.status(403).send("Forbidden");
    return;
  }

  res.status(200).send(challenge);
});

app.post("/api/webhook/meta", metaWebhookHandler);
app.get("/api/webhook/gupshup", gupshupWebhookProbeHandler);
app.head("/api/webhook/gupshup", gupshupWebhookProbeHandler);
app.post("/api/webhook/gupshup", gupshupWebhookHandler);
app.post("/webhook/evolution", webhookHandler);
app.post("/api/webhook/evolution", webhookHandler);

app.post(
  "/api/meta/templates/sync",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem sincronizar templates Meta");
    }

    const instanceName = String(req.body.instanceName ?? "").trim();
    if (!instanceName) {
      throw new HttpError(400, "instanceName e obrigatorio");
    }

    const result = await metaTemplateService.syncTemplatesForInstance(instanceName);
    res.json({ success: true, ...result });
  })
);

app.get(
  "/api/meta/channels",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem consultar canais Meta");
    }

    const channels = await metaAdminService.listChannels(context.acesId);
    res.json({ success: true, channels });
  })
);

app.post(
  "/api/meta/channels",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem configurar canais Meta");
    }

    const instanceName = String(req.body.instanceName ?? "").trim();
    if (!instanceName) {
      throw new HttpError(400, "instanceName e obrigatorio");
    }

    const channel = await metaAdminService.upsertChannel({
      acesId: context.acesId,
      instanceName,
      wabaId: typeof req.body.wabaId === "string" ? req.body.wabaId : null,
      phoneNumberId: typeof req.body.phoneNumberId === "string" ? req.body.phoneNumberId : null,
      businessId: typeof req.body.businessId === "string" ? req.body.businessId : null,
      displayPhoneNumber:
        typeof req.body.displayPhoneNumber === "string" ? req.body.displayPhoneNumber : null,
      accessTokenSecretRef:
        typeof req.body.accessTokenSecretRef === "string" ? req.body.accessTokenSecretRef : null,
      appSecretRef: typeof req.body.appSecretRef === "string" ? req.body.appSecretRef : null,
      webhookVerifyToken:
        typeof req.body.webhookVerifyToken === "string" ? req.body.webhookVerifyToken : null,
      status: ["draft", "active", "disabled", "error"].includes(String(req.body.status))
        ? req.body.status
        : "draft",
    });

    res.json({ success: true, channel });
  })
);

app.get(
  "/api/meta/templates",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem consultar templates Meta");
    }

    const instanceName = String(req.query.instanceName ?? "").trim();
    if (!instanceName) {
      throw new HttpError(400, "instanceName e obrigatorio");
    }

    const result = await metaAdminService.listTemplates(context.acesId, instanceName);
    res.json({ success: true, ...result });
  })
);

app.get(
  "/api/gupshup/channels",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem consultar canais Gupshup");
    }

    const channels = await gupshupAdminService.listChannels(context.acesId);
    res.json({ success: true, channels });
  })
);

app.post(
  "/api/gupshup/channels",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem configurar canais Gupshup");
    }

    const instanceName = asString(req.body.instanceName);
    const appName = asString(req.body.appName);
    const apiKey = asString(req.body.apiKey);
    const phoneNumber = asString(req.body.phoneNumber);
    if (!instanceName || !appName || !apiKey || !phoneNumber) {
      throw new HttpError(400, "instanceName, appName, apiKey e phoneNumber sao obrigatorios");
    }

    const requestedStatus = asString(req.body.status);
    const status = ["draft", "active", "disabled"].includes(requestedStatus ?? "")
      ? (requestedStatus as "draft" | "active" | "disabled")
      : "draft";
    const channel = await gupshupAdminService.upsertChannel({
      acesId: context.acesId,
      instanceName,
      appId: asString(req.body.appId),
      appName,
      apiKey,
      phoneNumber,
      status,
    });

    res.json({ success: true, channel });
  })
);

app.get(
  "/api/gupshup/templates",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem consultar templates Gupshup");
    }

    const instanceName = asString(req.query.instanceName);
    if (!instanceName) throw new HttpError(400, "instanceName e obrigatorio");

    const result = await gupshupAdminService.listTemplates(context.acesId, instanceName);
    res.json({ success: true, ...result });
  })
);

app.post(
  "/api/gupshup/templates",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem criar templates Gupshup");
    }

    const instanceName = asString(req.body.instanceName);
    const elementName = asString(req.body.elementName);
    const content = asString(req.body.content);
    if (!instanceName || !elementName || !content) {
      throw new HttpError(400, "instanceName, elementName e content sao obrigatorios");
    }

    const template = await gupshupAdminService.createTemplate(context.acesId, instanceName, {
      elementName,
      content,
      languageCode: asString(req.body.languageCode) ?? undefined,
      category: asString(req.body.category) ?? undefined,
      templateType: asString(req.body.templateType) ?? undefined,
      vertical: asString(req.body.vertical) ?? undefined,
      example: asString(req.body.example) ?? undefined,
    });
    res.status(201).json({ success: true, template });
  })
);

app.get(
  "/api/crm/profile",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    res.json({
      success: true,
      profile: {
        id: context.crmUserId,
        auth_user_id: context.authUserId,
        aces_id: context.acesId,
        role: context.role,
        name: context.name,
      },
    });
  })
);

app.get(
  "/api/crm/instances",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    const supabaseAdmin = createServiceSupabaseClient();
    let query = supabaseAdmin
      .from("instance")
      .select("instancia, color, aces_id, status, setup_status, created_by")
      .eq("aces_id", context.acesId)
      .or("setup_status.is.null,setup_status.neq.cancelled")
      .order("instancia");

    if (context.role !== "ADMIN") {
      query = query.eq("created_by", context.crmUserId);
    }

    const { data, error } = await query;

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar instancias", error);
    }

    res.json({ success: true, instances: data ?? [] });
  })
);

app.get(
  "/api/automation/media-assets",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = asString(req.query.instanceName);
    const assets = await manager.listAutomationMediaAssets(req.authContext!, instanceName);
    res.json({ success: true, assets });
  })
);

app.post(
  "/api/automation/media-assets/upload-url",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const mediaKind = req.body.kind === "document" ? "document" : "image";
    const result = await manager.createAutomationMediaUploadUrl(req.authContext!, {
      instanceName: String(req.body.instanceName ?? ""),
      fileName: String(req.body.fileName ?? ""),
      mimeType: String(req.body.mimeType ?? ""),
      fileSize: Number(req.body.fileSize ?? 0),
      kind: mediaKind,
    });

    res.json(result);
  })
);

app.post(
  "/api/automation/media-assets/complete-upload",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await manager.completeAutomationMediaUpload(
      req.authContext!,
      String(req.body.assetId ?? "")
    );
    res.json(result);
  })
);

app.post(
  "/api/buscar-leads",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const payload = await forwardSupabaseFunction(
      "buscar-leads",
      req.authContext!.accessToken,
      req.body
    );
    res.json(payload);
  })
);

app.post(
  "/api/leads/import-csv",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const payload = await forwardSupabaseFunction(
      "import-leads-csv",
      req.authContext!.accessToken,
      req.body
    );
    res.json(payload);
  })
);

app.get(
  "/api/admin/users",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem listar usuarios");
    }

    const supabaseAdmin = createServiceSupabaseClient();
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, auth_user_id, email, name, role, created_at")
      .eq("aces_id", context.acesId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar usuarios", error);
    }

    res.json({ success: true, users: data ?? [] });
  })
);

app.patch(
  "/api/admin/users/:id/role",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem atualizar usuarios");
    }

    const role = String(req.body.role ?? "").toUpperCase();
    if (role !== "ADMIN" && role !== "VENDEDOR" && role !== "NENHUM") {
      throw new HttpError(400, "Role invalida");
    }

    const supabaseAdmin = createServiceSupabaseClient();
    const { data, error } = await supabaseAdmin
      .from("users")
      .update({ role: role as CrmUserRole })
      .eq("id", getSingleParam(req.params.id))
      .eq("aces_id", context.acesId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "Nao foi possivel atualizar role", error);
    }

    if (!data) {
      throw new HttpError(404, "Usuario nao encontrado");
    }

    res.json({ success: true });
  })
);

app.get(
  "/api/admin/invitations/pending",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem listar convites");
    }

    const supabaseUser = createUserScopedSupabaseClient(context.accessToken);
    const { data, error } = await supabaseUser.rpc("get_pending_invitations");

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar convites", error);
    }

    res.json({ success: true, invitations: data ?? [] });
  })
);

app.post(
  "/api/admin/users/invite",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem convidar usuarios");
    }

    const email = String(req.body.email ?? "").trim();
    const name = String(req.body.name ?? "").trim();
    const role = String(req.body.role ?? "NENHUM").toUpperCase();

    if (!email) {
      throw new HttpError(400, "Email e obrigatorio");
    }

    if (role !== "ADMIN" && role !== "VENDEDOR" && role !== "NENHUM") {
      throw new HttpError(400, "Role invalida");
    }

    const supabaseUser = createUserScopedSupabaseClient(context.accessToken);
    const { data, error } = await supabaseUser.rpc("invite_user_to_company", {
      p_email: email,
      p_name: name,
      p_role: role,
    });

    if (error) {
      throw new HttpError(500, "Nao foi possivel criar convite", error);
    }

    const invitePayload = asRecord(data);
    if (invitePayload.success === false) {
      throw new HttpError(
        400,
        typeof invitePayload.error === "string" ? invitePayload.error : "Erro ao criar convite",
        invitePayload
      );
    }

    const invitationId = String(invitePayload.invitation_id ?? "");
    if (!invitationId) {
      throw new HttpError(500, "Convite criado sem identificador");
    }

    const edgePayload = await forwardSupabaseFunction(
      "send-user-invitation",
      context.accessToken,
      { email, invitationId }
    );

    res.json({ success: true, invitationId, invitation: invitePayload, emailResult: edgePayload });
  })
);

app.post(
  "/api/admin/invitations/:id/cancel",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem cancelar convites");
    }

    const supabaseUser = createUserScopedSupabaseClient(context.accessToken);
    const { data, error } = await supabaseUser.rpc("cancel_invitation", {
      p_invitation_id: getSingleParam(req.params.id),
    });

    if (error) {
      throw new HttpError(500, "Nao foi possivel cancelar convite", error);
    }

    const payload = asRecord(data);
    if (payload.success === false) {
      throw new HttpError(
        400,
        typeof payload.error === "string" ? payload.error : "Erro ao cancelar convite",
        payload
      );
    }

    res.json({ success: true });
  })
);

app.post(
  "/api/chat/attachments/upload-url",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await manager.createChatAttachmentUploadUrl(req.authContext!, {
      leadId: String(req.body.leadId ?? ""),
      instanceName:
        typeof req.body.instanceName === "string" ? req.body.instanceName : null,
      fileName: String(req.body.fileName ?? ""),
      mimeType: String(req.body.mimeType ?? ""),
      fileSize: Number(req.body.fileSize ?? 0),
      kind: String(req.body.kind ?? "") as "image" | "audio" | "document",
    });

    res.json(result);
  })
);

app.post(
  "/api/chat/send-manual",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    const attachmentInput = asRecord(req.body.attachment);
    const result = await manager.sendManualMessage(context, {
      leadId: String(req.body.leadId ?? ""),
      content: typeof req.body.content === "string" ? req.body.content : "",
      instanceName:
        typeof req.body.instanceName === "string" ? req.body.instanceName : null,
      attachment: req.body.attachment
        ? {
            messageId: String(attachmentInput.messageId ?? ""),
            attachmentId: String(attachmentInput.attachmentId ?? ""),
            storagePath: String(attachmentInput.storagePath ?? ""),
            fileName: String(attachmentInput.fileName ?? ""),
            mimeType: String(attachmentInput.mimeType ?? ""),
            fileSize: Number(attachmentInput.fileSize ?? 0),
            kind: String(attachmentInput.kind ?? "") as "image" | "audio" | "document",
          }
        : null,
    });

    res.json(result);
  })
);

app.get(
  "/api/chat/leads/:leadId/messages",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await manager.listChatMessages(
      req.authContext!,
      getSingleParam(req.params.leadId)
    );
    res.json(result);
  })
);

app.get(
  "/api/chat/leads/:leadId/ai-state",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const leadId = getSingleParam(req.params.leadId);
    const result = await manager.getLeadAiState(req.authContext!, leadId);
    res.json(result);
  })
);

app.put(
  "/api/chat/leads/:leadId/ai-state",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (typeof req.body.enabled !== "boolean") {
      throw new HttpError(400, "Campo enabled e obrigatorio");
    }

    const leadId = getSingleParam(req.params.leadId);
    const result = await manager.updateLeadAiState(
      req.authContext!,
      leadId,
      req.body.enabled
    );
    res.json(result);
  })
);

app.post(
  "/api/chat/leads/:leadId/handoff/finalize",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const leadId = getSingleParam(req.params.leadId);
    const result = await manager.finalizeHumanHandoff(req.authContext!, {
      leadId,
      stageId: String(req.body.stageId ?? ""),
    });
    res.json(result);
  })
);

app.post(
  "/api/ai-agents/handoff/test",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await manager.testHandoff(req.authContext!, {
      instanceName: String(req.body.instanceName ?? ""),
      targetPhone: String(req.body.targetPhone ?? ""),
      agentName: typeof req.body.agentName === "string" ? req.body.agentName : undefined,
      handoffPrompt:
        typeof req.body.handoffPrompt === "string" ? req.body.handoffPrompt : undefined,
    });

    res.json(result);
  })
);

app.post(
  "/api/instances",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await manager.createInstanceConnection(req.authContext!, {
      instanceName: String(req.body.instanceName ?? ""),
      connectWebhook: req.body.connectWebhook === true,
      remoteEvolutionUrl:
        typeof req.body.remoteEvolutionUrl === "string" ? req.body.remoteEvolutionUrl : null,
      remoteApiKey:
        typeof req.body.remoteApiKey === "string" ? req.body.remoteApiKey : null,
      remoteInstanceName:
        typeof req.body.remoteInstanceName === "string" ? req.body.remoteInstanceName : null,
    });

    res.status(201).json(result);
  })
);

app.get(
  "/api/instances",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instances = await manager.listInstances(req.authContext!);
    res.json({ success: true, instances });
  })
);

app.post(
  "/api/instances/:name/reconnect",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = getSingleParam(req.params.name);
    const result = await manager.reconnectInstance(req.authContext!, instanceName);
    res.json(result);
  })
);

app.get(
  "/api/instances/:name/qrcode",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = getSingleParam(req.params.name);
    const result = await manager.getInstanceQrCode(req.authContext!, instanceName);
    res.json(result);
  })
);

app.get(
  "/api/instances/:name/status",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = getSingleParam(req.params.name);
    const result = await manager.getInstanceStatus(req.authContext!, instanceName);
    res.json(result);
  })
);

app.post(
  "/api/instances/:name/sync-status",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = getSingleParam(req.params.name);
    const result = await manager.getInstanceStatus(req.authContext!, instanceName);
    res.json(result);
  })
);

app.post(
  "/api/instances/:name/disconnect",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = getSingleParam(req.params.name);
    const result = await manager.disconnectInstance(req.authContext!, instanceName);
    res.json(result);
  })
);

app.delete(
  "/api/instances/:name",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = getSingleParam(req.params.name);
    const hardDelete = String(req.query.hard ?? "").toLowerCase() === "true";
    const result = await manager.deleteInstance(req.authContext!, instanceName, {
      hardDelete,
      leadAction:
        req.body?.leadAction === "transfer" || req.body?.leadAction === "delete" || req.body?.leadAction === "none"
          ? req.body.leadAction
          : undefined,
      transferToInstanceName:
        typeof req.body?.transferToInstanceName === "string" ? req.body.transferToInstanceName : undefined,
      confirmationText:
        typeof req.body?.confirmationText === "string" ? req.body.confirmationText : undefined,
    });
    res.json(result);
  })
);

app.get(
  "/api/agent-templates",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const templates = await manager.listAgentTemplates(req.authContext!);
    res.json({ success: true, templates });
  })
);

app.get(
  "/api/ai-agents",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agents = await manager.listAgents(req.authContext!);
    res.json({ success: true, agents });
  })
);

app.post(
  "/api/ai-agents",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agent = await manager.createAgent(req.authContext!, {
      name: String(req.body.name ?? ""),
      instanceName: String(req.body.instanceName ?? ""),
      systemPrompt:
        typeof req.body.systemPrompt === "string" ? req.body.systemPrompt : undefined,
      model: typeof req.body.model === "string" ? req.body.model : undefined,
      provider: req.body.provider === "gemini" ? "gemini" : undefined,
      temperature:
        typeof req.body.temperature === "number" ? req.body.temperature : undefined,
      isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : undefined,
      bufferWaitMs:
        typeof req.body.bufferWaitMs === "number" ? req.body.bufferWaitMs : undefined,
      humanPauseMinutes:
        typeof req.body.humanPauseMinutes === "number"
          ? req.body.humanPauseMinutes
          : undefined,
      autoApplyThreshold:
        typeof req.body.autoApplyThreshold === "number"
          ? req.body.autoApplyThreshold
          : undefined,
      handoffEnabled:
        typeof req.body.handoffEnabled === "boolean" ? req.body.handoffEnabled : undefined,
      handoffPrompt:
        typeof req.body.handoffPrompt === "string" ? req.body.handoffPrompt : undefined,
      handoffTargetPhone:
        typeof req.body.handoffTargetPhone === "string"
          ? req.body.handoffTargetPhone
          : undefined,
      rbTokenApi:
        typeof req.body.rbTokenApi === "string" ? req.body.rbTokenApi : undefined,
      unansweredFollowupEnabled:
        typeof req.body.unansweredFollowupEnabled === "boolean"
          ? req.body.unansweredFollowupEnabled
          : undefined,
      templateKey:
        typeof req.body.templateKey === "string" ? req.body.templateKey : undefined,
    });

    res.status(201).json({ success: true, agent });
  })
);

app.patch(
  "/api/ai-agents/:id",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const agent = await manager.updateAgent(req.authContext!, agentId, {
      name: typeof req.body.name === "string" ? req.body.name : undefined,
      instanceName:
        typeof req.body.instanceName === "string" ? req.body.instanceName : undefined,
      systemPrompt:
        typeof req.body.systemPrompt === "string" ? req.body.systemPrompt : undefined,
      model: typeof req.body.model === "string" ? req.body.model : undefined,
      provider: req.body.provider === "gemini" ? "gemini" : undefined,
      temperature:
        typeof req.body.temperature === "number" ? req.body.temperature : undefined,
      isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : undefined,
      bufferWaitMs:
        typeof req.body.bufferWaitMs === "number" ? req.body.bufferWaitMs : undefined,
      humanPauseMinutes:
        typeof req.body.humanPauseMinutes === "number"
          ? req.body.humanPauseMinutes
          : undefined,
      autoApplyThreshold:
        typeof req.body.autoApplyThreshold === "number"
          ? req.body.autoApplyThreshold
          : undefined,
      handoffEnabled:
        typeof req.body.handoffEnabled === "boolean" ? req.body.handoffEnabled : undefined,
      handoffPrompt:
        typeof req.body.handoffPrompt === "string" ? req.body.handoffPrompt : undefined,
      handoffTargetPhone:
        typeof req.body.handoffTargetPhone === "string"
          ? req.body.handoffTargetPhone
          : undefined,
      unansweredFollowupEnabled:
        typeof req.body.unansweredFollowupEnabled === "boolean"
          ? req.body.unansweredFollowupEnabled
          : undefined,
    });

    res.json({ success: true, agent });
  })
);

app.get(
  "/api/ai-agents/:id/stage-rules",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const rules = await manager.getStageRules(req.authContext!, agentId);
    res.json({ success: true, rules });
  })
);

app.delete(
  "/api/ai-agents/:id",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const result = await manager.deleteAgent(req.authContext!, agentId);
    res.json(result);
  })
);

app.put(
  "/api/ai-agents/:id/stage-rules",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const rules = Array.isArray(req.body.rules) ? req.body.rules : [];
    const agentId = getSingleParam(req.params.id);
    const saved = await manager.saveStageRules(req.authContext!, agentId, rules);
    res.json({ success: true, rules: saved });
  })
);

app.get(
  "/api/ai-agents/:id/runs",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const leadId =
      typeof req.query.leadId === "string" ? req.query.leadId : undefined;
    const agentId = getSingleParam(req.params.id);
    const runs = await manager.listRuns(req.authContext!, agentId, leadId);
    res.json({ success: true, runs });
  })
);

app.post(
  "/api/ai-agents/:id/leads/:leadId/resume",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const leadId = getSingleParam(req.params.leadId);
    const result = await manager.resumeLead(
      req.authContext!,
      agentId,
      leadId
    );
    res.json(result);
  })
);

app.get("/api/agents", authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const agents = await manager.listAgents(req.authContext!);
  res.json({ success: true, agents });
}));

app.post("/api/agents", authMiddleware, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const agent = await manager.createAgent(req.authContext!, {
    name: String(req.body.name ?? req.body.agentName ?? ""),
    instanceName: String(req.body.instanceName ?? ""),
    systemPrompt:
      typeof req.body.systemPrompt === "string"
        ? req.body.systemPrompt
        : typeof req.body.systemMessage === "string"
          ? req.body.systemMessage
          : undefined,
    model: typeof req.body.model === "string" ? req.body.model : undefined,
    temperature:
      typeof req.body.temperature === "number" ? req.body.temperature : undefined,
    isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : undefined,
    bufferWaitMs:
      typeof req.body.bufferWaitMs === "number" ? req.body.bufferWaitMs : undefined,
    handoffEnabled:
      typeof req.body.handoffEnabled === "boolean" ? req.body.handoffEnabled : undefined,
    handoffPrompt:
      typeof req.body.handoffPrompt === "string" ? req.body.handoffPrompt : undefined,
    handoffTargetPhone:
      typeof req.body.handoffTargetPhone === "string"
        ? req.body.handoffTargetPhone
        : undefined,
    rbTokenApi:
      typeof req.body.rbTokenApi === "string" ? req.body.rbTokenApi : undefined,
    unansweredFollowupEnabled:
      typeof req.body.unansweredFollowupEnabled === "boolean"
        ? req.body.unansweredFollowupEnabled
        : undefined,
    templateKey:
      typeof req.body.templateKey === "string" ? req.body.templateKey : undefined,
  });

  res.status(201).json({ success: true, agent });
}));

app.patch(
  "/api/agents/:id",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const agent = await manager.updateAgent(req.authContext!, agentId, {
      name:
        typeof req.body.name === "string"
          ? req.body.name
          : typeof req.body.agentName === "string"
            ? req.body.agentName
            : undefined,
      instanceName:
        typeof req.body.instanceName === "string" ? req.body.instanceName : undefined,
      systemPrompt:
        typeof req.body.systemPrompt === "string"
          ? req.body.systemPrompt
          : typeof req.body.systemMessage === "string"
            ? req.body.systemMessage
            : undefined,
      model: typeof req.body.model === "string" ? req.body.model : undefined,
      temperature:
        typeof req.body.temperature === "number" ? req.body.temperature : undefined,
      bufferWaitMs:
        typeof req.body.bufferWaitMs === "number" ? req.body.bufferWaitMs : undefined,
      handoffEnabled:
        typeof req.body.handoffEnabled === "boolean" ? req.body.handoffEnabled : undefined,
      handoffPrompt:
        typeof req.body.handoffPrompt === "string" ? req.body.handoffPrompt : undefined,
      handoffTargetPhone:
        typeof req.body.handoffTargetPhone === "string"
          ? req.body.handoffTargetPhone
          : undefined,
      unansweredFollowupEnabled:
        typeof req.body.unansweredFollowupEnabled === "boolean"
          ? req.body.unansweredFollowupEnabled
          : undefined,
    });

    res.json({ success: true, agent });
  })
);

app.delete(
  "/api/agents/:id",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const result = await manager.deleteAgent(req.authContext!, agentId);
    res.json(result);
  })
);

app.get(
  "/api/agents/:id/tools",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const tools = await manager.listAgentTools(req.authContext!, agentId);
    res.json({ success: true, tools });
  })
);

app.patch(
  "/api/agents/:id/tools/:toolKey",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const toolKey = getSingleParam(req.params.toolKey);
    const tool = await manager.updateAgentTool(req.authContext!, agentId, toolKey, {
      isEnabled: typeof req.body.isEnabled === "boolean" ? req.body.isEnabled : undefined,
      config:
        req.body.config && typeof req.body.config === "object" && !Array.isArray(req.body.config)
          ? req.body.config
          : undefined,
    });
    res.json({ success: true, tool });
  })
);

app.post(
  "/api/agents/:id/tools/rb_billing/bootstrap",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const mode = req.body.mode === "dr_oculos" ? "dr_oculos" : "generic";
    const result = await manager.bootstrapRbBilling(req.authContext!, agentId, mode);
    res.status(201).json({ success: true, ...result });
  })
);

app.post(
  "/api/agents/:id/tools/rb_billing/run-now",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const result = await rbBillingWorker.runNowForAgent(req.authContext!.acesId, agentId);
    res.status(202).json({ success: true, result });
  })
);

app.get(
  "/api/agents/:id/tools/send_media/assets",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const assets = await manager.listToolMediaAssets(req.authContext!, agentId);
    res.json({ success: true, assets });
  })
);

app.post(
  "/api/agents/:id/tools/send_media/assets",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const mediaKind = req.body.mediaKind === "document" ? "document" : "image";
    const asset = await manager.upsertToolMediaAsset(req.authContext!, agentId, {
      assetKey: String(req.body.assetKey ?? ""),
      displayName: String(req.body.displayName ?? ""),
      description: typeof req.body.description === "string" ? req.body.description : undefined,
      usageInstruction:
        typeof req.body.usageInstruction === "string" ? req.body.usageInstruction : undefined,
      sourceUrl: String(req.body.sourceUrl ?? ""),
      mediaKind,
      fileName: typeof req.body.fileName === "string" ? req.body.fileName : null,
      defaultCaption:
        typeof req.body.defaultCaption === "string" ? req.body.defaultCaption : null,
    });
    res.status(201).json({ success: true, asset });
  })
);

app.delete(
  "/api/agents/:id/tools/send_media/assets/:assetId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const assetId = getSingleParam(req.params.assetId);
    const result = await manager.deactivateToolMediaAsset(req.authContext!, agentId, assetId);
    res.json(result);
  })
);

app.get(
  "/api/agents/:id/tools/prescription_analyst/lens-price-rules",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const rules = await manager.listLensPriceRules(req.authContext!, agentId);
    res.json({ success: true, rules });
  })
);

app.post(
  "/api/agents/:id/tools/prescription_analyst/lens-price-rules",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const lensCategory = req.body.lensCategory === "multifocal" ? "multifocal" : "single_vision";
    const rule = await manager.upsertLensPriceRule(req.authContext!, agentId, {
      id: typeof req.body.id === "string" ? req.body.id : null,
      displayName: String(req.body.displayName ?? ""),
      lensCategory,
      minSphere: Number(req.body.minSphere),
      maxSphere: Number(req.body.maxSphere),
      maxAbsCylinder: Number(req.body.maxAbsCylinder),
      minAddition: req.body.minAddition === null || req.body.minAddition === undefined ? null : Number(req.body.minAddition),
      maxAddition: req.body.maxAddition === null || req.body.maxAddition === undefined ? null : Number(req.body.maxAddition),
      priceCents: Number(req.body.priceCents),
      priority: Number(req.body.priority ?? 100),
      isActive: req.body.isActive !== false,
    });
    res.status(201).json({ success: true, rule });
  })
);

app.delete(
  "/api/agents/:id/tools/prescription_analyst/lens-price-rules/:ruleId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await manager.deactivateLensPriceRule(
      req.authContext!,
      getSingleParam(req.params.id),
      getSingleParam(req.params.ruleId)
    );
    res.json(result);
  })
);

app.get(
  "/api/agents/:id/tools/visagism/catalog",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const catalog = await manager.listVisagismCatalog(req.authContext!, agentId);
    res.json({ success: true, catalog });
  })
);

app.post(
  "/api/agents/:id/tools/visagism/catalog",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const item = await manager.upsertVisagismCatalogItem(req.authContext!, agentId, {
      id: typeof req.body.id === "string" ? req.body.id : null,
      productCode: String(req.body.productCode ?? ""),
      recommendationDescription: String(req.body.recommendationDescription ?? ""),
      attributes:
        req.body.attributes && typeof req.body.attributes === "object" && !Array.isArray(req.body.attributes)
          ? req.body.attributes
          : undefined,
      sourceUrl: String(req.body.sourceUrl ?? ""),
      displayOrder: typeof req.body.displayOrder === "number" ? req.body.displayOrder : undefined,
      isActive: typeof req.body.isActive === "boolean" ? req.body.isActive : undefined,
    });
    res.status(201).json({ success: true, item });
  })
);

app.delete(
  "/api/agents/:id/tools/visagism/catalog/:itemId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const itemId = getSingleParam(req.params.itemId);
    const result = await manager.deactivateVisagismCatalogItem(req.authContext!, agentId, itemId);
    res.json(result);
  })
);

app.get(
  "/api/agents/:id/tools/visagism/runs",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const runs = await manager.listVisagismRuns(req.authContext!, agentId);
    res.json({ success: true, runs });
  })
);

app.get(
  "/api/agents/:id/tools/visagism/runs/:runId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const runId = getSingleParam(req.params.runId);
    const run = await manager.getVisagismRun(req.authContext!, agentId, runId);
    res.json({ success: true, run });
  })
);

app.post(
  "/api/agents/:id/tools/visagism/runs",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const result = await manager.startVisagismRun(req.authContext!, agentId, {
      leadId: String(req.body.leadId ?? ""),
      sourceMessageId: typeof req.body.sourceMessageId === "string" ? req.body.sourceMessageId : null,
      excludedItemId: typeof req.body.excludedItemId === "string" ? req.body.excludedItemId : null,
    });
    res.status(result.status === "succeeded" ? 201 : 202).json({ success: true, ...result });
  })
);

app.get(
  "/api/agents/:id/tools/forwarding/destinations",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const destinations = await manager.listForwardingDestinations(req.authContext!, agentId);
    res.json({ success: true, destinations });
  })
);

app.post(
  "/api/agents/:id/tools/forwarding/destinations",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    if (req.body.mode !== "external_notification" && req.body.mode !== "agent") {
      throw new HttpError(400, "Modo de encaminhamento invalido");
    }
    const destination = await manager.upsertForwardingDestination(req.authContext!, agentId, {
      destinationKey: String(req.body.destinationKey ?? ""),
      displayName: String(req.body.displayName ?? ""),
      mode: req.body.mode,
      targetPhone: typeof req.body.targetPhone === "string" ? req.body.targetPhone : null,
      targetAgentId: typeof req.body.targetAgentId === "string" ? req.body.targetAgentId : null,
      contextInstruction: String(req.body.contextInstruction ?? ""),
    });
    res.status(201).json({ success: true, destination });
  })
);

app.delete(
  "/api/agents/:id/tools/forwarding/destinations/:destinationId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const destinationId = getSingleParam(req.params.destinationId);
    const result = await manager.deactivateForwardingDestination(
      req.authContext!,
      agentId,
      destinationId
    );
    res.json(result);
  })
);

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    return res.status(error.statusCode).json({
      error: error.message,
      details: error.details ?? null,
    });
  }

  const payloadError = error as { type?: string; status?: number; limit?: number; length?: number };
  if (payloadError.type === "entity.too.large") {
    console.warn("[crm-ai-backend] Payload JSON acima do limite:", {
      path: req.path,
      limit: payloadError.limit,
      length: payloadError.length,
    });
    return res.status(413).json({
      error: "Payload do webhook acima do limite aceito",
    });
  }

  console.error("[crm-ai-backend] Erro nao tratado:", error);
  return res.status(500).json({
    error: error instanceof Error ? error.message : "Erro interno do servidor",
  });
});

const port = Number(process.env.PORT ?? 3000);
async function bootstrap() {
  await assertRuntimeSchemaCompatibility({
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  });

  app.listen(port, () => {
    console.log(`[crm-ai-backend] Servidor rodando na porta ${port}`);
  });

  if (process.env.AUTOMATION_WORKER_ENABLED === "true") {
    startAutomationWorker();
  }

  if (process.env.RB_BILLING_WORKER_ENABLED === "true") {
    rbBillingWorker.start();
  }
}

bootstrap().catch(async (error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "[crm-ai-backend] Falha desconhecida ao inicializar o backend"
  );
  try {
    await manager.dispose();
  } catch (disposeError) {
    console.error("[crm-ai-backend] Falha ao liberar recursos na inicializacao:", disposeError);
  }
  process.exit(1);
});

process.on("SIGINT", async () => {
  rbBillingWorker.stop();
  await manager.dispose();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  rbBillingWorker.stop();
  await manager.dispose();
  process.exit(0);
});
