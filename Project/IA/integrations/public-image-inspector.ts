import axios, { type AxiosRequestConfig } from "axios";
import { createHash } from "node:crypto";
import { Agent } from "node:https";

import {
  resolvePublicWebhookTarget,
  type WebhookDnsLookup,
  UnsafeWebhookUrlError,
} from "./safe-webhook-url.js";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type InspectionResponse = {
  status: number;
  headers: Record<string, unknown>;
  data: ArrayBuffer | Uint8Array;
};

type InspectionRequest = (
  url: string,
  config: AxiosRequestConfig,
) => Promise<InspectionResponse>;

export type PublicImageSnapshot = {
  originalUrl: string;
  finalUrl: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  sha256: string;
  fileName: string;
  caption: string | null;
  validatedAt: string;
};

export class PublicImageInspectionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly kind: "transient" | "permanent",
    readonly statusCode: number | null = null,
  ) {
    super(message);
    this.name = "PublicImageInspectionError";
  }
}

function normalizedMime(value: unknown) {
  return typeof value === "string"
    ? (value.split(";")[0]?.trim().toLowerCase() ?? "")
    : "";
}

function sniffImageMime(buffer: Buffer): PublicImageSnapshot["mimeType"] | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function fileNameFor(url: URL, mimeType: PublicImageSnapshot["mimeType"]) {
  let decodedCandidate = "";
  try {
    decodedCandidate = decodeURIComponent(url.pathname.split("/").pop() ?? "");
  } catch {
    // A malformed optional filename must not invalidate an otherwise safe image URL.
  }
  const candidate = decodedCandidate.replace(/[^\w.-]+/g, "-");
  if (candidate && candidate.length <= 180) return candidate;
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  return `webhook-image.${extension}`;
}

const defaultRequest: InspectionRequest = async (url, config) => {
  const response = await axios.get<ArrayBuffer>(url, config);
  return {
    status: response.status,
    headers: response.headers as Record<string, unknown>,
    data: response.data,
  };
};

export async function inspectPublicImage(
  input: { url: string; caption?: string | null },
  dependencies: {
    request?: InspectionRequest;
    lookup?: WebhookDnsLookup;
    now?: () => Date;
  } = {},
): Promise<PublicImageSnapshot> {
  const request = dependencies.request ?? defaultRequest;
  const originalUrl = input.url.trim();
  let currentUrl = originalUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let target;
    try {
      target = await resolvePublicWebhookTarget(currentUrl, { lookup: dependencies.lookup });
    } catch (error) {
      if (error instanceof UnsafeWebhookUrlError) {
        throw new PublicImageInspectionError(error.message, error.code, "permanent");
      }
      throw error;
    }

    const pinnedAddress = target.addresses[0];
    const httpsAgent = new Agent({
      lookup: (_hostname, _options, callback) => {
        callback(null, pinnedAddress.address, pinnedAddress.family);
      },
    });

    let response: InspectionResponse;
    try {
      response = await request(target.url.toString(), {
        responseType: "arraybuffer",
        timeout: TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: MAX_BYTES,
        maxBodyLength: MAX_BYTES,
        validateStatus: () => true,
        httpsAgent,
      });
    } catch (error) {
      const code = axios.isAxiosError(error) ? String(error.code ?? "") : "";
      const message = error instanceof Error ? error.message : "";
      if (/maxcontentlength|maxbodylength|larger than/i.test(message)) {
        throw new PublicImageInspectionError("Imagem excede 5 MB", "too_large", "permanent");
      }
      const timeout = code === "ECONNABORTED" || code === "ETIMEDOUT" || /timeout/i.test(message);
      throw new PublicImageInspectionError(
        timeout ? "Timeout ao validar imagem" : "Imagem temporariamente indisponivel",
        timeout ? "timeout" : "network",
        "transient",
      );
    } finally {
      httpsAgent.destroy();
    }

    if (response.status >= 300 && response.status < 400) {
      const location = typeof response.headers.location === "string" ? response.headers.location.trim() : "";
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new PublicImageInspectionError("Redirecionamento de imagem invalido", "redirect_invalid", "permanent", response.status);
      }
      currentUrl = new URL(location, target.url).toString();
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      const kind = response.status >= 500 ? "transient" : "permanent";
      throw new PublicImageInspectionError(`Download da imagem retornou HTTP ${response.status}`, "http_error", kind, response.status);
    }

    const buffer = response.data instanceof ArrayBuffer
      ? Buffer.from(response.data)
      : Buffer.from(response.data.buffer, response.data.byteOffset, response.data.byteLength);
    if (buffer.length === 0 || buffer.length > MAX_BYTES) {
      throw new PublicImageInspectionError(
        buffer.length > MAX_BYTES ? "Imagem excede 5 MB" : "Imagem vazia",
        buffer.length > MAX_BYTES ? "too_large" : "empty",
        "permanent",
      );
    }
    const headerMime = normalizedMime(response.headers["content-type"]);
    const actualMime = sniffImageMime(buffer);
    if (!actualMime || !ALLOWED_MIME_TYPES.has(headerMime) || headerMime !== actualMime) {
      throw new PublicImageInspectionError("MIME real da imagem nao permitido", "invalid_mime", "permanent");
    }

    return {
      originalUrl,
      finalUrl: target.url.toString(),
      mimeType: actualMime,
      sizeBytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      fileName: fileNameFor(target.url, actualMime),
      caption: input.caption?.trim().slice(0, 4_000) || null,
      validatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    };
  }

  throw new PublicImageInspectionError("Redirecionamento de imagem invalido", "redirect_invalid", "permanent");
}

export async function revalidatePublicImage(
  snapshot: PublicImageSnapshot,
  dependencies: Parameters<typeof inspectPublicImage>[1] = {},
) {
  const current = await inspectPublicImage(
    { url: snapshot.originalUrl, caption: snapshot.caption },
    dependencies,
  );
  if (current.sha256 !== snapshot.sha256) {
    throw new PublicImageInspectionError("O conteudo da imagem foi alterado", "hash_changed", "permanent");
  }
  return current;
}
