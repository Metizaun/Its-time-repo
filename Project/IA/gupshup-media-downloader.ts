import axios, { type AxiosRequestConfig } from "axios";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const GUPSHUP_FILE_MANAGER_HOST = "filemanager.gupshup.io";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const ERROR_BODY_LIMIT = 500;

export type GupshupMediaFailureKind =
  | "expired_url"
  | "invalid_media_id"
  | "authentication"
  | "timeout"
  | "network"
  | "unsafe_url"
  | "invalid_url"
  | "invalid_content"
  | "incompatible_mime"
  | "too_large"
  | "http_error";

export type ResolvedInboundMedia = {
  mimeType: string;
  buffer: Buffer;
};

type DownloadResponse = {
  status: number;
  headers: Record<string, unknown>;
  data: ArrayBuffer;
};

type DownloadRequest = (
  url: string,
  config: AxiosRequestConfig,
) => Promise<DownloadResponse>;

type HostLookup = (hostname: string) => Promise<Array<{ address: string }>>;

export type GupshupMediaDownloaderDependencies = {
  request?: DownloadRequest;
  lookupHost?: HostLookup;
  now?: () => number;
};

export type DownloadGupshupMediaInput = {
  mediaUrl: string;
  mediaUrlExpiresAt?: string | null;
  expectedMimeType: string;
  maxBytes: number;
  timeoutMs?: number;
};

export function allowsEvolutionMediaFallback(
  provider: "evolution" | "meta" | "gupshup",
) {
  return provider !== "gupshup";
}

export async function prefetchGupshupInboundMedia<T>(
  provider: "evolution" | "meta" | "gupshup",
  hasMedia: boolean,
  resolve: () => Promise<T | null>,
): Promise<T | null | undefined> {
  if (provider !== "gupshup" || !hasMedia) return undefined;
  return resolve();
}

export class GupshupMediaDownloadError extends Error {
  constructor(
    public readonly kind: GupshupMediaFailureKind,
    message: string,
    public readonly status: number | null = null,
    public readonly responseBody: string | null = null,
  ) {
    super(message);
    this.name = "GupshupMediaDownloadError";
  }
}

function isPrivateNetworkAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      return isPrivateNetworkAddress(normalized.slice(7));
    }
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }

  return true;
}

function normalizeMimeType(value: unknown) {
  return typeof value === "string"
    ? (value.split(";")[0]?.trim().toLowerCase() ?? "")
    : "";
}

function mediaKindFromMimeType(mimeType: string) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

function isProbablyTextPayload(buffer: Buffer) {
  if (buffer.length === 0) return true;
  const sample = buffer
    .subarray(0, Math.min(buffer.length, 256))
    .toString("utf8")
    .trimStart()
    .toLowerCase();
  return (
    sample.startsWith("{") ||
    sample.startsWith("[") ||
    sample.startsWith("<html") ||
    sample.startsWith("<!doctype") ||
    sample.startsWith("<?xml")
  );
}

function extractErrorBody(data: ArrayBuffer, contentType: string) {
  if (!contentType.includes("json") && !contentType.startsWith("text/"))
    return null;
  return (
    Buffer.from(data)
      .toString("utf8")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, ERROR_BODY_LIMIT) || null
  );
}

function classifyHttpError(status: number, responseBody: string | null) {
  const normalizedBody = responseBody?.toLowerCase() ?? "";
  if (status === 401 || status === 403) return "authentication" as const;
  if (status === 410 || normalizedBody.includes("expired"))
    return "expired_url" as const;
  if (
    status === 404 ||
    normalizedBody.includes("invalid media id") ||
    normalizedBody.includes("media id")
  ) {
    return "invalid_media_id" as const;
  }
  if (status === 400) return "invalid_url" as const;
  return "http_error" as const;
}

async function assertSafeGupshupUrl(value: string, lookupHost: HostLookup) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new GupshupMediaDownloadError(
      "unsafe_url",
      "URL de midia Gupshup invalida",
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hostname.toLowerCase() !== GUPSHUP_FILE_MANAGER_HOST
  ) {
    throw new GupshupMediaDownloadError(
      "unsafe_url",
      "Destino de midia Gupshup nao permitido",
    );
  }

  const addresses = await lookupHost(parsed.hostname);
  if (
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateNetworkAddress(entry.address))
  ) {
    throw new GupshupMediaDownloadError(
      "unsafe_url",
      "Destino de midia Gupshup nao permitido",
    );
  }

  return parsed;
}

