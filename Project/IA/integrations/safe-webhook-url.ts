import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeWebhookUrlError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "UnsafeWebhookUrlError";
  }
}

export type ResolvedWebhookTarget = {
  url: URL;
  addresses: Array<{ address: string; family: 4 | 6 }>;
};

export type WebhookDnsLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

function ipv4Number(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] as number) << 24) >>> 0)
    + ((parts[1] as number) << 16)
    + ((parts[2] as number) << 8)
    + (parts[3] as number);
}

function inIpv4Range(value: number, base: string, bits: number) {
  const baseValue = ipv4Number(base);
  if (baseValue === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

export function isPublicIpAddress(rawAddress: string) {
  const address = rawAddress.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (address.startsWith("::ffff:")) return isPublicIpAddress(address.slice(7));
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    if (value === null) return false;
    const blocked: Array<[string, number]> = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
      ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
      ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
      ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4],
    ];
    return !blocked.some(([base, bits]) => inIpv4Range(value, base, bits));
  }
  if (family === 6) {
    if (address === "::" || address === "::1") return false;
    if (/^(?:fc|fd)/.test(address)) return false;
    if (/^fe[89ab]/.test(address)) return false;
    if (address.startsWith("ff")) return false;
    if (address.startsWith("2001:db8:")) return false;
    return true;
  }
  return false;
}

async function defaultLookup(hostname: string) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

export async function resolvePublicWebhookTarget(
  rawUrl: string,
  options: { lookup?: WebhookDnsLookup } = {},
): Promise<ResolvedWebhookTarget> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookUrlError("URL de destino invalida", "invalid_url");
  }
  if (url.protocol !== "https:") {
    throw new UnsafeWebhookUrlError("URL de destino deve usar HTTPS", "https_required");
  }
  if (url.username || url.password) {
    throw new UnsafeWebhookUrlError("URL de destino nao pode conter credenciais", "credentials_forbidden");
  }
  if (url.hash) {
    throw new UnsafeWebhookUrlError("URL de destino nao pode conter fragmento", "fragment_forbidden");
  }
  if (!url.hostname || url.hostname.length > 253 || rawUrl.length > 2_048) {
    throw new UnsafeWebhookUrlError("Host de destino invalido", "invalid_host");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new UnsafeWebhookUrlError("Host de destino nao e publico", "private_host");
  }

  const literalFamily = isIP(hostname);
  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await (options.lookup ?? defaultLookup)(hostname);
  } catch (error) {
    if (error instanceof UnsafeWebhookUrlError) throw error;
    throw new UnsafeWebhookUrlError("Host de destino nao pode ser resolvido", "dns_failed");
  }
  if (resolved.length === 0) {
    throw new UnsafeWebhookUrlError("Host de destino nao resolveu enderecos", "dns_empty");
  }
  const addresses = resolved.map(({ address, family }) => {
    if ((family !== 4 && family !== 6) || !isPublicIpAddress(address)) {
      throw new UnsafeWebhookUrlError("Host de destino resolveu endereco nao publico", "private_address");
    }
    return { address, family } as { address: string; family: 4 | 6 };
  });
  url.hostname = hostname;
  return { url, addresses };
}
