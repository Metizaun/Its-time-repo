export const CURRENT_RELEASE_VERSION = "v2.5.0";

// Publicado no horário de Brasília a partir de 04/08/2026 à meia-noite.
export const CURRENT_RELEASE_PUBLISH_AT = Date.parse(
  "2026-08-04T00:00:00-03:00",
);

export function isCurrentReleasePublished(now = Date.now()): boolean {
  return now >= CURRENT_RELEASE_PUBLISH_AT;
}
