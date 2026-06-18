import { createClient } from "npm:@supabase/supabase-js@2.57.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export function sanitizeInstagramUsername(rawUsername: string) {
  const trimmed = rawUsername.trim();
  if (!trimmed) return "";

  const withoutUrl = trimmed
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^\//, "")
    .replace(/\/$/, "");

  return withoutUrl.replace(/^@/, "").split(/[/?#]/)[0].trim().toLowerCase();
}

export function toInt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toIsoTimestamp(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(epoch);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return null;
}

export function mapApifyStatus(rawStatus: string | null | undefined) {
  const status = (rawStatus || "").toUpperCase();

  if (status === "SUCCEEDED") return "succeeded";
  if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") return "failed";
  if (status === "RUNNING" || status === "READY") return "running";
  return "queued";
}

function normalizeApifyActorReference(rawValue: string) {
  const trimmed = rawValue.trim();
  if (!trimmed) return "";

  const withoutConsoleUrl = trimmed
    .replace(/^https?:\/\/console\.apify\.com\/actors\//i, "")
    .replace(/^https?:\/\/apify\.com\//i, "")
    .replace(/^actors\//i, "")
    .replace(/^acts\//i, "")
    .replace(/\/input$/i, "")
    .replace(/\/$/, "");

  // Apify API endpoint uses "~" as namespace separator in path (e.g. apify~instagram-scraper).
  return withoutConsoleUrl.replace(/\//g, "~");
}

export function getApifyToken() {
  const token = Deno.env.get("APIFY_TOKEN")?.trim();
  if (!token) {
    throw new HttpError(500, "APIFY_TOKEN is not configured");
  }
  return token;
}

export function getApifyActorReferences() {
  const explicitList = Deno.env.get("APIFY_ACTOR_REFS")?.trim();
  const explicitSingle =
    Deno.env.get("APIFY_ACTOR_ID")?.trim() ||
    Deno.env.get("APIFY_ACTOR_PATH")?.trim();

  const defaults = [
    "apify~instagram-scraper",
    "xMc5Ga1oCONPmWJIa",
  ];

  const sourceValues = explicitList
    ? explicitList.split(",")
    : explicitSingle
      ? [explicitSingle]
      : defaults;

  const normalized = sourceValues
    .map(normalizeApifyActorReference)
    .filter(Boolean);

  return [...new Set(normalized)];
}

export function sortScrapeItems<T extends { likes_count: number | null; views_count: number | null; posted_at: string | null }>(
  items: T[],
  sortBy: "most_liked" | "most_viewed" | "recent",
) {
  if (sortBy === "most_liked") {
    return [...items].sort((a, b) => (b.likes_count || 0) - (a.likes_count || 0));
  }

  if (sortBy === "most_viewed") {
    return [...items].sort((a, b) => (b.views_count || 0) - (a.views_count || 0));
  }

  return [...items].sort((a, b) => {
    const aTime = a.posted_at ? new Date(a.posted_at).getTime() : 0;
    const bTime = b.posted_at ? new Date(b.posted_at).getTime() : 0;
    return bTime - aTime;
  });
}

export async function callGeminiText(prompt: string, model = "gemini-2.5-flash") {
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) return null;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((part: { text?: string }) => typeof part?.text === "string")
    .map((part: { text: string }) => part.text)
    .join("\n")
    .trim();

  return text || null;
}

export async function getAuthContext(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    throw new HttpError(401, "Missing authorization header");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new HttpError(500, "Supabase environment is not configured");
  }

  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });

  const { data: userData, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !userData?.user) {
    throw new HttpError(401, "User not authenticated");
  }

  const { data: roleRows, error: rolesError } = await supabaseUser
    .from("user_roles")
    .select("organization_id")
    .eq("user_id", userData.user.id);

  if (rolesError) {
    throw new HttpError(500, rolesError.message || "Failed to load user organizations");
  }

  const organizationIds = [...new Set((roleRows || []).map((row) => row.organization_id))];
  if (!organizationIds.length) {
    throw new HttpError(403, "User has no organizations");
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

  return {
    userId: userData.user.id,
    organizationIds,
    defaultOrganizationId: organizationIds[0],
    supabaseUser,
    supabaseAdmin,
  };
}

export function ensureOrgAccess(organizationIds: string[], organizationId: string) {
  if (!organizationIds.includes(organizationId)) {
    throw new HttpError(403, "You do not have access to this organization");
  }
}
