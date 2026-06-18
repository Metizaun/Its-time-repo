import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

type QueryStage = "sanitize" | "validate" | "rpc";

type SanitizedQuery = {
  query?: string;
  errorCode?: string;
  stage: "sanitize";
  firstKeyword: string | null;
  hadFence: boolean;
  hadAutoExecuteTag: boolean;
};

type ValidationResult = {
  valid: boolean;
  code?: string;
  stage: "validate";
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const FORBIDDEN_KEYWORDS = [
  "DROP",
  "TRUNCATE",
  "ALTER",
  "GRANT",
  "REVOKE",
  "DELETE",
  "EXEC",
  "EXECUTE",
];

const ALLOWED_WRITE_TABLES = [
  "leads",
  "deals",
  "tasks",
  "notes",
  "companies",
  "contacts",
  "lead_lists",
  "partners",
];

function preview(value?: string) {
  if (!value) return "";
  return value.slice(0, 120);
}

function extractFirstKeyword(query: string) {
  const match = query.match(/\b(SELECT|WITH|INSERT\s+INTO|UPDATE|FROM)\b/i);
  return match?.[1]?.toUpperCase() || null;
}

function isSafeReadRepairCandidate(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return false;
  if (trimmed.includes(";")) return false;

  if (/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE)\b/i.test(trimmed)) {
    return false;
  }

  if (FORBIDDEN_KEYWORDS.some((keyword) => new RegExp(`\\b${keyword}\\b`, "i").test(trimmed))) {
    return false;
  }

  return /^\s*FROM\b/i.test(trimmed);
}

function repairSelectQuery(query: string) {
  const trimmed = query.trim();
  if (!isSafeReadRepairCandidate(trimmed)) {
    return null;
  }
  return `SELECT * ${trimmed.replace(/^\s*FROM\b/i, "FROM").trim()}`;
}

function sanitizeQuery(rawQuery: string): SanitizedQuery {
  let query = rawQuery.trim();
  const hadAutoExecuteTag = /\[AUTO_EXECUTE\]/i.test(query);
  query = query.replace(/\[AUTO_EXECUTE\]/gi, "").trim();

  const fencedSql = query.match(/```sql\s*([\s\S]*?)```/i);
  let hadFence = false;
  if (fencedSql?.[1]) {
    hadFence = true;
    query = fencedSql[1].trim();
  } else {
    const fencedAny = query.match(/```\s*([\s\S]*?)```/);
    if (fencedAny?.[1]) {
      hadFence = true;
      query = fencedAny[1].trim();
    }
  }

  query = query.replace(/^sql\s*/i, "").trim();

  const firstSqlKeywordIndex = query.search(/\b(SELECT|WITH|INSERT\s+INTO|UPDATE|FROM)\b/i);
  if (firstSqlKeywordIndex > 0) {
    query = query.slice(firstSqlKeywordIndex).trim();
  }

  query = query.replace(/;\s*$/g, "").trim();
  const firstKeyword = extractFirstKeyword(query);

  if (!query) {
    return {
      errorCode: "missing_query",
      stage: "sanitize",
      firstKeyword,
      hadFence,
      hadAutoExecuteTag,
    };
  }

  if (query.includes(";")) {
    return {
      errorCode: "multi_statement_not_allowed",
      stage: "sanitize",
      firstKeyword,
      hadFence,
      hadAutoExecuteTag,
    };
  }

  return {
    query,
    stage: "sanitize",
    firstKeyword,
    hadFence,
    hadAutoExecuteTag,
  };
}

