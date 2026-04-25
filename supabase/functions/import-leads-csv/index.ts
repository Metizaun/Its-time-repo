import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

type ImportLeadCsvRow = {
  nome?: unknown;
  telefone?: unknown;
  email?: unknown;
  cidade?: unknown;
  observacoes?: unknown;
};

type ImportLeadCsvOptions = {
  stageId?: unknown;
  source?: unknown;
  ownerId?: unknown;
  instanceName?: unknown;
};

type ImportLeadCsvBody = {
  rows?: unknown;
  importOptions?: ImportLeadCsvOptions;
};

function buildCorsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePhone(value: unknown) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const normalized = raw.replace(/[^\d+]/g, "");
  return normalized.length > 0 ? normalized : null;
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
    return { error: jsonResponse({ error: "Usuario nao autenticado" }, { status: 401 }, origin) };
  }

  const { data: crmUser, error: crmError } = await adminClient
    .schema("crm")
    .from("users")
    .select("id, aces_id, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (crmError || !crmUser?.aces_id) {
    return { error: jsonResponse({ error: "Usuario CRM nao encontrado" }, { status: 403 }, origin) };
  }

  if (crmUser.role === "NENHUM") {
    return { error: jsonResponse({ error: "Usuario sem permissao para importar leads" }, { status: 403 }, origin) };
  }

  return { user, crmUser, userClient, adminClient };
}

function validatePayload(body: ImportLeadCsvBody) {
  const rows = Array.isArray(body.rows) ? (body.rows as ImportLeadCsvRow[]) : null;
  const importOptions = body.importOptions ?? {};
  const stageId = normalizeText(importOptions.stageId);
  const source = normalizeText(importOptions.source);
  const ownerId = normalizeText(importOptions.ownerId);
  const instanceName = normalizeText(importOptions.instanceName);

  if (!rows) {
    throw new Error("Payload invalido: rows deve ser um array.");
  }

  if (!stageId) {
    throw new Error("Selecione uma etapa valida para importar.");
  }

  if (!source) {
    throw new Error("Informe a origem do lote.");
  }

  if (!ownerId) {
    throw new Error("Selecione um responsavel valido.");
  }

  if (!instanceName) {
    throw new Error("Selecione uma instancia valida para importar.");
  }

  return {
    rows,
    importOptions: {
      stageId,
      source,
      ownerId,
      instanceName,
    },
  };
}

function sanitizeRows(rows: ImportLeadCsvRow[]) {
  const validRows: Array<{
    name: string;
    contact_phone: string;
    email: string | null;
    last_city: string | null;
    notes: string | null;
  }> = [];
  const invalidRows: Array<{ rowNumber: number; reason: string }> = [];
  const seenPhones = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = normalizeText(row.nome);
    const contactPhone = normalizePhone(row.telefone);
    const email = normalizeText(row.email);
    const lastCity = normalizeText(row.cidade);
    const notes = normalizeText(row.observacoes);

    if (!name && !contactPhone && !email && !lastCity && !notes) {
      invalidRows.push({ rowNumber, reason: "Linha vazia recebida na importacao." });
      return;
    }

    if (!name && !contactPhone) {
      invalidRows.push({ rowNumber, reason: "Nome e telefone obrigatorios." });
      return;
    }

    if (!name) {
      invalidRows.push({ rowNumber, reason: "Nome obrigatorio." });
      return;
    }

    if (!contactPhone) {
      invalidRows.push({ rowNumber, reason: "Telefone obrigatorio ou invalido." });
      return;
    }

    if (seenPhones.has(contactPhone)) {
      invalidRows.push({ rowNumber, reason: "Telefone duplicado no arquivo enviado." });
      return;
    }

    seenPhones.add(contactPhone);
    validRows.push({
      name,
      contact_phone: contactPhone,
      email: email || null,
      last_city: lastCity || null,
      notes: notes || null,
    });
  });

  return { validRows, invalidRows };
}

