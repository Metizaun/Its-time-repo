import "./load-env";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  AgentManager,
  DEFAULT_SYSTEM_MESSAGE,
  HttpError,
  type WebhookPayload,
} from "./sdr-agent-gemini";
import { startAutomationWorker } from "./automation-worker";

type AuthenticatedRequest = Request & {
  authContext?: Awaited<ReturnType<AgentManager["authenticate"]>>;
};

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

const manager = new AgentManager({
  supabaseUrl: requireEnv("SUPABASE_URL"),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || requireEnv("SUPABASE_KEY"),
  supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  geminiApiKey: process.env.GEMINI_API_KEY,
  redisUrl: process.env.REDIS_URL,
  evolutionApiUrl: requireEnv("EVOLUTION_API_URL"),
  evolutionApiKey: requireEnv("EVOLUTION_API_KEY"),
  evolutionWebhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET,
});

const app = express();
app.use(express.json({ limit: "50mb" }));

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
    "Content-Type, Authorization, x-webhook-secret, x-evolution-secret"
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

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "crm-ai-backend",
    defaultSystemMessage: DEFAULT_SYSTEM_MESSAGE,
  });
});

app.post("/webhook/evolution", webhookHandler);
app.post("/api/webhook/evolution", webhookHandler);

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
app.listen(port, () => {
  console.log(`[crm-ai-backend] Servidor rodando na porta ${port}`);
});

if (process.env.AUTOMATION_WORKER_ENABLED === "true") {
  startAutomationWorker();
}

process.on("SIGINT", async () => {
  await manager.dispose();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await manager.dispose();
  process.exit(0);
});
