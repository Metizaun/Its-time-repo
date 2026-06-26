import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

import { AgentManager, type WebhookPayload } from "../sdr-agent-gemini.js";

type EnvMap = Record<string, string>;

type EvolutionChatRecord = {
  remoteJid: string;
  pushName: string | null;
  updatedAt: string | null;
  lastMessage?: EvolutionMessageRecord | null;
};

type EvolutionMessageRecord = {
  id?: string | null;
  key?: {
    id?: string | null;
    fromMe?: boolean | null;
    remoteJid?: string | null;
    remoteJidAlt?: string | null;
  } | null;
  pushName?: string | null;
  messageType?: string | null;
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | string | null;
  source?: string | null;
};

type RecoveryCandidate = {
  messageId: string;
  remoteJid: string;
  phoneJid: string;
  pushName: string | null;
  sentAtIso: string;
  contentPreview: string | null;
  messageType: string | null;
  source: string | null;
  payload: WebhookPayload;
};

function parseArgs(argv: string[]) {
  const parsed: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      continue;
    }

    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function loadEnvFiles() {
  const candidates = [
    path.resolve(process.cwd(), "../../.env.local"),
    path.resolve(process.cwd(), "../../.env.vps.local"),
    path.resolve(process.cwd(), "../.env.local"),
    path.resolve(process.cwd(), "../.env.vps.local"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env.vps.local"),
    path.resolve(process.cwd(), ".env"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }
  return value;
}

function buildManager(options?: { disableRedis?: boolean }) {
  return new AgentManager({
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
    redisUrl: options?.disableRedis ? undefined : process.env.REDIS_URL,
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
  });
}

function normalizePhoneJid(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes("@")) {
    const [local] = trimmed.split("@");
    return /^\d{10,15}$/.test(local ?? "") ? `${local}@s.whatsapp.net` : null;
  }

  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? `${digits}@s.whatsapp.net` : null;
}

function toSecondPrecisionIso(value: string | number | Date | null | undefined) {
  const date = value instanceof Date ? value : new Date(value ?? "");
  const ms = date.getTime();
  if (!Number.isFinite(ms)) {
    return null;
  }

  return new Date(Math.floor(ms / 1000) * 1000).toISOString();
}

function asConversationText(message: Record<string, unknown> | null | undefined) {
  if (!message) return null;
  const conversation = typeof message.conversation === "string" ? message.conversation : null;
  if (conversation) return conversation;

  const extendedText = message.extendedTextMessage as { text?: unknown } | undefined;
  if (typeof extendedText?.text === "string") return extendedText.text;

  const imageMessage = message.imageMessage as { caption?: unknown } | undefined;
  if (typeof imageMessage?.caption === "string") return imageMessage.caption;

  const videoMessage = message.videoMessage as { caption?: unknown } | undefined;
  if (typeof videoMessage?.caption === "string") return videoMessage.caption;

  return null;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Falha ${response.status} em ${url}: ${text}`);
  }

  return (text ? JSON.parse(text) : {}) as T;
}

async function loadExistingConversationIds(env: EnvMap, instanceName: string, sinceIso: string) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: "crm" },
  });

  const { data, error } = await supabase
    .from("message_history")
    .select("conversation_id, sent_at, direction")
    .eq("instance", instanceName)
    .eq("direction", "inbound")
    .gte("sent_at", sinceIso);

  if (error) {
    throw error;
  }

  const map = new Set<string>();
  for (const row of data ?? []) {
    const conversationId = String(row.conversation_id ?? "").trim();
    const sentAt = toSecondPrecisionIso(row.sent_at);
    if (!conversationId || !sentAt) continue;
    map.add(`${conversationId}::${sentAt}`);
  }
  return map;
}

async function fetchLidInboundCandidates(params: {
  apiUrl: string;
  apiKey: string;
  remoteInstanceName: string;
  sinceIso: string;
}) {
  const chats = await fetchJson<EvolutionChatRecord[]>(
    `${params.apiUrl}/chat/findChats/${encodeURIComponent(params.remoteInstanceName)}`,
    {
      method: "POST",
      headers: {
        apikey: params.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ where: {} }),
    }
  );

  const candidates: RecoveryCandidate[] = [];
  const sinceMs = Date.parse(params.sinceIso);

  for (const chat of chats) {
    const remoteJid = String(chat.remoteJid ?? "");
    if (!remoteJid.endsWith("@lid")) {
      continue;
    }

    const lastMessage = chat.lastMessage;
    if (!lastMessage?.key || lastMessage.key.fromMe !== false) {
      continue;
    }

    const phoneJid = normalizePhoneJid(lastMessage.key.remoteJidAlt);
    if (!phoneJid) {
      continue;
    }

    const sentAtRaw = lastMessage.messageTimestamp;
    const sentAtMs =
      typeof sentAtRaw === "number"
        ? sentAtRaw * (sentAtRaw > 1_000_000_000_000 ? 1 : 1000)
        : Date.parse(String(sentAtRaw ?? ""));

    if (!Number.isFinite(sentAtMs) || sentAtMs < sinceMs) {
      continue;
    }

    const sentAtIso = toSecondPrecisionIso(sentAtMs);
    if (!sentAtIso) {
      continue;
    }
    const messageId = String(lastMessage.key.id ?? "").trim();
    if (!messageId) {
      continue;
    }

    candidates.push({
      messageId,
      remoteJid,
      phoneJid,
      pushName: chat.pushName ?? lastMessage.pushName ?? null,
      sentAtIso,
      contentPreview: asConversationText(lastMessage.message) ?? null,
      messageType: lastMessage.messageType ?? null,
      source: lastMessage.source ?? null,
      payload: {
        event: "messages.upsert",
        instance: params.remoteInstanceName,
        data: {
          key: {
            id: messageId,
            fromMe: false,
            remoteJid,
            remoteJidAlt: phoneJid,
          },
          pushName: chat.pushName ?? lastMessage.pushName ?? null,
          message: lastMessage.message ?? {},
          messageType: lastMessage.messageType ?? "conversation",
          messageTimestamp: Math.floor(sentAtMs / 1000),
          messageData: {
            key: {
              id: messageId,
              fromMe: false,
              remoteJid,
              remoteJidAlt: phoneJid,
            },
          },
        },
      },
    });
  }

  candidates.sort((left, right) => left.sentAtIso.localeCompare(right.sentAtIso));
  return candidates;
}

async function main() {
  loadEnvFiles();

  const args = parseArgs(process.argv.slice(2));
  const instanceName = String(args.instance ?? "Lavie");
  const remoteInstanceName = String(args["remote-instance"] ?? "lavie");
  const sinceIso = String(args.since ?? "2026-06-24T00:00:00Z");
  const shouldApply = args.apply === true;
  const disableRedis = args["disable-redis"] === true || shouldApply;

  const env: EnvMap = {
    SUPABASE_URL: requireEnv("SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  };

  const existing = await loadExistingConversationIds(env, instanceName, sinceIso);
  const manager = buildManager({ disableRedis });
  const apiUrl = requireEnv("EVOLUTION_API_URL").replace(/\/$/, "");
  const localApiKey = requireEnv("EVOLUTION_API_KEY");

  const remoteApiUrl = String(args["evolution-url"] ?? apiUrl).replace(/\/$/, "");
  const remoteApiKey = String(args["evolution-key"] ?? localApiKey);

  const candidates = await fetchLidInboundCandidates({
    apiUrl: remoteApiUrl,
    apiKey: remoteApiKey,
    remoteInstanceName,
    sinceIso,
  });

  const missing = candidates.filter((candidate) => !existing.has(`${candidate.phoneJid}::${candidate.sentAtIso}`));

  console.log(
    JSON.stringify(
      {
        mode: shouldApply ? "apply" : "dry-run",
        instanceName,
        remoteInstanceName,
        sinceIso,
        foundCandidates: candidates.length,
        missingCandidates: missing.length,
        preview: missing.slice(0, 20).map((item) => ({
          sentAtIso: item.sentAtIso,
          phoneJid: item.phoneJid,
          pushName: item.pushName,
          contentPreview: item.contentPreview,
          source: item.source,
          messageType: item.messageType,
          messageId: item.messageId,
        })),
      },
      null,
      2
    )
  );

  if (!shouldApply) {
    return;
  }

  let recovered = 0;
  const failures: Array<{ messageId: string; phoneJid: string; error: string }> = [];

  for (const candidate of missing) {
    try {
      const result = await manager.processEvolutionWebhook(candidate.payload);
      const ignored = typeof result === "object" && result !== null && "ignored" in result && result.ignored === true;
      if (!ignored) {
        recovered += 1;
      } else {
        failures.push({
          messageId: candidate.messageId,
          phoneJid: candidate.phoneJid,
          error: `ignorado: ${JSON.stringify(result)}`,
        });
      }
    } catch (error) {
      failures.push({
        messageId: candidate.messageId,
        phoneJid: candidate.phoneJid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        recovered,
        failed: failures.length,
        failures: failures.slice(0, 50),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
