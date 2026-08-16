import "./load-env.js";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
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
import { startPipelineWorker } from "./pipeline-worker.js";
import { RbBillingWorker } from "./rb-billing-worker.js";
import { RbConnectionService } from "./rb-connection-service.js";
import { RbVisagismService } from "./rb-visagism-service.js";
import { invalidateAiBudgetCache } from "./ai-budget.js";
import { MetaWebhookProcessor } from "./meta-webhook.js";
import { MetaTemplateService } from "./meta-template-service.js";
import { MetaAdminService } from "./meta-admin-service.js";
import {
  GupshupWebhookProcessor,
  parseGupshupWebhookPayload,
} from "./gupshup-webhook.js";
import { GupshupAdminService } from "./gupshup-admin-service.js";
import {
  GupshupTemplateApiError,
  validateCreateGupshupTemplateInput,
  type CreateGupshupTemplateInput,
} from "./gupshup-template-service.js";

type AuthenticatedRequest = Request & {
  authContext?: Awaited<ReturnType<AgentManager["authenticate"]>>;
};

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

type CrmUserRole = "NENHUM" | "VENDEDOR" | "ADMIN";
type AgentPersonalityProfile = "surgical" | "consultative" | "balanced" | "dynamic" | "enthusiastic";
type AgentInstanceChangePolicy = "humanize" | "deactivate";

function asAgentPersonalityProfile(value: unknown): AgentPersonalityProfile | undefined {
  return value === "surgical"
    || value === "consultative"
    || value === "balanced"
    || value === "dynamic"
    || value === "enthusiastic"
    ? value
    : undefined;
}

function asAgentInstanceChangePolicy(value: unknown): AgentInstanceChangePolicy | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "humanize" || value === "deactivate") return value;
  throw new HttpError(400, "Decisao de troca de instancia invalida", {
    code: "AGENT_INSTANCE_CHANGE_POLICY_INVALID",
  });
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCnpj(value: unknown) {
  return String(value ?? "")
    .replace(/[^0-9a-z]/gi, "")
    .toUpperCase();
}

function isValidCnpj(value: unknown) {
  const cnpj = normalizeCnpj(value);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const characterValue = (character: string) =>
    character.charCodeAt(0) - 48;
  const calculateDigit = (base: string, weights: number[]) => {
    const sum = base
      .split("")
      .reduce(
        (total, character, index) =>
          total + characterValue(character) * weights[index],
        0,
      );
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calculateDigit(
    cnpj.slice(0, 12),
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  if (firstDigit !== Number(cnpj[12])) return false;

  const secondDigit = calculateDigit(
    `${cnpj.slice(0, 12)}${firstDigit}`,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );
  return secondDigit === Number(cnpj[13]);
}

function parseCompanyInput(body: unknown) {
  const payload = asRecord(body);
  const cnpj = normalizeCnpj(payload.cnpj);
  const legalName = asString(payload.legalName);
  const name = asString(payload.name);
  const phone = asString(payload.phone);
  const email = asString(payload.email)?.toLowerCase() ?? null;
  const address = asString(payload.address);
  const city = asString(payload.city);
  const state = asString(payload.state)?.toUpperCase() ?? null;
  const postalCode = asString(payload.postalCode)?.replace(/\D/g, "") || null;
  const timezone = asString(payload.timezone) ?? "America/Sao_Paulo";

  if (!isValidCnpj(cnpj)) {
    throw new HttpError(400, "CNPJ invalido");
  }
  if (!legalName || !name || !address || !city || !state) {
    throw new HttpError(
      400,
      "CNPJ, razao social, nome fantasia, endereco, cidade e estado sao obrigatorios",
    );
  }
  if (!/^[A-Z]{2}$/.test(state)) {
    throw new HttpError(400, "Estado invalido");
  }
  if (postalCode && !/^\d{8}$/.test(postalCode)) {
    throw new HttpError(400, "CEP invalido");
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "E-mail invalido");
  }

  return {
    cnpj,
    legal_name: legalName,
    name,
    phone,
    email,
    address,
    city,
    state,
    postal_code: postalCode,
    timezone,
    is_active: payload.isActive !== false,
  };
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
      messageId:
        asString(key.id) ??
        asString(messageDataKey.id) ??
        asString(root.messageId),
      fromMe: Boolean(
        key.fromMe ?? messageDataKey.fromMe ?? data.fromMe ?? root.fromMe,
      ),
      phone: null,
      conversationId: null,
      messageType: asString(data.messageType) ?? asString(root.messageType),
      remoteJid:
        asString(key.remoteJid) ??
        asString(messageDataKey.remoteJid) ??
        asString(data.remoteJid),
      remoteJidAlt:
        asString(key.remoteJidAlt) ??
        asString(messageDataKey.remoteJidAlt) ??
        asString(data.remoteJidAlt),
      senderPn:
        asString(key.senderPn) ??
        asString(messageDataKey.senderPn) ??
        asString(data.senderPn),
      participantPn:
        asString(key.participantPn) ??
        asString(messageDataKey.participantPn) ??
        asString(data.participantPn),
    };
  }
}

function summarizeGupshupWebhookPayload(payload: unknown) {
  const root = asRecord(payload);
  const events = parseGupshupWebhookPayload(payload);

  return {
    object: asString(root.object),
    gsAppId: asString(root.gs_app_id),
    eventCount: events.length,
    events: events.slice(0, 10).map((event) =>
      event.kind === "inbound"
        ? {
            kind: event.kind,
            messageId: event.message.messageId,
            phone: event.message.phone,
            messageType: event.message.messageType,
            lookup: event.lookup,
          }
        : {
            kind: event.kind,
            messageId: event.providerMessageId,
            status: event.rawStatus,
            destination: event.destination,
            lookup: event.lookup,
          },
    ),
  };
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
  return secretRef?.trim() ? (process.env[secretRef.trim()] ?? null) : null;
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

function createServiceSupabaseClient(schema = "crm") {
  return createClient(
    getSupabaseUrl(),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema },
    },
  );
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

