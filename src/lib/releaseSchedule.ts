export const CURRENT_RELEASE_VERSION = "v2.6.0";

// Publicado no horário de Brasília a partir de 02/09/2026 à meia-noite.
export const CURRENT_RELEASE_PUBLISH_AT = Date.parse(
  "2026-09-02T00:00:00-03:00",
);

export function isCurrentReleasePublished(now = Date.now()): boolean {
  return now >= CURRENT_RELEASE_PUBLISH_AT;
}
