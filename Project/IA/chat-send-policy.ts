import type { WhatsAppProviderName } from "./whatsapp-provider.js";

const GUPSHUP_CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ChatSendPolicy = {
  provider: WhatsAppProviderName;
  mode: "freeform" | "template_required";
  lastInboundAt: string | null;
  windowExpiresAt: string | null;
  evaluatedAt: string;
  remainingMs: number | null;
};

export function buildChatSendPolicy(
  provider: WhatsAppProviderName,
  lastInboundAt: string | null | undefined,
  evaluatedAt = new Date(),
): ChatSendPolicy {
  const evaluatedAtMs = evaluatedAt.getTime();
  const normalizedLastInboundAt = lastInboundAt?.trim() || null;

  if (provider !== "gupshup") {
    return {
      provider,
      mode: "freeform",
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
      mode: "template_required",
      lastInboundAt: null,
      windowExpiresAt: null,
      evaluatedAt: evaluatedAt.toISOString(),
      remainingMs: 0,
    };
  }

  const windowExpiresAtMs = lastInboundAtMs + GUPSHUP_CONVERSATION_WINDOW_MS;
  const remainingMs = Math.max(0, windowExpiresAtMs - evaluatedAtMs);

  return {
    provider,
    mode: remainingMs > 0 ? "freeform" : "template_required",
    lastInboundAt: new Date(lastInboundAtMs).toISOString(),
    windowExpiresAt: new Date(windowExpiresAtMs).toISOString(),
    evaluatedAt: evaluatedAt.toISOString(),
    remainingMs,
  };
}
