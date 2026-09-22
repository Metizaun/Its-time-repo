const STORAGE_API_PREFIX = "/storage/v1";

function configuredPublicStorageBaseUrl() {
  const value = process.env.SUPABASE_PUBLIC_URL?.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Supabase's server-side client may build URLs from the internal Docker URL.
 * Only rewrite Storage URLs that are returned to an external HTTP client.
 */
export function toPublicStorageUrl(value: string | null | undefined) {
  if (!value) return null;

  const publicBaseUrl = configuredPublicStorageBaseUrl();
  if (!publicBaseUrl) return value;

  let parsed: URL;
  try {
    parsed = new URL(value, publicBaseUrl);
  } catch {
    return value;
  }

  const storagePath = parsed.pathname.startsWith(`${STORAGE_API_PREFIX}/`)
    ? parsed.pathname
    : parsed.pathname.startsWith("/object/")
      ? `${STORAGE_API_PREFIX}${parsed.pathname}`
      : null;
  if (!storagePath) return value;

  return `${publicBaseUrl}${storagePath}${parsed.search}${parsed.hash}`;
}
