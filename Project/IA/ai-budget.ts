import type { SupabaseClient } from "@supabase/supabase-js";

export type AiBudgetDecision = {
  allowed: boolean;
  status: string;
  consumed_brl: number;
  budget_brl: number | null;
  pct: number;
};

const CACHE_TTL_MS = 45_000;
const cache = new Map<number, { expiresAt: number; decision: AiBudgetDecision }>();

export class AiBudgetBlockedError extends Error {
  readonly code = "AI_BUDGET_EXCEEDED";
  readonly decision: AiBudgetDecision;

  constructor(decision: AiBudgetDecision) {
    super("Teto de consumo de IA atingido para esta conta");
    this.name = "AiBudgetBlockedError";
    this.decision = decision;
  }
}

function normalizeDecision(value: unknown): AiBudgetDecision {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    allowed: row.allowed !== false,
    status: typeof row.status === "string" ? row.status : "unknown",
    consumed_brl: Number(row.consumed_brl ?? 0),
    budget_brl: row.budget_brl === null || row.budget_brl === undefined
      ? null
      : Number(row.budget_brl),
    pct: Number(row.pct ?? 0),
  };
}

export async function checkAiBudget(
  crmClient: SupabaseClient<any, any, any>,
  acesId: number,
): Promise<AiBudgetDecision> {
  const cached = cache.get(acesId);
  if (cached && cached.expiresAt > Date.now()) return cached.decision;

  try {
    const { data, error } = await crmClient.rpc("service_check_ai_budget", {
      p_aces_id: acesId,
    });
    if (error) throw error;
    const decision = normalizeDecision(data);
    cache.set(acesId, { decision, expiresAt: Date.now() + CACHE_TTL_MS });
    return decision;
  } catch (error) {
    console.warn("[ai-budget] Consulta indisponivel; liberando em fail-open:", {
      acesId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { allowed: true, status: "fail_open", consumed_brl: 0, budget_brl: null, pct: 0 };
  }
}

export async function requireAiBudget(
  crmClient: SupabaseClient<any, any, any>,
  acesId: number,
) {
  const decision = await checkAiBudget(crmClient, acesId);
  if (!decision.allowed) throw new AiBudgetBlockedError(decision);
  return decision;
}

export function invalidateAiBudgetCache(acesId: number) {
  cache.delete(acesId);
}

export function isAiBudgetBlockedError(error: unknown): error is AiBudgetBlockedError {
  return error instanceof AiBudgetBlockedError;
}

export const aiBudgetInternals = { CACHE_TTL_MS, cache, normalizeDecision };
