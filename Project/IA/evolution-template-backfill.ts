export type EvolutionTemplateBackfillCandidate<TPayload = unknown> = {
  messageId: string;
  payload: TPayload;
};

export type EvolutionTemplateBackfillResult = {
  messageId: string;
  status: "repaired" | "failed";
  detail?: unknown;
};

export async function executeEvolutionTemplateBackfill<TPayload>(params: {
  apply: boolean;
  candidates: Array<EvolutionTemplateBackfillCandidate<TPayload>>;
  repairCandidate: (candidate: EvolutionTemplateBackfillCandidate<TPayload>) => Promise<unknown>;
}): Promise<EvolutionTemplateBackfillResult[]> {
  if (!params.apply) return [];

  const results: EvolutionTemplateBackfillResult[] = [];
  for (const candidate of params.candidates) {
    try {
      const detail = await params.repairCandidate(candidate);
      results.push({ messageId: candidate.messageId, status: "repaired", detail });
    } catch (error) {
      results.push({
        messageId: candidate.messageId,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