async function ensureImportOptionsAccess(
  adminClient: ReturnType<typeof createClient>,
  crmUser: { id: string; aces_id: number },
  importOptions: { stageId: string; source: string; ownerId: string; instanceName: string }
) {
  const acesId = crmUser.aces_id;

  if (importOptions.ownerId !== crmUser.id) {
    throw new Error("O responsavel da importacao deve ser o usuario logado.");
  }

  const { data: stage, error: stageError } = await adminClient
    .schema("crm")
    .from("pipeline_stages")
    .select("id")
    .eq("id", importOptions.stageId)
    .eq("aces_id", acesId)
    .maybeSingle();

  if (stageError || !stage) {
    throw new Error("Etapa invalida para a conta atual.");
  }

  const { data: owner, error: ownerError } = await adminClient
    .schema("crm")
    .from("users")
    .select("id")
    .eq("id", importOptions.ownerId)
    .eq("aces_id", acesId)
    .maybeSingle();

  if (ownerError || !owner) {
    throw new Error("Responsavel invalido para a conta atual.");
  }

  const { data: instance, error: instanceError } = await adminClient
    .schema("crm")
    .from("instance")
    .select("instancia")
    .eq("instancia", importOptions.instanceName)
    .eq("aces_id", acesId)
    .eq("created_by", crmUser.id)
    .maybeSingle();

  if (instanceError || !instance) {
    throw new Error("Instancia invalida para o usuario atual.");
  }
}

async function resolveLeadOwnerId(
  adminClient: ReturnType<typeof createClient>,
  acesId: number,
  instanceName: string
) {
  const { data: instance, error } = await adminClient
    .schema("crm")
    .from("instance")
    .select("created_by")
    .eq("instancia", instanceName)
    .eq("aces_id", acesId)
    .or("setup_status.is.null,setup_status.neq.cancelled")
    .maybeSingle();

  if (error || !instance?.created_by) {
    throw new Error("Nao foi possivel identificar o responsavel da instancia selecionada.");
  }

  return instance.created_by;
}

async function insertRowsInChunks(
  adminClient: ReturnType<typeof createClient>,
  acesId: number,
  importOptions: { stageId: string; source: string; ownerId: string; instanceName: string },
  rows: Array<{
    name: string;
    contact_phone: string;
    email: string | null;
    last_city: string | null;
    notes: string | null;
  }>
) {
  const CHUNK_SIZE = 500;
  let inserted = 0;
  const resolvedOwnerId = await resolveLeadOwnerId(adminClient, acesId, importOptions.instanceName);

  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    const chunk = rows.slice(index, index + CHUNK_SIZE).map((row) => ({
      ...row,
      stage_id: importOptions.stageId,
      owner_id: resolvedOwnerId,
      instancia: importOptions.instanceName,
      Fonte: importOptions.source,
      aces_id: acesId,
      view: true,
    }));

    const { data, error } = await adminClient
      .schema("crm")
      .from("leads")
      .upsert(chunk, {
        onConflict: "contact_phone,aces_id",
        ignoreDuplicates: true,
      })
      .select("id");

    if (error) {
      throw new Error(error.message);
    }

    inserted += data?.length ?? 0;
  }

  return inserted;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: buildCorsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Metodo nao permitido" }, { status: 405 }, origin);
  }

  const context = await getAuthenticatedContext(req, origin);
  if ("error" in context) {
    return context.error;
  }

  try {
    const body = (await req.json().catch(() => null)) as ImportLeadCsvBody | null;
    if (!body) {
      return jsonResponse({ error: "Body ausente ou invalido" }, { status: 400 }, origin);
    }

    const { rows, importOptions } = validatePayload(body);
    const { validRows, invalidRows } = sanitizeRows(rows);
    await ensureImportOptionsAccess(context.adminClient, context.crmUser, importOptions);

    const inserted = await insertRowsInChunks(
      context.adminClient,
      context.crmUser.aces_id,
      importOptions,
      validRows
    );

    const duplicatesInDatabase = Math.max(0, validRows.length - inserted);

    return jsonResponse(
      {
        totals: {
          received: rows.length,
          valid: validRows.length,
          inserted,
          duplicatesInDatabase,
          invalid: invalidRows.length,
        },
        invalidRows: invalidRows.slice(0, 25),
      },
      { status: 200 },
      origin
    );
  } catch (error) {
    console.error("[import-leads-csv]", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Erro interno" },
      { status: 500 },
      origin
    );
  }
});