const defaultRequest: DownloadRequest = async (url, config) => {
  const response = await axios.get<ArrayBuffer>(url, config);
  return {
    status: response.status,
    headers: response.headers as Record<string, unknown>,
    data: response.data,
  };
};

const defaultLookup: HostLookup = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export async function downloadGupshupMedia(
  input: DownloadGupshupMediaInput,
  dependencies: GupshupMediaDownloaderDependencies = {},
): Promise<ResolvedInboundMedia> {
  const request = dependencies.request ?? defaultRequest;
  const lookupHost = dependencies.lookupHost ?? defaultLookup;
  const now = dependencies.now ?? Date.now;
  const expiresAtMs = input.mediaUrlExpiresAt
    ? Date.parse(input.mediaUrlExpiresAt)
    : Number.NaN;

  if (Number.isFinite(expiresAtMs) && expiresAtMs <= now()) {
    throw new GupshupMediaDownloadError(
      "expired_url",
      "URL de midia Gupshup expirada",
    );
  }

  let currentUrl = input.mediaUrl;
  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const parsed = await assertSafeGupshupUrl(currentUrl, lookupHost);
    let response: DownloadResponse;

    try {
      response = await request(parsed.toString(), {
        responseType: "arraybuffer",
        timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: input.maxBytes,
        maxBodyLength: input.maxBytes,
        validateStatus: () => true,
      });
    } catch (error: unknown) {
      const record =
        typeof error === "object" && error !== null
          ? (error as Record<string, unknown>)
          : {};
      const code = typeof record.code === "string" ? record.code : "";
      const message =
        error instanceof Error
          ? error.message
          : "Falha de rede ao baixar midia Gupshup";
      if (
        code === "ECONNABORTED" ||
        code === "ETIMEDOUT" ||
        /timeout/i.test(message)
      ) {
        throw new GupshupMediaDownloadError(
          "timeout",
          "Timeout ao baixar midia Gupshup",
        );
      }
      if (/maxcontentlength|maxbodylength|larger than/i.test(message)) {
        throw new GupshupMediaDownloadError(
          "too_large",
          "Midia Gupshup excede o tamanho permitido",
        );
      }
      throw new GupshupMediaDownloadError(
        "network",
        "Falha de rede ao baixar midia Gupshup",
      );
    }

    const contentType = normalizeMimeType(response.headers["content-type"]);
    if (response.status >= 300 && response.status < 400) {
      const location =
        typeof response.headers.location === "string"
          ? response.headers.location.trim()
          : "";
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new GupshupMediaDownloadError(
          "unsafe_url",
          "Redirecionamento de midia Gupshup invalido",
        );
      }
      currentUrl = new URL(location, parsed).toString();
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      const responseBody = extractErrorBody(response.data, contentType);
      throw new GupshupMediaDownloadError(
        classifyHttpError(response.status, responseBody),
        `Download de midia Gupshup retornou HTTP ${response.status}`,
        response.status,
        responseBody,
      );
    }

    const buffer = Buffer.from(response.data);
    if (buffer.length === 0 || isProbablyTextPayload(buffer)) {
      throw new GupshupMediaDownloadError(
        "invalid_content",
        "Download Gupshup nao retornou midia binaria",
      );
    }
    if (buffer.length > input.maxBytes) {
      throw new GupshupMediaDownloadError(
        "too_large",
        "Midia Gupshup excede o tamanho permitido",
      );
    }

    const expectedMimeType = normalizeMimeType(input.expectedMimeType);
    const resolvedMimeType = contentType || expectedMimeType;
    if (
      !resolvedMimeType ||
      mediaKindFromMimeType(resolvedMimeType) !==
        mediaKindFromMimeType(expectedMimeType)
    ) {
      throw new GupshupMediaDownloadError(
        "incompatible_mime",
        "MIME da midia Gupshup incompativel",
      );
    }

    return { mimeType: resolvedMimeType, buffer };
  }

  throw new GupshupMediaDownloadError(
    "unsafe_url",
    "Redirecionamento de midia Gupshup invalido",
  );
}