async function forwardSupabaseFunction(
  functionName: string,
  accessToken: string,
  body: unknown,
) {
  const response = await fetch(
    `${getSupabaseUrl()}/functions/v1/${functionName}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: getSupabasePublicKey(),
      },
      body: JSON.stringify(body ?? {}),
    },
  );

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
      payload,
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

const rbVisagismService = new RbVisagismService({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  geminiApiKey: process.env.GEMINI_API_KEY,
  model: process.env.VISAGISM_CATALOG_ANALYSIS_MODEL,
  maxSourceBytes: Number(process.env.VISAGISM_CATALOG_MAX_SOURCE_BYTES ?? 10 * 1024 * 1024),
  maxStoredBytes: Number(process.env.VISAGISM_CATALOG_MAX_STORED_BYTES ?? 1_500_000),
  ffmpegPath: process.env.FFMPEG_PATH,
});

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
  geminiRetryBaseDelayMs: Number(
    process.env.GEMINI_RETRY_BASE_DELAY_MS ?? 1000,
  ),
  crmAnalysisWorkerModel: process.env.CRM_ANALYSIS_WORKER_MODEL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiAgentModel: process.env.OPENAI_AGENT_MODEL,
  openaiCrmAnalysisModel: process.env.OPENAI_CRM_ANALYSIS_MODEL,
  openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL,
  openaiVisionModel: process.env.OPENAI_VISION_MODEL,
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  elevenLabsDefaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID,
  elevenLabsModel: process.env.ELEVENLABS_TTS_MODEL,
  elevenLabsOutputFormat: process.env.ELEVENLABS_OUTPUT_FORMAT,
  elevenLabsTtsEnabled: process.env.ELEVENLABS_TTS_ENABLED === "true",
  metaProviderMode: process.env.META_PROVIDER_MODE,
  metaGraphApiVersion: process.env.META_GRAPH_API_VERSION,
  visagismToolEnabled: process.env.VISAGISM_TOOL_ENABLED === "true",
  visagismInternalRuntimeEnabled:
    process.env.VISAGISM_INTERNAL_RUNTIME_ENABLED !== "false",
  visagismAnalysisWorkerModel: process.env.VISAGISM_ANALYSIS_WORKER_MODEL,
  visagismMatchingWorkerModel: process.env.VISAGISM_MATCHING_WORKER_MODEL,
  visagismImageWorkerModel: process.env.VISAGISM_IMAGE_WORKER_MODEL,
  prescriptionWorkerEnabled:
    process.env.PRESCRIPTION_WORKER_ENABLED !== "false",
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
  chatSignedDownloadTtlSeconds: Number(
    process.env.CHAT_SIGNED_DOWNLOAD_TTL_SECONDS ?? 900,
  ),
  chatAttachmentUploadIntentTtlMinutes: Number(
    process.env.CHAT_ATTACHMENTS_UPLOAD_INTENT_TTL_MINUTES ?? 120,
  ),
  instancePhoneAllowlists: {
    mamis: ["554199031152"],
  },
  rbVisagismService,
});

const metaWebhookProcessor = new MetaWebhookProcessor({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  verifyToken:
    process.env.META_WEBHOOK_VERIFY_TOKEN ?? "local-dev-verify-token",
  appSecret: resolveMetaWebhookAppSecret(),
});

const metaTemplateService = new MetaTemplateService({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  providerMode:
    process.env.META_PROVIDER_MODE?.trim().toLowerCase() === "live"
      ? "live"
      : "mock",
  graphApiVersion: process.env.META_GRAPH_API_VERSION ?? "v20.0",
  fixturePath: process.env.META_TEMPLATES_FIXTURE_PATH,
  resolveSecret: (secretRef) => resolveEnvSecretRef(secretRef),
});

const metaAdminService = new MetaAdminService({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
});

const rbConnectionService = new RbConnectionService({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  jwtSecret: requireEnv("RB_WEBHOOK_JWT_SECRET"),
  rbApiBaseUrl: process.env.RB_API_BASE_URL,
});

const rbBillingWorker = new RbBillingWorker({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  mockFixturePath: process.env.RB_BILLING_MOCK_FIXTURE_PATH,
  pollMs: Number(process.env.RB_BILLING_WORKER_POLL_MS ?? 60000),
  resolveConnection: (acesId, agentId) =>
    rbConnectionService.resolveBillingConfig(acesId, agentId),
});

const gupshupWebhookProcessor = new GupshupWebhookProcessor({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  processInboundMessage: (acesId, message) =>
    manager.processProviderInboundWebhook(acesId, message),
});

const gupshupAdminService = new GupshupAdminService({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
});

const app = express();
app.use("/webhook/login", express.urlencoded({ extended: false }));
app.use("/webhook/image", (req, res, next) => {
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 15 * 1024 * 1024) {
    res.status(413).json({ error: "Imagem acima do limite aceito" });
    return;
  }
  next();
});
app.use("/webhook/image", express.json({ limit: "15mb" }));
app.use(
  express.json({
    limit:
      process.env.JSON_BODY_LIMIT ?? process.env.WEBHOOK_JSON_LIMIT ?? "150mb",
    verify: (req, _res, buf) => {
      if (req.url?.startsWith("/api/webhook/meta")) {
        (req as RawBodyRequest).rawBody = Buffer.from(buf);
      }
    },
  }),
);

const allowedOrigins = (
  process.env.CORS_ORIGINS ?? "http://localhost:8080,http://127.0.0.1:8080"
)
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
    "Content-Type, Authorization, x-webhook-secret, x-evolution-secret, x-gupshup-secret, x-hub-signature-256",
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  );

  if (req.method === "OPTIONS") {
    res.status(204).send();
    return;
  }

  next();
});

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

const authMiddleware = asyncHandler(
  async (req: AuthenticatedRequest, _res, next) => {
    req.authContext = await manager.authenticate(req.headers.authorization);
    next();
  },
);

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
    const result = await manager.processEvolutionWebhook(
      req.body as WebhookPayload,
    );
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
  if (
    !metaWebhookProcessor.verifySignature(
      (req as RawBodyRequest).rawBody,
      signature,
    )
  ) {
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

  const startedAt = Date.now();
  const summary = summarizeGupshupWebhookPayload(req.body);

  try {
    const result = await gupshupWebhookProcessor.processWebhook(req.body);
    const logPayload = {
      ...summary,
      result,
      elapsedMs: Date.now() - startedAt,
    };

    if (result.ignored > 0) {
      console.warn(
        "[crm-ai-webhook] Gupshup webhook processado com eventos ignorados:",
        logPayload,
      );
    } else {
      console.info("[crm-ai-webhook] Gupshup webhook processado:", logPayload);
    }
    res.status(204).end();
  } catch (error) {
    console.error("[crm-ai-webhook] Gupshup webhook falhou:", {
      ...summary,
      error: error instanceof Error ? error.message : String(error),
      details: error instanceof HttpError ? (error.details ?? null) : null,
      elapsedMs: Date.now() - startedAt,
    });
    throw error;
  }
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
  const challenge = metaWebhookProcessor.verifyChallenge(
    req.query as Record<string, unknown>,
  );
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

function getRbBearerToken(req: Request) {
  const authorization = req.headers.authorization?.replace(/%20/gi, " ") ?? "";
  const [scheme, token] = authorization.split(/\s+/, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

app.post(
  "/webhook/login",
  asyncHandler(async (req, res) => {
    const rbAcesId = Number(req.body.aces_id);
    const empId = Number(req.body.emp_id);
    if (!Number.isInteger(rbAcesId) || rbAcesId <= 0 || !Number.isInteger(empId) || empId <= 0) {
      throw new HttpError(400, "aces_id e emp_id sao obrigatorios e devem ser validos");
    }

    const connection = await rbConnectionService.authenticate({ rbAcesId });
    if (!connection) throw new HttpError(404, "aces_id RB nao cadastrado");
    const { token, exp } = rbConnectionService.signWebhookToken(connection, empId);
    res.json({ token, aces_id: rbAcesId, exp: String(exp) });
  }),
);

const requireStaff = asyncHandler(
  async (req: AuthenticatedRequest, _res, next) => {
    if (!req.authContext || !(await manager.isAdminStaff(req.authContext.authUserId))) {
      throw new HttpError(403, "Acesso restrito ao superadmin");
    }
    next();
  },
);

function adminNumber(value: unknown, field: string, options?: { min?: number; integer?: boolean }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (options?.integer && !Number.isInteger(parsed))) {
    throw new HttpError(400, `${field} invalido`);
  }
  if (options?.min !== undefined && parsed < options.min) {
    throw new HttpError(400, `${field} deve ser maior ou igual a ${options.min}`);
  }
  return parsed;
}

function adminMonth(value: unknown, field: string) {
  const month = String(value ?? "");
  if (!/^\d{4}-\d{2}-01$/.test(month)) throw new HttpError(400, `${field} deve ser o primeiro dia do mes`);
  return month;
}

function parseAdminPlan(body: unknown, partial = false) {
  const input = asRecord(body);
  const output: Record<string, unknown> = {};
  const stringField = (source: string, target: string) => {
    if (!(source in input)) return;
    const value = asString(input[source]);
    if (!value) throw new HttpError(400, `${source} e obrigatorio`);
    output[target] = value;
  };
  stringField("code", "code");
  stringField("name", "name");
  for (const field of ["mensalidadeBrl", "implantacaoBrl"] as const) {
    if (field in input) output[field] = adminNumber(input[field], field, { min: 0 });
  }
  if ("aiBudgetBrl" in input) output.aiBudgetBrl = input.aiBudgetBrl === null ? null : adminNumber(input.aiBudgetBrl, "aiBudgetBrl", { min: 0 });
  if ("warnThresholdPct" in input) {
    const threshold = adminNumber(input.warnThresholdPct, "warnThresholdPct", { min: 0 });
    if (threshold <= 0 || threshold > 100) throw new HttpError(400, "warnThresholdPct deve estar entre 0 e 100");
    output.warnThresholdPct = threshold;
  }
  for (const field of ["maxUsuarios", "maxInstancias"] as const) {
    if (field in input) output[field] = input[field] === null ? null : adminNumber(input[field], field, { min: 0, integer: true });
  }
  if ("isActive" in input) output.isActive = input.isActive === true;
  if (!partial && (!output.code || !output.name || output.mensalidadeBrl === undefined || output.implantacaoBrl === undefined)) {
    throw new HttpError(400, "code, name, mensalidadeBrl e implantacaoBrl sao obrigatorios");
  }
  return output;
}

function parseAdminRevenue(body: unknown, partial = false) {
  const input = asRecord(body);
  const output: Record<string, unknown> = {};
  if ("acesId" in input) output.acesId = adminNumber(input.acesId, "acesId", { min: 1, integer: true });
  if ("competencia" in input) output.competencia = adminMonth(input.competencia, "competencia");
  if ("tipo" in input) {
    const tipo = String(input.tipo);
    if (!["mensalidade", "implantacao", "avulso", "desconto"].includes(tipo)) throw new HttpError(400, "tipo de receita invalido");
    output.tipo = tipo;
  }
  if ("valorBrl" in input) output.valorBrl = adminNumber(input.valorBrl, "valorBrl");
  if (output.tipo === "desconto" && Number(output.valorBrl) > 0) throw new HttpError(400, "Desconto deve ser negativo ou zero");
  if (output.tipo && output.tipo !== "desconto" && Number(output.valorBrl) < 0) throw new HttpError(400, "Receita nao pode ser negativa");
  if ("status" in input) {
    const status = String(input.status);
    if (!["previsto", "pago"].includes(status)) throw new HttpError(400, "status de receita invalido");
    output.status = status;
  }
  if ("pagoEm" in input) output.pagoEm = input.pagoEm === null ? null : String(input.pagoEm);
  if (output.status === "pago" && !output.pagoEm) throw new HttpError(400, "pagoEm e obrigatorio para receita paga");
  if ("descricao" in input) output.descricao = input.descricao === null ? null : String(input.descricao);
  if (!partial && ["acesId", "competencia", "tipo", "valorBrl"].some((field) => output[field] === undefined)) {
    throw new HttpError(400, "acesId, competencia, tipo e valorBrl sao obrigatorios");
  }
  return output;
}

function parseAdminFixedCost(body: unknown, partial = false) {
  const input = asRecord(body);
  const output: Record<string, unknown> = {};
  if ("nome" in input) output.nome = asString(input.nome);
  if ("categoria" in input) {
    const value = String(input.categoria);
    if (!["infra", "ferramenta", "pessoal", "outro"].includes(value)) throw new HttpError(400, "categoria invalida");
    output.categoria = value;
  }
  if ("valorBrl" in input) output.valorBrl = adminNumber(input.valorBrl, "valorBrl", { min: 0 });
  if ("recorrencia" in input) {
    const value = String(input.recorrencia);
    if (!["mensal", "anual", "unico"].includes(value)) throw new HttpError(400, "recorrencia invalida");
    output.recorrencia = value;
  }
  if ("vigenciaInicio" in input) output.vigenciaInicio = adminMonth(input.vigenciaInicio, "vigenciaInicio");
  if ("vigenciaFim" in input) output.vigenciaFim = input.vigenciaFim === null ? null : adminMonth(input.vigenciaFim, "vigenciaFim");
  if (!partial && ["nome", "categoria", "valorBrl", "recorrencia", "vigenciaInicio"].some((field) => output[field] === undefined || output[field] === null)) {
    throw new HttpError(400, "Campos obrigatorios do custo fixo ausentes");
  }
  return output;
}

function parseAdminExchangeRate(body: unknown, partial = false) {
  const input = asRecord(body);
  const output: Record<string, unknown> = {};
  if ("fromCurrency" in input) output.fromCurrency = String(input.fromCurrency).toUpperCase();
  if ("toCurrency" in input) output.toCurrency = String(input.toCurrency).toUpperCase();
  if ("rate" in input) output.rate = adminNumber(input.rate, "rate", { min: Number.MIN_VALUE });
  if ("rateKind" in input) {
    const value = String(input.rateKind);
    if (!["internal", "provider"].includes(value)) throw new HttpError(400, "rateKind invalido");
    output.rateKind = value;
  }
  if ("source" in input) output.source = asString(input.source);
  if ("effectiveAt" in input) output.effectiveAt = String(input.effectiveAt);
  if ("metadata" in input) output.metadata = asRecord(input.metadata);
  if (!partial && ["rate", "rateKind", "source", "effectiveAt"].some((field) => output[field] === undefined || output[field] === null)) {
    throw new HttpError(400, "rate, rateKind, source e effectiveAt sao obrigatorios");
  }
  return output;
}

app.post(
  "/webhook/image",
  asyncHandler(async (req, res) => {
    const token = getRbBearerToken(req);
    const auth = token ? await rbConnectionService.verifyWebhookToken(token) : null;
    if (!auth) throw new HttpError(401, "HTTP 401 Unauthorized");
    const base64 = asString(req.body.base64);
    const modelo = asString(req.body.modelo);
    if (!base64 || !modelo) throw new HttpError(400, "base64 e modelo sao obrigatorios");

    const result = await rbVisagismService.analyzeAndSave({
      connection: auth.connection,
      base64,
      modelo,
    });
    res.json(result);
  }),
);

app.post(
  "/webhook/delete",
  asyncHandler(async (req, res) => {
    const token = getRbBearerToken(req);
    const auth = token ? await rbConnectionService.verifyWebhookToken(token) : null;
    if (!auth) throw new HttpError(401, "HTTP 401 Unauthorized");
    const modelo = asString(req.body.modelo);
    if (!modelo) throw new HttpError(400, "modelo e obrigatorio");
    res.json(await rbVisagismService.deleteByModel(auth.connection, modelo));
  }),
);

app.get(
  "/api/rb/connections",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") throw new HttpError(403, "Apenas administradores podem consultar conexoes RB");
    const connections = await rbConnectionService.listConnections(context.acesId);
    res.json({ success: true, connections });
  }),
);

app.post(
  "/api/rb/connections",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") throw new HttpError(403, "Apenas administradores podem configurar conexoes RB");
    const rbEmpresaIds = Array.isArray(req.body.rbEmpresaIds)
      ? req.body.rbEmpresaIds.map((item: unknown) => String(item).trim()).filter(Boolean)
      : [];
    const rbAcesId = Number(req.body.rbAcesId);
    if (!Number.isInteger(rbAcesId) || rbAcesId <= 0) {
      throw new HttpError(400, "rbAcesId e obrigatorio e deve ser um numero inteiro positivo");
    }
    const connection = await rbConnectionService.saveConnection({
      id: asString(req.body.id),
      acesId: context.acesId,
      rbAcesId,
      rbTokenApi: asString(req.body.rbTokenApi),
      rbEmpresaIds,
      status: req.body.status === "inactive" ? "inactive" : "active",
    });
    res.status(req.body.id ? 200 : 201).json({ success: true, connection });
  }),
);

app.delete(
  "/api/rb/connections/:id",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") throw new HttpError(403, "Apenas administradores podem excluir conexoes RB");
    res.json(await rbConnectionService.deleteConnection(context.acesId, getSingleParam(req.params.id)));
  }),
);

app.post(
  "/api/meta/templates/sync",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem sincronizar templates Meta",
      );
    }

    const instanceName = String(req.body.instanceName ?? "").trim();
    if (!instanceName) {
      throw new HttpError(400, "instanceName e obrigatorio");
    }

    const result =
      await metaTemplateService.syncTemplatesForInstance(instanceName);
    res.json({ success: true, ...result });
  }),
);

app.get(
  "/api/meta/channels",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem consultar canais Meta",
      );
    }

    const channels = await metaAdminService.listChannels(context.acesId);
    res.json({ success: true, channels });
  }),
);

app.post(
  "/api/meta/channels",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem configurar canais Meta",
      );
    }

    const instanceName = String(req.body.instanceName ?? "").trim();
    if (!instanceName) {
      throw new HttpError(400, "instanceName e obrigatorio");
    }

    const channel = await metaAdminService.upsertChannel({
      acesId: context.acesId,
      instanceName,
      wabaId: typeof req.body.wabaId === "string" ? req.body.wabaId : null,
      phoneNumberId:
        typeof req.body.phoneNumberId === "string"
          ? req.body.phoneNumberId
          : null,
      businessId:
        typeof req.body.businessId === "string" ? req.body.businessId : null,
      displayPhoneNumber:
        typeof req.body.displayPhoneNumber === "string"
          ? req.body.displayPhoneNumber
          : null,
      accessTokenSecretRef:
        typeof req.body.accessTokenSecretRef === "string"
          ? req.body.accessTokenSecretRef
          : null,
      appSecretRef:
        typeof req.body.appSecretRef === "string"
          ? req.body.appSecretRef
          : null,
      webhookVerifyToken:
        typeof req.body.webhookVerifyToken === "string"
          ? req.body.webhookVerifyToken
          : null,
      status: ["draft", "active", "disabled", "error"].includes(
        String(req.body.status),
      )
        ? req.body.status
        : "draft",
    });

    res.json({ success: true, channel });
  }),
);

app.get(
  "/api/meta/templates",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem consultar templates Meta",
      );
    }

    const instanceName = String(req.query.instanceName ?? "").trim();
    if (!instanceName) {
      throw new HttpError(400, "instanceName e obrigatorio");
    }

    const result = await metaAdminService.listTemplates(
      context.acesId,
      instanceName,
    );
    res.json({ success: true, ...result });
  }),
);

app.get(
  "/api/gupshup/channels",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem consultar canais Gupshup",
      );
    }

    const channels = await gupshupAdminService.listChannels(context.acesId);
    res.json({ success: true, channels });
  }),
);

app.post(
  "/api/gupshup/channels",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem configurar canais Gupshup",
      );
    }

    const instanceName = asString(req.body.instanceName);
    const appName = asString(req.body.appName);
    const apiKey = asString(req.body.apiKey);
    const phoneNumber = asString(req.body.phoneNumber);
    if (!instanceName || !appName || !apiKey || !phoneNumber) {
      throw new HttpError(
        400,
        "instanceName, appName, apiKey e phoneNumber sao obrigatorios",
      );
    }

    const requestedStatus = asString(req.body.status);
    const status = ["draft", "active", "disabled"].includes(
      requestedStatus ?? "",
    )
      ? (requestedStatus as "draft" | "active" | "disabled")
      : "draft";
    const appId = asString(req.body.appId);
    const channel = await gupshupAdminService.upsertChannel({
      acesId: context.acesId,
      instanceName,
      appId,
      appName,
      apiKey,
      phoneNumber,
      status,
    });

    res.json({ success: true, channel });
  }),
);

app.get(
  "/api/gupshup/templates",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem consultar templates Gupshup",
      );
    }

    const instanceName = asString(req.query.instanceName);
    if (!instanceName) throw new HttpError(400, "instanceName e obrigatorio");

    const result = await gupshupAdminService.listTemplates(
      context.acesId,
      instanceName,
    );
    res.json({ success: true, ...result });
  }),
);

app.post(
  "/api/gupshup/templates",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem criar templates Gupshup",
      );
    }

    const instanceName = asString(req.body.instanceName);
    const elementName = asString(req.body.elementName);
    const content = asString(req.body.content);
    if (!instanceName || !elementName || !content) {
      throw new HttpError(
        400,
        "instanceName, elementName e content sao obrigatorios",
      );
    }

    const createTemplateInput: CreateGupshupTemplateInput = {
      elementName,
      content,
      languageCode: asString(req.body.languageCode) ?? undefined,
      category: asString(req.body.category) ?? undefined,
      templateType:
        (asString(req.body.templateType)?.toUpperCase() as
          | CreateGupshupTemplateInput["templateType"]
          | undefined) ?? undefined,
      vertical: asString(req.body.vertical) ?? undefined,
      example: asString(req.body.example) ?? undefined,
    };
    const validationError =
      validateCreateGupshupTemplateInput(createTemplateInput);
    if (validationError) throw new HttpError(400, validationError);

    let template;
    try {
      template = await gupshupAdminService.createTemplate(
        context.acesId,
        instanceName,
        createTemplateInput,
      );
    } catch (error) {
      if (error instanceof GupshupTemplateApiError) {
        throw new HttpError(422, error.message, {
          provider: "gupshup",
          upstreamStatus: error.upstreamStatus,
        });
      }
      throw error;
    }
    res.status(201).json({ success: true, template });
  }),
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
  }),
);

app.get(
  "/api/notifications",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const accessToken = req.headers.authorization
      ?.replace(/^Bearer\s+/i, "")
      .trim();
    if (!accessToken) throw new HttpError(401, "Sessao invalida");

    const category = req.query.category === "notice" ? "notice" : "internal";
    const limit = Math.min(
      Math.max(Number(req.query.limit ?? 20) || 20, 1),
      50,
    );
    const before = asString(req.query.before);
    const client = createUserScopedSupabaseClient(accessToken);
    const { data, error } = await client.rpc("rpc_list_notifications", {
      p_category: category,
      p_limit: limit,
      p_before: before,
    });
    if (error)
      throw new HttpError(
        500,
        "Nao foi possivel carregar as notificacoes",
        error,
      );

    res.json({
      success: true,
      notifications: (data ?? []).map((item: Record<string, unknown>) => {
        const actionPath = asString(item.action_path);
        const actionUrl = actionPath
          ? new URL(actionPath, "https://crm.local")
          : null;
        return {
          key: String(item.notification_id),
          title: String(item.title ?? ""),
          description: String(item.description ?? ""),
          publishedAt: String(item.published_at ?? ""),
          read: Boolean(item.is_read),
          action:
            actionUrl?.pathname === "/chat" &&
            (actionUrl.searchParams.get("leadId") || actionUrl.searchParams.get("lead"))
              ? {
                  kind: "openConversation",
                  target: actionUrl.searchParams.get("leadId") || actionUrl.searchParams.get("lead"),
                }
              : null,
        };
      }),
    });
  }),
);

app.post(
  "/api/notifications/:key/read",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const accessToken = req.headers.authorization
      ?.replace(/^Bearer\s+/i, "")
      .trim();
    if (!accessToken) throw new HttpError(401, "Sessao invalida");
    const client = createUserScopedSupabaseClient(accessToken);
    const { error } = await client.rpc("rpc_mark_notification_read", {
      p_notification_id: getSingleParam(req.params.key),
    });
    if (error)
      throw new HttpError(400, "Nao foi possivel marcar a notificacao", error);
    res.json({ success: true });
  }),
);

app.get(
  "/api/notifications/unread-counts",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const accessToken = req.headers.authorization
      ?.replace(/^Bearer\s+/i, "")
      .trim();
    if (!accessToken) throw new HttpError(401, "Sessao invalida");
    const client = createUserScopedSupabaseClient(accessToken);
    const { data, error } = await client.rpc(
      "rpc_get_notification_unread_counts",
    );
    if (error)
      throw new HttpError(
        500,
        "Nao foi possivel contar as notificacoes",
        error,
      );
    const counts = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
    res.json({
      success: true,
      internal: Number(counts.internal_count ?? 0),
      notice: Number(counts.notice_count ?? 0),
    });
  }),
);

app.post(
  "/api/notifications/read-all",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const accessToken = req.headers.authorization
      ?.replace(/^Bearer\s+/i, "")
      .trim();
    if (!accessToken) throw new HttpError(401, "Sessao invalida");
    const category = req.body.category === "notice" ? "notice" : "internal";
    const client = createUserScopedSupabaseClient(accessToken);
    const { error } = await client.rpc("rpc_mark_all_notifications_read", {
      p_category: category,
    });
    if (error)
      throw new HttpError(
        400,
        "Nao foi possivel atualizar as notificacoes",
        error,
      );
    res.json({ success: true });
  }),
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
      const { data: memberships, error: membershipsError } = await supabaseAdmin
        .from("instance_access_memberships")
        .select("instance_name")
        .eq("aces_id", context.acesId)
        .eq("crm_user_id", context.crmUserId)
        .eq("is_active", true)
        .in("access_level", ["viewer", "editor", "admin"]);

      if (membershipsError) {
        throw new HttpError(
          500,
          "Nao foi possivel validar as instancias permitidas",
          membershipsError,
        );
      }

      const allowedInstances = Array.from(
        new Set(
          (memberships ?? [])
            .map((row) => String(row.instance_name))
            .filter(Boolean),
        ),
      );

      if (allowedInstances.length === 0) {
        res.json({ success: true, instances: [] });
        return;
      }

      query = query.in("instancia", allowedInstances);
    }

    const { data, error } = await query;

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar instancias", error);
    }

    const instances = data ?? [];
    const instanceNames = instances
      .map((instance) => String(instance.instancia))
      .filter(Boolean);
    const providerByInstance = new Map<
      string,
      "evolution" | "meta" | "gupshup"
    >();

    if (instanceNames.length > 0) {
      const metaAdmin = createServiceSupabaseClient("meta");
      const { data: providerRows, error: providerError } = await metaAdmin
        .from("instance")
        .select("instance_name, provider")
        .eq("aces_id", context.acesId)
        .in("instance_name", instanceNames);

      if (providerError) {
        throw new HttpError(
          500,
          "Nao foi possivel carregar os provedores das instancias",
          providerError,
        );
      }

      for (const row of providerRows ?? []) {
        const provider =
          row.provider === "gupshup" || row.provider === "meta"
            ? row.provider
            : "evolution";
        providerByInstance.set(String(row.instance_name), provider);
      }
    }

    res.json({
      success: true,
      instances: instances.map((instance) => ({
        ...instance,
        provider:
          providerByInstance.get(String(instance.instancia)) ?? "evolution",
      })),
    });
  }),
);

app.get(
  "/api/automation/media-assets",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = asString(req.query.instanceName);
    const assets = await manager.listAutomationMediaAssets(
      req.authContext!,
      instanceName,
    );
    res.json({ success: true, assets });
  }),
);

app.post(
  "/api/automation/media-assets/upload-url",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const mediaKind =
      req.body.kind === "document"
        ? "document"
        : req.body.kind === "video"
          ? "video"
          : "image";
    const result = await manager.createAutomationMediaUploadUrl(
      req.authContext!,
      {
        instanceName: String(req.body.instanceName ?? ""),
        fileName: String(req.body.fileName ?? ""),
        mimeType: String(req.body.mimeType ?? ""),
        fileSize: Number(req.body.fileSize ?? 0),
        kind: mediaKind,
      },
    );

    res.json(result);
  }),
);

app.post(
  "/api/automation/media-assets/complete-upload",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await manager.completeAutomationMediaUpload(
      req.authContext!,
      String(req.body.assetId ?? ""),
    );
    res.json(result);
  }),
);

app.post(
  "/api/buscar-leads",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const payload = await forwardSupabaseFunction(
      "buscar-leads",
      req.authContext!.accessToken,
      req.body,
    );
    res.json(payload);
  }),
);

app.post(
  "/api/leads/import-csv",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const payload = await forwardSupabaseFunction(
      "import-leads-csv",
      req.authContext!.accessToken,
      req.body,
    );
    res.json(payload);
  }),
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
  }),
);

app.patch(
  "/api/admin/users/:id/role",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem atualizar usuarios",
      );
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

    if (role !== "VENDEDOR") {
      const { error: revokeError } = await supabaseAdmin
        .from("instance_access_memberships")
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
        })
        .eq("aces_id", context.acesId)
        .eq("crm_user_id", getSingleParam(req.params.id))
        .eq("is_active", true);

      if (revokeError) {
        throw new HttpError(
          500,
          "Role atualizada, mas os acessos de instancia nao foram revogados",
          revokeError,
        );
      }

      const { error: companyRevokeError } = await supabaseAdmin
        .from("empresa_memberships")
        .update({
          is_active: false,
          revoked_at: new Date().toISOString(),
        })
        .eq("aces_id", context.acesId)
        .eq("crm_user_id", getSingleParam(req.params.id))
        .eq("is_active", true);

      if (companyRevokeError) {
        throw new HttpError(
          500,
          "Role atualizada, mas os acessos de empresa nao foram revogados",
          companyRevokeError,
        );
      }
    }

    res.json({ success: true });
  }),
);

app.get(
  "/api/admin/instance-access",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem gerenciar acessos de instancia",
      );
    }

    const supabaseAdmin = createServiceSupabaseClient();
    const [instancesResult, membershipsResult] = await Promise.all([
      supabaseAdmin
        .from("instance")
        .select("instancia, color, setup_status")
        .eq("aces_id", context.acesId)
        .or("setup_status.is.null,setup_status.neq.cancelled")
        .order("instancia"),
      supabaseAdmin
        .from("instance_access_memberships")
        .select("id, instance_name, crm_user_id, access_level, is_active")
        .eq("aces_id", context.acesId)
        .eq("is_active", true)
        .order("instance_name"),
    ]);

    const accessError = instancesResult.error ?? membershipsResult.error;
    if (accessError) {
      throw new HttpError(
        500,
        "Nao foi possivel carregar os acessos de instancia",
        accessError,
      );
    }

    res.json({
      success: true,
      instances: instancesResult.data ?? [],
      memberships: membershipsResult.data ?? [],
    });
  }),
);

app.post(
  "/api/admin/instance-access",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem gerenciar acessos de instancia",
      );
    }

    const instanceName = String(req.body.instanceName ?? "").trim();
    const crmUserId = String(req.body.crmUserId ?? "").trim();
    const accessLevel = "editor";
    if (!instanceName || !crmUserId) {
      throw new HttpError(400, "Instancia e vendedor sao obrigatorios");
    }

    const supabaseAdmin = createServiceSupabaseClient();
    const [{ data: instance }, { data: seller }] = await Promise.all([
      supabaseAdmin
        .from("instance")
        .select("instancia")
        .eq("aces_id", context.acesId)
        .eq("instancia", instanceName)
        .maybeSingle(),
      supabaseAdmin
        .from("users")
        .select("id")
        .eq("aces_id", context.acesId)
        .eq("id", crmUserId)
        .eq("role", "VENDEDOR")
        .maybeSingle(),
    ]);

    if (!instance || !seller) {
      throw new HttpError(404, "Instancia ou vendedor nao encontrado na conta");
    }

    const { data, error } = await supabaseAdmin
      .from("instance_access_memberships")
      .upsert(
        {
          aces_id: context.acesId,
          instance_name: instanceName,
          crm_user_id: crmUserId,
          access_level: accessLevel,
          granted_by: context.crmUserId,
          grant_reason: "Acesso configurado pelo administrador",
          is_active: true,
          granted_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: "instance_name,crm_user_id" },
      )
      .select("id, instance_name, crm_user_id, access_level, is_active")
      .single();

    if (error) {
      throw new HttpError(
        500,
        "Nao foi possivel salvar o acesso da instancia",
        error,
      );
    }

    res.json({ success: true, membership: data });
  }),
);

app.delete(
  "/api/admin/instance-access/:instanceName/:userId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem gerenciar acessos de instancia",
      );
    }

    const supabaseAdmin = createServiceSupabaseClient();
    const { error } = await supabaseAdmin
      .from("instance_access_memberships")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("aces_id", context.acesId)
      .eq("instance_name", getSingleParam(req.params.instanceName))
      .eq("crm_user_id", getSingleParam(req.params.userId))
      .eq("is_active", true);

    if (error) {
      throw new HttpError(
        500,
        "Nao foi possivel revogar o acesso da instancia",
        error,
      );
    }

    res.json({ success: true });
  }),
);

app.get(
  "/api/routing-queue",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) throw new HttpError(401, "Sessao invalida");
    const status = typeof req.query.status === "string" &&
      ["waiting", "claimed", "closed", "cancelled"].includes(req.query.status)
      ? req.query.status
      : null;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 100);
    const before = asString(req.query.before);
    const client = createUserScopedSupabaseClient(accessToken);
    const { data, error } = await client.rpc("rpc_list_routing_queue", {
      p_status: status,
      p_limit: limit,
      p_before: before,
    });
    if (error) throw new HttpError(500, "Nao foi possivel carregar a fila de encaminhamentos", error);
    res.json({ success: true, items: data ?? [] });
  }),
);

app.post(
  "/api/routing-queue/:id/claim",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) throw new HttpError(401, "Sessao invalida");
    const client = createUserScopedSupabaseClient(accessToken);
    const { data, error } = await client.rpc("rpc_claim_routing_event", {
      p_event_id: getSingleParam(req.params.id),
    });
    if (error) throw new HttpError(409, "Nao foi possivel assumir o atendimento", error);
    res.json({ success: true, result: data });
  }),
);

app.post(
  "/api/routing-queue/:id/reassign",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (req.authContext?.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem reatribuir atendimentos");
    }
    const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) throw new HttpError(401, "Sessao invalida");
    const userId = typeof req.body.userId === "string" ? req.body.userId.trim() : "";
    if (!userId) throw new HttpError(400, "Vendedor de destino obrigatorio");
    const client = createUserScopedSupabaseClient(accessToken);
    const { data, error } = await client.rpc("rpc_reassign_routing_event", {
      p_event_id: getSingleParam(req.params.id),
      p_user_id: userId,
    });
    if (error) throw new HttpError(409, "Nao foi possivel reatribuir o atendimento", error);
    res.json({ success: true, result: data });
  }),
);

app.post(
  "/api/routing-queue/:id/close",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken) throw new HttpError(401, "Sessao invalida");
    const client = createUserScopedSupabaseClient(accessToken);
    const { data, error } = await client.rpc("rpc_close_routing_event", {
      p_event_id: getSingleParam(req.params.id),
    });
    if (error) throw new HttpError(409, "Nao foi possivel finalizar a fila do atendimento", error);
    res.json({ success: true, result: data });
  }),
);

app.get(
  "/api/admin/companies",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem listar empresas");
    }

    const supabaseAdmin = createServiceSupabaseClient();
    const [companiesResult, membershipsResult] = await Promise.all([
      supabaseAdmin
        .from("empresas")
        .select(
          "id, cnpj, legal_name, name, phone, email, address, city, state, postal_code, timezone, is_active, created_at, updated_at",
        )
        .eq("aces_id", context.acesId)
        .order("name"),
      supabaseAdmin
        .from("empresa_memberships")
        .select("empresa_id")
        .eq("aces_id", context.acesId)
        .eq("is_active", true),
    ]);

    const error = companiesResult.error ?? membershipsResult.error;
    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar empresas", error);
    }

    const memberCountByCompany = new Map<string, number>();
    for (const membership of membershipsResult.data ?? []) {
      const companyId = String(membership.empresa_id);
      memberCountByCompany.set(
        companyId,
        (memberCountByCompany.get(companyId) ?? 0) + 1,
      );
    }

    res.json({
      success: true,
      companies: (companiesResult.data ?? []).map((company) => ({
        id: company.id,
        cnpj: company.cnpj,
        legalName: company.legal_name,
        name: company.name,
        phone: company.phone,
        email: company.email,
        address: company.address,
        city: company.city,
        state: company.state,
        postalCode: company.postal_code,
        timezone: company.timezone,
        isActive: company.is_active,
        memberCount: memberCountByCompany.get(String(company.id)) ?? 0,
        createdAt: company.created_at,
        updatedAt: company.updated_at,
      })),
    });
  }),
);

app.post(
  "/api/admin/companies",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem criar empresas");
    }

    const input = parseCompanyInput(req.body);
    const supabaseAdmin = createServiceSupabaseClient();
    const { data, error } = await supabaseAdmin
      .from("empresas")
      .insert({
        aces_id: context.acesId,
        created_by: context.crmUserId,
        ...input,
      })
      .select(
        "id, cnpj, legal_name, name, phone, email, address, city, state, postal_code, timezone, is_active, created_at, updated_at",
      )
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new HttpError(409, "Este CNPJ ja esta cadastrado nesta conta", error);
      }
      if (error.code === "23514") {
        throw new HttpError(400, "CNPJ ou dados da empresa invalidos", error);
      }
      throw new HttpError(500, "Nao foi possivel criar a empresa", error);
    }

    res.status(201).json({ success: true, company: data });
  }),
);

app.patch(
  "/api/admin/companies/:id",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(403, "Apenas administradores podem editar empresas");
    }

    const input = parseCompanyInput(req.body);
    const supabaseAdmin = createServiceSupabaseClient();
    const { data, error } = await supabaseAdmin
      .from("empresas")
      .update(input)
      .eq("id", getSingleParam(req.params.id))
      .eq("aces_id", context.acesId)
      .select(
        "id, cnpj, legal_name, name, phone, email, address, city, state, postal_code, timezone, is_active, created_at, updated_at",
      )
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        throw new HttpError(409, "Este CNPJ ja esta cadastrado nesta conta", error);
      }
      if (error.code === "23514") {
        throw new HttpError(400, "CNPJ ou dados da empresa invalidos", error);
      }
      throw new HttpError(500, "Nao foi possivel atualizar a empresa", error);
    }
    if (!data) throw new HttpError(404, "Empresa nao encontrada");

    res.json({ success: true, company: data });
  }),
);

app.get(
  "/api/admin/company-access",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem gerenciar acessos de empresa",
      );
    }

    const supabaseAdmin = createServiceSupabaseClient();
    const [companiesResult, membershipsResult] = await Promise.all([
      supabaseAdmin
        .from("empresas")
        .select("id, cnpj, name, city, state, is_active")
        .eq("aces_id", context.acesId)
        .eq("is_active", true)
        .order("name"),
      supabaseAdmin
        .from("empresa_memberships")
        .select("id, empresa_id, crm_user_id, is_active")
        .eq("aces_id", context.acesId)
        .eq("is_active", true),
    ]);

    const error = companiesResult.error ?? membershipsResult.error;
    if (error) {
      throw new HttpError(
        500,
        "Nao foi possivel carregar os acessos de empresa",
        error,
      );
    }

    res.json({
      success: true,
      companies: companiesResult.data ?? [],
      memberships: membershipsResult.data ?? [],
    });
  }),
);

app.post(
  "/api/admin/company-access",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem gerenciar acessos de empresa",
      );
    }

    const companyId = String(req.body.companyId ?? "").trim();
    const crmUserId = String(req.body.crmUserId ?? "").trim();
    if (!companyId || !crmUserId) {
      throw new HttpError(400, "Empresa e vendedor sao obrigatorios");
    }

    const supabaseAdmin = createServiceSupabaseClient();
    const [{ data: company }, { data: seller }] = await Promise.all([
      supabaseAdmin
        .from("empresas")
        .select("id")
        .eq("id", companyId)
        .eq("aces_id", context.acesId)
        .eq("is_active", true)
        .maybeSingle(),
      supabaseAdmin
        .from("users")
        .select("id")
        .eq("id", crmUserId)
        .eq("aces_id", context.acesId)
        .eq("role", "VENDEDOR")
        .maybeSingle(),
    ]);

    if (!company || !seller) {
      throw new HttpError(404, "Empresa ou vendedor nao encontrado na conta");
    }

    const { data, error } = await supabaseAdmin
      .from("empresa_memberships")
      .upsert(
        {
          aces_id: context.acesId,
          empresa_id: companyId,
          crm_user_id: crmUserId,
          granted_by: context.crmUserId,
          is_active: true,
          granted_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: "empresa_id,crm_user_id" },
      )
      .select("id, empresa_id, crm_user_id, is_active")
      .single();

    if (error) {
      throw new HttpError(
        500,
        "Nao foi possivel salvar o acesso da empresa",
        error,
      );
    }

    res.json({ success: true, membership: data });
  }),
);

app.delete(
  "/api/admin/company-access/:companyId/:userId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem gerenciar acessos de empresa",
      );
    }

    const supabaseAdmin = createServiceSupabaseClient();
    const { error } = await supabaseAdmin
      .from("empresa_memberships")
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq("aces_id", context.acesId)
      .eq("empresa_id", getSingleParam(req.params.companyId))
      .eq("crm_user_id", getSingleParam(req.params.userId))
      .eq("is_active", true);

    if (error) {
      throw new HttpError(
        500,
        "Nao foi possivel revogar o acesso da empresa",
        error,
      );
    }

    res.json({ success: true });
  }),
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
  }),
);

app.post(
  "/api/admin/users/invite",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem convidar usuarios",
      );
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
        typeof invitePayload.error === "string"
          ? invitePayload.error
          : "Erro ao criar convite",
        invitePayload,
      );
    }

    const invitationId = String(invitePayload.invitation_id ?? "");
    if (!invitationId) {
      throw new HttpError(500, "Convite criado sem identificador");
    }

    const edgePayload = await forwardSupabaseFunction(
      "send-user-invitation",
      context.accessToken,
      { email, invitationId },
    );

    res.json({
      success: true,
      invitationId,
      invitation: invitePayload,
      emailResult: edgePayload,
    });
  }),
);

app.post(
  "/api/admin/invitations/:id/cancel",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    if (context.role !== "ADMIN") {
      throw new HttpError(
        403,
        "Apenas administradores podem cancelar convites",
      );
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
        typeof payload.error === "string"
          ? payload.error
          : "Erro ao cancelar convite",
        payload,
      );
    }

    res.json({ success: true });
  }),
);

app.post(
  "/api/chat/attachments/upload-url",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await manager.createChatAttachmentUploadUrl(
      req.authContext!,
      {
        leadId: String(req.body.leadId ?? ""),
        instanceName:
          typeof req.body.instanceName === "string"
            ? req.body.instanceName
            : null,
        fileName: String(req.body.fileName ?? ""),
        mimeType: String(req.body.mimeType ?? ""),
        fileSize: Number(req.body.fileSize ?? 0),
        kind: String(req.body.kind ?? "") as "image" | "audio" | "document",
      },
    );

    res.json(result);
  }),
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
        typeof req.body.instanceName === "string"
          ? req.body.instanceName
          : null,
      attachment: req.body.attachment
        ? {
            messageId: String(attachmentInput.messageId ?? ""),
            attachmentId: String(attachmentInput.attachmentId ?? ""),
            storagePath: String(attachmentInput.storagePath ?? ""),
            fileName: String(attachmentInput.fileName ?? ""),
            mimeType: String(attachmentInput.mimeType ?? ""),
            fileSize: Number(attachmentInput.fileSize ?? 0),
            kind: String(attachmentInput.kind ?? "") as
              "image" | "audio" | "document",
          }
        : null,
    });

    res.json(result);
  }),
);

app.get(
  "/api/chat/leads/:leadId/messages",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await manager.listChatMessages(
      req.authContext!,
      getSingleParam(req.params.leadId),
      asString(req.query.instanceName),
    );
    res.json(result);
  }),
);

app.get(
  "/api/chat/leads/:leadId/ai-state",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const leadId = getSingleParam(req.params.leadId);
    const result = await manager.getLeadAiState(req.authContext!, leadId, asString(req.query.instanceName));
    res.json(result);
  }),
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
      req.body.enabled,
      asString(req.body.instanceName),
    );
    res.json(result);
  }),
);

app.post(
  "/api/chat/leads/:leadId/handoff/finalize",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const leadId = getSingleParam(req.params.leadId);
    const result = await manager.finalizeHumanHandoff(req.authContext!, {
      leadId,
      stageId: String(req.body.stageId ?? ""),
      instanceName: asString(req.body.instanceName),
    });
    res.json(result);
  }),
);

app.post(
  "/api/ai-agents/handoff/test",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await manager.testHandoff(req.authContext!, {
      instanceName: String(req.body.instanceName ?? ""),
      targetPhone: String(req.body.targetPhone ?? ""),
      agentName:
        typeof req.body.agentName === "string" ? req.body.agentName : undefined,
      handoffPrompt:
        typeof req.body.handoffPrompt === "string"
          ? req.body.handoffPrompt
          : undefined,
    });

    res.json(result);
  }),
);

app.post(
  "/api/instances",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await manager.createInstanceConnection(req.authContext!, {
      instanceName: String(req.body.instanceName ?? ""),
      connectWebhook: req.body.connectWebhook === true,
      remoteEvolutionUrl:
        typeof req.body.remoteEvolutionUrl === "string"
          ? req.body.remoteEvolutionUrl
          : null,
      remoteApiKey:
        typeof req.body.remoteApiKey === "string"
          ? req.body.remoteApiKey
          : null,
      remoteInstanceName:
        typeof req.body.remoteInstanceName === "string"
          ? req.body.remoteInstanceName
          : null,
    });

    res.status(201).json(result);
  }),
);

app.get(
  "/api/instances",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instances = await manager.listInstances(req.authContext!);
    res.json({ success: true, instances });
  }),
);

app.post(
  "/api/instances/:name/reconnect",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = getSingleParam(req.params.name);
    const result = await manager.reconnectInstance(
      req.authContext!,
      instanceName,
    );
    res.json(result);
  }),
);

app.get(
  "/api/instances/:name/qrcode",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = getSingleParam(req.params.name);
    const result = await manager.getInstanceQrCode(
      req.authContext!,
      instanceName,
    );
    res.json(result);
  }),
);

app.get(
  "/api/instances/:name/status",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = getSingleParam(req.params.name);
    const result = await manager.getInstanceStatus(
      req.authContext!,
      instanceName,
    );
    res.json(result);
  }),
);

app.post(
  "/api/instances/:name/sync-status",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = getSingleParam(req.params.name);
    const result = await manager.getInstanceStatus(
      req.authContext!,
      instanceName,
    );
    res.json(result);
  }),
);

app.post(
  "/api/instances/:name/disconnect",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = getSingleParam(req.params.name);
    const result = await manager.disconnectInstance(
      req.authContext!,
      instanceName,
    );
    res.json(result);
  }),
);

app.delete(
  "/api/instances/:name",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const instanceName = getSingleParam(req.params.name);
    const hardDelete = String(req.query.hard ?? "").toLowerCase() === "true";
    const result = await manager.deleteInstance(
      req.authContext!,
      instanceName,
      {
        hardDelete,
        leadAction:
          req.body?.leadAction === "transfer" ||
          req.body?.leadAction === "delete" ||
          req.body?.leadAction === "none"
            ? req.body.leadAction
            : undefined,
        transferToInstanceName:
          typeof req.body?.transferToInstanceName === "string"
            ? req.body.transferToInstanceName
            : undefined,
        confirmationText:
          typeof req.body?.confirmationText === "string"
            ? req.body.confirmationText
            : undefined,
      },
    );
    res.json(result);
  }),
);

app.get(
  "/api/agent-templates",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const templates = await manager.listAgentTemplates(req.authContext!);
    res.json({ success: true, templates });
  }),
);

app.get(
  "/api/ai-agents",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agents = await manager.listAgents(req.authContext!);
    res.json({ success: true, agents });
  }),
);

app.post(
  "/api/ai-agents",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agent = await manager.createAgent(req.authContext!, {
      name: String(req.body.name ?? ""),
      instanceName: typeof req.body.instanceName === "string" ? req.body.instanceName : undefined,
      agentType: req.body.agentType === "subagent" ? "subagent" : "primary",
      parentAgentId: typeof req.body.parentAgentId === "string" ? req.body.parentAgentId : undefined,
      agentKey: typeof req.body.agentKey === "string" ? req.body.agentKey : undefined,
      routingInstruction: typeof req.body.routingInstruction === "string"
        ? req.body.routingInstruction
        : undefined,
      systemPrompt:
        typeof req.body.systemPrompt === "string"
          ? req.body.systemPrompt
          : undefined,
      model: typeof req.body.model === "string" ? req.body.model : undefined,
      provider: req.body.provider === "gemini" ? "gemini" : undefined,
      temperature:
        typeof req.body.temperature === "number"
          ? req.body.temperature
          : undefined,
      personalityProfile: asAgentPersonalityProfile(req.body.personalityProfile),
      isActive:
        typeof req.body.isActive === "boolean" ? req.body.isActive : undefined,
      bufferWaitMs:
        typeof req.body.bufferWaitMs === "number"
          ? req.body.bufferWaitMs
          : undefined,
      humanPauseMinutes:
        typeof req.body.humanPauseMinutes === "number"
          ? req.body.humanPauseMinutes
          : undefined,
      autoApplyThreshold:
        typeof req.body.autoApplyThreshold === "number"
          ? req.body.autoApplyThreshold
          : undefined,
      handoffEnabled:
        typeof req.body.handoffEnabled === "boolean"
          ? req.body.handoffEnabled
          : undefined,
      handoffPrompt:
        typeof req.body.handoffPrompt === "string"
          ? req.body.handoffPrompt
          : undefined,
      handoffTargetPhone:
        typeof req.body.handoffTargetPhone === "string"
          ? req.body.handoffTargetPhone
          : undefined,
      rbTokenApi:
        typeof req.body.rbTokenApi === "string"
          ? req.body.rbTokenApi
          : undefined,
      unansweredFollowupEnabled:
        typeof req.body.unansweredFollowupEnabled === "boolean"
          ? req.body.unansweredFollowupEnabled
          : undefined,
      templateKey:
        typeof req.body.templateKey === "string"
          ? req.body.templateKey
          : undefined,
    });

    res.status(201).json({ success: true, agent });
  }),
);

app.patch(
  "/api/ai-agents/:id",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const result = await manager.updateAgent(req.authContext!, agentId, {
      name: typeof req.body.name === "string" ? req.body.name : undefined,
      instanceName:
        typeof req.body.instanceName === "string"
          ? req.body.instanceName
          : undefined,
      routingInstruction:
        typeof req.body.routingInstruction === "string"
          ? req.body.routingInstruction
          : undefined,
      systemPrompt:
        typeof req.body.systemPrompt === "string"
          ? req.body.systemPrompt
          : undefined,
      model: typeof req.body.model === "string" ? req.body.model : undefined,
      provider: req.body.provider === "gemini" ? "gemini" : undefined,
      temperature:
        typeof req.body.temperature === "number"
          ? req.body.temperature
          : undefined,
      personalityProfile: asAgentPersonalityProfile(req.body.personalityProfile),
      isActive:
        typeof req.body.isActive === "boolean" ? req.body.isActive : undefined,
      bufferWaitMs:
        typeof req.body.bufferWaitMs === "number"
          ? req.body.bufferWaitMs
          : undefined,
      humanPauseMinutes:
        typeof req.body.humanPauseMinutes === "number"
          ? req.body.humanPauseMinutes
          : undefined,
      autoApplyThreshold:
        typeof req.body.autoApplyThreshold === "number"
          ? req.body.autoApplyThreshold
          : undefined,
      handoffEnabled:
        typeof req.body.handoffEnabled === "boolean"
          ? req.body.handoffEnabled
          : undefined,
      handoffPrompt:
        typeof req.body.handoffPrompt === "string"
          ? req.body.handoffPrompt
          : undefined,
      handoffTargetPhone:
        typeof req.body.handoffTargetPhone === "string"
          ? req.body.handoffTargetPhone
          : undefined,
      unansweredFollowupEnabled:
        typeof req.body.unansweredFollowupEnabled === "boolean"
          ? req.body.unansweredFollowupEnabled
          : undefined,
      instanceChangePolicy: asAgentInstanceChangePolicy(req.body.instanceChangePolicy),
    });

    res.json({ success: true, ...result });
  }),
);

app.get(
  "/api/ai-agents/:id/stage-rules",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const rules = await manager.getStageRules(req.authContext!, agentId);
    res.json({ success: true, rules });
  }),
);

app.delete(
  "/api/ai-agents/:id",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const result = await manager.deleteAgent(req.authContext!, agentId);
    res.json(result);
  }),
);

app.put(
  "/api/ai-agents/:id/stage-rules",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const rules = Array.isArray(req.body.rules) ? req.body.rules : [];
    const agentId = getSingleParam(req.params.id);
    const saved = await manager.saveStageRules(
      req.authContext!,
      agentId,
      rules,
    );
    res.json({ success: true, rules: saved });
  }),
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
  }),
);

app.post(
  "/api/ai-agents/:id/leads/:leadId/resume",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const leadId = getSingleParam(req.params.leadId);
    const result = await manager.resumeLead(req.authContext!, agentId, leadId);
    res.json(result);
  }),
);

app.get(
  "/api/agents",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agents = await manager.listAgents(req.authContext!);
    res.json({ success: true, agents });
  }),
);

app.post(
  "/api/agents",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
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
        typeof req.body.temperature === "number"
          ? req.body.temperature
          : undefined,
      personalityProfile: asAgentPersonalityProfile(req.body.personalityProfile),
      isActive:
        typeof req.body.isActive === "boolean" ? req.body.isActive : undefined,
      bufferWaitMs:
        typeof req.body.bufferWaitMs === "number"
          ? req.body.bufferWaitMs
          : undefined,
      handoffEnabled:
        typeof req.body.handoffEnabled === "boolean"
          ? req.body.handoffEnabled
          : undefined,
      handoffPrompt:
        typeof req.body.handoffPrompt === "string"
          ? req.body.handoffPrompt
          : undefined,
      handoffTargetPhone:
        typeof req.body.handoffTargetPhone === "string"
          ? req.body.handoffTargetPhone
          : undefined,
      rbTokenApi:
        typeof req.body.rbTokenApi === "string"
          ? req.body.rbTokenApi
          : undefined,
      unansweredFollowupEnabled:
        typeof req.body.unansweredFollowupEnabled === "boolean"
          ? req.body.unansweredFollowupEnabled
          : undefined,
      templateKey:
        typeof req.body.templateKey === "string"
          ? req.body.templateKey
          : undefined,
    });

    res.status(201).json({ success: true, agent });
  }),
);

app.patch(
  "/api/agents/:id",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const result = await manager.updateAgent(req.authContext!, agentId, {
      name:
        typeof req.body.name === "string"
          ? req.body.name
          : typeof req.body.agentName === "string"
            ? req.body.agentName
            : undefined,
      instanceName:
        typeof req.body.instanceName === "string"
          ? req.body.instanceName
          : undefined,
      systemPrompt:
        typeof req.body.systemPrompt === "string"
          ? req.body.systemPrompt
          : typeof req.body.systemMessage === "string"
            ? req.body.systemMessage
            : undefined,
      model: typeof req.body.model === "string" ? req.body.model : undefined,
      temperature:
        typeof req.body.temperature === "number"
          ? req.body.temperature
          : undefined,
      personalityProfile: asAgentPersonalityProfile(req.body.personalityProfile),
      bufferWaitMs:
        typeof req.body.bufferWaitMs === "number"
          ? req.body.bufferWaitMs
          : undefined,
      handoffEnabled:
        typeof req.body.handoffEnabled === "boolean"
          ? req.body.handoffEnabled
          : undefined,
      handoffPrompt:
        typeof req.body.handoffPrompt === "string"
          ? req.body.handoffPrompt
          : undefined,
      handoffTargetPhone:
        typeof req.body.handoffTargetPhone === "string"
          ? req.body.handoffTargetPhone
          : undefined,
      unansweredFollowupEnabled:
        typeof req.body.unansweredFollowupEnabled === "boolean"
          ? req.body.unansweredFollowupEnabled
          : undefined,
      instanceChangePolicy: asAgentInstanceChangePolicy(req.body.instanceChangePolicy),
    });

    res.json({ success: true, ...result });
  }),
);

app.delete(
  "/api/agents/:id",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const result = await manager.deleteAgent(req.authContext!, agentId);
    res.json(result);
  }),
);

app.get(
  "/api/agents/:id/tools",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const tools = await manager.listAgentTools(req.authContext!, agentId);
    res.json({ success: true, tools });
  }),
);

app.get(
  "/api/agents/:id/audio/voices",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const result = await manager.listElevenLabsVoices(
      req.authContext!,
      agentId,
      {
        search: asString(req.query.search),
        nextPageToken: asString(req.query.nextPageToken),
        pageSize: Number(req.query.pageSize ?? 20),
      },
    );
    res.json({ success: true, ...result });
  }),
);

app.patch(
  "/api/agents/:id/tools/:toolKey",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const toolKey = getSingleParam(req.params.toolKey);
    const tool = await manager.updateAgentTool(
      req.authContext!,
      agentId,
      toolKey,
      {
        isEnabled:
          typeof req.body.isEnabled === "boolean"
            ? req.body.isEnabled
            : undefined,
        config:
          req.body.config &&
          typeof req.body.config === "object" &&
          !Array.isArray(req.body.config)
            ? req.body.config
            : undefined,
      },
    );
    res.json({ success: true, tool });
  }),
);

app.post(
  "/api/agents/:id/tools/rb_billing/bootstrap",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const mode = req.body.mode === "dr_oculos" ? "dr_oculos" : "generic";
    const result = await manager.bootstrapRbBilling(
      req.authContext!,
      agentId,
      mode,
    );
    res.status(201).json({ success: true, ...result });
  }),
);

app.post(
  "/api/agents/:id/tools/rb_billing/run-now",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const result = await rbBillingWorker.runNowForAgent(
      req.authContext!.acesId,
      agentId,
    );
    res.status(202).json({ success: true, result });
  }),
);

app.get(
  "/api/agents/:id/tools/send_media/assets",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const assets = await manager.listToolMediaAssets(req.authContext!, agentId);
    res.json({ success: true, assets });
  }),
);

app.post(
  "/api/agents/:id/tools/send_media/assets",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const mediaKind = req.body.mediaKind === "document" ? "document" : "image";
    const asset = await manager.upsertToolMediaAsset(
      req.authContext!,
      agentId,
      {
        assetKey: String(req.body.assetKey ?? ""),
        displayName: String(req.body.displayName ?? ""),
        description:
          typeof req.body.description === "string"
            ? req.body.description
            : undefined,
        usageInstruction:
          typeof req.body.usageInstruction === "string"
            ? req.body.usageInstruction
            : undefined,
        sourceUrl: String(req.body.sourceUrl ?? ""),
        mediaKind,
        fileName:
          typeof req.body.fileName === "string" ? req.body.fileName : null,
        defaultCaption:
          typeof req.body.defaultCaption === "string"
            ? req.body.defaultCaption
            : null,
      },
    );
    res.status(201).json({ success: true, asset });
  }),
);

app.delete(
  "/api/agents/:id/tools/send_media/assets/:assetId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const assetId = getSingleParam(req.params.assetId);
    const result = await manager.deactivateToolMediaAsset(
      req.authContext!,
      agentId,
      assetId,
    );
    res.json(result);
  }),
);

app.get(
  "/api/agents/:id/tools/prescription_analyst/lens-price-rules",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const rules = await manager.listLensPriceRules(req.authContext!, agentId);
    res.json({ success: true, rules });
  }),
);

app.post(
  "/api/agents/:id/tools/prescription_analyst/lens-price-rules",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const lensCategory =
      req.body.lensCategory === "multifocal" ? "multifocal" : "single_vision";
    const rule = await manager.upsertLensPriceRule(req.authContext!, agentId, {
      id: typeof req.body.id === "string" ? req.body.id : null,
      displayName: String(req.body.displayName ?? ""),
      lensCategory,
      minSphere: Number(req.body.minSphere),
      maxSphere: Number(req.body.maxSphere),
      maxAbsCylinder: Number(req.body.maxAbsCylinder),
      minAddition:
        req.body.minAddition === null || req.body.minAddition === undefined
          ? null
          : Number(req.body.minAddition),
      maxAddition:
        req.body.maxAddition === null || req.body.maxAddition === undefined
          ? null
          : Number(req.body.maxAddition),
      priceCents: Number(req.body.priceCents),
      priority: Number(req.body.priority ?? 100),
      isActive: req.body.isActive !== false,
    });
    res.status(201).json({ success: true, rule });
  }),
);

app.delete(
  "/api/agents/:id/tools/prescription_analyst/lens-price-rules/:ruleId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const result = await manager.deactivateLensPriceRule(
      req.authContext!,
      getSingleParam(req.params.id),
      getSingleParam(req.params.ruleId),
    );
    res.json(result);
  }),
);

app.get(
  "/api/agents/:id/tools/visagism/catalog",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const catalog = await manager.listVisagismCatalog(
      req.authContext!,
      agentId,
    );
    res.json({ success: true, catalog });
  }),
);

app.post(
  "/api/agents/:id/tools/visagism/analyze",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const draft = await manager.analyzeVisagismCatalogDraft(
      req.authContext!,
      agentId,
      {
        productCode: String(req.body.productCode ?? ""),
        fileName: String(req.body.fileName ?? ""),
        mimeType: String(req.body.mimeType ?? ""),
        base64: String(req.body.base64 ?? ""),
      },
    );
    res.status(201).json({ success: true, draft });
  }),
);

app.post(
  "/api/agents/:id/tools/visagism/catalog",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const item = await manager.upsertVisagismCatalogItem(
      req.authContext!,
      agentId,
      {
        id: typeof req.body.id === "string" ? req.body.id : null,
        draftId: typeof req.body.draftId === "string" ? req.body.draftId : null,
        productCode: String(req.body.productCode ?? ""),
        recommendationDescription: String(
          req.body.recommendationDescription ?? "",
        ),
        attributes:
          req.body.attributes &&
          typeof req.body.attributes === "object" &&
          !Array.isArray(req.body.attributes)
            ? req.body.attributes
            : undefined,
        displayOrder:
          typeof req.body.displayOrder === "number"
            ? req.body.displayOrder
            : undefined,
        isActive:
          typeof req.body.isActive === "boolean"
            ? req.body.isActive
            : undefined,
      },
    );
    res.status(201).json({ success: true, item });
  }),
);

app.delete(
  "/api/agents/:id/tools/visagism/catalog/:itemId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const itemId = getSingleParam(req.params.itemId);
    const result = await manager.deactivateVisagismCatalogItem(
      req.authContext!,
      agentId,
      itemId,
    );
    res.json(result);
  }),
);

app.get(
  "/api/agents/:id/tools/visagism/runs",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const runs = await manager.listVisagismRuns(req.authContext!, agentId);
    res.json({ success: true, runs });
  }),
);

app.get(
  "/api/agents/:id/tools/visagism/runs/:runId",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const runId = getSingleParam(req.params.runId);
    const run = await manager.getVisagismRun(req.authContext!, agentId, runId);
    res.json({ success: true, run });
  }),
);

app.post(
  "/api/agents/:id/tools/visagism/runs",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const result = await manager.startVisagismRun(req.authContext!, agentId, {
      leadId: String(req.body.leadId ?? ""),
      sourceMessageId:
        typeof req.body.sourceMessageId === "string"
          ? req.body.sourceMessageId
          : null,
      excludedItemId:
        typeof req.body.excludedItemId === "string"
          ? req.body.excludedItemId
          : null,
    });
    res
      .status(result.status === "succeeded" ? 201 : 202)
      .json({ success: true, ...result });
  }),
);

app.get(
  "/api/agents/:id/tools/forwarding/setup",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const setup = await manager.getForwardingSetup(req.authContext!, agentId);
    res.json({ success: true, ...setup });
  }),
);

app.get(
  "/api/agents/:id/tools/forwarding/destinations",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    const destinations = await manager.listForwardingDestinations(
      req.authContext!,
      agentId,
    );
    res.json({ success: true, destinations });
  }),
);

app.post(
  "/api/agents/:id/tools/forwarding/destinations",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const agentId = getSingleParam(req.params.id);
    if (
      req.body.mode !== "external_notification" &&
      req.body.mode !== "agent" &&
      req.body.mode !== "internal_company"
    ) {
      throw new HttpError(400, "Modo de encaminhamento invalido");
    }
    const destination = await manager.upsertForwardingDestination(
      req.authContext!,
      agentId,
      {
        destinationKey: String(req.body.destinationKey ?? ""),
        displayName: String(req.body.displayName ?? ""),
        mode: req.body.mode,
        targetPhone:
          typeof req.body.targetPhone === "string"
            ? req.body.targetPhone
            : null,
        targetAgentId:
          typeof req.body.targetAgentId === "string"
            ? req.body.targetAgentId
            : null,
        empresaId:
          typeof req.body.empresaId === "string"
            ? req.body.empresaId
            : null,
        sellerIds: Array.isArray(req.body.sellerIds)
          ? req.body.sellerIds.map((sellerId: unknown) => String(sellerId))
          : [],
        contextInstruction: String(req.body.contextInstruction ?? ""),
      },
    );
    res.status(201).json({ success: true, destination });
  }),
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
      destinationId,
    );
    res.json(result);
  }),
);

app.get(
  "/api/admin/access",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    res.json({ isStaff: await manager.isAdminStaff(req.authContext!.authUserId) });
  }),
);

app.get(
  "/api/admin/overview",
  authMiddleware,
  requireStaff,
  asyncHandler(async (_req, res) => {
    res.json(await manager.adminRpc("service_admin_overview"));
  }),
);

app.get(
  "/api/admin/accounts",
  authMiddleware,
  requireStaff,
  asyncHandler(async (_req, res) => {
    res.json(await manager.adminRpc("service_admin_accounts"));
  }),
);

app.get(
  "/api/admin/accounts/:acesId",
  authMiddleware,
  requireStaff,
  asyncHandler(async (req, res) => {
    const acesId = adminNumber(getSingleParam(req.params.acesId), "acesId", { min: 1, integer: true });
    res.json(await manager.adminRpc("service_admin_account", { p_aces_id: acesId }));
  }),
);

app.patch(
  "/api/admin/accounts/:acesId/subscription",
  authMiddleware,
  requireStaff,
  asyncHandler(async (req, res) => {
    const acesId = adminNumber(getSingleParam(req.params.acesId), "acesId", { min: 1, integer: true });
    const input = asRecord(req.body);
    const payload: Record<string, unknown> = {};
    if ("planId" in input) {
      const planId = String(input.planId);
      if (!/^[0-9a-f-]{36}$/i.test(planId)) throw new HttpError(400, "planId invalido");
      payload.planId = planId;
    }
    if ("status" in input) {
      const status = String(input.status);
      if (!["active", "suspended", "canceled"].includes(status)) throw new HttpError(400, "status de contrato invalido");
      payload.status = status;
    }
    if ("cycleAnchorDay" in input) {
      const day = adminNumber(input.cycleAnchorDay, "cycleAnchorDay", { min: 1, integer: true });
      if (day > 31) throw new HttpError(400, "cycleAnchorDay deve estar entre 1 e 31");
      payload.cycleAnchorDay = day;
    }
    for (const field of ["implantacaoBrl", "mensalidadeBrlOverride", "aiBudgetBrlOverride"] as const) {
      if (field in input) payload[field] = input[field] === null ? null : adminNumber(input[field], field, { min: 0 });
    }
    for (const field of ["startedAt", "endedAt", "implantacaoPagaEm"] as const) {
      if (field in input) payload[field] = input[field] === null ? null : String(input[field]);
    }
    if ("enforcementEnabled" in input) payload.enforcementEnabled = input.enforcementEnabled === true;
    if (!("planId" in payload) && Object.keys(payload).length === 0) throw new HttpError(400, "Nenhuma alteracao de contrato informada");
    const result = await manager.adminRpc("service_admin_upsert_subscription", {
      p_aces_id: acesId,
      p_payload: payload,
    });
    invalidateAiBudgetCache(acesId);
    res.json(result);
  }),
);

app.post(
  "/api/admin/accounts/:acesId/reset-budget",
  authMiddleware,
  requireStaff,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const acesId = adminNumber(getSingleParam(req.params.acesId), "acesId", { min: 1, integer: true });
    const reason = asString(asRecord(req.body).reason);
    if (!reason || reason.length < 3) throw new HttpError(400, "Motivo do reset e obrigatorio");
    const result = await manager.adminRpc("service_admin_reset_budget", {
      p_aces_id: acesId,
      p_reason: reason,
      p_author: req.authContext!.authUserId,
    });
    invalidateAiBudgetCache(acesId);
    res.json(result);
  }),
);

function registerAdminResourceRoutes(
  path: string,
  resource: string,
  catalogKey: string,
  parser: (body: unknown, partial?: boolean) => Record<string, unknown>,
) {
  app.get(path, authMiddleware, requireStaff, asyncHandler(async (_req, res) => {
    const catalog = asRecord(await manager.adminRpc("service_admin_finance_catalog"));
    res.json({ [catalogKey]: catalog[catalogKey] ?? [] });
  }));
  app.post(path, authMiddleware, requireStaff, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const item = await manager.adminRpc("service_admin_mutate", {
      p_resource: resource,
      p_action: "create",
      p_id: null,
      p_payload: parser(req.body, false),
      p_author: req.authContext!.authUserId,
    });
    res.status(201).json(item);
  }));
  app.patch(`${path}/:id`, authMiddleware, requireStaff, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const item = await manager.adminRpc("service_admin_mutate", {
      p_resource: resource,
      p_action: "update",
      p_id: getSingleParam(req.params.id),
      p_payload: parser(req.body, true),
      p_author: req.authContext!.authUserId,
    });
    res.json(item);
  }));
  app.delete(`${path}/:id`, authMiddleware, requireStaff, asyncHandler(async (req: AuthenticatedRequest, res) => {
    await manager.adminRpc("service_admin_mutate", {
      p_resource: resource,
      p_action: "delete",
      p_id: getSingleParam(req.params.id),
      p_payload: {},
      p_author: req.authContext!.authUserId,
    });
    res.status(204).send();
  }));
}

registerAdminResourceRoutes("/api/admin/plans", "plans", "plans", parseAdminPlan);
registerAdminResourceRoutes("/api/admin/revenue-entries", "revenue", "revenue", parseAdminRevenue);
registerAdminResourceRoutes("/api/admin/fixed-costs", "fixed-costs", "fixedCosts", parseAdminFixedCost);
registerAdminResourceRoutes("/api/admin/exchange-rates", "exchange-rates", "exchangeRates", parseAdminExchangeRate);

app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    return res.status(error.statusCode).json({
      error: error.message,
      details: error.details ?? null,
    });
  }

  const payloadError = error as {
    type?: string;
    status?: number;
    limit?: number;
    length?: number;
  };
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
let stopPipelineWorker: (() => void) | null = null;
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

  if (process.env.PIPELINE_WORKER_ENABLED === "true") {
    stopPipelineWorker = startPipelineWorker();
  }
}

bootstrap().catch(async (error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "[crm-ai-backend] Falha desconhecida ao inicializar o backend",
  );
  try {
    await manager.dispose();
  } catch (disposeError) {
    console.error(
      "[crm-ai-backend] Falha ao liberar recursos na inicializacao:",
      disposeError,
    );
  }
  process.exit(1);
});

process.on("SIGINT", async () => {
  stopPipelineWorker?.();
  rbBillingWorker.stop();
  await manager.dispose();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  stopPipelineWorker?.();
  rbBillingWorker.stop();
  await manager.dispose();
  process.exit(0);
});
