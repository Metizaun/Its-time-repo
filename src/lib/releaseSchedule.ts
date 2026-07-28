export const CURRENT_RELEASE_VERSION = "v2.4.0";

// Publicado no horário de Brasília a partir de 28/07/2026 à meia-noite.
export const CURRENT_RELEASE_PUBLISH_AT = Date.parse(
  "2026-07-28T00:00:00-03:00",
);

export function isCurrentReleasePublished(now = Date.now()): boolean {
  return now >= CURRENT_RELEASE_PUBLISH_AT;
}
