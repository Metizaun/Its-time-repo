import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const PREVIEW_TIMEOUT_MS = 7000;
const MAX_HTML_CHARS = 1_000_000;

type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "missing_authorization_header" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse(500, { error: "supabase_env_missing" });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse(401, { error: "not_authenticated" });
    }

    const body = await req.json().catch(() => ({}));
    const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
    if (!rawUrl) {
      return jsonResponse(400, { error: "url_required" });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      return jsonResponse(400, { error: "invalid_url" });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return jsonResponse(400, { error: "unsupported_protocol" });
    }

    const preview = await fetchLinkPreview(parsedUrl.toString());
    return jsonResponse(200, preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : "internal_error";
    return jsonResponse(500, { error: message });
  }
});

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchLinkPreview(targetUrl: string): Promise<LinkPreview> {
  let response: Response | null = null;

  try {
    response = await fetch(targetUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
      headers: {
        "User-Agent": "eMetizaun-inbox-preview/1.0",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
  } catch {
    const fallbackHost = safeHostname(targetUrl);
    return {
      url: targetUrl,
      title: fallbackHost,
      description: null,
      image: null,
      site_name: fallbackHost,
    };
  }

  const finalUrl = response.url || targetUrl;
  const fallbackHost = safeHostname(finalUrl);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();

  if (!response.ok || !contentType.includes("text/html")) {
    return {
      url: finalUrl,
      title: fallbackHost,
      description: null,
      image: null,
      site_name: fallbackHost,
    };
  }

  const html = (await response.text()).slice(0, MAX_HTML_CHARS);
  const attributes = parseMetaAttributes(html);

  const title =
    sanitizeText(attributes.get("property:og:title")) ||
    sanitizeText(attributes.get("name:twitter:title")) ||
    sanitizeText(extractTagContent(html, "title")) ||
    fallbackHost;

  const description =
    sanitizeText(attributes.get("property:og:description")) ||
    sanitizeText(attributes.get("name:description")) ||
    sanitizeText(attributes.get("name:twitter:description")) ||
    null;

  const image =
    sanitizeUrl(attributes.get("property:og:image"), finalUrl) ||
    sanitizeUrl(attributes.get("name:twitter:image"), finalUrl) ||
    null;

  const siteName =
    sanitizeText(attributes.get("property:og:site_name")) ||
    fallbackHost;

  return {
    url: finalUrl,
    title,
    description,
    image,
    site_name: siteName,
  };
}

function parseMetaAttributes(html: string) {
  const map = new Map<string, string>();
  const metaTags = html.match(/<meta\s+[^>]*>/gi) || [];

  for (const tag of metaTags) {
    const attributes = parseTagAttributes(tag);
    const content = attributes.get("content");
    if (!content) continue;

    const property = attributes.get("property");
    const name = attributes.get("name");

    if (property) {
      map.set(`property:${property.toLowerCase()}`, content);
    }

    if (name) {
      map.set(`name:${name.toLowerCase()}`, content);
    }
  }

  return map;
}

function parseTagAttributes(tag: string) {
  const attributes = new Map<string, string>();
  const regex = /([a-zA-Z:-]+)\s*=\s*(["'])(.*?)\2/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(tag)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[3];
    attributes.set(key, value);
  }

  return attributes;
}

function extractTagContent(html: string, tag: string) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = html.match(regex);
  return match?.[1] ?? null;
}

function sanitizeText(value: string | null | undefined) {
  if (!value) return null;

  const decoded = decodeHtmlEntities(value)
    .replace(/\s+/g, " ")
    .trim();

  if (!decoded) return null;
  return decoded.slice(0, 400);
}

function sanitizeUrl(value: string | null | undefined, baseUrl: string) {
  if (!value) return null;

  try {
    const parsed = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeHostname(rawUrl: string) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

