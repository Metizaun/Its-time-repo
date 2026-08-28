import type { MessagingProviderName } from "./messaging-channel.js";

const GUPSHUP_CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const INSTAGRAM_STANDARD_WINDOW_MS = 24 * 60 * 60 * 1000;
const INSTAGRAM_HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type ChatSendPolicy = {
  provider: MessagingProviderName;
  mode: "freeform" | "human_agent" | "template_required" | "closed";
  supportsAttachments: boolean;
  supportedAttachmentKinds: Array<"image" | "audio" | "document">;
  lastInboundAt: string | null;
  windowExpiresAt: string | null;
  evaluatedAt: string;
  remainingMs: number | null;
};

export function buildChatSendPolicy(
  provider: MessagingProviderName,
  lastInboundAt: string | null | undefined,
  evaluatedAt = new Date(),
): ChatSendPolicy {
  const evaluatedAtMs = evaluatedAt.getTime();
  const normalizedLastInboundAt = lastInboundAt?.trim() || null;

  if (provider !== "gupshup" && provider !== "instagram") {
    return {
      provider,
      mode: "freeform",
      supportsAttachments: true,
      supportedAttachmentKinds: ["image", "audio", "document"],
      lastInboundAt: normalizedLastInboundAt,
      windowExpiresAt: null,
      evaluatedAt: evaluatedAt.toISOString(),
      remainingMs: null,
    };
  }

  const lastInboundAtMs = normalizedLastInboundAt
    ? Date.parse(normalizedLastInboundAt)
    : Number.NaN;
  const hasValidInbound =
    Number.isFinite(lastInboundAtMs) && lastInboundAtMs <= evaluatedAtMs;

  if (!hasValidInbound) {
    return {
      provider,
      mode: provider === "instagram" ? "closed" : "template_required",
      supportsAttachments: provider !== "instagram",
      supportedAttachmentKinds: provider === "instagram" ? [] : ["image", "audio", "document"],
      lastInboundAt: null,
      windowExpiresAt: null,
      evaluatedAt: evaluatedAt.toISOString(),
      remainingMs: 0,
    };
  }

  if (provider === "instagram") {
    const standardWindowExpiresAtMs = lastInboundAtMs + INSTAGRAM_STANDARD_WINDOW_MS;
    const humanAgentWindowExpiresAtMs = lastInboundAtMs + INSTAGRAM_HUMAN_AGENT_WINDOW_MS;

    if (evaluatedAtMs < standardWindowExpiresAtMs) {
      return {
        provider,
        mode: "freeform",
        supportsAttachments: true,
        supportedAttachmentKinds: ["image", "audio"],
        lastInboundAt: new Date(lastInboundAtMs).toISOString(),
        windowExpiresAt: new Date(humanAgentWindowExpiresAtMs).toISOString(),
        evaluatedAt: evaluatedAt.toISOString(),
        remainingMs: standardWindowExpiresAtMs - evaluatedAtMs,
      };
    }

    if (evaluatedAtMs < humanAgentWindowExpiresAtMs) {
      return {
        provider,
        mode: "human_agent",
        supportsAttachments: true,
        supportedAttachmentKinds: ["image", "audio"],
        lastInboundAt: new Date(lastInboundAtMs).toISOString(),
        windowExpiresAt: new Date(humanAgentWindowExpiresAtMs).toISOString(),
        evaluatedAt: evaluatedAt.toISOString(),
        remainingMs: humanAgentWindowExpiresAtMs - evaluatedAtMs,
      };
    }

    return {
      provider,
      mode: "closed",
      supportsAttachments: false,
      supportedAttachmentKinds: [],
      lastInboundAt: new Date(lastInboundAtMs).toISOString(),
      windowExpiresAt: new Date(humanAgentWindowExpiresAtMs).toISOString(),
      evaluatedAt: evaluatedAt.toISOString(),
      remainingMs: 0,
    };
  }

  const windowExpiresAtMs = lastInboundAtMs + GUPSHUP_CONVERSATION_WINDOW_MS;
  const remainingMs = Math.max(0, windowExpiresAtMs - evaluatedAtMs);

  return {
    provider,
    mode: remainingMs > 0 ? "freeform" : "template_required",
    supportsAttachments: true,
    supportedAttachmentKinds: ["image", "audio", "document"],
    lastInboundAt: new Date(lastInboundAtMs).toISOString(),
    windowExpiresAt: new Date(windowExpiresAtMs).toISOString(),
    evaluatedAt: evaluatedAt.toISOString(),
    remainingMs,
  };
}
