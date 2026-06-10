import "./load-env.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { createClient } from "@supabase/supabase-js";
import {
  AgentManager,
  DEFAULT_SYSTEM_MESSAGE,
  HttpError,
  type WebhookPayload,
} from "./sdr-agent-gemini.js";
import { assertRuntimeSchemaCompatibility } from "./schema-preflight.js";
import { startAutomationWorker } from "./automation-worker.js";
import { MetaWebhookProcessor } from "./meta-webhook.js";
import { MetaTemplateService } from "./meta-template-service.js";
import { MetaAdminService } from "./meta-admin-service.js";

type AuthenticatedRequest = Request & {
  authContext?: Awaited<ReturnType<AgentManager["authenticate"]>>;
};

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

type CrmUserRole = "NENHUM" | "VENDEDOR" | "ADMIN";

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
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL,
  openaiVisionModel: process.env.OPENAI_VISION_MODEL,
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

const app = express();
app.use(
  express.json({
    limit: "50mb",
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
    "Content-Type, Authorization, x-webhook-secret, x-evolution-secret, x-hub-signature-256"
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
  const providedSecret =
    req.header("x-webhook-secret") ||
    req.header("x-evolution-secret") ||
    req.header("authorization");

  if (!manager.validateWebhookSecret(providedSecret)) {
    throw new HttpError(401, "Webhook da Evolution sem credencial valida");
  }

  const result = await manager.processEvolutionWebhook(req.body as WebhookPayload);
  res.status(202).json(result);
});

const metaWebhookHandler = asyncHandler(async (req, res) => {
  const signature = req.header("x-hub-signature-256");
  if (!metaWebhookProcessor.verifySignature((req as RawBodyRequest).rawBody, signature)) {
    throw new HttpError(401, "Webhook da Meta sem assinatura valida");
  }

  const result = await metaWebhookProcessor.processWebhook(req.body);
  res.status(202).json(result);
});

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
    const { data, error } = await supabaseAdmin
      .from("instance")
      .select("instancia, color, aces_id, status, setup_status, created_by")
      .eq("aces_id", context.acesId)
      .eq("created_by", context.crmUserId)
      .or("setup_status.is.null,setup_status.neq.cancelled")
      .order("instancia");

    if (error) {
      throw new HttpError(500, "Nao foi possivel carregar instancias", error);
    }

    res.json({ success: true, instances: data ?? [] });
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
  "/api/chat/send-manual",
  authMiddleware,
  asyncHandler(async (req: AuthenticatedRequest, res) => {
    const context = req.authContext!;
    const result = await manager.sendManualMessage(context, {
      leadId: String(req.body.leadId ?? ""),
      content: String(req.body.content ?? ""),
      instanceName:
        typeof req.body.instanceName === "string" ? req.body.instanceName : null,
    });

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
    const result = await manager.createInstanceWithQr(req.authContext!, {
      instanceName: String(req.body.instanceName ?? ""),
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
    });

    res.json({ success: true, agent });
  })
);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    return res.status(error.statusCode).json({
      error: error.message,
      details: error.details ?? null,
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
  await manager.dispose();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await manager.dispose();
  process.exit(0);
});
