import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

type Action = "start" | "status" | "counter";

type BuscarLeadsStartPayload = {
  searchStrings: string[];
  locationQuery: string;
  country: string;
  radiusKm: number;
  minimumStars: number;
  maxResults: number;
  language: string;
  fields: string[];
  instancia: string;
};

type PlaceResult = {
  externalId?: string;
  name: string;
  phone: string | null;
  email: string | null;
  website?: string | null;
  rating?: number | null;
  reviewsCount?: number | null;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  isImported?: boolean;
};

type BuscarLeadsInvokeBody =
  | { action: "counter" }
  | { action: "start"; payload: BuscarLeadsStartPayload }
  | { action: "status"; runId: string; payload: BuscarLeadsStartPayload };

const APIFY_ACTOR_ID = Deno.env.get("APIFY_ACTOR_ID") ?? "nwua9Gu5YrADL7ZDj";
const APIFY_BASE_URL = "https://api.apify.com/v2";

function buildCorsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "600",
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}, origin: string | null = "*") {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...buildCorsHeaders(origin),
      ...(init.headers ?? {}),
    },
  });
}

function normalizeSearchStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function normalizePhone(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.replace(/[^\d+]/g, "") || null;
}

function mapApifyStatus(status?: string): { status: "queued" | "running" | "succeeded" | "failed"; progress: number } {
  switch ((status ?? "").toUpperCase()) {
    case "READY":
      return { status: "queued", progress: 5 };
    case "RUNNING":
      return { status: "running", progress: 55 };
    case "SUCCEEDED":
      return { status: "succeeded", progress: 100 };
    case "FAILED":
    case "ABORTED":
    case "TIMED-OUT":
      return { status: "failed", progress: 100 };
    default:
      return { status: "running", progress: 15 };
  }
}

async function geocodeLocation(locationQuery: string, country: string) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${locationQuery}, ${country}`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "crm-its-time-buscar/1.0",
    },
  });

  if (!response.ok) return null;
  const data = await response.json();
  if (!Array.isArray(data) || !data[0]) return null;

  const item = data[0];
  return {
    lat: Number(item.lat),
    lng: Number(item.lon),
    label: item.display_name ?? locationQuery,
  };
}

async function getAuthenticatedContext(req: Request, origin: string | null) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { error: jsonResponse({ error: "Authorization header ausente" }, { status: 401 }, origin) };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "crm" },
  });

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "crm" },
  });

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return { error: jsonResponse({ error: "Usuário não autenticado" }, { status: 401 }, origin) };
  }

  const { data: crmUser, error: crmError } = await adminClient
    .schema("crm")
    .from("users")
    .select("id, aces_id, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (crmError || !crmUser?.aces_id) {
    return { error: jsonResponse({ error: "Usuário CRM não encontrado" }, { status: 403 }, origin) };
  }

  if (crmUser.role === "NENHUM") {
    return { error: jsonResponse({ error: "Usuário sem permissão para usar BUSCAR" }, { status: 403 }, origin) };
  }

  return { user, crmUser, userClient, adminClient };
}

async function startRun(payload: BuscarLeadsStartPayload, origin: string | null) {
  const token = Deno.env.get("APIFY_API_TOKEN");
  if (!token) {
    return jsonResponse({ error: "APIFY_API_TOKEN não configurado" }, { status: 500 }, origin);
  }

  const normalizedSearches = payload.searchStrings
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((term) => `${term} ${payload.locationQuery}`.trim());

  const apifyInput = {
    searchStringsArray: normalizedSearches.length ? normalizedSearches : payload.searchStrings,
    maxCrawledPlaces: payload.maxResults,
    proxyConfig: {
      useApifyProxy: true,
    },
  };

  const url = `${APIFY_BASE_URL}/acts/${APIFY_ACTOR_ID}/runs?token=${token}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(apifyInput),
  });

  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    const upstreamMessage =
      raw?.error?.message ??
      raw?.message ??
      `HTTP ${response.status}`;
    return jsonResponse(
      { error: `Erro ao iniciar busca na Apify: ${upstreamMessage}`, details: raw },
      { status: 502 },
      origin
    );
  }

  const run = raw?.data ?? raw;
  const center = await geocodeLocation(payload.locationQuery, payload.country);

  return jsonResponse(
    {
      runId: run?.id,
      status: "queued",
      progress: 5,
      center,
    },
    { status: 200 },
    origin
  );
}

