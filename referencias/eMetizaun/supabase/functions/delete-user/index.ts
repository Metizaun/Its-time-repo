import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    let body: { userRoleId?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse(400, { error: "invalid_payload" });
    }

    const userRoleId = body.userRoleId?.trim();
    if (!userRoleId) {
      return jsonResponse(400, { error: "missing_user_role_id" });
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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: targetUserRole, error: targetUserRoleError } = await supabaseAdmin
      .from("user_roles")
      .select("id, user_id, organization_id, role")
      .eq("id", userRoleId)
      .maybeSingle();

    if (targetUserRoleError) throw targetUserRoleError;
    if (!targetUserRole) return jsonResponse(404, { error: "user_role_not_found" });

    const { data: callerRole, error: callerRoleError } = await supabaseUser
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("organization_id", targetUserRole.organization_id)
      .in("role", ["owner", "admin"])
      .maybeSingle();

    if (callerRoleError || !callerRole) {
      return jsonResponse(403, { error: "forbidden_operation" });
    }

    if (targetUserRole.role === "owner" && callerRole.role !== "owner") {
      return jsonResponse(403, { error: "cannot_remove_owner" });
    }

    const { error: roleDeleteError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("id", userRoleId);
    if (roleDeleteError) throw roleDeleteError;

    const { data: remainingRoles, error: remainingRolesError } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", targetUserRole.user_id)
      .limit(1);
    if (remainingRolesError) throw remainingRolesError;

    if (!remainingRoles || remainingRoles.length === 0) {
      const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(targetUserRole.user_id);
      if (authDeleteError) {
        console.error("Failed to delete user from auth:", authDeleteError);
      }
    }

    return jsonResponse(200, { success: true });
  } catch (error) {
    console.error("Error deleting user:", error);
    return jsonResponse(400, { error: error instanceof Error ? error.message : "unknown_error" });
  }
});
