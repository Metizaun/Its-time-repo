import crypto from "node:crypto";

import type Redis from "ioredis";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OutboundEchoOrigin = "manual" | "ai" | "automation";

type RegisterOutboundEchoParams = {
  client: SupabaseClient;
  redis?: Redis | null;
  acesId: number;
  leadId?: string | null;
  origin: OutboundEchoOrigin;
  referenceId?: string | null;
  conversationId?: string | null;
  instanceName: string;
  phone: string;
  content: string;
  sentAt?: string;
  expiresInSeconds?: number;
};

export type OutboundEchoMatch = {
  id: number;
  origin: OutboundEchoOrigin;
  leadId: string | null;
  referenceId: string | null;
  conversationId: string | null;
};

type MatchOutboundEchoParams = {
  client: SupabaseClient;
  redis?: Redis | null;
  instanceName: string;
  phone: string;
  content: string;
};

function normalizeInstanceName(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeEchoPhone(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  if (clean.startsWith("55") && clean.length > 11) {
    return clean.slice(2);
  }

  return clean;
}

export function normalizeEchoContent(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

export function buildOutboundEchoFingerprint(instanceName: string, phone: string, content: string): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        normalizeInstanceName(instanceName),
        normalizeEchoPhone(phone),
        normalizeEchoContent(content),
      ].join("|"),
    )
    .digest("hex");
}

function buildCacheKey(instanceName: string, phone: string, content: string) {
  return `crm-ai:outbound:${buildOutboundEchoFingerprint(instanceName, phone, content)}`;
}

export async function registerOutboundEcho({
  client,
  redis,
  acesId,
  leadId = null,
  origin,
  referenceId = null,
  conversationId = null,
  instanceName,
  phone,
  content,
  sentAt,
  expiresInSeconds = 600,
}: RegisterOutboundEchoParams): Promise<OutboundEchoMatch> {
  const normalizedContent = normalizeEchoContent(content);
  const normalizedPhone = normalizeEchoPhone(phone);
  const fingerprint = buildOutboundEchoFingerprint(instanceName, normalizedPhone, normalizedContent);
  const effectiveSentAt = sentAt ?? new Date().toISOString();
  const expiresAt = new Date(Date.parse(effectiveSentAt) + expiresInSeconds * 1000).toISOString();

  const payload = {
    aces_id: acesId,
    lead_id: leadId,
    origin,
    reference_id: referenceId,
    conversation_id: conversationId,
    instance_name: instanceName.trim(),
    phone: normalizedPhone,
    content: normalizedContent,
    fingerprint,
    sent_at: effectiveSentAt,
    expires_at: expiresAt,
  };

  const { data, error } = await client
    .from("outbound_echo_registry")
    .insert(payload)
    .select("id, origin, lead_id, reference_id, conversation_id")
    .single();

  if (error) {
    throw error;
  }

  const match: OutboundEchoMatch = {
    id: Number(data.id),
    origin: data.origin as OutboundEchoOrigin,
    leadId: (data.lead_id as string | null) ?? null,
    referenceId: (data.reference_id as string | null) ?? null,
    conversationId: (data.conversation_id as string | null) ?? null,
  };

  if (redis) {
    await redis.set(
      buildCacheKey(instanceName, normalizedPhone, normalizedContent),
      JSON.stringify(match),
      "EX",
      Math.max(expiresInSeconds, 60),
    );
  }

  return match;
}

export async function matchOutboundEcho({
  client,
  redis,
  instanceName,
  phone,
  content,
}: MatchOutboundEchoParams): Promise<OutboundEchoMatch | null> {
  const normalizedContent = normalizeEchoContent(content);
  const normalizedPhone = normalizeEchoPhone(phone);
  const cacheKey = buildCacheKey(instanceName, normalizedPhone, normalizedContent);

  if (redis) {
    const cached = await redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as OutboundEchoMatch;
      } catch {
        await redis.del(cacheKey);
      }
    }
  }

  const fingerprint = buildOutboundEchoFingerprint(instanceName, normalizedPhone, normalizedContent);
  const { data, error } = await client
    .from("outbound_echo_registry")
    .select("id, origin, lead_id, reference_id, conversation_id")
    .eq("fingerprint", fingerprint)
    .gte("expires_at", new Date().toISOString())
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const match: OutboundEchoMatch = {
    id: Number(data.id),
    origin: data.origin as OutboundEchoOrigin,
    leadId: (data.lead_id as string | null) ?? null,
    referenceId: (data.reference_id as string | null) ?? null,
    conversationId: (data.conversation_id as string | null) ?? null,
  };

  if (redis) {
    await redis.set(cacheKey, JSON.stringify(match), "EX", 180);
  }

  return match;
}