async function fetchApifyRun(runId: string) {
  const token = Deno.env.get("APIFY_API_TOKEN");
  const response = await fetch(`${APIFY_BASE_URL}/actor-runs/${runId}?token=${token}`);
  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(raw?.error?.message ?? "Falha ao consultar execução na Apify");
  }
  return raw?.data ?? raw;
}

async function fetchDatasetItems(datasetId: string) {
  const token = Deno.env.get("APIFY_API_TOKEN");
  const response = await fetch(`${APIFY_BASE_URL}/datasets/${datasetId}/items?clean=true&token=${token}`);
  const raw = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error("Falha ao consultar dataset da Apify");
  }
  return Array.isArray(raw) ? raw : [];
}

function mapPlace(item: any, fallbackCountry: string): PlaceResult {
  const latitude = item?.location?.lat ?? item?.latitude ?? item?.gpsCoordinates?.latitude ?? null;
  const longitude = item?.location?.lng ?? item?.longitude ?? item?.gpsCoordinates?.longitude ?? null;
  const city = item?.city ?? item?.addressParsed?.city ?? null;
  const region = item?.state ?? item?.addressParsed?.state ?? null;
  const country = item?.countryCode ?? item?.country ?? fallbackCountry;

  return {
    externalId: item?.placeId ?? item?.id ?? undefined,
    name: String(item?.title ?? item?.name ?? "Sem nome"),
    phone: normalizePhone(item?.phone ?? item?.phoneUnformatted ?? item?.phoneNumber),
    email: item?.email ?? null,
    website: item?.website ?? item?.url ?? null,
    rating: item?.totalScore ?? item?.rating ?? null,
    reviewsCount: item?.reviewsCount ?? item?.reviews ?? null,
    address: item?.address ?? item?.street ?? null,
    city,
    region,
    country,
    lat: latitude === null ? null : Number(latitude),
    lng: longitude === null ? null : Number(longitude),
  };
}

async function importLeads(params: {
  adminClient: ReturnType<typeof createClient>;
  crmUser: { aces_id: number };
  payload: BuscarLeadsStartPayload;
  places: PlaceResult[];
}) {
  const { adminClient, crmUser, payload, places } = params;
  const importable = places.filter((place) => place.phone);

  const rows = importable.map((place) => ({
    name: place.name,
    contact_phone: place.phone,
    email: place.email ?? null,
    last_city: place.city ?? null,
    last_region: place.region ?? null,
    last_country: payload.country,
    status: "Novo",
    Fonte: "Apify",
    Plataform: "Google Maps",
    instancia: payload.instancia,
    aces_id: crmUser.aces_id,
    view: true,
  }));

  if (rows.length === 0) {
    return { insertedRows: [] as Array<{ id: string; contact_phone: string }>, duplicates: 0, withPhone: 0 };
  }

  const { data, error } = await adminClient
    .schema("crm")
    .from("leads")
    .upsert(rows, {
      onConflict: "contact_phone,aces_id",
      ignoreDuplicates: true,
    })
    .select("id, contact_phone");

  if (error) {
    throw new Error(error.message);
  }

  const insertedRows = (data ?? []) as Array<{ id: string; contact_phone: string }>;
  return {
    insertedRows,
    duplicates: Math.max(0, rows.length - insertedRows.length),
    withPhone: rows.length,
  };
}