function validateWriteTarget(upper: string): ValidationResult {
  const matchSchema = upper.match(/\b(INSERT\s+INTO|UPDATE)\s+\"?([A-Z0-9_]+)\"?\.\"?([A-Z0-9_]+)\"?/i);
  const matchSimple = upper.match(/\b(INSERT\s+INTO|UPDATE)\s+\"?([A-Z0-9_]+)\"?/i);
  const table = matchSchema?.[3] || matchSimple?.[2];

  if (table && ALLOWED_WRITE_TABLES.includes(table.toLowerCase())) {
    return { valid: true, stage: "validate" };
  }

  return { valid: false, code: "write_not_allowed", stage: "validate" };
}

function validateQuery(query: string): ValidationResult {
  const upper = query.toUpperCase().trim();

  if (query.includes(";")) {
    return { valid: false, code: "multi_statement_not_allowed", stage: "validate" };
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(upper)) {
      return { valid: false, code: "forbidden_operation", stage: "validate" };
    }
  }

  if (upper.startsWith("WITH")) {
    if (upper.includes(" INSERT ") || upper.match(/\bINSERT\b/i)) {
      return validateWriteTarget(upper);
    }
    if (upper.includes(" UPDATE ") || upper.match(/\bUPDATE\b/i)) {
      return validateWriteTarget(upper);
    }
    return { valid: true, stage: "validate" };
  }

  if (upper.startsWith("SELECT")) {
    return { valid: true, stage: "validate" };
  }

  if (upper.startsWith("INSERT") || upper.startsWith("UPDATE")) {
    return validateWriteTarget(upper);
  }

  return { valid: false, code: "operation_not_allowed", stage: "validate" };
}

function createErrorResponse(
  status: number,
  code: string,
  stage: QueryStage,
  query?: string,
  retryApplied = false,
) {
  return new Response(
    JSON.stringify({
      success: false,
      code,
      stage,
      retryApplied,
      queryPreview: preview(query),
    }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

serve(async (req) => {
  const requestId = req.headers.get("x-deno-execution-id") || crypto.randomUUID();
  let queryForError: string | undefined;

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let payload: Record<string, unknown> | null = null;
    try {
      payload = await req.json();
    } catch (error) {
      console.error("[execute-query] invalid_json_payload", { requestId, error });
      return createErrorResponse(400, "invalid_payload", "sanitize");
    }

    const rawQuery = typeof payload?.query === "string" ? payload.query : undefined;
    const executionRetryCount =
      typeof payload?.executionRetryCount === "number" ? payload.executionRetryCount : 0;

    console.log("[execute-query] request", {
      requestId,
      hasQuery: typeof rawQuery === "string",
      rawPreview: typeof rawQuery === "string" ? preview(rawQuery) : null,
      hasAuthorization: Boolean(req.headers.get("Authorization")),
      hasApiKeyHeader: Boolean(req.headers.get("apikey")),
      executionRetryCount,
    });

    if (!rawQuery || typeof rawQuery !== "string") {
      return createErrorResponse(400, "missing_query", "sanitize");
    }

    const sanitized = sanitizeQuery(rawQuery);
    if (!sanitized.query) {
      console.log("[execute-query] sanitize_failed", {
        requestId,
        rawPreview: preview(rawQuery),
        firstKeyword: sanitized.firstKeyword,
        hadFence: sanitized.hadFence,
        hadAutoExecuteTag: sanitized.hadAutoExecuteTag,
        validationStage: "sanitize",
      });
      return createErrorResponse(400, sanitized.errorCode || "validation_failed", "sanitize", rawQuery);
    }

    let query = sanitized.query;
    queryForError = query;
    let retryApplied = false;

    console.log("[execute-query] normalized_query", {
      requestId,
      rawPreview: preview(rawQuery),
      normalizedPreview: preview(query),
      firstKeyword: sanitized.firstKeyword,
      hadFence: sanitized.hadFence,
      hadAutoExecuteTag: sanitized.hadAutoExecuteTag,
      retryApplied,
    });

    let validation = validateQuery(query);
    if (!validation.valid && validation.code === "operation_not_allowed") {
      const repaired = repairSelectQuery(query);
      if (repaired) {
        retryApplied = true;
        query = repaired;
        validation = validateQuery(query);
      }
    }

    console.log("[execute-query] validation", {
      requestId,
      validationStage: validation.stage,
      valid: validation.valid,
      code: validation.code || null,
      normalizedPreview: preview(query),
      retryApplied,
    });

    if (!validation.valid) {
      return createErrorResponse(400, validation.code || "validation_failed", validation.stage, query, retryApplied);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return createErrorResponse(500, "supabase_env_missing", "rpc", query, retryApplied);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return createErrorResponse(401, "not_authenticated", "validate", query, retryApplied);
    }

    const { data: roles } = await supabase
      .from("user_roles")
      .select("organization_id")
      .eq("user_id", userData.user.id)
      .limit(1);

    if (!roles?.length) {
      return createErrorResponse(403, "forbidden_operation", "validate", query, retryApplied);
    }

    const { data, error } = await supabase.rpc("execute_safe_query", {
      query_text: query,
    });

    if (error) {
      console.error("execute_safe_query error:", { requestId, error });
      const message = String(error.message || "");
      let code = error.code || "query_failed";
      if (message.includes("write_not_allowed")) code = "write_not_allowed";
      if (message.includes("forbidden_operation")) code = "forbidden_operation";
      if (message.includes("operation_not_allowed")) code = "operation_not_allowed";
      if (message.includes("multi_statement_not_allowed")) code = "multi_statement_not_allowed";

      return createErrorResponse(400, code, "rpc", query, retryApplied);
    }

    console.log("[execute-query] rpc_success", {
      requestId,
      validationStage: "rpc",
      retryApplied,
      operation: data?.operation ?? null,
      rowCount: data?.rowCount ?? null,
    });

    return new Response(
      JSON.stringify({
        success: true,
        data,
        rowCount: data?.rowCount ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Execute query error:", { requestId, error });
    return createErrorResponse(500, "internal_error", "rpc", queryForError);
  }
});
