export const CURRENT_RELEASE_VERSION = "v2.5.0";

// 21/07/2026 00:00 no horario de Brasilia (America/Sao_Paulo).
export const CURRENT_RELEASE_PUBLISH_AT = Date.parse("2026-07-21T00:00:00-03:00");

export function isCurrentReleasePublished(now = Date.now()): boolean {
  return now >= CURRENT_RELEASE_PUBLISH_AT;
}