async function handleCounter(adminClient: ReturnType<typeof createClient>, acesId: number, origin: string | null) {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const { count, error } = await adminClient
    .schema("crm")
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("Fonte", "Apify")
    .eq("aces_id", acesId)
    .gte("created_at", startOfMonth.toISOString());

  if (error) {
    return jsonResponse({ error: error.message }, { status: 500 }, origin);
  }

  return jsonResponse({ total: count ?? 0 }, { status: 200 }, origin);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
  }

  const context = await getAuthenticatedContext(req, origin);
  if ("error" in context) {
    return context.error;
  }

  const { crmUser, adminClient } = context;
  const url = new URL(req.url);
  let action = (url.searchParams.get("action") ?? "") as Action;
  let bodyPayload: BuscarLeadsInvokeBody | null = null;

  if (req.method === "POST") {
    bodyPayload = await req.json().catch(() => null);
    if (bodyPayload?.action) {
      action = bodyPayload.action;
    }
  }

  try {
    if ((req.method === "GET" || req.method === "POST") && action === "counter") {
      return await handleCounter(adminClient, crmUser.aces_id, origin);
    }

    if (req.method === "POST" && action === "start") {
      const payload = bodyPayload && "payload" in bodyPayload ? bodyPayload.payload : null;
      if (!payload) {
        return jsonResponse({ error: "Payload de busca ausente" }, { status: 400 }, origin);
      }

      const normalizedPayload: BuscarLeadsStartPayload = {
        ...payload,
        searchStrings: normalizeSearchStrings(payload.searchStrings),
      };

      if (!normalizedPayload.searchStrings.length) {
        return jsonResponse({ error: "Informe ao menos um termo de busca" }, { status: 400 }, origin);
      }

      if (!normalizedPayload.locationQuery?.trim()) {
        return jsonResponse({ error: "Informe cidade ou região" }, { status: 400 }, origin);
      }

      if (!normalizedPayload.instancia?.trim()) {
        return jsonResponse({ error: "Selecione uma instância" }, { status: 400 }, origin);
      }

      return await startRun(normalizedPayload, origin);
    }

    if ((req.method === "GET" || req.method === "POST") && action === "status") {
      const runId =
        bodyPayload && "runId" in bodyPayload ? bodyPayload.runId : url.searchParams.get("runId");
      const rawPayload =
        bodyPayload && "payload" in bodyPayload ? null : url.searchParams.get("payload");

      if (!runId || (!rawPayload && !(bodyPayload && "payload" in bodyPayload))) {
        return jsonResponse({ error: "runId e payload são obrigatórios" }, { status: 400 }, origin);
      }

      const payload =
        bodyPayload && "payload" in bodyPayload
          ? bodyPayload.payload
          : (JSON.parse(rawPayload as string) as BuscarLeadsStartPayload);
      const run = await fetchApifyRun(runId);
      const mappedStatus = mapApifyStatus(run?.status);
      const center = await geocodeLocation(payload.locationQuery, payload.country);

      if (mappedStatus.status !== "succeeded") {
        return jsonResponse(
          {
            runId,
            status: mappedStatus.status,
            progress: mappedStatus.progress,
            message: run?.statusMessage ?? null,
            center,
          },
          { status: 200 },
          origin
        );
      }

      const datasetId = run?.defaultDatasetId;
      const items = datasetId ? await fetchDatasetItems(datasetId) : [];
      const places = items.map((item) => mapPlace(item, payload.country));
      const { insertedRows, duplicates, withPhone } = await importLeads({
        adminClient,
        crmUser,
        payload,
        places,
      });

      const insertedPhoneSet = new Set(insertedRows.map((row) => normalizePhone(row.contact_phone)).filter(Boolean));
      const results = places.map((place) => ({
        ...place,
        isImported: !!place.phone && insertedPhoneSet.has(place.phone),
      }));

      return jsonResponse(
        {
          runId,
          status: "succeeded",
          progress: 100,
          center,
          results,
          totals: {
            fetched: places.length,
            withPhone,
            inserted: insertedRows.length,
            duplicates,
          },
        },
        { status: 200 },
        origin
      );
    }

    return jsonResponse({ error: "Ação inválida" }, { status: 404 }, origin);
  } catch (error) {
    console.error("[buscar-leads]", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro interno" },
      { status: 500 },
      origin
    );
  }
});
