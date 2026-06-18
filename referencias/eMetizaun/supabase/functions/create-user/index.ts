import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedRoles = new Set(["owner", "admin", "member", "viewer"]);

function jsonResponse(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let body: {
      email?: string;
      password?: string;
      displayName?: string;
      role?: string;
      organizationId?: string;
    };

    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "invalid_payload" });
    }

    const email = body.email?.trim().toLowerCase();
    const password = body.password?.trim();
    const displayName = body.displayName?.trim();
    const role = body.role?.trim();
    const organizationId = body.organizationId?.trim();

    if (!email || !password || !displayName || !role || !organizationId) {
      return jsonResponse(400, { error: "missing_required_fields" });
    }

    if (!allowedRoles.has(role)) {
      return jsonResponse(400, { error: "invalid_role" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      return jsonResponse(500, { error: "supabase_env_missing" });
    }

    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.toLowerCase().startsWith("bearer ")) {
      return jsonResponse(401, { code: 401, message: "Missing authorization header" });
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse(401, { error: "not_authenticated" });
    }

    const { data: callerRole, error: callerRoleError } = await supabaseUser
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("organization_id", organizationId)
      .in("role", ["owner", "admin"])
      .maybeSingle();

    if (callerRoleError || !callerRole) {
      return jsonResponse(403, { error: "forbidden_operation" });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: existingUsers, error: listUsersError } = await supabaseAdmin.auth.admin.listUsers();
    if (listUsersError) throw listUsersError;
    const userExists = existingUsers?.users?.find((u) => (u.email || "").toLowerCase() === email);

    let authUser = userExists;
    if (!authUser) {
      const { data: newAuthData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          display_name: displayName,
          skip_personal_org: true,
          invited_organization_id: organizationId,
        },
      });

      if (authError) throw authError;
      if (!newAuthData?.user) throw new Error("user_creation_failed");
      authUser = newAuthData.user;
    } else {
      console.log("User already exists, adding to organization:", email);
    }

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          user_id: authUser.id,
          display_name: displayName,
        },
        {
          onConflict: "user_id",
        },
      );

    if (profileError) throw profileError;

    const { error: roleError } = await supabaseAdmin.from("user_roles").insert({
      user_id: authUser.id,
      organization_id: organizationId,
      role,
    });

    if (roleError && roleError.code !== "23505") throw roleError;

    return jsonResponse(200, { success: true, user: authUser });
  } catch (error) {
    console.error("Error creating user:", error);
    return jsonResponse(400, { error: error instanceof Error ? error.message : "unknown_error" });
  }
});
